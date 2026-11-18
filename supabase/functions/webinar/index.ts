// webinar: public registration and online payment for CRM webinars.
//
//   GET  /functions/v1/webinar?action=info&slug=<slug>      → public details for the registration page
//   POST /functions/v1/webinar  {action:"register", slug, name, email, phone, city, college, course_interest, answers, consent, utm}
//        free webinar → participant is Active at once and gets the confirmation email with the join link
//        paid webinar → a Razorpay order is created; the page opens Razorpay Checkout
//   POST /functions/v1/webinar  {action:"verify", attendee_id, razorpay_order_id, razorpay_payment_id, razorpay_signature}
//        signature checked with the key secret → participant becomes Active, payment recorded as Verified
//   POST /functions/v1/webinar?action=webhook               → Razorpay webhook (payment.captured / order.paid),
//        checked with RAZORPAY_WEBHOOK_SECRET; activates anyone whose browser closed before "verify"
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
// Deploy with --no-verify-jwt (the registration page is public).

import { admin, cors, departments, digits10, getSetting, json } from "../_shared/util.ts";

const enc = new TextEncoder();
async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ev = {
  id: string; title: string; description: string; start_at: string; end_at: string | null; status: string; kind: string;
  is_paid: boolean; fee: number; gst_rate: number; registration_open: boolean; capacity: number | null;
  segment: string; questions: unknown; slug: string; meeting_link: string; campaign_id: string | null; owner: string | null;
};

async function loadEvent(db: any, slug: string): Promise<Ev | null> {
  if (!slug) return null;
  const { data } = await db.from("events").select("*").eq("slug", slug).eq("kind", "Webinar").maybeSingle();
  return data as Ev | null;
}

async function seatsTaken(db: any, eventId: string) {
  const { count } = await db.from("event_attendees").select("id", { count: "exact", head: true })
    .eq("event_id", eventId).in("status", ["Active", "Payment pending"]);
  return count || 0;
}

const total = (ev: Ev) => Math.round(Number(ev.fee) * (1 + Number(ev.gst_rate) / 100) * 100) / 100;

/** find the lead by phone or email, or create one in the webinar's funnel */
async function linkLead(db: any, ev: Ev, a: { name: string; email: string; phone: string; city: string; college: string; course: string }) {
  const p10 = digits10(a.phone);
  const ors = [p10 ? `phone.ilike."%${p10}"` : "", a.email ? `email.ilike."${a.email.replace(/"/g, "")}"` : ""].filter(Boolean).join(",");
  if (ors) {
    const { data } = await db.from("leads").select("id, owner").or(ors).order("created_at", { ascending: false }).limit(1);
    if (data?.[0]) {
      await db.from("remarks").insert({
        lead_id: data[0].id, author: data[0].owner || ev.owner, channel: "Note", outcome: "Note",
        text: `Registered for webinar "${ev.title}"`,
      });
      await db.from("leads").update({ ai_dirty: true, consent_email: true }).eq("id", data[0].id);
      return data[0].id as string;
    }
  }
  const depts = await departments(db);
  const dep = depts.find((d) => d.code === ev.segment) || depts.find((d) => d.code === "RPTO") || depts[0];
  const funnel = dep?.code || "RPTO"; const individual = !!dep?.has_admissions;
  const { data: owner } = await db.rpc("next_owner", { p_funnel: funnel });
  const { data: firstStage } = await db.from("stages").select("key").eq("funnel", funnel).eq("kind", "lead").order("ord").limit(1).maybeSingle();
  const { data: camp } = await db.from("mkt_campaigns").select("id").eq("event_id", ev.id).limit(1).maybeSingle();
  const { data: lead, error } = await db.from("leads").insert({
    mkt_campaign_id: camp?.id ?? null,
    funnel, name: !individual && a.college ? `${a.college} · webinar` : a.name,
    contact_name: !individual ? a.name : "", phone: a.phone, email: a.email, city: a.city,
    source: "Webinar", campaign_id: ev.campaign_id, stage: firstStage?.key || "New", course: individual ? "Not Specified" : "", sub_category: !individual ? "Not Specified" : "",
    temperature: "Warm", owner, consent_email: true, created_by: owner,
    notes: [`Webinar: ${ev.title}`, a.course && `Interest: ${a.course}`, a.college && `College: ${a.college}`].filter(Boolean).join(" · "),
  }).select("id").single();
  if (error) throw error;
  return lead.id as string;
}

