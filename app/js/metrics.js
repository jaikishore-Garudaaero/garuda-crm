/* Garuda CRM · metrics engine (all money ex-GST unless stated). Every number starts from records in my scope. */
'use strict';

const M = {
  /* ---------- periods ---------- */
  range(key, from, to) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const end = new Date(d); end.setDate(end.getDate() + 1);
    if (key === 'today') return { key, from: d, to: end, label: 'Today' };
    if (key === 'week') { const s = new Date(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return { key, from: s, to: end, label: 'This week' }; }
    if (key === 'month') { const s = new Date(d.getFullYear(), d.getMonth(), 1); return { key, from: s, to: end, label: 'This month' }; }
    if (key === 'quarter') { const q = Math.floor(d.getMonth() / 3) * 3; return { key, from: new Date(d.getFullYear(), q, 1), to: end, label: 'This quarter' }; }
    if (key === 'fy') { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return { key, from: new Date(y, 3, 1), to: end, label: `FY ${y}-${String(y + 1).slice(2)}` }; }
    if (key === 'custom' && from && to) { const e = new Date(to); e.setDate(e.getDate() + 1); return { key, from: new Date(from), to: e, label: `${fmtDate(from)} – ${fmtDate(to)}` }; }
    return this.range('month');
  },
  inR(iso, r) { if (!iso) return false; const t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).getTime(); return t >= r.from.getTime() && t < r.to.getTime(); },
  /* months covered by a range, oldest first (at least the last 6 for short periods) */
  months(r) {
    const e = new Date(Math.min(r.to.getTime() - 1, Date.now())); const last = new Date(e.getFullYear(), e.getMonth(), 1);
    let s = new Date(r.from.getFullYear(), r.from.getMonth(), 1);
    const six = new Date(last.getFullYear(), last.getMonth() - 5, 1); if (s > six) s = six;
    const out = []; for (let d = new Date(s); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(localDate(d).slice(0, 7));
    return out;
  },

  /* ---------- the shared filter bar: department, period, person ---------- */
  f() { return { dept: ST.dept, person: ST.person, r: curRange() }; },
  deptOk: (code) => ST.dept === 'All' || code === ST.dept,
  personOk: (pid) => ST.person === 'all' || pid === ST.person,
  prodOk: (l) => !ST.prod || ST.dept === 'All' || L.line(l) === ST.prod,
  leads() { return visibleLeads().filter((l) => this.deptOk(l.funnel) && this.personOk(l.owner) && this.prodOk(l)); },

  /* the people a dashboard lists: my tree (everyone for C-level / Admin), sales staff only */
  people() { const owns = new Set(visibleLeads().map((l) => l.owner)); return scopePeople().filter((p) => isSales(p) && inDept(p, ST.dept) && (p.role !== 'clevel' || owns.has(p.id)) && (ST.person === 'all' || p.id === ST.person)); },

  /* ---------- activity from remarks ---------- */
  calls(pid, r, deptCode = ST.dept) {
    const leadDept = (id) => DB.get('leads', id)?.funnel;
    const rem = DB.t.remarks.filter((x) => x.author === pid && this.inR(x.created_at, r) && (deptCode === 'All' || leadDept(x.lead_id) === deptCode));
    const calls = rem.filter((x) => CALL_CH(x.channel));
    const connects = calls.filter((x) => CONNECTED(x.outcome)).length;
    return { calls: calls.length, connects, rate: pct(connects, calls.length), remarks: rem };
  },
  /* follow-ups that fell due in the period: on time = contacted on or before the due time */
  followups(pid, r, deptCode = ST.dept) {
    const now = new Date();
    const due = visibleLeads().filter((l) => l.owner === pid && (deptCode === 'All' || l.funnel === deptCode) && l.next_followup_at && this.inR(l.next_followup_at, { from: r.from, to: new Date(Math.min(r.to, now)) }));
    const late = due.filter((l) => !l.last_contact_at || new Date(l.last_contact_at) < new Date(l.next_followup_at));
    return { due: due.length, onTime: due.length - late.length, pct: due.length ? pct(due.length - late.length, due.length) : null, late };
  },
  firstResponseH(pid, r, deptCode = ST.dept) {
    const xs = visibleLeads().filter((l) => l.owner === pid && !l.imported && (deptCode === 'All' || l.funnel === deptCode) && this.inR(l.created_at, r) && l.first_contact_at)
      .map((l) => (new Date(l.first_contact_at) - new Date(l.created_at)) / 36e5).filter((h) => h >= 0).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  },
  workingDays(r) { let n = 0; for (let d = new Date(r.from); d < r.to && d <= new Date(); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++; return Math.max(n, 1); },

  /* one row of the Team Dashboard */
  person(pid, r, deptCode = ST.dept) {
    const mine = visibleLeads().filter((l) => l.owner === pid && (deptCode === 'All' || l.funnel === deptCode));
    const c = this.calls(pid, r, deptCode); const fu = this.followups(pid, r, deptCode);
    const won = mine.filter((l) => L.won(l) && this.inR(l.won_at, r));
    const visits = DB.t.visits.filter((x) => x.owner === pid && x.status === 'Done' && this.inR(x.checkin_at || x.planned_at, r) && this.visitDeptOk(x, deptCode));
    const out = { pid, calls: c.calls, connects: c.connects, connectRate: c.rate, followPct: fu.pct, followDue: fu.due, frt: this.firstResponseH(pid, r, deptCode),
      leads: mine.filter((l) => !l.is_deal && L.open(l)).length, deals: mine.filter(L.inPipe).length, conversions: won.length, wonValue: sum(won, (l) => l.value), visits: visits.length,
      rows: { leads: mine.filter((l) => !l.is_deal && L.open(l)), deals: mine.filter(L.inPipe), won, late: fu.late } };
    out.kra = this.kra(pid, r, out);
    return out;
  },
  visitDeptOk(x, deptCode = ST.dept) {
    if (deptCode === 'All') return true;
    const l = x.lead_id && DB.get('leads', x.lead_id); if (l) return l.funnel === deptCode;
    return true;
  },

  /* ---------- KRA (weights in Settings → Targets & KRA) ---------- */
  kra(pid, r, row) {
    const p = DB.profile(pid); if (!p) return null;
    const conf = DB.settings.kra_v4 || {}; const t = DB.settings.kpi_targets || {};
    const team = scopeIds(pid).size > 1;
    const weights = (team ? conf.team : conf.member) || []; if (!weights.length) return null;
    const days = (Math.min(r.to, Date.now()) - r.from) / 864e5; const f = clamp(days / 30, 0.03, 12);
    let vals;
    if (team) {
      const ids = scopeIds(pid);
      const ls = visibleLeads().filter((l) => ids.has(l.owner));
      const col = sum(DB.t.payments.filter((x) => x.status === 'Verified' && this.inR(x.paid_on, r) && ids.has(DB.get('leads', x.lead_id)?.owner)), (x) => x.amount_ex);
      const built = ls.filter((l) => l.is_deal && this.inR(L.dealAt(l), r));
      const fus = [...ids].map((i) => this.followups(i, r, 'All')); const due = sum(fus, (x) => x.due), on = sum(fus, (x) => x.onTime);
      const callers = [...ids].filter((i) => isSales(DB.profile(i)));
      const callPct = callers.length ? Math.min(100, pct(sum(callers, (i) => this.calls(i, r, 'All').calls), (DB.settings.kpi?.calls_per_day || 50) * this.workingDays(r) * callers.length)) : 0;
      vals = { team_revenue: col, team_closures: ls.filter((l) => L.won(l) && this.inR(l.won_at, r)).length, team_pipeline: sum(built, (l) => l.value), team_tasks: due ? pct(on, due) : 100, team_discipline: callPct };
    } else {
      const pipe = visibleLeads().filter((l) => l.owner === pid && L.open(l));
      const fresh = pipe.filter((l) => daysAgo(L.updated(l)) <= (Number(DB.settings.stale_deal_days) || 7)).length;
      vals = { calls: row.calls, followups: row.followPct ?? 100, conversions: row.conversions, visits: row.visits, crm: pipe.length ? pct(fresh, pipe.length) : 100 };
    }
    const PCT = ['crm', 'followups', 'team_tasks', 'team_discipline'];
    const rows = weights.map(([label, w, key]) => {
      const isPct = PCT.includes(key);
      const base = t[key] ?? (key === 'conversions' ? t.closures : undefined) ?? 1;
      const target = isPct ? base : Math.max(1, Math.round(base * f));
      const value = vals[key] ?? 0; const att = target ? clamp(value / target, 0, 1.2) : 0;
      return { label, weight: w, key, value, target, isPct, points: Math.min(att, 1) * w };
    });
    return { rows, score: Math.round(sum(rows, (x) => x.points)), team };
  },

  /* ---------- revenue (Reports → Revenue) ---------- */
  /* receivables: won deals not fully collected + project payment milestones not yet collected */
  receivables(deptCode) {
    const ls = visibleLeads().filter((l) => (!deptCode || deptCode === 'All' || l.funnel === deptCode) && L.due(l) > 0.5);
    const items = DB.t.project_items.filter((i) => i.kind === 'payment' && ['Open', 'Invoiced'].includes(i.status) && Number(i.amount) > 0)
      .filter((i) => { const p = DB.get('projects', i.project_id); return p && (!deptCode || deptCode === 'All' || p.dept === deptCode); });
    return { leads: ls, items, amount: sum(ls, L.due) };
  },
};
