// track: email open pixel, click redirect and one-click unsubscribe for CRM emails.
//   open        GET  /functions/v1/track?e=<email_queue id>&t=o      → 1×1 gif
//   click       GET  /functions/v1/track?e=<id>&t=c&u=<encoded url>  → 302 to the link
//   unsubscribe GET  /functions/v1/track?e=<id>&t=u                  → plain-text confirmation
//               POST same URL (List-Unsubscribe-Post one-click)
// Deploy with --no-verify-jwt.

import { admin } from "../_shared/util.ts";

const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("e") || "";
  const t = url.searchParams.get("t") || "o";
  const db = admin();
  const now = new Date().toISOString();

  if (!UUID.test(id)) {
    return t === "o" ? new Response(GIF, { headers: { "Content-Type": "image/gif" } }) : new Response("Link not recognised.", { status: 400 });
  }

  if (t === "o") {
    await db.from("email_queue").update({ opened_at: now }).eq("id", id).is("opened_at", null);
    return new Response(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
  }

  if (t === "c") {
    const target = url.searchParams.get("u") || "";
    let safe = "https://www.garudaaerospace.com";
    const { data: row } = await db.from("email_queue").select("html").eq("id", id).maybeSingle();
    try {
      const u = new URL(target);
      // only redirect to links that were really in this email (no open redirect)
      const html = (row?.html || "").replace(/&amp;/g, "&");
      if ((u.protocol === "https:" || u.protocol === "http:") && html.includes(target)) safe = u.toString();
    } catch { /* fall back */ }
    if (row) {
      await db.from("email_clicks").insert({ queue_id: id, url: safe });
      await db.from("email_queue").update({ clicked_at: now }).eq("id", id).is("clicked_at", null);
    }
    await db.from("email_queue").update({ opened_at: now }).eq("id", id).is("opened_at", null);
    return new Response(null, { status: 302, headers: { Location: safe } });
  }

  if (t === "u") {
    const { data: row } = await db.from("email_queue").select("to_email, category").eq("id", id).maybeSingle();
    if (row && row.category !== "Internal update") {
      await db.from("unsubscribes").upsert({ email: row.to_email.toLowerCase(), reason: "Unsubscribe link" });
    }
    return new Response(
      "You have been unsubscribed from Garuda Aerospace marketing emails. You will still receive replies to enquiries you make.\n",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response("Unknown action", { status: 400 });
});
