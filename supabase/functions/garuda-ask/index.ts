// garuda-ask: Garuda Connect's voice answers. The app sends the question with the facts it already computed;
// Claude turns them into a short spoken answer and a follow-up question. Secret: ANTHROPIC_API_KEY
import { admin, caller, cors, getSetting, json } from "../_shared/util.ts";

const SYSTEM = `You are Garuda, the voice assistant inside Garuda Aerospace's sales CRM (drone pilot training, RPTO, and college Centres of Excellence in India).
You speak to the sales team. Answer in 2 to 4 short spoken sentences: no markdown, no lists, no emojis. Use Indian number words (lakh, crore) and names from the facts.
Use only the facts given. If they cannot answer the question, say what is missing in one sentence.
End with one short, useful follow-up question the person can answer with yes or no, unless the conversation is clearly finished.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  let stage = "start";
  try {
    stage = "caller";
    const who = await caller(req, db);
    const body = await req.json().catch(() => ({}));
    const ai = await getSetting<any>(db, "ai", { enabled: true, writer_model: "claude-sonnet-5-5" });
    if (ai.enabled === false) return json({ error: "Claude is switched off in Settings → Claude AI" }, 400);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY is not set in Supabase secrets" }, 400);
    const q = String(body.question || "").slice(0, 2000);
    const facts = String(body.facts || "").slice(0, 24000);
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    if (!q) return json({ error: "No question" }, 400);
    const messages: any[] = [];
    for (const h of history) { if (h?.q && h?.a) { messages.push({ role: "user", content: String(h.q).slice(0, 1000) }); messages.push({ role: "assistant", content: String(h.a).slice(0, 2000) }); } }
    messages.push({ role: "user", content: `Facts from the CRM right now:\n${facts}\n\nMy question: ${q}` });
    stage = "claude";
    const model = body.model || ai.voice_model || ai.writer_model || "claude-sonnet-5-5";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM + `\nYou are talking to ${body.name || "a team member"}. Today is ${new Date().toISOString().slice(0, 10)}.`, messages }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = `Claude API ${res.status}: ${out?.error?.message || JSON.stringify(out).slice(0, 300)}`;
      console.error("garuda-ask", msg);
      return json({ error: msg }, 400);
    }
    const answer = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ").trim();
    db.from("ai_runs").insert({ kind: "ask", model, input_tokens: out.usage?.input_tokens, output_tokens: out.usage?.output_tokens, result: { answer }, created_by: who.id }).then(() => {}, () => {});
    return json({ answer });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error("garuda-ask failed at", stage, msg);
    return json({ error: msg }, 400);
  }
});
