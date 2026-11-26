/* Garuda CRM · Gmail Desk: everyone's own Gmail, read by Claude every 10 minutes and turned into CRM work.
   Founder requests, update requests, escalations, approvals (as a tree), meetings, new leads and client updates in one place. */
'use strict';

const GM_CAT = {
  founder_request: ['Founder requests', 'flame', 'bad'], escalation: ['Escalations', 'warn', 'bad'], approval_request: ['Approvals', 'appr', 'warn'],
  approval_response: ['Approval replies', 'appr', 'info'], update_request: ['Updates asked', 'clock', 'warn'], internal_request: ['Requests', 'task', 'warn'],
  meeting: ['Meetings', 'pin', 'info'], new_enquiry: ['New enquiries', 'leads', 'good'], client_update: ['Client updates', 'mail', 'info'], fyi: ['FYI', 'note', 'mute'], noise: ['Noise', 'dot', 'mute'],
};
const GM_ONE = { founder_request: 'Founder request', escalation: 'Escalation', approval_request: 'Approval asked', approval_response: 'Approval reply', update_request: 'Update asked', internal_request: 'Request', meeting: 'Meeting', new_enquiry: 'New enquiry', client_update: 'Client update', fyi: 'FYI', noise: 'Noise' };
const GM_ORDER = ['founder_request', 'escalation', 'approval_request', 'update_request', 'internal_request', 'meeting', 'new_enquiry', 'client_update', 'approval_response', 'fyi'];
const GM_DID = { lead_created: 'New lead added', remark: 'Noted on the lead', escalation: 'Escalation logged', meeting: 'Meeting planned', approval: 'Approval tracked', task: 'Gmail task added', notified: 'You were notified' };
const GM_AP = { pending: ['Waiting', 'warn'], approved: ['Approved', 'good'], rejected: ['Rejected', 'bad'], info_needed: ['More info asked', 'warn'], cancelled: ['Cancelled', 'mute'] };
const GMS = { tab: 'action', cat: '', q: '', acct: undefined, items: null, aps: null, busy: false };

