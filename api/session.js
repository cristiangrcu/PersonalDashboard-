// Login, logout and connection status for LifeOS.
import crypto from "node:crypto";
import { handle, send, env, kv, kvConfigured, issueSession, clearSession, hasSession, setupMissing, googleConfigured, GOOGLE_KEY, HttpError } from "./_lib.js";

const MAX_FAILS = 10, WINDOW_SEC = 15 * 60;

export default handle(async (req, res) => {
  if (req.method === "DELETE") { clearSession(res); return send(res, 200, { ok: true }); }

  const missing = setupMissing();
  if (missing.length) return send(res, 503, { code: "setup_required", missing });

  if (req.method === "POST") {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const failKey = `lifeos:loginfail:${crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16)}`;
    const fails = Number(await kv("GET", failKey)) || 0;
    if (fails >= MAX_FAILS) throw new HttpError(429, "rate_limited", "Zu viele Fehlversuche. Warte 15 Minuten.");
    const given = Buffer.from(String((req.body && req.body.password) || ""));
    const want = Buffer.from(env("APP_PASSWORD"));
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) {
      await kv("INCR", failKey); await kv("EXPIRE", failKey, WINDOW_SEC);
      throw new HttpError(401, "wrong_password", "Falsches Passwort.");
    }
    await kv("DEL", failKey);
    issueSession(res);
    return send(res, 200, { ok: true });
  }

  if (req.method !== "GET") throw new HttpError(405, "bad_request", "Methode nicht erlaubt.");
  if (!hasSession(req)) return send(res, 401, { code: "unauthorized" });
  const [g, hasData] = await Promise.all([kv("GET", GOOGLE_KEY), kv("EXISTS", "lifeos:meta:hasdata")]);
  send(res, 200, {
    ok: true,
    google: !googleConfigured() ? "not_configured" : g ? "connected" : "not_connected",
    notion: !!env("NOTION_TOKEN"),
    ai: !!env("ANTHROPIC_API_KEY"),
    yazio: !!(env("YAZIO_EMAIL") && env("YAZIO_PASSWORD") && env("YAZIO_CLIENT_ID") && env("YAZIO_CLIENT_SECRET")),
    empty: !hasData,
    db: kvConfigured(),
  });
});
