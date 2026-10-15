// Starts the Google OAuth flow for Calendar and Gmail (read-only).
import crypto from "node:crypto";
import { handle, requireSession, googleConfigured, env, origin, setCookie, HttpError } from "../_lib.js";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/gmail.readonly"];

export default handle(async (req, res) => {
  requireSession(req);
  if (!googleConfigured()) throw new HttpError(503, "google_not_configured", "GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET fehlen in Vercel.");
  const state = crypto.randomBytes(24).toString("base64url");
  setCookie(res, "lifeos_gs", state, 600);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: `${origin(req)}/api/google/callback`, response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  }).toString();
  res.statusCode = 302; res.setHeader("Location", url.toString()); res.setHeader("Cache-Control", "no-store"); res.end();
});
