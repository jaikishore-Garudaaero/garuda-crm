/* Garuda CRM · Overview: Command Centre, Sales Dashboard, Team Dashboard (each number has one home) */
'use strict';

const VIEWS = {};
const nfmt = (n) => Number(n || 0).toLocaleString('en-IN');
const pctTxt = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toFixed(1) + '%' : '—');
const monShort = (ym) => new Date(ym + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
const monthKey = (d) => String(d || '').slice(0, 7);
const leadDate = (l) => l.enquiry_date || l.created_at;
function tbl(head, rows, foot) {
  return `<div class="tablewrap"><table><thead><tr>${head.map((h, i) => `<th class="${i ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="faint">Nothing in this period.</td></tr>`}${foot || ''}</tbody></table></div>`;
}
/* a count that opens the records behind it */
const cnt = (n, key) => (n ? `<button class="lnk" data-dk="${esc(key)}">${nfmt(n)}</button>` : '0');
function bindDrills(root, map) {
  root.querySelectorAll('[data-dk]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const x = map.get(b.dataset.dk); if (x) drill(esc(x.title), leadRows(x.rows)); }));
}

/* ================= Command Centre: counts that need action, nothing else ================= */
function commandCounts() {
  const now = new Date(); const today = todayStr();
  const ls = M.leads().filter(L.open);
  const fch = Number(DB.settings.first_contact_hours) || 48; const stale = Number(DB.settings.stale_deal_days) || 7;
  const vis = DB.t.visits.filter((x) => M.personOk(x.owner) && M.visitDeptOk(x));
  const vOpen = vis.filter((x) => ['Planned', 'Rescheduled'].includes(x.status || 'Planned'));
  const esc0 = DB.t.complaints.filter((c) => ESC_OPEN.includes(c.status) && M.personOk(c.owner) && M.deptOk(c.dept || ''));
  const projs = DB.t.projects.filter((p) => M.deptOk(p.dept) && M.personOk(p.owner));
  const pIds = new Set(projs.map((p) => p.id));
  const ms = DB.t.project_items.filter((i) => pIds.has(i.project_id) && i.kind !== 'payment' && !['Done', 'Cancelled'].includes(i.status) && i.due_date && i.due_date < today);
  const ren = projs.filter((p) => p.renewal_date && p.renewal_date >= today && daysAgo(p.renewal_date) >= -30);
  return {
    overdue: ls.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < now && (!l.last_contact_at || new Date(l.last_contact_at) < new Date(l.next_followup_at))),
    nc: ls.filter((l) => !l.is_deal && !l.first_contact_at && !l.call_attempts && (now - new Date(l.created_at)) / 36e5 > fch),
    pastClose: ls.filter((l) => l.is_deal && l.expected_close && l.expected_close < today),
    stale: ls.filter((l) => l.is_deal && daysAgo(L.updated(l)) >= stale),
    vOver: vOpen.filter((x) => x.planned_at && new Date(x.planned_at) < now && localDate(x.planned_at) < today),
    vToday: vOpen.filter((x) => x.planned_at && localDate(x.planned_at) === today),
    escOpen: esc0, escLate: esc0.filter((c) => c.due_at && new Date(c.due_at) < now),
    claims: isFinance() ? DB.t.payments.filter((p) => p.status === 'Claimed') : null,
    ms, ren,
    tLate: DB.t.work_tasks.filter((t) => taskOpen(t) && t.due_date && t.due_date < today && M.personOk(t.owner)),
    waiting: isHead() ? DB.t.profiles.filter((p) => p.active && !p.auth_id) : null,
    fch, staleDays: stale,
  };
}
function aiFlags(c) {
  const f = []; const r = M.range('month'); const today = todayStr();
  const hot = M.leads().filter((l) => L.open(l) && (l.temperature === 'Hot' || l.ai_band === 'Hot') && l.next_followup_at && l.next_followup_at.slice(0, 10) <= today);
  if (hot.length) f.push([`${nfmt(hot.length)} hot ${hot.length === 1 ? 'record has' : 'records have'} a follow-up due today or earlier. Call these first.`, 'leads/hot']);
  const closing = M.leads().filter((l) => L.inPipe(l) && l.expected_close && M.inR(l.expected_close, { from: new Date(), to: new Date(Date.now() + 14 * 864e5) }));
  if (closing.length) f.push([`${nfmt(closing.length)} ${closing.length === 1 ? 'deal is' : 'deals are'} due to close in the next 14 days, worth ${inr(sum(closing, (l) => l.value))}.`, 'deals/closing']);
  if (c.stale.length) { const big = c.stale.slice().sort((a, b) => b.value - a.value)[0]; f.push([`${nfmt(c.stale.length)} open deals have had no update for ${c.staleDays} days or more${big && big.value ? `; the largest is ${esc(L.title(big))} at ${inr(big.value)}` : ''}.`, 'deals/stale']); }
  const noFee = M.leads().filter((l) => L.open(l) && !l.is_deal && l.last_contact_at && daysAgo(l.last_contact_at) <= 30 && !l.fee_disclosed && S.list(l.funnel, 'deal').some((s) => s.needs_fee));
  if (noFee.length) f.push([`${nfmt(noFee.length)} ${noFee.length === 1 ? 'lead was' : 'leads were'} called in the last 30 days without a recorded fee, so ${noFee.length === 1 ? 'it cannot' : 'they cannot'} move to a deal stage yet.`, 'leads/nofee']);
  if (c.escLate.length) f.push([`${nfmt(c.escLate.length)} ${c.escLate.length === 1 ? 'escalation is' : 'escalations are'} past the response deadline.`, 'escalations/late']);
  const wonNoProj = M.leads().filter((l) => L.won(l) && M.inR(l.won_at, r) && !DB.t.projects.some((p) => p.lead_id === l.id));
  if (wonNoProj.length) f.push([`${nfmt(wonNoProj.length)} ${wonNoProj.length === 1 ? 'deal' : 'deals'} won this month ${wonNoProj.length === 1 ? 'has' : 'have'} no project yet.`, 'projects']);
  const ins = DB.t.ai_insights?.[0]?.digest;
  (ins?.risks || []).slice(0, 2).forEach((x) => f.push([esc(x), 'command']));
  return f.slice(0, 7);
}
/* the counts that need someone to act, shared by the Sales Dashboard and My dashboard */
function needsAction(c) {
  return [
    ['Follow-ups overdue', c.overdue.length, 'leads/overdue', 'bad', 'clock'],
    [`Not contacted in ${c.fch} h`, c.nc.length, 'leads/nc', 'warn', 'phone'],
    ['Deals past closure date', c.pastClose.length, 'deals/pastclose', 'bad', 'cal'],
    [`Deals quiet ${c.staleDays}+ days`, c.stale.length, 'deals/stale', 'warn', 'board'],
    ['Visits overdue', c.vOver.length, 'visits/overdue', 'bad', 'pin'],
    ['Visits today', c.vToday.length, 'visits/today', 'info', 'pin'],
    ['Tasks overdue', c.tLate.length, 'tasks/overdue', 'bad', 'task'],
    [`Escalations open${c.escLate.length ? ` · ${c.escLate.length} late` : ''}`, c.escOpen.length, 'escalations/open', c.escLate.length ? 'bad' : 'warn', 'warn'],
    ...(c.claims ? [['Payments to verify', c.claims.length, 'revenue/ledger', 'warn', 'rev']] : []),
    ['Milestones overdue', c.ms.length, 'projects/overdue', 'warn', 'proj'],
    ['Renewals in 30 days', c.ren.length, 'projects/renewals', 'info', 'proj'],
    ...(c.waiting ? [['Users not signed in', c.waiting.length, 'settings/users', 'info', 'team']] : []),
  ];
}
const actionList = (c) => `<ul class="alist">${needsAction(c).map(([t, n, to, tone, ic]) => `<li><button data-go="${to}" class="${n ? '' : 'zero'}"><span class="ai ${n ? tone : 'mute'}">${svg(ic)}</span><span class="t">${t}</span><b class="chip tone ${n ? tone : 'mute'}">${nfmt(n)}</b></button></li>`).join('')}</ul>`;
const bindGo = (el) => el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const [v0, a] = b.dataset.go.split('/'); go(v0, a); }));

