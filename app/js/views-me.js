/* Garuda CRM · v4.2: sales targets (team → segment → executive; yearly, monthly, weekly), the daily target plan,
   My dashboard, revenue pictures, lead transfer between teams, and reminders for anything missed */
'use strict';

/* ================= targets ================= */
const COURSE_SEG = { 'Small Class RPC': 'Small', 'Medium Class RPC': 'Medium', 'Small + Medium RPC': 'Medium', 'Top-up Medium': 'Top-Up Medium', 'Train the Trainer (TTT)': 'TTT (Small)' };
/* the revenue segment a lead books into (the same rule the database uses for the ledger) */
function leadSeg(l) {
  if (dept(l.funnel).has_admissions) return COURSE_SEG[l.course] || 'Other';
  const c = l.sub_category || l.course || '';
  if (c === 'UAV Lab - Type TBC') return 'UAV Lab (type not stated)';
  if (c === 'RPTO Admissions (Bulk)') return 'RPTO Products';
  if (!c || c === 'Not Specified') return 'Not stated';
  return c;
}
const TG = {
  fy() { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; },
  label: (fy) => `FY ${fy}-${String(fy + 1).slice(2)}`,
  /* whole periods (not "so far"): the target covers the full week, month or year */
  per(key, fy = TG.fy()) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (key === 'today') return { key, from: d, to: new Date(d.getTime() + 864e5), label: 'Today' };
    if (key === 'week') { const s0 = new Date(d); s0.setDate(s0.getDate() - ((s0.getDay() + 6) % 7)); return { key, from: s0, to: new Date(s0.getTime() + 7 * 864e5), label: 'This week' }; }
    if (key === 'month') return { key, from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 1), label: d.toLocaleDateString('en-IN', { month: 'long' }) };
    if (key === 'quarter') { const q = Math.floor(d.getMonth() / 3) * 3; return { key, from: new Date(d.getFullYear(), q, 1), to: new Date(d.getFullYear(), q + 3, 1), label: 'This quarter' }; }
    if (key === 'custom') { const r = curRange(); return { key, from: r.from, to: r.to, label: r.label }; }
    return { key: 'fy', from: new Date(fy, 3, 1), to: new Date(fy + 1, 3, 1), label: TG.label(fy) };
  },
  /* the period the filter bar points at, whole (the target covers all of it) */
  cur: () => TG.per(ST.period),
  rows: (fy) => (DB.t.sales_targets || []).filter((t) => Number(t.fy) === fy),
  row: (fy, d, seg = '', pid = null) => (DB.t.sales_targets || []).find((t) => Number(t.fy) === fy && t.dept === d && (t.segment || '') === seg && (t.person || null) === pid) || null,
  /* monthly revenue targets (Settings → Statuses & lists) phase the year; without them every month is 1/12 */
  phase(fy, d, ym) {
    const r = TG.per('fy', fy); const ms = (DB.t.revenue_targets || []).filter((t) => t.dept === d && M.inR(t.month, r));
    const tot = sum(ms, (t) => t.amount); if (!tot) return 1 / 12;
    return sum(ms.filter((t) => String(t.month).slice(0, 7) === ym), (t) => t.amount) / tot;
  },
  /* the yearly figure: a team row, a segment row or a person's share; the team falls back to the monthly targets */
  yearly(fy, d, seg = '', pid = null) {
    const r = TG.row(fy, d, seg, pid); if (r) return Number(r.amount) || 0;
    if (pid || seg) return 0;
    return sum((DB.t.revenue_targets || []).filter((t) => t.dept === d && M.inR(t.month, TG.per('fy', fy))), (t) => t.amount);
  },
  depts: (u) => (u.dept && u.dept !== 'All' ? [u.dept] : DEPTS().map((x) => x.code)),
  /* the target for any stretch of time: each month's phased share, in proportion to the days covered */
  inRange(u, r) {
    let t = 0;
    for (const d of TG.depts(u)) {
      for (let m = new Date(r.from.getFullYear(), r.from.getMonth(), 1); m < r.to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
        const fy = m.getMonth() >= 3 ? m.getFullYear() : m.getFullYear() - 1; const y = TG.yearly(fy, d, u.seg || '', u.pid || null); if (!y) continue;
        const me = new Date(m.getFullYear(), m.getMonth() + 1, 1); const ov = (Math.min(r.to, me) - Math.max(r.from, m)) / (me - m);
        if (ov > 0) t += y * TG.phase(fy, d, localDate(m).slice(0, 7)) * ov;
      }
    }
    return t;
  },
  target(u, key, fy = TG.fy()) { return key === 'fy' ? sum(TG.depts(u), (d) => TG.yearly(fy, d, u.seg || '', u.pid || null)) : TG.inRange(u, TG.per(key, fy)); },
  /* Academy collections carry no caller name; the targets workbook says how they split between callers */
  share(pid, fy) { const sp = DB.settings.academy_split; if (!pid || !sp || (fy != null && Number(sp.fy) !== fy)) return 0; return sum((sp.shares || []).filter((x) => x.pid === pid), (x) => Number(x.share) || 0); },
  /* does a ledger line fall in the range? CRM payments have a day; sheet lines are monthly, so they count for a month or longer */
  lineIn(e, r) { if (e.paid_on) return M.inR(e.paid_on, r); return !['today', 'week'].includes(r.key) && M.inR(e.month, r); },
  /* how much of a ledger line belongs to a person: their own line, or their share of the Academy collections */
  weight(e, pid) { if (!pid) return 1; if (e.owner) return e.owner === pid ? 1 : 0; if (/split/i.test(e.owner_label || '')) { const m = new Date(String(e.month).slice(0, 10) + 'T12:00:00'); return TG.share(pid, m.getMonth() >= 3 ? m.getFullYear() : m.getFullYear() - 1); } return 0; },
  lines(u, r, status) {
    const ds = new Set(TG.depts(u));
    return DB.t.revenue_entries.filter((e) => ds.has(e.department) && (!status || e.status === status) && (!u.seg || e.segment === u.seg) && TG.lineIn(e, r)).map((e) => ({ e, w: TG.weight(e, u.pid) })).filter((x) => x.w > 0);
  },
  /* deals won in the CRM whose value is not in the ledger yet (imported deals are already there as sheet lines) */
  wonExtra(u, r) {
    const ds = new Set(TG.depts(u)); const led = {}; DB.t.revenue_entries.forEach((e) => { if (e.lead_id) led[e.lead_id] = (led[e.lead_id] || 0) + Number(e.amount || 0); });
    return visibleLeads().filter((l) => !l.imported && ds.has(l.funnel) && L.won(l) && M.inR(l.won_at, r) && (!u.pid || l.owner === u.pid) && (!u.seg || leadSeg(l) === u.seg))
      .map((l) => ({ l, v: Math.max(0, Number(l.value || 0) - (led[l.id] || 0)) })).filter((x) => x.v > 0);
  },
  /* achieved = booked: collected + balance due in the ledger, plus CRM-won deals not in the ledger yet (the target sheet's rule) */
  achieved(u, r) { return sum(TG.lines(u, r), (x) => x.w * Number(x.e.amount || 0)) + sum(TG.wonExtra(u, r), (x) => x.v); },
  collected(u, r) { return sum(TG.lines(u, r, 'Collected'), (x) => x.w * Number(x.e.amount || 0)); },
  due(u, r) { return sum(TG.lines(u, r, 'Pending PO'), (x) => x.w * Number(x.e.amount || 0)); },
  /* has anyone set a target this unit can be measured against? */
  has(u, fy = TG.fy()) { return TG.target(u, 'fy', fy) > 0; },
  workDaysLeft(r) { let n = 0; const d = new Date(); d.setHours(0, 0, 0, 0); for (; d < r.to; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++; return Math.max(n, 1); },
  elapsed(r) { return clamp((Date.now() - r.from) / (r.to - r.from), 0, 1); },

  /* how to close the gap: deals to close, the run rate, and the easiest open deals that cover it */
  plan(u, key = 'month') {
    const r = TG.per(key); const target = TG.target(u, key); const achieved = TG.achieved(u, r);
    const gap = Math.max(0, target - achieved); const days = TG.workDaysLeft(r);
    const ds = new Set(TG.depts(u)); const pool = visibleLeads().filter((l) => ds.has(l.funnel) && (!u.pid || l.owner === u.pid) && (!u.seg || leadSeg(l) === u.seg));
    const yr = { from: new Date(Date.now() - 365 * 864e5), to: new Date(Date.now() + 864e5) };
    const wonYr = pool.filter((l) => L.won(l) && M.inR(l.won_at, yr) && Number(l.value) > 0);
    const open = pool.filter(L.inPipe);
    const avgDeal = wonYr.length ? sum(wonYr, (l) => l.value) / wonYr.length : open.filter((l) => l.value > 0).length ? sum(open, (l) => l.value) / open.filter((l) => l.value > 0).length : 0;
    const closed = pool.filter((l) => l.is_deal && (L.won(l) || L.lost(l)) && M.inR(L.stageAt(l), yr));
    const cw = closed.filter(L.won).length; const winRate = closed.length >= 5 && cw && cw < closed.length ? clamp(cw / closed.length, 0.05, 0.9) : 0.3;
    const leadsYr = pool.filter((l) => M.inR(l.enquiry_date || l.created_at, yr));
    const l2w = leadsYr.length >= 20 ? clamp(leadsYr.filter(L.won).length / leadsYr.length, 0.01, 1) : 0.05;
    const dealsNeeded = gap && avgDeal ? Math.ceil(gap / avgDeal) : 0;
    const end = localDate(new Date(r.to.getTime() - 864e5));
    const ease = (l) => { const p = L.prob(l) / 100; const inP = !l.expected_close || l.expected_close <= end; const quiet = daysAgo(L.updated(l)); return p * (inP ? 1.6 : 1) - Math.min(quiet, 60) / 200 + (l.temperature === 'Hot' ? 0.15 : 0); };
    const ranked = open.filter((l) => l.value > 0).sort((a, b) => ease(b) - ease(a) || b.value - a.value);
    const easiest = []; let cum = 0;
    for (const l of ranked) { if (cum >= gap || easiest.length >= 8) break; easiest.push(l); cum += Number(l.value) || 0; }
    const weighted = sum(open, (l) => (l.value * L.prob(l)) / 100);
    const hot = pool.filter((l) => L.open(l) && !l.is_deal && ['Hot', 'Warm'].includes(l.temperature || l.ai_band));
    return { r, target, achieved, gap, days, perDay: gap / days, avgDeal, winRate, l2w, dealsNeeded, dealsToWork: dealsNeeded ? Math.ceil(dealsNeeded / winRate) : 0, leadsToWork: dealsNeeded ? Math.ceil(dealsNeeded / l2w) : 0, easiest, cover: gap ? Math.min(100, pct(cum, gap)) : 100, weighted, open, hot, pace: target ? achieved / target - TG.elapsed(r) : 0 };
  },
};
/* the colour of a progress figure: by how far along it is */
const toneFor = (p) => (p >= 100 ? 'good' : p >= 70 ? 'info' : p >= 40 ? 'warn' : 'bad');

