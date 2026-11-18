// ai: Claude-powered features for the Garuda CRM.
//
// POST /functions/v1/ai   { action: ... }
//   score        { lead_id }                 → score one lead from its remarks, quotes, emails and payments
//   score_batch  { limit? }                  → re-score leads with new activity (cron or Business Head)
//   draft        { lead_id, channel, purpose } → email / WhatsApp message written for this lead
//   brief        { institution_id }          → account brief for a college before a visit
//   ask          { question }                → answer a question about the CRM's numbers (Business Head)
//   daily        {}                          → lead-age automation, segments, re-scoring, digest (cron, 7:30 IST)
//
// Secrets: ANTHROPIC_API_KEY, CRON_SECRET

import { admin, caller, claudeTool, cors, daysBetween, getSetting, inr, json, renderTemplate, userCanSeeLead } from "../_shared/util.ts";

const SYSTEM = `You are the sales analyst inside Garuda Aerospace's CRM. Garuda is a DGCA-authorised drone maker and Remote Pilot Training Organisation (RPTO) in Chennai, India.
Two businesses: (1) RPTO: individual and bulk DGCA drone pilot courses (Small, Medium, Top-up, Train the Trainer), sold by telecallers and counsellors; (2) CoE: college partnerships (UAV labs, Dronistaan Day events, workshops, electives, FDPs, bulk training, RPTO partnerships), sold by field sales and a closer.
Rules: never promise jobs, placements or certification outcomes; fees must be disclosed with GST on the first counselling call; respect consent and opt-outs.
Be concrete and brief. Use Indian number formats (₹, lakh, crore). Write in plain English a busy salesperson can act on.`;

const SCORE_TOOL = {
  name: "record_lead_assessment",
  description: "Record the lead's score and the next best action.",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 0, maximum: 100, description: "Likelihood to convert in the next 30 days" },
      band: { type: "string", enum: ["Hot", "Warm", "Cold", "Dead"] },
      suggested_stage: { type: "string", description: "Stage the remarks actually support, from the funnel list given" },
      intent_signals: { type: "array", items: { type: "string" }, maxItems: 5 },
      objections: { type: "array", items: { type: "string" }, maxItems: 5 },
      risks: { type: "array", items: { type: "string" }, maxItems: 5, description: "Process or compliance risks, e.g. fee not disclosed, overdue follow-up, promise of placement" },
      next_best_action: { type: "string", description: "One specific action, who should do it, by when" },
      next_contact_by: { type: "string", description: "ISO date (YYYY-MM-DD)" },
      channel: { type: "string", enum: ["Call", "WhatsApp", "Email", "Visit", "Nurture"] },
      summary: { type: "string", description: "Two sentences: where this lead stands and why" },
    },
    required: ["score", "band", "next_best_action", "channel", "summary", "next_contact_by"],
  },
};

