// Finishes the Google OAuth flow and stores the refresh token server-side.
import crypto from "node:crypto";
import { handle, requireSession, cookies, setCookie, env, origin, kvGetJson, kvSetJson, GOOGLE_KEY, HttpError } from "../_lib.js";

function back(res, status) {
  res.statusCode = 302; res.setHeader("Location", `/?google=${status}`); res.setHeader("Cache-Control", "no-store"); res.end();
}

export default handle(async (req, res) => {
  requireSession(req);
  const q = req.query || {};
  const want = cookies(req).lifeos_gs || "";
  setCookie(res, "lifeos_gs", "", 0);
  const got = String(q.state || "");
  if (!want || want.length !== got.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) throw new HttpError(400, "bad_request", "Ungültige Anmeldung. Starte „Mit Google verbinden“ erneut.");
  if (q.error) return back(res, "denied");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: String(q.code || ""), client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: `${origin(req)}/api/google/callback`, grant_type: "authorization_code" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("google token exchange failed", j.error); return back(res, "error"); }
  const scope = String(j.scope || "");
  if (!scope.includes("gmail.readonly") || !scope.includes("calendar.readonly")) return back(res, "missing_scope");
  const prev = (await kvGetJson(GOOGLE_KEY)) || {};
  await kvSetJson(GOOGLE_KEY, { refresh_token: j.refresh_token || prev.refresh_token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, scope, connected_at: new Date().toISOString() });
  back(res, "connected");
});
