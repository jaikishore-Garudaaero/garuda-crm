# Garuda CRM — go-live guide (v4)

The CRM runs as a static site on **Vercel** with **Supabase** as the database and sign-in.
v4 is a multi-department CRM: RPTO and CoE today, and any department you add later (for example DaaS) in **Settings → Departments**, with no code change.
Your sales sheet (RPTO_CoE_Sales_Sheet_v4) is already converted into SQL in `supabase/import/`.

Time needed: about 1 hour for the core CRM. Ads, Meta and Razorpay can follow later.

| Folder / file | What it is |
|---|---|
| `app/` | The CRM (desktop and phone). Vercel serves this folder. |
| `vercel.json`, `tools/vercel-config.mjs` | Vercel settings; writes `app/config.js` from your environment variables at build time. |
| `supabase/schema.sql` | Tables, access rules (who sees what), stage rules, triggers. The v4 section is at the end. |
| `supabase/seed.sql` | Departments' statuses and stages, the 15 people with their Reports to, price book, settings, email templates. |
| `supabase/migration_nx.sql` | Contacts and campaign history from the Nx Outreach sheet. |
| `supabase/import/` | Your sales sheet as SQL: `00_prepare.sql` … `17_revenue_admissions.sql`, and `all.sql` (everything in one file). |
| `supabase/cron.sql` | Scheduled jobs (Claude scoring, email sending, webinar reminders). |
| `supabase/functions/` | Server code: `lead-intake` (Google, Meta, website), `ai` (Claude), `track` (opens, clicks, unsubscribes), `webinar` (registration + Razorpay). |
| `apps-script/Mailer.gs` | Sends the CRM's emails from your marketing mailbox. |
| `tools/import_sales_sheet.py` | Turns a newer copy of the sales sheet into SQL again. |
| `tests/` | The test kit used to check this release (developers only). |

---

## 1. Supabase project (10 min)

1. supabase.com → **New project** → region **Mumbai (ap-south-1)**. Save the database password.
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key (you need both for Vercel), and the **service_role** key (only for Supabase secrets and the Apps Script mailer — never put it in the app or in Vercel).

## 2. Database, people and your sales sheet (15 min)

Supabase → **SQL Editor** → New query. Paste and run each file, in this order, one at a time:

1. `supabase/schema.sql`
2. `supabase/seed.sql` (creates the 15 people, their departments, roles and Reports to)
3. `supabase/migration_nx.sql`
4. `supabase/import/00_prepare.sql`, then `01_coe_pipeline.sql`, `02_…`, … up to `17_revenue_admissions.sql`.

**Faster, one command** (if you have `psql`): Supabase → Project Settings → Database → copy the connection string, then
```bash
psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" -f supabase/import/all.sql
```

Check the numbers in the SQL Editor:
```sql
select (select count(*) from leads where funnel='RPTO') as rpto_records,                  -- 18195
       (select count(*) from leads where funnel='RPTO' and is_deal) as rpto_deals,       -- 119 (Pipeline + Converted)
       (select count(*) from leads where funnel='CoE' and is_deal) as coe_deals,         -- 60
       (select sum(amount) from revenue_entries where status='Collected') as collected,  -- 11899836
       (select count(*) from profiles where active) as people;                           -- 15
```

All files are safe to re-run.

## 3. Sign-in settings (15 min)

Everyone signs in with their **work email and their own password**. An Admin adds the person in Users & Access, Supabase emails them an invite, and their first visit asks them to create a password (8+ characters, letters and numbers, not a common word or their email). **Forgot password?** on the sign-in screen emails a reset link. "Email me a sign-in link" and Google (optional) are the other ways in.

Supabase → **Authentication**:
- **URL Configuration → Site URL**: your Vercel address from step 4 (for example `https://garuda-crm.vercel.app`). Under **Redirect URLs** add the same address followed by `/**`.
- **Sign In / Providers → Email**: Email on, Confirm email on, **Allow new users to sign up** on (only people listed in Users & Access can get an account; the database refuses everyone else).
- **Emails → SMTP settings**: switch on custom SMTP (for example your Google Workspace mailbox, `smtp.gmail.com`, port 465, an app password). Supabase's built-in mailer only sends a handful of emails an hour.
- **Rate Limits**: emails sent per hour at least 60, so inviting the whole team goes through.
- **Emails → Templates**: reword *Confirm signup* (the invite: "You have been added to Garuda CRM. Open this link to sign in and create your password"), *Magic Link* and *Reset Password*; keep `{{ .ConfirmationURL }}`.
- **Providers → Google** (optional): then set `GOOGLE_SIGN_IN=on` in Vercel so the button shows.