async function leadContext(db: any, leadId: string) {
  const { data: l } = await db.from("leads").select("*, products(name, price, gst_rate), institutions(name, city, kind, student_strength), owner_p:profiles!leads_owner_fkey(full_name, role)").eq("id", leadId).single();
  if (!l) throw new Error("Lead not found");
  const [{ data: rem }, { data: pd }, { data: pay }, { data: em }, { data: st }] = await Promise.all([
    db.from("remarks").select("created_at, channel, outcome, text, fee_disclosed, price_quoted, profiles!remarks_author_fkey(full_name)").eq("lead_id", leadId).order("created_at").limit(60),
    db.from("price_disclosures").select("disclosed_at, amount, response, qty").eq("lead_id", leadId).order("disclosed_at"),
    db.from("payments").select("paid_on, amount, status").eq("lead_id", leadId),
    db.from("email_queue").select("subject, category, sent_at, opened_at, replied_at, bounced_at").eq("lead_id", leadId).order("created_at").limit(20),
    db.from("stages").select("key, ord").eq("funnel", l.funnel).order("ord"),
  ]);
  const now = new Date();
  const lines = [
    `Lead ${l.lead_no} · funnel ${l.funnel} · current stage "${l.stage}" · temperature ${l.temperature}`,
    `Name: ${l.name}${l.institutions ? ` · institution ${l.institutions.name} (${l.institutions.city || ""}, ${l.institutions.kind || ""}, students ${l.institutions.student_strength ?? "?"})` : ""}`,
    `Product: ${l.products?.name || "not chosen"} · quoted value ${inr(l.value)} ex-GST · source ${l.source || "?"} · owner ${l.owner_p?.full_name || "unassigned"} (${l.owner_p?.role || ""})`,
    `Age ${daysBetween(l.created_at, now)} days · first contact ${l.first_contact_at ? daysBetween(l.first_contact_at, now) + " days ago" : "NEVER"} · last contact ${l.last_contact_at ? daysBetween(l.last_contact_at, now) + " days ago" : "never"} · next follow-up ${l.next_followup_at || "none"}`,
    `Fee disclosed: ${l.fee_disclosed ? "yes" : "no"} · eligible: ${l.eligible} · consent email ${l.consent_email} / WhatsApp ${l.consent_whatsapp} · opted out ${l.opted_out}`,
    `Funnel stages in order: ${(st || []).map((s: any) => s.key).join(" → ")}`,
    "",
    "Remarks (oldest first):",
    ...(rem || []).map((r: any) => `- ${r.created_at.slice(0, 16).replace("T", " ")} · ${r.profiles?.full_name || "?"} · ${r.channel} · ${r.outcome}${r.fee_disclosed ? " · fee disclosed" : ""}${r.price_quoted ? " · quoted " + inr(r.price_quoted) : ""}: ${r.text}`),
    (rem || []).length ? "" : "- none",
    "Price disclosures: " + ((pd || []).map((p: any) => `${p.disclosed_at.slice(0, 10)} ${inr(p.amount)} (${p.response || "no response noted"})`).join("; ") || "none"),
    "Payments: " + ((pay || []).map((p: any) => `${p.paid_on} ${inr(p.amount)} ${p.status}`).join("; ") || "none"),
    "Emails: " + ((em || []).map((e: any) => `${e.category} "${e.subject}" sent ${e.sent_at?.slice(0, 10) || "queued"}${e.opened_at ? " opened" : ""}${e.replied_at ? " REPLIED" : ""}${e.bounced_at ? " bounced" : ""}`).join("; ") || "none"),
    l.notes ? `Notes: ${l.notes}` : "",
  ];
  return { lead: l, text: lines.join("\n") };
}

async function scoreLead(db: any, leadId: string, model: string, by: string | null) {
  const { lead, text } = await leadContext(db, leadId);
  const { result, usage } = await claudeTool<any>({
    model, system: SYSTEM, tool: SCORE_TOOL, maxTokens: 900,
    prompt: `Score this lead and decide the next best action. Today is ${new Date().toISOString().slice(0, 10)}.
Scoring guide: 80-100 payment or PO is imminent; 60-79 strong intent, fee accepted, active dialogue; 35-59 interested but unresolved objections or slow replies; 10-34 little engagement, stale, no budget; 0-9 not eligible, not interested or opted out (band Dead).
Lower the score for no first contact, overdue follow-ups, or no reply after several attempts. Flag "fee not disclosed" as a risk for RPTO leads that were contacted without a fee disclosure.

${text}`,
  });
  await db.from("leads").update({
    ai_score: result.score, ai_band: result.band, ai_summary: result.summary, ai_next_action: result.next_best_action,
    ai_channel: result.channel, ai_scored_at: new Date().toISOString(), ai_dirty: false,
  }).eq("id", leadId);
  await db.from("ai_runs").insert({ kind: "score", lead_id: leadId, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, result, created_by: by });
  return { lead_no: lead.lead_no, ...result };
}