async function activate(db: any, att: any, payment: { order_id: string; payment_id: string }) {
  if (att.status === "Active") return;
  const now = new Date().toISOString();
  await db.from("event_attendees").update({ status: "Active", payment_id: payment.payment_id, paid_at: now }).eq("id", att.id).neq("status", "Active");
  if (att.lead_id && Number(att.amount) > 0) {
    const { data: ev } = await db.from("events").select("title, gst_rate").eq("id", att.event_id).single();
    const ex = Math.round((Number(att.amount) / (1 + Number(ev?.gst_rate ?? 18) / 100)) * 100) / 100;
    // Razorpay has already captured the money, so the payment is recorded as verified
    await db.from("payments").insert({
      lead_id: att.lead_id, amount: att.amount, amount_ex: ex, mode: "Razorpay", reference: payment.payment_id,
      milestone: "Webinar fee", status: "Verified", notes: `Webinar: ${ev?.title || ""} · order ${payment.order_id}`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const db = admin();
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";

  try {
    // ---------------- Razorpay webhook ----------------
    if (url.searchParams.get("action") === "webhook") {
      const raw = await req.text();
      const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
      const sig = req.headers.get("x-razorpay-signature") || "";
      if (!secret || !sameText(await hmacHex(secret, raw), sig)) return json({ error: "Bad signature" }, 401);
      const evt = JSON.parse(raw);
      const pay = evt?.payload?.payment?.entity;
      const orderId = pay?.order_id || evt?.payload?.order?.entity?.id;
      if (orderId && (evt.event === "payment.captured" || evt.event === "order.paid")) {
        const { data: att } = await db.from("event_attendees").select("*").eq("order_id", orderId).maybeSingle();
        if (att) await activate(db, att, { order_id: orderId, payment_id: pay?.id || "" });
      }
      return json({ ok: true });
    }

    // ---------------- public info ----------------
    if (req.method === "GET") {
      const ev = await loadEvent(db, url.searchParams.get("slug") || "");
      if (!ev || ev.status === "Cancelled") return json({ error: "This webinar was not found." }, 404);
      const taken = await seatsTaken(db, ev.id);
      const company = await getSetting<any>(db, "company", {});
      const wset = await getSetting<any>(db, "webinar", {});
      return json({
        title: ev.title, description: ev.description, start_at: ev.start_at, end_at: ev.end_at,
        is_paid: ev.is_paid, fee: Number(ev.fee), gst_rate: Number(ev.gst_rate), total: ev.is_paid ? total(ev) : 0,
        open: ev.registration_open && new Date(ev.start_at).getTime() > Date.now() - 30 * 60e3 && (!ev.capacity || taken < ev.capacity),
        seats_left: ev.capacity ? Math.max(0, ev.capacity - taken) : null, questions: ev.questions || [],
        segment: ev.segment, organiser: company.name || "Garuda Aerospace", terms: wset.terms || "",
      });
    }

    const body = await req.json().catch(() => ({}));

    // ---------------- register ----------------
    if (body.action === "register") {
      const ev = await loadEvent(db, clean(body.slug, 120));
      if (!ev || ev.status === "Cancelled") return json({ error: "This webinar was not found." }, 404);
      if (!ev.registration_open) return json({ error: "Registrations are closed for this webinar." }, 400);
      if (new Date(ev.start_at).getTime() < Date.now() - 30 * 60e3) return json({ error: "This webinar has already taken place." }, 400);
      const a = {
        name: clean(body.name, 120), email: clean(body.email, 160).toLowerCase(), phone: clean(body.phone, 20),
        city: clean(body.city, 80), college: clean(body.college, 160), course: clean(body.course_interest, 80),
      };
      if (a.name.length < 2) return json({ error: "Please enter your name." }, 400);
      if (!EMAIL.test(a.email)) return json({ error: "Please enter a valid email address." }, 400);
      if (digits10(a.phone).length !== 10) return json({ error: "Please enter a 10-digit mobile number." }, 400);
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.answers || {}).slice(0, 12)) answers[clean(k, 60)] = clean(v, 500);
      const utm: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.utm || {}).slice(0, 8)) if (/^utm_/.test(k)) utm[k] = clean(v, 120);

      const { data: existing } = await db.from("event_attendees").select("*").eq("event_id", ev.id).ilike("email", a.email).maybeSingle();
      if (existing?.status === "Active") return json({ ok: true, status: "Active", already: true });
      if (!existing && ev.capacity && (await seatsTaken(db, ev.id)) >= ev.capacity) return json({ error: "All seats are taken." }, 400);

      const leadId = existing?.lead_id || (await linkLead(db, ev, a));
      const amount = ev.is_paid ? total(ev) : 0;
      const row = {
        event_id: ev.id, lead_id: leadId, name: a.name, email: a.email, phone: a.phone, city: a.city, college: a.college,
        course_interest: a.course, answers, utm, consent: body.consent !== false, segment: ev.segment,
        amount, status: ev.is_paid ? "Payment pending" : "Active",
      };
      const { data: att, error } = existing
        ? await db.from("event_attendees").update(row).eq("id", existing.id).select("*").single()
        : await db.from("event_attendees").insert(row).select("*").single();
      if (error) throw error;
      if (!ev.is_paid) return json({ ok: true, status: "Active" });

      if (!keyId || !keySecret) return json({ error: "Online payment is not set up yet. Please contact us." }, 503);
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${keyId}:${keySecret}`) },
        body: JSON.stringify({
          amount: Math.round(amount * 100), currency: "INR", receipt: att.id.slice(0, 40),
          notes: { webinar: ev.title.slice(0, 200), attendee_id: att.id, email: a.email },
        }),
      });
      const order = await res.json();
      if (!res.ok) throw new Error(`Razorpay: ${order?.error?.description || res.status}`);
      await db.from("event_attendees").update({ order_id: order.id }).eq("id", att.id);
      return json({
        ok: true, status: "Payment pending", attendee_id: att.id,
        checkout: { key: keyId, order_id: order.id, amount: order.amount, currency: "INR", name: a.name, email: a.email, phone: a.phone, title: ev.title },
      });
    }

    // ---------------- verify after Razorpay Checkout ----------------
    if (body.action === "verify") {
      const id = clean(body.attendee_id, 40);
      const orderId = clean(body.razorpay_order_id, 60);
      const paymentId = clean(body.razorpay_payment_id, 60);
      const signature = clean(body.razorpay_signature, 200);
      if (!keySecret) return json({ error: "Payment is not set up" }, 503);
      const { data: att } = await db.from("event_attendees").select("*").eq("id", id).maybeSingle();
      if (!att || att.order_id !== orderId) return json({ error: "Registration not found" }, 404);
      if (!sameText(await hmacHex(keySecret, `${orderId}|${paymentId}`), signature)) return json({ error: "Payment could not be verified" }, 400);
      await activate(db, att, { order_id: orderId, payment_id: paymentId });
      return json({ ok: true, status: "Active" });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again or contact us." }, 500);
  }
});
