// Recently edited Notion pages and page content as Markdown, in the same shape as the claude.ai Notion connector.
import { handle, send, requireSession, env, HttpError } from "./_lib.js";

const NOTION = "https://api.notion.com/v1";
const MAX_BLOCKS = 300;

async function notion(path, init = {}) {
  if (!env("NOTION_TOKEN")) throw new HttpError(503, "notion_not_configured", "NOTION_TOKEN fehlt in Vercel.");
  const r = await fetch(NOTION + path, { ...init, headers: { Authorization: `Bearer ${env("NOTION_TOKEN")}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new HttpError(503, "notion_not_configured", "Der Notion-Schlüssel ist ungültig. Prüfe NOTION_TOKEN in Vercel.");
  if (r.status === 404) throw new HttpError(404, "notion_not_shared", "Diese Seite ist nicht mit der LifeOS-Integration geteilt. Öffne sie in Notion → ••• → Verbindungen → LifeOS.");
  if (r.status === 429) throw new HttpError(429, "server_unavailable", "Notion bremst gerade. Versuch es gleich noch einmal.");
  if (!r.ok) throw new HttpError(502, "tool_error", `Notion: ${j.message || r.status}`);
  return j;
}

export const plain = (rt) => (rt || []).map((t) => t.plain_text || "").join("");
export function richMd(rt) {
  return (rt || []).map((t) => {
    let s = t.plain_text || "";
    if (!s) return "";
    const a = t.annotations || {};
    if (a.code) s = "`" + s.replace(/`/g, "'") + "`";
    else { if (a.bold) s = `**${s}**`; if (a.italic) s = `*${s}*`; }
    const href = t.href || (t.text && t.text.link && t.text.link.url);
    if (href && /^https?:\/\//i.test(href)) s = `[${s}](${href})`;
    return s;
  }).join("");
}
export function titleOf(obj) {
  if (obj.object === "database") return plain(obj.title) || "Unbenannte Datenbank";
  const props = obj.properties || {};
  for (const k in props) if (props[k].type === "title") return plain(props[k].title) || "Unbenannt";
  return "Unbenannt";
}
const iconOf = (obj) => (obj.icon && obj.icon.type === "emoji" ? obj.icon.emoji : "");
const pageUrl = (id) => `https://www.notion.so/${String(id).replace(/-/g, "")}`;
export function idFrom(s) {
  const m = String(s || "").replace(/-/g, "").match(/([0-9a-f]{32})(?:\?|$|#)/i) || String(s || "").replace(/-/g, "").match(/([0-9a-f]{32})/i);
  if (!m) throw new HttpError(400, "bad_request", "Ungültige Notion-ID.");
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function blockToMd(b, depth = 0) {
  const ind = "  ".repeat(depth), d = b[b.type] || {};
  switch (b.type) {
    case "paragraph": return ind + richMd(d.rich_text);
    case "heading_1": return `# ${richMd(d.rich_text)}`;
    case "heading_2": return `## ${richMd(d.rich_text)}`;
    case "heading_3": return `### ${richMd(d.rich_text)}`;
    case "bulleted_list_item": case "toggle": return `${ind}- ${richMd(d.rich_text)}`;
    case "numbered_list_item": return `${ind}1. ${richMd(d.rich_text)}`;
    case "to_do": return `${ind}- [${d.checked ? "x" : " "}] ${richMd(d.rich_text)}`;
    case "quote": return `> ${richMd(d.rich_text)}`;
    case "callout": return `> ${d.icon && d.icon.emoji ? d.icon.emoji + " " : ""}${richMd(d.rich_text)}`;
    case "divider": return "---";
    case "code": return plain(d.rich_text).split("\n").map((l) => "`" + l.replace(/`/g, "'") + "`").join("\n");
    case "child_page": return `<page url="${pageUrl(b.id)}">${(d.title || "Seite").replace(/[<>]/g, "")}</page>`;
    case "child_database": return `<database url="${pageUrl(b.id)}">${(d.title || "Datenbank").replace(/[<>]/g, "")}</database>`;
    case "bookmark": case "embed": case "link_preview": return d.url ? `${ind}${d.url}` : "";
    case "image": case "video": case "file": case "pdf": return `${ind}[${b.type === "image" ? "Bild" : "Datei"}]`;
    case "table_row": return ind + (d.cells || []).map((c) => richMd(c)).join(" · ");
    case "equation": return ind + (d.expression || "");
    default: return "";
  }
}

async function children(id, budget) {
  const out = []; let cursor;
  do {
    const j = await notion(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    out.push(...j.results); cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && out.length < budget.left);
  budget.left -= out.length;
  return out;
}
async function pageMarkdown(id) {
  const budget = { left: MAX_BLOCKS }, lines = [];
  const walk = async (blocks, depth) => {
    for (const b of blocks) {
      lines.push(blockToMd(b, depth));
      const nest = b.has_children && depth < 2 && budget.left > 0 && !["child_page", "child_database", "synced_block"].includes(b.type);
      if (nest) await walk(await children(b.id, budget), b.type === "table" || b.type === "column_list" || b.type === "column" ? depth : depth + 1);
      if (["paragraph", "heading_1", "heading_2", "heading_3", "quote", "callout", "code", "divider"].includes(b.type)) lines.push("");
    }
  };
  await walk(await children(id, budget), 0);
  if (budget.left <= 0) lines.push("", "*Seite gekürzt – öffne sie in Notion für den Rest.*");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export default handle(async (req, res) => {
  requireSession(req);
  const q = req.query || {};
  if (q.op === "recent") {
    const n = Math.min(Math.max(parseInt(q.n, 10) || 3, 1), 10);
    const j = await notion("/search", { method: "POST", body: JSON.stringify({ sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: n * 2 }) });
    const results = (j.results || []).filter((o) => !o.archived && !o.in_trash).slice(0, n)
      .map((o) => ({ type: o.object === "database" ? "database" : "page", url: o.url || pageUrl(o.id), title: titleOf(o), icon: iconOf(o), edited: o.last_edited_time }));
    return send(res, 200, { results });
  }
  if (q.op === "fetch") {
    const id = idFrom(q.id);
    let obj;
    try { obj = await notion(`/pages/${id}`); }
    catch (e) { if (e.code !== "notion_not_shared") throw e; obj = await notion(`/databases/${id}`); }
    const md = obj.object === "database" ? "Das ist eine Datenbank. Öffne sie in Notion, um die Einträge zu sehen." : await pageMarkdown(id);
    return send(res, 200, {
      title: titleOf(obj), url: obj.url || pageUrl(id), icon: iconOf(obj) ? { type: "emoji", emoji: iconOf(obj) } : null,
      page_last_edited_at: obj.last_edited_time, text: `<content>\n${md}\n</content>`,
    });
  }
  throw new HttpError(400, "bad_request", "op fehlt.");
});