async function draft(db: any, leadId: string, channel: string, purpose: string, model: string, by: string | null) {
  const { lead, text } = await leadContext(db, leadId);
  const { data: batches } = await db.from("batches").select("course, centre, start_date, capacity").gte("start_date", new Date().toISOString().slice(0, 10)).order("start_date").limit(5);
  const tool = {
    name: "write_message",
    description: "Return the message to send.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Email subject (empty for WhatsApp)" },
        body: { type: "string", description: channel === "WhatsApp" ? "WhatsApp text, under 600 characters, no markdown" : "Email body in simple HTML paragraphs" },
        why: { type: "string", description: "One line on why this angle" },
      },
      required: ["subject", "body", "why"],
    },
  };
  const { result, usage } = await claudeTool<any>({
    model, system: SYSTEM, tool, maxTokens: 1200,
    prompt: `Write a ${channel} message for this lead. Purpose: ${purpose || "move to the next stage"}.
Use the facts in the remarks; address their objections; include the exact fee + GST if a product is chosen; propose one clear next step. Sign off as ${lead.owner_p?.full_name || "the Garuda team"}.
Upcoming batches: ${(batches || []).map((b: any) => `${b.course} at ${b.centre} from ${b.start_date}`).join("; ") || "none listed"}.

${text}`,
  });
  await db.from("ai_runs").insert({ kind: "draft", lead_id: leadId, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, result, created_by: by });
  return result;
}

async function brief(db: any, instId: string, model: string, by: string | null) {
  const { data: i } = await db.from("institutions").select("*").eq("id", instId).single();
  const [{ data: contacts }, { data: leads }, { data: visits }, { data: events }] = await Promise.all([
    db.from("contacts").select("name, designation, role_type, phone, email").eq("institution_id", instId),
    db.from("leads").select("id, lead_no, name, stage, value, products(name), updated_at").eq("institution_id", instId),
    db.from("visits").select("checkin_at, purpose, mom, outcome, next_action").eq("institution_id", instId).order("created_at", { ascending: false }).limit(10),
    db.from("events").select("kind, title, start_at, status").eq("institution_id", instId).order("start_at", { ascending: false }).limit(10),
  ]);
  const ids = (leads || []).map((l: any) => l.id);
  const { data: rem } = ids.length ? await db.from("remarks").select("created_at, outcome, text").in("lead_id", ids).order("created_at", { ascending: false }).limit(30) : { data: [] };
  const tool = {
    name: "account_brief", description: "Pre-visit brief for the college.",
    input_schema: { type: "object", properties: {
      snapshot: { type: "string" }, decision_makers: { type: "array", items: { type: "string" } },
      what_they_have_bought: { type: "array", items: { type: "string" } }, open_opportunities: { type: "array", items: { type: "string" } },
      talking_points: { type: "array", items: { type: "string" } }, cross_sell: { type: "array", items: { type: "string" } },
      watch_outs: { type: "array", items: { type: "string" } }, visit_goal: { type: "string" },
    }, required: ["snapshot", "talking_points", "visit_goal"] },
  };
  const prompt = `Prepare a pre-visit account brief.
Institution: ${JSON.stringify(i)}
Contacts: ${JSON.stringify(contacts)}
Opportunities: ${JSON.stringify(leads)}
Recent visits: ${JSON.stringify(visits)}
Events: ${JSON.stringify(events)}
Recent remarks: ${JSON.stringify(rem)}
Garuda's CoE menu: Dronistaan Day, awareness talk, hands-on day, workshops, electives (45 h, 3 credits), FDP, bulk RPTO training, Basic / Standard / Advanced UAV labs, drone arena, AMC, RPTO partnership models A/B/C, internships, R&D.`;
  const { result, usage } = await claudeTool<any>({ model, system: SYSTEM, tool, prompt, maxTokens: 1500 });
  await db.from("ai_runs").insert({ kind: "brief", model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, result, created_by: by });
  return result;
}

