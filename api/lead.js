const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SLACK = process.env.SLACK_WEBHOOK_URL;

async function redis(cmd, ...args) {
  const r = await fetch(`${REDIS}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  let email;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    email = (body?.email || "").trim().toLowerCase();
  } catch {
    return res.status(400).json({ error: "Invalid body" });
  }

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const ts  = Date.now();
  const key = `psychops:leads:${ts}`;
  await redis("SET", key, JSON.stringify({ email, ts: new Date(ts).toISOString() }));

  await fetch(SLACK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `📧 *New Psych Ops subscriber*\n${email}\n_${new Date(ts).toLocaleString("en-US", { timeZone: "Pacific/Honolulu" })} HST_`
    })
  });

  res.status(200).json({ ok: true });
}
