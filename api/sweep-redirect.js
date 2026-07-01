const REDIS   = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN   = process.env.UPSTASH_REDIS_REST_TOKEN;
const EXA_KEY = process.env.EXA_API_KEY;
const SLACK   = process.env.SLACK_WEBHOOK_URL;

const CATEGORIES = [
  { key:"or",    label:"Oregon — OHA Psilocybin Services",               queries:["Oregon Health Authority psilocybin services rulemaking bulletin 2026","Oregon psilocybin SB 303 data collection OHA 2026","Oregon psilocybin service center facilitator licensing update 2026"] },
  { key:"co",    label:"Colorado — Natural Medicine Program",             queries:["Colorado Department of Revenue Natural Medicine Division healing center 2026","Colorado DORA psilocybin facilitator licensing natural medicine 2026","Colorado Natural Medicine Advisory Board NMAB ibogaine 2026"] },
  { key:"nm",    label:"New Mexico — Medical Psilocybin Act",             queries:["New Mexico NMDOH medical psilocybin SB 219 advisory board 2026","New Mexico psilocybin rulemaking equity fund facilitator training 2026"] },
  { key:"intel", label:"Field Intelligence — Legal & Policy",             queries:["site:psychedelicalpha.com psilocybin regulation policy 2026","site:vicentellp.com psychedelic psilocybin cannabis 2026","Harris Sliwoski psilocybin natural medicine regulation 2026"] },
  { key:"psfc",  label:"PSFC — Psychedelic Science Funders Collaborative",queries:["\"Psychedelic Science Funders Collaborative\" 2026","PSFC psilocybin funding strategic roadmap 2026"] },
  { key:"haf",   label:"HAF — Healing Advocacy Fund",                    queries:["\"Healing Advocacy Fund\" psilocybin Oregon Colorado 2026","Healing Advocacy Fund SB 303 state program 2026"] }
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
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":EXA_KEY},
    body:JSON.stringify({ query, numResults:5, useAutoprompt:true,
      startPublishedDate:cutoff.toISOString().split("T")[0],
      contents:{text:{maxCharacters:200}} })
  });
  const j = await r.json();
  return (j.results||[]).map(x=>({
    title:x.title||"Untitled", url:x.url,
    published:x.publishedDate?x.publishedDate.split("T")[0]:null,
    snippet:x.text?x.text.slice(0,180).trim()+"…":""
  }));
}

export default async function handler(req, res) {
  // Run sweep
  const now = new Date().toISOString();
  let total = 0;
  const summary = [];

  for (const cat of CATEGORIES) {
    const seen = new Set();
    const results = [];
    for (const q of cat.queries) {
      const items = await exaSearch(q);
      for (const item of items) {
        if (!seen.has(item.url)) { seen.add(item.url); results.push(item); }
      }
    }
    const trimmed = results
      .sort((a,b)=>(b.published||"").localeCompare(a.published||""))
      .slice(0,8);
    await redis("SET", `psychops:reg:${cat.key}`, JSON.stringify({label:cat.label,updated:now,results:trimmed}));
    total += trimmed.length;
    summary.push(`${cat.label}: ${trimmed.length} results`);
  }
  await redis("SET","psychops:reg:lastSweep",now);

  // Slack alert
  try {
    await fetch(SLACK,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text:`🔔 *Psych Ops Sweep Complete*\n${total} findings\n${summary.join("\n")}`})});
  } catch(e) {}

  // Return a clean confirmation page that redirects to dashboard
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="3;url=/api/dashboard">
<title>Sweep Complete — Aloha AI Psychoactive Plant Monitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#1B2A4A;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:8px;padding:2.5rem 3rem;text-align:center;max-width:420px;width:90%}
.icon{font-size:2.5rem;margin-bottom:1rem}
h1{font-size:1.2rem;font-weight:700;color:#1B2A4A;margin-bottom:.5rem}
p{font-size:.9rem;color:#5A6A7A;line-height:1.6;margin-bottom:1.25rem}
.count{font-size:1.75rem;font-weight:700;color:#0E7C7B;margin:.5rem 0}
a{display:inline-block;background:#0E7C7B;color:#fff;padding:.6rem 1.4rem;border-radius:4px;text-decoration:none;font-size:.85rem;font-weight:700}
a:hover{background:#0A6363}
.note{font-size:.75rem;color:#8A9BAB;margin-top:1rem}
</style>
</head>
<body>
<div class="card">
  <div class="icon">✓</div>
  <h1>Sweep Complete</h1>
  <div class="count">${total} results</div>
  <p>All 6 categories updated across Oregon, Colorado, New Mexico, and field intelligence sources.</p>
  <a href="/api/dashboard">View Dashboard</a>
  <div class="note">Redirecting automatically in 3 seconds…</div>
</div>
</body>
</html>`;

  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.status(200).send(html);
}
