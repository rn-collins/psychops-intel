const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEYS  = ["or","co","nm","intel","psfc","haf"];

async function redisGet(key) {
  const r = await fetch(
    `${REDIS}/GET/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const j = await r.json();
  return j.result || null;
}

async function getData() {
  const results = await Promise.all(
    KEYS.map(k => redisGet(`psychops:reg:${k}`))
  );
  const swept = await redisGet("psychops:reg:lastSweep");
  return {
    swept,
    categories: KEYS.map((k, i) => {
      if (!results[i]) return null;
      try {
        const cat = JSON.parse(results[i]);
        if (cat.results) {
          cat.results = cat.results.map(r => ({
            title:     (r.title     || "").slice(0, 120),
            url:       r.url       || "",
            published: r.published || "",
            snippet:   (r.snippet  || "").replace(/\n/g, " ").slice(0, 120)
          }));
        }
        return { key: k, ...cat };
      } catch(e) { return null; }
    }).filter(Boolean)
  };
}

function esc(str) {
  return (str || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function renderCards(categories) {
  return categories.map(cat => {
    const results = cat.results || [];
    const items = results.length === 0
      ? `<div class="empty">No results yet — trigger a sweep above.</div>`
      : results.map(r => {
          let host = "";
          try { host = new URL(r.url).hostname; } catch(e) {}
          return `<div class="result-item">
            <a class="result-title" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
            <div class="result-meta">${esc(r.published) || "Date unknown"} &middot; ${esc(host)}</div>
            ${r.snippet ? `<div class="result-snippet">${esc(r.snippet)}</div>` : ""}
          </div>`;
        }).join("");

    const badge = results.length > 0
      ? `<span class="badge">${results.length}</span>` : "";

    const updated = cat.updated
      ? new Date(cat.updated).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
      : "—";

    return `<div class="card">
      <div class="card-header">
        <div class="card-title">${esc(cat.label)}</div>
        ${badge}
      </div>
      <div class="card-body">${items}</div>
      <div class="card-footer">Updated: ${updated}</div>
    </div>`;
  }).join("");
}

export default async function handler(req, res) {
  let data = { swept: null, categories: [] };
  let error = null;

  try {
    data = await getData();
  } catch(e) {
    error = e.message;
  }

  const sweptStr = data.swept
    ? new Date(data.swept).toLocaleDateString("en-US",{
        weekday:"short",month:"short",day:"numeric",
        year:"numeric",hour:"2-digit",minute:"2-digit"
      })
    : "Not yet run";

  const cardsHtml = data.categories.length > 0
    ? renderCards(data.categories)
    : `<div class="no-data">
        No data yet. Click <strong>Trigger Manual Sweep</strong> above to populate.
       </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aloha AI — Psychoactive Plant Monitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#F4F7F9;color:#1A1A1A;min-height:100vh}
.site-header{background:#1B2A4A;padding:1.5rem 2rem;border-bottom:3px solid #0E7C7B}
.header-inner{max-width:1100px;margin:0 auto;display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem}
.brand-name{font-size:1.5rem;font-weight:700;color:#fff;letter-spacing:.06em;text-transform:uppercase}
.brand-sub{font-size:.75rem;color:#88AABB;letter-spacing:.1em;text-transform:uppercase;margin-top:.25rem}
.sweep-meta{text-align:right}
.sweep-label{font-size:.7rem;color:#88AABB;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.2rem}
.sweep-time{font-size:.85rem;color:#AACCDD}
main{max-width:1100px;margin:2rem auto;padding:0 1.5rem}
.trigger-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #D0DCE8}
.trigger-meta{font-size:.8rem;color:#5A6A7A}
.trigger-meta strong{color:#B03A2E}
.trigger-btn{font-family:Arial,sans-serif;font-size:.8rem;font-weight:600;padding:.45rem 1rem;background:#fff;color:#1B2A4A;border:1px solid #D0DCE8;border-radius:4px;cursor:pointer;text-decoration:none;display:inline-block}
.trigger-btn:hover{background:#EBF3F7;border-color:#0E7C7B}
.subscribe-section{background:#1B2A4A;border-radius:6px;padding:1.5rem 2rem;margin-bottom:2rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1.5rem}
.subscribe-copy h2{font-size:1rem;font-weight:700;color:#fff;margin-bottom:.4rem}
.subscribe-copy p{font-size:.85rem;color:#AACCDD;max-width:420px;line-height:1.5}
.subscribe-form{display:flex;gap:.75rem;flex-wrap:wrap}
.subscribe-input{font-family:Arial,sans-serif;font-size:.9rem;padding:.55rem 1rem;border:1px solid #3D5166;border-radius:4px;background:#162038;color:#fff;width:220px;outline:none}
.subscribe-input::placeholder{color:#4D6070}
.subscribe-input:focus{border-color:#0E7C7B}
.subscribe-btn{font-family:Arial,sans-serif;font-size:.85rem;font-weight:700;padding:.55rem 1.2rem;background:#0E7C7B;color:#fff;border:none;border-radius:4px;cursor:pointer}
.subscribe-btn:hover{background:#0A6363}
.subscribe-btn:disabled{background:#3D5166;cursor:default}
.sub-msg{font-family:Arial,sans-serif;font-size:.75rem;color:#88AABB;margin-top:.35rem}
.sub-msg.success{color:#4CAF88}
.sub-msg.error{color:#E87070}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.5rem;margin-bottom:2rem}
.card{background:#fff;border:1px solid #D0DCE8;border-radius:6px;overflow:hidden;display:flex;flex-direction:column}
.card-header{background:#1B2A4A;padding:.65rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.card-title{font-size:.75rem;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em}
.badge{font-size:.65rem;background:#0E7C7B;color:#fff;padding:2px 7px;border-radius:99px}
.card-body{padding:.75rem 1rem;flex:1}
.result-item{padding:.5rem 0;border-bottom:1px solid #E8EEF4}
.result-item:last-child{border-bottom:none}
.result-title{font-size:.85rem;color:#1B2A4A;font-weight:600;line-height:1.4;text-decoration:none;display:block;margin-bottom:.15rem}
.result-title:hover{color:#0E7C7B}
.result-meta{font-size:.7rem;color:#5A6A7A;margin-bottom:.2rem}
.result-snippet{font-size:.78rem;color:#4A5A6A;line-height:1.5}
.card-footer{padding:.45rem 1rem;background:#F0F4F8;border-top:1px solid #D0DCE8;font-size:.7rem;color:#5A6A7A}
.empty{font-size:.85rem;color:#5A6A7A;font-style:italic;padding:.5rem 0}
.no-data{grid-column:1/-1;text-align:center;padding:3rem;font-size:.9rem;color:#5A6A7A;background:#fff;border:1px solid #D0DCE8;border-radius:6px}
.error-banner{background:#FFE0E0;border:1px solid #B03A2E;border-radius:4px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem;color:#B03A2E}
footer{background:#1B2A4A;border-top:1px solid #243350;padding:1.25rem 2rem;text-align:center;margin-top:2rem}
.footer-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap}
.footer-brand{font-size:.8rem;font-weight:700;color:#88AABB;text-transform:uppercase;letter-spacing:.06em}
.footer-credit{font-size:.75rem;color:#4D6070}
</style>
</head>
<body>
<header class="site-header">
  <div class="header-inner">
    <div>
      <div class="brand-name">Aloha AI &mdash; Psychoactive Plant Monitor</div>
      <div class="brand-sub">Oregon &middot; Colorado &middot; New Mexico &middot; Field Intelligence</div>
    </div>
    <div class="sweep-meta">
      <div class="sweep-label">Last Sweep</div>
      <div class="sweep-time">${esc(sweptStr)}</div>
    </div>
  </div>
</header>

<main>
  ${error ? `<div class="error-banner">Data error: ${esc(error)}</div>` : ""}

  <div class="trigger-bar">
    <div class="trigger-meta">
      Monitored weekly &middot; OHA, DOR NMD, DORA, NMDOH, PSFC, HAF, Psychedelic Alpha
      ${data.categories.length === 0 ? " &middot; <strong>No data yet — click Trigger Manual Sweep to populate</strong>" : ""}
    </div>
    <a href="/api/sweep-redirect" class="trigger-btn">&#8635; Trigger Manual Sweep</a>
  </div>

  <div class="subscribe-section">
    <div class="subscribe-copy">
      <h2>Get alerts when the landscape shifts.</h2>
      <p>Weekly email when the sweep surfaces new rulemaking, bulletins, or field publications across Oregon, Colorado, and New Mexico.</p>
    </div>
    <div>
      <div class="subscribe-form">
        <input class="subscribe-input" id="email-input" type="email" placeholder="your@email.com">
        <button class="subscribe-btn" id="sub-btn" onclick="subscribe()">Subscribe</button>
      </div>
      <div class="sub-msg" id="sub-msg"></div>
    </div>
  </div>

  <div class="grid">${cardsHtml}</div>
</main>

<footer>
  <div class="footer-inner">
    <div class="footer-brand">Aloha AI Consulting</div>
    <div class="footer-credit">Built by RN Collins &middot; Data via Exa &middot; RN Collins LLC</div>
  </div>
</footer>

<script>
async function subscribe() {
  const email = document.getElementById('email-input').value.trim();
  const btn   = document.getElementById('sub-btn');
  const msg   = document.getElementById('sub-msg');
  if (!email || !email.includes('@')) {
    msg.textContent = 'Please enter a valid email address.';
    msg.className = 'sub-msg error';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Subscribing\u2026';
  try {
    const r = await fetch('/api/lead', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email})
    });
    if (r.ok) {
      msg.textContent = "You\u2019re subscribed. Weekly alerts will come to your inbox.";
      msg.className = 'sub-msg success';
      btn.textContent = 'Subscribed \u2713';
    } else { throw new Error(); }
  } catch {
    msg.textContent = 'Something went wrong. Try again.';
    msg.className = 'sub-msg error';
    btn.disabled = false;
    btn.textContent = 'Subscribe';
  }
}
</script>
</body>
</html>`;

  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.status(200).send(html);
}
