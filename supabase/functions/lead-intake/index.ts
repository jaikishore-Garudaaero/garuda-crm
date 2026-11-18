// lead-intake: receives leads from Google Ads lead forms, Meta (Facebook/Instagram) Lead Ads and website forms.
//
// URLs (replace <ref> with your project ref):
//   Google Ads lead form webhook : https://<ref>.supabase.co/functions/v1/lead-intake?source=google
//   Meta Lead Ads webhook        : https://<ref>.supabase.co/functions/v1/lead-intake?source=meta
//   Website / landing page form  : https://<ref>.supabase.co/functions/v1/lead-intake?source=website&key=<INTAKE_KEY>
//
// Secrets (supabase secrets set ...): GOOGLE_LEAD_KEY, META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_TOKEN, INTAKE_KEY
// Deploy with --no-verify-jwt (the ad platforms cannot send a Supabase token; each source is checked with its own secret).

import { admin, cors, departments, digits10, getSetting, json } from "../_shared/util.ts";

type Norm = {
  platform: string;
  external_id: string | null;
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  company: string;
  designation: string;
  course: string;
  funnel: string | null;   // a department code (Settings → Departments)
  campaign_ext: string;
  campaign_name: string;
  utm: Record<string, string>;
  consent_whatsapp: boolean;
  extra: Record<string, string>;
};

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function guessFunnel(n: Partial<Norm>): "RPTO" | "CoE" {
  const t = `${n.course} ${n.company} ${n.designation} ${n.campaign_name} ${Object.values(n.extra || {}).join(" ")}`.toLowerCase();
  if (/(lab|coe|centre of excellence|college|principal|dean|hod|university|institution|workshop|fdp|dronistaan)/.test(t) &&
      !/(small class|medium class|rpc|pilot licen|ttt)/.test(t)) return "CoE";
  return "RPTO";
}

function fromGoogle(b: any): Norm {
  const col: Record<string, string> = {};
  const extra: Record<string, string> = {};
  for (const c of b.user_column_data || []) {
    const v = c.string_value ?? "";
    if (c.column_id && !String(c.column_id).startsWith("QUESTION")) col[c.column_id] = v;
    else extra[c.column_name || c.column_id] = v;
  }
  const name = col.FULL_NAME || [col.FIRST_NAME, col.LAST_NAME].filter(Boolean).join(" ") || "Google Ads lead";
  return {
    platform: "google", external_id: b.lead_id ? `google:${b.lead_id}` : null, name,
    phone: col.PHONE_NUMBER || "", email: col.EMAIL || "", city: col.CITY || "", state: col.REGION || "",
    company: col.COMPANY_NAME || "", designation: col.JOB_TITLE || "", course: extra["Course"] || extra["course"] || "",
    funnel: null, campaign_ext: String(b.campaign_id || ""), campaign_name: "",
    utm: { gclid: b.gcl_id || "", adgroup_id: String(b.adgroup_id || ""), form_id: String(b.form_id || ""), is_test: String(!!b.is_test) },
    consent_whatsapp: false, extra,
  };
}