/* the target as a road with milestones (quarters, months, weeks or days) for the period in the filter */
function milestones(P) {
  const out = []; const span = (P.to - P.from) / 864e5;
  if (P.key === 'fy' || (P.key === 'custom' && span > 200)) { for (let i = 0; i < 4; i++) { const to = new Date(P.from.getFullYear(), P.from.getMonth() + 3 * (i + 1), 1); out.push({ to: to > P.to ? P.to : to, label: 'Q' + (i + 1) }); } }
  else if (P.key === 'quarter' || (P.key === 'custom' && span > 45)) { for (let m = new Date(P.from.getFullYear(), P.from.getMonth(), 1); m < P.to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) { const to = new Date(m.getFullYear(), m.getMonth() + 1, 1); out.push({ to: to > P.to ? P.to : to, label: m.toLocaleDateString('en-IN', { month: 'short' }) }); } }
  else if (P.key === 'month' || (P.key === 'custom' && span > 10)) { let i = 1; for (let d = new Date(P.from); d < P.to; d = new Date(d.getTime() + 7 * 864e5)) { const to = new Date(Math.min(d.getTime() + 7 * 864e5, P.to.getTime())); if (out.length && (to - d) / 864e5 < 4) out[out.length - 1].to = to; else out.push({ to, label: 'W' + i++ }); } }
  else if (P.key === 'week' || P.key === 'custom') { for (let d = new Date(P.from); d < P.to; d = new Date(d.getTime() + 864e5)) out.push({ to: new Date(d.getTime() + 864e5), label: d.toLocaleDateString('en-IN', { weekday: 'short' }) }); }
  else out.push({ to: P.to, label: 'Today' });
  return out;
}
function milestoneTrack(u, P = TG.cur()) {
  const total = TG.inRange(u, P); const ach = TG.achieved(u, P); const now = Date.now();
  const ms = milestones(P).map((m) => ({ ...m, t: TG.inRange(u, { from: P.from, to: m.to }) }));
  const max = Math.max(total, ach, 1); const pc = total ? Math.round((ach / total) * 100) : null;
  const due = TG.inRange(u, { from: P.from, to: new Date(Math.min(now, P.to.getTime())) });
  const tone = pc == null ? 'mute' : toneFor(pc, TG.elapsed(P));
  /* no target: no milestones to place (they would all sit on the start line) */
  if (!total) return `<div class="mtrack tone-mute"><div class="mt-top"><div class="mt-big"><b>${inr(ach)}</b><span>booked · ${esc(P.label)}</span></div><div class="mt-pc mute">—</div></div>
    <div class="mt-road"><div class="mt-fill" style="width:${ach ? 100 : 0}%"></div></div></div>`;
  return `<div class="mtrack tone-${tone}">
    <div class="mt-top"><div class="mt-big"><b>${inr(ach)}</b><span>of ${total ? inr(total) : '—'}</span></div><div class="mt-pc ${tone}">${pc == null ? '—' : pc + '%'}</div></div>
    <div class="mt-road"><div class="mt-fill" style="width:${(Math.min(ach, max) / max) * 100}%"></div>${total ? `<i class="mt-now" style="left:${(Math.min(due, max) / max) * 100}%" title="Where you should be today: ${inr(due)}"></i>` : ''}
      ${ms.map((m) => { const st = ach >= m.t && m.t > 0 ? 'done' : m.to.getTime() - 1 < now ? 'miss' : m.to.getTime() - (P.to - P.from) / ms.length <= now ? 'cur' : 'next'; return `<span class="mt-ms ${st}" style="left:${(Math.min(m.t, max) / max) * 100}%" title="${esc(m.label)} · ${inr(m.t)}"><i>${st === 'done' ? svg('check') : ''}</i><em>${esc(m.label)}</em><small>${inrShort(m.t)}</small></span>`; }).join('')}</div>
    ${total ? `<div class="mt-stats"><span>${svg('flag')}<b>${inr(Math.max(0, total - ach))}</b> to go</span><span>${svg('cal')}<b>${nfmt(TG.workDaysLeft(P))}</b> working days left</span><span>${svg('up')}<b>${inr(Math.max(0, total - ach) / Math.max(1, TG.workDaysLeft(P)))}</b> a day</span><span>${svg('clock')}<b>${inr(due)}</b> due by today</span></div>` : ''}
  </div>`;
}
/* a small ring: share, centre text, label */
function ring(p, centre, label, color = 'var(--accent)') {
  const R = 30, C = 2 * Math.PI * R; const v0 = clamp(p || 0, 0, 100);
  return `<div class="ring"><svg viewBox="0 0 80 80" aria-hidden="true"><circle r="${R}" cx="40" cy="40" fill="none" stroke="var(--hair)" stroke-width="9"/><circle r="${R}" cx="40" cy="40" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * v0) / 100} ${C}" transform="rotate(-90 40 40)" ${v0 ? '' : 'opacity="0"'}/></svg><b>${esc(centre)}</b><span>${esc(label)}</span></div>`;
}
/* four tiles: this year, this month, this week, today */
function targetStrip(u) {
  return `<div class="tstrip">${['fy', 'month', 'week', 'today'].map((k) => {
    const r = TG.per(k); const t = TG.target(u, k); const a = TG.achieved(u, r); const p = t ? Math.round((a / t) * 100) : null;
    const tone = p == null ? 'mute' : toneFor(p, TG.elapsed(r));
    return `<div class="tsx tone-${tone}"><span class="l">${k === 'fy' ? 'Year · ' + r.label : r.label}</span><b class="v">${inr(a)}</b>
      <span class="s">${t ? `of ${inr(t)} · <b>${p}%</b>` : 'no target set'}</span><span class="pbar ${tone}"><i style="width:${clamp(p || 0, 0, 100)}%"></i><em style="left:${Math.round(TG.elapsed(r) * 100)}%" title="Where you should be today"></em></span></div>`;
  }).join('')}</div>`;
}
/* the plan for the period: what to close and the easiest way to get there */
function planHTML(u, key = 'month') {
  const p = TG.plan(u, key); const who = u.pid === DB.me?.id ? 'you' : u.pid ? DB.pname(u.pid).split(' ')[0] : 'the team';
  if (!p.target) return `<p class="faint" style="margin:0">No target is set ${u.pid ? 'for ' + esc(who) : 'here'} for ${esc(p.r.label.toLowerCase())} yet. ${isHead() ? 'Set it in Settings → Sales targets.' : 'Your Admin sets it in Settings → Sales targets.'}</p>`;
  if (!p.gap) return `<div class="plan done"><span class="gtag green">${svg('check')} Target met</span><p>${esc(who === 'you' ? 'You are' : who + ' is')} ${inr(p.achieved - p.target)} ahead of the ${esc(p.r.label.toLowerCase())} target. Every deal won from here is extra.</p></div>`;
  const tips = [];
  tips.push(`Book <b>${inr(p.perDay)}</b> a working day for the next ${p.days} day${p.days === 1 ? '' : 's'} (${inr(p.gap)} to go).`);
  if (p.dealsNeeded) tips.push(`That is about <b>${nfmt(p.dealsNeeded)} deal${p.dealsNeeded === 1 ? '' : 's'}</b> at the usual ${inr(p.avgDeal)}. At a ${Math.round(p.winRate * 100)}% win rate, work <b>${nfmt(p.dealsToWork)} open deals</b> hard.`);
  if (p.easiest.length) tips.push(`<b>Easiest path:</b> the ${p.easiest.length} deal${p.easiest.length === 1 ? '' : 's'} below are the most likely to close soon and cover <b>${p.cover}%</b> of the gap.`);
  if (p.weighted < p.gap) tips.push(`The weighted pipeline (${inr(p.weighted)}) is short of the gap: turn about <b>${nfmt(Math.max(0, Math.ceil((p.gap - p.weighted) / (p.avgDeal || p.gap))))} more leads into deals</b>${p.hot.length ? ` — start with the ${nfmt(p.hot.length)} hot and warm leads` : ''}.`);
  else if (p.hot.length) tips.push(`${nfmt(p.hot.length)} hot and warm leads are waiting: call them today so next month starts with a fuller pipeline.`);
  return `<div class="plan"><ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>
    ${p.easiest.length ? `<div class="easy">${p.easiest.map((l, i) => { const c = sum(p.easiest.slice(0, i + 1), (x) => x.value); return `<button class="ez" data-lead="${l.id}"><span class="n">${i + 1}</span><span class="grow"><b>${esc(L.title(l))}</b><span class="s">${esc(l.stage)} · ${L.prob(l)}% · ${l.expected_close ? 'closes ' + fmtDate(l.expected_close) : 'no closure date'} · ${esc(L.ownerLabel(l))}</span></span><span class="r"><b>${inr(l.value)}</b><span class="pbar good"><i style="width:${Math.min(100, pct(c, p.gap))}%"></i></span></span></button>`; }).join('')}</div>` : '<p class="faint">No open deals with a value yet. Convert qualified leads to deals to build the path.</p>'}</div>`;
}

