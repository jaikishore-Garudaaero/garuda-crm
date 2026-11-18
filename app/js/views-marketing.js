/* Garuda CRM · email marketing (campaigns, automations, audiences, templates, reports), Ads & ROI, webinars */
'use strict';

function renderTpl(tpl, vars) { return String(tpl || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => (vars[k.toLowerCase()] ?? '')); }
function leadVars(l) {
  const nb = null; /* batches are no longer kept in the CRM */
  const first = (l.contact_name || l.name || '').split(' ').filter((x) => !/^(dr|prof|mr|ms|mrs)\.?$/i.test(x))[0] || '';
  return { first_name: first, name: l.contact_name || l.name, email: l.email, institution: L.inst(l)?.name || '', company: L.inst(l)?.name || '', product: L.product(l)?.name || 'our drone programmes', price: l.unit_price ? inrFull(l.unit_price) : '', owner_name: DB.pname(l.owner) === 'Unassigned' ? 'Team Garuda' : DB.pname(l.owner), next_batch: nb ? fmtDate(nb.start_date) : 'the next available date', centre: nb?.centre || 'Chennai', month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
}
const MERGE_HELP = '{{first_name}} {{name}} {{institution}} {{company}} {{product}} {{price}} {{next_batch}} {{centre}} {{owner_name}} {{month}}';
const SAMPLE_VARS = { first_name: 'Priya', last_name: 'S', name: 'Priya S', email: 'priya@example.com', institution: 'Velalar College', company: 'Velalar College', product: 'Small Class RPC', price: '₹20,000', owner_name: 'Pooja', next_batch: '2 Nov', centre: 'Chennai', month: 'November 2026', webinar: 'DGCA drone pilot career masterclass', date: 'Saturday, 31 Oct 2026', time: '06:00 pm IST', meeting_link: 'https://meet.google.com/abc-defg-hij', recording_link: 'https://youtu.be/recording' };
const safeHTML = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
/* who is on a list right now (the same rules as public.list_recipients in the database) */
function contactVars(c) { return { first_name: c.first_name || (c.email || '').split('@')[0], last_name: c.last_name || '', name: `${c.first_name || ''} ${c.last_name || ''}`.trim(), email: c.email, company: c.company || '', institution: c.company || '', owner_name: 'Team Garuda', month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }; }
function listAudience(li) {
  if (!li) return [];
  const f = li.filter || {};
  const fromContact = (c) => ({ email: c.email, name: `${c.first_name || ''} ${c.last_name || ''}`.trim(), lead_id: c.lead_id, contact_id: c.id, vars: contactVars(c), consent: !!c.subscribed && !c.bounced });
  if (li.kind === 'Static') return DB.t.email_list_members.filter((m) => m.list_id === li.id).map((m) => DB.get('email_contacts', m.contact_id)).filter(Boolean).map(fromContact);
  if (f.target === 'contacts') return DB.t.email_contacts.filter((c) => !(f.tags || []).length || (c.tags || []).some((x) => f.tags.includes(x))).map(fromContact);
  const has = (arr) => Array.isArray(arr) && arr.length;
  return DB.t.leads.filter((l) => l.email && (!f.funnel || f.funnel === 'Both' || l.funnel === f.funnel) && (!has(f.stages) || f.stages.includes(l.stage)) && (!has(f.sources) || f.sources.includes(l.source))
    && (!has(f.temperatures) || f.temperatures.includes(l.temperature)) && (!has(f.ai_bands) || f.ai_bands.includes(l.ai_band)) && (!has(f.tiers) || f.tiers.includes(l.campaign_tier))
    && ((f.status || 'open') === 'all' || (f.status === 'won' ? L.won(l) : f.status === 'lost' ? L.lost(l) : L.open(l)))
    && (f.min_age === undefined || f.min_age === '' || daysAgo(l.created_at) >= Number(f.min_age)) && (f.max_age === undefined || f.max_age === '' || daysAgo(l.created_at) <= Number(f.max_age)))
    .map((l) => ({ email: l.email, name: l.contact_name || l.name, lead_id: l.id, contact_id: null, vars: leadVars(l), consent: !!l.consent_email && !l.opted_out }));
}

/* ================= quick compose (from leads, segments, team) ================= */
function composeEmail({ leadIds = [], title = 'Recipients', after, category } = {}) {
  if (!canEmail()) return toast('You do not have email marketing access. Ask the Business Head.', true);
  const leads = leadIds.map((id) => DB.get('leads', id)).filter(Boolean);
  const unsub = new Set(DB.t.unsubscribes.map((u) => u.email.toLowerCase()));
  const m = openModal({ title: 'Send email · ' + esc(title), width: 900,
    body: `<div class="form">
      ${fld('ecat', 'Email type', sel('ecat', EMAIL_CATS, category || (leads.length === 1 ? 'Follow-up' : 'Marketing')))}
      ${fld('etpl', 'Template', '<select id="etpl"></select>')}
      ${fld('eaud', 'Audience', `<select id="eaud"><option value="leads">${leads.length} selected lead${leads.length === 1 ? '' : 's'}</option><option value="team">Internal team (all active staff)</option></select>`)}
      ${fld('ecamp', 'Campaign', `<select id="ecamp"><option value="">No campaign</option><option value="__new">New campaign…</option>${DB.t.campaigns.filter((c) => c.channel === 'Email').map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`)}
      ${fld('esub', 'Subject', inp('esub'), 'full')}
      ${fld('ebody', `Body (HTML) · merge tags: <span class="mono" style="font-size:11px">${MERGE_HELP}</span>`, '<textarea id="ebody" style="min-height:180px;font-family:var(--f-mono);font-size:12.5px"></textarea>', 'full')}
      ${fld('ewhen', 'Send', `<select id="ewhen"><option value="now">Now (mailer sends within a minute)</option><option value="later">Schedule…</option></select>`)}${fld('eat', 'Scheduled time', inp('eat', dtLocal(new Date(Date.now() + 3600e3).toISOString()), 'datetime-local', 'disabled'))}
    </div><div id="eaudit" class="note info"></div><h4>Preview (first recipient)</h4><div id="eprev" class="mailprev"></div>`,
    foot: `<span class="faint" id="esender" style="margin-right:auto;font-size:12.5px"></span><button class="btn" data-c>Cancel</button><button class="btn primary" id="esend">${svg('send')} Queue emails</button>` });
  const el = m.el;
  const fillTpl = () => { const cat = v(el, 'ecat'); const ts = DB.t.email_templates.filter((t) => t.active && (t.category === cat || cat === 'Follow-up')); el.querySelector('#etpl').innerHTML = `<option value="">Blank</option>` + ts.map((t) => `<option value="${t.id}">${esc(t.name)} · ${esc(t.category)}</option>`).join(''); const first = ts.find((t) => t.category === cat); if (first) { el.querySelector('#etpl').value = first.id; useTpl(); } upd(); };
  const useTpl = () => { const t = DB.get('email_templates', v(el, 'etpl')); if (t) { el.querySelector('#esub').value = t.subject; el.querySelector('#ebody').value = t.html; } upd(); };
  const recipients = () => {
    const cat = v(el, 'ecat');
    if (v(el, 'eaud') === 'team') return { ok: DB.t.profiles.filter((p) => p.active && p.role !== 'pending' && p.email).map((p) => ({ email: p.email, name: p.full_name, vars: { first_name: p.full_name.split(' ')[0], name: p.full_name, owner_name: DB.me.full_name, month: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }) } })), skipped: [] };
    const ok = [], skipped = [];
    leads.forEach((l) => {
      if (!l.email) return skipped.push([l, 'no email']);
      if (cat !== 'Internal update' && (l.opted_out || unsub.has(l.email.toLowerCase()))) return skipped.push([l, 'unsubscribed']);
      if (['Marketing', 'Newsletter', 'Training update'].includes(cat) && !l.consent_email) return skipped.push([l, 'no email consent']);
      ok.push({ lead: l, email: l.email, name: l.contact_name || l.name, vars: leadVars(l) });
    });
    return { ok, skipped };
  };
  const upd = () => {
    const { ok, skipped } = recipients(); const cat = v(el, 'ecat');
    const why = Object.entries(groupBy(skipped, (s) => s[1])).map(([k, a]) => `${a.length} ${k}`).join(', ');
    el.querySelector('#eaudit').innerHTML = `<b>${ok.length}</b> will receive this email.${skipped.length ? ` Skipped ${skipped.length}: ${why}.` : ''}`;
    const sender = DB.settings.email?.senders?.[cat] || '';
    el.querySelector('#esender').textContent = sender ? `From ${sender}` : 'From the marketing mailbox (set senders in Settings → Email)';
    const f = ok[0];
    el.querySelector('#eprev').innerHTML = f ? `<div style="font-size:12px;color:#667">To: ${esc(f.name)} &lt;${esc(f.email)}&gt;</div><div style="font-weight:700;margin:4px 0 10px">${esc(renderTpl(v(el, 'esub'), f.vars))}</div>${safeHTML(renderTpl(v(el, 'ebody'), f.vars))}` : '<span style="color:#667">No eligible recipients.</span>';
    el.querySelector('#esend').disabled = !ok.length;
    el.querySelector('#esend').innerHTML = `${svg('send')} Queue ${ok.length} email${ok.length === 1 ? '' : 's'}`;
  };
  el.querySelector('#ecat').onchange = fillTpl; el.querySelector('#etpl').onchange = useTpl; el.querySelector('#eaud').onchange = upd;
  ['esub', 'ebody'].forEach((id) => (el.querySelector('#' + id).oninput = upd));
  el.querySelector('#ewhen').onchange = () => (el.querySelector('#eat').disabled = v(el, 'ewhen') !== 'later');
  el.querySelector('[data-c]').onclick = m.close;
  fillTpl();
  if (!leads.length) { el.querySelector('#eaud').value = 'team'; el.querySelector('#ecat').value = category || 'Internal update'; fillTpl(); }
  el.querySelector('#esend').onclick = () => guard(async () => {
    const { ok } = recipients(); const cat = v(el, 'ecat');
    if (!v(el, 'esub').trim()) throw new Error('Add a subject');
    let campaign_id = v(el, 'ecamp') || null;
    if (campaign_id === '__new') { const n = await promptBox('New email campaign', 'Campaign name', title); if (!n) return; campaign_id = (await DB.insert('campaigns', { name: n, channel: 'Email', purpose: cat, status: 'Sent', subject: v(el, 'esub'), html: v(el, 'ebody'), sent_at: nowISO(), start_date: todayStr() })).id; }
    const when = v(el, 'ewhen') === 'later' ? fromLocal(v(el, 'eat')) : nowISO();
    const sender = DB.settings.email?.senders?.[cat] || '';
    const rows = ok.map((r) => ({ campaign_id, template_id: v(el, 'etpl') || null, lead_id: r.lead?.id || null, to_email: r.email, to_name: r.name, category: cat, subject: renderTpl(v(el, 'esub'), r.vars), html: renderTpl(v(el, 'ebody'), r.vars), sender, scheduled_at: when }));
    for (let i = 0; i < rows.length; i += 200) await DB.insertMany('email_queue', rows.slice(i, i + 200));
    m.close(); toast(`${rows.length} email${rows.length === 1 ? '' : 's'} queued`); after?.();
  });
}

/* ================= metrics ================= */
function mailStats(rows) {
  const sent = rows.filter((e) => e.status === 'Sent');
  const bounced = sent.filter((e) => e.bounced_at).length;
  const emails = new Set(sent.map((e) => e.to_email.toLowerCase()));
  const first = sent.map((e) => e.sent_at || e.created_at).sort()[0];
  const unsub = first ? DB.t.unsubscribes.filter((u) => emails.has(u.email.toLowerCase()) && u.created_at >= first).length : 0;
  const delivered = sent.length - bounced;
  return { queued: rows.filter((e) => e.status === 'Queued').length, failed: rows.filter((e) => e.status === 'Failed').length, skipped: rows.filter((e) => e.status === 'Skipped').length, sent: sent.length, delivered, bounced, opens: sent.filter((e) => e.opened_at).length, clicks: sent.filter((e) => e.clicked_at).length, replies: sent.filter((e) => e.replied_at).length, unsub };
}
function campaignMail(c) {
  const rows = DB.t.email_queue.filter((e) => e.campaign_id === c.id);
  if (!rows.length && c.stats?.sent) { const s = c.stats; return { queued: 0, failed: 0, skipped: 0, sent: s.sent, delivered: s.sent - (s.bounces || 0), bounced: s.bounces || 0, opens: s.opens || 0, clicks: s.clicks || 0, replies: s.replies || 0, unsub: s.unsubscribes || 0, imported: true }; }
  return mailStats(rows);
}
const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
function statBar(s) { const t = Math.max(1, s.sent); return `<div class="statbar" title="Opened ${s.opens} · clicked ${s.clicks} · replied ${s.replies} · bounced ${s.bounced}"><i style="width:${(s.replies / t) * 100}%;background:var(--good)"></i><i style="width:${((s.clicks - Math.min(s.clicks, s.replies)) / t) * 100}%;background:var(--violet)"></i><i style="width:${((s.opens - Math.min(s.opens, s.clicks)) / t) * 100}%;background:var(--sky-acc)"></i><i style="width:${(s.bounced / t) * 100}%;background:var(--bad)"></i></div>`; }

/* ================= Email marketing ================= */
let emTab = 'overview';
VIEWS.email = {
  title: 'Email marketing', sub: 'Campaigns, newsletters, automations and drips, audiences, templates and reports. Sent from your marketing mailbox with open, click, reply, bounce and unsubscribe tracking.',
  actions: () => (canEmail() ? `<button class="btn" id="emauto">${svg('spark')} New automation</button><button class="btn primary" id="emcamp">${svg('plus')} New campaign</button>` : ''),
  render(el) {
    const tabs = [['overview', 'Overview'], ['campaigns', 'Campaigns'], ['automations', 'Automations'], ['audiences', 'Audiences'], ['templates', 'Templates'], ['reports', 'Reports'], ['activity', 'Activity log']];
    el.innerHTML = `<div class="seg" role="tablist">${tabs.map(([k, t]) => `<button data-emt="${k}" aria-pressed="${emTab === k}">${t}</button>`).join('')}</div><div id="emb" class="view"></div>`;
    el.querySelectorAll('[data-emt]').forEach((b) => (b.onclick = () => { emTab = b.dataset.emt; this.render(el); }));
    const re = () => this.render(el);
    ({ overview: emOverview, campaigns: emCampaigns, automations: emAutomations, audiences: emAudiences, templates: emTemplates, reports: emReports, activity: emActivity })[emTab](el.querySelector('#emb'), re);
  },
  mount() { $('#emcamp')?.addEventListener('click', () => campaignBuilder({}, () => render())); $('#emauto')?.addEventListener('click', () => sequenceEditor({}, () => render())); },
};

function emOverview(b, re) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const recent = DB.t.email_queue.filter((e) => (e.sent_at || e.created_at) >= since);
  const s = mailStats(recent);
  const lim = DB.settings.email?.daily_limit || 1500;
  const today = DB.t.email_queue.filter((e) => e.status === 'Sent' && localDate(e.sent_at || e.created_at) === todayStr()).length;
  const days = Array.from({ length: 14 }, (_, k) => { const d = new Date(); d.setDate(d.getDate() - 13 + k); return localDate(d); });
  const byDay = (cat) => days.map((d) => DB.t.email_queue.filter((e) => e.status === 'Sent' && localDate(e.sent_at || e.created_at) === d && (cat === 'auto' ? !!(e.auto_rule || e.enrollment_id) : !(e.auto_rule || e.enrollment_id))).length);
  const camps = DB.t.campaigns.filter((c) => c.channel === 'Email').sort((a, c) => (c.sent_at || c.scheduled_at || c.created_at || '').localeCompare(a.sent_at || a.scheduled_at || a.created_at || '')).slice(0, 6);
  const seqs = DB.t.email_sequences.filter((x) => x.active);
  const contacts = DB.t.email_contacts;
  b.innerHTML = `<div class="kpis">
    ${kpi({ label: 'Sent · last 30 days', value: s.sent, sub: `${s.queued} queued now`, color: 'var(--c1)' })}${kpi({ label: 'Open rate', value: rate(s.opens, s.delivered) + '%', sub: `${s.opens} opened`, color: 'var(--c2)' })}${kpi({ label: 'Click rate', value: rate(s.clicks, s.delivered) + '%', sub: `${s.clicks} clicked`, color: 'var(--c3)' })}${kpi({ label: 'Reply rate', value: rate(s.replies, s.delivered) + '%', sub: `${s.replies} replies · each creates a task`, color: 'var(--c4)' })}${kpi({ label: 'Bounce rate', value: rate(s.bounced, s.sent) + '%', sub: `${s.bounced} bounced · ${s.failed} failed`, color: 'var(--c6)' })}${kpi({ label: 'Unsubscribed', value: DB.t.unsubscribes.length, sub: `${s.unsub} after recent emails` })}
    ${kpi({ label: 'Contacts', value: contacts.length + DB.t.leads.filter((l) => l.email).length, sub: `${contacts.length} imported contacts · ${DB.t.leads.filter((l) => l.email && l.consent_email && !l.opted_out).length} leads with consent` })}${kpi({ label: 'Sent today', value: `${today} / ${lim}`, sub: 'mailbox daily limit', meter: pct(today, lim) })}</div>
  <div class="grid g21"><section class="glass panel"><div class="panel-head"><h2>Emails sent · last 14 days</h2></div>${barChart({ labels: days.map((d) => String(new Date(d + 'T12:00').getDate())), series: [{ name: 'Campaigns and one-off', color: 'var(--c1)', values: byDay('manual') }, { name: 'Automations', color: 'var(--c3)', values: byDay('auto') }], stacked: true, fmt: (x) => String(Math.round(x)), height: 200 })}</section>
    <section class="glass panel"><div class="panel-head"><h2>Running automations</h2><button class="btn small" data-goto="automations">All</button></div><div class="list">${seqs.map((x) => { const en = DB.t.sequence_enrollments.filter((e) => e.sequence_id === x.id); return `<div class="item"><span class="dot good"></span><div class="grow"><b>${esc(x.name)}</b><div class="faint" style="font-size:12px">${esc(SEQ_TRIGGERS[x.trigger] || x.trigger)} · ${en.filter((e) => e.status === 'Active').length} active · ${en.filter((e) => e.status === 'Replied').length} replied</div></div></div>`; }).join('') || empty('No automations running', 'Turn one on under Automations.')}</div></section></div>
  <section class="glass panel"><div class="panel-head"><h2>Recent campaigns</h2><button class="btn small" data-goto="campaigns">All campaigns</button></div>${campaignTable(camps)}</section>`;
  b.querySelectorAll('[data-goto]').forEach((x) => (x.onclick = () => { emTab = x.dataset.goto; re(); }));
  bindCampaignRows(b, re);
}

