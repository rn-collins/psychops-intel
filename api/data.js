const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const KEYS = ["or", "co", "nm", "intel", "psfc", "haf"];

async function redisGet(key) {
  if (!REDIS || !TOKEN) throw new Error("PsychOps storage is not configured");
  const response = await fetch(`${REDIS}/GET/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!response.ok) throw new Error(`Redis GET failed with ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error);
  return json.result || null;
}

async function category(key) {
  const raw = await redisGet(`psychops:reg:${key}`);
  if (!raw) {
    return {
      key,
      state: "never_run",
      resultCount: 0,
      results: [],
      attemptedAt: null,
      successfulAt: null,
      errors: []
    };
  }

  const data = JSON.parse(raw);
  return {
    key,
    ...data,
    resultCount: Number.isFinite(data.resultCount) ? data.resultCount : (data.results || []).length,
    results: (data.results || []).map(item => ({
      ...item,
      snippet: item.snippet ? item.snippet.slice(0, 160) : ""
    }))
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  try {
    const [categories, lastAttempt, lastSuccessfulSweep, sweepState] = await Promise.all([
      Promise.all(KEYS.map(category)),
      redisGet("psychops:reg:lastAttempt"),
      redisGet("psychops:reg:lastSuccessfulSweep"),
      redisGet("psychops:reg:lastSweepState")
    ]);

    res.status(200).json({
      ok: true,
      state: sweepState || "never_run",
      lastAttempt,
      lastSuccessfulSweep,
      categories
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      state: "failed",
      error: error.message,
      lastAttempt: null,
      lastSuccessfulSweep: null,
      categories: KEYS.map(key => ({
        key,
        state: "failed",
        resultCount: 0,
        results: [],
        attemptedAt: null,
        successfulAt: null,
        errors: [{ message: error.message }]
      }))
    });
  }
}
