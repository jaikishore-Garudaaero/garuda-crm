/* Garuda CRM · Reports → Revenue: Total, one tab per department, Ledger (verification queue, revenue share) */
'use strict';

let revTab = 'overview', ledQ = '';
const REV_FIXED = ['overview', 'targets', 'total', 'ledger'];
const entryOk = (e) => ST.person === 'all' || (e.lead_id && DB.get('leads', e.lead_id)?.owner === ST.person);
function revFigures(code, r) {
  const ok = (c) => !code || c === code;
  const ent = DB.t.revenue_entries.filter((e) => ok(e.department) && entryOk(e));
  const won = M.leads().filter((l) => ok(l.funnel) && L.won(l));
  const wonR = won.filter((l) => M.inR(l.won_at, r));
  const entR = ent.filter((e) => M.inR(e.month, r));
  const collected = sum(entR.filter((e) => e.status === 'Collected'), (e) => e.amount);
  const booked = sum(wonR, (l) => l.value) + sum(entR.filter((e) => !e.lead_id), (e) => e.amount);
  const recvLeads = won.filter((l) => L.due(l) > 0.5);
  const pendingPO = ent.filter((e) => e.status === 'Pending PO' && !e.lead_id);
  const pending = sum(recvLeads, L.due) + sum(pendingPO, (e) => e.amount);
  const months = new Set(); for (let d = new Date(r.from.getFullYear(), r.from.getMonth(), 1); d < r.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.add(localDate(d).slice(0, 7));
  const target = ST.person === 'all' ? sum(DB.t.revenue_targets.filter((t) => ok(t.dept) && months.has(String(t.month).slice(0, 7))), (t) => t.amount) : 0;
  return { ent, entR, won, wonR, collected, booked, pending, recvLeads, pendingPO, target };
}
VIEWS.revenue = {
  title: 'Revenue', sub: 'Target against booked and collected, the breakup by team, segment and executive, and the ledger. Amounts ex-GST; Finance verifies every payment before it counts as collected.',
  render(el) {
    if (ST.arg) { revTab = REV_FIXED.includes(ST.arg) || DEPTS().some((d) => d.code === ST.arg) ? ST.arg : 'overview'; ST.arg = null; }
    if (!REV_FIXED.includes(revTab) && !DEPTS().some((d) => d.code === revTab)) revTab = 'overview';
    const claims = isFinance() ? DB.t.payments.filter((p) => p.status === 'Claimed').length : 0;
    el.innerHTML = `<div class="seg big tabsrow">${[['overview', 'Overview'], ['targets', 'Targets'], ['total', 'By team'], ...DEPTS().map((d) => [d.code, d.code]), ['ledger', 'Ledger' + (claims ? ` <span class="badge">${claims}</span>` : '')]].map(([k, t]) => `<button data-rt="${esc(k)}" aria-pressed="${revTab === k}" ${!REV_FIXED.includes(k) ? `style="--dc:${esc(deptColor(k))}"` : ''}>${!REV_FIXED.includes(k) ? '<i class="ddot"></i>' : ''}${t}</button>`).join('')}</div>
      ${filterBar({ dept: ['overview', 'targets'].includes(revTab), period: !['overview', 'targets'].includes(revTab), person: revTab !== 'targets' })}<div id="revb" class="view"></div>`;
    el.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => { revTab = b.dataset.rt; this.render(el); }));
    bindFilters(el, () => this.render(el));
    const b = el.querySelector('#revb'); const rer = () => this.render(el);
    if (revTab === 'overview') revOverview(b); else if (revTab === 'targets') revTargets(b, rer); else if (revTab === 'total') revTotal(b); else if (revTab === 'ledger') revLedger(b, rer); else revDept(b, revTab);
    bindLeadClicks(b);
  },
};
function monthlyChart(codes, r) {
  const months = M.months(r);
  const shade = ['#004a8c', '#3a8ad0', '#86b8e2', '#0a64b0', '#5a9cd6', '#acd0ee'];
  const series = codes.map((c, i) => ({ name: c, color: shade[i % shade.length], values: months.map((m) => sum(DB.t.revenue_entries.filter((e) => e.department === c && e.status === 'Collected' && String(e.month).slice(0, 7) === m && entryOk(e)), (e) => e.amount)) }));
  const target = ST.person === 'all' ? months.map((m) => sum(DB.t.revenue_targets.filter((t) => codes.includes(t.dept) && String(t.month).slice(0, 7) === m), (t) => t.amount)) : null;
  return barChart({ labels: months.map(monShort), series, stacked: true, target: target && target.some(Boolean) ? target : null });
}
function revTotal(b) {
  const r = curRange();
  const rows = DEPTS().map((d) => ({ d, f: revFigures(d.code, r) }));
  const T = { target: sum(rows, (x) => x.f.target), booked: sum(rows, (x) => x.f.booked), collected: sum(rows, (x) => x.f.collected), pending: sum(rows, (x) => x.f.pending) };
  const ach = (c, t) => (t ? `<span class="chip ${c >= t ? 'good' : c >= t * 0.6 ? 'warn' : 'bad'}">${pct(c, t)}%</span>` : '<span class="faint">no target</span>');
  b.innerHTML = `<section class="glass panel"><div class="panel-head"><h2>By department · ${r.label}</h2><span class="sub">Receivable is what is still owed today on won deals and open POs</span></div>
    <div class="tablewrap"><table><thead><tr><th>Department</th><th class="n">Target</th><th class="n">Booked</th><th class="n">Collected</th><th class="n">Pending / receivable</th><th class="n">% achieved</th></tr></thead><tbody>
    ${rows.map(({ d, f }) => `<tr class="click" data-rt2="${esc(d.code)}"><td>${deptChip(d.code)} ${esc(d.name)}</td><td class="n">${f.target ? inr(f.target) : '—'}</td><td class="n">${inr(f.booked)}</td><td class="n"><b>${inr(f.collected)}</b></td><td class="n">${inr(f.pending)}</td><td class="n">${ach(f.collected, f.target)}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td class="n">${T.target ? inr(T.target) : '—'}</td><td class="n">${inr(T.booked)}</td><td class="n">${inr(T.collected)}</td><td class="n">${inr(T.pending)}</td><td class="n">${ach(T.collected, T.target)}</td></tr></tbody></table></div>
    ${ST.person !== 'all' ? '<p class="faint" style="font-size:12px">Targets are set per department, so they show when Person is Everyone.</p>' : ''}</section>
    <section class="glass panel"><div class="panel-head"><h2>Collected by month</h2><span class="sub">Stacked by department · dashed line is the target</span></div>${monthlyChart(DEPTS().map((d) => d.code), r)}</section>`;
  b.querySelectorAll('[data-rt2]').forEach((tr) => (tr.onclick = () => { revTab = tr.dataset.rt2; render(); }));
}
function revDept(b, code) {
  const r = curRange(); const f = revFigures(code, r);
  const seg = Object.entries(groupBy(f.entR, (e) => e.segment || 'Not stated')).map(([k, a]) => ({ k, c: sum(a.filter((e) => e.status === 'Collected'), (e) => e.amount), p: sum(a.filter((e) => e.status !== 'Collected'), (e) => e.amount), n: a.length })).sort((a, c) => c.c - a.c);
  const cli = Object.entries(groupBy(f.entR, (e) => e.client || 'Not stated')).map(([k, a]) => ({ k, c: sum(a.filter((e) => e.status === 'Collected'), (e) => e.amount), p: sum(a.filter((e) => e.status !== 'Collected'), (e) => e.amount) })).sort((a, c) => c.c + c.p - a.c - a.p).slice(0, 15);
  const age = [[0, 30], [31, 60], [61, 90], [91, 99999]].map(([a, z]) => { const rows = f.recvLeads.filter((l) => daysAgo(l.won_at) >= a && daysAgo(l.won_at) <= z); return { label: z > 9999 ? '90+ days' : `${a}-${z} days`, rows, amt: sum(rows, L.due) }; });
  const ms = M.receivables(code).items;
  const D = new Map(); age.forEach((a, i) => D.set('ag' + i, { title: `Receivable · ${a.label}`, rows: a.rows }));
  b.innerHTML = `<div class="kpis">${kpi({ label: 'Target', value: f.target ? inr(f.target) : '—', sub: r.label })}${kpi({ label: 'Booked', value: inr(f.booked), sub: `${f.wonR.length} deals won` })}${kpi({ label: 'Collected', value: inr(f.collected), sub: f.target ? pct(f.collected, f.target) + '% of target' : r.label, meter: f.target ? pct(f.collected, f.target) : undefined })}${kpi({ label: 'Pending / receivable', value: inr(f.pending), sub: 'Owed today' })}</div>
    <section class="glass panel"><div class="panel-head"><h2>Trend</h2><span class="sub">Collected by month · dashed line is the target</span></div>${monthlyChart([code], r)}</section>
    <div class="grid g2">
      <section class="glass panel"><div class="panel-head"><h2>By segment</h2><span class="sub">${r.label}</span></div>${tbl(['Segment', 'Entries', 'Collected', 'Pending'], seg.map((x) => `<tr><td>${esc(x.k)}</td><td class="n">${x.n}</td><td class="n">${inr(x.c)}</td><td class="n">${x.p ? inr(x.p) : '—'}</td></tr>`), seg.length ? `<tr class="tot"><td>Total</td><td class="n">${sum(seg, (x) => x.n)}</td><td class="n">${inr(sum(seg, (x) => x.c))}</td><td class="n">${inr(sum(seg, (x) => x.p))}</td></tr>` : '')}</section>
      <section class="glass panel"><div class="panel-head"><h2>By client</h2><span class="sub">Top 15 · ${r.label}</span></div>${tbl(['Client', 'Collected', 'Pending'], cli.map((x) => `<tr><td>${esc(x.k)}</td><td class="n">${inr(x.c)}</td><td class="n">${x.p ? inr(x.p) : '—'}</td></tr>`))}</section>
    </div>
    <div class="grid g2">
      <section class="glass panel"><div class="panel-head"><h2>Receivables ageing</h2><span class="sub">Won deals not fully collected, by days since won</span></div>${tbl(['Age', 'Deals', 'Amount'], age.map((a, i) => `<tr><td>${a.label}</td><td class="n">${cnt(a.rows.length, 'ag' + i)}</td><td class="n"><b>${inr(a.amt)}</b></td></tr>`), `<tr class="tot"><td>Total</td><td class="n">${sum(age, (a) => a.rows.length)}</td><td class="n">${inr(sum(age, (a) => a.amt))}</td></tr>`)}
        ${ms.length ? `<h4 style="margin:12px 0 4px">Payment milestones still to collect</h4>${tbl(['Project · milestone', 'Due', 'Amount'], ms.sort((a, c) => String(a.due_date).localeCompare(String(c.due_date))).map((i) => `<tr class="click" data-pj="${i.project_id}"><td>${esc(DB.get('projects', i.project_id)?.name || '')} · ${esc(i.name)}</td><td class="n">${i.due_date ? `<span class="${i.due_date < todayStr() ? 'chip bad' : ''}">${fmtDate(i.due_date)}</span>` : '—'}</td><td class="n">${inr(i.amount)}</td></tr>`))}` : ''}</section>
      <section class="glass panel"><div class="panel-head"><h2>Balance due</h2><span class="sub">Ordered or invoiced, not yet received</span></div>${tbl(['Client', 'Month', 'Amount'], f.pendingPO.sort((a, c) => c.amount - a.amount).map((e) => `<tr><td>${esc(e.client)}${e.opp_ref ? ` <span class="faint">${esc(e.opp_ref)}</span>` : ''}<div class="s">${esc(e.segment)}</div></td><td class="n">${fmtMonth(e.month)}</td><td class="n">${inr(e.amount)}</td></tr>`), f.pendingPO.length ? `<tr class="tot"><td>Total</td><td></td><td class="n">${inr(sum(f.pendingPO, (e) => e.amount))}</td></tr>` : '')}</section>
    </div>`;
  bindDrills(b, D);
  b.querySelectorAll('[data-pj]').forEach((x) => (x.onclick = () => openProject(x.dataset.pj)));
}
function revLedger(b, rer) {
  const r = curRange();
  const rows = DB.t.revenue_entries.filter((e) => M.inR(e.month, r) && entryOk(e) && (!ledQ || `${e.client} ${e.segment} ${e.opp_ref} ${e.note} ${e.department}`.toLowerCase().includes(ledQ.toLowerCase())))
    .sort((a, c) => String(c.month).localeCompare(String(a.month)) || c.amount - a.amount);
  const claims = isFinance() ? DB.t.payments.filter((p) => p.status === 'Claimed').sort((a, c) => String(a.claimed_at).localeCompare(String(c.claimed_at))) : [];
  const shares = M.leads().filter((l) => L.won(l) && Number(l.share_pct) < 100);
  b.innerHTML = `${isFinance() ? `<section class="glass panel"><div class="panel-head"><h2>Verification queue (${claims.length})</h2><span class="sub">Only verified payments count as collected and reach the ledger</span></div>${claims.length ? `<div class="tablewrap"><table><thead><tr><th>Claimed</th><th>Deal</th><th>By</th><th>Paid on</th><th>Mode / reference</th><th class="n">Amount incl. GST</th><th></th></tr></thead><tbody>${claims.map((p) => { const l = DB.get('leads', p.lead_id) || {}; return `<tr><td>${fmtDT(p.claimed_at)}</td><td><a href="#" data-lead="${l.id}">${esc(l.name || '')}</a><div class="s">${deptChip(l.funnel || '')} ${esc(l.lead_no || '')}</div></td><td>${esc(DB.pname(p.claimed_by))}</td><td>${fmtDate(p.paid_on)}</td><td>${esc(p.mode)} ${esc(p.reference)}</td><td class="n">${inrFull(p.amount)}</td><td class="n"><button class="btn small good" data-ver="${p.id}">Verify</button> <button class="btn small danger" data-rej="${p.id}">Reject</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="faint">Nothing waiting.</p>'}</section>` : ''}
    <section class="glass panel"><div class="panel-head"><h2>Ledger · ${r.label}</h2><span class="sub">Every amount ex-GST. Verified payments are added automatically.</span>
      <div class="filters"><input type="search" id="lq" placeholder="Search client, segment, Opp ID" value="${esc(ledQ)}">${isFinance() ? `<button class="btn small" id="lnew">${svg('plus')} Entry</button><button class="btn small" id="anew">${svg('plus')} Admissions</button>` : ''}${canExport() ? '<button class="btn small" id="lexp">Export</button>' : ''}</div></div>
      <div class="tablewrap tall"><table><thead><tr><th>Month</th><th>Department</th><th>Segment</th><th>Client</th><th>Status</th><th>Source</th><th class="n">Amount</th>${isFinance() ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map((e) => `<tr><td>${fmtMonth(e.month)}</td><td>${deptChip(e.department)}</td><td>${esc(e.segment)}</td><td>${e.lead_id ? `<a href="#" data-lead="${e.lead_id}">${esc(e.client)}</a>` : esc(e.client)}${e.opp_ref ? ` <span class="faint">${esc(e.opp_ref)}</span>` : ''}</td><td>${e.status === 'Collected' ? '<span class="chip good">Collected</span>' : '<span class="chip warn">Pending PO</span>'}</td><td>${e.source === 'payment' ? 'CRM payment' : e.source === 'import' ? 'Sales sheet' : 'Manual'}</td><td class="n">${inrFull(e.amount)}</td>${isFinance() ? `<td>${e.source === 'payment' ? '' : `<button class="btn ghost small" data-led="${e.id}">Edit</button>`}</td>` : ''}</tr>`).join('') || `<tr><td colspan="8">${empty('No entries', 'Nothing in this period.')}</td></tr>`}
      <tr class="tot"><td colspan="6">Collected · ${rows.filter((e) => e.status === 'Collected').length} entries</td><td class="n">${inrFull(sum(rows.filter((e) => e.status === 'Collected'), (e) => e.amount))}</td>${isFinance() ? '<td></td>' : ''}</tr></tbody></table></div></section>
    <section class="glass panel"><div class="panel-head"><h2>Revenue-share settlement</h2><span class="sub">Won deals where Garuda's share is below 100%</span></div>${shares.length ? `<div class="tablewrap"><table><thead><tr><th>Deal</th><th class="n">Value</th><th class="n">Garuda share</th><th class="n">Garuda amount</th><th class="n">Partner amount</th><th class="n">Collected</th></tr></thead><tbody>${shares.map((l) => `<tr class="click" data-lead="${l.id}"><td>${esc(L.title(l))}<div class="s">${deptChip(l.funnel)}</div></td><td class="n">${inr(l.value)}</td><td class="n">${l.share_pct}%</td><td class="n">${inr((l.value * l.share_pct) / 100)}</td><td class="n">${inr((l.value * (100 - l.share_pct)) / 100)}</td><td class="n">${inr(L.paidEx(l))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="faint">No revenue-share deals.</p>'}</section>`;
  const q = b.querySelector('#lq'); q.oninput = () => { ledQ = q.value; clearTimeout(revLedger._t); revLedger._t = setTimeout(() => { revLedger(b, rer); const n = b.querySelector('#lq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  b.querySelector('#lexp')?.addEventListener('click', () => downloadCSV('garuda-revenue-ledger', rows.map((e) => ({ month: e.month, department: e.department, channel: e.channel, segment: e.segment, client: e.client, status: e.status, amount_ex_gst: e.amount, opp_id: e.opp_ref, source: e.source, note: e.note }))));
  b.querySelector('#lnew')?.addEventListener('click', () => revenueModal({}, rer));
  b.querySelector('#anew')?.addEventListener('click', () => admissionModal(rer));
  b.querySelectorAll('[data-led]').forEach((x) => (x.onclick = () => revenueModal(DB.get('revenue_entries', x.dataset.led), rer)));
  b.querySelectorAll('[data-ver]').forEach((x) => (x.onclick = () => guard(async () => { await DB.update('payments', x.dataset.ver, { status: 'Verified' }); rer(); }, 'Verified')));
  b.querySelectorAll('[data-rej]').forEach((x) => (x.onclick = () => guard(async () => { await DB.update('payments', x.dataset.rej, { status: 'Rejected' }); rer(); }, 'Rejected')));
}
function revenueModal(e = {}, after) {
  const d0 = e.department || (ST.dept !== 'All' ? ST.dept : DEPTS()[0]?.code);
  const m = openModal({ title: e.id ? 'Edit revenue entry' : 'New revenue entry', width: 680,
    body: `<div class="form">${fld('rm', 'Month', inp('rm', (e.month || localDate(new Date())).slice(0, 7), 'month'))}${fld('rd', 'Department', sel('rd', DEPTS(true).map((d) => [d.code, d.name]), d0))}
      ${fld('rc', 'Channel', sel('rc', [...new Set(['Direct', 'Partner', 'B2B (PO)', 'B2B', 'Academy (direct)', 'Partner centre', e.channel].filter(Boolean))], e.channel || 'Direct'))}${fld('rs', 'Segment', '<select id="rs"></select>')}
      ${fld('rcl', 'Client', inp('rcl', e.client || ''), 'full')}${fld('ra', 'Amount (₹, ex-GST)', inp('ra', e.amount || '', 'number', 'min="0" step="1"'))}${fld('rst', 'Status', sel('rst', ['Collected', 'Pending PO'], e.status || 'Collected'))}
      ${fld('ro', 'Opp / sheet ID (optional)', inp('ro', e.opp_ref || ''))}${fld('rn', 'Note', inp('rn', e.note || ''))}</div>`,
    foot: `${e.id ? '<button class="btn danger" id="rdel" style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="rsave">Save</button>` });
  const segs = () => { const sg = dept(v(m.el, 'rd')).segments || []; m.el.querySelector('#rs').innerHTML = opts([...new Set([...sg, e.segment, 'Other'].filter(Boolean))], e.segment); };
  segs(); m.el.querySelector('#rd').onchange = segs;
  m.el.querySelector('#rsave').onclick = () => guard(async () => {
    const amt = num(m.el, 'ra'); if (!(amt > 0)) throw new Error('Enter the amount.');
    if (!v(m.el, 'rm')) throw new Error('Choose the month.');
    const opp = (v(m.el, 'ro') || '').trim();
    const lead = opp ? DB.t.leads.find((l) => l.ref_id === opp || l.lead_no === opp) : null;
    const row = { month: v(m.el, 'rm') + '-01', department: v(m.el, 'rd'), channel: v(m.el, 'rc'), segment: v(m.el, 'rs'), client: (v(m.el, 'rcl') || '').trim(), amount: amt, status: v(m.el, 'rst'), opp_ref: opp, lead_id: lead?.id || e.lead_id || null, note: (v(m.el, 'rn') || '').trim() };
    if (e.id) await DB.update('revenue_entries', e.id, row); else await DB.insert('revenue_entries', { ...row, source: 'manual' });
    m.close(); after?.();
  }, 'Saved');
  m.el.querySelector('#rdel')?.addEventListener('click', () => guard(async () => { if (!(await confirmBox('Delete this revenue entry?', 'Delete'))) return; await DB.remove('revenue_entries', e.id); m.close(); after?.(); }, 'Deleted'));
}
function admissionModal(after) {
  const ad = DEPTS().filter((d) => d.has_admissions);
  if (!ad.length) return toast('No department counts admissions. Tick "Counts admissions" for one in Settings → Departments.', true);
  const m = openModal({ title: 'Add admissions (monthly totals)', width: 620,
    body: `<p class="faint" style="margin-top:0;font-size:12.5px">For admissions that are not won deals in the CRM (walk-ins, partner batches). Won deals are counted automatically.</p>
    <div class="form">${fld('ad', 'Department', sel('ad', ad.map((d) => [d.code, d.name]), ad[0].code))}${fld('am', 'Month', inp('am', localDate(new Date()).slice(0, 7), 'month'))}${fld('asg', 'Segment', '<select id="asg"></select>')}${fld('ap', 'Paid admissions', inp('ap', '0', 'number', 'min="0" step="1"'))}${fld('af', 'Free admissions', inp('af', '0', 'number', 'min="0" step="1"'))}
    ${fld('asrc', 'Lead source (optional)', sel('asrc', DB.settings.sources || [], '', '—'))}${fld('an', 'Note', inp('an', ''), 'full')}</div>`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="asave">Save</button>' });
  const segs = () => { m.el.querySelector('#asg').innerHTML = opts([...(dept(v(m.el, 'ad')).segments || []), 'Other']); }; segs(); m.el.querySelector('#ad').onchange = segs;
  m.el.querySelector('#asave').onclick = () => guard(async () => {
    const paid = Math.max(0, Math.round(num(m.el, 'ap'))); const free = Math.max(0, Math.round(num(m.el, 'af')));
    if (!paid && !free) throw new Error('Enter at least one admission.');
    const month = v(m.el, 'am') + '-01'; const note = (v(m.el, 'an') || '').trim() || 'Manual';
    await DB.insert('admissions', { month, dept: v(m.el, 'ad'), segment: v(m.el, 'asg'), paid, free, note });
    if (v(m.el, 'asrc') && paid) await DB.insert('admission_sources', { month, source: v(m.el, 'asrc'), admissions: paid, note });
    m.close(); after?.();
  }, 'Saved');
}
