/* Garuda CRM · Activity log: who did what, for the Super admin only (the database enforces it too) */
'use strict';

/* every area the log covers: [table, area name, one record] */
const ACT_AREAS = [
  ['leads', 'Leads', 'lead'], ['remarks', 'Remarks', 'remark'], ['payments', 'Payments', 'payment'], ['revenue_entries', 'Revenue', 'revenue entry'],
  ['work_tasks', 'Tasks', 'task'], ['work_subtasks', 'Subtasks', 'subtask'], ['tasks', 'Reminders', 'reminder'], ['visits', 'Field visits', 'visit'],
  ['institutions', 'Accounts', 'account'], ['contacts', 'Contacts', 'contact'], ['projects', 'Projects', 'project'], ['project_items', 'Project items', 'project item'],
  ['complaints', 'Escalations', 'escalation'], ['admissions', 'Admissions', 'admission'], ['automations', 'Automations', 'workflow'],
  ['mkt_campaigns', 'Email campaigns', 'email campaign'], ['email_templates', 'Email templates', 'email template'], ['email_lists', 'Email lists', 'email list'], ['email_sequences', 'Email sequences', 'email sequence'],
  ['campaigns', 'Campaigns', 'campaign'], ['campaign_spend', 'Ad spend', 'ad spend entry'], ['events', 'Events', 'event'], ['batches', 'Batches', 'batch'],
  ['products', 'Price book', 'price book item'], ['product_items', 'Price book lines', 'price book line'], ['price_disclosures', 'Price disclosures', 'price disclosure'],
  ['sales_targets', 'Sales targets', 'sales target'], ['targets', 'Targets', 'target'], ['eod_reports', 'EOD reports', 'EOD report'], ['daily_mom', 'Daily MOM', 'MOM'],
  ['approvals', 'Approvals', 'approval'], ['approval_rules', 'Approval rules', 'approval rule'], ['business_tasks', 'Business tasks', 'business task'],
  ['review_meetings', 'Reviews', 'review'], ['review_items', 'Review items', 'review item'],
  ['profiles', 'Users', 'user'], ['settings', 'Settings', 'setting'], ['session', 'Sign-ins', 'session'],
];
const actArea = (t) => ACT_AREAS.find((a) => a[0] === t) || [t, String(t).replace(/_/g, ' '), String(t).replace(/_/g, ' ')];
const ACT_VERB = { insert: 'added', update: 'changed', delete: 'deleted', 'sign in': 'signed in', export: 'exported', import: 'imported' };
const ACT_TONE = { insert: 'good', update: 'info', delete: 'bad', 'sign in': 'mute', export: 'warn', import: 'warn' };
const ACT_PERIODS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']];
const AF2 = { period: '7', from: '', to: '', who: '', area: '', action: '', q: '', people: true };

function actRange() {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (AF2.period === 'custom' && AF2.from) {
    const f = new Date(AF2.from + 'T00:00:00'); const t = AF2.to ? new Date(AF2.to + 'T00:00:00') : new Date(d0); t.setDate(t.getDate() + 1);
    return [f.toISOString(), t.toISOString()];
  }
  const days = AF2.period === 'today' ? 0 : Number(AF2.period) || 7;
  const f = new Date(d0); f.setDate(f.getDate() - days);
  return [f.toISOString(), new Date(Date.now() + 60000).toISOString()];
}
const ACT_FIELD = { full_name: 'Name', owner: 'Owner', stage: 'Stage', status: 'Status', super_admin: 'Super admin', reports_to: 'Reports to', lead_id: 'Lead', due_date: 'Due date', due_at: 'Due', amount: 'Amount', value: 'Value' };
const actField = (k) => ACT_FIELD[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');
function actVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return nfmt(v);
  if (Array.isArray(v)) return v.length ? v.map(actVal).join(', ') : '—';
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 120 ? s.slice(0, 117) + '…' : s; }
  const s = String(v);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) { const p = DB.profile(s); if (p) return p.full_name || p.email; const l = DB.get('leads', s); return l ? l.name : 'a record'; }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return fmtDT(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
}
const actWho = (id) => (id ? DB.pname(id) : 'System / import');
function actSentence(r) {
  const [, , one] = actArea(r.table_name);
  if (r.table_name === 'session') return `${ACT_VERB[r.action] || r.action}${r.ref ? ` <span class="faint">· ${esc(r.ref)}</span>` : ''}`;
  const verb = ACT_VERB[r.action] || r.action;
  const keys = r.action === 'update' && r.diff ? Object.keys(r.diff) : [];
  const what = keys.length ? ` <span class="faint">· ${esc(keys.slice(0, 4).map(actField).join(', '))}${keys.length > 4 ? ` +${keys.length - 4}` : ''}</span>` : '';
  const ref = r.ref ? ` <b>${esc(r.ref.length > 70 ? r.ref.slice(0, 67) + '…' : r.ref)}</b>` : '';
  return `${verb} ${r.table_name === 'settings' ? 'setting' : esc(one)}${ref}${what}`;
}
function actDetail(r) {
  if (r.action === 'update' && r.diff) {
    return `<div class="actdiff">${Object.entries(r.diff).map(([k, [a, b]]) => `<div><span class="faint">${esc(actField(k))}</span><span><s>${esc(actVal(a))}</s> → <b>${esc(actVal(b))}</b></span></div>`).join('')}</div>`;
  }
  if (r.diff && typeof r.diff === 'object') {
    const ents = Object.entries(r.diff).filter(([k, x]) => x !== null && x !== '' && !/^(id|created_at|updated_at|import_key)$/.test(k)).slice(0, 14);
    return ents.length ? `<div class="actdiff">${ents.map(([k, x]) => `<div><span class="faint">${esc(actField(k))}</span><span>${esc(actVal(x))}</span></div>`).join('')}</div>` : '';
  }
  return '';
}