async function fromMeta(leadgenId: string, meta: any): Promise<Norm> {
  const token = Deno.env.get("META_PAGE_TOKEN");
  if (!token) throw new Error("META_PAGE_TOKEN not set");
  const url = `https://graph.facebook.com/v21.0/${leadgenId}?fields=created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform&access_token=${token}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(`Meta Graph ${r.status}: ${d?.error?.message || ""}`);
  const f: Record<string, string> = {};
  for (const x of d.field_data || []) f[String(x.name).toLowerCase()] = (x.values || []).join(", ");
  const pick = (...k: string[]) => k.map((x) => f[x]).find(Boolean) || "";
  const used = ["full_name", "first_name", "last_name", "phone_number", "phone", "email", "city", "state", "company_name", "job_title"];
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (!used.includes(k)) extra[k] = v;
  const wa = Object.entries(extra).find(([k]) => /whatsapp/.test(k));
  return {
    platform: "meta", external_id: `meta:${leadgenId}`,
    name: pick("full_name") || [pick("first_name"), pick("last_name")].filter(Boolean).join(" ") || "Meta lead",
    phone: pick("phone_number", "phone"), email: pick("email"), city: pick("city"), state: pick("state"),
    company: pick("company_name"), designation: pick("job_title"),
    course: Object.entries(extra).find(([k]) => /course|program|interest/.test(k))?.[1] || "",
    funnel: null, campaign_ext: String(d.campaign_id || meta.campaign_id || ""), campaign_name: d.campaign_name || "",
    utm: { ad_id: String(d.ad_id || ""), ad_name: d.ad_name || "", adset: d.adset_name || "", form_id: String(d.form_id || ""), platform: d.platform || "" },
    consent_whatsapp: wa ? /yes|true|ok/i.test(wa[1]) : false, extra,
  };
}

// the sales sheet's course names
function courseOf(t: string): string {
  const x = (t || "").toLowerCase();
  if (/ttt|trainer/.test(x)) return "Train the Trainer (TTT)";
  if (/top.?up/.test(x)) return "Top-up Medium";
  if (/small/.test(x) && /medium/.test(x)) return "Small + Medium RPC";
  if (/medium/.test(x)) return "Medium Class RPC";
  if (/small|rpc|rpto|pilot/.test(x)) return "Small Class RPC";
  return "Not Specified";
}

function fromWebsite(b: any): Norm {
  return {
    platform: "website", external_id: b.id ? `web:${b.id}` : null, name: b.name || b.full_name || "Website enquiry",
    phone: b.phone || b.mobile || "", email: b.email || "", city: b.city || "", state: b.state || "",
    company: b.college || b.company || b.institution || "", designation: b.designation || "", course: b.course || b.interest || "",
    funnel: String(b.department || b.funnel || "").trim() || null,
    campaign_ext: b.utm_campaign || "", campaign_name: b.utm_campaign || "",
    utm: { utm_source: b.utm_source || "", utm_medium: b.utm_medium || "", utm_campaign: b.utm_campaign || "", page: b.page || "" },
    consent_whatsapp: !!b.whatsapp_optin, extra: b.message ? { message: String(b.message) } : {},
  };
}

async function save(db: any, n: Norm): Promise<{ lead_id: string; duplicate: boolean }> {
  // campaign mapping by external id / utm name (old campaigns table and the v4 Ad / Other Campaigns)
  let campaign_id: string | null = null;
  let campFunnel: string | null = null;
  if (n.campaign_ext) {
    const ext = n.campaign_ext.replace(/"/g, "");
    const { data: c } = await db.from("campaigns").select("id, funnel").or(`external_id.eq."${ext}",utm_campaign.eq."${ext}"`).limit(1).maybeSingle();
    if (c) { campaign_id = c.id; campFunnel = c.funnel; }
    const { data: mc } = await db.from("mkt_campaigns").select("dept").ilike("utm", ext).limit(1).maybeSingle();
    if (mc?.dept) campFunnel = mc.dept;
  }
  const depts = await departments(db);
  const valid = (x: string | null) => (x && depts.some((d) => d.code.toLowerCase() === x.toLowerCase()) ? depts.find((d) => d.code.toLowerCase() === x.toLowerCase())!.code : null);
  const funnel = valid(n.funnel) || valid(campFunnel) || valid(guessFunnel(n)) || depts[0]?.code || "RPTO";
  const individual = !!depts.find((d) => d.code === funnel)?.has_admissions;
  const { data: firstStage } = await db.from("stages").select("key").eq("funnel", funnel).eq("kind", "lead").order("ord").limit(1).maybeSingle();
  const source = n.platform === "google" ? "Paid Media - Google Ads" : n.platform === "meta" ? "Paid Media - Meta" : "Website - Enquiry Form";

  // de-duplicate on phone / email among recent leads
  const p10 = digits10(n.phone);
  let dup: any = null;
  if (p10 || n.email) {
    const ors = [p10 ? `phone.ilike."%${p10}"` : "", n.email ? `email.ilike."${n.email.replace(/"/g, "")}"` : ""].filter(Boolean).join(",");
    const { data } = await db.from("leads").select("id, owner, name").or(ors).order("created_at", { ascending: false }).limit(1);
    dup = data?.[0] || null;
  }
  const detail = Object.entries({ course: n.course, company: n.company, ...n.extra }).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");

  if (dup) {
    await db.from("remarks").insert({
      lead_id: dup.id, author: dup.owner || (await db.rpc("next_owner", { p_funnel: funnel })).data,
      channel: "Note", outcome: "Note", text: `Re-enquiry via ${source}${n.campaign_name ? " (" + n.campaign_name + ")" : ""}. ${detail}`,
    });
    await db.from("leads").update({ ai_dirty: true, temperature: "Hot" }).eq("id", dup.id);
    return { lead_id: dup.id, duplicate: true };
  }

  const { data: owner } = await db.rpc("next_owner", { p_funnel: funnel });
  let product_id: string | null = null, unit_price = 0, gst_rate = 18;
  const c = n.course.toLowerCase();
  const code = /ttt|trainer/.test(c) ? "RPTO-TTT" : /top.?up/.test(c) ? "RPTO-TOPUP" : /medium/.test(c) ? "RPTO-MEDIUM" : /small/.test(c) ? "RPTO-SMALL" : null;
  if (code && funnel === "RPTO") {
    const { data: p } = await db.from("products").select("id, price, gst_rate").eq("code", code).maybeSingle();
    if (p) { product_id = p.id; unit_price = p.price; gst_rate = p.gst_rate; }
  }
  let institution_id: string | null = null;
  if (!individual && n.company) {
    const { data: inst } = await db.from("institutions").select("id").ilike("name", n.company).limit(1).maybeSingle();
    if (inst) institution_id = inst.id;
    else {
      const { data: ni } = await db.from("institutions").insert({ name: n.company, city: n.city, state: n.state || "Tamil Nadu", owner, notes: `Created from ${source} enquiry` }).select("id").single();
      institution_id = ni?.id ?? null;
    }
  }
  const { data: lead, error } = await db.from("leads").insert({
    funnel, name: !individual && n.company ? `${n.company} · enquiry` : n.name,
    contact_name: !individual ? n.name : "", designation: n.designation, phone: n.phone, email: n.email,
    city: n.city, state: n.state, source, campaign_id, utm: n.utm, external_id: n.external_id, institution_id,
    product_id, unit_price, gst_rate, stage: firstStage?.key || "New", course: individual ? (funnel === "RPTO" ? courseOf(n.course) : n.course || "") : "", sub_category: individual ? "" : "Not Specified",
    temperature: "Warm", owner, consent_email: !!n.email, consent_whatsapp: n.consent_whatsapp,
    notes: detail, created_by: owner,
  }).select("id, name").single();
  if (error) throw error;

  const sla = await getSetting(db, "sla", { first_contact_hours: 2 } as any);
  await db.from("tasks").insert({
    title: `First call: ${lead.name} (${source})`, kind: "Call", lead_id: lead.id, owner,
    due_at: new Date(Date.now() + (sla.first_contact_hours || 2) * 3600e3).toISOString(),
    priority: "High", auto_rule: "new_lead", created_by: owner,
  });
  return { lead_id: lead.id, duplicate: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "website";
  const db = admin();

  // Meta webhook verification handshake
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === Deno.env.get("META_VERIFY_TOKEN")) {
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Garuda CRM lead intake is running", { status: 200 });
  }

  const raw = await req.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = Object.fromEntries(new URLSearchParams(raw)); }

  try {
    const leads: Norm[] = [];
    if (source === "meta" || body.object === "page") {
      const secret = Deno.env.get("META_APP_SECRET");
      const sig = req.headers.get("x-hub-signature-256") || "";
      if (secret && sig !== "sha256=" + (await hmacHex(secret, raw))) return json({ error: "bad signature" }, 401);
      for (const e of body.entry || []) for (const ch of e.changes || []) {
        if (ch.field === "leadgen" && ch.value?.leadgen_id) leads.push(await fromMeta(String(ch.value.leadgen_id), ch.value));
      }
    } else if (source === "google" || body.google_key) {
      if (body.google_key !== Deno.env.get("GOOGLE_LEAD_KEY")) return json({ error: "bad key" }, 401);
      leads.push(fromGoogle(body));
    } else {
      if (url.searchParams.get("key") !== Deno.env.get("INTAKE_KEY") && body.key !== Deno.env.get("INTAKE_KEY")) {
        return json({ error: "bad key" }, 401);
      }
      leads.push(fromWebsite(body));
    }
    const out: { lead_id: string; duplicate: boolean }[] = [];
    for (const n of leads) {
      try {
        const r = await save(db, n);
        await db.from("intake_log").insert({ platform: n.platform, payload: body, lead_id: r.lead_id, status: r.duplicate ? "duplicate" : "ok" });
        out.push(r);
      } catch (e) {
        await db.from("intake_log").insert({ platform: n.platform, payload: body, status: "error", error: String((e as Error).message || e) });
      }
    }
    return json({ ok: true, leads: out });
  } catch (e) {
    await db.from("intake_log").insert({ platform: source, payload: body, status: "error", error: String((e as Error).message || e) });
    return json({ ok: false, error: String((e as Error).message || e) }, 200); // 200 so the platform does not retry forever
  }
});
