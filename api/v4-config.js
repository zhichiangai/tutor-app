const PRODUCTION_HOST = "tutor.rapid4grad.com";
const PRODUCTION_REF = "vctisuglfoxyuwlvyjee";
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(body));
}

function readEnvironment(prefix, environment, isolated) {
  const projectRef = process.env[`${prefix}_PROJECT_REF`];
  const url = process.env[`${prefix}_URL`];
  const publishableKey = process.env[`${prefix}_PUBLISHABLE_KEY`];
  if (!/^[a-z]{20}$/.test(projectRef || "") || !PUBLISHABLE_KEY.test(publishableKey || "") ||
      url !== `https://${projectRef}.supabase.co`) return null;
  if (environment === "production" && projectRef !== PRODUCTION_REF) return null;
  if (environment === "preview" && projectRef === PRODUCTION_REF) return null;
  return {environment, isolated, projectRef, url, publishableKey};
}

module.exports = function v4Config(req, res) {
  const host = String(req.headers?.host || "").toLowerCase().split(":")[0];
  if (req.method !== "GET") return send(res, 405, {error: "method_not_allowed"});

  if (process.env.VERCEL_ENV === "production" && host === PRODUCTION_HOST) {
    const config = readEnvironment("V4_PRODUCTION_SUPABASE", "production", false);
    if (!config) return send(res, 503, {error: "production_configuration_unavailable"});
    return send(res, 200, config);
  }

  if (process.env.VERCEL_ENV === "preview" && host.endsWith(".vercel.app") &&
      host === String(process.env.VERCEL_URL || "").toLowerCase()) {
    const config = readEnvironment("V4_PREVIEW_SUPABASE", "preview", true);
    if (!config) return send(res, 503, {error: "isolated_preview_configuration_unavailable"});
    return send(res, 200, config);
  }

  return send(res, 404, {error: "configuration_unavailable"});
};