**Who can sign in.** Only people listed in **Settings → Users & Access**. Anyone else gets: *"Your email isn't registered in Garuda CRM. Ask your Admin to add you."* Work emails must end in `@garudaaerospace.com` unless **Allow external email** is ticked for that person.

**Users & Access** shows each person's sign-in state (Not invited yet, Invited · not signed in yet, Active with the last sign-in time) and has **Invite everyone not signed in**, **Send invite** and **Send password reset**. **Keep me signed in on this device** can be unticked on shared computers; the menu under your name has **Change password** (asks for the current one) and **Sign out everywhere**.

## 4. Put it on Vercel (10 min)

1. Put this folder in a **private** GitHub repository.
2. vercel.com → **Add New → Project** → import that repository.
   - Framework preset: **Other**. Leave build and output settings as they are (`vercel.json` sets them).
   - **Environment Variables**: `SUPABASE_URL` = the Project URL, `SUPABASE_ANON_KEY` = the anon public key; optional `GOOGLE_SIGN_IN` = `on`.
3. **Deploy**. Open the address Vercel gives you.

Phones: open the address in Chrome (Android) or Safari (iPhone) → **Add to Home screen**. The whole CRM adapts to the phone: a tab bar at the bottom, a menu sheet for every screen, cards instead of wide tables, Kanban columns you swipe.

## 5. People, departments and access

Open **Settings** as Jai Kishore (Admin).

**Users & Access** lists Person + designation, Employee ID, Departments, Role, Reports to, Work email, Daily report and Status. *Not signed in yet* means listed but never signed in (the Settings badge counts these). **Org chart** shows the Reports to tree with "N below" for each person. Changing Reports to can never create a loop.

**Deactivate** (never delete): the dialog moves the person's open leads and deals, planned visits, open escalations and active projects to the person you choose (their Reports to by default), moves their reportees up, and blocks their sign-in.

| Role | Sees | Can do |
|---|---|---|
| C-level | Every screen except Settings, every record | Edit records in their tree, all revenue |
| Admin | Everything, including Settings | Everything |
| Manager / Lead | Every screen except Settings, their own records and everyone below them | Reassign inside their tree, Revenue for their tree |
| Member | Command Centre, Sales Dashboard, My dashboard, Leads & Deals, Field Visits, Accounts, Project Management, Escalations | Own records only; no Revenue unless Finance |

Permission switches per person: **Finance** (verify payments, full ledger), **Email Marketing access**, **Campaigns access**, **Export data**, **Edit Price Book**, **Hide sales screens** (delivery staff see only Field Visits, Project Management and Escalations, for work assigned to them; on for Pooja's 7 trainers, instructors and operations). Someone with nobody below them sees **My dashboard** instead of Team Dashboard.

The database enforces all of this (row level security), so counts, charts, exports and search only ever include records in the person's scope.

**Departments** (name, short code, colour, active, "counts admissions"). Add one and it appears in every filter, Leads & Deals, Kanban, dashboards, Revenue tabs and campaigns. A new department starts with seven default statuses and stages.

**Statuses, stages & targets** per department: lead statuses and deal stages (order, win %, Won / Lost, and whether moving there needs a loss reason, a fee disclosure, or a payment / PO), loss reasons, products / courses, revenue segments and monthly revenue targets.

Also in Settings: **Campaign types** (add a type with its own text, number, date or dropdown fields), **Visits, escalations & rules** (visit purposes, response deadline per severity, when a deal counts as stale, first-contact hours, discount limits), **KRA** weights and targets, GST, lists, email senders, Claude and data import / export.

New web and ad leads are given round-robin to active Members, Leads and Managers who have that department ticked (and not "Hide sales screens"); if nobody has it ticked they go to the Admin. Tick **RPTO** on the telesales people who work RPTO leads.

## 6. Claude, ads and email (optional, 30 min + Meta review)

Install the Supabase CLI, then from this folder:
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=<console.anthropic.com → API keys>
supabase secrets set CRON_SECRET=<random string>
supabase secrets set INTAKE_KEY=<random string for your website form>
supabase secrets set GOOGLE_LEAD_KEY=<random string, also typed into Google Ads>
supabase secrets set META_VERIFY_TOKEN=<random string, also typed into Meta>
supabase secrets set META_APP_SECRET=<Meta app → Settings → Basic → App secret>
supabase secrets set META_PAGE_TOKEN=<long-lived Page token with leads_retrieval>
supabase functions deploy ai
supabase functions deploy lead-intake --no-verify-jwt
supabase functions deploy track --no-verify-jwt
supabase functions deploy webinar --no-verify-jwt
```
Then: Database → Extensions → enable **pg_cron** and **pg_net**; open `supabase/cron.sql`, replace `<PROJECT_REF>` and `<CRON_SECRET>`, run it.

- **Email sending**: as the marketing mailbox, script.google.com → New project → paste `apps-script/Mailer.gs` → Script properties `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service_role), optional `REPLY_TO` → run `testConnection`, then `install`. In the CRM: Settings → Email senders.
- **Google Ads lead forms**: webhook URL `https://<ref>.supabase.co/functions/v1/lead-intake?source=google`, key = `GOOGLE_LEAD_KEY`.
- **Meta Lead Ads**: Webhooks → Page → `leadgen`, callback `https://<ref>.supabase.co/functions/v1/lead-intake?source=meta`, verify token = `META_VERIFY_TOKEN`; permissions `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`.
- **Website forms**: POST JSON (`name, phone, email, city, course, message, utm_*, whatsapp_optin`; add `"department":"CoE"` or any department code, and `"college":"…"` for organisations) to `…/lead-intake?source=website&key=<INTAKE_KEY>`.
- **Ad Campaigns**: give each campaign the same **UTM campaign** value your ads use; web and ad leads carrying that UTM link to the campaign on their own. Enter spend with **Update spend**. "Connect ad account" (automatic spend from Meta / Google) is marked Coming soon.
- **Paid webinars (Razorpay)**: `supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=…`; Razorpay → Webhooks → `https://<ref>.supabase.co/functions/v1/webinar?action=webhook`, event `payment.captured`. Create a webinar as an **Other Campaign** of type Webinar, then **Set up registration page**.

