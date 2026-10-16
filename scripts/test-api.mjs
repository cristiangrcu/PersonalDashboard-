// Offline tests for the LifeOS API functions: Redis, Google and Notion are replaced by an in-memory fake fetch.
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://kv.test";
process.env.KV_REST_API_TOKEN = "kv-token";
process.env.APP_PASSWORD = "correct horse";
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.NOTION_TOKEN = "ntn";
process.env.YAZIO_EMAIL = "me@x.de";
process.env.YAZIO_PASSWORD = "ypw";
process.env.YAZIO_CLIENT_ID = "ycid";
process.env.YAZIO_CLIENT_SECRET = "ycs";
let yazioTokenCalls = 0;

// ---------- fake Redis ----------
const store = new Map(), sets = new Map();
function redis([cmd, ...a]) {
  switch (cmd) {
    case "GET": return store.get(a[0]) ?? null;
    case "SET": store.set(a[0], a[1]); return "OK";
    case "DEL": return store.delete(a[0]) ? 1 : 0;
    case "EXISTS": return store.has(a[0]) ? 1 : 0;
    case "INCR": { const v = (Number(store.get(a[0])) || 0) + 1; store.set(a[0], String(v)); return v; }
    case "EXPIRE": return 1;
    case "SADD": { const s = sets.get(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); sets.set(a[0], s); return 1; }
    case "SREM": { const s = sets.get(a[0]); if (s) a.slice(1).forEach((x) => s.delete(x)); return 1; }
    case "SMEMBERS": return [...(sets.get(a[0]) || [])];
    case "MGET": return a.map((k) => store.get(k) ?? null);
    default: throw new Error("unsupported redis cmd " + cmd);
  }
}
const b64 = (s) => Buffer.from(s).toString("base64url");
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); calls.push(url);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (url === "https://kv.test") return json(200, { result: redis(JSON.parse(init.body)) });
  if (url === "https://kv.test/pipeline") return json(200, JSON.parse(init.body).map((c) => ({ result: redis(c) })));
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const p = new URLSearchParams(init.body);
    if (p.get("grant_type") === "authorization_code") return json(200, { access_token: "at1", refresh_token: "rt1", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly" });
    return json(200, { access_token: "at2", expires_in: 3600 });
  }
  if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) return json(200, { items: [{ id: "e1", summary: "Vorlesung", status: "confirmed", start: { dateTime: "2026-10-15T10:00:00+02:00" }, end: { dateTime: "2026-10-15T12:00:00+02:00" } }, { id: "e2", status: "cancelled" }] });
  if (url.includes("/gmail/v1/users/me/threads?")) return json(200, { threads: [{ id: "t1abcdef" }] });
  if (url.includes("/gmail/v1/users/me/threads/t1abcdef?format=metadata")) return json(200, { messages: [{ id: "m1", threadId: "t1abcdef", internalDate: "1792060334000", labelIds: ["UNREAD", "INBOX"], snippet: "Hallo &amp; tsch&#252;ss f&uuml;r &Auml;rger", payload: { headers: [{ name: "From", value: "Anna <anna@x.de>" }, { name: "To", value: '"Grecu, C." <c@x.de>, max@x.de' }, { name: "Subject", value: "Termin" }] } }] });
  if (url.includes("/gmail/v1/users/me/threads/t1abcdef?format=full")) return json(200, { id: "t1abcdef", messages: [{ id: "m1", threadId: "t1abcdef", internalDate: "1792060334000", labelIds: [], snippet: "x", payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Anna <anna@x.de>" }], parts: [{ mimeType: "text/html", body: { data: b64("<p>Hallo<br>Welt</p>") } }, { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "x" } }] } }] });
  if (url === "https://api.notion.com/v1/search") return json(200, { results: [{ object: "page", id: "aaaa", url: "https://www.notion.so/Skills-a3311068c040c83c4bcb301700763c9f", icon: { type: "emoji", emoji: "💻" }, last_edited_time: "2026-10-14T10:00:00Z", properties: { Name: { type: "title", title: [{ plain_text: "Skills" }] } } }] });
  if (url === "https://api.notion.com/v1/pages/a3311068-c040-c83c-4bcb-301700763c9f") return json(200, { object: "page", id: "a3311068-c040-c83c-4bcb-301700763c9f", url: "https://www.notion.so/Skills", last_edited_time: "2026-10-14T10:00:00Z", properties: { Name: { type: "title", title: [{ plain_text: "Skills" }] } } });
  if (url.startsWith("https://api.notion.com/v1/blocks/a3311068-c040-c83c-4bcb-301700763c9f/children")) return json(200, { has_more: false, results: [
    { id: "b1", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Ziele" }] } },
    { id: "b2", type: "to_do", to_do: { checked: true, rich_text: [{ plain_text: "HTML", annotations: { bold: true } }] } },
    { id: "b3", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Link", href: "https://x.com" }] } },
    { id: "b4", type: "child_database", child_database: { title: "Ideen" } },
  ] });
  if (url.startsWith("https://api.notion.com/v1/pages/")) return json(404, { message: "not found" });
  if (url === "https://yzapi.yazio.com/v20/oauth/token") { yazioTokenCalls++; const p = new URLSearchParams(init.body); assert.equal(p.get("client_id"), "ycid"); return json(200, { access_token: "yat" + yazioTokenCalls, refresh_token: "yrt", expires_in: 3600 }); }
  if (url.startsWith("https://yzapi.yazio.com/v20/user/widgets/daily-summary?date=2026-10-15")) { assert.match(init.headers.Authorization, /^Bearer yat/); return json(200, { steps: 4200, water_intake: 1500, activity_energy: 120, goals: { "energy.energy": 2400, "nutrient.protein": 140, "nutrient.carb": 250, "nutrient.fat": 80, water: 2500, "activity.step": 8000 }, units: { unit_energy: "kcal" }, meals: { breakfast: { nutrients: { "energy.energy": 450.4, "nutrient.protein": 30.25, "nutrient.carb": 50, "nutrient.fat": 12 } }, lunch: { nutrients: { "energy.energy": 700, "nutrient.protein": 40, "nutrient.carb": 80, "nutrient.fat": 20 } }, dinner: { nutrients: {} }, snack: { nutrients: { "energy.energy": 100 } } } }); }
  if (url.startsWith("https://yzapi.yazio.com/v20/user/consumed-items?date=2026-10-15")) return json(200, { products: [{ id: "c1", daytime: "breakfast", product_id: "11111111-1111-1111-1111-111111111111", amount: 200, serving: "portion", serving_quantity: 1 }, { id: "c2", daytime: "lunch", product_id: "22222222-2222-2222-2222-222222222222", amount: 150, serving: null, serving_quantity: null }], recipe_portions: [{ id: "c3", daytime: "dinner", recipe_id: "33333333-3333-3333-3333-333333333333", portion_count: 1 }], simple_products: [{ id: "c4", daytime: "snack", name: "Riegel", nutrients: { "energy.energy": 100, "nutrient.protein": 10 } }] });
  if (url === "https://yzapi.yazio.com/v20/products/11111111-1111-1111-1111-111111111111") return json(200, { name: "Haferflocken", base_unit: "g", nutrients: { "energy.energy": 3.7, "nutrient.protein": 0.13 } });
  if (url === "https://yzapi.yazio.com/v20/products/22222222-2222-2222-2222-222222222222") return json(200, { name: "Reis", base_unit: "g", nutrients: { "energy.energy": 1.3, "nutrient.protein": 0.027 } });
  if (url === "https://yzapi.yazio.com/v20/recipes/33333333-3333-3333-3333-333333333333") return json(200, { name: "Pasta Bolognese" });
  throw new Error("unexpected fetch " + url);
};

// ---------- fake req/res ----------
function mkRes() {
  const r = { statusCode: 200, headers: {}, body: "", headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
    write(s) { this.body += s; this.headersSent = true; }, end(s) { if (s) this.body += s; this.ended = true; } };
  return r;
}
async function call(mod, { method = "GET", query = {}, body, cookie = "" } = {}) {
  const res = mkRes();
  await mod.default({ method, query, body, headers: { cookie, host: "lifeos.test", "x-forwarded-for": "1.2.3.4" } }, res);
  let json = null; try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, res };
}
const cookieFrom = (res) => [].concat(res.getHeader("set-cookie") || []).map((c) => c.split(";")[0]).join("; ");

const session = await import("../api/session.js");
const db = await import("../api/db.js");
const gLogin = await import("../api/google/login.js");
const gCb = await import("../api/google/callback.js");
const cal = await import("../api/google/calendar.js");
const gmail = await import("../api/google/gmail.js");
const notion = await import("../api/notion.js");
let n = 0; const ok = (m) => { n++; console.log("ok -", m); };

// every protected route rejects without a session
for (const [name, mod, q] of [["db", db, { doc: "a/b" }], ["calendar", cal, {}], ["gmail", gmail, { op: "list" }], ["notion", notion, { op: "recent" }], ["google login", gLogin, {}]]) {
  const r = await call(mod, { query: q }); assert.equal(r.status, 401, name); assert.equal(r.json.code, "unauthorized");
}
ok("protected routes return 401 without session");

// login
assert.equal((await call(session, { method: "POST", body: { password: "wrong" } })).status, 401);
const login = await call(session, { method: "POST", body: { password: "correct horse" } });
assert.equal(login.status, 200);
const C = cookieFrom(login.res);
assert.match(C, /^lifeos_s=/);
const tampered = C.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
assert.equal((await call(session, { cookie: tampered })).status, 401);
const st = await call(session, { cookie: C });
assert.equal(st.status, 200); assert.equal(st.json.google, "not_connected"); assert.equal(st.json.empty, true);
ok("login, tampered cookie rejected, status endpoint");

// rate limit
for (let i = 0; i < 12; i++) await call(session, { method: "POST", body: { password: "nope" } });
assert.equal((await call(session, { method: "POST", body: { password: "correct horse" } })).status, 429);
store.forEach((_, k) => { if (k.startsWith("lifeos:loginfail:")) store.delete(k); });
ok("login rate limit after repeated failures");

// db
assert.equal((await call(db, { cookie: C, query: { doc: "../x" } })).status, 400);
assert.equal((await call(db, { cookie: C, query: { doc: "days" } })).status, 400);
assert.equal((await call(db, { cookie: C, method: "PUT", query: { doc: "days/2026-10-15" }, body: { date: "2026-10-15", water: 500 } })).status, 200);
await call(db, { cookie: C, method: "PUT", query: { doc: "days/2026-01-01" }, body: { date: "2026-01-01" } });
let col = await call(db, { cookie: C, query: { collection: "days", where: JSON.stringify([["date", ">=", "2026-08-01"]]) } });
assert.deepEqual(col.json.docs.map((d) => d.id), ["2026-10-15"]);
assert.equal((await call(db, { cookie: C, query: { doc: "days/2026-10-15" } })).json.data.water, 500);
await call(db, { cookie: C, method: "DELETE", query: { doc: "days/2026-10-15" } });
col = await call(db, { cookie: C, query: { collection: "days" } });
assert.deepEqual(col.json.docs.map((d) => d.id), ["2026-01-01"]);
assert.equal((await call(db, { cookie: C, method: "PUT", query: { doc: "a/b" }, body: { x: "y".repeat(300000) } })).status, 413);
assert.equal((await call(db, { cookie: C, method: "POST", query: { import: "1" }, body: { data: { "goals/g1": { title: "x" } } } })).status, 409);
ok("db path checks, write/read/filter/delete, size limit, import blocked when data exists");

// google oauth
const gl = await call(gLogin, { cookie: C });
assert.equal(gl.status, 302);
const loc = new URL(gl.res.getHeader("location"));
assert.equal(loc.searchParams.get("redirect_uri"), "https://lifeos.test/api/google/callback");
const state = loc.searchParams.get("state");
const C2 = C + "; " + cookieFrom(gl.res);
assert.equal((await call(gCb, { cookie: C2, query: { state: "wrong-state-wrong-state-wrong-st", code: "c" } })).status, 400);
const cb = await call(gCb, { cookie: C2, query: { state, code: "c" } });
assert.equal(cb.status, 302); assert.equal(cb.res.getHeader("location"), "/?google=connected");
assert.equal(JSON.parse(store.get("lifeos:google")).refresh_token, "rt1");
ok("google oauth state check and token storage");

// calendar + gmail
const ev = await call(cal, { cookie: C, query: { start: "2026-10-15T00:00:00Z", end: "2026-10-22T00:00:00Z" } });
assert.equal(ev.status, 200); assert.deepEqual(ev.json.events.map((e) => e.id), ["e1"]);
const list = await call(gmail, { cookie: C, query: { op: "list", q: "in:inbox", n: "3" } });
const m = list.json.threads[0].messages[0];
assert.equal(m.sender, "Anna <anna@x.de>"); assert.equal(m.snippet, "Hallo & tschüss für Ärger"); assert.deepEqual(m.toRecipients, ['"Grecu, C." <c@x.de>', "max@x.de"]);
assert.ok(m.labelIds.includes("UNREAD"));
const th = await call(gmail, { cookie: C, query: { op: "thread", id: "t1abcdef" } });
assert.equal(th.json.messages[0].plaintextBody, "Hallo\nWelt");
assert.equal((await call(gmail, { cookie: C, query: { op: "thread", id: "../../x" } })).status, 400);
store.set("lifeos:google", JSON.stringify({ ...JSON.parse(store.get("lifeos:google")), expires_at: 0 }));
await call(cal, { cookie: C, query: { start: "2026-10-15T00:00:00Z", end: "2026-10-22T00:00:00Z" } });
assert.equal(JSON.parse(store.get("lifeos:google")).access_token, "at2");
ok("calendar shape, gmail list/thread decoding, token refresh");

// notion
const rec = await call(notion, { cookie: C, query: { op: "recent", n: "3" } });
assert.deepEqual(rec.json.results[0], { type: "page", url: "https://www.notion.so/Skills-a3311068c040c83c4bcb301700763c9f", title: "Skills", icon: "💻", edited: "2026-10-14T10:00:00Z" });
const pg = await call(notion, { cookie: C, query: { op: "fetch", id: rec.json.results[0].url } });
assert.equal(pg.status, 200, JSON.stringify(pg.json));
assert.match(pg.json.text, /## Ziele/); assert.match(pg.json.text, /- \[x\] \*\*HTML\*\*/); assert.match(pg.json.text, /\[Link\]\(https:\/\/x\.com\)/); assert.match(pg.json.text, /<database url="https:\/\/www\.notion\.so\/b4">Ideen<\/database>/);
ok("notion recent pages and markdown conversion");

// yazio
const yazio = await import("../api/yazio.js");
assert.equal((await call(yazio, { query: { date: "2026-10-15" } })).status, 401);
assert.equal((await call(yazio, { cookie: C, query: { date: "15.10.2026" } })).status, 400);
const yd = await call(yazio, { cookie: C, query: { date: "2026-10-15" } });
assert.equal(yd.status, 200, JSON.stringify(yd.json));
assert.deepEqual(yd.json.totals, { kcal: 1250, protein: 70.3, carb: 130, fat: 32 });
assert.equal(yd.json.goals.kcal, 2400); assert.equal(yd.json.water_ml, 1500);
assert.deepEqual(yd.json.meals.breakfast.items[0], { name: "Haferflocken", amount: "1 × portion", kcal: 740, protein: 26 });
assert.equal(yd.json.meals.lunch.items[0].amount, "150 g");
assert.equal(yd.json.meals.dinner.items[0].name, "Pasta Bolognese");
assert.equal(yd.json.meals.snack.items[0].kcal, 100);
const callsBefore = calls.length;
await call(yazio, { cookie: C, query: { date: "2026-10-15" } });
assert.ok(!calls.slice(callsBefore).some((u) => u.includes("/products/")), "products should come from cache");
assert.equal(yazioTokenCalls, 1, "token should be reused");
assert.equal((await call(session, { cookie: C })).json.yazio, true);
ok("yazio diary: auth, totals, items, product cache, token reuse");

// logout
const out = await call(session, { method: "DELETE", cookie: C });
assert.match(cookieFrom(out.res), /^lifeos_s=$/);
ok("logout clears cookie");
console.log(`\n${n} test groups passed`);
