// Yazio food diary for LifeOS via Yazio's undocumented app API (read-only).
// Not an official interface: Yazio can change it at any time.
import { handle, send, requireSession, env, kv, kvGetJson, kvSetJson, kvPipeline, HttpError } from "./_lib.js";

const BASE = "https://yzapi.yazio.com/v20";
const TOKEN_KEY = "lifeos:yazio:token";
const PRODUCT_KEY = (id) => `lifeos:yazio:p:${id}`;
const RECIPE_KEY = (id) => `lifeos:yazio:r:${id}`;
const MEALS = ["breakfast", "lunch", "dinner", "snack"];

export function yazioConfigured() {
  return !!(env("YAZIO_EMAIL") && env("YAZIO_PASSWORD") && env("YAZIO_CLIENT_ID") && env("YAZIO_CLIENT_SECRET"));
}

async function tokenRequest(fields) {
  const body = { client_id: env("YAZIO_CLIENT_ID"), client_secret: env("YAZIO_CLIENT_SECRET"), ...fields };
  // The app API has accepted both encodings over time; try form first, then JSON.
  let r = await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  if (r.status === 400 || r.status === 415) r = await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return null;
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
}

let inflight = null;
function yazioToken(force) {
  // Parallel requests share one login instead of each starting their own.
  if (!inflight) inflight = loadToken(force).finally(() => { inflight = null; });
  return inflight;
}
async function loadToken(force) {
  if (!yazioConfigured()) throw new HttpError(503, "yazio_not_configured", "Yazio ist noch nicht eingerichtet.");
  const t = force ? null : await kvGetJson(TOKEN_KEY);
  if (t && t.access_token && t.expires_at > Date.now() + 60e3) return t.access_token;
  let next = t && t.refresh_token ? await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token }) : null;
  if (!next) next = await tokenRequest({ grant_type: "password", username: env("YAZIO_EMAIL"), password: env("YAZIO_PASSWORD") });
  if (!next) { await kv("DEL", TOKEN_KEY); throw new HttpError(502, "yazio_auth_failed", "Yazio-Anmeldung fehlgeschlagen. Prüfe YAZIO_EMAIL, YAZIO_PASSWORD und die Client-Daten in Vercel."); }
  await kvSetJson(TOKEN_KEY, next);
  return next.access_token;
}

async function yget(path, retried) {
  const token = await yazioToken(false);
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 && !retried) { await yazioToken(true); return yget(path, true); }
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, r.status >= 500 ? "server_unavailable" : "tool_error", `Yazio antwortet nicht wie erwartet (${r.status}).`);
  return r.status === 204 ? null : r.json();
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
export function basic(n) {
  return { kcal: num(n && n["energy.energy"]), protein: num(n && n["nutrient.protein"]), carb: num(n && n["nutrient.carb"]), fat: num(n && n["nutrient.fat"]) };
}

async function cachedMany(ids, keyFn, fetchOne) {
  if (!ids.length) return {};
  const cached = await kv("MGET", ...ids.map(keyFn));
  const out = {}, missing = [];
  ids.forEach((id, i) => { if (cached[i]) out[id] = JSON.parse(cached[i]); else missing.push(id); });
  const fetched = await Promise.all(missing.slice(0, 40).map(async (id) => [id, await fetchOne(id).catch(() => null)]));
  const writes = [];
  for (const [id, val] of fetched) if (val) { out[id] = val; writes.push(["SET", keyFn(id), JSON.stringify(val), "EX", 60 * 60 * 24 * 30]); }
  if (writes.length) await kvPipeline(writes);
  return out;
}

export function buildDiary(date, summary, consumed, products, recipes) {
  const meals = Object.fromEntries(MEALS.map((m) => [m, { kcal: 0, protein: 0, carb: 0, fat: 0, items: [] }]));
  const sm = (summary && summary.meals) || {};
  for (const m of MEALS) Object.assign(meals[m], basic(sm[m] && sm[m].nutrients));
  const c = consumed || {};
  for (const it of c.products || []) {
    const p = products[it.product_id];
    const per = p ? p.per : null;
    const amount = num(it.amount);
    const label = it.serving && it.serving_quantity ? `${round(it.serving_quantity, 2)} × ${it.serving}` : `${round(amount)} ${p && p.unit ? p.unit : "g"}`;
    (meals[it.daytime] || meals.snack).items.push({ name: p ? p.name : "Lebensmittel", amount: label, kcal: per ? round(per.kcal * amount) : null, protein: per ? round(per.protein * amount, 1) : null });
  }
  for (const it of c.recipe_portions || []) {
    const r = recipes[it.recipe_id];
    (meals[it.daytime] || meals.snack).items.push({ name: r ? r.name : "Rezept", amount: `${round(num(it.portion_count), 2)} Portion(en)`, kcal: null, protein: null });
  }
  for (const it of c.simple_products || []) {
    const b = basic(it.nutrients);
    (meals[it.daytime] || meals.snack).items.push({ name: it.name || "Eintrag", amount: "", kcal: round(b.kcal), protein: round(b.protein, 1) });
  }
  const totals = MEALS.reduce((t, m) => ({ kcal: t.kcal + meals[m].kcal, protein: t.protein + meals[m].protein, carb: t.carb + meals[m].carb, fat: t.fat + meals[m].fat }), { kcal: 0, protein: 0, carb: 0, fat: 0 });
  const g = (summary && summary.goals) || {};
  for (const m of MEALS) for (const k of ["kcal", "protein", "carb", "fat"]) meals[m][k] = round(meals[m][k], k === "kcal" ? 0 : 1);
  return {
    date,
    totals: { kcal: round(totals.kcal), protein: round(totals.protein, 1), carb: round(totals.carb, 1), fat: round(totals.fat, 1) },
    goals: { kcal: round(num(g["energy.energy"])), protein: round(num(g["nutrient.protein"])), carb: round(num(g["nutrient.carb"])), fat: round(num(g["nutrient.fat"])), water: round(num(g.water)), steps: round(num(g["activity.step"])) },
    water_ml: round(num(summary && summary.water_intake)),
    steps: round(num(summary && summary.steps)),
    activity_kcal: round(num(summary && summary.activity_energy)),
    unit_energy: (summary && summary.units && summary.units.unit_energy) || "kcal",
    meals,
  };
}

export default handle(async (req, res) => {
  requireSession(req);
  const date = String((req.query && req.query.date) || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "bad_request", "Ungültiges Datum.");
  const [summary, consumed] = await Promise.all([yget(`/user/widgets/daily-summary?date=${date}`), yget(`/user/consumed-items?date=${date}`)]);
  const productIds = [...new Set(((consumed && consumed.products) || []).map((p) => p.product_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  const recipeIds = [...new Set(((consumed && consumed.recipe_portions) || []).map((p) => p.recipe_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  const [products, recipes] = await Promise.all([
    cachedMany(productIds, PRODUCT_KEY, async (id) => { const p = await yget(`/products/${id}`); return p ? { name: p.name, unit: p.base_unit, per: basic(p.nutrients) } : null; }),
    cachedMany(recipeIds, RECIPE_KEY, async (id) => { const r = await yget(`/recipes/${id}`); return r ? { name: r.name } : null; }),
  ]);
  send(res, 200, buildDiary(date, summary, consumed, products, recipes));
});