// Supabase returns at most 1,000 rows per request, so large tables are read in pages
async function fetchAll(db: any, table: string, columns: string, build: (q: any) => any = (q) => q): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(db.from(table).select(columns)).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------------- metrics snapshot shared by "ask" and the daily digest ----------------
async function snapshot(db: any) {
  const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  const [{ data: leads }, { data: stages }, { data: pays }, { data: pds }, { data: profiles }, { data: rem }] = await Promise.all([
    fetchAll(db, "leads", "id, funnel, stage, value, owner, source, created_at, first_contact_at, last_contact_at, next_followup_at, temperature, ai_band, won_at, consent_email, consent_whatsapp, opted_out, email, phone, fee_disclosed, lost_reason, updated_at, imported, call_attempts, campaign_tier").then((data) => ({ data })),
    db.from("stages").select("*"),
    db.from("payments").select("lead_id, amount_ex, status, paid_on").gte("paid_on", since30.slice(0, 10)),
    db.from("price_disclosures").select("lead_id, amount, disclosed_by, disclosed_at").gte("disclosed_at", since30),
    db.from("profiles").select("id, full_name, role").eq("active", true),
    db.from("remarks").select("author, outcome, fee_disclosed, created_at").gte("created_at", since30),
  ]);
  const st = new Map<string, any>((stages || []).map((s: any) => [`${s.funnel}|${s.key}`, s]));
  const name = new Map<string, string>((profiles || []).map((p: any) => [p.id, p.full_name]));
  const now = Date.now();
  const open = (leads || []).filter((l: any) => { const s: any = st.get(`${l.funnel}|${l.stage}`); return s && !s.is_won && !s.is_lost; });
  const won30 = (leads || []).filter((l: any) => l.won_at && new Date(l.won_at).getTime() > now - 30 * 86400e3);
  const perPerson: Record<string, any> = {};
  for (const p of profiles || []) perPerson[p.full_name] = { role: p.role, open: 0, pipeline: 0, won30: 0, closure30: 0, calls30: 0, connects30: 0, fee30: 0, enquired30: 0 };
  for (const l of open) { const k = name.get(l.owner); if (k && perPerson[k]) { perPerson[k].open++; perPerson[k].pipeline += Number(l.value || 0); } }
  for (const l of won30) { const k = name.get(l.owner); if (k && perPerson[k]) { perPerson[k].won30++; perPerson[k].closure30 += Number(l.value || 0); } }
  for (const r of rem || []) { const k = name.get(r.author); if (!k || !perPerson[k]) continue; if (/call/i.test(r.outcome) || r.outcome !== "Note") perPerson[k].calls30++; if (!["No answer", "Busy", "Note"].includes(r.outcome)) perPerson[k].connects30++; if (r.fee_disclosed) perPerson[k].fee30++; }
  for (const d of pds || []) { const k = name.get(d.disclosed_by); if (k && perPerson[k]) perPerson[k].enquired30 += Number(d.amount || 0); }
  const bySource: Record<string, { leads: number; won: number }> = {};
  for (const l of leads || []) { const s = l.source || "Unknown"; bySource[s] ??= { leads: 0, won: 0 }; bySource[s].leads++; if (l.won_at) bySource[s].won++; }
  const stageCounts: Record<string, number> = {};
  for (const l of open) stageCounts[`${l.funnel} · ${l.stage}`] = (stageCounts[`${l.funnel} · ${l.stage}`] || 0) + 1;
  return {
    today: new Date().toISOString().slice(0, 10),
    totals: {
      open_leads: open.length, pipeline_ex_gst: open.reduce((a: number, l: any) => a + Number(l.value || 0), 0),
      closures_30d: won30.length, closure_value_30d: won30.reduce((a: number, l: any) => a + Number(l.value || 0), 0),
      collected_30d_verified: (pays || []).filter((p: any) => p.status === "Verified").reduce((a: number, p: any) => a + Number(p.amount_ex), 0),
      claimed_unverified: (pays || []).filter((p: any) => p.status === "Claimed").reduce((a: number, p: any) => a + Number(p.amount_ex), 0),
      enquired_30d: (pds || []).reduce((a: number, d: any) => a + Number(d.amount || 0), 0),
      never_contacted: open.filter((l: any) => !l.first_contact_at).length,
    },
    open_by_stage: stageCounts, by_person: perPerson, by_source: bySource, _open: open, _all: leads || [],
  };
}

