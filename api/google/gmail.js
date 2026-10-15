// Latest Gmail threads and full thread text, in the same shape as the claude.ai Gmail connector.
import { handle, send, requireSession, googleGet, decodeEntities, htmlToText, HttpError } from "../_lib.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const header = (msg, name) => ((msg.payload && msg.payload.headers) || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
const viewUrl = (threadId) => `https://mail.google.com/mail/u/0/#all/${threadId}`;
const decodeB64 = (data) => Buffer.from(String(data || ""), "base64url").toString("utf8");

export function splitAddresses(s) {
  const out = []; let cur = "", q = false, angle = false;
  for (const ch of String(s || "")) {
    if (ch === '"') q = !q; else if (ch === "<") angle = true; else if (ch === ">") angle = false;
    if (ch === "," && !q && !angle) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function bodyText(payload) {
  let plain = null, html = null;
  (function walk(p) {
    if (!p) return;
    const mt = String(p.mimeType || "").toLowerCase();
    if (p.filename) return; // attachment
    if (mt === "text/plain" && p.body && p.body.data && plain == null) plain = decodeB64(p.body.data);
    else if (mt === "text/html" && p.body && p.body.data && html == null) html = decodeB64(p.body.data);
    (p.parts || []).forEach(walk);
  })(payload);
  if (plain != null && plain.trim()) return plain.replace(/\r\n/g, "\n");
  if (html != null) return htmlToText(html);
  return "";
}
function baseMessage(m) {
  return {
    id: m.id, threadId: m.threadId, sender: header(m, "From"), subject: header(m, "Subject"),
    toRecipients: splitAddresses(header(m, "To")), date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    labelIds: m.labelIds || [], snippet: decodeEntities(m.snippet || ""), viewUrl: viewUrl(m.threadId),
  };
}

export default handle(async (req, res) => {
  requireSession(req);
  const q = req.query || {};
  if (q.op === "list") {
    const n = Math.min(Math.max(parseInt(q.n, 10) || 3, 1), 10);
    const list = await googleGet(`${API}/threads?${new URLSearchParams({ q: String(q.q || "in:inbox").slice(0, 300), maxResults: String(n) })}`);
    const threads = await Promise.all((list.threads || []).map(async (t) => {
      const full = await googleGet(`${API}/threads/${encodeURIComponent(t.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const messages = (full.messages || []).map(baseMessage);
      return { id: t.id, messageCount: messages.length, viewUrl: viewUrl(t.id), messages };
    }));
    return send(res, 200, { threads, nextPageToken: list.nextPageToken || null });
  }
  if (q.op === "thread") {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(q.id || ""))) throw new HttpError(400, "bad_request", "Ungültige Thread-ID.");
    const full = await googleGet(`${API}/threads/${q.id}?format=full`);
    const messages = (full.messages || []).map((m) => ({ ...baseMessage(m), plaintextBody: bodyText(m.payload) }));
    return send(res, 200, { id: full.id, messages, viewUrl: viewUrl(full.id) });
  }
  throw new HttpError(400, "bad_request", "op fehlt.");
});