function campaignTable(cs) {
  if (!cs.length) return empty('No email campaigns yet', canEmail() ? 'Create one with New campaign.' : '');
  return `<div class="tablewrap"><table><thead><tr><th>Campaign</th><th>Status</th><th>Audience</th><th class="n">Sent</th><th class="n">Open</th><th class="n">Click</th><th class="n">Reply</th><th class="n">Bounce</th><th class="n">Unsub</th><th style="width:120px">Engagement</th><th></th></tr></thead><tbody>
  ${cs.map((c) => { const s = campaignMail(c); const lists = (c.list_ids || []).map((id) => DB.get('email_lists', id)?.name).filter(Boolean); return `<tr class="click" data-cid="${c.id}"><td><b>${esc(c.name)}</b><div class="s">${esc(c.purpose || '')}${c.subject_b ? ' · A/B test' : ''}${s.imported ? ' · imported history' : ''} · ${c.sent_at ? 'sent ' + fmtDT(c.sent_at) : c.scheduled_at ? 'scheduled ' + fmtDT(c.scheduled_at) : 'created ' + fmtDate(c.created_at)}</div></td>
    <td><span class="chip ${c.status === 'Sent' ? 'good' : c.status === 'Scheduled' ? 'acc' : c.status === 'Paused' ? 'warn' : ''}">${esc(c.status)}</span></td><td class="s">${esc(lists.join(', ') || '—')}</td>
    <td class="n">${s.sent || c.recipients || 0}</td><td class="n">${rate(s.opens, s.delivered)}%</td><td class="n">${rate(s.clicks, s.delivered)}%</td><td class="n">${rate(s.replies, s.delivered)}%</td><td class="n">${rate(s.bounced, s.sent)}%</td><td class="n">${s.unsub}</td><td>${s.sent ? statBar(s) : ''}</td>
    <td class="n" onclick="event.stopPropagation()">${canEmail() ? `<button class="btn ghost small" data-dup="${c.id}" title="Duplicate">Copy</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function bindCampaignRows(b, re) {
  b.querySelectorAll('[data-cid]').forEach((tr) => (tr.onclick = () => { const c = DB.get('campaigns', tr.dataset.cid); if (['Draft', 'Paused'].includes(c.status) && !c.sent_at && canEmail()) campaignBuilder(c, re); else campaignReport(c, re); }));
  b.querySelectorAll('[data-dup]').forEach((x) => (x.onclick = () => guard(async () => { const c = DB.get('campaigns', x.dataset.dup); const { id, sent_at, recipients, stats, created_at, ...rest } = c; const n = await DB.insert('campaigns', { ...rest, name: c.name + ' (copy)', status: 'Draft', scheduled_at: null, sent_at: null, recipients: 0, stats: {}, channel: 'Email' }); campaignBuilder(n, re); }, 'Copied as a draft')));
}

let emCF = { status: '' };
function emCampaigns(b, re) {
  const cs = DB.t.campaigns.filter((c) => c.channel === 'Email' && (!emCF.status || c.status === emCF.status)).sort((a, c) => (c.sent_at || c.scheduled_at || c.created_at || '').localeCompare(a.sent_at || a.scheduled_at || a.created_at || ''));
  b.innerHTML = `<section class="glass panel"><div class="panel-head"><div class="seg">${[['', 'All'], ['Draft', 'Drafts'], ['Scheduled', 'Scheduled'], ['Sent', 'Sent'], ['Paused', 'Paused']].map(([k, t]) => `<button data-cf="${k}" aria-pressed="${emCF.status === k}">${t}</button>`).join('')}</div>${canEmail() ? `<button class="btn small primary" id="cnew">${svg('plus')} New campaign</button>` : ''}</div>${campaignTable(cs)}</section>`;
  b.querySelectorAll('[data-cf]').forEach((x) => (x.onclick = () => { emCF.status = x.dataset.cf; re(); }));
  b.querySelector('#cnew')?.addEventListener('click', () => campaignBuilder({}, re));
  bindCampaignRows(b, re);
}

/* ---------- campaign builder: setup → audience → content → review & send ---------- */
const BLOCKS = {
  Heading: '<h2 style="font-family:Arial,sans-serif;color:#0d2140;margin:0 0 12px">Your headline here</h2>',
  Text: '<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a2233">Dear {{first_name}},</p>\n<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a2233">Write your message here.</p>',
  Button: '<p style="margin:18px 0"><a href="https://www.garudaaerospace.com" style="background:#005aa9;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;display:inline-block">Book your seat</a></p>',
  Image: '<p style="margin:12px 0"><img src="https://www.garudaaerospace.com/images/banner.jpg" alt="Garuda Aerospace" width="560" style="max-width:100%;border-radius:10px"></p>',
  'Two columns': '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" style="padding:8px;vertical-align:top;font-family:Arial,sans-serif;font-size:14px"><b>Small Class RPC</b><br>6 days · {{price}} + GST</td><td width="50%" style="padding:8px;vertical-align:top;font-family:Arial,sans-serif;font-size:14px"><b>Medium Class RPC</b><br>Agri drones up to 150 kg</td></tr></table>',
  Divider: '<hr style="border:0;border-top:1px solid #dde3ee;margin:20px 0">',
  Signature: '<p style="font-family:Arial,sans-serif;font-size:14px;color:#1a2233">Regards,<br><b>{{owner_name}}</b><br>Garuda Aerospace<br><span style="color:#667">Chennai · www.garudaaerospace.com</span></p>',
};
function brandWrap(inner) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fa;padding:20px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#005aa9;padding:16px 24px;color:#ffffff;font-family:Arial,sans-serif;font-weight:bold;font-size:18px">Garuda Aerospace</td></tr>
<tr><td style="padding:24px">\n${inner}\n</td></tr></table></td></tr></table>`;
}
function campaignBuilder(c0 = {}, after) {
  if (!canEmail()) return toast('You do not have email marketing access', true);
  const c = { name: '', purpose: 'Newsletter', sender: '', reply_to: '', list_ids: [], exclude_list_ids: [], subject: '', subject_b: '', ab_split: 0, preheader: '', html: '', template_id: null, status: 'Draft', ...JSON.parse(JSON.stringify(c0)) };
  let step = 0; let device = 'desktop';
  const STEPS = ['Setup', 'Audience', 'Content', 'Review & send'];
  const m = openModal({ title: c.id ? `Campaign · ${esc(c.name)}` : 'New email campaign', width: 1180, body: '<div class="steps" id="cb_steps"></div><div id="cb_body" class="stack"></div>',
    foot: `<button class="btn" id="cb_draft" style="margin-right:auto">Save draft</button><button class="btn" id="cb_prev">Back</button><button class="btn primary" id="cb_next">Next</button>` });
  const el = m.el;
  const lists = () => DB.t.email_lists.slice().sort((a, b) => a.name.localeCompare(b.name));
  const audience = () => {
    const seen = new Set(); const ex = new Set(c.exclude_list_ids.flatMap((id) => listAudience(DB.get('email_lists', id)).map((x) => x.email.toLowerCase())));
    const uns = new Set(DB.t.unsubscribes.map((u) => u.email.toLowerCase())); let dup = 0, excl = 0, unsub = 0, noConsent = 0; const ok = [];
    c.list_ids.flatMap((id) => listAudience(DB.get('email_lists', id))).forEach((x) => { const e = x.email.toLowerCase(); if (seen.has(e)) { dup++; return; } seen.add(e); if (ex.has(e)) { excl++; return; } if (uns.has(e)) { unsub++; return; } if (!x.consent && c.purpose !== 'Internal update') { noConsent++; return; } ok.push(x); });
    return { ok, dup, excl, unsub, noConsent };
  };
  const capture = () => {
    const g = (id) => el.querySelector('#' + id);
    if (step === 0) { c.name = v(el, 'cb_name'); c.purpose = v(el, 'cb_type'); c.sender = v(el, 'cb_from'); c.reply_to = v(el, 'cb_reply'); }
    if (step === 1) { c.list_ids = $$('.cb_inc:checked', el).map((x) => x.value); c.exclude_list_ids = $$('.cb_exc:checked', el).map((x) => x.value); }
    if (step === 2) { c.subject = v(el, 'cb_sub'); c.subject_b = g('cb_ab').checked ? v(el, 'cb_subb') : ''; c.ab_split = g('cb_ab').checked ? Number(v(el, 'cb_split')) || 50 : 0; c.preheader = v(el, 'cb_pre'); c.html = v(el, 'cb_html'); }
  };
  const check = (k) => {
    if (k >= 0 && !c.name.trim()) return 'Name the campaign';
    if (k >= 1 && !c.list_ids.length) return 'Choose at least one audience list';
    if (k >= 2 && (!c.subject.trim() || !c.html.trim())) return 'Add a subject and the email content';
    return null;
  };
  const save = async (patch = {}) => {
    const row = { name: c.name || 'Untitled campaign', channel: 'Email', purpose: c.purpose, sender: c.sender, reply_to: c.reply_to, list_ids: c.list_ids, exclude_list_ids: c.exclude_list_ids, subject: c.subject, subject_b: c.subject_b, ab_split: c.ab_split, preheader: c.preheader, html: c.html, template_id: c.template_id, status: c.status, funnel: 'Both', ...patch };
    if (c.id) Object.assign(c, await DB.update('campaigns', c.id, row)); else Object.assign(c, await DB.insert('campaigns', { ...row, start_date: todayStr() }));
  };
  const draw = () => {
    el.querySelector('#cb_steps').innerHTML = STEPS.map((t, i) => `<button data-step="${i}" ${i === step ? 'aria-current="step"' : ''} class="${i < step ? 'done' : ''}"><i>${i < step ? '✓' : i + 1}</i>${t}</button>`).join('');
    el.querySelectorAll('[data-step]').forEach((x) => (x.onclick = () => { capture(); const to = +x.dataset.step; const err = to > step ? check(to - 1) : null; if (err) return toast(err, true); step = to; draw(); }));
    el.querySelector('#cb_prev').hidden = step === 0;
    el.querySelector('#cb_next').innerHTML = step === 3 ? `${svg('send')} Send now` : 'Next';
    const bd = el.querySelector('#cb_body');
    if (step === 0) {
      const senders = DB.settings.email?.senders || {};
      bd.innerHTML = `<div class="form">${fld('cb_name', 'Campaign name (internal)', inp('cb_name', c.name, 'text', 'placeholder="e.g. November newsletter · RPTO"'))}${fld('cb_type', 'Email type', sel('cb_type', EMAIL_CATS, c.purpose))}
        ${fld('cb_from', 'From address', `<select id="cb_from"><option value="">Default for this type${senders[c.purpose] ? ' · ' + esc(senders[c.purpose]) : ''}</option>${[...new Set(Object.values(senders).filter(Boolean))].map((x) => `<option ${x === c.sender ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}${fld('cb_reply', 'Reply-to (optional)', inp('cb_reply', c.reply_to, 'email', 'placeholder="replies go to the sender if blank"'))}</div>
        <div class="note info">Newsletters, marketing and training updates go only to people who gave email consent and have not unsubscribed. Every email carries an unsubscribe link and tracks opens, clicks, replies and bounces.</div>`;
    } else if (step === 1) {
      const a = audience();
      bd.innerHTML = `<div class="grid g2"><section><h3>Send to</h3><div class="list scrollbox">${lists().map((li) => `<label class="item" style="cursor:pointer"><input type="checkbox" class="cb_inc" value="${li.id}" ${c.list_ids.includes(li.id) ? 'checked' : ''}><div class="grow"><b>${esc(li.name)}</b> <span class="chip ${li.kind === 'Dynamic' ? 'acc' : ''}">${li.kind}</span><div class="faint" style="font-size:12px">${listAudience(li).length} people · ${esc(li.description || '')}</div></div></label>`).join('') || empty('No lists yet', 'Create one under Audiences.')}</div></section>
        <section><h3>Don't send to</h3><div class="list scrollbox">${lists().map((li) => `<label class="item" style="cursor:pointer"><input type="checkbox" class="cb_exc" value="${li.id}" ${c.exclude_list_ids.includes(li.id) ? 'checked' : ''}><div class="grow"><b>${esc(li.name)}</b><div class="faint" style="font-size:12px">${listAudience(li).length} people</div></div></label>`).join('')}</div></section></div>
        <div class="note ok" id="cb_aud"><b>${a.ok.length}</b> will receive this campaign${a.dup ? ` · ${a.dup} duplicates removed` : ''}${a.excl ? ` · ${a.excl} excluded` : ''}${a.unsub ? ` · ${a.unsub} unsubscribed` : ''}${a.noConsent ? ` · ${a.noConsent} without email consent or bounced` : ''}.${DB.mode === 'live' ? ' Final count is worked out on the server when it sends.' : ''}</div>
        <div class="row"><button class="btn small" id="cb_newlist">${svg('plus')} New audience list</button></div>`;
      const recount = () => { capture(); const x = audience(); el.querySelector('#cb_aud').innerHTML = `<b>${x.ok.length}</b> will receive this campaign${x.dup ? ` · ${x.dup} duplicates removed` : ''}${x.excl ? ` · ${x.excl} excluded` : ''}${x.unsub ? ` · ${x.unsub} unsubscribed` : ''}${x.noConsent ? ` · ${x.noConsent} without email consent or bounced` : ''}.`; };
      $$('.cb_inc,.cb_exc', bd).forEach((x) => (x.onchange = recount));
      bd.querySelector('#cb_newlist').onclick = () => listEditor({}, () => { capture(); draw(); });
    } else if (step === 2) {
      const tpls = DB.t.email_templates.filter((t) => t.active);
      bd.innerHTML = `<div class="form">${fld('cb_tpl', 'Start from a template', `<select id="cb_tpl"><option value="">Keep current content</option><option value="__blank">Blank branded layout</option>${tpls.map((t) => `<option value="${t.id}">${esc(t.name)} · ${esc(t.category)}</option>`).join('')}</select>`)}${fld('cb_pre', 'Preheader (the grey preview line in the inbox)', inp('cb_pre', c.preheader, 'text', 'maxlength="140"'))}
        ${fld('cb_sub', 'Subject line', inp('cb_sub', c.subject, 'text', 'maxlength="150"'), 'full')}
        <label class="check full"><input type="checkbox" id="cb_ab" ${c.subject_b ? 'checked' : ''}> A/B test the subject line</label>
        <div class="field full" id="cb_abw" ${c.subject_b ? '' : 'hidden'}><div class="form">${fld('cb_subb', 'Subject B', inp('cb_subb', c.subject_b))}${fld('cb_split', 'Share of the audience that gets B (%)', inp('cb_split', c.ab_split || 50, 'number', 'min="5" max="95"'))}</div></div></div>
        <div class="row"><span class="faint" style="font-size:12px">Insert block:</span><div class="blocks">${Object.keys(BLOCKS).map((k) => `<button class="btn small" data-blk="${esc(k)}">${esc(k)}</button>`).join('')}</div><span class="spacer"></span><div class="seg">${['desktop', 'mobile'].map((d) => `<button data-dev="${d}" aria-pressed="${device === d}">${d === 'desktop' ? 'Desktop' : 'Mobile'}</button>`).join('')}</div></div>
        <div class="editor"><div class="field"><label for="cb_html">HTML · merge tags ${MERGE_HELP}</label><textarea id="cb_html" style="min-height:440px;font-family:var(--f-mono);font-size:12px">${esc(c.html)}</textarea></div><div class="field"><label>Live preview</label><div class="mailprev ${device === 'mobile' ? 'mobile' : ''}" id="cb_prev_box"></div></div></div>`;
      const pv = () => { const sub = renderTpl(v(el, 'cb_sub'), SAMPLE_VARS); el.querySelector('#cb_prev_box').innerHTML = `<div style="font-size:12px;color:#667;border-bottom:1px solid #e5e9f0;padding-bottom:6px;margin-bottom:10px"><b style="color:#1a2233">${esc(sub || '(no subject)')}</b><br>${esc(v(el, 'cb_pre') || '')}</div>${safeHTML(renderTpl(v(el, 'cb_html'), SAMPLE_VARS))}`; };
      ['cb_sub', 'cb_pre', 'cb_html'].forEach((id) => (el.querySelector('#' + id).oninput = pv));
      el.querySelector('#cb_ab').onchange = (e) => (el.querySelector('#cb_abw').hidden = !e.target.checked);
      el.querySelector('#cb_tpl').onchange = (e) => { const val = e.target.value; if (!val) return; if (val === '__blank') { el.querySelector('#cb_html').value = brandWrap(BLOCKS.Text + '\n' + BLOCKS.Button + '\n' + BLOCKS.Signature); } else { const t = DB.get('email_templates', val); c.template_id = t.id; el.querySelector('#cb_html').value = t.html; if (!v(el, 'cb_sub')) el.querySelector('#cb_sub').value = t.subject; } pv(); };
      el.querySelectorAll('[data-blk]').forEach((x) => (x.onclick = () => { const ta = el.querySelector('#cb_html'); const html = BLOCKS[x.dataset.blk]; const at = ta.selectionStart ?? ta.value.length; const insideBody = ta.value.indexOf('\n</td></tr></table></td></tr></table>'); const pos = ta.selectionStart == null || (at === 0 && insideBody > 0) ? (insideBody > 0 ? insideBody : ta.value.length) : at; ta.value = ta.value.slice(0, pos) + '\n' + html + '\n' + ta.value.slice(pos); pv(); ta.focus(); }));
      el.querySelectorAll('[data-dev]').forEach((x) => (x.onclick = () => { device = x.dataset.dev; el.querySelectorAll('[data-dev]').forEach((y) => y.setAttribute('aria-pressed', y === x)); el.querySelector('#cb_prev_box').classList.toggle('mobile', device === 'mobile'); }));
      pv();
    } else {
      const a = audience(); const first = a.ok[0];
      const lim = DB.settings.email?.daily_limit || 1500;
      bd.innerHTML = `<div class="grid g2"><section class="stack"><dl class="kv"><dt>Campaign</dt><dd><b>${esc(c.name)}</b> · ${esc(c.purpose)}</dd><dt>From</dt><dd>${esc(c.sender || DB.settings.email?.senders?.[c.purpose] || 'marketing mailbox')}${c.reply_to ? ` · reply-to ${esc(c.reply_to)}` : ''}</dd><dt>Audience</dt><dd>${a.ok.length} recipients from ${c.list_ids.map((id) => esc(DB.get('email_lists', id)?.name || '')).join(', ')}${c.exclude_list_ids.length ? ` · excluding ${c.exclude_list_ids.map((id) => esc(DB.get('email_lists', id)?.name || '')).join(', ')}` : ''}</dd><dt>Subject</dt><dd>${esc(c.subject)}${c.subject_b ? `<br>B (${c.ab_split}%): ${esc(c.subject_b)}` : ''}</dd>${c.preheader ? `<dt>Preheader</dt><dd>${esc(c.preheader)}</dd>` : ''}</dl>
        ${a.ok.length > lim ? `<div class="note">This is more than the mailbox's daily limit of ${lim}. The mailer sends the rest over the following days.</div>` : ''}
        <div class="field"><label>Send a test to</label><div class="row"><input id="cb_test" type="email" value="${esc(DB.me.email || '')}" style="flex:1"><button class="btn small" id="cb_testgo">Send test</button></div></div>
        <div class="field"><label>When</label><div class="row"><label class="check"><input type="radio" name="cb_when" value="now" checked> Send now</label><label class="check"><input type="radio" name="cb_when" value="later" ${c.scheduled_at ? 'checked' : ''}> Schedule</label><input id="cb_at" type="datetime-local" value="${dtLocal(c.scheduled_at || new Date(Date.now() + 2 * 3600e3).toISOString())}" style="width:auto"></div></div></section>
        <section><label class="faint" style="font-size:12px">Preview for ${first ? esc(first.name || first.email) : 'a sample contact'}</label><div class="mailprev">${first ? `<div style="font-size:12px;color:#667"><b style="color:#1a2233">${esc(renderTpl(c.subject, first.vars))}</b></div>` : ''}${safeHTML(renderTpl(c.html, first?.vars || SAMPLE_VARS))}</div></section></div>`;
      const when = () => el.querySelector('[name="cb_when"]:checked').value;
      const sync = () => (el.querySelector('#cb_next').innerHTML = when() === 'later' ? `${svg('cal')} Schedule` : `${svg('send')} Send now`);
      el.querySelectorAll('[name="cb_when"]').forEach((x) => (x.onchange = sync)); sync();
      el.querySelector('#cb_testgo').onclick = () => guard(async () => { const to = v(el, 'cb_test').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Enter an email address for the test'); const vars = first?.vars || SAMPLE_VARS; await DB.insert('email_queue', { to_email: to, to_name: DB.me.full_name, category: 'Internal update', subject: '[Test] ' + renderTpl(c.subject, vars), html: renderTpl(c.html, vars), sender: c.sender || DB.settings.email?.senders?.[c.purpose] || '', reply_to: c.reply_to, scheduled_at: nowISO(), auto_rule: 'test' }); }, 'Test queued');
    }
  };
  el.querySelector('#cb_prev').onclick = () => { capture(); step = Math.max(0, step - 1); draw(); };
  el.querySelector('#cb_draft').onclick = () => guard(async () => { capture(); if (!c.name.trim()) throw new Error('Name the campaign'); await save({ status: c.status === 'Scheduled' ? 'Scheduled' : 'Draft' }); m.close(); after?.(); }, 'Draft saved');
  el.querySelector('#cb_next').onclick = () => guard(async () => {
    capture();
    if (step < 3) { const err = check(step); if (err) throw new Error(err); step++; draw(); return; }
    const err = check(2); if (err) throw new Error(err);
    if (el.querySelector('[name="cb_when"]:checked').value === 'later') {
      const at = fromLocal(v(el, 'cb_at')); if (!at || new Date(at) < new Date()) throw new Error('Pick a time in the future');
      await save({ status: 'Scheduled', scheduled_at: at }); m.close(); toast(`Scheduled for ${fmtDT(at)}`); after?.(); return;
    }
    const n0 = audience().ok.length;
    if (!(await confirmBox(`Send "${esc(c.subject)}" to about ${n0} people now?`, 'Send now'))) return;
    await save({ status: 'Draft' });
    const n = await DB.rpc('launch_campaign', { p_id: c.id });
    m.close(); toast(`${n} emails queued · the mailer sends them within minutes`); after?.();
  });
  draw();
}

function campaignReport(c, after) {
  const rows = DB.t.email_queue.filter((e) => e.campaign_id === c.id);
  const s = campaignMail(c);
  const A = mailStats(rows.filter((e) => e.variant !== 'B')), B = mailStats(rows.filter((e) => e.variant === 'B'));
  const ids = new Set(rows.map((e) => e.id));
  const clicks = Object.entries(groupBy(DB.t.email_clicks.filter((k) => ids.has(k.queue_id)), (k) => k.url)).sort((a, b) => b[1].length - a[1].length);
  const leadsWon = DB.t.leads.filter((l) => rows.some((e) => e.lead_id === l.id) && L.won(l) && l.won_at >= (c.sent_at || ''));
  const funnel = [['Sent', s.sent], ['Delivered', s.delivered], ['Opened', s.opens], ['Clicked', s.clicks], ['Replied', s.replies]];
  const fmax = Math.max(1, s.sent);
  const m = openModal({ title: `${esc(c.name)} · report`, width: 1100,
    body: `<div class="row"><span class="chip ${c.status === 'Sent' ? 'good' : 'acc'}">${esc(c.status)}</span><span class="chip">${esc(c.purpose || '')}</span>${c.sent_at ? `<span class="chip">sent ${fmtDT(c.sent_at)}</span>` : ''}${c.scheduled_at && c.status === 'Scheduled' ? `<span class="chip acc">scheduled ${fmtDT(c.scheduled_at)}</span>` : ''}${s.imported ? '<span class="chip warn">history imported from Nx Outreach (opens were not tracked there)</span>' : ''}</div>
    <div class="kpis">${kpi({ label: 'Sent', value: s.sent, sub: s.queued ? `${s.queued} still queued` : '' })}${kpi({ label: 'Open rate', value: rate(s.opens, s.delivered) + '%', sub: `${s.opens} opened` })}${kpi({ label: 'Click rate', value: rate(s.clicks, s.delivered) + '%', sub: `${s.clicks} clicked · CTOR ${rate(s.clicks, s.opens)}%` })}${kpi({ label: 'Replies', value: s.replies, sub: rate(s.replies, s.delivered) + '%' })}${kpi({ label: 'Bounced', value: s.bounced, sub: rate(s.bounced, s.sent) + '%' })}${kpi({ label: 'Unsubscribed', value: s.unsub })}${kpi({ label: 'Deals won after', value: leadsWon.length, sub: inr(sum(leadsWon, (l) => l.value)) })}</div>
    <div class="grid g2"><section><h3>Funnel</h3><div class="funnel" style="margin-top:8px">${funnel.map(([k, n]) => `<div class="frow"><span>${k}</span><div class="bar"><i style="width:${(n / fmax) * 100}%"></i></div><span class="num" style="text-align:right">${n} · ${rate(n, s.sent)}%</span></div>`).join('')}</div>
      ${c.subject_b ? `<h3 style="margin-top:14px">A/B subject test</h3><div class="tablewrap"><table><thead><tr><th>Variant</th><th>Subject</th><th class="n">Sent</th><th class="n">Open</th><th class="n">Click</th><th class="n">Reply</th></tr></thead><tbody>${[['A', c.subject, A], ['B', c.subject_b, B]].map(([k, sub, x]) => `<tr><td><b>${k}</b>${(k === 'A' ? A : B).opens / Math.max(1, (k === 'A' ? A : B).delivered) > (k === 'A' ? B : A).opens / Math.max(1, (k === 'A' ? B : A).delivered) && x.sent ? ' <span class="chip good">winner</span>' : ''}</td><td>${esc(sub)}</td><td class="n">${x.sent}</td><td class="n">${rate(x.opens, x.delivered)}%</td><td class="n">${rate(x.clicks, x.delivered)}%</td><td class="n">${rate(x.replies, x.delivered)}%</td></tr>`).join('')}</tbody></table></div>` : ''}</section>
      <section><h3>Link clicks</h3>${clicks.length ? `<div class="tablewrap short"><table><thead><tr><th>Link</th><th class="n">Clicks</th><th class="n">People</th></tr></thead><tbody>${clicks.map(([u, a]) => `<tr><td class="s" style="word-break:break-all">${esc(u)}</td><td class="n">${a.length}</td><td class="n">${new Set(a.map((k) => k.queue_id)).size}</td></tr>`).join('')}</tbody></table></div>` : '<p class="faint">No clicks recorded yet.</p>'}</section></div>
    <section><div class="panel-head"><h3>Recipients</h3><div class="seg" id="crf">${['All', 'Opened', 'Clicked', 'Replied', 'Bounced', 'Not opened'].map((x, i) => `<button data-rf="${x}" aria-pressed="${i === 0}">${x}</button>`).join('')}</div></div><div id="crl"></div></section>
    <section><h3>Email</h3><div class="mailprev"><div style="font-size:12px;color:#667"><b style="color:#1a2233">${esc(c.subject)}</b></div>${safeHTML(renderTpl(c.html, SAMPLE_VARS))}</div></section>`,
    foot: `${c.status === 'Scheduled' && canEmail() ? '<button class="btn" id="cr_un" style="margin-right:auto">Cancel schedule (back to draft)</button><button class="btn primary" id="cr_now">Send now</button>' : ''}${c.status === 'Sent' && canEmail() && !s.imported ? '<button class="btn" id="cr_resend">Resend to non-openers</button>' : ''}<button class="btn" id="cr_exp">Export CSV</button>` });
  const el = m.el;
  const showR = (f) => { const list = rows.filter((e) => f === 'All' || (f === 'Opened' && e.opened_at) || (f === 'Clicked' && e.clicked_at) || (f === 'Replied' && e.replied_at) || (f === 'Bounced' && e.bounced_at) || (f === 'Not opened' && e.status === 'Sent' && !e.opened_at)); el.querySelector('#crl').innerHTML = list.length ? `<div class="tablewrap short"><table><thead><tr><th>Recipient</th><th>Status</th>${c.subject_b ? '<th>Var.</th>' : ''}<th>Opened</th><th>Clicked</th><th>Replied</th></tr></thead><tbody>${list.slice(0, 500).map((e) => `<tr ${e.lead_id ? `class="click" data-lead="${e.lead_id}"` : ''}><td>${esc(e.to_name || '')}<div class="s">${esc(e.to_email)}</div></td><td><span class="chip ${e.status === 'Sent' ? 'good' : e.status === 'Failed' ? 'bad' : ''}">${esc(e.status)}</span>${e.bounced_at ? ' <span class="chip bad">bounced</span>' : ''}</td>${c.subject_b ? `<td>${e.variant || 'A'}</td>` : ''}<td>${e.opened_at ? fmtDT(e.opened_at) : '—'}</td><td>${e.clicked_at ? fmtDT(e.clicked_at) : '—'}</td><td>${e.replied_at ? fmtDT(e.replied_at) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="faint">${s.imported ? 'Recipient-level history was not imported.' : 'Nobody here.'}</p>`; bindLeadClicks(el.querySelector('#crl')); };
  showR('All');
  el.querySelectorAll('[data-rf]').forEach((x) => (x.onclick = () => { el.querySelectorAll('[data-rf]').forEach((y) => y.setAttribute('aria-pressed', y === x)); showR(x.dataset.rf); }));
  el.querySelector('#cr_exp').onclick = () => downloadCSV('campaign-' + c.name.replace(/\W+/g, '-'), rows.map((e) => ({ email: e.to_email, name: e.to_name, status: e.status, variant: e.variant || 'A', sent: e.sent_at || '', opened: e.opened_at || '', clicked: e.clicked_at || '', replied: e.replied_at || '', bounced: e.bounced_at || '' })));
  el.querySelector('#cr_un')?.addEventListener('click', () => guard(async () => { await DB.update('campaigns', c.id, { status: 'Draft', scheduled_at: null }); m.close(); after?.(); }, 'Back to draft'));
  el.querySelector('#cr_now')?.addEventListener('click', () => guard(async () => { const n = await DB.rpc('launch_campaign', { p_id: c.id }); m.close(); toast(`${n} emails queued`); after?.(); }));
  el.querySelector('#cr_resend')?.addEventListener('click', () => guard(async () => {
    const non = rows.filter((e) => e.status === 'Sent' && !e.opened_at && !e.bounced_at); if (!non.length) throw new Error('Everyone opened it');
    const sub = await promptBox('Resend to non-openers', 'New subject line', c.subject); if (!sub) return;
    const uns = new Set(DB.t.unsubscribes.map((u) => u.email.toLowerCase()));
    const list = non.filter((e) => !uns.has(e.to_email.toLowerCase()));
    await DB.insertMany('email_queue', list.map((e) => ({ campaign_id: c.id, lead_id: e.lead_id, email_contact_id: e.email_contact_id || null, to_email: e.to_email, to_name: e.to_name, category: e.category, subject: sub, html: e.html, sender: e.sender, reply_to: e.reply_to || '', variant: 'R', scheduled_at: nowISO() })));
    m.close(); toast(`${list.length} emails queued to non-openers`); after?.();
  }));
  bindLeadClicks(el);
}

/* ---------------- Automations: drip sequences + lead-age rules ---------------- */
const SEQ_TRIGGERS = { manual: 'Added by hand', lead_created: 'New lead created', list_join: 'Joins a list', webinar_registered: 'Registers for a webinar', webinar_attended: 'Attended a webinar', webinar_noshow: 'Missed a webinar' };
const SEQ_COND = { always: 'Always', not_opened: 'Only if the last email was not opened', not_replied: 'Only if they have not replied', opened: 'Only if they opened the last email' };
function emAutomations(b, re) {
  const seqs = DB.t.email_sequences.slice().sort((a, c) => Number(c.active) - Number(a.active) || a.name.localeCompare(c.name));
  b.innerHTML = `<section class="glass panel"><div class="panel-head"><h2>Drip sequences</h2>${canEmail() ? `<button class="btn small primary" id="snew">${svg('plus')} New automation</button>` : ''}</div>
    <p class="muted" style="margin:0 0 10px">A sequence sends a series of emails with delays and conditions. People join automatically (new lead, webinar, list) or by hand, and leave when they reply, unsubscribe or bounce. Runs every 5 minutes.</p>
    <div class="tablewrap"><table><thead><tr><th>On</th><th>Automation</th><th>Starts when</th><th class="n">Steps</th><th class="n">Active</th><th class="n">Completed</th><th class="n">Replied</th><th class="n">Sent</th><th class="n">Open</th></tr></thead><tbody>
    ${seqs.map((x) => { const en = DB.t.sequence_enrollments.filter((e) => e.sequence_id === x.id); const ids = new Set(en.map((e) => e.id)); const st = mailStats(DB.t.email_queue.filter((e) => ids.has(e.enrollment_id))); return `<tr class="click" data-seq="${x.id}"><td onclick="event.stopPropagation()"><input type="checkbox" data-son="${x.id}" ${x.active ? 'checked' : ''} ${canEmail() ? '' : 'disabled'} aria-label="On"></td><td><b>${esc(x.name)}</b><div class="s">${esc(x.category)}${x.stop_on_reply ? ' · stops on reply' : ''}</div></td><td>${esc(SEQ_TRIGGERS[x.trigger] || x.trigger)}${x.trigger === 'list_join' && x.list_id ? `<div class="s">${esc(DB.get('email_lists', x.list_id)?.name || '')}</div>` : ''}${x.funnel !== 'Both' && x.trigger === 'lead_created' ? `<div class="s">${x.funnel} leads</div>` : ''}</td><td class="n">${DB.t.sequence_steps.filter((s) => s.sequence_id === x.id).length}</td><td class="n">${en.filter((e) => e.status === 'Active').length}</td><td class="n">${en.filter((e) => e.status === 'Completed').length}</td><td class="n">${en.filter((e) => e.status === 'Replied').length}</td><td class="n">${st.sent}</td><td class="n">${st.sent ? rate(st.opens, st.delivered) + '%' : '—'}</td></tr>`; }).join('') || `<tr><td colspan="9">${empty('No automations', '')}</td></tr>`}</tbody></table></div></section>
    <div id="lagerules"></div>`;
  b.querySelector('#snew')?.addEventListener('click', () => sequenceEditor({}, re));
  b.querySelectorAll('[data-seq]').forEach((tr) => (tr.onclick = () => sequenceEditor(DB.get('email_sequences', tr.dataset.seq), re)));
  b.querySelectorAll('[data-son]').forEach((c) => (c.onchange = () => guard(() => DB.update('email_sequences', c.dataset.son, { active: c.checked }), c.checked ? 'Automation on' : 'Automation paused')));
  mkAutomation(b.querySelector('#lagerules'), re);
}
function sequenceEditor(sq = {}, after) {
  if (!canEmail() && !sq.id) return toast('You do not have email marketing access', true);
  const steps = sq.id ? DB.t.sequence_steps.filter((s) => s.sequence_id === sq.id).sort((a, b) => a.step_no - b.step_no).map((s) => ({ ...s })) : [{ step_no: 1, delay_days: 0, delay_hours: 0, condition: 'always', template_id: null, subject: '', html: '' }];
  const en = sq.id ? DB.t.sequence_enrollments.filter((e) => e.sequence_id === sq.id) : [];
  const tpls = DB.t.email_templates.filter((t) => t.active);
  const m = openModal({ title: sq.id ? esc(sq.name) : 'New automation', width: 1020, body: '', foot: `${sq.id ? '<button class="btn" id="sq_enrol" style="margin-right:auto">Add people</button>' : ''}<button class="btn primary" id="sq_save">Save automation</button>` });
  const el = m.el;
  const draw = () => {
    el.querySelector('.modal-body').innerHTML = `<div class="form three">${fld('sq_name', 'Name', inp('sq_name', sq.name || ''))}${fld('sq_cat', 'Email type', sel('sq_cat', EMAIL_CATS, sq.category || 'Follow-up'))}${fld('sq_trig', 'Starts when', sel('sq_trig', Object.entries(SEQ_TRIGGERS), sq.trigger || 'manual'))}
      ${fld('sq_fun', 'Lead funnel (new-lead trigger)', sel('sq_fun', ['Both', ...DEPTS().map((d) => d.code)], sq.funnel || 'Both'))}${fld('sq_list', 'List (list trigger)', `<select id="sq_list">${opts(DB.t.email_lists.map((l) => [l.id, l.name]), sq.list_id, '—')}</select>`)}${fld('sq_ev', 'Webinar (webinar triggers)', `<select id="sq_ev">${opts(DB.t.events.filter((e) => e.kind === 'Webinar').map((e) => [e.id, e.title]), sq.event_id, 'Any webinar')}</select>`)}
      <label class="check"><input type="checkbox" id="sq_stop" ${sq.stop_on_reply !== false ? 'checked' : ''}> Stop when they reply</label><label class="check"><input type="checkbox" id="sq_on" ${sq.active ? 'checked' : ''}> Automation on</label></div>
      <h3>Steps</h3><div class="list free" id="sq_steps">${steps.map((s, i) => `<div class="item" data-si="${i}" style="flex-direction:column;align-items:stretch"><div class="row"><b>Email ${i + 1}</b><span class="faint" style="font-size:12px">wait</span><input type="number" class="sd" value="${s.delay_days}" min="0" style="width:64px" aria-label="Days"><span class="faint" style="font-size:12px">days</span><input type="number" class="sh" value="${s.delay_hours}" min="0" max="23" style="width:64px" aria-label="Hours"><span class="faint" style="font-size:12px">hours ${i ? 'after the previous email' : 'after they join'}</span><select class="sc" style="width:auto">${opts(Object.entries(SEQ_COND), s.condition)}</select><span class="spacer"></span>${steps.length > 1 ? `<button class="btn ghost small" data-sdel="${i}">Remove</button>` : ''}</div>
        <div class="form"><div class="field"><label>Template</label><select class="st">${opts(tpls.map((t) => [t.id, `${t.name} · ${t.category}`]), s.template_id, 'Write a custom email')}</select></div><div class="field"><label>Custom subject (overrides the template)</label><input class="ss" value="${esc(s.subject || '')}"></div><div class="field full"><label>Custom HTML (optional)</label><textarea class="sx" style="min-height:60px;font-family:var(--f-mono);font-size:12px">${esc(s.html || '')}</textarea></div></div></div>`).join('')}</div>
      <div class="row"><button class="btn small" id="sq_add">${svg('plus')} Add email</button></div>
      ${sq.id ? `<h3>People in this automation</h3><div class="tablewrap short"><table><thead><tr><th>Contact</th><th>Status</th><th class="n">Step</th><th>Next email</th><th>Joined</th><th></th></tr></thead><tbody>${en.sort((a, b) => (b.enrolled_at || '').localeCompare(a.enrolled_at || '')).slice(0, 300).map((e) => `<tr ${e.lead_id ? `class="click" data-lead="${e.lead_id}"` : ''}><td>${esc(e.name)}<div class="s">${esc(e.email)}</div></td><td><span class="chip ${e.status === 'Active' ? 'acc' : e.status === 'Replied' || e.status === 'Completed' ? 'good' : ''}">${esc(e.status)}</span></td><td class="n">${e.current_step}/${steps.length}</td><td>${e.status === 'Active' ? fmtDT(e.next_run_at) : '—'}</td><td>${fmtDate(e.enrolled_at)}</td><td class="n" onclick="event.stopPropagation()">${e.status === 'Active' && canEmail() ? `<button class="btn ghost small" data-stopen="${e.id}">Stop</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="faint">Nobody yet.</td></tr>`}</tbody></table></div>` : ''}`;
    const sync = () => $$('[data-si]', el).forEach((row) => { const s = steps[+row.dataset.si]; s.delay_days = Number(row.querySelector('.sd').value) || 0; s.delay_hours = Number(row.querySelector('.sh').value) || 0; s.condition = row.querySelector('.sc').value; s.template_id = row.querySelector('.st').value || null; s.subject = row.querySelector('.ss').value; s.html = row.querySelector('.sx').value; });
    Object.assign(el, { _sync: sync });
    el.querySelector('#sq_add').onclick = () => { sync(); readMeta(); steps.push({ step_no: steps.length + 1, delay_days: 3, delay_hours: 0, condition: 'not_replied', template_id: null, subject: '', html: '' }); draw(); };
    el.querySelectorAll('[data-sdel]').forEach((x) => (x.onclick = () => { sync(); readMeta(); steps.splice(+x.dataset.sdel, 1); draw(); }));
    el.querySelectorAll('[data-stopen]').forEach((x) => (x.onclick = () => guard(async () => { await DB.update('sequence_enrollments', x.dataset.stopen, { status: 'Stopped' }); m.close(); sequenceEditor(DB.get('email_sequences', sq.id), after); }, 'Stopped')));
    bindLeadClicks(el);
  };
  const readMeta = () => Object.assign(sq, { name: v(el, 'sq_name'), category: v(el, 'sq_cat'), trigger: v(el, 'sq_trig'), funnel: v(el, 'sq_fun'), list_id: v(el, 'sq_list') || null, event_id: v(el, 'sq_ev') || null, stop_on_reply: v(el, 'sq_stop'), active: v(el, 'sq_on') });
  draw();
  el.querySelector('#sq_save').onclick = () => guard(async () => {
    el._sync(); readMeta();
    if (!sq.name?.trim()) throw new Error('Name the automation');
    if (sq.trigger === 'list_join' && !sq.list_id) throw new Error('Choose the list that starts this automation');
    steps.forEach((s, i) => { if (!s.template_id && !(s.subject && s.html)) throw new Error(`Email ${i + 1}: choose a template or write a subject and HTML`); });
    const row = { name: sq.name, category: sq.category, trigger: sq.trigger, funnel: sq.funnel, list_id: sq.list_id, event_id: sq.event_id, stop_on_reply: sq.stop_on_reply, active: sq.active };
    let id = sq.id;
    if (id) await DB.update('email_sequences', id, row); else id = (await DB.insert('email_sequences', row)).id;
    for (const old of DB.t.sequence_steps.filter((s) => s.sequence_id === id)) await DB.remove('sequence_steps', old.id);
    await DB.insertMany('sequence_steps', steps.map((s, i) => ({ sequence_id: id, step_no: i + 1, delay_days: s.delay_days, delay_hours: s.delay_hours, condition: s.condition, template_id: s.template_id, subject: s.subject || '', html: s.html || '' })));
    m.close(); after?.();
  }, 'Automation saved');
  el.querySelector('#sq_enrol')?.addEventListener('click', () => {
    const p = openModal({ title: 'Add people to ' + esc(sq.name), width: 560, body: `${fld('en_list', 'From list', `<select id="en_list">${opts(DB.t.email_lists.map((l) => [l.id, `${l.name} · ${listAudience(l).length}`]), '', 'Choose a list')}</select>`)}<p class="faint" style="font-size:12px">People who unsubscribed, bounced or are already in this automation are skipped.</p>`, foot: '<button class="btn primary" id="en_go">Add</button>' });
    p.el.querySelector('#en_go').onclick = () => guard(async () => { const li = DB.get('email_lists', v(p.el, 'en_list')); if (!li) throw new Error('Choose a list'); let n = 0; for (const x of listAudience(li).filter((y) => y.consent)) { if (await DB.rpc('enroll_in_sequence', { p_seq: sq.id, p_email: x.email, p_name: x.name, p_lead: x.lead_id, p_contact: x.contact_id, p_attendee: null, p_vars: x.vars })) n++; } p.close(); m.close(); toast(`${n} added`); sequenceEditor(DB.get('email_sequences', sq.id), after); });
  });
}
function mkAutomation(b, rer) {
  const rules = DB.t.automation_rules;
  const matches = (r) => visibleLeads().filter((l) => {
    if (!L.open(l) || (r.funnel !== 'Both' && l.funnel !== r.funnel) || (r.stages?.length && !r.stages.includes(l.stage))) return false;
    const age = daysAgo(l.created_at);
    if (r.trigger === 'lead_age' && !(age >= r.min_days && age <= r.max_days)) return false;
    if (r.trigger === 'no_contact_days' && !(!l.first_contact_at && age >= r.min_days)) return false;
    if (r.trigger === 'stage_idle_days' && !(daysAgo(l.updated_at) >= r.min_days)) return false;
    if (r.action === 'queue_email' && (!l.email || !l.consent_email || l.opted_out)) return false;
    return true;
  });
  b.innerHTML = `<section class="glass panel"><div class="panel-head"><h2>Lead-age rules</h2><div class="row">${isHead() ? `<button class="btn small" id="anew">${svg('plus')} New rule</button>` : ''}</div></div>
    <p class="muted" style="margin:0 0 10px">Runs every morning at 7:30 am with Claude's daily job. Each rule fires once per lead. Emails only go to leads with consent who have not unsubscribed.</p>
    <div class="tablewrap"><table><thead><tr><th>On</th><th>Rule</th><th>When</th><th>Action</th><th class="n">Leads matching now</th></tr></thead><tbody>${rules.map((r) => `<tr class="click" data-rule="${r.id}"><td onclick="event.stopPropagation()"><input type="checkbox" data-toggle="${r.id}" ${r.active ? 'checked' : ''} ${isHead() ? '' : 'disabled'} aria-label="Active"></td><td><b>${esc(r.name)}</b><div class="s">${r.funnel}${r.stages?.length ? ' · ' + r.stages.join(', ') : ''}</div></td><td>${r.trigger === 'lead_age' ? `Lead is ${r.min_days}-${r.max_days > 9000 ? '∞' : r.max_days} days old` : r.trigger === 'no_contact_days' ? `No first contact after ${r.min_days} day(s)` : `Stage unchanged for ${r.min_days}+ days`}</td><td>${r.action === 'queue_email' ? `Email: ${esc(DB.get('email_templates', r.template_id)?.name || 'no template')}` : `Task: ${esc(r.task_title || '')}`}</td><td class="n">${matches(r).length}</td></tr>`).join('')}</tbody></table></div></section>`;
  b.querySelectorAll('[data-toggle]').forEach((c) => (c.onchange = () => guard(() => DB.update('automation_rules', c.dataset.toggle, { active: c.checked }), c.checked ? 'Rule on' : 'Rule off')));
  const edit = (r = { funnel: 'Both', trigger: 'lead_age', min_days: 3, max_days: 7, action: 'queue_email', stages: [], once: true, active: false }) => {
    if (!isHead()) return;
    const m = openModal({ title: r.id ? 'Edit rule' : 'New rule', width: 700, body: `<div class="form">${fld('rn', 'Name', inp('rn', r.name), 'full')}${fld('rf', 'Funnel', sel('rf', ['Both', ...DEPTS().map((d) => d.code)], r.funnel))}${fld('rt', 'Trigger', sel('rt', [['lead_age', 'Lead age (days since created)'], ['no_contact_days', 'No first contact after N days'], ['stage_idle_days', 'Stage unchanged for N days']], r.trigger))}${fld('rmin', 'From day', inp('rmin', r.min_days, 'number'))}${fld('rmax', 'To day (9999 = no limit)', inp('rmax', r.max_days, 'number'))}${fld('rs', 'Only in stages (comma separated, blank = any open)', inp('rs', (r.stages || []).join(', ')), 'full')}${fld('ra', 'Action', sel('ra', [['queue_email', 'Queue an email'], ['create_task', 'Create a task for the owner']], r.action))}${fld('rtp', 'Email template', `<select id="rtp">${opts(DB.t.email_templates.map((t) => [t.id, `${t.name} · ${t.category}`]), r.template_id, 'None')}</select>`)}${fld('rtt', 'Task title', inp('rtt', r.task_title || ''))}<label class="check"><input type="checkbox" id="ron" ${r.active ? 'checked' : ''}> Active</label></div>`, foot: '<button class="btn primary" id="rsv">Save rule</button>' });
    m.el.querySelector('#rsv').onclick = () => guard(async () => { const row = { name: v(m.el, 'rn'), funnel: v(m.el, 'rf'), trigger: v(m.el, 'rt'), min_days: num(m.el, 'rmin'), max_days: num(m.el, 'rmax') || 9999, stages: v(m.el, 'rs').split(',').map((x) => x.trim()).filter(Boolean), action: v(m.el, 'ra'), template_id: v(m.el, 'rtp') || null, task_title: v(m.el, 'rtt'), active: v(m.el, 'ron'), once: true }; if (!row.name) throw new Error('Name the rule'); if (r.id) await DB.update('automation_rules', r.id, row); else await DB.insert('automation_rules', row); m.close(); rer(); }, 'Rule saved');
  };
  b.querySelector('#anew')?.addEventListener('click', () => edit());
  b.querySelectorAll('[data-rule]').forEach((tr) => (tr.onclick = () => { const r = DB.get('automation_rules', tr.dataset.rule); if (isHead()) edit(r); else drill(r.name, leadRows(matches(r))); }));
}

/* ---------------- Audiences: lists, contacts, import, suppression ---------------- */
let audTab = 'lists', ctQ = '';
function emAudiences(b, re) {
  const tabs = [['lists', `Lists (${DB.t.email_lists.length})`], ['contacts', `Contacts (${DB.t.email_contacts.length})`], ['suppression', `Unsubscribed & bounced (${DB.t.unsubscribes.length + DB.t.email_contacts.filter((c) => c.bounced).length})`]];
  b.innerHTML = `<div class="row"><div class="seg">${tabs.map(([k, t]) => `<button data-aud="${k}" aria-pressed="${audTab === k}">${t}</button>`).join('')}</div><span class="spacer"></span>${canEmail() ? `<button class="btn small" id="aimp">Import contacts</button><button class="btn small primary" id="alist">${svg('plus')} New list</button>` : ''}</div><div id="audb"></div>`;
  b.querySelectorAll('[data-aud]').forEach((x) => (x.onclick = () => { audTab = x.dataset.aud; re(); }));
  b.querySelector('#aimp')?.addEventListener('click', () => contactImport(re));
  b.querySelector('#alist')?.addEventListener('click', () => listEditor({}, re));
  const box = b.querySelector('#audb');
  if (audTab === 'lists') {
    const ls = DB.t.email_lists.slice().sort((a, c) => a.name.localeCompare(c.name));
    box.innerHTML = `<section class="glass panel"><div class="tablewrap"><table><thead><tr><th>List</th><th>Type</th><th class="n">People</th><th class="n">Can be emailed</th><th>Used by</th><th>Created</th></tr></thead><tbody>${ls.map((li) => { const a = listAudience(li); const used = DB.t.campaigns.filter((c) => (c.list_ids || []).includes(li.id)).length + DB.t.email_sequences.filter((x) => x.list_id === li.id).length; return `<tr class="click" data-li="${li.id}"><td><b>${esc(li.name)}</b><div class="s">${esc(li.description || '')}</div></td><td><span class="chip ${li.kind === 'Dynamic' ? 'acc' : ''}">${li.kind}</span>${li.kind === 'Dynamic' ? `<div class="s">${esc(listFilterText(li.filter))}</div>` : ''}</td><td class="n">${a.length}</td><td class="n">${a.filter((x) => x.consent).length}</td><td>${used ? used + ' campaign' + (used === 1 ? '' : 's') : '—'}</td><td>${fmtDate(li.created_at)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    box.querySelectorAll('[data-li]').forEach((tr) => (tr.onclick = () => listEditor(DB.get('email_lists', tr.dataset.li), re)));
  } else if (audTab === 'contacts') {
    const rows = DB.t.email_contacts.filter((c) => !ctQ || `${c.email} ${c.first_name} ${c.last_name} ${c.company} ${(c.tags || []).join(' ')}`.toLowerCase().includes(ctQ.toLowerCase()));
    box.innerHTML = `<section class="glass panel"><div class="filters" style="margin-bottom:8px"><input type="search" id="ctq" placeholder="Search name, email, company, tag" value="${esc(ctQ)}"><span class="faint" style="font-size:12.5px">${rows.length} contacts. CRM leads are added to dynamic lists automatically; this is for everyone else (events, partners, imported lists).</span>${canEmail() ? `<button class="btn small" id="ctadd">${svg('plus')} Add contact</button>` : ''}</div>
      <div class="tablewrap tall"><table><thead><tr><th>Contact</th><th>Company</th><th>Tags</th><th>Lists</th><th>Status</th><th class="n">Emails</th><th class="n">Opened</th></tr></thead><tbody>${rows.slice(0, 600).map((c) => { const q = DB.t.email_queue.filter((e) => e.to_email.toLowerCase() === c.email.toLowerCase()); return `<tr class="click" data-ct="${c.id}"><td><b>${esc(`${c.first_name} ${c.last_name}`.trim() || c.email)}</b><div class="s">${esc(c.email)}</div></td><td>${esc(c.company)}</td><td>${(c.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(' ')}</td><td class="s">${DB.t.email_list_members.filter((m2) => m2.contact_id === c.id).map((m2) => esc(DB.get('email_lists', m2.list_id)?.name || '')).join(', ')}</td><td>${c.bounced ? '<span class="chip bad">Bounced</span>' : c.subscribed ? '<span class="chip good">Subscribed</span>' : '<span class="chip">Unsubscribed</span>'}</td><td class="n">${q.filter((e) => e.status === 'Sent').length}</td><td class="n">${q.filter((e) => e.opened_at).length}</td></tr>`; }).join('')}</tbody></table></div>${rows.length > 600 ? `<p class="faint">Showing 600 of ${rows.length}. Search to narrow.</p>` : ''}</section>`;
    box.querySelector('#ctq').oninput = (e) => { ctQ = e.target.value; clearTimeout(box._t); box._t = setTimeout(() => { re(); const i = $('#ctq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
    box.querySelector('#ctadd')?.addEventListener('click', () => contactEditor({}, re));
    box.querySelectorAll('[data-ct]').forEach((tr) => (tr.onclick = () => contactEditor(DB.get('email_contacts', tr.dataset.ct), re)));
  } else {
    const bounced = DB.t.email_contacts.filter((c) => c.bounced);
    box.innerHTML = `<div class="grid g2"><section class="glass panel"><div class="panel-head"><h2>Unsubscribed</h2>${canEmail() ? '<button class="btn small" id="unadd">Add email</button>' : ''}</div><p class="faint" style="font-size:12px;margin:0 0 8px">Nobody here gets marketing, newsletters or training updates again. Replies to their own enquiries still work.</p><div class="tablewrap"><table><thead><tr><th>Email</th><th>Reason</th><th>When</th></tr></thead><tbody>${DB.t.unsubscribes.slice().sort((a, c) => (c.created_at || '').localeCompare(a.created_at || '')).map((u) => `<tr><td>${esc(u.email)}</td><td class="s">${esc(u.reason || '')}</td><td>${fmtDate(u.created_at)}</td></tr>`).join('') || '<tr><td colspan="3" class="faint">Nobody.</td></tr>'}</tbody></table></div></section>
      <section class="glass panel"><div class="panel-head"><h2>Bounced</h2></div><p class="faint" style="font-size:12px;margin:0 0 8px">Addresses that bounced are skipped by every campaign. Fix the address on the contact to send again.</p><div class="tablewrap"><table><thead><tr><th>Email</th><th>Company</th></tr></thead><tbody>${bounced.map((c) => `<tr class="click" data-ct="${c.id}"><td>${esc(c.email)}</td><td>${esc(c.company)}</td></tr>`).join('') || '<tr><td colspan="2" class="faint">None.</td></tr>'}</tbody></table></div></section></div>`;
    box.querySelector('#unadd')?.addEventListener('click', () => guard(async () => { const e = await promptBox('Unsubscribe an address', 'Email'); if (!e) return; await DB.insert('unsubscribes', { email: e.trim().toLowerCase(), reason: 'Added by ' + DB.me.full_name }); re(); }, 'Unsubscribed'));
    box.querySelectorAll('[data-ct]').forEach((tr) => (tr.onclick = () => contactEditor(DB.get('email_contacts', tr.dataset.ct), re)));
  }
}
function listFilterText(f = {}) {
  if (f.target === 'contacts') return `Contacts${(f.tags || []).length ? ' tagged ' + f.tags.join(', ') : ''}`;
  return [f.funnel && f.funnel !== 'Both' ? f.funnel + ' leads' : 'All leads', { open: 'open', won: 'won', lost: 'lost', all: 'any status' }[f.status || 'open'], (f.stages || []).length ? 'in ' + f.stages.join(', ') : '', (f.sources || []).length ? 'from ' + f.sources.join(', ') : '', (f.temperatures || []).length ? f.temperatures.join('/') : '', (f.ai_bands || []).length ? 'Claude ' + f.ai_bands.join('/') : '', f.min_age !== undefined && f.min_age !== '' ? `${f.min_age}+ days old` : '', f.max_age !== undefined && f.max_age !== '' ? `up to ${f.max_age} days` : ''].filter(Boolean).join(' · ');
}
function listEditor(li = {}, after) {
  const f = { target: 'leads', funnel: 'Both', status: 'open', stages: [], sources: [], temperatures: [], ai_bands: [], tiers: [], tags: [], ...(li.filter || {}) };
  let kind = li.kind || 'Dynamic';
  const tags = [...new Set(DB.t.email_contacts.flatMap((c) => c.tags || []))];
  const members = li.id ? DB.t.email_list_members.filter((m2) => m2.list_id === li.id).map((m2) => DB.get('email_contacts', m2.contact_id)).filter(Boolean) : [];
  const chk = (cls, arr, val) => arr.map((x) => `<label class="check"><input type="checkbox" class="${cls}" value="${esc(x)}" ${val.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('');
  const m = openModal({ title: li.id ? esc(li.name) : 'New audience list', width: 860, body: '', foot: `${li.id && canEmail() ? '<button class="btn danger" id="le_del" style="margin-right:auto">Delete list</button>' : ''}<button class="btn primary" id="le_save">Save list</button>` });
  const el = m.el;
  const draw = () => {
    el.querySelector('.modal-body').innerHTML = `<div class="form">${fld('le_name', 'List name', inp('le_name', li.name || ''))}${fld('le_desc', 'Description', inp('le_desc', li.description || ''))}</div>
      <div class="seg" id="le_kind"><button data-k="Dynamic" aria-pressed="${kind === 'Dynamic'}">Dynamic · updates itself from rules</button><button data-k="Static" aria-pressed="${kind === 'Static'}">Static · fixed people</button></div>
      ${kind === 'Dynamic' ? `<div class="form">${fld('le_tgt', 'Who', sel('le_tgt', [['leads', 'CRM leads'], ['contacts', 'Imported contacts']], f.target))}${f.target === 'leads' ? `${fld('le_fun', 'Funnel', sel('le_fun', ['Both', ...DEPTS().map((d) => d.code)], f.funnel))}${fld('le_st', 'Lead status', sel('le_st', [['open', 'Open'], ['won', 'Won / customers'], ['lost', 'Lost'], ['all', 'Any']], f.status))}<div class="form" style="grid-column:1/-1">${fld('le_min', 'Lead age from (days)', inp('le_min', f.min_age ?? '', 'number'))}${fld('le_max', 'Lead age up to (days)', inp('le_max', f.max_age ?? '', 'number'))}</div>
        ${fld('le_stg', 'Stages (none = any)', `<div class="row" style="gap:4px 12px">${chk('le_stg', [...new Set(DB.t.stages.filter((s) => f.funnel === 'Both' || s.funnel === f.funnel).map((s) => s.key))], f.stages)}</div>`, 'full')}
        ${fld('le_src', 'Sources (none = any)', `<div class="row" style="gap:4px 12px">${chk('le_src', DB.settings.sources || [], f.sources)}</div>`, 'full')}
        ${f.funnel !== 'CoE' ? fld('le_tier', 'Campaign tier (none = any)', `<div class="row" style="gap:4px 12px">${chk('le_tier', TIERS, f.tiers || [])}</div>`, 'full') : ''}
        ${fld('le_tmp', 'Temperature', `<div class="row" style="gap:4px 12px">${chk('le_tmp', TEMPS, f.temperatures)}</div>`)}${fld('le_ai', 'Claude band', `<div class="row" style="gap:4px 12px">${chk('le_ai', ['Hot', 'Warm', 'Cold', 'Dead'], f.ai_bands)}</div>`)}` : fld('le_tags', 'Tags (none = all contacts)', `<div class="row" style="gap:4px 12px">${chk('le_tags', tags, f.tags || [])}</div>`, 'full')}</div>`
        : `<div class="note info">${members.length} people. Add people by importing a CSV into this list, or from a contact.</div>${members.length ? `<div class="tablewrap short"><table><tbody>${members.slice(0, 300).map((c) => `<tr><td>${esc(`${c.first_name} ${c.last_name}`.trim())}<div class="s">${esc(c.email)}</div></td><td>${esc(c.company)}</td><td class="n">${canEmail() ? `<button class="btn ghost small" data-rm="${c.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`}
      <div class="note ok" id="le_count"></div>`;
    el.querySelectorAll('[data-k]').forEach((x) => (x.onclick = () => { read(); kind = x.dataset.k; draw(); }));
    el.querySelector('#le_tgt')?.addEventListener('change', () => { read(); draw(); });
    el.querySelector('#le_fun')?.addEventListener('change', () => { read(); f.stages = []; draw(); });
    el.querySelectorAll('input,select').forEach((x) => x.addEventListener('change', count));
    el.querySelectorAll('[data-rm]').forEach((x) => (x.onclick = () => guard(async () => { await removeMember(li.id, x.dataset.rm); m.close(); listEditor(DB.get('email_lists', li.id), after); }, 'Removed')));
    count();
  };
  const read = () => {
    li.name = v(el, 'le_name'); li.description = v(el, 'le_desc');
    if (kind !== 'Dynamic') return;
    f.target = v(el, 'le_tgt') || f.target;
    if (f.target === 'leads' && el.querySelector('#le_fun')) Object.assign(f, { funnel: v(el, 'le_fun'), status: v(el, 'le_st'), min_age: v(el, 'le_min') === '' ? undefined : Number(v(el, 'le_min')), max_age: v(el, 'le_max') === '' ? undefined : Number(v(el, 'le_max')), stages: $$('.le_stg:checked', el).map((x) => x.value), sources: $$('.le_src:checked', el).map((x) => x.value), temperatures: $$('.le_tmp:checked', el).map((x) => x.value), ai_bands: $$('.le_ai:checked', el).map((x) => x.value) });
    if (f.target === 'leads') f.tiers = $$('.le_tier:checked', el).map((x) => x.value);
    if (f.target === 'contacts') f.tags = $$('.le_tags:checked', el).map((x) => x.value);
  };
  const count = () => { read(); const a = listAudience({ id: li.id, kind, filter: f }); el.querySelector('#le_count').innerHTML = `<b>${a.length}</b> people match now · ${a.filter((x) => x.consent).length} can receive marketing email.`; };
  draw();
  el.querySelector('#le_save').onclick = () => guard(async () => {
    read(); if (!li.name?.trim()) throw new Error('Name the list');
    const clean = JSON.parse(JSON.stringify(f)); if (clean.target === 'contacts') ['funnel', 'status', 'stages', 'sources', 'temperatures', 'ai_bands', 'tiers', 'min_age', 'max_age'].forEach((k) => delete clean[k]); else delete clean.tags;
    const row = { name: li.name.trim(), description: li.description || '', kind, filter: kind === 'Dynamic' ? clean : {} };
    if (li.id) await DB.update('email_lists', li.id, row); else await DB.insert('email_lists', row);
    m.close(); after?.();
  }, 'List saved');
  el.querySelector('#le_del')?.addEventListener('click', () => guard(async () => { if (DB.t.campaigns.some((c) => (c.list_ids || []).includes(li.id) && c.status === 'Scheduled')) throw new Error('A scheduled campaign uses this list'); if (!(await confirmBox(`Delete the list "${esc(li.name)}"? Contacts stay.`, 'Delete'))) return; await DB.remove('email_lists', li.id); m.close(); after?.(); }, 'Deleted'));
}
async function removeMember(listId, contactId) {
  if (DB.mode === 'live') { const { error } = await DB.sb.from('email_list_members').delete().eq('list_id', listId).eq('contact_id', contactId); if (error) throw new Error(friendly(error)); }
  DB.t.email_list_members = DB.t.email_list_members.filter((x) => !(x.list_id === listId && x.contact_id === contactId)); DB.emit();
}
function contactEditor(c = {}, after) {
  const lists = DB.t.email_lists.filter((l) => l.kind === 'Static');
  const inLists = c.id ? DB.t.email_list_members.filter((m2) => m2.contact_id === c.id).map((m2) => m2.list_id) : [];
  const q = c.email ? DB.t.email_queue.filter((e) => e.to_email.toLowerCase() === c.email.toLowerCase()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')) : [];
  const m = openModal({ title: c.id ? esc(`${c.first_name} ${c.last_name}`.trim() || c.email) : 'New contact', width: 760,
    body: `<div class="form">${fld('ce_e', 'Email', inp('ce_e', c.email || '', 'email'))}${fld('ce_f', 'First name', inp('ce_f', c.first_name || ''))}${fld('ce_l', 'Last name', inp('ce_l', c.last_name || ''))}${fld('ce_c', 'Company / institution', inp('ce_c', c.company || ''))}${fld('ce_d', 'Designation', inp('ce_d', c.designation || ''))}${fld('ce_p', 'Phone', inp('ce_p', c.phone || '', 'tel'))}${fld('ce_ci', 'City', inp('ce_ci', c.city || ''))}${fld('ce_t', 'Tags (comma separated)', inp('ce_t', (c.tags || []).join(', ')))}
      ${fld('ce_lists', 'Static lists', `<div class="row" style="gap:4px 12px">${lists.map((l) => `<label class="check"><input type="checkbox" class="ce_li" value="${l.id}" ${inLists.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('') || '<span class="faint">No static lists yet</span>'}</div>`, 'full')}
      <label class="check"><input type="checkbox" id="ce_s" ${c.subscribed !== false ? 'checked' : ''}> Subscribed to marketing email</label><label class="check"><input type="checkbox" id="ce_b" ${c.bounced ? 'checked' : ''}> Address bounced</label></div>
      ${q.length ? `<h3>Emails</h3><div class="tablewrap short"><table><tbody>${q.slice(0, 50).map((e) => `<tr><td>${fmtDT(e.created_at)}</td><td>${esc(e.subject)}</td><td><span class="chip ${e.status === 'Sent' ? 'good' : ''}">${esc(e.status)}</span>${e.opened_at ? ' <span class="chip acc">opened</span>' : ''}${e.replied_at ? ' <span class="chip good">replied</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    foot: `${c.id && canEmail() ? '<button class="btn danger" id="ce_del" style="margin-right:auto">Delete</button>' : ''}${canEmail() ? '<button class="btn primary" id="ce_save">Save</button>' : ''}` });
  const el = m.el;
  el.querySelector('#ce_save')?.addEventListener('click', () => guard(async () => {
    const email = v(el, 'ce_e').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
    const row = { email, first_name: v(el, 'ce_f'), last_name: v(el, 'ce_l'), company: v(el, 'ce_c'), designation: v(el, 'ce_d'), phone: v(el, 'ce_p'), city: v(el, 'ce_ci'), tags: v(el, 'ce_t').split(',').map((x) => x.trim()).filter(Boolean), subscribed: v(el, 'ce_s'), bounced: v(el, 'ce_b'), source: c.source || 'Added by hand' };
    const saved = c.id ? await DB.update('email_contacts', c.id, row) : await DB.insert('email_contacts', row);
    const want = $$('.ce_li:checked', el).map((x) => x.value);
    for (const lid of want.filter((x) => !inLists.includes(x))) await DB.insert('email_list_members', { list_id: lid, contact_id: saved.id });
    for (const lid of inLists.filter((x) => !want.includes(x))) await removeMember(lid, saved.id);
    m.close(); after?.();
  }, 'Contact saved'));
  el.querySelector('#ce_del')?.addEventListener('click', () => guard(async () => { if (!(await confirmBox('Delete this contact?', 'Delete'))) return; await DB.remove('email_contacts', c.id); m.close(); after?.(); }, 'Deleted'));
}
function contactImport(after) {
  const m = openModal({ title: 'Import contacts', width: 820, body: `<p class="muted" style="margin:0">Paste rows or choose a CSV with a header row. Recognised columns: email, first name, last name, name, company, designation, phone, city, tags. Existing emails are updated, not duplicated. Unsubscribed addresses stay unsubscribed.</p>
    <div class="form">${fld('ci_list', 'Add everyone to list', `<select id="ci_list"><option value="__new">New static list…</option>${DB.t.email_lists.filter((l) => l.kind === 'Static').map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}<option value="">No list</option></select>`)}${fld('ci_tag', 'Tag them as', inp('ci_tag', '', 'text', 'placeholder="e.g. FICCI expo 2026"'))}
    <label class="check full"><input type="checkbox" id="ci_ok"> These people agreed to hear from Garuda (event sign-ups, existing customers, enquiries)</label></div>
    <input type="file" id="ci_f" accept=".csv,.tsv,.txt"><textarea id="ci_t" style="min-height:160px;font-family:var(--f-mono);font-size:12px" placeholder="email,first name,last name,company"></textarea><div class="note info" id="ci_p">Nothing to import yet.</div>`,
    foot: '<button class="btn primary" id="ci_go" disabled>Import</button>' });
  const el = m.el; let rows = [];
  const pv = () => {
    const t = parseCSV(v(el, 'ci_t') || ''); if (t.length < 2) { rows = []; el.querySelector('#ci_p').textContent = 'Paste a header row and at least one contact.'; el.querySelector('#ci_go').disabled = true; return; }
    const h = t[0].map((x) => x.trim().toLowerCase().replace(/[_\s]+/g, ' '));
    const col = (...names) => h.findIndex((x) => names.includes(x));
    const ix = { email: col('email', 'email address', 'e-mail'), first: col('first name', 'firstname', 'first'), last: col('last name', 'lastname', 'last'), name: col('name', 'full name'), company: col('company', 'organisation', 'organization', 'institution', 'college'), des: col('designation', 'title', 'job title'), phone: col('phone', 'mobile', 'contact number'), city: col('city'), tags: col('tags', 'tag') };
    if (ix.email < 0) { el.querySelector('#ci_p').textContent = 'No email column found.'; el.querySelector('#ci_go').disabled = true; return; }
    const g = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
    rows = t.slice(1).map((r) => { const nm = g(r, ix.name).split(' '); return { email: g(r, ix.email).toLowerCase(), first_name: g(r, ix.first) || nm[0] || '', last_name: g(r, ix.last) || nm.slice(1).join(' '), company: g(r, ix.company), designation: g(r, ix.des), phone: g(r, ix.phone), city: g(r, ix.city), tags: g(r, ix.tags).split(/[;|]/).map((x) => x.trim()).filter(Boolean) }; }).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
    const uniq = new Map(rows.map((r) => [r.email, r])); rows = [...uniq.values()];
    const ex = rows.filter((r) => DB.t.email_contacts.some((c) => c.email.toLowerCase() === r.email)).length;
    el.querySelector('#ci_p').innerHTML = `<b>${rows.length}</b> valid emails · ${ex} already in contacts (will be updated) · ${rows.length - ex} new.`;
    el.querySelector('#ci_go').disabled = !rows.length;
  };
  el.querySelector('#ci_t').oninput = pv;
  el.querySelector('#ci_f').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then((t) => { el.querySelector('#ci_t').value = t; pv(); }); };
  el.querySelector('#ci_go').onclick = () => guard(async () => {
    if (!v(el, 'ci_ok')) throw new Error('Confirm these people agreed to hear from Garuda');
    let listId = v(el, 'ci_list');
    if (listId === '__new') { const n = await promptBox('New static list', 'List name', v(el, 'ci_tag') || 'Imported ' + fmtDate(todayStr())); if (!n) return; listId = (await DB.insert('email_lists', { name: n, description: 'Imported ' + fmtDate(todayStr()), kind: 'Static', filter: {} })).id; }
    const tag = v(el, 'ci_tag').trim(); let added = 0, updated = 0;
    const uns = new Set(DB.t.unsubscribes.map((u) => u.email.toLowerCase()));
    for (const r of rows) {
      const ex = DB.t.email_contacts.find((c) => c.email.toLowerCase() === r.email);
      const tags = [...new Set([...(ex?.tags || []), ...r.tags, ...(tag ? [tag] : [])])];
      let c;
      if (ex) { c = await DB.update('email_contacts', ex.id, { ...Object.fromEntries(Object.entries(r).filter(([k, val]) => val && k !== 'tags')), tags }); updated++; }
      else { c = await DB.insert('email_contacts', { ...r, tags, source: 'Import', subscribed: !uns.has(r.email) }); added++; }
      if (listId) await DB.insert('email_list_members', { list_id: listId, contact_id: c.id });
    }
    m.close(); toast(`${added} added · ${updated} updated`); after?.();
  });
}

/* ---------------- Templates ---------------- */
function emTemplates(b, rer) {
  const g = groupBy(DB.t.email_templates, (t) => t.category);
  b.innerHTML = `<section class="glass panel"><div class="panel-head"><h2>Email templates</h2><button class="btn small" id="tnew" ${canEmail() ? '' : 'disabled'}>${svg('plus')} New template</button></div>
    ${EMAIL_CATS.map((cat) => `<details class="acc" ${['Newsletter', 'Marketing'].includes(cat) ? 'open' : ''}><summary>${cat}<span class="sub">${(g[cat] || []).length} templates</span></summary><div class="acc-body"><div class="list free">${(g[cat] || []).map((t) => `<button class="item" data-tpl="${t.id}" style="text-align:left;font:inherit;color:inherit;cursor:pointer"><div class="grow"><b>${esc(t.name)}</b>${t.active ? '' : ' <span class="chip">inactive</span>'}<div class="faint" style="font-size:12px">${esc(t.subject)}</div></div><span class="faint" style="font-size:12px">${DB.t.email_queue.filter((e) => e.template_id === t.id).length} sent</span></button>`).join('') || '<p class="faint" style="margin:0">None yet.</p>'}</div></div></details>`).join('')}</section>`;
  const edit = (t = {}) => {
    let device = 'desktop';
    const m = openModal({ title: t.id ? 'Edit template' : 'New template', width: 1120, body: `<div class="form three">${fld('tn', 'Name', inp('tn', t.name))}${fld('tc', 'Type', sel('tc', EMAIL_CATS, t.category || 'Marketing'))}<label class="check"><input type="checkbox" id="ta" ${t.active !== false ? 'checked' : ''}> Active</label>${fld('ts', 'Subject', inp('ts', t.subject), 'full')}</div>
      <div class="row"><span class="faint" style="font-size:12px">Insert block:</span><div class="blocks">${Object.keys(BLOCKS).map((k) => `<button class="btn small" data-blk="${esc(k)}">${esc(k)}</button>`).join('')}<button class="btn small" id="twrap">Wrap in Garuda layout</button></div><span class="spacer"></span><div class="seg">${['desktop', 'mobile'].map((d) => `<button data-dev="${d}" aria-pressed="${device === d}">${d === 'desktop' ? 'Desktop' : 'Mobile'}</button>`).join('')}</div></div>
      <div class="editor"><div class="field"><label for="th">HTML · ${MERGE_HELP}</label><textarea id="th" style="min-height:420px;font-family:var(--f-mono);font-size:12px">${esc(t.html || brandWrap(BLOCKS.Text + '\n' + BLOCKS.Signature))}</textarea></div><div class="field"><label>Preview</label><div id="tp" class="mailprev"></div></div></div>`,
      foot: `${t.id ? '<button class="btn" id="tdup" style="margin-right:auto">Duplicate</button>' : ''}<button class="btn primary" id="tsv">Save template</button>` });
    const pv = () => (m.el.querySelector('#tp').innerHTML = `<div style="font-size:12px;color:#667;margin-bottom:8px"><b style="color:#1a2233">${esc(renderTpl(v(m.el, 'ts'), SAMPLE_VARS))}</b></div>${safeHTML(renderTpl(v(m.el, 'th'), SAMPLE_VARS))}`);
    m.el.querySelector('#th').oninput = pv; m.el.querySelector('#ts').oninput = pv; pv();
    m.el.querySelectorAll('[data-blk]').forEach((x) => (x.onclick = () => { const ta = m.el.querySelector('#th'); const pos = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, pos) + '\n' + BLOCKS[x.dataset.blk] + '\n' + ta.value.slice(pos); pv(); }));
    m.el.querySelector('#twrap').onclick = () => { const ta = m.el.querySelector('#th'); if (!/Garuda Aerospace<\/td><\/tr>/.test(ta.value)) ta.value = brandWrap(ta.value); pv(); };
    m.el.querySelectorAll('[data-dev]').forEach((x) => (x.onclick = () => { device = x.dataset.dev; m.el.querySelectorAll('[data-dev]').forEach((y) => y.setAttribute('aria-pressed', y === x)); m.el.querySelector('#tp').classList.toggle('mobile', device === 'mobile'); }));
    m.el.querySelector('#tsv').onclick = () => guard(async () => { const row = { name: v(m.el, 'tn'), category: v(m.el, 'tc'), subject: v(m.el, 'ts'), html: v(m.el, 'th'), active: v(m.el, 'ta'), updated_at: nowISO() }; if (!row.name || !row.subject) throw new Error('Name and subject are required'); if (t.id) await DB.update('email_templates', t.id, row); else await DB.insert('email_templates', row); m.close(); rer(); }, 'Template saved');
    m.el.querySelector('#tdup')?.addEventListener('click', () => guard(async () => { await DB.insert('email_templates', { name: t.name + ' (copy)', category: t.category, subject: t.subject, html: t.html, active: true }); m.close(); rer(); }, 'Duplicated'));
  };
  b.querySelector('#tnew').onclick = () => edit();
  b.querySelectorAll('[data-tpl]').forEach((x) => (x.onclick = () => (canEmail() ? edit(DB.get('email_templates', x.dataset.tpl)) : null)));
}

/* ---------------- Reports ---------------- */
function emReports(b) {
  const r = curRange();
  const rows = DB.t.email_queue.filter((e) => M.inR(e.sent_at || e.created_at, r));
  const byCat = EMAIL_CATS.map((c) => [c, mailStats(rows.filter((e) => e.category === c))]).filter(([, s]) => s.sent || s.queued);
  const camps = DB.t.campaigns.filter((c) => c.channel === 'Email' && (c.sent_at ? M.inR(c.sent_at, r) : false));
  const seqs = DB.t.email_sequences.map((x) => { const ids = new Set(DB.t.sequence_enrollments.filter((e) => e.sequence_id === x.id).map((e) => e.id)); return [x, mailStats(rows.filter((e) => ids.has(e.enrollment_id)))]; }).filter(([, s]) => s.sent);
  const hours = Array.from({ length: 24 }, (_, h) => { const s = rows.filter((e) => e.opened_at && new Date(e.opened_at).getHours() === h).length; return s; });
  const doms = Object.entries(groupBy(rows.filter((e) => e.status === 'Sent'), (e) => e.to_email.split('@')[1]?.toLowerCase() || '?')).map(([d, a]) => [d, mailStats(a)]).sort((a, c) => c[1].sent - a[1].sent).slice(0, 10);
  const tbl = (head, list) => `<div class="tablewrap"><table><thead><tr><th>${head}</th><th class="n">Sent</th><th class="n">Delivered</th><th class="n">Open</th><th class="n">Click</th><th class="n">Reply</th><th class="n">Bounce</th><th class="n">Unsub</th></tr></thead><tbody>${list.map(([n, s]) => `<tr><td><b>${esc(n)}</b></td><td class="n">${s.sent}</td><td class="n">${s.delivered}</td><td class="n">${rate(s.opens, s.delivered)}%</td><td class="n">${rate(s.clicks, s.delivered)}%</td><td class="n">${rate(s.replies, s.delivered)}%</td><td class="n">${rate(s.bounced, s.sent)}%</td><td class="n">${s.unsub}</td></tr>`).join('') || '<tr><td colspan="8" class="faint">Nothing in this period.</td></tr>'}</tbody></table></div>`;
  const all = mailStats(rows);
  b.innerHTML = `${filterBar({ person: false, dept: false })}
  <div class="kpis">${kpi({ label: 'Sent', value: all.sent })}${kpi({ label: 'Delivered', value: all.delivered, sub: rate(all.delivered, all.sent) + '%' })}${kpi({ label: 'Opened', value: all.opens, sub: rate(all.opens, all.delivered) + '%' })}${kpi({ label: 'Clicked', value: all.clicks, sub: rate(all.clicks, all.delivered) + '%' })}${kpi({ label: 'Replied', value: all.replies, sub: rate(all.replies, all.delivered) + '%' })}${kpi({ label: 'Bounced', value: all.bounced })}${kpi({ label: 'Unsubscribed', value: all.unsub })}</div>
  <div class="grid g2"><section class="glass panel"><div class="panel-head"><h2>By email type</h2></div>${tbl('Type', byCat)}</section><section class="glass panel"><div class="panel-head"><h2>When people open</h2><span class="sub">Opens by hour of day · send just before the peak</span></div>${barChart({ labels: hours.map((_, h) => (h % 3 === 0 ? String(h) : '')), series: [{ name: 'Opens', color: 'var(--c2)', values: hours }], fmt: (x) => String(Math.round(x)), height: 190 })}</section></div>
  <section class="glass panel"><div class="panel-head"><h2>Campaigns sent · ${r.label}</h2></div>${campaignTable(camps)}</section>
  <div class="grid g2"><section class="glass panel"><div class="panel-head"><h2>Automations</h2></div>${tbl('Automation', seqs.map(([x, s]) => [x.name, s]))}</section><section class="glass panel"><div class="panel-head"><h2>Top recipient domains</h2><span class="sub">Spot deliverability problems by provider</span></div>${tbl('Domain', doms)}</section></div>`;
  bindFilters(b, () => VIEWS.email.render($('#view')));
  bindCampaignRows(b, () => VIEWS.email.render($('#view')));
}

function emActivity(b) {
  const f = emActivity.f ||= { status: '', cat: '', q: '' };
  const all = DB.t.email_queue.filter((e) => seesAll() || e.created_by === DB.me.id || canEmail());
  const rows = all.filter((e) => (!f.status || e.status === f.status) && (!f.cat || e.category === f.cat) && (!f.q || `${e.to_email} ${e.to_name} ${e.subject}`.toLowerCase().includes(f.q.toLowerCase()))).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  b.innerHTML = `<section class="glass panel"><div class="filters" style="margin-bottom:8px"><input type="search" id="fq" placeholder="Search recipient or subject" value="${esc(f.q)}">${sel('fst', ['Queued', 'Sent', 'Failed', 'Skipped'], f.status, 'Any status')}${sel('fct', EMAIL_CATS, f.cat, 'Any type')}<span class="faint" style="font-size:12.5px">${rows.length} emails</span></div>
  <div class="tablewrap tall"><table><thead><tr><th>Created</th><th>To</th><th>Subject</th><th>Type</th><th>From</th><th>Status</th><th>Opened</th><th>Clicked</th><th>Replied</th><th>Source</th></tr></thead><tbody>${rows.slice(0, 500).map((e) => `<tr ${e.lead_id ? `class="click" data-lead="${e.lead_id}"` : ''}><td>${fmtDT(e.created_at)}</td><td>${esc(e.to_name)}<div class="s">${esc(e.to_email)}</div></td><td>${esc(e.subject)}</td><td>${esc(e.category)}</td><td class="s">${esc(e.sender || '—')}</td><td><span class="chip ${e.status === 'Sent' ? 'good' : e.status === 'Failed' ? 'bad' : e.status === 'Skipped' ? '' : 'warn'}">${e.status}</span>${e.bounced_at ? ' <span class="chip bad">bounced</span>' : ''}${e.error ? `<div class="s">${esc(e.error)}</div>` : ''}</td><td>${e.opened_at ? fmtDT(e.opened_at) : '—'}</td><td>${e.clicked_at ? fmtDT(e.clicked_at) : '—'}</td><td>${e.replied_at ? fmtDT(e.replied_at) : '—'}</td><td class="s">${e.campaign_id ? esc(DB.get('campaigns', e.campaign_id)?.name || 'campaign') : e.enrollment_id ? 'automation' : e.auto_rule ? esc(e.auto_rule) : esc(DB.pname(e.created_by))}</td></tr>`).join('') || `<tr><td colspan="10">${empty('No emails', '')}</td></tr>`}</tbody></table></div></section>`;
  b.querySelector('#fst').onchange = (e) => { f.status = e.target.value; emActivity(b); };
  b.querySelector('#fct').onchange = (e) => { f.cat = e.target.value; emActivity(b); };
  b.querySelector('#fq').oninput = (e) => { f.q = e.target.value; clearTimeout(b._t); b._t = setTimeout(() => { emActivity(b); const i = b.querySelector('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  bindLeadClicks(b);
}

/* ================= Lead intake from ad platforms and the website (shown on Ad Campaigns) ================= */
function mkAds(b) {
  const base = (window.GARUDA_CONFIG?.supabaseUrl || 'https://<your-project>.supabase.co').replace(/\/$/, '') + '/functions/v1/lead-intake';
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const by = (src) => DB.t.leads.filter((l) => l.source === src && l.created_at >= since);
  const card = (name, src, url, steps) => { const ls = by(src); const last = ls.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]; return `<section class="glass panel"><div class="panel-head"><h2>${name}</h2><span class="chip ${ls.length ? 'good' : 'warn'}">${ls.length ? `${ls.length} leads · last ${rel(last.created_at)}` : 'No leads in 30 days'}</span></div>
      <div class="field"><label>Webhook URL</label><div class="row"><input readonly value="${esc(url)}" style="flex:1" class="mono" aria-label="Webhook URL"><button class="btn small" data-copy="${esc(url)}">Copy</button></div></div>
      <ol style="padding-left:18px;margin:10px 0 0;font-size:13px;color:var(--ink2)">${steps.map((s) => `<li style="margin:3px 0">${s}</li>`).join('')}</ol></section>`; };
  b.innerHTML = `<div class="note info">Every ad lead lands in the CRM within seconds. It is checked for duplicates (phone or email), tagged with its campaign, given to the next telecaller or CoE caller in rotation, and gets a first-call task with the ${DB.settings.sla?.first_contact_hours || 2}-hour SLA. Full steps are in SETUP.md.</div>
  <div class="grid g2">
    ${card('Google Ads lead forms', 'Google Ads', base + '?source=google', ['Google Ads → your lead form asset → Lead delivery → Webhook integration.', 'Paste the webhook URL above.', 'Set the key to the GOOGLE_LEAD_KEY secret you stored in Supabase.', 'Click “Send test data”. A test lead appears here.', 'Put the Google campaign id on the matching CRM campaign so leads are attributed.'])}
    ${card('Meta Lead Ads (Facebook & Instagram)', 'Meta Ads', base + '?source=meta', ['Create a Meta app (Business type) at developers.facebook.com with the Webhooks and Lead Ads permissions.', 'Webhooks → Page → subscribe to “leadgen” with the URL above and the META_VERIFY_TOKEN.', 'Generate a long-lived Page access token with leads_retrieval and store it as META_PAGE_TOKEN; store the app secret as META_APP_SECRET.', 'Subscribe your Page to the app (Graph API: /{page-id}/subscribed_apps).', 'Use Meta’s Lead Ads Testing Tool to send a test lead.'])}
    ${card('Website and landing pages', 'Website', base + '?source=website&key=YOUR_INTAKE_KEY', ['POST JSON from your site form: name, phone, email, city, course or college, message, utm_source/medium/campaign, whatsapp_optin.', 'Replace YOUR_INTAKE_KEY with the INTAKE_KEY secret.', 'Add funnel: "CoE" for college enquiries; anything else is treated as RPTO.'])}
    <section class="glass panel"><div class="panel-head"><h2>Leads by source · last 30 days</h2></div><div class="funnel">${(() => { const g = Object.entries(groupBy(DB.t.leads.filter((l) => l.created_at >= since), (l) => l.source || 'Unknown')).sort((a, b) => b[1].length - a[1].length); const mx = Math.max(1, ...g.map(([, a]) => a.length)); return g.map(([s, a]) => `<div class="frow"><span>${esc(s)}</span><div class="bar"><i style="width:${(a.length / mx) * 100}%"></i></div><span class="num" style="text-align:right">${a.length} · ${a.filter(L.won).length} won</span></div>`).join(''); })()}</div></section>
  </div>`;
  b.querySelectorAll('[data-copy]').forEach((x) => (x.onclick = () => navigator.clipboard.writeText(x.dataset.copy).then(() => toast('Copied'), () => toast('Select the text and copy', true))));
}

/* ================= Webinars ================= */
/* the department a webinar's registrants become leads in */
const webDept = (e) => (DEPTS().some((d) => d.code === e.segment) ? e.segment : DEPTS()[0]?.code || 'RPTO');
const webTotal = (e) => Math.round(Number(e.fee || 0) * (1 + Number(e.gst_rate ?? 18) / 100) * 100) / 100;
function regUrl(e) {
  const base = DB.settings.webinar?.public_url || (location.protocol.startsWith('http') && !/claude|usercontent/.test(location.hostname) ? location.origin + location.pathname.replace(/[^/]*$/, '') + 'register.html' : 'https://<your-crm-address>/register.html');
  return `${base}?w=${encodeURIComponent(e.slug || '')}`;
}
function webStats(e) {
  const a = DB.t.event_attendees.filter((x) => x.event_id === e.id);
  const act = a.filter((x) => x.status === 'Active'); const att = act.filter((x) => x.attended);
  const leadIds = a.map((x) => x.lead_id).filter(Boolean);
  const conv = DB.t.leads.filter((l) => leadIds.includes(l.id) && L.won(l) && l.won_at >= e.start_at);
  const fees = sum(act.filter((x) => x.paid_at), (x) => Number(x.amount) || 0);
  return { a, reg: a.length, active: act.length, pending: a.filter((x) => x.status === 'Payment pending').length, att: att.length, q: a.filter((x) => x.qualified).length, ho: a.filter((x) => x.handed_over_to).length, conv: conv.length + a.filter((x) => x.outcome === 'Paid admission' && !x.lead_id).length, rev: sum(conv, (l) => l.value), fees, cost: Number(e.cost) || 0 };
}
function webinarModal(e = {}, after) {
  const ws = DB.settings.webinar || {};
  const qs = (e.questions || []).map((q) => q.label + (q.options?.length ? ': ' + q.options.join(' | ') : '')).join('\n');
  const end = e.end_at ? Math.round((new Date(e.end_at) - new Date(e.start_at)) / 60000) : 60;
  const m = openModal({ title: e.id ? 'Edit webinar' : 'New webinar', width: 860,
    body: `<div class="form">${fld('w_t', 'Title', inp('w_t', e.title || ''), 'full')}${fld('w_d', 'Description (shown on the registration page)', `<textarea id="w_d" style="min-height:70px">${esc(e.description || '')}</textarea>`, 'full')}
      ${fld('w_s', 'Date and time', inp('w_s', dtLocal(e.start_at || new Date(Date.now() + 7 * 864e5).toISOString()), 'datetime-local'))}${fld('w_len', 'Duration (minutes)', inp('w_len', end, 'number', 'min="15" step="15"'))}
      ${fld('w_link', 'Meeting link (Google Meet, Zoom, Teams)', inp('w_link', e.meeting_link || '', 'url', 'placeholder="https://meet.google.com/…"'), 'full')}
      ${fld('w_o', 'Presenter', `<select id="w_o">${opts(scopePeople().map((p) => [p.id, p.full_name]), e.owner || DB.me.id)}</select>`)}${fld('w_seg', 'Audience', sel('w_seg', DEPTS().map((d) => [d.code, d.name + (isOrgDept(d.code) ? ' · organisations' : ' · individuals')]), e.segment || 'RPTO'))}
      <div class="field"><label>Fee</label><div class="seg" id="w_paid"><button data-p="0" aria-pressed="${!e.is_paid}">Free</button><button data-p="1" aria-pressed="${!!e.is_paid}">Paid</button></div></div>
      <div class="field" id="w_feew" ${e.is_paid ? '' : 'hidden'}><label>Fee ex-GST (₹) and GST %</label><div class="row"><input id="w_fee" type="number" min="1" value="${e.fee || ws.default_fee || 499}" style="width:110px"><input id="w_gst" type="number" step="0.01" value="${e.gst_rate ?? ws.default_gst ?? 18}" style="width:80px"><span class="faint" id="w_tot" style="font-size:12.5px"></span></div></div>
      ${fld('w_cap', 'Seat limit (blank = no limit)', inp('w_cap', e.capacity ?? '', 'number'))}${fld('w_camp', 'Campaign (for ROI)', `<select id="w_camp">${opts(DB.t.campaigns.map((c) => [c.id, c.name]), e.campaign_id, 'None')}</select>`)}
      ${fld('w_slug', 'Registration link name', inp('w_slug', e.slug || '', 'text', 'placeholder="made from the title"'))}${fld('w_st', 'Status', sel('w_st', ['Planned', 'Confirmed', 'Done', 'Cancelled'], e.status || 'Confirmed'))}
      ${fld('w_q', 'Extra questions on the form (one per line · options after a colon, separated by |)', `<textarea id="w_q" style="min-height:60px" placeholder="Highest qualification: 10th | 12th | Diploma | Graduate">${esc(qs)}</textarea>`, 'full')}
      <label class="check"><input type="checkbox" id="w_open" ${e.registration_open !== false ? 'checked' : ''}> Registration open</label><label class="check"><input type="checkbox" id="w_r24" ${e.remind_24h !== false ? 'checked' : ''}> Reminder 24 hours before</label><label class="check"><input type="checkbox" id="w_r1" ${e.remind_1h !== false ? 'checked' : ''}> Reminder 1 hour before</label>
      ${fld('w_rec', 'Recording link (sent to participants after the webinar)', inp('w_rec', e.recording_link || '', 'url'), 'full')}</div>
      <div class="note info">Registrants fill in name, email, phone and city${e.is_paid ? ' and pay online (Razorpay: UPI, cards, net banking)' : ''}. ${e.is_paid ? 'Once payment succeeds they' : 'They'} become Active participants, get the joining link by email, and are linked to a lead in the CRM.</div>`,
    foot: '<button class="btn primary" id="w_save">Save webinar</button>' });
  const el = m.el; let paid = !!e.is_paid;
  const tot = () => { el.querySelector('#w_tot').textContent = `= ${inrFull(Number(v(el, 'w_fee') || 0) * (1 + Number(v(el, 'w_gst') || 0) / 100))} incl. GST`; };
  el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { paid = b.dataset.p === '1'; el.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-pressed', x === b)); el.querySelector('#w_feew').hidden = !paid; }));
  ['w_fee', 'w_gst'].forEach((id) => (el.querySelector('#' + id).oninput = tot)); tot();
  el.querySelector('#w_save').onclick = () => guard(async () => {
    const title = v(el, 'w_t').trim(); if (!title) throw new Error('Add a title');
    const link = v(el, 'w_link').trim(); if (link && !/^https:\/\//.test(link)) throw new Error('The meeting link should start with https://');
    const start = fromLocal(v(el, 'w_s')); if (!start) throw new Error('Pick the date and time');
    let slug = (v(el, 'w_slug').trim() || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    if (DB.t.events.some((x) => x.slug === slug && x.id !== e.id)) slug = slug.slice(0, 44) + '-' + Math.random().toString(36).slice(2, 6);
    const questions = v(el, 'w_q').split('\n').map((x) => x.trim()).filter(Boolean).map((x, i) => { const [label, o] = x.split(':'); const options = (o || '').split('|').map((y) => y.trim()).filter(Boolean); return { key: 'q' + (i + 1), label: label.trim(), type: options.length ? 'select' : 'text', options }; });
    const row = { kind: 'Webinar', title, description: v(el, 'w_d'), start_at: start, end_at: new Date(new Date(start).getTime() + (num(el, 'w_len') || 60) * 60000).toISOString(), meeting_link: link, owner: v(el, 'w_o'), segment: v(el, 'w_seg'), is_paid: paid, fee: paid ? num(el, 'w_fee') : 0, gst_rate: num(el, 'w_gst') || 18, capacity: v(el, 'w_cap') ? num(el, 'w_cap') : null, campaign_id: v(el, 'w_camp') || null, slug, status: v(el, 'w_st'), questions, registration_open: v(el, 'w_open'), remind_24h: v(el, 'w_r24'), remind_1h: v(el, 'w_r1'), recording_link: v(el, 'w_rec').trim(), location: 'Online' };
    if (paid && !(row.fee > 0)) throw new Error('Enter the fee');
    const saved = e.id ? await DB.update('events', e.id, row) : await DB.insert('events', row);
    m.close(); after?.(saved); if (!e.id) webinarDetail(saved.id, 'link');
  }, 'Webinar saved');
}
let webTab = 'people';
function webinarDetail(id, tab) {
  if (tab) webTab = tab;
  const md = openModal({ title: '', width: 1180, body: '' });
  const draw = () => {
    const e = DB.get('events', id); const s = webStats(e);
    md.el.querySelector('.modal-head h2').textContent = e.title;
    const body = md.el.querySelector('.modal-body');
    const tabs = [['people', `Participants (${s.reg})`], ['link', 'Registration link & form'], ['emails', 'Emails & reminders'], ['funnel', 'Results']];
    body.innerHTML = `<div class="row"><span class="chip acc">${fmtDT(e.start_at)}</span><span class="chip">${esc(DB.pname(e.owner))}</span>${e.is_paid ? `<span class="chip warn">${inrFull(e.fee)} + GST = ${inrFull(webTotal(e))}</span>` : '<span class="chip good">Free</span>'}${e.meeting_link ? `<a class="btn small" href="${esc(e.meeting_link)}" target="_blank" rel="noopener">Open meeting link</a>` : '<span class="chip bad">No meeting link yet</span>'}<span class="spacer"></span><button class="btn small" id="wedit">Edit webinar</button></div>
      <div class="seg">${tabs.map(([k, t]) => `<button data-wt="${k}" aria-pressed="${webTab === k}">${t}</button>`).join('')}</div><div id="wtb" class="stack"></div>`;
    body.querySelectorAll('[data-wt]').forEach((b) => (b.onclick = () => { webTab = b.dataset.wt; draw(); }));
    body.querySelector('#wedit').onclick = () => webinarModal(e, draw);
    const box = body.querySelector('#wtb');
    if (webTab === 'people') webPeople(box, e, s, draw);
    else if (webTab === 'link') webLink(box, e, draw);
    else if (webTab === 'emails') webEmails(box, e, s, draw);
    else webFunnel(box, e, s);
    bindLeadClicks(box);
  };
  draw();
}
let webPF = 'Active';
function webPeople(box, e, s, draw) {
  const list = s.a.filter((x) => webPF === 'All' || x.status === webPF).sort((a, b) => (b.registered_at || '').localeCompare(a.registered_at || ''));
  const canMoney = isFinance() || e.owner === DB.me.id;
  box.innerHTML = `<div class="row"><div class="seg">${['Active', 'Payment pending', 'Registered', 'Cancelled', 'All'].map((k) => `<button data-pf="${k}" aria-pressed="${webPF === k}">${k} (${k === 'All' ? s.reg : s.a.filter((x) => x.status === k).length})</button>`).join('')}</div><span class="spacer"></span><button class="btn small" id="wadd">${svg('plus')} Add participant</button><button class="btn small" id="wmk">Create leads for attendees</button><button class="btn small" id="wmail">${svg('send')} Email participants</button><button class="btn small" id="wexp">Export</button></div>
    <div class="tablewrap" style="max-height:min(520px,60vh)"><table><thead><tr><th>Participant</th><th>Status</th><th class="n">Paid</th><th>Registered</th><th>Attended</th><th>Qualified</th><th>Hand over to</th><th>Outcome</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td>${x.lead_id ? `<a href="#" data-lead="${x.lead_id}">${esc(x.name)}</a>` : esc(x.name)}<div class="s">${esc([x.email, x.phone, x.city].filter(Boolean).join(' · '))}</div>${Object.keys(x.answers || {}).length ? `<div class="s">${Object.entries(x.answers).map(([k, val]) => esc(((e.questions || []).find((q) => q.key === k)?.label || k) + ': ' + val)).join(' · ')}</div>` : ''}</td>
      <td><span class="chip ${x.status === 'Active' ? 'good' : x.status === 'Payment pending' ? 'warn' : x.status === 'Cancelled' || x.status === 'Refunded' ? 'bad' : ''}">${esc(x.status)}</span></td><td class="n">${x.paid_at ? `${inrFull(x.amount)}<div class="s mono">${esc(x.payment_id || '')}</div>` : x.amount ? `<span class="faint">${inrFull(x.amount)} due</span>` : '—'}</td><td>${fmtDT(x.registered_at)}</td>
      <td><input type="checkbox" data-att="${x.id}" ${x.attended ? 'checked' : ''} ${x.status === 'Active' ? '' : 'disabled'} aria-label="Attended"></td><td><input type="checkbox" data-q="${x.id}" ${x.qualified ? 'checked' : ''} aria-label="Qualified"></td>
      <td><select data-ho="${x.id}" style="width:auto">${opts(scopePeople().map((p) => [p.id, p.full_name]), x.handed_over_to, '—')}</select></td><td><input data-out="${x.id}" value="${esc(x.outcome || '')}" placeholder="e.g. Counselling booked" style="width:160px"></td>
      <td class="n">${x.status === 'Payment pending' && canMoney ? `<button class="btn small" data-paid="${x.id}">Mark paid</button>` : ''}${['Active', 'Payment pending', 'Registered'].includes(x.status) ? ` <button class="btn ghost small" data-cancel="${x.id}">Cancel</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="9">${empty('Nobody here', 'Share the registration link to get sign-ups.')}</td></tr>`}</tbody></table></div>`;
  box.querySelectorAll('[data-pf]').forEach((b) => (b.onclick = () => { webPF = b.dataset.pf; draw(); }));
  box.querySelectorAll('[data-att]').forEach((c) => (c.onchange = () => guard(() => DB.update('event_attendees', c.dataset.att, { attended: c.checked }))));
  box.querySelectorAll('[data-q]').forEach((c) => (c.onchange = () => guard(() => DB.update('event_attendees', c.dataset.q, { qualified: c.checked }))));
  box.querySelectorAll('[data-ho]').forEach((sl) => (sl.onchange = () => guard(async () => { const x = DB.get('event_attendees', sl.dataset.ho); await DB.update('event_attendees', x.id, { handed_over_to: sl.value || null, handed_over_at: sl.value ? nowISO() : null }); if (sl.value && x.lead_id) await DB.insert('tasks', { title: `Webinar follow-up: ${x.name}`, kind: 'Follow-up', lead_id: x.lead_id, owner: sl.value, due_at: new Date(Date.now() + 86400e3).toISOString(), priority: 'High' }); }, 'Handed over')));
  box.querySelectorAll('[data-out]').forEach((i) => (i.onchange = () => guard(() => DB.update('event_attendees', i.dataset.out, { outcome: i.value }))));
  box.querySelectorAll('[data-paid]').forEach((b) => (b.onclick = () => guard(async () => { const ref = await promptBox('Payment received outside Razorpay', 'Payment reference (UPI / bank)'); if (ref === null) return; const x = DB.get('event_attendees', b.dataset.paid); await DB.update('event_attendees', x.id, { status: 'Active', payment_id: ref || 'offline', paid_at: nowISO() }); if (x.lead_id && x.amount) await DB.insert('payments', { lead_id: x.lead_id, amount: x.amount, amount_ex: Math.round((x.amount / (1 + (e.gst_rate ?? 18) / 100)) * 100) / 100, mode: 'UPI / bank', reference: ref || 'offline', milestone: 'Webinar fee', status: isFinance() ? 'Verified' : 'Claimed', notes: 'Webinar: ' + e.title }); draw(); }, 'Marked paid · confirmation email queued')));
  box.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => guard(async () => { if (!(await confirmBox('Cancel this registration?', 'Cancel registration'))) return; await DB.update('event_attendees', b.dataset.cancel, { status: 'Cancelled' }); draw(); }, 'Cancelled')));
  box.querySelector('#wadd').onclick = () => regSimulator(e, draw, true);
  box.querySelector('#wmk').onclick = () => guard(async () => { let k = 0; for (const x of s.a.filter((y) => !y.lead_id && y.attended)) { const l = await DB.insert('leads', { funnel: webDept(e), name: isOrgDept(webDept(e)) && x.college ? x.college + ' · webinar' : x.name, contact_name: e.segment === 'CoE' ? x.name : '', phone: x.phone, email: x.email, city: x.city, source: 'Webinar', campaign_id: e.campaign_id, stage: e.segment === 'CoE' ? 'Contacted' : 'Follow Up', owner: x.handed_over_to || e.owner || DB.me.id, temperature: x.qualified ? 'Hot' : 'Warm', consent_email: !!x.consent }); await DB.update('event_attendees', x.id, { lead_id: l.id }); k++; } toast(`${k} lead${k === 1 ? '' : 's'} created`); draw(); });
  box.querySelector('#wmail').onclick = () => emailAttendees(e, draw);
  box.querySelector('#wexp').onclick = () => downloadCSV('webinar-' + (e.slug || 'participants'), s.a.map((x) => ({ name: x.name, email: x.email, phone: x.phone, city: x.city, status: x.status, amount: x.amount, payment_id: x.payment_id || '', paid_at: x.paid_at || '', registered_at: x.registered_at, attended: x.attended, qualified: x.qualified, handed_over_to: DB.pname(x.handed_over_to), outcome: x.outcome || '', ...(x.answers || {}) })));
}
function webLink(box, e, draw) {
  const u = regUrl(e);
  box.innerHTML = `<div class="grid g2"><section class="stack"><div class="field"><label>Registration link · share on WhatsApp, Instagram, email and ads</label><div class="row"><input readonly value="${esc(u)}" class="mono" style="flex:1" aria-label="Registration link"><button class="btn small" id="wcopy">Copy</button></div></div>
      <div class="row"><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(`${e.title} · ${fmtDT(e.start_at)}. Register here: ${u}`)}" target="_blank" rel="noopener">Share on WhatsApp</a><button class="btn small primary" id="wsim">${DB.mode === 'demo' ? 'Try the registration form (demo)' : 'Open the registration page'}</button></div>
      <dl class="kv"><dt>Registration</dt><dd>${e.registration_open !== false ? '<span class="chip good">Open</span>' : '<span class="chip">Closed</span>'}${e.capacity ? ` · ${e.capacity} seats` : ''}</dd><dt>Payment</dt><dd>${e.is_paid ? `Online via Razorpay · ${inrFull(webTotal(e))} incl. ${e.gst_rate}% GST` : 'Free'}</dd><dt>Form fields</dt><dd>Name, email, mobile, city${e.segment === 'CoE' ? ', college' : ', course interest'}${(e.questions || []).map((q) => ', ' + esc(q.label)).join('')}</dd><dt>After registering</dt><dd>${e.is_paid ? 'Pays online → becomes Active → ' : 'Becomes Active → '}gets the joining link by email → linked to a CRM lead (new or existing) → reminders 24 h and 1 h before</dd></dl>
      ${DB.settings.webinar?.public_url ? '' : '<p class="faint" style="font-size:12px;margin:0">The link uses the address where the CRM is hosted. Set a custom address in Settings → Lists if you host register.html elsewhere.</p>'}</section>
    <section><label class="faint" style="font-size:12px">What registrants see</label><div class="mailprev" style="max-height:none"><div style="font-family:Arial,sans-serif"><div style="font-size:12px;color:#005aa9;font-weight:bold;letter-spacing:.06em">GARUDA AEROSPACE · WEBINAR</div><h2 style="margin:6px 0;color:#0d2140">${esc(e.title)}</h2><div style="color:#445;font-size:14px">${new Date(e.start_at).toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} IST · Online</div><p style="color:#334;font-size:14px">${esc(e.description || '')}</p>${['Full name', 'Email', 'Mobile number', 'City', ...(e.questions || []).map((q) => q.label)].map((f) => `<div style="border:1px solid #d7deea;border-radius:8px;padding:9px 10px;margin:6px 0;color:#889;font-size:13px">${esc(f)}</div>`).join('')}<div style="background:#005aa9;color:#fff;border-radius:8px;padding:11px;text-align:center;font-weight:bold;margin-top:10px">${e.is_paid ? `Pay ${inrFull(webTotal(e))} and register` : 'Register free'}</div></div></div></section></div>`;
  box.querySelector('#wcopy').onclick = () => navigator.clipboard?.writeText(u).then(() => toast('Copied'), () => toast('Select the link and copy', true));
  box.querySelector('#wsim').onclick = () => (DB.mode === 'demo' ? regSimulator(e, draw) : window.open(u, '_blank', 'noopener'));
}
/* demo stand-in for register.html (in the live CRM the public page and Razorpay do this) */
function regSimulator(e, after, staff) {
  const m = openModal({ title: staff ? 'Add participant' : 'Registration form · demo', width: 560,
    body: `<div class="form">${fld('r_n', 'Full name', inp('r_n'))}${fld('r_e', 'Email', inp('r_e', '', 'email'))}${fld('r_p', 'Mobile', inp('r_p', '', 'tel'))}${fld('r_c', 'City', inp('r_c'))}${isOrgDept(webDept(e)) ? fld('r_col', 'College / company', inp('r_col')) : fld('r_ci', 'Interested in', sel('r_ci', ['Small Class', 'Medium Class', 'Train the Trainer', 'Not sure'], 'Not sure'))}
      ${(e.questions || []).map((q) => fld('rq_' + q.key, q.label, q.type === 'select' ? sel('rq_' + q.key, q.options, '', 'Choose') : inp('rq_' + q.key))).join('')}</div>
      ${staff && e.is_paid ? '<label class="check"><input type="checkbox" id="r_paid"> Already paid (UPI / cash)</label>' : ''}`,
    foot: `<button class="btn primary" id="r_go">${e.is_paid && !staff ? `Pay ${inrFull(webTotal(e))}` : 'Register'}</button>` });
  m.el.querySelector('#r_go').onclick = () => guard(async () => {
    const name = v(m.el, 'r_n').trim(), email = v(m.el, 'r_e').trim().toLowerCase(), phone = v(m.el, 'r_p').trim();
    if (name.length < 2) throw new Error('Enter the name'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email'); if (phone.replace(/\D/g, '').length < 10) throw new Error('Enter a 10-digit mobile');
    if (DB.t.event_attendees.some((x) => x.event_id === e.id && (x.email || '').toLowerCase() === email && x.status === 'Active')) throw new Error('This email is already registered');
    const ex = dupCheck(phone, email);
    const lead = ex || await DB.insert('leads', { funnel: webDept(e), name: isOrgDept(webDept(e)) && v(m.el, 'r_col') ? v(m.el, 'r_col') + ' · webinar' : name, contact_name: isOrgDept(webDept(e)) ? name : '', phone, email, city: v(m.el, 'r_c'), source: 'Webinar', campaign_id: e.campaign_id, stage: 'New', temperature: 'Warm', owner: e.owner || DB.me.id, consent_email: true, notes: 'Webinar: ' + e.title });
    const answers = Object.fromEntries((e.questions || []).map((q) => [q.key, v(m.el, 'rq_' + q.key) || '']).filter(([, val]) => val));
    const paidNow = !e.is_paid || (!staff) || v(m.el, 'r_paid');
    const att = await DB.insert('event_attendees', { event_id: e.id, lead_id: lead.id, name, email, phone, city: v(m.el, 'r_c'), college: v(m.el, 'r_col') || '', course_interest: v(m.el, 'r_ci') || '', answers, segment: webDept(e), amount: e.is_paid ? webTotal(e) : 0, status: paidNow ? 'Active' : 'Payment pending', order_id: e.is_paid ? 'order_demo_' + uid().slice(0, 8) : null, payment_id: e.is_paid && paidNow ? 'pay_demo_' + uid().slice(0, 8) : null, paid_at: e.is_paid && paidNow ? nowISO() : null, consent: true, utm: {} });
    if (e.is_paid && paidNow) await DB.insert('payments', { lead_id: lead.id, amount: att.amount, amount_ex: Number(e.fee), mode: staff ? 'UPI / cash' : 'Razorpay', reference: att.payment_id, milestone: 'Webinar fee', status: isFinance() ? 'Verified' : 'Claimed', notes: 'Webinar: ' + e.title });
    m.close(); after?.();
  }, e.is_paid && !staff ? 'Payment successful (demo) · participant is Active and the joining link was emailed' : 'Registered · joining link emailed');
}
function emailAttendees(e, after) {
  if (!canEmail() && e.owner !== DB.me.id) return toast('You do not have email marketing access', true);
  const act = DB.t.event_attendees.filter((x) => x.event_id === e.id && x.status === 'Active' && x.email);
  const m = openModal({ title: 'Email participants · ' + esc(e.title), width: 820, body: `<div class="form">${fld('ea_to', 'Send to', sel('ea_to', [['all', `All active participants (${act.length})`], ['att', `Attended (${act.filter((x) => x.attended).length})`], ['no', `Did not attend (${act.filter((x) => !x.attended).length})`]], 'all'))}${fld('ea_tpl', 'Template', `<select id="ea_tpl"><option value="">Blank</option>${DB.t.email_templates.filter((t) => t.category === 'Webinar').map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`)}${fld('ea_s', 'Subject', inp('ea_s', ''), 'full')}${fld('ea_h', 'HTML · {{first_name}} {{webinar}} {{date}} {{time}} {{meeting_link}} {{recording_link}}', '<textarea id="ea_h" style="min-height:160px;font-family:var(--f-mono);font-size:12px"></textarea>', 'full')}</div>`, foot: '<button class="btn primary" id="ea_go">Queue emails</button>' });
  m.el.querySelector('#ea_tpl').onchange = (x) => { const t = DB.get('email_templates', x.target.value); if (t) { m.el.querySelector('#ea_s').value = t.subject; m.el.querySelector('#ea_h').value = t.html; } };
  m.el.querySelector('#ea_go').onclick = () => guard(async () => {
    const w = v(m.el, 'ea_to'); const list = act.filter((x) => w === 'all' || (w === 'att' ? x.attended : !x.attended));
    if (!v(m.el, 'ea_s').trim() || !v(m.el, 'ea_h').trim()) throw new Error('Add a subject and the message');
    const d = new Date(e.start_at); const uns = new Set(DB.t.unsubscribes.map((u) => u.email.toLowerCase()));
    const rows = list.filter((x) => !uns.has(x.email.toLowerCase())).map((x) => { const vars = { first_name: x.name.split(' ')[0], name: x.name, webinar: e.title, date: d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }), time: fmtTime(e.start_at) + ' IST', meeting_link: e.meeting_link, recording_link: e.recording_link }; return { lead_id: x.lead_id, to_email: x.email, to_name: x.name, category: 'Webinar', subject: renderTpl(v(m.el, 'ea_s'), vars), html: renderTpl(v(m.el, 'ea_h'), vars), sender: DB.settings.email?.senders?.Webinar || '', event_id: e.id, scheduled_at: nowISO() }; });
    await DB.insertMany('email_queue', rows); m.close(); toast(`${rows.length} emails queued`); after?.();
  });
}
function webEmails(box, e, s, draw) {
  const q = DB.t.email_queue.filter((x) => x.event_id === e.id);
  const cnt = (rule) => q.filter((x) => x.auto_rule === rule).length;
  const act = s.a.filter((x) => x.status === 'Active');
  box.innerHTML = `<div class="kpis">${kpi({ label: 'Confirmations sent', value: cnt('Webinar confirmation'), sub: `${act.length} active participants` })}${kpi({ label: '24-hour reminders', value: act.filter((x) => x.reminder_24h_at).length || cnt('Webinar reminder'), sub: e.remind_24h !== false ? 'on' : 'off' })}${kpi({ label: '1-hour reminders', value: act.filter((x) => x.reminder_1h_at).length || cnt('Webinar starting soon'), sub: e.remind_1h !== false ? 'on' : 'off' })}${kpi({ label: 'Recording sent', value: act.filter((x) => x.recording_sent_at).length || cnt('Webinar recording'), sub: e.recording_link ? 'link set' : 'add the recording link' })}${kpi({ label: 'Opened', value: q.filter((x) => x.opened_at).length, sub: pct(q.filter((x) => x.opened_at).length, q.filter((x) => x.status === 'Sent').length) + '% of sent' })}</div>
    <div class="note info">Confirmation goes out the moment someone becomes Active (free registration or successful payment). Reminders go automatically 24 hours and 1 hour before the start, and the recording 2 hours after it ends. Change the wording in Email marketing → Templates → Webinar.</div>
    <div class="row"><button class="btn small" id="wrem">Send a reminder now</button><button class="btn small" id="wrec" ${e.recording_link ? '' : 'disabled'}>Send the recording now</button><button class="btn small" id="wns">Follow up non-attendees</button></div>
    <div class="tablewrap short"><table><thead><tr><th>When</th><th>To</th><th>Email</th><th>Status</th><th>Opened</th></tr></thead><tbody>${q.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 300).map((x) => `<tr><td>${fmtDT(x.created_at)}</td><td>${esc(x.to_name)}<div class="s">${esc(x.to_email)}</div></td><td>${esc(x.subject)}</td><td><span class="chip ${x.status === 'Sent' ? 'good' : ''}">${esc(x.status)}</span></td><td>${x.opened_at ? fmtDT(x.opened_at) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="faint">No emails yet.</td></tr>'}</tbody></table></div>`;
  const sendTpl = (name, list) => guard(async () => { const t = DB.t.email_templates.find((x) => x.name === name); if (!t) throw new Error(`Template "${name}" is missing`); const d = new Date(e.start_at); const uns = new Set(DB.t.unsubscribes.map((u) => u.email.toLowerCase())); const rows = list.filter((x) => x.email && !uns.has(x.email.toLowerCase())).map((x) => { const vars = { first_name: x.name.split(' ')[0], name: x.name, webinar: e.title, date: d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }), time: fmtTime(e.start_at) + ' IST', meeting_link: e.meeting_link, recording_link: e.recording_link }; return { lead_id: x.lead_id, template_id: t.id, to_email: x.email, to_name: x.name, category: 'Webinar', subject: renderTpl(t.subject, vars), html: renderTpl(t.html, vars), sender: DB.settings.email?.senders?.Webinar || '', event_id: e.id, auto_rule: name, scheduled_at: nowISO() }; }); if (!rows.length) throw new Error('Nobody to send to'); await DB.insertMany('email_queue', rows); toast(`${rows.length} emails queued`); draw(); });
  box.querySelector('#wrem').onclick = () => sendTpl('Webinar reminder', act);
  box.querySelector('#wrec').onclick = () => sendTpl('Webinar recording', act);
  box.querySelector('#wns').onclick = () => sendTpl('Webinar no-show follow-up', act.filter((x) => !x.attended));
}
function webFunnel(box, e, s) {
  const steps = [['Registered', s.reg], ['Active (confirmed / paid)', s.active], ['Attended', s.att], ['Qualified', s.q], ['Handed over', s.ho], ['Converted to a paid course', s.conv]];
  const mx = Math.max(1, s.reg);
  const src = Object.entries(groupBy(s.a, (x) => x.utm?.utm_source || 'direct')).sort((a, b) => b[1].length - a[1].length);
  box.innerHTML = `<div class="kpis">${kpi({ label: 'Webinar fees collected', value: inr(s.fees) })}${kpi({ label: 'Course revenue from attendees', value: inr(s.rev), sub: `${s.conv} conversions` })}${kpi({ label: 'Cost', value: inr(s.cost), sub: s.conv ? `${inr(s.cost / s.conv)} per conversion` : '' })}${kpi({ label: 'Return', value: s.cost ? ((s.fees + s.rev) / s.cost).toFixed(1) + '×' : '—' })}</div>
    <div class="grid g2"><section><h3>Funnel</h3><div class="funnel" style="margin-top:8px">${steps.map(([k, n]) => `<div class="frow"><span>${k}</span><div class="bar"><i style="width:${(n / mx) * 100}%"></i></div><span class="num" style="text-align:right">${n} · ${pct(n, s.reg)}%</span></div>`).join('')}</div></section>
    <section><h3>Where registrations came from</h3><div class="tablewrap short"><table><tbody>${src.map(([k, a]) => `<tr><td>${esc(k)}</td><td class="n">${a.length}</td><td class="n">${a.filter((x) => x.status === 'Active').length} active</td></tr>`).join('') || '<tr><td class="faint">No data.</td></tr>'}</tbody></table></div></section></div>`;
}