function ageBuckets(open: any[]) {
  const defs = [["0-1 days", 0, 1], ["2-3 days", 2, 3], ["4-7 days", 4, 7], ["8-14 days", 8, 14], ["15-30 days", 15, 30], ["31-60 days", 31, 60], ["60+ days", 61, 1e9]] as const;
  return defs.map(([label, a, b]) => {
    const inB = open.filter((l) => { const d = daysBetween(l.created_at); return d >= a && d <= b; });
    return { label, total: inB.length, not_contacted: inB.filter((l) => !l.first_contact_at).length };
  });
}

function segments(all: any[], open: any[], stagesWon: Set<string>) {
  const today = new Date().toISOString().slice(0, 10);
  const ok = (l: any) => !l.opted_out;
  const seg = (key: string, label: string, channel: string, reason: string, rows: any[]) => ({ key, label, channel, reason, count: rows.length, lead_ids: rows.slice(0, 1000).map((l) => l.id) });
  return [
    seg("call_now", "Call today", "Call", "Hot or AI-hot leads with a follow-up due today or overdue",
      open.filter((l) => (l.temperature === "Hot" || l.ai_band === "Hot") && l.next_followup_at && l.next_followup_at.slice(0, 10) <= today)),
    seg("not_contacted", "Yet to contact", "Call", "Open leads with no first contact",
      open.filter((l) => !l.first_contact_at)),
    seg("whatsapp_ready", "Best for WhatsApp", "WhatsApp", "Opted in to WhatsApp, warm, last contact 2-14 days ago",
      open.filter((l) => ok(l) && l.consent_whatsapp && l.phone && l.temperature !== "Cold" && l.last_contact_at && daysBetween(l.last_contact_at) >= 2 && daysBetween(l.last_contact_at) <= 14)),
    seg("email_nurture", "Best for email follow-up", "Email", "Email consent, 8-30 days old, not hot",
      open.filter((l) => ok(l) && l.consent_email && l.email && daysBetween(l.created_at) >= 8 && daysBetween(l.created_at) <= 30 && l.temperature !== "Hot")),
    seg("newsletter", "Newsletter audience", "Email", "Email consent and older than 30 days, or lost but not opted out",
      all.filter((l) => ok(l) && l.consent_email && l.email && (daysBetween(l.created_at) > 30 || l.stage === "Lost") && !stagesWon.has(`${l.funnel}|${l.stage}`))),
    seg("reactivate", "Re-activate lost leads", "Email", "Lost in the last 180 days for timing, no response or budget",
      all.filter((l) => ok(l) && l.stage === "Lost" && /timing|no response|budget/i.test(l.lost_reason || "") && daysBetween(l.updated_at) <= 180)),
    seg("fee_not_disclosed", "Fee not yet disclosed", "Call", "RPTO leads contacted without a recorded fee disclosure (SOP breach)",
      open.filter((l) => l.funnel === "RPTO" && l.first_contact_at && !l.fee_disclosed)),
  ];
}

