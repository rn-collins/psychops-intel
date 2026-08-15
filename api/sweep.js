const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const EXA_KEY = process.env.EXA_API_KEY;
const SLACK = process.env.SLACK_WEBHOOK_URL;

const CATEGORIES = [
  { key: "or", label: "Oregon — OHA Psilocybin Services", sourceClass: "official", allowedHosts: ["oregon.gov"], queries: [
    "Oregon Health Authority psilocybin services rulemaking bulletin 2026",
    "Oregon psilocybin SB 303 data collection OHA 2026",
    "Oregon psilocybin service center facilitator licensing update 2026"
  ]},
  { key: "co", label: "Colorado — Natural Medicine Program", sourceClass: "official", allowedHosts: ["colorado.gov"], queries: [
    "Colorado Department of Revenue Natural Medicine Division healing center 2026",
    "Colorado DORA psilocybin facilitator licensing natural medicine 2026",
    "Colorado Natural Medicine Advisory Board NMAB ibogaine 2026"
  ]},
  { key: "nm", label: "New Mexico — Medical Psilocybin Act", sourceClass: "official", allowedHosts: ["nmhealth.org", "nm.gov"], queries: [
    "New Mexico NMDOH medical psilocybin SB 219 advisory board 2026",
    "New Mexico psilocybin rulemaking equity fund facilitator training 2026"
  ]},
  { key: "intel", label: "Field Intelligence — Legal & Policy", sourceClass: "secondary", allowedHosts: [], queries: [
    "site:psychedelicalpha.com psilocybin regulation policy 2026",
    "site:vicentellp.com psychedelic psilocybin cannabis 2026",
    "Harris Sliwoski psilocybin natural medicine regulation 2026"
  ]},
  { key: "psfc", label: "PSFC — Psychedelic Science Funders Collaborative", sourceClass: "organization", allowedHosts: [], queries: [
    "\"Psychedelic Science Funders Collaborative\" 2026",
    "PSFC psilocybin funding strategic roadmap 2026"
  ]},
  { key: "haf", label: "HAF — Healing Advocacy Fund", sourceClass: "organization", allowedHosts: [], queries: [
    "\"Healing Advocacy Fund\" psilocybin Oregon Colorado 2026",
    "Healing Advocacy Fund SB 303 state program 2026"
  ]}
];

function requireEnv() {
  const missing = [];
  if (!REDIS) missing.push("UPSTASH_REDIS_REST_URL");
  if (!TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
  if (!EXA_KEY) missing.push("EXA_API_KEY");
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

async function redis(cmd, ...args) {
  const response = await fetch(`${REDIS}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!response.ok) throw new Error(`Redis ${cmd} failed with ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(`Redis ${cmd} failed: ${json.error}`);
  return json;
}

async function exaSearch(query, category) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": EXA_KEY },
    body: JSON.stringify({
      query,
      numResults: 5,
      useAutoprompt: true,
      startPublishedDate: cutoff.toISOString().split("T")[0],
      contents: { text: { maxCharacters: 240 } }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Exa failed with ${response.status}: ${text.slice(0, 180)}`);
  }
  const json = await response.json();
  return (json.results || []).filter(item => {
    if (!item.url) return false;
    try {
      const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, "");
      return !category.allowedHosts.length || category.allowedHosts.some(allowed => host === allowed || host.endsWith("." + allowed));
    } catch {
      return false;
    }
  }).map(item => ({
    title: item.title || "Untitled",
    url: item.url,
    published: item.publishedDate ? item.publishedDate.split("T")[0] : null,
    snippet: item.text ? `${item.text.slice(0, 180).trim()}…` : "",
    sourceClass: category.sourceClass,
    discoveredAt: new Date().toISOString(),
    query
  }));
}

async function saveCategory(key, payload) {
  await redis("SET", `psychops:reg:${key}`, JSON.stringify(payload));
}

async function slackAlert(text) {
  if (!SLACK) return;
  const response = await fetch(SLACK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!response.ok) throw new Error(`Slack alert failed with ${response.status}`);
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  const attemptedAt = new Date().toISOString();
  const summary = [];
  let total = 0;
  let failures = 0;

  try {
    requireEnv();
  } catch (error) {
    return res.status(500).json({ ok: false, attemptedAt, error: error.message });
  }

  await redis("SET", "psychops:reg:lastAttempt", attemptedAt);

  for (const category of CATEGORIES) {
    const seen = new Set();
    const results = [];
    const errors = [];

    for (const query of category.queries) {
      try {
        const items = await exaSearch(query, category);
        for (const item of items) {
          if (!seen.has(item.url)) {
            seen.add(item.url);
            results.push(item);
          }
        }
      } catch (error) {
        errors.push({ query, message: error.message });
      }
    }

    const trimmed = results
      .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
      .slice(0, 8);

    const completedQueries = category.queries.length - errors.length;
    const state = completedQueries === 0
      ? "failed"
      : errors.length > 0
        ? "partial"
        : trimmed.length > 0
          ? "completed_with_findings"
          : "completed_zero_findings";

    if (state === "failed" || state === "partial") failures += 1;
    total += trimmed.length;

    const payload = {
      key: category.key,
      label: category.label,
      state,
      attemptedAt,
      successfulAt: completedQueries > 0 ? attemptedAt : null,
      queryCount: category.queries.length,
      completedQueries,
      failedQueries: errors.length,
      errors,
      resultCount: trimmed.length,
      results: trimmed
    };

    await saveCategory(category.key, payload);
    summary.push(`*${category.label}*: ${state} — ${trimmed.length} result${trimmed.length === 1 ? "" : "s"}`);
  }

  const overallState = failures === CATEGORIES.length ? "failed" : failures > 0 ? "partial" : "completed";
  if (overallState !== "failed") await redis("SET", "psychops:reg:lastSuccessfulSweep", attemptedAt);
  await redis("SET", "psychops:reg:lastSweepState", overallState);

  const dateStr = new Date(attemptedAt).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  try {
    await slackAlert(
      `Psych Ops Intel Sweep — ${dateStr}\n` +
      `${overallState.toUpperCase()} · ${total} unreviewed source leads · ${failures} categories with errors\n\n` +
      summary.join("\n") +
      `\n\nDashboard: https://psychops-intel.vercel.app`
    );
  } catch (error) {
    summary.push(`Slack alert error: ${error.message}`);
  }

  res.status(overallState === "failed" ? 502 : 200).json({
    ok: overallState !== "failed",
    state: overallState,
    attemptedAt,
    total,
    categories: CATEGORIES.length,
    categoriesWithErrors: failures,
    summary
  });
}
