const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const KEYS = ["or", "co", "nm", "intel", "psfc", "haf"];

async function redis(key) {
  const r = await fetch(
    `${REDIS}/GET/${encodeURIComponent(`psychops:reg:${key}`)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const j = await r.json();
  if (!j.result) return null;
  const data = JSON.parse(j.result);
  // Trim snippets to 120 chars to reduce payload size
  if (data.results) {
    data.results = data.results.map(item => ({
      ...item,
      snippet: item.snippet ? item.snippet.slice(0, 120) : ''
    }));
  }
  return data;
}

async function lastSweep() {
  const r = await fetch(
    `${REDIS}/GET/${encodeURIComponent("psychops:reg:lastSweep")}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const j = await r.json();
  return j.result || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");

  const [categories, swept] = await Promise.all([
    Promise.all(KEYS.map(k => redis(k))),
    lastSweep()
  ]);

  res.status(200).json({
    lastSweep: swept,
    categories: KEYS.map((k, i) => ({ key: k, ...categories[i] })).filter(c => c.label)
  });
}
