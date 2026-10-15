// Jarvis on Vercel: streams a Claude answer for the chat, the morning briefing and the weekly review.
import Anthropic from "@anthropic-ai/sdk";
import { handle, requireSession, env, HttpError } from "./_lib.js";

const MAX_INPUT_CHARS = 200_000;

export default handle(async (req, res) => {
  requireSession(req);
  if (req.method !== "POST") throw new HttpError(405, "bad_request", "Methode nicht erlaubt.");
  if (!env("ANTHROPIC_API_KEY")) throw new HttpError(503, "ai_not_configured", "ANTHROPIC_API_KEY fehlt in Vercel.");
  const input = req.body && req.body.input;
  const messages = typeof input === "string" ? [{ role: "user", content: input }]
    : Array.isArray(input) ? input.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content })) : [];
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new HttpError(400, "bad_request", "Leere Anfrage.");
  if (JSON.stringify(messages).length > MAX_INPUT_CHARS) throw new HttpError(413, "bad_request", "Anfrage zu groß.");

  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") res.write(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") res.write("\n\nJarvis kann darauf nicht antworten.");
    else if (final.stop_reason === "max_tokens") res.write("\n\n(Antwort gekürzt)");
  } catch (e) {
    console.error("ask failed", e && e.status, e && e.message);
    const msg = e instanceof Anthropic.AuthenticationError ? "Der Anthropic-Schlüssel ist ungültig."
      : e instanceof Anthropic.RateLimitError ? "Gerade zu viele Anfragen. Versuch es in einer Minute erneut."
      : e instanceof Anthropic.APIError ? `Claude-Fehler ${e.status}.` : "Jarvis konnte gerade nicht antworten.";
    if (!res.headersSent) { res.statusCode = 502; }
    res.write(`\n\n${msg}`);
  }
  res.end();
});