---

## The screens

| Sidebar | What lives there (each number has one home) |
|---|---|
| Garuda Chat (top of the sidebar) | Everyone, a room per team, direct messages and Notes to self, with emoji and reactions. Hover a message to react, make it a task or delete your own. Search inside a chat; the task icon shows every task that came from that chat. A direct message that reads like a task ("Please send the SRM quote by Friday") becomes a task for that person; #task or @name hands one out in a room; Notes to self asks "Add as a task?". |
| Command Centre (C-level, Admin, managers) | The CEO view, in pictures, and every card follows the Team and Period in the filter: the target as a milestone road (quarters, months, weeks or days) with to go, days left, per day and due by today; collected, ad return, win rate and pipeline rings; revenue booked, collected and target by month; each team against its target; spend by channel; the lead → deal → won funnel; the forecast; delivery rings (milestones, escalations in time, visits, tasks). |
| My dashboard (everyone) | Only your own work: your target as a milestone road for the period in the filter and the easiest open deals to close to reach it, KRA score, follow-ups overdue and today, your tasks, your visits (missed ones flagged), your deals by closure date, your KRA. Members land here. |
| Revenue | **Overview** (pictures: target gauge, booked and collected by month against target, booked by team and by segment, collected vs receivable, receivables ageing, top clients), **Targets** (the breakup: team → segment → executive, yearly / monthly / weekly, achieved and %, this month and this week per executive, and how the team hits the month), **By team**, a tab per team, and the **Ledger**. |
| Sales Dashboard | **Needs action** first (follow-ups overdue, not contacted in time, deals past closure date or quiet, visits overdue and today, tasks overdue, escalations, payments to verify, milestones, renewals), then inflow, a funnel per team, conversion, pipeline, deals by closure month, won / lost, stuck deals, product interest, admissions. |
| Team Dashboard (people with a team) | **Team KRA** (score and what drives it for each person), targets this month by person, the per-person table, leaderboard and **Who owns what** with bulk reassign. |
| Task Dashboard | **Quick task** box (write it, choose Myself or anyone, a due date, Add), my open tasks, tasks I gave to others, by person, latest work done, due soon, overdue. |
| Leads · Deals | Two separate screens, each a list or a Kanban; filter by team with the Team dropdown (no team sub-items in the sidebar). Column filters for status, owner, company and dates are dropdowns, and record fields such as city, client type, education and designation are dropdowns with "Other…" to add a new value. **Convert to deal**, Won asks the final value, Lost asks a reason, **Call mode**. In a record, **Transfer** sends an enquiry that belongs to another team (RPTO, CoE, DaaS…) to that team: it starts at the team's first status and goes to the person you pick or the next in turn; the history stays and a note records why. |
| Field Visits · Accounts | As before. |
| Email Marketing · Ad Campaigns · Other Campaigns | As before. |
| Tasks · Project Management · Escalations | As before; tasks can be given to anyone. |
| Under your name (bottom of the sidebar) | **Price Book** (each team and category is its own card), **Settings** (Admin), Change password, Sign out. |

