const REDIS   = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN   = process.env.UPSTASH_REDIS_REST_TOKEN;
const EXA_KEY = process.env.EXA_API_KEY;
const SLACK   = process.env.SLACK_WEBHOOK_URL;

const CATEGORIES = [
  {
    key:   "or",
    label: "Oregon — OHA Psilocybin Services",
    queries: [
      "Oregon Health Authority psilocybin services rulemaking bulletin 2026",
      "Oregon psilocybin SB 303 data collection OHA 2026",
      "Oregon psilocybin service center facilitator licensing update 2026"
    ]
  },
  {
    key:   "co",
    label: "Colorado — Natural Medicine Program",
    queries: [
      "Colorado Department of Revenue Natural Medicine Division healing center 2026",
      "Colorado DORA psilocybin facilitator licensing natural medicine 2026",
      "Colorado Natural Medicine Advisory Board NMAB ibogaine 2026"
    ]
  },
  {
    key:   "nm",
    label: "New Mexico — Medical Psilocybin Act",
    queries: [
      "New Mexico NMDOH medical psilocybin SB 219 advisory board 2026",
      "New Mexico psilocybin rulemaking equity fund facilitator training 2026"
    ]
  },
  {
    key:   "intel",
    label: "Field Intelligence — Legal & Policy",
    queries: [
      "site:psychedelicalpha.com psilocybin regulation policy 2026",
      "site:vicentellp.com psychedelic psilocybin cannabis 2026",
      "Harris Sliwoski psilocybin natural medicine regulation 2026"
    ]
  },
  {
    key:   "psfc",
    label: "PSFC — Psychedelic Science Funders Collaborative",
    queries: [
      "\"Psychedelic Science Funders Collaborative\" 2026",
      "PSFC psilocybin funding strategic roadmap 2026"
    ]
  },
  {
    key:   "haf",
    label: "HAF — Healing Advocacy Fund",
    queries: [
      "\"Healing Advocacy Fund\" psilocybin Oregon Colorado 2026",
      "Healing Advocacy Fund SB 303 state program 2026"
    ]
  }
];

async function redis(cmd, ...args) {
  const r = await fetch(`${REDIS}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  return r.json();
}

async function exaSearch(query) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": EXA_KEY },
    body: JSON.stringify({
      query,
      numResults: 5,
      useAutoprompt: true,
      startPublishedDate: cutoff.toISOString().split("T")[0],
      contents: { text: { maxCharacters: 200 } }
    })
  });
  const j = await r.json();
  return (j.results || []).map(x => ({
    title:     x.title || "Untitled",
    url:       x.url,
    published: x.publishedDate ? x.publishedDate.split("T")[0] : null,
    snippet:   x.text ? x.text.slice(0, 180).trim() + "…" : ""
  }));
}

async function slackAlert(text) {
  await fetch(SLACK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
}

export default async function handler(req, res) {
  const now      = new Date().toISOString();
  const summary  = [];
  let   total    = 0;

  for (const cat of CATEGORIES) {
    const seen    = new Set();
    const results = [];

    for (const q of cat.queries) {
      const items = await exaSearch(q);
      for (const item of items) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          results.push(item);
        }
      }
    }

    // Keep 8 most recent unique results per category
    const trimmed = results
      .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
      .slice(0, 8);

    await redis("SET", `psychops:reg:${cat.key}`, JSON.stringify({
      label:   cat.label,
      updated: now,
      results: trimmed
    }));

    total += trimmed.length;
    summary.push(`*${cat.label}*: ${trimmed.length} result${trimmed.length !== 1 ? "s" : ""}`);
  }

  await redis("SET", "psychops:reg:lastSweep", now);

  const dateStr = new Date(now).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  await slackAlert(
    `🔔 *Psych Ops Intel Sweep — ${dateStr}*\n` +
    `${total} findings across ${CATEGORIES.length} categories\n\n` +
    summary.join("\n") +
    `\n\nDashboard: https://psychops-intel.vercel.app`
  );

  res.status(200).json({ ok: true, swept: now, total, categories: CATEGORIES.length });
}