async function runAutomation(db: any) {
  const { data: rules } = await db.from("automation_rules").select("*, email_templates(*)").eq("active", true);
  const { data: stages } = await db.from("stages").select("*");
  const st = new Map<string, any>((stages || []).map((s: any) => [`${s.funnel}|${s.key}`, s]));
  const emailCfg = await getSetting<any>(db, "email", { senders: {} });
  const { data: nextBatch } = await db.from("batches").select("course, centre, start_date").gte("start_date", new Date().toISOString().slice(0, 10)).order("start_date").limit(1).maybeSingle();
  const results: any[] = [];
  for (const r of rules || []) {
    // automations only email leads created in the CRM with email consent; the leads imported from the sales sheet are never auto-emailed
    if (r.action !== "queue_email") { results.push({ rule: r.name, fired: 0 }); continue; }
    const leads = await fetchAll(db, "leads", "id, name, funnel, stage, email, owner, created_at, updated_at, first_contact_at, consent_email, opted_out, contact_name, value, unit_price, gst_rate, products(name), institutions(name), owner_p:profiles!leads_owner_fkey(full_name)",
      (q: any) => { q = q.eq("imported", false).eq("consent_email", true).eq("opted_out", false); return r.funnel && r.funnel !== "Both" ? q.eq("funnel", r.funnel) : q; });
    const { data: fired } = await db.from("automation_log").select("lead_id").eq("rule_id", r.id);
    const done = new Set((fired || []).map((f: any) => f.lead_id));
    let n = 0;
    for (const l of leads || []) {
      const s: any = st.get(`${l.funnel}|${l.stage}`);
      if (!s || s.is_won || s.is_lost) continue;
      if (r.once && done.has(l.id)) continue;
      if (r.stages?.length && !r.stages.includes(l.stage)) continue;
      const age = daysBetween(l.created_at);
      const match = r.trigger === "lead_age" ? age >= r.min_days && age <= r.max_days
        : r.trigger === "no_contact_days" ? !l.first_contact_at && age >= r.min_days
        : r.trigger === "stage_idle_days" ? daysBetween(l.updated_at) >= r.min_days : false;
      if (!match) continue;
      if (r.action === "queue_email") {
        if (!r.email_templates || !l.email || !l.consent_email || l.opted_out) continue;
        const t = r.email_templates;
        const first = (l.contact_name || l.name || "").split(" ")[0];
        const vars = {
          first_name: first, name: l.contact_name || l.name, institution: l.institutions?.name || "", product: l.products?.name || "our drone programmes",
          price: l.unit_price ? inr(l.unit_price) : "", owner_name: l.owner_p?.full_name || "Team Garuda",
          next_batch: nextBatch?.start_date || "the next available date", centre: nextBatch?.centre || "Chennai",
          month: new Date().toLocaleString("en-IN", { month: "long", year: "numeric" }),
        };
        await db.from("email_queue").insert({
          template_id: t.id, lead_id: l.id, to_email: l.email, to_name: vars.name, category: t.category,
          subject: renderTemplate(t.subject, vars), html: renderTemplate(t.html, vars),
          sender: emailCfg.senders?.[t.category] || "", auto_rule: r.name, created_by: null,
        });
      }
      await db.from("automation_log").upsert({ rule_id: r.id, lead_id: l.id, fired_at: new Date().toISOString() });
      n++;
    }
    results.push({ rule: r.name, fired: n });
  }
  return results;
}

