// Upcoming events from the primary Google Calendar, in the same shape as the claude.ai connector.
import { handle, send, requireSession, googleGet, HttpError } from "../_lib.js";

export default handle(async (req, res) => {
  requireSession(req);
  const { start, end } = req.query || {};
  const t0 = new Date(String(start || "")), t1 = new Date(String(end || ""));
  if (isNaN(t0) || isNaN(t1) || t1 <= t0 || t1 - t0 > 62 * 864e5) throw new HttpError(400, "bad_request", "Ungültiger Zeitraum.");
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.search = new URLSearchParams({ timeMin: t0.toISOString(), timeMax: t1.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" }).toString();
  const j = await googleGet(url.toString());
  send(res, 200, { events: (j.items || []).filter((e) => e.status !== "cancelled"), timeZone: j.timeZone });
});