VIEWS.activity = {
  title: 'Activity log', sub: 'Who did what in the CRM, by person, area and date. Only the Super admin can see this page.',
  actions: () => '',
  async render(el) {
    if (!isSuper()) { el.innerHTML = `<section class="glass panel">${empty('Super admin only', 'The activity log is visible only to the Super admin.')}</section>`; return; }
    const people = DB.t.profiles.filter((p) => p.full_name || p.email).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
    el.innerHTML = `<section class="glass panel"><div class="filters">
        <div class="seg">${ACT_PERIODS.map(([k, t]) => `<button data-ap="${k}" aria-pressed="${AF2.period === k}">${t}</button>`).join('')}</div>
        ${AF2.period === 'custom' ? `<input type="date" id="afrom" value="${esc(AF2.from)}" aria-label="From"><input type="date" id="ato" value="${esc(AF2.to)}" aria-label="To">` : ''}
        ${sel('awho', [['system', 'System / import'], ...people.map((p) => [p.id, (p.full_name || p.email) + (p.active ? '' : ' (inactive)')])], AF2.who, 'Everyone')}
        ${sel('aarea', ACT_AREAS.map(([k, t]) => [k, t]), AF2.area, 'Every area')}
        ${sel('aact', [['insert', 'Added'], ['update', 'Changed'], ['delete', 'Deleted'], ['sign in', 'Signed in']], AF2.action, 'Any action')}
        <input type="search" id="aq2" placeholder="Search lead, task or record name" value="${esc(AF2.q)}">
        <label class="achk"><input type="checkbox" id="apeople" ${AF2.people ? 'checked' : ''}> People only (hide imports and automations)</label>
      </div></section>
      <div class="kpis" id="akpi">${kpi({ label: 'Actions', value: '…' })}${kpi({ label: 'People active', value: '…' })}${kpi({ label: 'Records added', value: '…' })}${kpi({ label: 'Deleted', value: '…' })}</div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2>By person</h2><span class="faint" style="font-size:12px">Tap a name to see only their activity</span></div><div id="aperson"><p class="faint">Loading…</p></div></section>
        <section class="glass panel"><div class="panel-head"><h2>By area</h2><span class="faint" style="font-size:12px">Tap an area to filter</span></div><div id="aareas"><p class="faint">Loading…</p></div></section>
      </div>
      <section class="glass panel"><div class="panel-head"><h2>Timeline</h2><span class="faint" id="acount" style="font-size:12px"></span></div><div id="afeed"><p class="faint">Loading…</p></div>
        <div class="row" style="justify-content:center;margin-top:10px"><button class="btn small" id="amore" hidden>Show more</button></div></section>`;
    const rer = () => this.render(el);
    el.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => { AF2.period = b.dataset.ap; rer(); }));
    const on = (id, k, ev = 'onchange') => { const x = el.querySelector('#' + id); if (x) x[ev] = () => { AF2[k] = x.type === 'checkbox' ? x.checked : x.value; rer(); }; };
    on('afrom', 'from'); on('ato', 'to'); on('awho', 'who'); on('aarea', 'area'); on('aact', 'action'); on('apeople', 'people');
    const q = el.querySelector('#aq2'); q.oninput = () => { AF2.q = q.value; clearTimeout(this._t); this._t = setTimeout(() => { rer(); const i = el.querySelector('#aq2'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 400); };
    const [from, to] = actRange();
    this.summary(el, from, to);
    this.page = 0; this.feed(el, from, to, false);
    el.querySelector('#amore').onclick = () => { this.page++; this.feed(el, from, to, true); };
  },
  async summary(el, from, to) {
    let rows = [];
    try { const { data, error } = await DB.sb.rpc('audit_summary', { p_from: from, p_to: to }); if (error) throw new Error(friendly(error)); rows = data || []; } catch (e) { el.querySelector('#aperson').innerHTML = `<p class="faint">${esc(e.message)}. Run supabase/v51.sql in Supabase.</p>`; el.querySelector('#aareas').innerHTML = ''; return; }
    if (AF2.people) rows = rows.filter((r) => r.changed_by);
    const all = rows;
    if (AF2.area) rows = rows.filter((r) => r.table_name === AF2.area);
    if (AF2.action) rows = rows.filter((r) => r.action === AF2.action);
    const byWho = AF2.who ? rows.filter((r) => (AF2.who === 'system' ? !r.changed_by : r.changed_by === AF2.who)) : rows;
    const n = (rs, f = () => true) => rs.filter(f).reduce((s, r) => s + Number(r.n), 0);
    const kp = el.querySelector('#akpi'); if (!kp?.isConnected) return;
    kp.innerHTML = kpi({ label: 'Actions', value: nfmt(n(byWho)), sub: ACT_PERIODS.find((p) => p[0] === AF2.period)?.[1] || '' })
      + kpi({ label: 'People active', value: nfmt(new Set(byWho.filter((r) => r.changed_by).map((r) => r.changed_by)).size), sub: `${nfmt(n(byWho, (r) => r.action === 'sign in'))} sign-ins` })
      + kpi({ label: 'Records added', value: nfmt(n(byWho, (r) => r.action === 'insert')), sub: `${nfmt(n(byWho, (r) => r.action === 'update'))} changes` })
      + kpi({ label: 'Deleted', value: nfmt(n(byWho, (r) => r.action === 'delete')), sub: 'Kept in full in the log', tone: n(byWho, (r) => r.action === 'delete') ? 'bad' : '' });
    /* per person */
    const P = new Map();
    rows.forEach((r) => { const k = r.changed_by || 'system'; const o = P.get(k) || { k, total: 0, insert: 0, update: 0, delete: 0, sign: 0, last: '' }; const c = Number(r.n); o.total += c; if (r.action === 'sign in') o.sign += c; else if (o[r.action] !== undefined) o[r.action] += c; if (String(r.last_at) > o.last) o.last = String(r.last_at); P.set(k, o); });
    const ps = [...P.values()].sort((a, b) => b.total - a.total);
    el.querySelector('#aperson').innerHTML = ps.length ? `<div class="tablewrap"><table class="acttab"><thead><tr><th>Person</th><th class="n">Added</th><th class="n">Changed</th><th class="n">Deleted</th><th class="n">Sign-ins</th><th>Last active</th></tr></thead><tbody>
      ${ps.map((o) => `<tr class="click ${AF2.who === o.k ? 'sel' : ''}" data-awho="${o.k}"><td><b>${esc(o.k === 'system' ? 'System / import' : actWho(o.k))}</b>${o.k !== 'system' ? `<div class="s faint">${esc(roleName(DB.profile(o.k)) || '')}</div>` : ''}</td><td class="n">${nfmt(o.insert)}</td><td class="n">${nfmt(o.update)}</td><td class="n">${o.delete ? `<span class="chip tone bad">${nfmt(o.delete)}</span>` : '0'}</td><td class="n">${nfmt(o.sign)}</td><td>${o.last ? rel(o.last) : '—'}</td></tr>`).join('')}</tbody></table></div>` : empty('No activity', 'Nobody did anything in this period with these filters.');
    el.querySelectorAll('[data-awho]').forEach((t) => (t.onclick = () => { AF2.who = AF2.who === t.dataset.awho ? '' : t.dataset.awho; this.render(el); }));
    /* per area */
    const A = new Map(); (AF2.area ? byWho : AF2.who ? all.filter((r) => (AF2.who === 'system' ? !r.changed_by : r.changed_by === AF2.who)) : all).filter((r) => !AF2.action || r.action === AF2.action).forEach((r) => A.set(r.table_name, (A.get(r.table_name) || 0) + Number(r.n)));
    const as = [...A.entries()].sort((a, b) => b[1] - a[1]); const mx = Math.max(1, ...as.map((a) => a[1]));
    el.querySelector('#aareas').innerHTML = as.length ? `<div class="actbars">${as.map(([t, c]) => `<button class="actbar ${AF2.area === t ? 'sel' : ''}" data-aarea="${t}"><span>${esc(actArea(t)[1])}</span><i style="--w:${Math.max(3, (c / mx) * 100)}%"></i><b>${nfmt(c)}</b></button>`).join('')}</div>` : empty('No activity', 'Nothing in this period.');
    el.querySelectorAll('[data-aarea]').forEach((b) => (b.onclick = () => { AF2.area = AF2.area === b.dataset.aarea ? '' : b.dataset.aarea; this.render(el); }));
  },
  async feed(el, from, to, more) {
    const PG = 100; const box = el.querySelector('#afeed'); if (!box) return;
    let qy = DB.sb.from('audit_log').select('*').gte('changed_at', from).lt('changed_at', to);
    if (AF2.who === 'system') qy = qy.is('changed_by', null); else if (AF2.who) qy = qy.eq('changed_by', AF2.who); else if (AF2.people) qy = qy.not('changed_by', 'is', null);
    if (AF2.area) qy = qy.eq('table_name', AF2.area);
    if (AF2.action) qy = qy.eq('action', AF2.action);
    if (AF2.q.trim()) qy = qy.ilike('ref', `%${AF2.q.trim().replace(/[%_,()]/g, ' ')}%`);
    const { data, error } = await qy.order('changed_at', { ascending: false }).range(this.page * PG, this.page * PG + PG - 1);
    if (!box.isConnected) return;
    if (error) { box.innerHTML = `<p class="faint">${esc(friendly(error))}</p>`; return; }
    const rows = data || [];
    this.rows = more ? [...(this.rows || []), ...rows] : rows;
    el.querySelector('#amore').hidden = rows.length < PG;
    el.querySelector('#acount').textContent = this.rows.length ? `Newest first · showing ${nfmt(this.rows.length)}` : '';
    if (!this.rows.length) { box.innerHTML = empty('No activity', 'Nothing matches these filters. Try a longer period or clear a filter.'); return; }
    let day = '';
    box.innerHTML = `<div class="actfeed">${this.rows.map((r, i) => {
      const d = fmtDate(r.changed_at); const head = d !== day ? `<h4 class="actday">${d === fmtDate(new Date()) ? 'Today' : esc(d)}</h4>` : ''; day = d;
      const det = actDetail(r); const lead = r.lead_id && r.table_name !== 'leads' && DB.get('leads', r.lead_id);
      return `${head}<div class="actrow"><span class="acttime">${new Date(r.changed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
        <span class="chip tone ${ACT_TONE[r.action] || 'mute'}">${esc(actArea(r.table_name)[1])}</span>
        <div class="grow"><div><b>${esc(actWho(r.changed_by))}</b> ${actSentence(r)}${lead ? ` <span class="faint">on</span> <a href="#" data-alead="${r.lead_id}">${esc(lead.name)}</a>` : ''}${r.table_name === 'leads' && r.action !== 'delete' && DB.get('leads', r.row_id) ? ` <a href="#" data-alead="${r.row_id}" class="faint">Open</a>` : ''}</div>
        ${det ? `<details><summary class="faint">Details</summary>${det}</details>` : ''}</div></div>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-alead]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openLead(a.dataset.alead); }));
  },
};

/* sign-ins go in the log once per browser tab */
function logSignIn() {
  try { if (sessionStorage.getItem('gc_signed')) return; sessionStorage.setItem('gc_signed', '1'); } catch (_) { /* private window */ }
  const ua = navigator.userAgent; const dev = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Phone' : 'Computer';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  DB.sb.rpc('log_activity', { p_action: 'sign in', p_ref: `${dev} · ${br}` }).then(() => {}, () => {});
}
