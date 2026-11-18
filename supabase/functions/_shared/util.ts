// Shared helpers for Garuda CRM edge functions (Deno)
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Resolve the signed-in CRM user from the request, or a cron call carrying CRON_SECRET. */
export async function caller(req: Request, db: SupabaseClient): Promise<{ id: string | null; role: string; cron: boolean }> {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") === secret) return { id: null, role: "system", cron: true };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Not signed in");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Not signed in");
  // v4: people are listed in profiles before they sign in; auth_id links the sign-in to the person
  const { data: p } = await db.from("profiles").select("id, role, active").eq("auth_id", data.user.id).maybeSingle();
  if (!p || !p.active) throw new Error("Your email isn't registered in Garuda CRM. Ask your manager to add you.");
  return { id: p.id, role: p.role, cron: false };
}

export async function getSetting<T = any>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

export const digits10 = (p?: string | null) => (p || "").replace(/\D/g, "").slice(-10);

export const daysBetween = (a: string | Date, b: Date = new Date()) =>
  Math.floor((b.getTime() - new Date(a).getTime()) / 86400000);

export const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

/**
 * Call Claude with a single forced tool so the answer always comes back as structured JSON.
 * Docs: https://docs.claude.com/en/api/messages
 */
export async function claudeTool<T>(opts: {
  model: string;
  system: string;
  prompt: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}): Promise<{ result: T; usage: { input_tokens: number; output_tokens: number } }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Supabase secrets");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1500,
      system: opts.system,
      tools: [opts.tool],
      tool_choice: { type: "tool", name: opts.tool.name },
      messages: [{ role: "user", content: opts.prompt }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || JSON.stringify(body)}`);
  const block = (body.content || []).find((c: any) => c.type === "tool_use");
  if (!block) throw new Error("Claude returned no structured result");
  return { result: block.input as T, usage: body.usage };
}

/** Merge tags used in templates: {{first_name}}, {{name}}, {{institution}}, {{product}}, {{price}}, ... */
export function renderTemplate(tpl: string, vars: Record<string, string | number | undefined | null>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => {
    const v = vars[k.toLowerCase()];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** True when the signed-in user may see this lead (checked through RLS with their own token). */
export async function userCanSeeLead(req: Request, leadId: string): Promise<boolean> {
  const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") || "" } }, auth: { persistSession: false },
  });
  const { data } = await uc.from("leads").select("id").eq("id", leadId).maybeSingle();
  return !!data;
}

/** active department codes (managed in Settings → Departments) */
export async function departments(db: SupabaseClient): Promise<{ code: string; has_admissions: boolean }[]> {
  const { data } = await db.from("departments").select("code, has_admissions, active").eq("active", true).order("ord");
  return (data || []) as any;
}
