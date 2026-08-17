import { KEYS, POLICIES, validateCandidate, monitoredSource } from "./source-policy.js";

const REDIS = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  if (!REDIS || !TOKEN) throw new Error("PsychOps storage is not configured");
  const response = await fetch(`${REDIS}/GET/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`Storage read failed with ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error("Storage returned an error");
  return json.result || null;
}

async function category(key) {
  const raw = await redisGet(`psychops:reg:${key}`);
  const base = raw ? JSON.parse(raw) : { key, state: "never_run", results: [], errors: [], attemptedAt: null, successfulAt: null };
  const stored = base.results || [];
  const candidates = stored.filter(item => validateCandidate(item, key).accepted).map(item => ({
    ...item, recordType: "discovered_candidate", validation: "policy_screened_unreviewed", snippet: (item.snippet || "").slice(0, 180)
  }));
  return {
    ...base,
    key,
    label: POLICIES[key].label,
    resultCount: candidates.length,
    rejectedStoredResults: stored.length - candidates.length,
    monitoredSources: [monitoredSource(key)],
    results: candidates,
    errors: (base.errors || []).map(error => ({ query: error.query, message: String(error.message || "Source query failed").slice(0, 120) }))
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const [categories, lastAttempt, lastSuccessfulSweep, sweepState] = await Promise.all([
      Promise.all(KEYS.map(category)),
      redisGet("psychops:reg:lastAttempt"),
      redisGet("psychops:reg:lastSuccessfulSweep"),
      redisGet("psychops:reg:lastSweepState")
    ]);
    const sourceHealth = {
      healthy: categories.filter(c => ["completed_with_findings", "completed_zero_findings"].includes(c.state)).length,
      degraded: categories.filter(c => c.state === "partial").length,
      failed: categories.filter(c => ["failed", "never_run"].includes(c.state)).length,
      candidateCount: categories.reduce((sum,c) => sum + c.resultCount, 0),
      rejectedNoiseCount: categories.reduce((sum,c) => sum + (c.rejectedStoredResults || 0) + (c.diagnostics || []).reduce((n,d) => n + (d.rejectedCount || 0), 0), 0),
      verifiedSourceCount: categories.reduce((sum,c) => sum + c.monitoredSources.length, 0)
    };
    res.status(200).json({ ok: true, state: sweepState || "never_run", lastAttempt, lastSuccessfulSweep, sourceHealth, categories });
  } catch (error) {
    res.status(503).json({
      ok: false, state: "failed", error: "Source-watch data is temporarily unavailable.", lastAttempt: null, lastSuccessfulSweep: null,
      sourceHealth: { healthy: 0, degraded: 0, failed: KEYS.length, candidateCount: 0, rejectedNoiseCount: 0, verifiedSourceCount: KEYS.length },
      categories: KEYS.map(key => ({ key, label: POLICIES[key].label, state: "failed", resultCount: 0, results: [], monitoredSources: [monitoredSource(key)], attemptedAt: null, successfulAt: null, errors: [{ message: "Data source unavailable" }] }))
    });
  }
}