/* ---------- pictures: donut and horizontal bars in the glass palette (no red or pink) ---------- */
const PAL = ['#2676dc', '#8d3f91', '#14a3a0', '#4167d7', '#58d6ff', '#b0467c', '#0e5fb8', '#d92251', '#2cc3b5', '#9c6fd8'];
function donut(parts, centre, sub = '') {
  parts = parts.filter((x) => x.value > 0); const tot = sum(parts, (x) => x.value);
  if (!tot) return '<p class="faint">Nothing to show for this period.</p>';
  const R = 52, C = 2 * Math.PI * R; let off = 0;
  const arcs = parts.map((x, i) => { const len = (x.value / tot) * C; const a = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${x.color || PAL[i % PAL.length]}" stroke-width="20" stroke-dasharray="${Math.max(len - 1.5, 0.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(x.label)}: ${inr(x.value)}</title></circle>`; off += len; return a; }).join('');
  return `<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(centre)}"><circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--hair)" stroke-width="20"/>${arcs}<text x="70" y="68" text-anchor="middle" class="dv">${esc(centre)}</text><text x="70" y="86" text-anchor="middle" class="ds">${esc(sub)}</text></svg>
    <ul class="dleg">${parts.slice(0, 8).map((x, i) => `<li ${x.rd ? `data-rd="${x.rd}" class="click" title="See where this comes from"` : ''}><i style="background:${x.color || PAL[i % PAL.length]}"></i><span class="grow">${esc(x.label)}</span><b>${inr(x.value)}</b><span class="faint">${Math.round((x.value / tot) * 100)}%</span></li>`).join('')}${parts.length > 8 ? `<li class="faint">+${parts.length - 8} more</li>` : ''}</ul></div>`;
}
function hbars(rows, fmt = inr, none = 'Nothing to show.') {
  const max = Math.max(1, ...rows.map((x) => x.value));
  return rows.length ? `<div class="hbars">${rows.map((x, i) => `<div class="hb"><span class="hl">${esc(x.label)}${x.sub ? `<span class="s">${esc(x.sub)}</span>` : ''}</span><span class="hbar"><i style="width:${(x.value / max) * 100}%;background:${x.color || PAL[i % PAL.length]}"></i></span><b>${fmt(x.value)}</b></div>`).join('')}</div>` : `<p class="faint">${none}</p>`;
}

/* ================= Revenue → Overview (pictures) and Targets (the breakup) ================= */
function bookedIn(codes, r) { return sum(codes, (c) => TG.achieved({ dept: c, pid: ST.person === 'all' ? null : ST.person }, r)); }
/* ---------- Revenue → Overview: target against booked for any period, how far behind, and the breakup ---------- */
let revPer = 'fy';
const REV_PERS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter'], ['fy', 'This year']];
/* one unit (process, product or person) against its target for the period: target, due by today, booked, collected, balance due */
function tva(u, P) {
  const now = new Date(); const t = TG.inRange(u, P); const due = TG.inRange(u, { from: P.from, to: new Date(Math.min(now.getTime(), P.to.getTime())) });
  const a = TG.achieved(u, P); const c = TG.collected(u, P); const d = TG.due(u, P);
  return { t, due, a, c, d, gap: Math.max(0, t - a), lag: due - a, p: t ? Math.round((a / t) * 100) : null, u, P };
}
const pctChip = (x, P) => (x.p == null ? '<span class="faint">—</span>' : `<span class="chip tone ${toneFor(x.p, TG.elapsed(P))}">${x.p}%</span>`);
const lagCell = (x) => (!x.t ? '<span class="faint">—</span>' : x.lag > 0.5 ? `<span class="bad">−${inr(x.lag)}</span>` : `<span class="good">+${inr(-x.lag)}</span>`);
function tvaTable(head, rows, P, total) {
  const dr = (r, v, status, what) => (r.x.u && v ? rdNum(inr(v), { title: `${what} · ${(r.label || String(r.cells).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 60)} · ${P.label}`, u: r.x.u, r: P, status }) : inr(v));
  const tr = (r, cls = '') => `<tr class="${cls}">${r.cells}<td class="n">${r.x.t ? inr(r.x.t) : '—'}</td><td class="n"><b>${dr(r, r.x.a, null, 'Achieved')}</b></td><td class="n">${dr(r, r.x.c, 'Collected', 'Collected')}</td><td class="n">${r.x.d ? dr(r, r.x.d, 'Pending PO', 'Balance due') : '—'}</td><td class="n">${lagCell(r.x)}</td><td class="n">${pctChip(r.x, P)}</td><td class="pcol"><span class="pbar ${r.x.p == null ? 'mute' : toneFor(r.x.p, TG.elapsed(P))}"><i style="width:${clamp(r.x.p || 0, 0, 100)}%"></i><em style="left:${Math.round(TG.elapsed(P) * 100)}%"></em></span></td></tr>`;
  return `<div class="tablewrap free"><table class="tva"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}<th class="n">Target</th><th class="n">Achieved</th><th class="n">Collected</th><th class="n">Balance due</th><th class="n">Ahead / behind</th><th class="n">%</th><th class="pcol"></th></tr></thead>
    <tbody>${rows.map((r) => tr(r)).join('') || `<tr><td colspan="${head.length + 7}" class="faint">Nothing to show.</td></tr>`}${total ? tr(total, 'tot') : ''}</tbody></table></div>`;
}
function revOverview(b) {
  const fy = TG.fy(); const R = TG.per('fy', fy); const P = TG.per(revPer, fy); const codes = ST.dept === 'All' ? DEPTS().map((d) => d.code) : [ST.dept];
  const pid = ST.person === 'all' ? null : ST.person; const u = { dept: ST.dept, pid };
  const X = tva(u, P); const days = TG.workDaysLeft(P);
  const dated = DB.t.revenue_entries.some((e) => e.paid_on && TG.lineIn(e, P));
  /* by process, by product, by person */
  const procRows = codes.map((code) => ({ cells: `<td>${deptChip(code)} ${esc(dept(code).name)}</td>`, x: tva({ dept: code, pid }, P) }));
  const prodRows = codes.flatMap((code) => { const segs = [...new Set([...(dept(code).segments || []), ...TG.rows(fy).filter((t) => t.dept === code && t.segment && !t.person).map((t) => t.segment), ...DB.t.revenue_entries.filter((e) => e.department === code && TG.lineIn(e, R)).map((e) => e.segment)])];
    return segs.map((sg) => ({ cells: `<td>${deptChip(code)}</td><td>${esc(sg)}</td>`, x: tva({ dept: code, seg: sg, pid }, P) })).filter((r) => r.x.t || r.x.a); });
  const holders = [...new Set(TG.rows(fy).filter((t) => t.person && codes.includes(t.dept)).map((t) => t.person))];
  const pplRows = pid ? [] : holders.map((id) => ({ id, cells: `<td><b>${esc(DB.pname(id))}</b><div class="s">${esc(DB.get('profiles', id)?.designation || '')}</div></td>`, x: tva({ dept: ST.dept, pid: id }, P) })).sort((a, c) => c.x.t - a.x.t);
  if (pplRows.length) { const rest = { t: 0, due: 0, a: X.a - sum(pplRows, (r) => r.x.a), c: X.c - sum(pplRows, (r) => r.x.c), d: X.d - sum(pplRows, (r) => r.x.d) }; rest.lag = -rest.a; rest.p = null; rest.gap = 0; if (rest.a > 0.5) pplRows.push({ cells: '<td>Others and not yet assigned<div class="s">Revenue lines with no owner, and Academy collections of callers without a target</div></td>', x: rest }); }
  /* month by month for the year: each process, the total, the target and the running gap */
  const months = []; for (let d = new Date(fy, 3, 1); d < R.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(localDate(d).slice(0, 7));
  const mr = (ym) => { const [y, m] = ym.split('-').map(Number); return { key: 'month', from: new Date(y, m - 1, 1), to: new Date(y, m, 1) }; };
  let cumA = 0, cumT = 0; const ym0 = localDate(new Date()).slice(0, 7);
  const mrows = months.map((m) => { const per = codes.map((c) => TG.achieved({ dept: c, pid }, mr(m))); const a = sum(per); const t = TG.inRange(u, mr(m)); const c = TG.collected(u, mr(m)); cumA += a; cumT += t; return { m, per, a, t, c, cumA, cumT, past: m <= ym0 }; });
  const booked = mrows.map((x) => x.a); const collected = mrows.map((x) => x.c); const tgt = mrows.map((x) => x.t);
  const seg = Object.entries(groupBy(TG.lines(u, R), (x) => (codes.length > 1 ? x.e.department + ' · ' : '') + (x.e.segment || 'Not stated'))).map(([label, a]) => ({ label, value: sum(a, (x) => x.w * x.e.amount), rd: RD.put({ title: label + ' · ' + TG.label(fy), u: { dept: a[0].e.department, seg: a[0].e.segment, pid }, r: R }) })).sort((a, c) => c.value - a.value);
  const byDept = codes.map((c) => ({ label: dept(c).name, value: TG.achieved({ dept: c, pid }, R), color: dept(c).color, rd: RD.put({ title: dept(c).name + ' · ' + TG.label(fy), u: { dept: c, pid }, r: R }) }));
  const recv = pid ? 0 : sum(codes, (c) => M.receivables(c).amount);
  const cli = {}; TG.lines(u, R).forEach(({ e, w }) => { const k = e.client || 'Not stated'; cli[k] = (cli[k] || 0) + w * Number(e.amount || 0); });
  const top = Object.entries(cli).filter(([k]) => !/^not stated|^individual candidates/i.test(k)).map(([label, value]) => ({ label, value })).sort((a, c) => c.value - a.value).slice(0, 8);
  const behind = X.lag > 0.5; const tn = X.p == null ? 'mute' : toneFor(X.p, TG.elapsed(P));
  b.innerHTML = `<div class="row tgbar"><div class="seg big" role="group" aria-label="Period">${REV_PERS.map(([k, t]) => `<button data-rp="${k}" aria-pressed="${revPer === k}">${t}</button>`).join('')}</div>
      <span class="faint">${esc(P.label)} · ${fmtDate(P.from)} – ${fmtDate(new Date(P.to.getTime() - 864e5))}${['today', 'week'].includes(revPer) && !dated ? ' · sheet revenue is monthly, so a day or week shows only payments recorded in the CRM' : ''}</span></div>
    <div class="kpis exec">
      ${kpi({ label: 'Target · ' + P.label, value: X.t ? inr(X.t) : '—', sub: X.t ? `${inr(X.due)} due by today at an even pace` : 'No target set' })}
      ${kpi({ label: 'Achieved (booked)', value: rdNum(inr(X.a), { title: 'Achieved · ' + P.label, u, r: P }), sub: X.t ? `${X.p}% of target · ${Math.round(TG.elapsed(P) * 100)}% of the period gone` : 'Collected + balance due', meter: X.t ? X.p : undefined, tone: tn })}
      ${kpi({ label: 'Collected', value: rdNum(inr(X.c), { title: 'Collected · ' + P.label, u, r: P, status: 'Collected' }), sub: 'Money received' })}
      ${kpi({ label: 'Balance due', value: rdNum(inr(X.d), { title: 'Balance due · ' + P.label, u, r: P, status: 'Pending PO' }), sub: 'Sale done, payment to come' })}
      ${kpi({ label: behind ? 'Behind target by' : 'Ahead of target by', value: X.t ? inr(Math.abs(X.lag)) : '—', sub: X.t ? `against ${inr(X.due)} due by today` : '', tone: X.t ? (behind ? 'bad' : 'good') : '' })}
      ${kpi({ label: 'Needed per working day', value: X.gap ? inr(X.gap / days) : X.t ? 'Target met' : '—', sub: X.gap ? `${inr(X.gap)} to go · ${nfmt(days)} working day${days === 1 ? '' : 's'} left` : '' })}
    </div>
    <section class="glass panel"><div class="panel-head"><h2><span class="gtag green">${svg('target')} Target</span> ${esc(P.label)}</h2><span class="sub">The marker is where the team should be today</span></div>${milestoneTrack(u, P)}</section>
    <section class="glass panel"><div class="panel-head"><h2><span class="gtag violet">Processes</span> Target against achieved</h2><span class="sub">${esc(P.label)} · ahead / behind is against the target due by today</span></div>
      ${tvaTable(['Process'], procRows, P, codes.length > 1 ? { cells: '<td>Total</td>', x: X } : null)}</section>
    <div class="grid">
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag teal">Products</span> Target against achieved</h2><span class="sub">${esc(P.label)}</span></div>${tvaTable(['Process', 'Product'], prodRows, P)}</section>
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag blue">People</span> Target against achieved</h2><span class="sub">${esc(P.label)} · own lines plus their share of Academy collections</span></div>${pid ? '<p class="faint">Showing one person: clear the Person filter to compare everyone.</p>' : tvaTable(['Person'], pplRows, P)}</section>
    </div>
    <section class="glass panel"><div class="panel-head"><h2><span class="gtag blue">Month by month</span> ${TG.label(fy)}</h2><span class="sub">Booked by process, the target at an even pace, and the running gap</span></div>
      ${barChart({ labels: months.map(monShort), series: [{ name: 'Booked', color: '#2676dc', values: booked }, { name: 'Collected', color: '#8d3f91', values: collected }], target: tgt.some(Boolean) ? tgt : null })}
      <div class="tablewrap free"><table class="mtab"><thead><tr><th>Month</th>${codes.map((c) => `<th class="n">${esc(dept(c).name)}</th>`).join('')}<th class="n">Booked</th><th class="n">Collected</th><th class="n">Target</th><th class="n">Year to date</th><th class="n">Behind / ahead</th></tr></thead><tbody>
        ${mrows.map((x) => `<tr class="${x.m === ym0 ? 'cur' : ''} ${x.past ? '' : 'future'}"><td>${monShort(x.m)}${x.m === ym0 ? ' <span class="chip tone info">now</span>' : ''}</td>${x.per.map((v0, i) => `<td class="n">${v0 ? rdNum(inr(v0), { title: `${dept(codes[i]).name} · ${monShort(x.m)}`, u: { dept: codes[i], pid }, r: mr(x.m) }) : '<span class="faint">—</span>'}</td>`).join('')}<td class="n"><b>${x.a ? rdNum(inr(x.a), { title: 'Booked · ' + monShort(x.m), u, r: mr(x.m) }) : '—'}</b></td><td class="n">${x.c ? rdNum(inr(x.c), { title: 'Collected · ' + monShort(x.m), u, r: mr(x.m), status: 'Collected' }) : '—'}</td><td class="n">${x.t ? inr(x.t) : '—'}</td><td class="n">${x.past ? inr(x.cumA) : ''}</td><td class="n">${x.past && x.cumT ? (x.cumT - x.cumA > 0.5 ? `<span class="bad">−${inr(x.cumT - x.cumA)}</span>` : `<span class="good">+${inr(x.cumA - x.cumT)}</span>`) : ''}</td></tr>`).join('')}
        <tr class="tot"><td>${TG.label(fy)}</td>${codes.map((_, i) => `<td class="n">${inr(sum(mrows, (x) => x.per[i]))}</td>`).join('')}<td class="n">${inr(sum(booked))}</td><td class="n">${inr(sum(collected))}</td><td class="n">${inr(sum(tgt))}</td><td></td><td></td></tr></tbody></table></div></section>
    <div class="grid g3">
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag violet">Processes</span> Booked</h2><span class="sub">${TG.label(fy)}</span></div>${donut(byDept, inrShort(sum(byDept, (x) => x.value)), 'booked')}</section>
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag teal">Products</span> Booked</h2><span class="sub">${TG.label(fy)}</span></div>${donut(seg, nfmt(seg.length), 'products')}</section>
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag amber">Cash</span> Collected and still to come</h2><span class="sub">${TG.label(fy)}</span></div>${donut([{ label: 'Collected', value: TG.collected(u, R), color: '#2cc3b5' }, { label: 'Balance due', value: TG.due(u, R), color: '#7b6cf0' }, { label: 'Receivable on CRM deals', value: recv, color: '#3a8ae0' }], pct(TG.collected(u, R), TG.collected(u, R) + TG.due(u, R) + recv) + '%', 'collected')}</section>
    </div>
    <section class="glass panel"><div class="panel-head"><h2>Top clients</h2><span class="sub">${TG.label(fy)} · ledger</span></div>${hbars(top)}</section>`;
  b.querySelectorAll('[data-rp]').forEach((x) => (x.onclick = () => { revPer = x.dataset.rp; revOverview(b); }));
}

let tgFY = null;
function revTargets(b, rer) {
  const fy = tgFY ?? TG.fy(); const codes = ST.dept === 'All' ? DEPTS().map((d) => d.code) : [ST.dept];
  const R = TG.per('fy', fy); const mR = TG.per('month'); const wR = TG.per('week'); const cur = fy === TG.fy();
  const el0 = TG.elapsed(mR);
  const status = (a, t, el) => { if (!t) return '<span class="faint">—</span>'; const p = Math.round((a / t) * 100); const tn = toneFor(p, el); return `<span class="chip tone ${tn}">${p}%</span>`; };
  const cell = (y, k, d) => (y ? inr(k === 'fy' ? y : y * TG.phase(fy, d, localDate(new Date()).slice(0, 7)) * (k === 'week' ? 7 / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() : 1)) : '<span class="faint">—</span>');
  const cards = codes.map((code) => {
    const d = dept(code); const team = { dept: code }; const ty = TG.yearly(fy, code);
    const segs = [...new Set([...(d.segments || []), ...TG.rows(fy).filter((t) => t.dept === code && t.segment && !t.person).map((t) => t.segment)])];
    const segRows = segs.map((s) => ({ s, y: TG.yearly(fy, code, s), a: TG.achieved({ dept: code, seg: s }, R), am: cur ? TG.achieved({ dept: code, seg: s }, mR) : 0 })).filter((x) => x.y || x.a);
    const people = targetPeople(code, fy);
    const pRows = people.map((p) => { const u = { dept: code, pid: p.id }; const y = TG.yearly(fy, code, '', p.id); return { p, y, a: TG.achieved(u, R), am: cur ? TG.achieved(u, mR) : 0, aw: cur ? TG.achieved(u, wR) : 0, tm: cur ? TG.target(u, 'month', fy) : 0, tw: cur ? TG.target(u, 'week', fy) : 0 }; });
    const split = sum(pRows, (x) => x.y); const segSum = sum(segRows, (x) => x.y);
    const aT = TG.achieved(team, R); const pT = ty ? Math.round((aT / ty) * 100) : 0;
    return `<section class="glass panel tgcard" style="--dc:${esc(d.color)}">
      <div class="panel-head"><h2>${deptChip(code)} ${esc(d.name)} · ${TG.label(fy)}</h2>${isHead() ? `<button class="btn small" data-settg="${esc(code)}">${svg('set')} Set in Settings</button>` : ''}</div>
      <div class="tghead">
        <div class="tgbig"><span class="faint">Team target</span><b>${ty ? inr(ty) : '—'}</b><span class="faint">${ty ? `${cell(ty, 'month', code)} this month · ${cell(ty, 'week', code)} this week` : 'Not set yet'}</span></div>
        <div class="tgbig"><span class="faint">Achieved (booked)</span><b>${inr(aT)}</b><span class="pbar ${toneFor(pT, TG.elapsed(R))}"><i style="width:${clamp(pT, 0, 100)}%"></i><em style="left:${Math.round(TG.elapsed(R) * 100)}%"></em></span><span class="faint">${ty ? `${pT}% · ${inr(Math.max(0, ty - aT))} to go` : ''}</span></div>
        <div class="tgbig"><span class="faint">Split to executives</span><b>${inr(split)}</b><span class="faint">${ty ? (Math.abs(split - ty) < 1 ? 'Fully split' : split < ty ? `${inr(ty - split)} not split yet` : `${inr(split - ty)} more than the team target`) : ''}</span></div>
      </div>
      ${ty && segRows.length ? `<div class="segbar" aria-label="Team target by segment">${segRows.filter((x) => x.y).map((x, i) => `<i style="flex:${x.y};background:${PAL[i % PAL.length]}" title="${esc(x.s)} · ${inr(x.y)}"><span>${esc(x.s)}</span></i>`).join('')}${segSum < ty ? `<i class="rest" style="flex:${ty - segSum}" title="Not split by segment"><span>Not split</span></i>` : ''}</div>` : ''}
      <div class="grid g2 tgtables">
        <div><h4>By segment</h4>${segRows.length ? `<div class="tablewrap"><table><thead><tr><th>Segment</th><th class="n">Yearly</th><th class="n">Monthly</th><th class="n">Weekly</th><th class="n">Achieved</th><th class="n">%</th></tr></thead><tbody>
          ${segRows.map((x) => `<tr><td>${esc(x.s)}</td><td class="n">${cell(x.y, 'fy', code)}</td><td class="n">${cell(x.y, 'month', code)}</td><td class="n">${cell(x.y, 'week', code)}</td><td class="n">${inr(x.a)}</td><td class="n">${status(x.a, x.y, TG.elapsed(R))}</td></tr>`).join('')}
          <tr class="tot"><td>Total</td><td class="n">${segSum ? inr(segSum) : '—'}</td><td></td><td></td><td class="n">${inr(sum(segRows, (x) => x.a))}</td><td></td></tr></tbody></table></div>` : '<p class="faint">No segment targets yet.</p>'}</div>
        <div><h4>By executive</h4>${pRows.length ? `<div class="tablewrap"><table><thead><tr><th>Executive</th><th class="n">Yearly</th><th class="n">Monthly</th><th class="n">Weekly</th><th class="n">Achieved</th>${cur ? '<th class="n">This month</th><th class="n">This week</th>' : ''}</tr></thead><tbody>
          ${pRows.map((x) => `<tr><td><b>${esc(x.p.full_name)}</b></td><td class="n">${cell(x.y, 'fy', code)}</td><td class="n">${cell(x.y, 'month', code)}</td><td class="n">${cell(x.y, 'week', code)}</td><td class="n">${inr(x.a)} ${status(x.a, x.y, TG.elapsed(R))}</td>${cur ? `<td class="n">${inr(x.am)} ${status(x.am, x.tm, el0)}</td><td class="n">${inr(x.aw)} ${status(x.aw, x.tw, TG.elapsed(wR))}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="faint">Nobody in this team yet.</p>'}</div>
      </div>
      ${cur && ty ? `<details class="tgplan"><summary>${svg('spark')} How the team hits ${esc(mR.label)}</summary>${planHTML(team, 'month')}</details>` : ''}
    </section>`;
  }).join('');
  b.innerHTML = `<div class="row tgbar"><div class="seg" role="group" aria-label="Financial year">${[TG.fy() - 1, TG.fy(), TG.fy() + 1].map((y) => `<button data-tgfy="${y}" aria-pressed="${y === fy}">${TG.label(y)}</button>`).join('')}</div>
      <span class="faint">Monthly follows the monthly targets in Settings when set (otherwise a twelfth); weekly is this month's share for seven days. Achieved counts won deals by the date won, plus sheet ledger totals.</span></div>${cards}`;
  b.querySelectorAll('[data-tgfy]').forEach((x) => (x.onclick = () => { tgFY = Number(x.dataset.tgfy); rer(); }));
  b.querySelectorAll('[data-settg]').forEach((x) => (x.onclick = () => { tsDept = x.dataset.settg; tsFY = fy; go('settings', 'targets'); }));
  bindLeadClicks(b);
}
/* the executives a team target is split between: sales people in that team (my tree; everyone for C-level / Admin), plus anyone already holding a target */
function targetPeople(code, fy) {
  return scopePeople().filter((p) => ((p.departments || []).includes(code) && isSales(p) && !['clevel', 'admin'].includes(p.role)) || TG.row(fy, code, '', p.id));
}
/* ================= Settings → Sales targets: pick a team, then set the team, segment, executive and monthly targets ================= */
let tsFY = null, tsDept = null;
function setTargets(b, rer) {
  const fy = tsFY ?? TG.fy(); const codes = DEPTS().map((d) => d.code);
  if (!codes.includes(tsDept)) tsDept = codes[0];
  const R = TG.per('fy', fy);
  const card = (code) => { const d = dept(code); const ty = TG.yearly(fy, code); const a = TG.achieved({ dept: code }, R); const ppl = targetPeople(code, fy); const split = sum(ppl, (p) => TG.yearly(fy, code, '', p.id)); const p = ty ? Math.round((a / ty) * 100) : 0;
    return `<button class="tscard glass ${code === tsDept ? 'on' : ''}" data-tsd="${esc(code)}" style="--dc:${esc(d.color)}"><span class="row between"><span class="pbteam">${deptChip(code)} ${esc(d.name)}</span>${code === tsDept ? '<span class="chip tone info">Editing</span>' : ''}</span>
      <b class="tsv">${ty ? inr(ty) : 'No target yet'}</b><span class="pbar ${toneFor(p, TG.elapsed(R))}"><i style="width:${clamp(p, 0, 100)}%"></i></span>
      <span class="s">${ty ? `${p}% achieved · ${ty ? Math.round((split / ty) * 100) : 0}% split to ${ppl.length} executive${ppl.length === 1 ? '' : 's'}` : `${ppl.length} executive${ppl.length === 1 ? '' : 's'} in this team`}</span></button>`; };
  const code = tsDept; const d = dept(code); const people = targetPeople(code, fy);
  const segs = [...new Set([...(d.segments || []), ...TG.rows(fy).filter((t) => t.dept === code && t.segment && !t.person).map((t) => t.segment)])];
  const months = Array.from({ length: 12 }, (_, i) => localDate(new Date(fy, 3 + i, 1)));
  const mval = (mo) => DB.t.revenue_targets.find((t) => t.dept === code && String(t.month).slice(0, 7) === mo.slice(0, 7))?.amount ?? '';
  const val = (seg, pid) => TG.row(fy, code, seg, pid)?.amount ?? '';
  const line = (id, label, value, sub = '') => `<tr><td>${label}${sub ? `<div class="s">${sub}</div>` : ''}</td><td class="n"><input class="tgin" type="number" min="0" id="${id}" value="${esc(value)}" aria-label="${esc(String(label).replace(/<[^>]+>/g, ''))} yearly target"></td><td class="n mo" data-mo="${id}"></td><td class="n wk" data-wk="${id}"></td><td class="n sh" data-sh="${id}"></td></tr>`;
  b.innerHTML = `<div class="row tgbar"><div class="seg" role="group" aria-label="Financial year">${[TG.fy() - 1, TG.fy(), TG.fy() + 1].map((y) => `<button data-tsfy="${y}" aria-pressed="${y === fy}">${TG.label(y)}</button>`).join('')}</div>
      <span class="faint">Choose a team, then set its yearly target, how it splits by segment and by executive, and how the year is phased by month. Amounts ex-GST.</span></div>
    <div class="tsgrid">${codes.map(card).join('')}</div>
    <section class="glass panel tgcard" style="--dc:${esc(d.color)}"><div class="panel-head"><h2>${deptChip(code)} ${esc(d.name)} · ${TG.label(fy)}</h2><button class="btn primary" id="tssave">Save ${esc(code)} targets</button></div>
      <div class="tablewrap"><table class="tgedit"><thead><tr><th></th><th class="n">Yearly</th><th class="n">This month</th><th class="n">This week</th><th class="n">Share</th></tr></thead><tbody>
        ${line('tg_team', '<b>Team target</b>', val('', null))}
        <tr class="sep"><td colspan="5">By segment <span class="faint" id="sgsum"></span></td></tr>
        ${segs.map((x, i) => line('tg_s' + i, esc(x), val(x, null))).join('') || '<tr><td colspan="5" class="faint">Add revenue segments in Statuses, stages &amp; lists.</td></tr>'}
        <tr class="sep"><td colspan="5">By executive <span class="faint" id="pssum"></span> ${people.length ? '<button class="btn small" id="tgeven">Split the team target evenly</button>' : ''}</td></tr>
        ${people.map((p) => line('tg_p_' + p.id, esc(p.full_name), val('', p.id), esc(p.designation || ROLES[p.role] || ''))).join('') || `<tr><td colspan="5" class="faint">Nobody is in ${esc(code)} yet. Tick ${esc(code)} under Departments for each person in Users &amp; Access.</td></tr>`}
      </tbody></table></div>
      <h4 style="margin:16px 0 6px">Phasing by month <span class="faint" id="mosum"></span> <button class="btn small" id="tgmo">Spread the team target evenly</button> <button class="btn small ghost" id="tgmoclr">Clear (use a twelfth each month)</button></h4>
      <div class="tablewrap"><table><thead><tr>${months.map((mo) => `<th class="n">${new Date(mo + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short' })}</th>`).join('')}</tr></thead><tbody><tr>${months.map((mo) => `<td class="n"><input class="tgm" data-m="${mo}" type="number" min="0" value="${mval(mo)}" style="width:110px;text-align:right" aria-label="Target ${mo}"></td>`).join('')}</tr></tbody></table></div></section>`;
  b.querySelectorAll('[data-tsfy]').forEach((x) => (x.onclick = () => { tsFY = Number(x.dataset.tsfy); rer(); }));
  b.querySelectorAll('[data-tsd]').forEach((x) => (x.onclick = () => { tsDept = x.dataset.tsd; rer(); }));
  const n = (id) => Number(b.querySelector('#' + id)?.value || 0);
  const ym = localDate(new Date()).slice(0, 7); const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const phase = () => { const ms = $$('.tgm', b); const tot = sum(ms, (i) => Number(i.value || 0)); if (!tot) return 1 / 12; return sum(ms.filter((i) => i.dataset.m.slice(0, 7) === ym), (i) => Number(i.value || 0)) / tot; };
  const calc = () => {
    const team = n('tg_team'); const ph = phase();
    b.querySelectorAll('.tgin').forEach((i) => { const y = Number(i.value || 0); const mo = y * ph; b.querySelector(`[data-mo="${i.id}"]`).textContent = y ? inr(mo) : '—'; b.querySelector(`[data-wk="${i.id}"]`).textContent = y ? inr((mo * 7) / dim) : '—'; b.querySelector(`[data-sh="${i.id}"]`).textContent = y && team && i.id !== 'tg_team' ? Math.round((y / team) * 100) + '%' : ''; });
    const sg = sum(segs.map((_, i) => n('tg_s' + i))); const ps = sum(people.map((p) => n('tg_p_' + p.id))); const ms = sum($$('.tgm', b), (i) => Number(i.value || 0));
    const note = (x, word) => (x ? `· ${inr(x)}${team ? (Math.abs(x - team) < 1 ? ` · matches the team target` : ` · ${x < team ? inr(team - x) + ' ' + word : inr(x - team) + ' over the team target'}`) : ''}` : '');
    b.querySelector('#sgsum').textContent = note(sg, 'not split by segment'); b.querySelector('#pssum').textContent = note(ps, 'not split yet'); b.querySelector('#mosum').textContent = note(ms, 'not phased');
  };
  b.querySelectorAll('.tgin,.tgm').forEach((i) => i.addEventListener('input', calc)); calc();
  b.querySelector('#tgeven')?.addEventListener('click', () => { const team = n('tg_team'); if (!team) return toast('Set the team target first.', true); people.forEach((p) => { b.querySelector('#tg_p_' + p.id).value = Math.round(team / people.length / 1000) * 1000; }); calc(); });
  b.querySelector('#tgmo').onclick = () => { const team = n('tg_team'); if (!team) return toast('Set the team target first.', true); $$('.tgm', b).forEach((i) => { i.value = Math.round(team / 12); }); calc(); };
  b.querySelector('#tgmoclr').onclick = () => { $$('.tgm', b).forEach((i) => { i.value = ''; }); calc(); };
  b.querySelector('#tssave').onclick = () => guard(async () => {
    const want = [['tg_team', '', null], ...segs.map((x, i) => ['tg_s' + i, x, null]), ...people.map((p) => ['tg_p_' + p.id, '', p.id])];
    for (const [id, seg, pid] of want) {
      const raw = b.querySelector('#' + id).value; const amt = raw === '' ? null : Number(raw); const ex = TG.row(fy, code, seg, pid);
      if (amt != null && (amt < 0 || !isFinite(amt))) throw new Error('Targets must be zero or more.');
      if (ex && amt == null) await DB.remove('sales_targets', ex.id);
      else if (ex && Number(ex.amount) !== amt) await DB.update('sales_targets', ex.id, { amount: amt, updated_at: nowISO(), updated_by: DB.me.id });
      else if (!ex && amt != null) await DB.insert('sales_targets', { fy, dept: code, segment: seg, person: pid, amount: amt, updated_by: DB.me.id });
    }
    const mrows = $$('.tgm', b).map((i) => ({ dept: code, month: i.dataset.m, amount: Number(i.value || 0) }));
    if (mrows.some((r) => r.amount) || DB.t.revenue_targets.some((t) => t.dept === code && M.inR(t.month, R))) await upsertKey('revenue_targets', mrows, ['dept', 'month']);
    rer();
  }, 'Targets saved');
}

/* ================= My dashboard: my own targets, follow-ups, tasks, visits and KRA (no team numbers) ================= */
VIEWS.mydash = {
  title: 'My dashboard', sub: 'Where you stand: your target, today’s follow-ups and visits, your tasks and your KRA. Only your own work.',
  render(el) {
    const me = DB.me.id; const r = curRange(); const now = new Date(); const today = todayStr();
    const u = { dept: ST.dept, pid: me };
    const mine = visibleLeads().filter((l) => l.owner === me && M.deptOk(l.funnel) && L.open(l));
    const over = mine.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < now && (!l.last_contact_at || new Date(l.last_contact_at) < new Date(l.next_followup_at))).sort((a, b) => a.next_followup_at.localeCompare(b.next_followup_at));
    const todayF = mine.filter((l) => l.next_followup_at && localDate(l.next_followup_at) === today && new Date(l.next_followup_at) >= now).sort((a, b) => a.next_followup_at.localeCompare(b.next_followup_at));
    const vis = DB.t.visits.filter((x) => x.owner === me && ['Planned', 'Rescheduled'].includes(x.status || 'Planned') && x.planned_at).sort((a, b) => a.planned_at.localeCompare(b.planned_at));
    const vMiss = vis.filter((x) => new Date(x.planned_at) < now && localDate(x.planned_at) < today); const vNext = vis.filter((x) => new Date(x.planned_at) >= now || localDate(x.planned_at) === today).slice(0, 6);
    const tasks = DB.t.work_tasks.filter((t) => t.owner === me && taskOpen(t)).sort((a, b) => ({ bad: 0, warn: 1, info: 2, good: 3, mute: 4 })[taskTone(a)] - ({ bad: 0, warn: 1, info: 2, good: 3, mute: 4 })[taskTone(b)] || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
    const s = M.person(me, r); const has = TG.has(u);
    const deals = mine.filter((l) => l.is_deal).sort((a, b) => String(a.expected_close || '9').localeCompare(String(b.expected_close || '9')));
    const D = new Map(); const put = (k, title, a) => { D.set(k, { title, rows: a }); return cnt(a.length, k); };
    el.innerHTML = `${welcomeHTML()}${filterBar({ person: false })}
      <section class="glass panel mytg"><div class="panel-head"><h2><span class="gtag green">${svg('target')} My target</span> ${esc(TG.cur().label)}</h2><span class="sub">${has ? '' : 'No target set for you yet'}</span></div>
        ${milestoneTrack(u, TG.cur())}
        <div class="grid g2" style="margin-top:14px"><div><h4 style="margin:0 0 6px">${svg('spark')} Easiest way to the target</h4>${planHTML(u, ST.period)}</div>
          <div class="rings mine">${ring(s.kra?.score || 0, s.kra ? s.kra.score + '' : '—', 'KRA score', '#7b6cf0')}${ring(s.connectRate || 0, nfmt(s.calls), 'Calls', '#3a8ae0')}${ring(s.followPct ?? 0, s.followPct == null ? '—' : s.followPct + '%', 'On time', '#2cc3b5')}${ring(Math.min(100, (s.conversions || 0) * 20), nfmt(s.conversions), 'Won', '#2fb36a')}</div></div></section>
      <div class="kpis">
        ${kpi({ label: 'Follow-ups overdue', value: put('fo', 'My follow-ups overdue', over), sub: 'Call these first' })}
        ${kpi({ label: 'Follow-ups today', value: put('ft', 'My follow-ups still due today', todayF), sub: 'Still to make' })}
        ${kpi({ label: 'Leads I own', value: put('l', 'My open leads', mine.filter((l) => !l.is_deal)), sub: 'Open' })}
        ${kpi({ label: 'Deals I own', value: put('d', 'My open deals', deals), sub: inr(sum(deals, (l) => l.value)) + ' open' })}
        ${kpi({ label: 'Visits done', value: nfmt(s.visits), sub: r.label })}
        ${kpi({ label: 'Open tasks', value: nfmt(tasks.length), sub: `${tasks.filter((t) => taskTone(t) === 'bad').length} overdue` })}
      </div>
      ${taskOverview(DB.t.work_tasks.filter((t) => t.owner === DB.me.id || subOwners(t.id).has(DB.me.id)), { title: 'My tasks' })}
      <div class="grid">
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag red">Follow-ups</span> Overdue and today</h2><span class="sub">${over.length} overdue · ${todayF.length} today</span></div>
          ${over.length || todayF.length ? leadRows([...over, ...todayF].slice(0, 12), { showOwner: false }) : '<p class="faint">You are up to date. Nothing overdue and nothing left for today.</p>'}</section>

      </div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag teal">Visits</span> Next and missed</h2><a class="sub" href="#visits">Field Visits →</a></div>
          ${vMiss.length ? `<div class="note bad" style="margin-bottom:8px">${vMiss.length} planned visit${vMiss.length === 1 ? ' was' : 's were'} not checked in. Check in, add the outcome or reschedule.</div>` : ''}
          ${vMiss.length + vNext.length ? `<ul class="mini vlist">${[...vMiss, ...vNext].slice(0, 8).map((x) => `<li class="${vMiss.includes(x) ? 'tone-bad' : ''}"><span class="grow"><b>${esc(x.purpose || 'Visit')}</b><span class="s">${esc(typeof visitLink === 'function' ? visitLink(x) : '')}</span></span><span class="faint">${fmtDT(x.planned_at)}</span></li>`).join('')}</ul>` : '<p class="faint">No visits planned.</p>'}</section>
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag blue">Deals</span> My deals by closure date</h2></div>
          ${deals.length ? `<ul class="dlist">${deals.slice(0, 8).map((l) => `<li><button data-lead="${l.id}"><span class="grow"><b>${esc(L.title(l))}</b><span class="s">${esc(l.funnel)} · ${esc(l.stage)} · ${L.prob(l)}%</span></span><span class="r"><b>${inr(l.value)}</b><span class="chip tone ${!l.expected_close ? 'warn' : l.expected_close < todayStr() ? 'bad' : stageTone(l)}">${l.expected_close ? fmtDate(l.expected_close) : 'No date'}</span></span></button></li>`).join('')}</ul>` : '<p class="faint">No open deals yet.</p>'}</section>
      </div>
      ${s.kra ? `<section class="glass panel"><div class="panel-head"><h2><span class="gtag violet">KRA</span> My KRA</h2><span class="sub">${r.label}</span></div>${kraTable(s.kra)}</section>` : ''}`;
    bindFilters(el, () => this.render(el)); bindDrills(el, D); bindLeadClicks(el); bindTaskCards(el, () => this.render(el)); bindTaskOverview(el, () => this.render(el));
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const [v0, a] = b.dataset.go.split('/'); go(v0, a); }));
    loadWeather(el.querySelector('#wx'));
  },
};

