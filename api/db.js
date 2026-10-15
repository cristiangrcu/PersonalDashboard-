// Document store for LifeOS on top of Redis: one key per document plus one set of ids per collection.
import { handle, send, kv, kvPipeline, requireSession, HttpError } from "./_lib.js";

const SEG = /^(?!\.\.?$)[A-Za-z0-9_\-.~:@+]{1,200}$/;
const MAX_DOC = 256 * 1024;
const docKey = (p) => `lifeos:doc:${p}`;
const colKey = (p) => `lifeos:col:${p}`;

export function checkPath(p, kind) {
  const segs = String(p || "").split("/");
  if (segs.length > 16 || segs.length < 1 || !segs.every((s) => SEG.test(s))) throw new HttpError(400, "invalid_argument", "Ungültiger Pfad.");
  const isDoc = segs.length % 2 === 0;
  if ((kind === "doc") !== isDoc) throw new HttpError(400, "invalid_argument", kind === "doc" ? "Pfad ist kein Dokument." : "Pfad ist keine Sammlung.");
  return { segs, parent: segs.slice(0, -1).join("/"), id: segs[segs.length - 1] };
}
function checkBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_argument", "Dokument muss ein Objekt sein.");
  const s = JSON.stringify(body);
  if (s.length > MAX_DOC) throw new HttpError(413, "invalid_argument", "Dokument ist zu groß.");
  return s;
}
export function matches(data, where) {
  return where.every(([f, op, v]) => {
    const x = data ? data[f] : undefined;
    if (x === undefined) return false;
    switch (op) { case "==": return x === v; case ">=": return x >= v; case "<=": return x <= v; case ">": return x > v; case "<": return x < v; default: return true; }
  });
}

export default handle(async (req, res) => {
  requireSession(req);
  const q = req.query || {};

  if (req.method === "POST" && q.import) {
    const data = (req.body && req.body.data) || {};
    if (await kv("EXISTS", "lifeos:meta:hasdata")) throw new HttpError(409, "conflict", "In der Cloud liegen schon Daten.");
    const entries = Object.entries(data).slice(0, 3000);
    const cmds = [];
    for (const [path, body] of entries) {
      const { parent, id } = checkPath(path, "doc");
      cmds.push(["SET", docKey(path), checkBody(body)], ["SADD", colKey(parent), id]);
    }
    cmds.push(["SET", "lifeos:meta:hasdata", "1"]);
    for (let i = 0; i < cmds.length; i += 200) await kvPipeline(cmds.slice(i, i + 200));
    return send(res, 200, { ok: true, imported: entries.length });
  }

  if (q.doc) {
    const { parent, id } = checkPath(q.doc, "doc");
    if (req.method === "GET") { const v = await kv("GET", docKey(q.doc)); return send(res, 200, v == null ? { exists: false } : { exists: true, data: JSON.parse(v) }); }
    if (req.method === "PUT") {
      const s = checkBody(req.body);
      await kvPipeline([["SET", docKey(q.doc), s], ["SADD", colKey(parent), id], ["SET", "lifeos:meta:hasdata", "1"]]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") { await kvPipeline([["DEL", docKey(q.doc)], ["SREM", colKey(parent), id]]); return send(res, 200, { ok: true }); }
    throw new HttpError(405, "bad_request", "Methode nicht erlaubt.");
  }

  if (q.collection && req.method === "GET") {
    checkPath(q.collection, "collection");
    let where = [];
    try { where = q.where ? JSON.parse(q.where) : []; } catch { throw new HttpError(400, "invalid_argument", "Ungültiger Filter."); }
    if (!Array.isArray(where) || where.length > 10) throw new HttpError(400, "invalid_argument", "Ungültiger Filter.");
    const ids = (await kv("SMEMBERS", colKey(q.collection))) || [];
    if (!ids.length) return send(res, 200, { docs: [] });
    const vals = [];
    for (let i = 0; i < ids.length; i += 500) vals.push(...(await kv("MGET", ...ids.slice(i, i + 500).map((id) => docKey(`${q.collection}/${id}`)))));
    const docs = [];
    ids.forEach((id, i) => { if (vals[i] == null) return; const data = JSON.parse(vals[i]); if (matches(data, where)) docs.push({ id, data }); });
    docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return send(res, 200, { docs });
  }

  throw new HttpError(400, "bad_request", "doc oder collection fehlt.");
});