/* ================= Command Centre: the CEO view in pictures; every card follows the period and team in the filter ================= */
VIEWS.command = {
  title: 'Command Centre', sub: 'Target, revenue, spend, pipeline, teams and delivery at a glance.',
  render(el) {
    const r = curRange(); const P = TG.cur(); const u = { dept: ST.dept };
    const codes = ST.dept === 'All' ? DEPTS().map((d) => d.code) : [ST.dept];
    const tP = TG.inRange(u, P), aP = TG.achieved(u, P);
    const col = sum(DB.t.revenue_entries.filter((e) => codes.includes(e.department) && e.status === 'Collected' && M.inR(e.month, r)), (e) => e.amount);
    const cs = DB.t.mkt_campaigns.filter((x) => M.deptOk(x.dept || '')); const st = cs.map((x) => ({ x, s: campStats(x, r) }));
    const spend = sum(st, (y) => y.s.spend), cLeads = sum(st, (y) => y.s.leads), cRev = sum(st, (y) => y.s.revenue);
    const byKind = {}; st.forEach((y) => { const k = y.x.platform || y.x.type || (y.x.kind === 'ad' ? 'Ads' : 'Other'); byKind[k] = (byKind[k] || 0) + y.s.spend; });
    const ls = M.leads(); const open = ls.filter(L.inPipe); const wtd = (a) => sum(a, (l) => (l.value * L.prob(l)) / 100);
    const pEnd = localDate(new Date(P.to.getTime() - 864e5)); const nx = new Date(P.to.getTime() + (P.to - P.from)); const nEnd = localDate(new Date(nx.getTime() - 864e5));
    const fc = [['In period', open.filter((l) => l.expected_close && l.expected_close <= pEnd)], ['Next period', open.filter((l) => l.expected_close > pEnd && l.expected_close <= nEnd)], ['Later', open.filter((l) => l.expected_close > nEnd)], ['No date', open.filter((l) => !l.expected_close)]];
    const inP = ls.filter((l) => M.inR(l.enquiry_date || l.created_at, r)); const dl = ls.filter((l) => l.is_deal && M.inR(L.dealAt(l), r)); const won = ls.filter((l) => L.won(l) && M.inR(l.won_at, r)); const lost = ls.filter((l) => L.lost(l) && l.is_deal && M.inR(L.stageAt(l), r));
    const months = M.months(r); const mr = (ym) => { const [y, m] = ym.split('-').map(Number); return { key: 'month', from: new Date(y, m - 1, 1), to: new Date(y, m, 1) }; };
    const projs = DB.t.projects.filter((p) => M.deptOk(p.dept)); const pIds = new Set(projs.map((p) => p.id));
    const msDue = DB.t.project_items.filter((i) => pIds.has(i.project_id) && i.kind !== 'payment' && i.due_date && M.inR(i.due_date, r)); const msDone = msDue.filter((i) => i.status === 'Done');
    const escR = DB.t.complaints.filter((c) => M.deptOk(c.dept || '') && M.inR(c.created_at, r)); const escOk = escR.filter((c) => !c.due_at || (c.closed_at ? new Date(c.closed_at) <= new Date(c.due_at) : new Date(c.due_at) > new Date()));
    const tk = DB.t.work_tasks.filter((t) => t.due_date && M.inR(t.due_date, r) && (!t.lead_id || M.deptOk(DB.get('leads', t.lead_id)?.funnel))); const tkDone = tk.filter((t) => t.status === 'Done');
    const vis = DB.t.visits.filter((x) => x.planned_at && M.inR(x.planned_at, r) && M.visitDeptOk(x)); const visDone = vis.filter((x) => x.status === 'Done');
    const teams = codes.map((code) => { const du = { dept: code }; const t = TG.inRange(du, P), a = TG.achieved(du, P); return { code, t, a, p: t ? Math.round((a / t) * 100) : null }; });
    const tmax = Math.max(1, ...teams.map((x) => Math.max(x.t, x.a)));
    const fun = [['Leads', inP.length], ['Deals', dl.length], ['Won', won.length]]; const fmax = Math.max(1, ...fun.map((x) => x[1]));
    el.innerHTML = `${welcomeHTML()}${filterBar({ person: false })}
      <div class="bento ceo">
        <section class="glass bc b-tgt"><div class="bc-h"><span class="gtag green">${svg('target')} Target</span><span class="faint">${esc(P.label)}</span></div>${milestoneTrack(u, P)}</section>
        <section class="glass bc b-rings"><div class="rings">
          ${ring(aP ? pct(col, aP) : 0, inrShort(col), 'Collected', '#2cc3b5')}
          ${ring(spend ? Math.min(100, pct(cRev, spend * 5)) : 0, spend ? Math.round(((cRev - spend) / spend) * 100) + '%' : '—', 'Ad ROI', '#7b6cf0')}
          ${ring(won.length + lost.length ? pct(won.length, won.length + lost.length) : 0, won.length + lost.length ? pct(won.length, won.length + lost.length) + '%' : '—', 'Win rate', '#2fb36a')}
          ${ring(tP ? Math.min(100, pct(wtd(open), Math.max(1, tP - aP))) : 0, inrShort(wtd(open)), 'Pipeline', '#1f6fd1')}</div></section>
        <section class="glass bc b-trend" data-go="revenue"><div class="bc-h"><span class="gtag blue">Revenue</span><span class="faint">booked · collected · target</span></div>
          ${barChart({ labels: months.map(monShort), series: [{ name: 'Booked', color: '#2676dc', values: months.map((m) => TG.achieved(u, mr(m))) }, { name: 'Collected', color: '#8d3f91', values: months.map((m) => sum(DB.t.revenue_entries.filter((e) => codes.includes(e.department) && e.status === 'Collected' && String(e.month).slice(0, 7) === m), (e) => e.amount)) }], target: months.some((m) => TG.inRange(u, mr(m))) ? months.map((m) => TG.inRange(u, mr(m))) : null, height: 240 })}</section>
        <section class="glass bc b-teams"><div class="bc-h"><span class="gtag violet">Teams</span><span class="faint">achieved vs target</span></div>
          <div class="tbars">${teams.map((x) => `<button class="tbar" data-go="revenue/${esc(x.code)}" style="--dc:${esc(deptColor(x.code))}"><span class="tl">${deptChip(x.code)}</span><span class="tt"><i class="tg" style="width:${(x.t / tmax) * 100}%"></i><i class="ta" style="width:${(x.a / tmax) * 100}%"></i></span><b class="${x.p == null ? '' : toneFor(x.p, TG.elapsed(P))}">${x.p == null ? inrShort(x.a) : x.p + '%'}</b><small class="tv">${inrShort(x.a)} / ${x.t ? inrShort(x.t) : '—'}</small></button>`).join('')}</div></section>
        <section class="glass bc b-spend" data-go="ads"><div class="bc-h"><span class="gtag teal">Spend</span><span class="faint">${spend ? inr(spend) : '—'}</span></div>
          ${spend ? donut(Object.entries(byKind).filter(([, x]) => x > 0).map(([label, value]) => ({ label, value })).sort((a, c) => c.value - a.value).slice(0, 6), cLeads ? inrShort(spend / cLeads) : '—', 'per lead') : `<div class="ghost-ic">${svg('ads')}<span>No spend</span></div>`}</section>
        <section class="glass bc b-fun"><div class="bc-h"><span class="gtag blue">Funnel</span><span class="faint">${esc(r.label)}</span></div>
          <div class="vfun">${fun.map(([k, n], i) => `<div class="vf" style="--w:${Math.max(18, (n / fmax) * 100)}%;--c:${['#2676dc', '#8d3f91', '#2fb36a'][i]}"><b>${nfmt(n)}</b><span>${k}</span></div>`).join('')}</div></section>
        <section class="glass bc b-fc" data-go="deals"><div class="bc-h"><span class="gtag violet">Forecast</span><span class="faint">weighted pipeline</span></div>
          ${hbars(fc.map(([label, a], i) => ({ label, sub: `${a.length} deals`, value: wtd(a), color: PAL[i] })), inrShort)}</section>
        <section class="glass bc b-del" data-go="projects"><div class="bc-h"><span class="gtag amber">Delivery</span><span class="faint">${esc(r.label)}</span></div>
          <div class="rings">${ring(msDue.length ? pct(msDone.length, msDue.length) : 0, msDue.length ? `${msDone.length}/${msDue.length}` : '—', 'Milestones', '#f0a31c')}${ring(escR.length ? pct(escOk.length, escR.length) : 0, escR.length ? `${escOk.length}/${escR.length}` : '—', 'Escalations in time', '#3a8ae0')}${ring(vis.length ? pct(visDone.length, vis.length) : 0, vis.length ? `${visDone.length}/${vis.length}` : '—', 'Visits done', '#2cc3b5')}${ring(tk.length ? pct(tkDone.length, tk.length) : 0, tk.length ? `${tkDone.length}/${tk.length}` : '—', 'Tasks done', '#7b6cf0')}</div></section>
      </div>`;
    bindFilters(el, () => this.render(el));
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = (e) => { if (b.classList.contains('bc') && e.target.closest('[data-go]') !== b) return; e.stopPropagation(); const [v0, a] = b.dataset.go.split('/'); go(v0, a); }));
    loadWeather(el.querySelector('#wx'));
  },
};
/* a half-ring gauge in glass colours */
function gauge(p, label, sub) {
  const pc = clamp(p || 0, 0, 100); const R = 70, L0 = Math.PI * R;
  return `<div class="gauge"><svg viewBox="0 0 180 104" aria-hidden="true"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#3a8ae0"/><stop offset=".55" stop-color="#7b6cf0"/><stop offset="1" stop-color="#2cc3b5"/></linearGradient></defs>
    <path d="M20 92 A70 70 0 0 1 160 92" fill="none" stroke="var(--hair)" stroke-width="14" stroke-linecap="round"/>
    <path d="M20 92 A70 70 0 0 1 160 92" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(L0 * pc) / 100} ${L0}"/></svg>
    <div class="gv"><b>${label}</b><span class="faint">${sub}</span></div></div>`;
}
function tasksCard() {
  const ts = scopedTasks(); const open = ts.filter(taskOpen); const late = open.filter((t) => taskTone(t) === 'bad'); const today = open.filter((t) => t.due_date === todayStr());
  const avg = open.length ? Math.round(sum(open, taskPct) / open.length) : 0;
  return `<section class="glass bc b-task" data-go="taskdash"><div class="bc-h"><span class="gtag amber">Tasks</span><span class="faint">open now</span></div>
    <div class="trio"><div><b>${nfmt(open.length)}</b><span>open</span></div><div class="${late.length ? 'bad' : ''}"><b>${nfmt(late.length)}</b><span>overdue</span></div><div class="${today.length ? 'warn' : ''}"><b>${nfmt(today.length)}</b><span>due today</span></div></div>
    <div class="tc-prog"><span class="pbar ${late.length ? 'warn' : 'good'}"><i style="width:${avg}%"></i></span><span class="faint">${avg}% done on average</span></div></section>`;
}
function activityCard() {
  const since = Date.now() - 3 * 864e5; const vis = new Set(visibleLeads().map((l) => l.id)); const ev = [];
  DB.t.remarks.filter((x) => vis.has(x.lead_id) && new Date(x.created_at) > since).forEach((x) => { const l = DB.get('leads', x.lead_id); ev.push({ at: x.created_at, by: x.author, tone: CONNECTED(x.outcome) ? 'info' : 'mute', html: `${esc(x.outcome)} on <a href="#" data-lead="${l.id}">${esc(l.name)}</a>${x.text ? `<span class="q">“${esc(x.text.slice(0, 90))}”</span>` : ''}` }); });
  visibleLeads().filter((l) => L.won(l) && l.won_at && new Date(l.won_at) > since).forEach((l) => ev.push({ at: l.won_at, by: l.owner, tone: 'good', html: `won <a href="#" data-lead="${l.id}">${esc(l.name)}</a> · ${inr(l.value)}` }));
  DB.t.visits.filter((x) => x.status === 'Done' && new Date(x.checkin_at || x.planned_at) > since).forEach((x) => ev.push({ at: x.checkin_at || x.planned_at, by: x.owner, tone: 'info', html: `visit done · ${esc(x.outcome || x.purpose)}` }));
  DB.t.work_subtasks.filter((x) => x.done && new Date(x.done_at) > since).forEach((x) => ev.push({ at: x.done_at, by: x.done_by, tone: 'good', html: `completed “${esc(x.title)}”` }));
  ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `<section class="glass bc b-feed"><div class="bc-h"><span class="gtag blue">Activity</span><span class="faint">last 3 days</span></div>
    ${ev.length ? `<ul class="feed">${ev.slice(0, 9).map((x) => `<li class="tone-${x.tone}"><span class="av sm">${esc(initials(DB.pname(x.by)))}</span><div><b>${esc(DB.pname(x.by))}</b> ${x.html}<span class="s">${rel(x.at)}</span></div></li>`).join('')}</ul>` : '<p class="faint">No activity in the last 3 days.</p>'}</section>`;
}

