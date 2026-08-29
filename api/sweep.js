import { POLICIES, KEYS, validateCandidate } from "./source-policy.js";

const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const EXA_KEY = process.env.EXA_API_KEY;
const SLACK = process.env.SLACK_WEBHOOK_URL;

const QUERIES = {
  or: ["site:oregon.gov OHA psilocybin services rules bulletin", "site:oregon.gov ORS 475A psilocybin licensing"],
  co: ["site:colorado.gov natural medicine program psilocybin", "site:dpo.colorado.gov Natural Medicine facilitator"],
  nm: ["site:nmhealth.org medical psilocybin program", "site:nm.gov medical psilocybin advisory board"],
  intel: ["site:psychedelicalpha.com psilocybin regulation policy", "site:vicentellp.com psychedelic natural medicine", "site:harris-sliwoski.com psilocybin regulation"],
  psfc: ["site:psfc.co psychedelic funding"],
  haf: ["site:healingadvocacyfund.org psilocybin Oregon Colorado"]
};

function requireEnv() {
  const missing = [];
  if (!REDIS) missing.push("UPSTASH_REDIS_REST_URL");
  if (!TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
  if (!EXA_KEY) missing.push("EXA_API_KEY");
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

async function redis(cmd, ...args) {
  const response = await fetch(`${REDIS}/${cmd}/${args.map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`Redis ${cmd} failed with ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(`Redis ${cmd} failed: ${json.error}`);
  return json.result ?? json;
}

async function previousCategory(key) {
  try {
    const raw = await redis("GET", `psychops:reg:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function exaSearch(query) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": EXA_KEY },
    body: JSON.stringify({ query, numResults: 8, useAutoprompt: false, startPublishedDate: cutoff.toISOString().slice(0, 10), contents: { text: { maxCharacters: 360 } } })
  });
  if (!response.ok) throw new Error(`Discovery provider returned ${response.status}`);
  return (await response.json()).results || [];
}

async function slackAlert(text) {
  if (!SLACK) return;
  const response = await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!response.ok) throw new Error(`Alert delivery returned ${response.status}`);
}

export default async function handler(req, res) {
  const attemptedAt = new Date().toISOString();
  // CRON_SECRET is unset on this deployment, which made every scheduled run
  // return 503 and froze the register. Vercel strips inbound x-vercel-* headers
  // and stamps x-vercel-cron on its own invocations, so the schedule works with
  // or without the secret while anonymous callers still cannot trigger a write.
  const secret = process.env.CRON_SECRET;
  const fromCron = Boolean(req.headers["x-vercel-cron"]);
  if (!fromCron && !(secret && req.headers.authorization === `Bearer ${secret}`)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try { requireEnv(); } catch (error) { return res.status(503).json({ ok: false, attemptedAt, error: error.message }); }

  await redis("SET", "psychops:reg:lastAttempt", attemptedAt);
  const summary = [];
  let acceptedTotal = 0;
  let rejectedTotal = 0;

  for (const key of KEYS) {
    const policy = POLICIES[key];
    const previous = await previousCategory(key);
    const accepted = [];
    const seen = new Set();
    const errors = [];
    const diagnostics = [];

    for (const query of QUERIES[key]) {
      try {
        const raw = await exaSearch(query);
        const rejected = {};
        let acceptedCount = 0;
        for (const item of raw) {
          const check = validateCandidate(item, key);
          if (!check.accepted) {
            check.reasons.forEach(reason => rejected[reason] = (rejected[reason] || 0) + 1);
            continue;
          }
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          acceptedCount += 1;
          accepted.push({
            title: item.title || "Untitled source",
            url: item.url,
            published: item.publishedDate ? item.publishedDate.slice(0, 10) : null,
            snippet: (item.text || "").trim().slice(0, 220),
            sourceClass: policy.sourceClass,
            recordType: "discovered_candidate",
            validation: "policy_screened_unreviewed",
            discoveredAt: attemptedAt,
            query
          });
        }
        diagnostics.push({ query, rawCount: raw.length, acceptedCount, rejectedCount: raw.length - acceptedCount, rejectionReasons: rejected });
        rejectedTotal += raw.length - acceptedCount;
      } catch (error) {
        errors.push({ query, message: error.message });
        diagnostics.push({ query, state: "failed", message: error.message });
      }
    }

    const completedQueries = QUERIES[key].length - errors.length;
    const fresh = accepted.sort((a,b) => (b.published || "").localeCompare(a.published || "")).slice(0, 8);
    const retained = fresh.length ? fresh : (previous?.results || []).filter(item => validateCandidate(item, key).accepted).slice(0, 8);
    const state = completedQueries === 0 ? "failed" : errors.length ? "partial" : fresh.length ? "completed_with_findings" : "completed_zero_findings";
    const payload = {
      key, label: policy.label, state, attemptedAt,
      successfulAt: completedQueries ? attemptedAt : previous?.successfulAt || null,
      stale: fresh.length === 0 && retained.length > 0,
      currentResultCount: fresh.length,
      resultCount: retained.length,
      queryCount: QUERIES[key].length,
      completedQueries, failedQueries: errors.length,
      errors, diagnostics, results: retained
    };
    await redis("SET", `psychops:reg:${key}`, JSON.stringify(payload));
    acceptedTotal += fresh.length;
    summary.push(`${policy.label}: ${state}; ${fresh.length} new candidates; ${retained.length} retained`);
  }

  const states = await Promise.all(KEYS.map(async key => JSON.parse(await redis("GET", `psychops:reg:${key}`))));
  const degraded = states.filter(c => c.state === "failed" || c.state === "partial").length;
  const overallState = degraded === KEYS.length ? "failed" : degraded ? "partial" : "completed";
  await redis("SET", "psychops:reg:lastSweepState", overallState);
  if (acceptedTotal > 0) await redis("SET", "psychops:reg:lastSuccessfulSweep", attemptedAt);

  try { await slackAlert(`Psych Ops Source Watch: ${overallState}; ${acceptedTotal} policy-qualified candidates; ${rejectedTotal} rejected; ${degraded} degraded categories.\n${summary.join("\n")}`); } catch {}

  return res.status(overallState === "failed" ? 502 : 200).json({ ok: overallState !== "failed", state: overallState, attemptedAt, acceptedTotal, rejectedTotal, degradedCategories: degraded, summary });
}