**Targets:** set in **Settings → Sales targets** (Admin). Choose the financial year (April to March) and a team card, then enter the team's yearly target, the split by segment and by executive (Split evenly helps), and the phasing by month. Revenue → Targets shows the breakup; it does not edit. Monthly follows the monthly targets in Settings → Statuses & lists when they are set (otherwise a twelfth), weekly is this month's share for seven days, today is this month's share for one working day. Achieved counts won deals by the date won plus ledger totals imported from the sheet. The plan works out the run rate, the number of deals at your usual deal size, and lists the open deals most likely to close soon whose value covers the gap.

**Reminders:** the bell on the top bar lists visits and meetings coming up and missed, follow-ups due and missed, tasks due and overdue, escalations past deadline, late milestones and unread chat; managers also see visits in their team not checked in for a day. Anything that falls due pops up; missed items come back every 30 minutes until someone acts, snoozes (1 hour) or dismisses them. "Also alert me on this computer" turns on desktop notifications.

Every dashboard and report has the same filter bar: **Team** (a dropdown: All teams or one), **Period** (Today, Week, Month, Quarter, FY, Custom) and **Person** (people in your scope). Your choices are remembered on your device.

**Colours on records:** green = won or likely (deal at 60% or more), amber = needs attention (overdue follow-up, past closure date, quiet deal, RNR / Not Updated), red = lost, grey = closed but not lost (Duplicate, Other Department, CoE Leads). Duplicates are not counted as lost or as open; mark any status this way with **Closed, not lost** in Settings → Statuses, stages & lists.

**Numbers:** every amount is written in full with Indian commas (₹1,20,00,000), also while you type it; chart axes use L and Cr to stay readable.

**Departments:** a person belongs to the departments ticked for them in Users & Access. Filters, team lists, targets and team chat rooms follow those ticks. Someone moved out of a department who still owns open records there shows in Who owns what as "not in X any more" so their records can be reassigned.

**Company and logo:** Settings → Company & logo (name, tagline, logo, office city for the weather, an announcement for the welcome panel).

## Upgrading a database that already ran v4

Run `schema.sql` again. It adds sales targets, lead transfer, Garuda Chat (with reactions), lets anyone give a task to anyone, and makes Duplicate / Other Department / CoE Leads "closed, not lost". Nothing is deleted.

## Upgrading a database that already ran v3

Run `schema.sql` and then `seed.sql` again. They:
- add the departments, people directory (with Reports to), roles and permission switches, and switch access to the Reports to tree;
- turn leads at deal stages (RPTO Pipeline / Converted, the CoE pipeline) into deals on the same record;
- deactivate anyone not on the list of 15 and hand their records to their manager or Jai Kishore;
- turn Institutions into Accounts, Complaints into Escalations and Webinars into Other Campaigns of type Webinar;
- tie the revenue ledger and targets to departments.

Nothing is deleted. Old screens' addresses (Pipeline, Telecalling, Lead ownership, AI insights, Performance, Webinars, Complaints, Institutions) open their new home.

## Rules the database enforces

- A deal stage needs the record to be a deal (Convert to deal first); a lead status cannot be used on a deal.
- Stages marked "needs fee" (RPTO Pipeline, Converted) need the fee told to the client recorded first; "needs payment" (RPTO Converted, CoE Closed Won) needs a payment or a PO reference.
- Lost stages need a loss reason.
- Members cannot reassign; managers can only assign to people in their own tree.
- Visits: Done needs an outcome; moving the date keeps the old one.
- Every remark carries the server's timestamp; edits keep the original text. Every change to leads and payments is in the audit log.

## Testing kit (developers)

`tests/` rebuilds a local Postgres with Supabase-style auth and runs the same SQL files: `fresh_db.sh`, `team.sql` (sign-ins for the 10 people with Garuda or external emails), `db_tests.sql` (scope, gates, projects, escalations, deactivation, sign-in rules), `shim.py` + `sb-mock.js` (a local stand-in for Supabase's REST API with row level security), `e2e.js` (every screen for every person) and `e2e-flows.js` (the v4 acceptance checklist end to end).