async function daily(db: any, ai: any) {
  const automation = await runAutomation(db);
  const snap = await snapshot(db);
  const { data: stages } = await db.from("stages").select("*").eq("is_won", true);
  const wonSet = new Set<string>((stages || []).map((s: any) => `${s.funnel}|${s.key}`));
  const buckets = ageBuckets(snap._open);
  const segs = segments(snap._all, snap._open, wonSet);

  // re-score leads with new activity
  let scored = 0;
  if (ai.enabled && ai.auto_score) {
    const { data: dirty } = await db.from("leads").select("id").eq("ai_dirty", true).order("updated_at", { ascending: false }).limit(ai.max_scores_per_run || 200);
    for (const d of dirty || []) { try { await scoreLead(db, d.id, ai.score_model, null); scored++; } catch (_) { /* keep going */ } }
  }
  const { data: top } = await db.from("leads").select("lead_no, name, funnel, stage, value, ai_score, ai_next_action, owner_p:profiles!leads_owner_fkey(full_name)").not("ai_score", "is", null).order("ai_score", { ascending: false }).limit(15);

  let digest: any = null;
  if (ai.enabled && ai.daily_digest) {
    const tool = {
      name: "daily_digest", description: "Morning brief for the Business Head.",
      input_schema: { type: "object", properties: {
        headline: { type: "string" },
        highlights: { type: "array", items: { type: "string" }, maxItems: 6 },
        risks: { type: "array", items: { type: "string" }, maxItems: 6 },
        actions: { type: "array", maxItems: 8, items: { type: "object", properties: { who: { type: "string" }, action: { type: "string" } }, required: ["who", "action"] } },
        campaign_suggestions: { type: "array", maxItems: 5, items: { type: "object", properties: {
          segment_key: { type: "string" }, channel: { type: "string" }, audience_size: { type: "integer" }, message_angle: { type: "string" } }, required: ["segment_key", "channel", "message_angle"] } },
        coaching: { type: "array", maxItems: 5, items: { type: "object", properties: { person: { type: "string" }, note: { type: "string" } }, required: ["person", "note"] } },
      }, required: ["headline", "highlights", "risks", "actions"] },
    };
    const { _open, _all, ...pub } = snap;
    const { result, usage } = await claudeTool<any>({
      model: ai.writer_model, system: SYSTEM, tool, maxTokens: 2000,
      prompt: `Write today's brief for the Business Head of RPTO & CoE.
Numbers (last 30 days unless stated, values ex-GST): ${JSON.stringify(pub)}
Lead age buckets: ${JSON.stringify(buckets)}
Segments (count = leads ready for that channel): ${JSON.stringify(segs.map(({ lead_ids, ...s }) => s))}
Top scored leads: ${JSON.stringify(top)}
Automation fired today: ${JSON.stringify(automation)}
Point out who is behind on calls, fee disclosure, follow-ups or EOD; which leads to push; which segment to campaign to and with what angle.`,
    });
    digest = result;
    await db.from("ai_runs").insert({ kind: "digest", model: ai.writer_model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, result });
  }
  const content = { generated_at: new Date().toISOString(), totals: snap.totals, buckets, segments: segs, automation, scored, top, digest };
  await db.from("ai_insights").insert({ kind: "daily_digest", content });
  return { ...content, segments: segs.map(({ lead_ids, ...s }) => s) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  try {
    const who = await caller(req, db);
    const body = await req.json().catch(() => ({}));
    const ai = await getSetting<any>(db, "ai", { enabled: true, score_model: "claude-haiku-5-5", writer_model: "claude-sonnet-5-5", auto_score: true, daily_digest: true, max_scores_per_run: 200 });
    if (!ai.enabled && body.action !== "daily") return json({ error: "AI is switched off in Settings" }, 400);
    const head = who.cron || ["admin", "clevel"].includes(who.role);

    if (body.lead_id && !who.cron && !head && !(await userCanSeeLead(req, body.lead_id))) return json({ error: "You cannot see this lead" }, 403);
    switch (body.action) {
      case "score": return json(await scoreLead(db, body.lead_id, ai.score_model, who.id));
      case "score_batch": {
        if (!head) return json({ error: "Admin or C-level only" }, 403);
        const { data } = await db.from("leads").select("id").eq("ai_dirty", true).limit(body.limit || 50);
        let n = 0; for (const l of data || []) { try { await scoreLead(db, l.id, ai.score_model, who.id); n++; } catch (_) { /* skip */ } }
        return json({ scored: n });
      }
      case "draft": return json(await draft(db, body.lead_id, body.channel || "Email", body.purpose || "", ai.writer_model, who.id));
      case "brief": return json(await brief(db, body.institution_id, ai.writer_model, who.id));
      case "ask": {
        if (!head) return json({ error: "Admin or C-level only" }, 403);
        const { _open, _all, ...pub } = await snapshot(db);
        const tool = { name: "answer", description: "Answer the question.", input_schema: { type: "object", properties: {
          answer: { type: "string" }, figures: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } } } },
          follow_up_questions: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["answer"] } };
        const { result, usage } = await claudeTool<any>({ model: ai.writer_model, system: SYSTEM, tool, maxTokens: 1200,
          prompt: `Answer using only these CRM numbers (ex-GST). If the data cannot answer it, say what is missing.\nData: ${JSON.stringify(pub)}\nAge buckets: ${JSON.stringify(ageBuckets(_open))}\n\nQuestion: ${body.question}` });
        await db.from("ai_runs").insert({ kind: "ask", model: ai.writer_model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, result, created_by: who.id });
        return json(result);
      }
      case "daily": {
        if (!head) return json({ error: "Admin or C-level only" }, 403);
        return json(await daily(db, ai));
      }
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