/* ---------- welcome: greeting, today's weather at the office, and what is new ---------- */
function welcomeHTML() {
  const now = new Date(); const h = now.getHours();
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = (DB.me.full_name || '').split(' ')[0];
  const today = todayStr(); const mine = (l) => l.owner === DB.me.id;
  const ls = visibleLeads();
  const dueToday = ls.filter((l) => mine(l) && L.open(l) && l.next_followup_at && localDate(l.next_followup_at) === today && new Date(l.next_followup_at) >= now);
  const fresh = ls.filter((l) => mine(l) && !l.imported && (now - new Date(l.created_at)) / 36e5 <= 24);
  const nextVisit = DB.t.visits.filter((x) => x.owner === DB.me.id && ['Planned', 'Rescheduled'].includes(x.status || 'Planned') && x.planned_at && new Date(x.planned_at) >= now).sort((a, b) => String(a.planned_at).localeCompare(String(b.planned_at)))[0];
  const wk = M.range('week'); const wonWk = ls.filter((l) => L.won(l) && M.inR(l.won_at, wk) && (seesAll() || scopeIds().has(l.owner)));
  const c = DB.settings.company || {};
  const ups = [];
  if (c.announcement) ups.push(['flag', esc(c.announcement), '']);
  if (dueToday.length) ups.push(['clock', `${nfmt(dueToday.length)} follow-up${dueToday.length === 1 ? '' : 's'} still to make today`, 'leads']);
  if (fresh.length) ups.push(['plus', `${nfmt(fresh.length)} new lead${fresh.length === 1 ? '' : 's'} given to you in the last 24 hours`, 'leads']);
  if (nextVisit) ups.push(['pin', `Next visit: ${esc(nextVisit.purpose)} · ${esc(typeof visitLink === 'function' ? visitLink(nextVisit).replace(/^(Lead|Deal|Account) · /, '') : '')} · ${fmtDT(nextVisit.planned_at)}`, 'visits/upcoming']);
  if (wonWk.length) ups.push(['up', `${nfmt(wonWk.length)} deal${wonWk.length === 1 ? '' : 's'} won this week${hasTeam() ? ' by your team' : ''}, ${inr(sum(wonWk, (l) => l.value))}`, 'sales']);
  if (!ups.length) ups.push(['spark', 'Nothing new since you last looked.', '']);
  return `<section class="glass welcome">
    <div class="wl-hi"><span class="faint">${hello} · ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>Hi, ${esc(first)}</h1><p class="muted">${esc(DB.me.designation || ROLES[DB.me.role] || '')}${c.name ? ' · ' + esc(c.name) : ''}</p></div>
    <div class="wx" id="wx" aria-live="polite"><span class="faint">Weather…</span></div>
    <div class="wl-up"><h4>Updates</h4><ul>${ups.map(([i, t, to]) => `<li>${to ? `<button class="flag" data-go="${esc(to)}">` : '<div class="flag">'}${svg(i)}<span class="t">${t}</span>${to ? '</button>' : '</div>'}</li>`).join('')}</ul></div>
  </section>`;
}
const WX = { 0: ['Clear sky', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Cloudy', '☁️'], 45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'], 95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'] };
/* weather for the office city (Settings → Company), from Open-Meteo, cached for 30 minutes */
async function loadWeather(box) {
  if (!box) return;
  const c = DB.settings.company || {}; const lat = Number(c.lat ?? 13.0827), lon = Number(c.lon ?? 80.2707); const city = c.city || 'Chennai';
  const key = `garuda-wx-${lat},${lon}`;
  const show = (w) => { const [t, ic] = WX[w.code] || ['', '🌡️']; box.innerHTML = `<span class="wx-ic" aria-hidden="true">${ic}</span><div><b class="wx-t">${Math.round(w.t)}°C</b><span class="faint">${esc(city)} · ${t}</span><span class="faint">H ${Math.round(w.hi)}° · L ${Math.round(w.lo)}° · wind ${Math.round(w.wind)} km/h</span></div>`; };
  try { const x = JSON.parse(sessionStorage.getItem(key) || 'null'); if (x && Date.now() - x.at < 18e5) return show(x); } catch (_) { /* no storage */ }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`);
    if (!r.ok) throw new Error('weather');
    const j = await r.json();
    const w = { at: Date.now(), t: j.current.temperature_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m, hi: j.daily.temperature_2m_max[0], lo: j.daily.temperature_2m_min[0] };
    try { sessionStorage.setItem(key, JSON.stringify(w)); } catch (_) { /* no storage */ }
    if (box.isConnected) show(w);
  } catch (_) { if (box.isConnected) box.innerHTML = `<span class="wx-ic" aria-hidden="true">🌡️</span><div><b class="wx-t">${esc(city)}</b><span class="faint">Weather is not available right now</span></div>`; }
}

/* ================= Sales Dashboard: flow and conversion, counts not people ================= */
VIEWS.sales = {
  title: 'Sales Dashboard', sub: 'Inflow, funnels, conversion and pipeline for the departments and period you choose. No per-person numbers here: see the Team Dashboard.',
  render(el) {
    const r = curRange(); const all = M.leads();
    const inR = all.filter((l) => M.inR(leadDate(l), r));
    const deptCodes = ST.dept === 'All' ? DEPTS().map((d) => d.code) : [ST.dept];
    const D = new Map(); const put = (k, title, rows) => { D.set(k, { title, rows }); return cnt(rows.length, k); };
    const openDeals = all.filter(L.inPipe);
    const won = all.filter((l) => L.won(l) && M.inR(l.won_at, r));
    const lost = all.filter((l) => L.lost(l) && M.inR(L.stageAt(l), r));
    const dealsNew = all.filter((l) => l.is_deal && M.inR(L.dealAt(l), r));
    const admDepts = new Set(DEPTS().filter((d) => d.has_admissions).map((d) => d.code));
    const adm = DB.t.admissions.filter((a) => M.inR(a.month, r) && (a.dept ? M.deptOk(a.dept) : admDepts.has(ST.dept) || ST.dept === 'All') && (ST.person === 'all' || (a.lead_id && DB.get('leads', a.lead_id)?.owner === ST.person)));
    const admN = sum(adm, (a) => Number(a.paid) + Number(a.free));
    /* inflow by month and source */
    const months = M.months(r);
    const inflow = all.filter((l) => months.includes(monthKey(leadDate(l))));
    const srcCount = groupBy(inflow, (l) => l.source || 'Unknown');
    const top = Object.entries(srcCount).sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([k]) => k);
    const pal = ['#004a8c', '#0a64b0', '#2f80c8', '#5a9cd6', '#86b8e2', '#acd0ee', '#cfe3f5'];
    const series = [...top, 'Other'].map((s, i) => ({ name: s, color: pal[i], values: months.map((m) => inflow.filter((l) => monthKey(leadDate(l)) === m && (s === 'Other' ? !top.includes(l.source || 'Unknown') : (l.source || 'Unknown') === s)).length) })).filter((s) => sum(s.values));
    /* funnel per department */
    const funnels = deptCodes.map((code) => {
      const rows = inR.filter((l) => l.funnel === code);
      const st = S.list(code).filter((s) => (!s.is_lost && !s.is_closed) || rows.some((l) => l.stage === s.key));
      const max = Math.max(1, ...st.map((s) => rows.filter((l) => l.stage === s.key).length));
      return `<section class="glass panel"><div class="panel-head"><h2>${deptChip(code)} ${esc(dept(code).name)} funnel</h2><span class="sub">${nfmt(rows.length)} records with a lead date in ${r.label.toLowerCase()}</span></div>
        <div class="funnel">${st.map((s) => { const n = rows.filter((l) => l.stage === s.key); return `<div class="frow ${s.is_won ? 'won' : s.is_lost ? 'lost' : ''}"><span>${esc(s.key)} <span class="faint">${s.kind === 'deal' ? 'deal' : s.kind === 'lead' ? 'lead' : ''}</span></span><span class="bar"><i style="width:${(n.length / max) * 100}%;"></i></span><span class="num">${put('f|' + code + '|' + s.key, `${code} · ${s.key} · ${r.label}`, n)}</span></div>`; }).join('')}</div></section>`;
    }).join('');
    /* lead → deal → won */
    const conv = deptCodes.map((code) => { const rows = inR.filter((l) => l.funnel === code); const d = rows.filter((l) => l.is_deal); const w = rows.filter(L.won); return `<tr><td>${deptChip(code)} ${esc(dept(code).name)}</td><td class="n">${put('c1|' + code, `${code} · leads · ${r.label}`, rows)}</td><td class="n">${put('c2|' + code, `${code} · became deals`, d)}</td><td class="n">${pctTxt(d.length, rows.length)}</td><td class="n">${put('c3|' + code, `${code} · won`, w)}</td><td class="n">${pctTxt(w.length, d.length)}</td><td class="n"><b>${pctTxt(w.length, rows.length)}</b></td></tr>`; });
    /* deals by closure month */
    const today = todayStr(); const cm = []; for (let i = 0; i < 6; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); cm.push(localDate(d).slice(0, 7)); }
    const byClose = [['Past date', openDeals.filter((l) => l.expected_close && l.expected_close < today.slice(0, 7) + '-01')], ...cm.map((m) => [monShort(m), openDeals.filter((l) => monthKey(l.expected_close) === m)]), ['Later', openDeals.filter((l) => l.expected_close && monthKey(l.expected_close) > cm[5])], ['No date', openDeals.filter((l) => !l.expected_close)]];
    /* stuck: time in the current stage */
    const stuckDays = Math.max(14, 2 * (Number(DB.settings.stale_deal_days) || 7));
    const stuckRows = deptCodes.flatMap((code) => S.open(code, 'deal').map((s) => { const a = openDeals.filter((l) => l.funnel === code && l.stage === s.key); const st = a.filter((l) => daysAgo(L.stageAt(l)) >= stuckDays); return { code, s, a, st, avg: a.length ? Math.round(sum(a, (l) => daysAgo(L.stageAt(l))) / a.length) : 0 }; })).filter((x) => x.a.length);
    /* loss reasons */
    const reasons = Object.entries(groupBy(lost, (l) => l.lost_reason || 'Not given')).sort((a, b) => b[1].length - a[1].length);
    /* product interest */
    const interest = Object.entries(groupBy(inR, (l) => L.product(l)?.name || (l.course && l.course !== 'Not Specified' ? l.course : '') || (l.sub_category && l.sub_category !== 'Not Specified' ? l.sub_category : '') || 'Not specified')).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
    const weighted = sum(openDeals, (l) => (l.value * L.prob(l)) / 100);
    el.innerHTML = `${filterBar()}
      <section class="glass panel needs"><div class="panel-head"><h2><span class="gtag red">Needs action</span> Right now</h2><span class="sub">Open records in this filter · click a line to open the list</span></div>${actionList(commandCounts())}</section>
      <div class="kpis">
        ${kpi({ label: 'New leads', value: put('k1', `New leads · ${r.label}`, inR), sub: r.label })}
        ${kpi({ label: 'New deals', value: put('k2', `Converted to deals · ${r.label}`, dealsNew), sub: 'Converted in the period' })}
        ${kpi({ label: 'Won', value: put('k3', `Won · ${r.label}`, won), sub: 'Conversions in the period' })}
        ${kpi({ label: 'Lost', value: put('k4', `Lost · ${r.label}`, lost), sub: 'Closed lost in the period' })}
        ${kpi({ label: 'Open pipeline', value: inr(sum(openDeals, (l) => l.value)), sub: `${put('k5', 'Open deals', openDeals)} open deals` })}
        ${kpi({ label: 'Weighted pipeline', value: inr(weighted), sub: 'Value × stage win %' })}
        ${[...admDepts].some((c) => M.deptOk(c)) ? kpi({ label: 'Admissions', value: nfmt(admN), sub: `${nfmt(sum(adm, (a) => a.paid))} paid · ${nfmt(sum(adm, (a) => a.free))} free · ${[...admDepts].join(', ')}` }) : ''}
      </div>
      <section class="glass panel"><div class="panel-head"><h2>Inflow by month and source</h2><span class="sub">Leads by lead date</span></div>${series.length ? barChart({ labels: months.map(monShort), series, stacked: true, fmt: (x) => nfmt(Math.round(x)) }) : empty('No leads', 'Nothing came in for these months.')}</section>
      <div class="grid g2">${funnels}</div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2>Stage conversion</h2><span class="sub">Of the leads dated in ${r.label.toLowerCase()}</span></div>${tbl(['Department', 'Leads', 'Deals', 'Lead → deal', 'Won', 'Deal → won', 'Lead → won'], conv)}</section>
        <section class="glass panel"><div class="panel-head"><h2>Deals by closure month</h2><span class="sub">Open deals by expected closure date</span></div>${tbl(['Closure month', 'Deals', 'Value', 'Weighted'], byClose.map(([k, a], i) => `<tr><td>${k}</td><td class="n">${put('cm' + i, `Deals closing · ${k}`, a)}</td><td class="n">${inr(sum(a, (l) => l.value))}</td><td class="n">${inr(sum(a, (l) => (l.value * L.prob(l)) / 100))}</td></tr>`))}</section>
      </div>
      <div class="grid g3">
        <section class="glass panel"><div class="panel-head"><h2>Won and lost</h2><span class="sub">${r.label}</span></div>
          <div class="wl"><div><b>${put('w1', 'Won', won)}</b><span>won</span></div><div><b>${put('w2', 'Lost', lost)}</b><span>lost</span></div><div><b>${pctTxt(won.length, won.length + lost.length)}</b><span>win rate</span></div></div>
          <h4 style="margin:12px 0 4px">Loss reasons</h4>${reasons.length ? `<div class="list">${reasons.map(([k, a], i) => `<div class="item"><span class="grow">${esc(k)}</span>${put('lr' + i, 'Lost · ' + k, a)}</div>`).join('')}</div>` : '<p class="faint">No losses in this period.</p>'}</section>
        <section class="glass panel"><div class="panel-head"><h2>Stuck deals</h2><span class="sub">In the same stage ${stuckDays}+ days</span></div>${tbl(['Stage', 'Open', 'Stuck', 'Avg days'], stuckRows.map((x, i) => `<tr><td>${deptChip(x.code)} ${esc(x.s.key)}</td><td class="n">${x.a.length}</td><td class="n">${put('st' + i, `Stuck in ${x.s.key}`, x.st)}</td><td class="n">${x.avg}</td></tr>`))}</section>
        <section class="glass panel"><div class="panel-head"><h2>Product interest</h2><span class="sub">Leads dated in ${r.label.toLowerCase()}</span></div>${interest.length ? `<div class="list">${interest.map(([k, a], i) => `<div class="item"><span class="grow">${esc(k)}</span>${put('pi' + i, 'Interested in ' + k, a)}</div>`).join('')}</div>` : '<p class="faint">No leads in this period.</p>'}</section>
      </div>`;
    bindFilters(el, () => this.render(el)); bindDrills(el, D); bindGo(el.querySelector('.needs'));
  },
};

/* ================= Team Dashboard (or My dashboard for people with nobody below) ================= */
VIEWS.team = {
  title: 'Team Dashboard',
  sub: 'Team KRA, activity, discipline, conversions and targets per person, the leaderboard, and who owns what.',
  render(el) {
    const r = curRange();
    if (!hasTeam()) return go('mydash');
    const people = M.people();
    const rows = people.map((p) => ({ p, s: M.person(p.id, r) }));
    const D = new Map(); const put = (k, title, a) => { D.set(k, { title, rows: a }); return cnt(a.length, k); };
    const fmtH = (h) => (h == null ? '—' : h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(1) + ' h' : Math.round(h / 24) + ' d');
    const board = rows.filter((x) => x.s.kra).slice().sort((a, b) => b.s.kra.score - a.s.kra.score || b.s.conversions - a.s.conversions);
    const fy = TG.fy(); const mR = TG.cur();
    el.innerHTML = `${filterBar()}
      <section class="glass panel tkra"><div class="panel-head"><h2><span class="gtag violet">Team KRA</span> Scores and what drives them</h2><span class="sub">${r.label} · weights in Settings → Targets & KRA · click a name for the breakdown</span></div>
        ${board.length ? `<div class="kragrid">${board.map((x, i) => `<button class="krac" data-kra="${x.p.id}"><span class="rank r${i + 1}">${i + 1}</span><span class="av">${esc(initials(x.p.full_name))}</span><span class="grow"><b>${esc(x.p.full_name)}</b><span class="kbars">${x.s.kra.rows.map((k) => `<span class="kb" title="${esc(k.label)}: ${Math.round(k.points)} of ${k.weight}"><i style="width:${k.weight ? (k.points / k.weight) * 100 : 0}%"></i></span>`).join('')}</span><span class="s">${x.s.kra.rows.map((k) => esc(k.label.split(' ')[0])).join(' · ')}</span></span><b class="sc ${x.s.kra.score >= 70 ? 'good' : x.s.kra.score >= 40 ? 'warn' : 'bad'}">${x.s.kra.score}</b></button>`).join('')}</div>` : '<p class="faint">No KRA weights set. Set them in Settings → Targets & KRA.</p>'}</section>
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag green">${svg('target')} Targets</span> ${esc(mR.label)} by person</h2><a class="sub" href="#revenue/targets">Full breakup →</a></div>
        ${tbl(['Person', 'Target · ' + mR.label, 'Booked', 'Progress', 'Year target', 'Booked this FY'], people.map((p) => { const u = { dept: ST.dept, pid: p.id }; const tm = TG.inRange(u, mR), am = TG.achieved(u, mR), ty = TG.target(u, 'fy'), ay = TG.achieved(u, TG.per('fy', fy)); const pc = tm ? Math.round((am / tm) * 100) : null; return `<tr><td>${esc(p.full_name)}</td><td class="n">${tm ? inr(tm) : '—'}</td><td class="n">${inr(am)}</td><td class="n">${pc == null ? '<span class="faint">no target</span>' : `<span class="pbar ${toneFor(pc, TG.elapsed(mR))}" style="width:90px;display:inline-block;vertical-align:middle"><i style="width:${clamp(pc, 0, 100)}%"></i></span> ${pc}%`}</td><td class="n">${ty ? inr(ty) : '—'}</td><td class="n">${inr(ay)}</td></tr>`; }))}</section>
      <section class="glass panel"><div class="panel-head"><h2>Per person</h2><span class="sub">${r.label} · click a name for the KRA breakdown</span></div>
        <div class="tablewrap"><table class="sticky1"><thead><tr><th>Person</th><th class="n">Calls</th><th class="n">Connects</th><th class="n">Follow-ups on time</th><th class="n">First response</th><th class="n">Leads owned</th><th class="n">Deals owned</th><th class="n">Conversions</th><th class="n">Visits done</th><th class="n">KRA</th></tr></thead><tbody>
        ${rows.map(({ p, s }) => `<tr><td><button class="lnk" data-kra="${p.id}">${esc(p.full_name)}</button><div class="s">${esc(p.designation || ROLES[p.role])}</div></td><td class="n">${nfmt(s.calls)}</td><td class="n">${nfmt(s.connects)} <span class="faint">${s.calls ? s.connectRate + '%' : ''}</span></td><td class="n">${s.followPct == null ? '—' : `<span class="chip ${s.followPct >= 90 ? 'good' : s.followPct >= 70 ? 'warn' : 'bad'}">${s.followPct}%</span>`} ${s.followDue ? `<span class="faint">of ${s.followDue}</span>` : ''}</td><td class="n">${fmtH(s.frt)}</td><td class="n">${put('l|' + p.id, `${p.full_name} · open leads`, s.rows.leads)}</td><td class="n">${put('d|' + p.id, `${p.full_name} · open deals`, s.rows.deals)}</td><td class="n">${put('w|' + p.id, `${p.full_name} · won · ${r.label}`, s.rows.won)}</td><td class="n">${nfmt(s.visits)}</td><td class="n">${s.kra ? `<b>${s.kra.score}</b>` : '—'}</td></tr>`).join('') || `<tr><td colspan="10">${empty('Nobody here', 'No sales staff in this view.')}</td></tr>`}
        </tbody></table></div></section>
      <div class="grid g12">
        <section class="glass panel"><div class="panel-head"><h2>Leaderboard</h2><span class="sub">By KRA score, ${r.label.toLowerCase()}</span></div>
          <ol class="lboard">${board.map((x, i) => `<li><span class="rank r${i + 1}">${i + 1}</span><span class="grow"><b>${esc(x.p.full_name)}</b><span class="s">${nfmt(x.s.conversions)} won · ${nfmt(x.s.calls)} calls${x.s.kra.team ? ' · team KRA' : ''}</span></span><span class="sc">${x.s.kra.score}</span></li>`).join('') || '<p class="faint">No scores yet.</p>'}</ol></section>
        <section class="glass panel" id="wow">${this.owns()}</section>
      </div>`;
    bindFilters(el, () => this.render(el)); bindDrills(el, D);
    el.querySelectorAll('[data-kra]').forEach((b) => (b.onclick = () => kraModal(b.dataset.kra, r)));
    this.bindOwns(el.querySelector('#wow'), () => this.render(el));
  },
  /* Who owns what: open leads and deals per person per department, with bulk reassign inside my scope */
  owns() {
    const ls = visibleLeads().filter((l) => L.open(l) && M.deptOk(l.funnel));
    const people = scopePeople().filter((p) => (inDept(p, ST.dept) && (ls.some((l) => l.owner === p.id) || isSales(p))) || ls.some((l) => l.owner === p.id));
    const codes = ST.dept === 'All' ? DEPTS().map((d) => d.code) : [ST.dept];
    this._o = new Map();
    const c = (pid, code, deal) => { const a = ls.filter((l) => l.owner === pid && (!code || l.funnel === code) && !!l.is_deal === deal); const k = `${pid}|${code}|${deal}`; this._o.set(k, a); return a.length ? `<button class="lnk" data-ok="${k}">${nfmt(a.length)}</button>` : '<span class="faint">0</span>'; };
    return `<div class="panel-head"><h2>Who owns what</h2><span class="sub">Open records now · tick people to move their records</span></div>
      <div class="tablewrap"><table><thead><tr><th></th><th>Person</th>${codes.map((k) => `<th class="n">${esc(k)} leads</th><th class="n">${esc(k)} deals</th>`).join('')}</tr></thead><tbody>
      ${people.map((p) => `<tr><td><input type="checkbox" class="ochk" value="${p.id}" aria-label="Select ${esc(p.full_name)}" ${canReassign() ? '' : 'disabled'}></td><td>${esc(p.full_name)}${p.active ? '' : ' <span class="chip">inactive</span>'}${inDept(p, ST.dept) ? '' : ` <span class="chip warn" title="Still owns open records here">not in ${esc(ST.dept)} any more</span>`}</td>${codes.map((k) => `<td class="n">${c(p.id, k, false)}</td><td class="n">${c(p.id, k, true)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${canReassign() ? `<div class="row reassign"><span class="faint">Move the open</span><select id="owhat"><option value="both">leads and deals</option><option value="lead">leads</option><option value="deal">deals</option></select><span class="faint">of the ticked people${ST.dept === 'All' ? '' : ' in ' + esc(ST.dept)} to</span><select id="oto">${opts(assignablePeople().map((p) => [p.id, p.full_name]), '', 'Choose…')}</select><button class="btn primary small" id="ogo">Reassign</button></div>` : '<p class="faint" style="font-size:12px">Only managers can reassign records.</p>'}`;
  },
  bindOwns(box, rer) {
    box.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => { const a = this._o.get(b.dataset.ok) || []; const [pid, code, deal] = b.dataset.ok.split('|'); drill(`${esc(DB.pname(pid))} · ${esc(code)} · open ${deal === 'true' ? 'deals' : 'leads'}`, leadRows(a)); }));
    box.querySelector('#ogo')?.addEventListener('click', () => guard(async () => {
      const from = $$('.ochk:checked', box).map((x) => x.value); const to = v(box, 'oto'); const what = v(box, 'owhat');
      if (!from.length) throw new Error('Tick the people whose records should move.');
      if (!to) throw new Error('Choose who takes them over.');
      const ids = visibleLeads().filter((l) => from.includes(l.owner) && l.owner !== to && L.open(l) && M.deptOk(l.funnel) && (what === 'both' || (what === 'deal') === !!l.is_deal)).map((l) => l.id);
      if (!ids.length) throw new Error('Nothing to move.');
      if (!(await confirmBox(`Move ${nfmt(ids.length)} open record${ids.length === 1 ? '' : 's'} to ${esc(DB.pname(to))}?`, 'Reassign'))) return;
      const n = await DB.bulkUpdate('leads', ids, { owner: to }); toast(`${nfmt(n)} records moved to ${DB.pname(to)}`); rer();
    }));
  },
  mine(el, r) {
    const s = M.person(DB.me.id, r);
    const D = new Map(); const put = (k, title, a) => { D.set(k, { title, rows: a }); return cnt(a.length, k); };
    el.innerHTML = `${filterBar({ person: false })}
      <div class="kpis">
        ${kpi({ label: 'Calls', value: nfmt(s.calls), sub: `${nfmt(s.connects)} connected · ${s.connectRate}%` })}
        ${kpi({ label: 'Follow-ups on time', value: s.followPct == null ? '—' : s.followPct + '%', sub: s.followDue ? `${s.followDue} fell due · ${put('late', 'Follow-ups done late or missed', s.rows.late)} late` : 'None fell due' })}
        ${kpi({ label: 'First response', value: s.frt == null ? '—' : s.frt < 1 ? Math.round(s.frt * 60) + ' min' : s.frt.toFixed(1) + ' h', sub: 'Median, new leads' })}
        ${kpi({ label: 'Leads I own', value: put('l', 'My open leads', s.rows.leads), sub: 'Open' })}
        ${kpi({ label: 'Deals I own', value: put('d', 'My open deals', s.rows.deals), sub: 'Open' })}
        ${kpi({ label: 'Conversions', value: put('w', `Won · ${r.label}`, s.rows.won), sub: r.label })}
        ${kpi({ label: 'Visits done', value: nfmt(s.visits), sub: r.label })}
        ${kpi({ label: 'KRA score', value: s.kra ? s.kra.score : '—', sub: 'out of 100', meter: s.kra?.score })}
      </div>
      ${s.kra ? `<section class="glass panel"><div class="panel-head"><h2>My KRA</h2><span class="sub">${r.label}</span></div>${kraTable(s.kra)}</section>` : ''}`;
    bindFilters(el, () => this.render(el)); bindDrills(el, D);
  },
};
function kraTable(k) {
  return `<div class="tablewrap"><table><thead><tr><th>KRA</th><th class="n">Weight</th><th class="n">Actual</th><th class="n">Target</th><th class="n">Points</th></tr></thead><tbody>${k.rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${x.weight}%</td><td class="n">${x.key.includes('revenue') || x.key.includes('pipeline') ? inr(x.value) : nfmt(Math.round(x.value)) + (x.isPct ? '%' : '')}</td><td class="n">${x.key.includes('revenue') || x.key.includes('pipeline') ? inr(x.target) : nfmt(x.target) + (x.isPct ? '%' : '')}</td><td class="n"><b>${x.points.toFixed(1)}</b></td></tr>`).join('')}<tr class="tot"><td colspan="4">Score</td><td class="n">${k.score}</td></tr></tbody></table></div>`;
}
function kraModal(pid, r) {
  const s = M.person(pid, r); const p = DB.profile(pid);
  openModal({ title: `${esc(p.full_name)} · KRA · ${r.label}`, width: 720, body: s.kra ? `${s.kra.team ? '<p class="faint" style="margin-top:0">Scored on the results of everyone below them.</p>' : ''}${kraTable(s.kra)}` : '<p class="faint">No KRA weights set. Set them in Settings → Targets & KRA.</p>' });
}