/* ================= lead transfer: the enquiry belongs to another team ================= */
function transferModal(l, after) {
  const teams = DEPTS().filter((d) => d.code !== l.funnel);
  const inTeam = (code) => (DB.t.profiles || []).filter((p) => p.active && isSales(p) && (p.departments || []).includes(code)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const m = openModal({ title: `Transfer · ${esc(L.title(l))}`, width: 560,
    body: `<p class="faint" style="margin-top:0">Now with <b>${esc(dept(l.funnel).name)}</b>. The record moves to the new team, starts at its first lead status, and the history stays with it.</p>
      <div class="form">${fld('xd', 'Transfer to team', `<select id="xd">${teams.map((d) => `<option value="${esc(d.code)}">${esc(d.code)} · ${esc(d.name)}</option>`).join('')}</select>`, 'full')}
      ${fld('xo', 'Give it to', '<select id="xo"></select>', 'full')}
      ${fld('xr', 'Why', `<input id="xr" placeholder="e.g. Asked about a UAV lab for their college, not a pilot course">`, 'full')}</div>`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="xgo">Transfer</button>' });
  const fill = () => { const c = v(m.el, 'xd'); m.el.querySelector('#xo').innerHTML = `<option value="">The team's next person in turn (round robin)</option>${inTeam(c).map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}${DB.me ? `<option value="${DB.me.id}">Keep it with me</option>` : ''}`; };
  m.el.querySelector('#xd').onchange = fill; fill();
  m.el.querySelector('#xgo').onclick = () => guard(async () => {
    const to = v(m.el, 'xd'); if (!to) throw new Error('Choose the team.');
    const who = await DB.call('transfer_lead', { p_lead: l.id, p_dept: to, p_owner: v(m.el, 'xo') || null, p_reason: v(m.el, 'xr') || '' }, ['leads', 'remarks']);
    m.close(); toast(`Moved to ${to}${who ? ' · ' + DB.pname(who) : ''}`); after?.();
  });
}

/* ================= reminders: visits, meetings, follow-ups, tasks, escalations; missed ones keep coming back ================= */
const RM = {
  key: () => 'garuda-alerts-' + (DB.me?.id || ''),
  load() { try { return JSON.parse(localStorage.getItem(RM.key()) || '{}'); } catch (_) { return {}; } },
  save(x) { try { localStorage.setItem(RM.key(), JSON.stringify(x)); } catch (_) { /* private mode */ } },
  pinged: new Map(),
};
function alertsList() {
  if (!DB.me) return [];
  const me = DB.me.id; const now = Date.now(); const today = todayStr(); const out = [];
  const add = (id, tone, ic, title, sub, to, at, due) => out.push({ id, tone, ic, title, sub, to, at, due });
  DB.t.visits.filter((x) => x.owner === me && ['Planned', 'Rescheduled'].includes(x.status || 'Planned') && x.planned_at).forEach((x) => {
    const t = new Date(x.planned_at).getTime(); const what = esc(x.purpose || 'Visit'); const where = esc(typeof visitLink === 'function' ? visitLink(x) : '');
    if (t < now - 30 * 6e4) add('v' + x.id + x.planned_at, 'bad', 'pin', `Missed visit? ${what}`, `${where} · was ${fmtDT(x.planned_at)}. Check in, add the outcome or reschedule.`, 'visits/overdue', x.planned_at, true);
    else if (t - now <= 60 * 6e4) add('v' + x.id + x.planned_at, 'warn', 'pin', `Visit ${t < now ? 'now' : 'in ' + Math.max(1, Math.round((t - now) / 6e4)) + ' min'}: ${what}`, where, 'visits/today', x.planned_at, true);
    else if (localDate(x.planned_at) === today) add('v' + x.id + x.planned_at, 'info', 'pin', `Visit today: ${what}`, `${where} · ${fmtDT(x.planned_at)}`, 'visits/today', x.planned_at, false);
  });
  visibleLeads().filter((l) => l.owner === me && L.open(l) && l.next_followup_at).forEach((l) => {
    const t = new Date(l.next_followup_at).getTime(); if (l.last_contact_at && new Date(l.last_contact_at).getTime() >= t) return;
    const what = /meet/i.test(l.latest_remark || '') ? 'Meeting' : 'Follow-up';
    if (t < now) { if (now - t < 14 * 864e5) add('f' + l.id + l.next_followup_at, 'bad', 'clock', `${what} missed: ${esc(l.name)}`, `Was due ${rel(l.next_followup_at)}. Call now or set a new date.`, 'lead:' + l.id, l.next_followup_at, true); }
    else if (t - now <= 30 * 6e4) add('f' + l.id + l.next_followup_at, 'warn', 'clock', `${what} in ${Math.max(1, Math.round((t - now) / 6e4))} min: ${esc(l.name)}`, esc(L.company(l) || l.funnel), 'lead:' + l.id, l.next_followup_at, true);
    else if (localDate(l.next_followup_at) === today) add('f' + l.id + l.next_followup_at, 'info', 'clock', `${what} today: ${esc(l.name)}`, fmtDT(l.next_followup_at), 'lead:' + l.id, l.next_followup_at, false);
  });
  DB.t.work_tasks.filter((t) => t.owner === me && taskOpen(t) && t.due_date && t.due_date <= today).forEach((t) => {
    add('t' + t.id + t.due_date, t.due_date < today ? 'bad' : 'warn', 'task', `${t.due_date < today ? 'Task overdue' : 'Task due today'}: ${esc(t.title)}`, `${taskPct(t)}% done${t.created_by && t.created_by !== me ? ' · from ' + esc(DB.pname(t.created_by)) : ''}`, 'tasks/' + (t.due_date < today ? 'overdue' : 'open'), t.due_date + 'T09:00:00', t.due_date < today);
  });
  DB.t.complaints.filter((c) => c.owner === me && ESC_OPEN.includes(c.status) && c.due_at && new Date(c.due_at) < now).forEach((c) => add('e' + c.id + c.due_at, 'bad', 'warn', `Escalation past its deadline: ${esc(c.title || c.subject || 'Escalation')}`, `Due ${rel(c.due_at)}`, 'escalations/late', c.due_at, true));
  DB.t.project_items.filter((i) => i.owner === me && i.kind !== 'payment' && !['Done', 'Cancelled'].includes(i.status) && i.due_date && i.due_date < today).forEach((i) => add('p' + i.id + i.due_date, 'warn', 'proj', `Milestone overdue: ${esc(i.name)}`, esc(DB.get('projects', i.project_id)?.name || ''), 'projects/overdue', i.due_date + 'T09:00:00', false));
  /* managers: missed visits in their team for more than a day */
  if (hasTeam()) { const s = scopeIds(); const late = DB.t.visits.filter((x) => x.owner !== me && s.has(x.owner) && ['Planned', 'Rescheduled'].includes(x.status || 'Planned') && x.planned_at && now - new Date(x.planned_at) > 864e5); if (late.length) add('tv' + late.length + today, 'warn', 'team', `${late.length} visit${late.length === 1 ? '' : 's'} in your team not checked in`, [...new Set(late.map((x) => DB.pname(x.owner).split(' ')[0]))].slice(0, 4).join(', '), 'visits/overdue', today + 'T09:00:00', false); }
  const un = typeof chatUnread === 'function' ? chatUnread() : 0;
  if (un) add('c' + un + (DB.t.chat_messages.at(-1)?.id || ''), 'info', 'chat', `${un} unread message${un === 1 ? '' : 's'} in Garuda Chat`, '', 'chat', nowISO(), false);
  const st = RM.load();
  return out.filter((a) => !(st[a.id] && st[a.id] > now)).sort((a, b) => ({ bad: 0, warn: 1, info: 2 })[a.tone] - ({ bad: 0, warn: 1, info: 2 })[b.tone] || String(a.at).localeCompare(String(b.at)));
}
function bellHTML() { const n = alertsList().filter((a) => a.tone !== 'info').length; return `<div class="bellwrap"><button class="btn bell ${n ? 'on' : ''}" id="bell" aria-label="Reminders${n ? ', ' + n + ' need action' : ''}" aria-haspopup="dialog">${svg('bell')}${n ? `<span class="badge alarm">${n}</span>` : ''}</button><div class="bellpop glass" id="bellpop" hidden></div></div>`; }
function refreshBell() { const w = $('.bellwrap'); if (!w || !$('#bellpop').hidden) return; w.outerHTML = bellHTML(); bindBell(); }
function openAlert(to) { if (to.startsWith('lead:')) openLead(to.slice(5)); else { const [v0, a] = to.split('/'); go(v0, a); } }
function bindBell() {
  const b = $('#bell'); if (!b) return; const pop = $('#bellpop');
  const draw = () => {
    const xs = alertsList(); const perm = 'Notification' in window ? window.Notification.permission : 'denied';
    pop.innerHTML = `<div class="row between"><b>Reminders</b><span class="faint">${xs.length ? xs.length + ' open' : 'All clear'}</span></div>
      ${xs.length ? `<ul class="alerts">${xs.slice(0, 25).map((a) => `<li class="tone-${a.tone}"><span class="ai ${a.tone}">${svg(a.ic)}</span><div class="grow"><button class="lnk at" data-ao="${esc(a.to)}">${a.title}</button>${a.sub ? `<span class="s">${a.sub}</span>` : ''}<span class="row"><button class="btn ghost small" data-snz="${esc(a.id)}">Snooze 1 h</button><button class="btn ghost small" data-dis="${esc(a.id)}">Dismiss</button></span></div></li>`).join('')}</ul>` : '<p class="faint">Nothing due. Visits, meetings, follow-ups and tasks show here when they are due or missed.</p>'}
      ${perm === 'default' ? '<button class="btn small" id="npm">Also alert me on this computer</button>' : ''}`;
    pop.querySelectorAll('[data-ao]').forEach((x) => (x.onclick = () => { pop.hidden = true; openAlert(x.dataset.ao); }));
    const later = (id, ms) => { const st = RM.load(); st[id] = Date.now() + ms; Object.keys(st).forEach((k) => { if (st[k] < Date.now()) delete st[k]; }); RM.save(st); draw(); };
    pop.querySelectorAll('[data-snz]').forEach((x) => (x.onclick = (e) => { e.stopPropagation(); later(x.dataset.snz, 36e5); }));
    pop.querySelectorAll('[data-dis]').forEach((x) => (x.onclick = (e) => { e.stopPropagation(); later(x.dataset.dis, 30 * 864e5); }));
    pop.querySelector('#npm')?.addEventListener('click', (e) => { e.stopPropagation(); window.Notification.requestPermission().then(draw); });
  };
  b.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) draw(); else refreshBell(); };
  pop.onclick = (e) => e.stopPropagation();
}
document.addEventListener('click', () => { const p = document.getElementById('bellpop'); if (p && !p.hidden) { p.hidden = true; refreshBell(); } });
/* every minute: pop up what just fell due; missed items come back every 30 minutes until someone acts or snoozes */
function remindTick() {
  if (!DB.me) return;
  const xs = alertsList().filter((a) => a.due); let shown = 0;
  for (const a of xs) {
    const last = RM.pinged.get(a.id) || 0; if (Date.now() - last < 30 * 6e4 || shown >= 2) continue;
    RM.pinged.set(a.id, Date.now()); shown++;
    alertToast(a); if (shown === 1) chime('alert');
    try { if ('Notification' in window && window.Notification.permission === 'granted' && document.hidden) { const n = new window.Notification('Garuda CRM · ' + a.title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'), { body: (a.sub || '').replace(/<[^>]+>/g, ''), tag: a.id }); n.onclick = () => { window.focus(); openAlert(a.to); }; } } catch (_) { /* not allowed here */ }
  }
  refreshBell();
}
function alertToast(a) {
  let box = $('#alerts'); if (!box) { box = document.createElement('div'); box.id = 'alerts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = `atoast glass tone-${a.tone}`;
  t.innerHTML = `<span class="ai ${a.tone}">${svg(a.ic)}</span><div class="grow"><b>${a.title}</b>${a.sub ? `<span class="s">${a.sub}</span>` : ''}<span class="row"><button class="btn small primary" data-x="open">Open</button><button class="btn small" data-x="snooze">Snooze 1 h</button></span></div><button class="btn ghost small" data-x="close" aria-label="Close">${svg('x')}</button>`;
  t.querySelector('[data-x="open"]').onclick = () => { t.remove(); openAlert(a.to); };
  t.querySelector('[data-x="snooze"]').onclick = () => { const st = RM.load(); st[a.id] = Date.now() + 36e5; RM.save(st); t.remove(); refreshBell(); };
  t.querySelector('[data-x="close"]').onclick = () => t.remove();
  box.appendChild(t); setTimeout(() => t.remove(), 20000);
}
let remindTimer = null;
function startReminders() { clearInterval(remindTimer); setTimeout(remindTick, 4000); remindTimer = setInterval(remindTick, 60000); }
