// Shared helpers for the LifeOS Vercel functions: sessions, Redis, Google tokens, JSON replies.
import crypto from "node:crypto";

export const env = (k) => (process.env[k] || "").trim();
const kvUrl = () => env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const kvToken = () => env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { code: e.code, message: e.message });
      console.error(e);
      send(res, 500, { code: "upstream_error", message: "Interner Fehler. Prüfe die Funktions-Logs in Vercel." });
    }
  };
}

// ---------- Redis (Upstash REST) ----------
export function kvConfigured() { return !!(kvUrl() && kvToken()); }
export async function kv(...cmd) {
  if (!kvConfigured()) throw new HttpError(503, "setup_required", "Datenbank fehlt: Upstash Redis ist nicht mit dem Projekt verbunden.");
  const r = await fetch(kvUrl(), { method: "POST", headers: { Authorization: `Bearer ${kvToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Redis ${cmd[0]} failed: ${j.error || r.status}`);
  return j.result;
}
export async function kvPipeline(cmds) {
  if (!cmds.length) return [];
  if (!kvConfigured()) throw new HttpError(503, "setup_required", "Datenbank fehlt.");
  const r = await fetch(kvUrl().replace(/\/$/, "") + "/pipeline", { method: "POST", headers: { Authorization: `Bearer ${kvToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error(`Redis pipeline failed: ${r.status}`);
  return j.map((x) => { if (x.error) throw new Error(`Redis error: ${x.error}`); return x.result; });
}
export async function kvGetJson(key) { const v = await kv("GET", key); return v == null ? null : JSON.parse(v); }
export async function kvSetJson(key, val) { return kv("SET", key, JSON.stringify(val)); }

// ---------- Cookies & sessions ----------
export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res, name, value, maxAgeSec) {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
}
function sessionKey() {
  // Derived server-side so no extra secret has to be handled by hand; changing the password ends all sessions.
  return env("SESSION_SECRET") || crypto.createHash("sha256").update(`lifeos-session|${kvToken()}|${env("APP_PASSWORD")}`).digest("hex");
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payload) => crypto.createHmac("sha256", sessionKey()).update(payload).digest("base64url");
export const SESSION_DAYS = 30;
export function issueSession(res) {
  const payload = b64u(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5 }));
  setCookie(res, "lifeos_s", `${payload}.${sign(payload)}`, SESSION_DAYS * 86400);
}
export function clearSession(res) { setCookie(res, "lifeos_s", "", 0); }
export function hasSession(req) {
  if (!env("APP_PASSWORD")) return false;
  const raw = cookies(req).lifeos_s || "";
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return false;
  const want = Buffer.from(sign(payload)), got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); } catch { return false; }
}
export function setupMissing() {
  const missing = [];
  if (!kvConfigured()) missing.push("database");
  if (!env("APP_PASSWORD")) missing.push("APP_PASSWORD");
  return missing;
}
export function requireSession(req) {
  const missing = setupMissing();
  if (missing.length) throw new HttpError(503, "setup_required", `Einrichtung fehlt: ${missing.join(", ")}`);
  if (!hasSession(req)) throw new HttpError(401, "unauthorized", "Bitte melde dich an.");
}
export function requireMethod(req, ...methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, "bad_request", "Methode nicht erlaubt.");
}
export function origin(req) {
  if (env("APP_URL")) return env("APP_URL").replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

// ---------- Google OAuth tokens ----------
export const GOOGLE_KEY = "lifeos:google";
export function googleConfigured() { return !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")); }
export async function googleToken() {
  if (!googleConfigured()) throw new HttpError(503, "google_not_configured", "Google ist noch nicht eingerichtet.");
  const g = await kvGetJson(GOOGLE_KEY);
  if (!g || !g.refresh_token) throw new HttpError(409, "google_not_connected", "Google ist nicht verbunden.");
  if (g.access_token && g.expires_at > Date.now() + 60e3) return g.access_token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: g.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") { await kv("DEL", GOOGLE_KEY); throw new HttpError(409, "google_not_connected", "Die Google-Anmeldung ist abgelaufen. Verbinde Google neu."); }
    throw new HttpError(502, "server_unavailable", "Google hat die Anmeldung nicht erneuert.");
  }
  await kvSetJson(GOOGLE_KEY, { ...g, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}
export async function googleGet(url) {
  const token = await googleToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { throw new HttpError(409, "google_not_connected", "Google hat den Zugriff abgelehnt. Verbinde Google neu."); }
  if (r.status === 403) throw new HttpError(403, "tool_error", `Google: ${(j.error && j.error.message) || "keine Berechtigung"}. Verbinde Google neu und setze alle Häkchen.`);
  if (!r.ok) throw new HttpError(r.status >= 500 ? 502 : 400, r.status >= 500 ? "server_unavailable" : "tool_error", `Google: ${(j.error && j.error.message) || r.status}`);
  return j;
}

// ---------- text helpers ----------
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  euro: "€", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", sbquo: "‚",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•", deg: "°", times: "×",
};
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}
export function htmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => { const txt = t.replace(/<[^>]+>/g, "").trim(); return /^https?:/i.test(href) && txt !== href ? `${txt} <${href}>` : txt; })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n").replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