const gmLink = (thread) => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(thread || '')}`;
const gmWho = (n, e) => esc(n || e || 'someone');

async function gmLoad() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [a, it, ap] = await Promise.all([
    DB.sb.rpc('my_gmail'),
    DB.sb.from('gmail_items').select('*').gte('received_at', since).order('received_at', { ascending: false }).limit(400),
    DB.sb.from('gmail_approvals').select('*').order('updated_at', { ascending: false }).limit(200),
  ]);
  GMS.acct = a.data || null; GMS.items = it.data || []; GMS.aps = ap.data || [];
}

/* Google's code sign-in: the server keeps the long-lived permission so the 10-minute reading works when the CRM is closed */
async function gmConnect(after) {
  const cid = DB.settings.google?.client_id;
  if (!cid) { toast('Google sign-in is not set up yet. Ask the admin to add the Google client ID in Settings.', true); return; }
  try {
    await ggLoadScript();
    const cc = window.google.accounts.oauth2.initCodeClient({
      client_id: cid, scope: 'https://www.googleapis.com/auth/gmail.readonly', ux_mode: 'popup', login_hint: DB.me?.email || '', select_account: false,
      callback: async (r) => {
        if (r.error) { toast('Google: ' + r.error, true); return; }
        GMS.busy = true; after();
        try { const out = await DB.fn('gmail', { action: 'connect', code: r.code }); toast(`Gmail connected · read ${out.read || 0} emails`); }
        catch (e) { toast(e.message, true); }
        GMS.busy = false; await gmLoad(); after();
      },
    });
    cc.requestCode();
  } catch (e) { toast(e.message, true); }
}
async function gmSync(after) {
  GMS.busy = true; after();
  try { const r = await DB.fn('gmail', { action: 'sync' }); toast(r.read ? `Read ${r.read} new email${r.read === 1 ? '' : 's'} · ${r.actions} things updated` : 'No new email'); }
  catch (e) { toast(e.message, true); }
  GMS.busy = false; await gmLoad(); after();
}

function gmItemCard(i) {
  const [, , tone] = GM_CAT[i.category] || GM_CAT.fyi;
  const lead = i.lead_id && DB.get('leads', i.lead_id); const task = i.task_id && DB.get('work_tasks', i.task_id);
  const late = i.due_date && i.status === 'open' && i.due_date < todayStr();
  return `<article class="gm-card ${i.status !== 'open' ? 'gm-done' : ''}" data-gi="${i.id}">
    <div class="gm-top"><span class="chip tone ${tone === 'mute' ? '' : tone}">${esc(GM_ONE[i.category] || 'Email')}</span>
      ${i.priority === 'high' ? '<span class="chip tone bad">High</span>' : ''}${i.direction === 'out' ? '<span class="chip">Sent</span>' : ''}
      <span class="faint gm-when">${esc(rel(i.received_at))}</span></div>
    <div class="gm-from">${i.direction === 'out' ? 'To ' + esc((i.to_emails || '').split(',')[0]) : gmWho(i.from_name, i.from_email)}</div>
    <div class="gm-subj">${esc(i.subject || '')}</div>
    ${i.summary ? `<p class="gm-sum">${esc(i.summary)}</p>` : ''}
    ${i.action_needed && i.status === 'open' ? `<div class="gm-act"><span class="gm-arrow">→</span> <b>${esc(i.action_needed)}</b>${i.due_date ? ` <span class="chip tone ${late ? 'bad' : 'warn'}">${late ? 'Overdue · ' : 'By '}${esc(fmtDate(i.due_date))}</span>` : ''}</div>` : ''}
    <div class="gm-did">${(i.did || []).map((d) => `<span class="gm-tick">${svg('check')} ${esc(GM_DID[d] || d)}</span>`).join('')}</div>
    <div class="gm-links">
      ${lead ? `<a href="#" data-glead="${lead.id}">${svg('leads')} ${esc(lead.name)}</a>` : ''}
      ${task ? `<a href="#" data-gtask="${task.id}">${svg('task')} Task · ${esc(task.status)}</a>` : ''}
      ${i.visit_id ? `<a href="#visits">${svg('pin')} Meeting</a>` : ''}
      ${i.complaint_id ? `<a href="#escalations">${svg('warn')} Escalation</a>` : ''}
      <a href="${gmLink(i.thread_id)}" target="_blank" rel="noopener">${svg('mail')} Open in Gmail</a>
      <span class="grow"></span>
      ${i.status === 'open' ? `<button class="btn small good" data-gdone="${i.id}">${svg('check')} Done</button><button class="btn small ghost" data-gdis="${i.id}">Dismiss</button>` : `<button class="btn small ghost" data-gopen="${i.id}">Reopen</button>`}
    </div></article>`;
}

/* one approval as a tree: item → who asked → who decides → each reply → what happens next */
function gmApTree(a) {
  const [st, tone] = GM_AP[a.status] || GM_AP.pending;
  const lead = a.lead_id && DB.get('leads', a.lead_id); const task = a.task_id && DB.get('work_tasks', a.task_id);
  const mine = (e) => e && e === String(DB.me?.email || '').toLowerCase();
  const nm = (n, e) => (mine(e) ? 'You' : esc(n || (DB.t.profiles.find((p) => (p.email || '').toLowerCase() === e)?.full_name) || e || '—'));
  const tl = (a.timeline || []);
  const evName = { requested: 'Asked for approval', approved: 'Approved', rejected: 'Rejected', info_needed: 'Asked for more info', update: 'Replied' };
  const evTone = { approved: 'good', rejected: 'bad', info_needed: 'warn', requested: 'info' };
  return `<article class="gm-ap gm-ap-${a.status}">
    <header class="gm-ap-h"><div class="grow"><div class="gm-ap-item">${esc(a.item || a.subject || 'Approval')}</div>
      <div class="faint gm-ap-sub">${lead ? `<a href="#" data-glead="${lead.id}">${svg('leads')} ${esc(lead.name)}</a> · ` : ''}${esc(a.subject || '')}</div></div>
      <span class="chip tone ${tone}">${st}</span></header>
    <ol class="gm-tree">
      <li class="gm-node"><span class="gm-dot info"></span><div><b>${nm(a.requester_name, a.requester_email)}</b> <span class="faint">asked</span></div></li>
      <li class="gm-node"><span class="gm-dot ${a.status === 'pending' ? 'warn pulse' : tone}"></span><div><b>${nm(a.approver_name, a.approver_email)}</b> <span class="faint">decides</span></div></li>
      ${tl.map((e) => `<li class="gm-node gm-ev"><span class="gm-dot ${evTone[e.event] || 'mute'}"></span><div><span class="faint">${esc(fmtDT(e.at))}</span> · <b>${esc(e.who || '')}</b> — ${esc(evName[e.event] || e.event)}${e.note ? `<div class="gm-note">${esc(e.note)}</div>` : ''}</div></li>`).join('')}
      <li class="gm-node gm-next"><span class="gm-dot ${a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'bad' : 'mute'}"></span><div><span class="faint">Next</span> · <b>${esc(a.next_step || (a.status === 'pending' ? 'Waiting for the decision' : '—'))}</b>${task ? ` <a href="#" data-gtask="${task.id}">${svg('task')} task ${esc(task.status)}</a>` : ''}</div></li>
    </ol>
    <a class="faint gm-ap-open" href="${gmLink(a.thread_id)}" target="_blank" rel="noopener">${svg('mail')} Open the thread in Gmail</a>
  </article>`;
}

VIEWS.gmail = {
  title: 'Gmail Desk', sub: 'Your Gmail, read by Claude every 10 minutes: what founders and managers ask, client news, escalations, approvals and meetings — already linked to leads and tasks.',
  actions: () => '',
  async render(el) {
    const paint = () => this.paint(el);
    if (GMS.items === null || GMS.acct === undefined) { el.innerHTML = '<section class="glass panel"><p class="faint">Loading your Gmail Desk…</p></section>'; await gmLoad().catch((e) => { GMS.items = []; GMS.aps = []; GMS.acct = null; toast(friendly(e), true); }); }
    if (!el.isConnected) return;
    this.paint(el);
    if (!this.sub2) { this.sub2 = true; setInterval(() => { if (ST.view === 'gmail' && !GMS.busy && document.visibilityState === 'visible') gmLoad().then(() => ST.view === 'gmail' && paint(), () => {}); }, 120000); }
  },
  paint(el) {
    const paint = () => this.paint(el);
    const a = GMS.acct; const items = GMS.items || []; const me = DB.me?.id;
    const mineItems = items.filter((i) => i.user_id === me);
    const open = mineItems.filter((i) => i.status === 'open' && i.category !== 'noise' && i.category !== 'fyi');
    const myAps = (GMS.aps || []).filter((x) => x.user_id === me); const teamAps = (GMS.aps || []).filter((x) => x.user_id !== me);
    const apWait = myAps.filter((x) => ['pending', 'info_needed'].includes(x.status));
    const n = (c) => open.filter((i) => i.category === c).length;
    const conn = a ? `<div class="gm-conn on"><span class="gm-live"></span><div class="grow"><b>${esc(a.email)}</b> <span class="faint">· connected · read ${a.last_sync_at ? esc(rel(a.last_sync_at)) : 'soon'}${a.active ? ' · checks every 10 min' : ''}</span>
          ${a.last_error ? `<div class="gm-err">${svg('warn')} ${esc(a.last_error)}</div>` : ''}</div>
        <button class="btn small" id="gmsync" ${GMS.busy ? 'disabled' : ''}>${svg('repeat')} ${GMS.busy ? 'Reading…' : 'Check now'}</button>
        ${!a.active ? `<button class="btn small primary" id="gmconn">Reconnect</button>` : ''}<button class="btn small ghost" id="gmoff">Disconnect</button></div>`
      : `<div class="gm-conn"><div class="grow"><b>Connect your Gmail</b><div class="faint">Read-only. Claude reads new mail, sorts it, links it to leads and adds tasks. Only you see your mail here; it never sends or deletes email.</div></div>
        <button class="btn primary" id="gmconn" ${GMS.busy ? 'disabled' : ''}>${svg('mail')} ${GMS.busy ? 'Connecting…' : 'Connect Gmail'}</button></div>`;
    const tabs = [['action', `Needs action <b>${open.length}</b>`], ['approvals', `Approvals <b>${apWait.length}</b>`], ['all', 'All mail'], ['done', 'What the CRM did']];
    let body = '';
    if (GMS.tab === 'action') {
      const groups = GM_ORDER.map((c) => [c, open.filter((i) => i.category === c && (!GMS.q || (i.subject + i.summary + i.from_name).toLowerCase().includes(GMS.q.toLowerCase())))]).filter(([, l]) => l.length);
      body = groups.length ? '<div class="gm-board">' + groups.map(([c, l]) => `<section class="gm-group"><h3 class="gm-gh">${svg(GM_CAT[c][1])} ${esc(GM_CAT[c][0])} <span class="faint">${l.length}</span></h3><div class="gm-cards">${l.map(gmItemCard).join('')}</div></section>`).join('') + '</div>'
        : empty(a ? 'Inbox zero for the CRM' : 'Nothing yet', a ? 'Nothing in your mail needs action right now. New mail is checked every 10 minutes.' : 'Connect Gmail and this fills with what people are asking you.');
    } else if (GMS.tab === 'approvals') {
      const sec = (t, l, sub) => (l.length ? `<section class="gm-group"><h3 class="gm-gh">${t} <span class="faint">${l.length}</span></h3>${sub ? `<p class="faint" style="margin:-4px 0 8px">${sub}</p>` : ''}<div class="gm-aps">${l.map(gmApTree).join('')}</div></section>` : '');
      const mail = String(DB.me?.email || '').toLowerCase();
      const toMe = myAps.filter((x) => x.approver_email === mail); const byMe = myAps.filter((x) => x.approver_email !== mail);
      body = (sec('Waiting on you', toMe.filter((x) => x.status === 'pending')) + sec('You asked', byMe) + sec('You decided', toMe.filter((x) => x.status !== 'pending'))
        + sec('On leads you can see', teamAps, 'Approvals your teammates tracked on these leads.')) || empty('No approvals yet', 'When someone asks for or gives an approval by email, it shows here as a tree with what happens next.');
    } else {
      const done = GMS.tab === 'done';
      const l = mineItems.filter((i) => (done ? (i.did || []).length : i.category !== 'noise') && (!GMS.cat || i.category === GMS.cat) && (!GMS.q || (i.subject + i.summary + i.from_name + i.from_email).toLowerCase().includes(GMS.q.toLowerCase())));
      body = l.length ? `<div class="gm-cards">${l.slice(0, 120).map(gmItemCard).join('')}</div>` : empty('Nothing here', done ? 'When the CRM adds a lead, task, meeting or approval from your mail, it is listed here.' : 'No mail matches.');
    }
    el.innerHTML = `<section class="glass panel gm-head">${conn}</section>
      <div class="kpis">${kpi({ label: 'Needs action', value: open.length, tone: open.length ? 'warn' : '' })}${kpi({ label: 'Founder asks', value: n('founder_request'), tone: n('founder_request') ? 'bad' : '' })}${kpi({ label: 'Escalations', value: n('escalation'), tone: n('escalation') ? 'bad' : '' })}${kpi({ label: 'Approvals waiting', value: apWait.length })}${kpi({ label: 'New leads (30 days)', value: mineItems.filter((i) => (i.did || []).includes('lead_created')).length, tone: 'good' })}</div>
      <section class="glass panel"><div class="filters"><div class="seg" role="tablist">${tabs.map(([k, t]) => `<button data-gtab="${k}" aria-pressed="${GMS.tab === k}">${t}</button>`).join('')}</div>
        ${GMS.tab === 'all' || GMS.tab === 'done' ? sel('gmcat', GM_ORDER.map((c) => [c, GM_CAT[c][0]]), GMS.cat, 'Every kind') : ''}
        <input type="search" id="gmq" placeholder="Search sender, subject" value="${esc(GMS.q)}"><a class="btn small ghost" href="#tasks/gmail">${svg('task')} Gmail tasks</a></div>
        <div id="gmbody">${body}</div></section>
      ${isHead() ? `<details class="glass panel gm-set"><summary><b>Who counts as founder / leadership</b> <span class="faint">· their emails become “Founder requests”</span></summary>
        <textarea id="gmlead" rows="3" placeholder="One per line: Name | how you call them | email">${esc((DB.settings.gmail?.leaders || []).map((l) => [l.name, l.alias || '', l.email || ''].join(' | ')).join('\n'))}</textarea>
        <button class="btn small primary" id="gmlsave">Save</button></details>` : ''}`;
    const q = (s) => el.querySelector(s);
    el.querySelectorAll('[data-gtab]').forEach((b) => (b.onclick = () => { GMS.tab = b.dataset.gtab; paint(); }));
    q('#gmcat') && (q('#gmcat').onchange = (e) => { GMS.cat = e.target.value; paint(); });
    let gt; q('#gmq').oninput = (e) => { clearTimeout(gt); gt = setTimeout(() => { GMS.q = e.target.value; const at = e.target.selectionStart; paint(); const s2 = el.querySelector('#gmq'); if (s2) { s2.focus(); s2.setSelectionRange(at, at); } }, 350); };
    q('#gmconn') && (q('#gmconn').onclick = () => gmConnect(paint));
    q('#gmsync') && (q('#gmsync').onclick = () => gmSync(paint));
    q('#gmoff') && (q('#gmoff').onclick = async () => { if (q('#gmoff').dataset.sure !== '1') { q('#gmoff').dataset.sure = '1'; q('#gmoff').textContent = 'Sure? Tap again'; return; } await DB.sb.rpc('gmail_disconnect'); toast('Gmail disconnected'); await gmLoad(); paint(); });
    el.querySelectorAll('[data-glead]').forEach((x) => (x.onclick = (e) => { e.preventDefault(); openLead(x.dataset.glead); }));
    el.querySelectorAll('[data-gtask]').forEach((x) => (x.onclick = (e) => { e.preventDefault(); taskDrawer(x.dataset.gtask); }));
    const setSt = async (id, status) => { const { error } = await DB.sb.from('gmail_items').update({ status }).eq('id', id); if (error) return toast(friendly(error), true); const it = GMS.items.find((i) => i.id === id); if (it) it.status = status; paint(); };
    el.querySelectorAll('[data-gdone]').forEach((b) => (b.onclick = async () => {
      const it = GMS.items.find((i) => i.id === b.dataset.gdone); await setSt(b.dataset.gdone, 'done');
      const t = it?.task_id && DB.get('work_tasks', it.task_id); if (t && t.status !== 'Done') DB.update('work_tasks', t.id, { status: 'Done', progress: 100, done_at: nowISO() }).catch(() => {});
    }));
    el.querySelectorAll('[data-gdis]').forEach((b) => (b.onclick = () => setSt(b.dataset.gdis, 'dismissed')));
    el.querySelectorAll('[data-gopen]').forEach((b) => (b.onclick = () => setSt(b.dataset.gopen, 'open')));
    q('#gmlsave') && (q('#gmlsave').onclick = async () => {
      const leaders = q('#gmlead').value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([name, alias, email]) => ({ name, alias: alias || '', email: (email || '').toLowerCase() }));
      try { await DB.setSetting('gmail', { ...(DB.settings.gmail || {}), leaders }); toast('Saved'); } catch (e) { toast(friendly(e), true); }
    });
  },
};
