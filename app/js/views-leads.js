/* Garuda CRM · Leads & Deals (list, Kanban, call mode), the record panel, pricing */
'use strict';

/* ================= price panel ================= */
function pricePanel(product, qty, discount, unitOverride) {
  if (!product) return `<div class="note info">Choose a product to see its price.</div>`;
  const list = Number(product.price) || 0;
  const tier = priceFor(product, qty);
  const unit = unitOverride != null && unitOverride !== '' ? Number(unitOverride) : tier;
  const ex = qty * unit * (1 - (discount || 0) / 100);
  const gst = (ex * Number(product.gst_rate)) / 100;
  const items = DB.t.product_items.filter((i) => i.product_id === product.id).sort((a, b) => a.sort - b.sort);
  return `<div class="pricebox">
      <div><small>List price / ${esc(product.unit)}</small><b>${list ? inrFull(list) : 'On request'}</b></div>
      <div><small>Applied unit price${tier !== list ? ' (bulk)' : ''}</small><b>${unit ? inrFull(unit) : '—'}</b></div>
      <div><small>Value ex-GST${discount ? ` (−${discount}%)` : ''}</small><b>${inrFull(ex)}</b></div>
      <div><small>Total incl. GST ${(+product.gst_rate).toFixed(product.gst_rate % 1 ? 2 : 0)}%</small><b>${inrFull(ex + gst)}</b></div>
    </div>
    <div class="row" style="font-size:12px;color:var(--ink2)">${product.tier25 ? `<span class="chip">25+: ${inrFull(product.tier25)}</span>` : ''}${product.tier50 ? `<span class="chip">50+: ${inrFull(product.tier50)}</span>` : ''}${product.duration ? `<span class="chip">${esc(product.duration)}</span>` : ''}${product.share_pct < 100 ? `<span class="chip warn">Garuda share ${product.share_pct}%</span>` : ''}<span class="chip">Your discount limit ${discountLimit()}%</span>${product.notes ? `<span>${esc(product.notes)}</span>` : ''}</div>
    ${items.length ? `<details><summary class="faint" style="cursor:pointer;font-size:12.5px">${items.length} line items in this package</summary><div class="tablewrap"><table><tbody>${items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td><td class="n">${inrFull(i.unit_price)}</td><td class="n">${i.gst_rate}%</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
}
const productOptions = (funnel, sel) => {
  const g = groupBy(DB.t.products.filter((p) => p.active && (!funnel || p.funnel === funnel)).sort((a, b) => a.sort - b.sort), (p) => p.category);
  return `<option value="">Choose…</option>` + Object.entries(g).map(([c, ps]) => `<optgroup label="${esc(c)}">${ps.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.price ? ' · ' + inr(p.price) : ''}</option>`).join('')}</optgroup>`).join('');
};

/* ================= Leads & Deals: one record, two tabs, list or Kanban ================= */
const QUICK = {
  overdue: ['Follow-ups overdue', (l) => L.open(l) && l.next_followup_at && new Date(l.next_followup_at) < new Date() && (!l.last_contact_at || new Date(l.last_contact_at) < new Date(l.next_followup_at)), null],
  nc: ['Not contacted in time', (l) => L.open(l) && !l.is_deal && !l.first_contact_at && !l.call_attempts && (Date.now() - new Date(l.created_at)) / 36e5 > (Number(DB.settings.first_contact_hours) || 48), 'leads'],
  pastclose: ['Past closure date', (l) => L.inPipe(l) && l.expected_close && l.expected_close < todayStr(), 'deals'],
  stale: ['No update lately', (l) => L.inPipe(l) && daysAgo(L.updated(l)) >= (Number(DB.settings.stale_deal_days) || 7), 'deals'],
  hot: ['Hot, follow-up due', (l) => L.open(l) && (l.temperature === 'Hot' || l.ai_band === 'Hot') && l.next_followup_at && l.next_followup_at.slice(0, 10) <= todayStr(), null],
  closing: ['Closing in 14 days', (l) => L.inPipe(l) && l.expected_close && l.expected_close >= todayStr() && daysAgo(l.expected_close) >= -14, 'deals'],
  hotwarm: ['Hot and warm (P1, P2)', (l) => L.open(l) && /^P[12]/.test(l.campaign_tier || ''), null],
  inherited: ['Handed over from old staff', (l) => l.inherited, null],
  inh_new: ['Handed over, not worked yet', (l) => l.inherited && !l.touched_at && L.open(l), null],
  inh_done: ['Handed over, worked since', (l) => l.inherited && !!l.touched_at, null],
  otherdept: ['Other department enquiries', (l) => !!l.routed_dept && !/^RPTO/.test(l.routed_dept), null],
  nofee: ['Called, fee not recorded', (l) => L.open(l) && !l.is_deal && l.last_contact_at && daysAgo(l.last_contact_at) <= 30 && !l.fee_disclosed && S.list(l.funnel, 'deal').some((s) => s.needs_fee), 'leads'],
};
const LF = { q: '', state: 'open', quick: '', sort: '', dir: -1, per: 20, page: 1, col: {}, tab: '', f: {}, fOpen: false, view: '' };
/* lead-generation filters: what a head of lead generation slices a calling list by */
const daysSince = (d) => (d ? (Date.now() - new Date(d)) / 864e5 : Infinity);
const tierKey = (t) => String(t || '').slice(0, 2);
const LFILT = {
  tier: (l, v) => v.includes(tierKey(l.campaign_tier) || '—'),
  temp: (l, v) => v.includes(l.temperature || l.ai_band || '—'),
  stage: (l, v) => v.includes(l.stage),
  owner: (l, v) => v.includes(L.ownerLabel(l)),
  funnel: (l, v) => v.includes(l.funnel),
  prod: (l, v) => v.includes(L.line(l) || '—'),
  source: (l, v) => v.includes(l.source || '—'),
  city: (l, v) => v.includes(l.city || '—'),
  enq: (l, v) => { const d = daysSince(l.enquiry_date || l.created_at); return v === '7' ? d <= 7 : v === '30' ? d <= 30 : v === '90' ? d <= 90 : v === 'fy' ? M.inR(l.enquiry_date || l.created_at, TG.per('fy')) : v === 'old' ? d > 180 : true; },
  fu: (l, v) => { const n = l.next_followup_at; const t = n ? localDate(n) : ''; const today = todayStr(); return v === 'over' ? n && new Date(n) < new Date() : v === 'today' ? t === today : v === 'week' ? n && t >= today && daysSince(n) >= -7 : v === 'none' ? !n : true; },
  att: (l, v) => { const a = Number(l.call_attempts) || 0; return v === '0' ? !a : v === '1' ? a >= 1 && a <= 2 : v === '3' ? a >= 3 && a <= 5 : v === '6' ? a >= 6 : true; },
  lc: (l, v) => { const d = daysSince(l.last_contact_at); return v === 'never' ? !l.last_contact_at : v === '7' ? d > 7 : v === '30' ? d > 30 : v === 'recent' ? d <= 7 : true; },
  inh: (l, v) => (v === 'yes' ? l.inherited : v === 'new' ? l.inherited && !l.touched_at : v === 'worked' ? l.inherited && !!l.touched_at : v === 'no' ? !l.inherited : true),
  contact: (l, v) => (v === 'email' ? !!l.email : v === 'phone' ? !!l.phone : v === 'both' ? !!l.email && !!l.phone : v === 'none' ? !l.email && !l.phone : true),
  elig: (l, v) => (l.eligible || 'Unknown') === v,
  score: (l, v) => { const sc = Number(l.priority_score ?? l.ai_score ?? -1); return v === '8' ? sc >= 8 : v === '5' ? sc >= 5 : v === 'low' ? sc >= 0 && sc < 5 : true; },
  lang: (l, v) => v.includes(l.language || '—'),
};
const lfOn = () => Object.entries(LF.f).filter(([, v]) => (Array.isArray(v) ? v.length : v));
const lfOk = (l) => lfOn().every(([k, v]) => !LFILT[k] || LFILT[k](l, v));
/* one-click views a calling team works from */
const LVIEWS = [
  ['callnow', 'Call now · P1 hot', { tier: ['P1'] }, 'flame'],
  ['warm7', 'Warm (P2), quiet 7+ days', { tier: ['P2'], lc: '7' }, 'clock'],
  ['never', 'Never reached', { att: '0' }, 'phone'],
  ['retry', 'Retry unreachable (P4)', { tier: ['P4'] }, 'phone'],
  ['winback', 'Win-back (R1)', { tier: ['R1'] }, 'up'],
  ['over', 'Follow-up overdue', { fu: 'over' }, 'warn'],
  ['today', 'Follow-up today', { fu: 'today' }, 'cal'],
  ['hot8', 'Priority score 8+', { score: '8' }, 'spark'],
  ['handed', 'Handed over, untouched', { inh: 'new' }, 'swap'],
  ['fresh', 'New in 7 days', { enq: '7' }, 'plus'],
];
try { const pp = Number(localStorage.getItem('garuda-ld-per')); if ([20, 50, 100].includes(pp)) LF.per = pp; } catch (_) { /* no storage */ }
/* a follow-up is an open lead in a follow-up status: it lives in Follow-ups, not in Leads */
const isFU = (l) => !l.is_deal && L.open(l) && /follow/i.test(l.stage || '');
const LCOLS = {
  leads: [['company', 'Organisation'], ['name', 'Lead name'], ['stage', 'Status'], ['phone', 'Phone'], ['email', 'Email'], ['owner', 'Assigned to'], ['date', 'Lead date'], ['remark', 'Remarks']],
  followups: [['company', 'Organisation'], ['name', 'Lead name'], ['stage', 'Status'], ['next', 'Next follow-up'], ['phone', 'Phone'], ['owner', 'Assigned to'], ['date', 'Lead date'], ['remark', 'Latest remark']],
  deals: [['company', 'Company'], ['stage', 'Status'], ['email', 'Email'], ['phone', 'Phone'], ['owner', 'Assigned to'], ['value', 'Value'], ['close', 'Closure date'], ['remark', 'Remarks']],
};
const cellVal = (l, k) => ({ name: l.name, company: L.company(l) || (l.is_deal ? l.name : ''), stage: l.stage, email: l.email || '', phone: l.phone || '', owner: L.ownerLabel(l), date: (l.enquiry_date || l.created_at || '').slice(0, 10), remark: L.latestRemark(l) || '', value: Number(l.value) || 0, close: l.expected_close || '', next: l.next_followup_at || '' })[k];
function ldRows(tab) {
  const deal = tab === 'deals'; const fu = tab === 'followups';
  const q = LF.quick && QUICK[LF.quick];
  return M.leads().filter((l) => {
    if (!!l.is_deal !== deal) return false;
    if (fu && !isFU(l)) return false;
    if (!lfOk(l)) return false;
    if (tab === 'leads' && !q && LF.state === 'open' && isFU(l)) return false;
    if (q && !q[1](l)) return false;
    if (!q) { if (LF.state === 'open' && !L.open(l)) return false; if (LF.state === 'won' && !L.won(l)) return false; if (LF.state === 'lost' && !L.lost(l)) return false; if (LF.state === 'closed' && !L.closed(l)) return false; }
    if (LF.q) { const s = LF.q.toLowerCase(); if (![l.name, l.phone, l.email, l.lead_no, l.ref_id, l.contact_name, L.company(l), l.city, l.owner_name].some((x) => (x || '').toLowerCase().includes(s))) return false; }
    for (const [k, fv] of Object.entries(LF.col)) { if (!fv) continue; const x = String(cellVal(l, k) ?? '').toLowerCase(); if (k === 'stage' || k === 'owner' || k === 'company' ? x !== fv.toLowerCase() : !x.includes(fv.toLowerCase())) return false; }
    return true;
  });
}
VIEWS.leads = {
  title: () => (ST.view === 'deals' ? 'Deals' : ST.view === 'followups' ? 'Follow-ups' : 'Leads'),
  sub: () => (ST.view === 'deals' ? 'Open deals with a value and a closure date, through to won or lost.' : ST.view === 'followups' ? 'Leads in a follow-up status, the next call first. Overdue ones are marked red.' : 'Every new enquiry until it becomes a follow-up or a deal. Convert a lead to a deal when there is a value and a closure date.'),
  actions: () => `${hideSales() ? '' : `<button class="btn" id="r33btn" title="Every lead in the 33-point format, RPTO / CoE tabs">${svg('download')} 33-point report</button><button class="btn" id="callmode">${svg('phone')} Call mode</button>${ST.view === 'deals' ? '' : `<button class="btn primary" id="newlead">${svg('plus')} New lead</button>`}`}`,
  render(el) {
    const tab = ST.view === 'deals' ? 'deals' : ST.view === 'followups' ? 'followups' : 'leads';
    if (ST.arg) { const a = ST.arg; ST.arg = null; if (QUICK[a]) { LF.quick = a; if (QUICK[a][2] && QUICK[a][2] !== tab) return go(QUICK[a][2], a); } }
    if (LF.quick && QUICK[LF.quick][2] && QUICK[LF.quick][2] !== tab) LF.quick = '';
    if (LF.tab !== tab) { LF.col = {}; LF.sort = ''; LF.tab = tab; LF.page = 1; if (tab === 'followups') LF.state = 'open'; }
    const mode = tab === 'followups' ? 'list' : ST.ldMode[tab] || 'list';
    const all = M.leads(); const n = tab === 'deals' ? all.filter(L.inPipe) : tab === 'followups' ? all.filter(isFU) : all.filter((l) => !l.is_deal && L.open(l) && !isFU(l));
    const late = tab === 'followups' ? n.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < new Date()).length : 0;
    const wt = tab === 'deals' ? ` · ${inr(sum(n, (l) => l.value))} open · weighted ${inr(sum(n, (l) => (l.value * L.prob(l)) / 100))}` : '';
    el.innerHTML = `${filterBar({ period: false })}
      <section class="glass panel">
        <div class="row between ldhead">
          <div class="ldcount"><b>${nfmt(n.length)}</b> <span class="faint">open ${tab === 'followups' ? 'follow-ups' : tab}${wt}${late ? ` · <span class="bad">${nfmt(late)} overdue</span>` : ''}</span></div>
          ${tab === 'followups' ? '' : `<div class="seg" role="group" aria-label="View"><button data-mode="list" aria-pressed="${mode === 'list'}">${svg('list')} List</button><button data-mode="kanban" aria-pressed="${mode === 'kanban'}">${svg('board')} Kanban</button></div>`}
        </div>
        <div id="ldbody"></div></section>`;
    el.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { ST.ldMode = { ...ST.ldMode, [tab]: b.dataset.mode }; saveUI(); this.render(el); }));
    bindFilters(el, () => this.render(el));
    const body = el.querySelector('#ldbody');
    if (mode === 'kanban') kanban(body, tab, () => this.render(el)); else ldList(body, tab, () => this.render(el));
  },
  mount() { $('#newlead')?.addEventListener('click', () => newLeadModal()); $('#r33btn')?.addEventListener('click', () => report33Modal()); $('#callmode')?.addEventListener('click', () => callMode(ldRows(ST.view === 'deals' ? 'deals' : ST.view === 'followups' ? 'followups' : 'leads').filter(L.open))); },
};
VIEWS.deals = VIEWS.leads;
VIEWS.followups = VIEWS.leads;

/* the choices a column filter offers: companies, or months for dates */
function colChoices(key, tab) {
  const rows = M.leads().filter((l) => !!l.is_deal === (tab === 'deals'));
  if (key === 'company') return [...new Set(rows.map((l) => cellVal(l, 'company')).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 500);
  const ms = [...new Set(rows.map((l) => String(cellVal(l, key) || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  return ms.map((m) => [m, new Date(m + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })]);
}
function ldList(box, tab, rer) {
  const cols = LCOLS[tab];
  let rows = ldRows(tab);
  const k = LF.sort || (tab === 'deals' ? 'close' : tab === 'followups' ? 'next' : 'date');
  rows.sort((a, b) => { const x = cellVal(a, k), y = cellVal(b, k); if (k === 'next' && !LF.sort && (!x || !y)) return !x && !y ? 0 : x ? -1 : 1; const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); return c * (LF.sort ? LF.dir : tab === 'deals' || tab === 'followups' ? 1 : -1); });
  const total = rows.length; const pages = Math.max(1, Math.ceil(total / LF.per)); LF.page = clamp(LF.page, 1, pages);
  const from = (LF.page - 1) * LF.per; const shown = rows.slice(from, from + LF.per);
  const deptCodes = ST.dept === 'All' ? DEPTS().map((d) => d.code) : [ST.dept];
  const statusOpts = [...new Set(deptCodes.flatMap((c) => S.list(c, tab === 'deals' ? 'deal' : 'lead').map((s) => s.key)))];
  const ownerOpts = [...new Set(visibleLeads().map((l) => L.ownerLabel(l)))].sort();
  const colFilter = (key) => key === 'stage' ? `<select data-cf="stage" aria-label="Filter status">${opts(statusOpts, LF.col.stage, 'Any')}</select>` : key === 'owner' ? `<select data-cf="owner" aria-label="Filter assigned to">${opts(ownerOpts, LF.col.owner, 'Anyone')}</select>` : key === 'value' ? '' : ['company', 'date', 'close'].includes(key) ? `<select data-cf="${key}" aria-label="Filter ${key}">${opts(colChoices(key, tab), LF.col[key], 'Any')}</select>` : `<input data-cf="${key}" value="${esc(LF.col[key] || '')}" placeholder="Filter" aria-label="Filter ${key}">`;
  const th = ([key, t]) => `<th class="sort ${key === 'value' ? 'n' : ''}" data-sort="${key}">${t}${LF.sort === key ? (LF.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const td = (l, key) => {
    if (key === 'stage') return `<td>${stageChip(l)}</td>`;
    if (key === 'value') return `<td class="n">${inr(l.value)}</td>`;
    if (key === 'close') return `<td>${l.expected_close ? `<span class="${l.expected_close < todayStr() && L.open(l) ? 'chip bad' : ''}">${fmtDate(l.expected_close)}</span>` : '—'}</td>`;
    if (key === 'date') return `<td>${fmtDate(l.enquiry_date || l.created_at)}</td>`;
    if (key === 'next') return `<td>${l.next_followup_at ? `<span class="${new Date(l.next_followup_at) < new Date() ? 'chip bad' : 'chip tone info'}">${fmtDT(l.next_followup_at)}</span>` : '<span class="faint">Not set</span>'}</td>`;
    if (key === 'remark') { const r = L.latestRemark(l); return `<td class="rem" title="${esc(r)}">${esc(r) || '<span class="faint">—</span>'}</td>`; }
    if (key === 'name') return `<td><div class="t">${esc(l.name)}</div><div class="s">${funnelChip(l.funnel)} ${esc(l.ref_id || l.lead_no || '')}${l.city ? ' · ' + esc(l.city) : ''}</div></td>`;
    if (key === 'company') return `<td>${tab === 'deals' ? `<div class="t">${esc(L.company(l) || l.name)}</div><div class="s">${funnelChip(l.funnel)} ${L.company(l) ? esc(l.name) : ''}</div>` : L.company(l) ? `<div class="t org">${esc(L.company(l))}</div>` : '<span class="faint">—</span>'}</td>`;
    return `<td>${esc(cellVal(l, key))}</td>`;
  };
  const quick = LF.quick && QUICK[LF.quick];
  const stCount = (k0) => { const keep = LF.state; LF.state = k0; const n0 = ldRows(tab).length; LF.state = keep; return n0; };
  box.innerHTML = `${lfBar(tab)}<div class="filters" style="margin:10px 0">
      <input type="search" id="lq" placeholder="Search name, phone, email, company…" value="${esc(LF.q)}" aria-label="Search">
      ${quick ? `<span class="chip acc qchip">${esc(quick[0])} <button class="btn ghost small" id="qx" aria-label="Clear">${svg('x')}</button></span>` : tab === 'followups' ? '' : `<div class="seg">${[['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['closed', 'Duplicate / other'], ['all', 'All']].map(([k0, t]) => `<button data-state="${k0}" aria-pressed="${LF.state === k0}">${t} <span class="faint">${nfmt(stCount(k0))}</span></button>`).join('')}</div>`}
      <span class="faint" style="font-size:12.5px">${nfmt(total)} ${tab === 'followups' ? 'follow-ups' : tab}${tab === 'deals' ? ` · ${inr(sum(rows, (l) => l.value))}` : ''}</span>${toneLegend()}</div>
    <div class="row bulk" id="bulk" hidden><b id="bulkn"></b>
      ${canReassign() ? `<select id="bassign"><option value="">Assign to…</option>${assignablePeople().map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select>` : ''}
      ${deptCodes.length === 1 ? `<select id="bstage"><option value="">Change status…</option>${opts(S.list(deptCodes[0], tab === 'deals' ? 'deal' : 'lead').map((s) => s.key))}</select>` : '<span class="faint" style="font-size:12px">Pick one department to change status in bulk</span>'}
      ${canEmail() ? '<button class="btn small" id="bmail">Email</button>' : ''}${canExport() ? '<button class="btn small" id="bexp">Export</button>' : ''}${isSuper() ? `<button class="btn small danger" id="bdel">${svg('x')} Delete</button>` : ''}</div>
    ${shown.length ? `<div class="tablewrap ldt free"><table><thead><tr><th class="ck"><input type="checkbox" id="lall" aria-label="Select all"></th>${cols.map(th).join('')}</tr></thead><tbody>
      ${shown.map((l) => `<tr class="click tone-${leadTone(l) || 'none'}" data-lead="${l.id}"><td class="ck" onclick="event.stopPropagation()"><input type="checkbox" class="lchk" value="${l.id}" aria-label="Select"></td>${cols.map(([key]) => td(l, key)).join('')}</tr>`).join('')}
      </tbody></table></div>${pager(total, pages, from, shown.length)}
      <div class="cards-m">${shown.map((l) => `<button class="glass lcard tone-${leadTone(l) || 'none'}" data-lead="${l.id}">${L.company(l) && tab !== 'deals' ? `<span class="s org">${esc(L.company(l))}</span>` : ''}<span class="row between"><b>${esc(tab === 'deals' ? L.company(l) || l.name : l.name)}</b>${stageChip(l)}</span><span class="s">${funnelChip(l.funnel)} ${esc(tab === 'deals' ? inr(l.value) + (l.expected_close ? ' · closes ' + fmtDate(l.expected_close) : '') : tab === 'followups' && l.next_followup_at ? 'next ' + fmtDT(l.next_followup_at) : l.phone || '')} · ${esc(L.ownerLabel(l))}</span>${L.latestRemark(l) ? `<span class="s rem">${esc(L.latestRemark(l))}</span>` : ''}</button>`).join('')}</div>`
      : `<div class="tablewrap ldt free"><table><thead><tr><th class="ck"></th>${cols.map(th).join('')}</tr></thead></table></div>${empty(`No ${tab} match`, tab === 'deals' ? 'Convert a lead to a deal from its record, or change the filters.' : 'Change the filters or add a new lead.')}`}`;
  const hc = box.closest('.panel')?.querySelector('.ldcount');
  if (hc) { const word = tab === 'followups' ? 'follow-ups' : tab; const stl = quick ? quick[0].toLowerCase() : tab === 'followups' ? 'open' : { open: 'open', won: 'won', lost: 'lost', closed: 'duplicate / other-department', all: 'all' }[LF.state] || ''; const late = rows.filter((l) => L.open(l) && l.next_followup_at && new Date(l.next_followup_at) < new Date()).length;
    hc.innerHTML = `<b>${nfmt(total)}</b> <span class="faint">${esc(stl)} ${word}${tab === 'deals' ? ` · ${inr(sum(rows, (l) => l.value))}${LF.state === 'open' ? ` · weighted ${inr(sum(rows, (l) => (l.value * L.prob(l)) / 100))}` : ''}` : ''}${tab === 'followups' && late ? ` · <span class="bad">${nfmt(late)} overdue</span>` : ''}</span>`; }
  bindLF(box, () => ldList(box, tab, rer));
  const keepFocus = (sel0) => { const i = box.querySelector(sel0); if (i) { i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); } };
  box.querySelector('#lq').oninput = (e) => { LF.q = e.target.value; clearTimeout(ldList._t); ldList._t = setTimeout(() => { LF.page = 1; ldList(box, tab, rer); keepFocus('#lq'); }, 250); };
  box.querySelectorAll('[data-state]').forEach((b) => (b.onclick = () => { LF.state = b.dataset.state; LF.page = 1; ldList(box, tab, rer); }));
  box.querySelector('#qx')?.addEventListener('click', () => { LF.quick = ''; ldList(box, tab, rer); });
  box.querySelectorAll('[data-cf]').forEach((i) => { const k0 = i.dataset.cf; const apply = () => { LF.col[k0] = i.value; LF.page = 1; ldList(box, tab, rer); }; if (i.tagName === 'SELECT') i.onchange = apply; else i.oninput = () => { LF.col[k0] = i.value; clearTimeout(ldList._c); ldList._c = setTimeout(() => { LF.page = 1; ldList(box, tab, rer); keepFocus(`[data-cf="${k0}"]`); }, 300); }; i.onclick = (e) => e.stopPropagation(); });
  box.querySelectorAll('[data-sort]').forEach((t) => (t.onclick = () => { if (LF.sort === t.dataset.sort) LF.dir *= -1; else { LF.sort = t.dataset.sort; LF.dir = 1; } ldList(box, tab, rer); }));
  box.querySelectorAll('[data-pg]').forEach((x) => (x.onclick = () => { LF.page = Number(x.dataset.pg); ldList(box, tab, rer); box.querySelector('.ldt')?.scrollIntoView({ block: 'nearest' }); }));
  box.querySelectorAll('[data-per]').forEach((x) => (x.onclick = () => { LF.per = Number(x.dataset.per); LF.page = 1; try { localStorage.setItem('garuda-ld-per', LF.per); } catch (_) { /* no storage */ } ldList(box, tab, rer); }));
  const chosen = () => $$('.lchk:checked', box).map((c) => c.value);
  const upd = () => { const n = chosen().length; box.querySelector('#bulk').hidden = !n; box.querySelector('#bulkn').textContent = n + ' selected'; };
  box.querySelectorAll('.lchk').forEach((c) => (c.onchange = upd));
  box.querySelector('#lall')?.addEventListener('change', (e) => { $$('.lchk', box).forEach((c) => (c.checked = e.target.checked)); upd(); });
  box.querySelector('#bdel')?.addEventListener('click', () => deleteLeads(chosen(), rer));
  box.querySelector('#bassign')?.addEventListener('change', (e) => guard(async () => { const to = e.target.value; if (!to) return; const n = await DB.bulkUpdate('leads', chosen(), { owner: to }); toast(`${n} assigned to ${DB.pname(to)}`); rer(); }));
  box.querySelector('#bstage')?.addEventListener('change', (e) => guard(async () => {
    const to = e.target.value; if (!to) return; const ids = chosen(); let ok = 0;
    const st = S.get(deptCodes[0], to); let reason = '';
    if (st?.needs_reason) { reason = await promptBox('Why were they lost?', 'Loss reason', '', { options: lossReasons(deptCodes[0]) }); if (!reason) return; }
    for (const id of ids) { const l = DB.get('leads', id); const g = stageGate({ ...l, lost_reason: reason || l.lost_reason }, to); if (g && g !== 'LOST_REASON') continue; try { await DB.update('leads', id, { stage: to, ...(reason ? { lost_reason: reason } : {}) }); ok++; } catch (_) { /* gate in the database */ } }
    toast(ok === ids.length ? `${ok} moved to ${to}` : `${ok} of ${ids.length} moved; the rest need a fee, payment or conversion first`, ok !== ids.length); rer();
  }));
  box.querySelector('#bmail')?.addEventListener('click', () => composeEmail({ leadIds: chosen(), title: 'Selected records' }));
  box.querySelector('#bexp')?.addEventListener('click', () => { const ids = new Set(chosen()); downloadCSV('garuda-' + tab, rows.filter((l) => ids.has(l.id)).map(leadCsv)); });
  bindLeadClicks(box);
}
/* the filter panel above the list */
function lfPanel(tab) {
  const base = M.leads().filter((l) => !!l.is_deal === (tab === 'deals') && (tab !== 'followups' || isFU(l)));
  const top = (fn, n = 40) => Object.entries(groupBy(base, fn)).map(([k, a]) => [k, a.length]).sort((a, b) => b[1] - a[1]).slice(0, n);
  const ms = (k, label, list, fmt = (x) => x) => `<div class="lf-f"><span class="lf-l">${label}</span><div class="lf-chips">${list.map(([v0, n]) => `<button type="button" class="lfc ${(LF.f[k] || []).includes(v0) ? 'on' : ''}" data-lfm="${k}" data-v="${esc(v0)}">${esc(fmt(v0))} <small>${nfmt(n)}</small></button>`).join('')}</div></div>`;
  const ss = (k, label, list) => `<label class="lf-f"><span class="lf-l">${label}</span><select data-lfs="${k}">${opts(list, LF.f[k] || '', 'Any')}</select></label>`;
  const msel = (k, label, list) => `<label class="lf-f"><span class="lf-l">${label}</span><select data-lfx="${k}">${opts(list.map(([v0, n]) => [v0, `${v0} (${nfmt(n)})`]), (LF.f[k] || [])[0] || '', 'Any')}</select></label>`;
  const tiers = TIERS.map((t) => [tierKey(t), base.filter((l) => tierKey(l.campaign_tier) === tierKey(t)).length]).filter(([, n]) => n);
  const tierName = Object.fromEntries(TIERS.map((t) => [tierKey(t), t.replace(/^[A-Z]\d\s*-?\s*/, '')]));
  return `<div class="lfp glass">
    ${tiers.length ? ms('tier', 'Campaign tier', tiers, (k) => `${k} · ${tierName[k] || ''}`) : ''}
    ${ms('temp', 'Temperature', top((l) => l.temperature || l.ai_band || '—'))}
    <div class="lf-grid">
      ${msel('stage', tab === 'deals' ? 'Stage' : 'Status', top((l) => l.stage))}
      ${msel('owner', 'Assigned to', top((l) => L.ownerLabel(l)))}
      ${ST.dept === 'All' ? msel('funnel', 'Process', top((l) => l.funnel)) : ''}
      ${msel('prod', 'Product / course', top((l) => L.line(l) || '—'))}
      ${msel('source', 'Lead source', top((l) => l.source || '—'))}
      ${msel('city', 'Location', top((l) => l.city || '—', 60))}
      ${ss('enq', 'Enquiry date', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['fy', 'This financial year'], ['old', 'Older than 6 months']])}
      ${ss('fu', 'Next follow-up', [['over', 'Overdue'], ['today', 'Today'], ['week', 'Next 7 days'], ['none', 'Not set']])}
      ${ss('att', 'Call attempts', [['0', 'None yet'], ['1', '1–2'], ['3', '3–5'], ['6', '6 or more']])}
      ${ss('lc', 'Last contact', [['never', 'Never contacted'], ['recent', 'In the last 7 days'], ['7', 'More than 7 days ago'], ['30', 'More than 30 days ago']])}
      ${ss('inh', 'Handed over', [['yes', 'All handed over'], ['new', 'Handed over, not worked yet'], ['worked', 'Handed over, worked since'], ['no', 'Not handed over']])}
      ${ss('contact', 'Contact details', [['phone', 'Has a phone'], ['email', 'Has an email'], ['both', 'Phone and email'], ['none', 'Neither']])}
      ${ss('score', 'Priority score', [['8', '8 and above'], ['5', '5 and above'], ['low', 'Below 5']])}
      ${ss('elig', 'Eligible', [['Eligible', 'Eligible'], ['Not eligible', 'Not eligible'], ['Unknown', 'Not known']])}
      ${msel('lang', 'Language', top((l) => l.language || '—'))}
    </div>
    <div class="row lf-foot"><button class="btn small ghost" type="button" id="lfclr">Clear all filters</button><button class="btn small primary" type="button" id="lfdone">Done</button></div></div>`;
}
function bindLF(box, rerList) {
  const again = () => { LF.page = 1; LF.view = ''; rerList(); };
  box.querySelectorAll('[data-lfm]').forEach((b) => (b.onclick = () => { const k = b.dataset.lfm; const a = new Set(LF.f[k] || []); a.has(b.dataset.v) ? a.delete(b.dataset.v) : a.add(b.dataset.v); LF.f = { ...LF.f, [k]: [...a] }; again(); }));
  box.querySelectorAll('[data-lfs]').forEach((x) => (x.onchange = () => { LF.f = { ...LF.f, [x.dataset.lfs]: x.value }; again(); }));
  box.querySelectorAll('[data-lfx]').forEach((x) => (x.onchange = () => { LF.f = { ...LF.f, [x.dataset.lfx]: x.value ? [x.value] : [] }; again(); }));
  box.querySelector('#lfclr')?.addEventListener('click', () => { LF.f = {}; again(); });
  box.querySelector('#lfdone')?.addEventListener('click', () => { LF.fOpen = false; rerList(); });
  box.querySelector('#lftog')?.addEventListener('click', () => { LF.fOpen = !LF.fOpen; rerList(); });
  box.querySelectorAll('[data-lv]').forEach((b) => (b.onclick = () => { const v0 = LVIEWS.find((x) => x[0] === b.dataset.lv); if (LF.view === v0[0]) { LF.f = {}; LF.view = ''; } else { LF.f = { ...v0[2] }; LF.view = v0[0]; } LF.page = 1; rerList(); }));
  box.querySelectorAll('[data-lfx-rm]').forEach((b) => (b.onclick = () => { const k = b.dataset.lfxRm; const nf = { ...LF.f }; delete nf[k]; LF.f = nf; again(); }));
}
const LF_LABEL = { tier: 'Tier', temp: 'Temperature', stage: 'Status', owner: 'Assigned to', funnel: 'Process', prod: 'Product', source: 'Source', city: 'Location', enq: 'Enquiry', fu: 'Follow-up', att: 'Attempts', lc: 'Last contact', inh: 'Handed over', contact: 'Contact', elig: 'Eligible', score: 'Score', lang: 'Language' };
function lfBar(tab) {
  const on = lfOn();
  return `<div class="lv-row" role="group" aria-label="Smart views">${LVIEWS.filter((v0) => tab !== 'deals' || ['over', 'today', 'hot8', 'fresh'].includes(v0[0])).map(([k, t, , ic]) => `<button type="button" class="lv ${LF.view === k ? 'on' : ''}" data-lv="${k}">${svg(ic)}${t}</button>`).join('')}</div>
    <div class="lf-active"><button type="button" class="btn small ${LF.fOpen ? 'primary' : ''}" id="lftog">${svg('list')} Filters${on.length ? ` · ${on.length}` : ''}</button>
      ${on.map(([k, v]) => `<span class="chip acc">${esc(LF_LABEL[k] || k)}: ${esc(Array.isArray(v) ? v.join(', ') : v)} <button class="btn ghost small" type="button" data-lfx-rm="${k}" aria-label="Remove">${svg('x')}</button></span>`).join('')}</div>
    ${LF.fOpen ? lfPanel(tab) : ''}`;
}
/* rows per page and page numbers under the list */
function pager(total, pages, from, n) {
  const p = LF.page; const nums = [...new Set([1, p - 2, p - 1, p, p + 1, p + 2, pages])].filter((x) => x >= 1 && x <= pages).sort((a, b) => a - b);
  const btns = []; nums.forEach((x, i) => { if (i && x - nums[i - 1] > 1) btns.push('<span class="pg-gap">…</span>'); btns.push(`<button class="pg ${x === p ? 'on' : ''}" data-pg="${x}" ${x === p ? 'aria-current="page"' : ''}>${nfmt(x)}</button>`); });
  return `<div class="pager"><div class="pg-per"><span class="faint">Rows per page</span><div class="seg">${[20, 50, 100].map((k) => `<button data-per="${k}" aria-pressed="${LF.per === k}">${k}</button>`).join('')}</div></div>
    <span class="faint pg-of">${total ? `${nfmt(from + 1)}–${nfmt(from + n)} of ${nfmt(total)} · page ${nfmt(p)} of ${nfmt(pages)}` : ''}</span>
    ${pages > 1 ? `<div class="pg-nums"><button class="pg" data-pg="${Math.max(1, p - 1)}" ${p === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>${btns.join('')}<button class="pg" data-pg="${Math.min(pages, p + 1)}" ${p === pages ? 'disabled' : ''} aria-label="Next page">›</button></div>` : ''}</div>`;
}
const lossReasons = (code) => (dept(code).loss_reasons?.length ? dept(code).loss_reasons : DB.settings.lost_reasons || ['Other']);
const leadCsv = (l) => ({ lead_no: l.lead_no, sheet_id: l.ref_id || '', department: l.funnel, type: l.is_deal ? 'Deal' : 'Lead', name: l.name, company: L.company(l), status: l.stage, email: l.email, phone: l.phone, assigned_to: L.ownerLabel(l), lead_date: (l.enquiry_date || l.created_at || '').slice(0, 10), value_ex_gst: l.value, closure_date: l.expected_close || '', latest_remark: L.latestRemark(l), source: l.source, course: l.course || l.sub_category || '', won_at: l.won_at || '', lost_reason: l.lost_reason || '' });

/* ---------- Kanban: one department's statuses (leads) or stages (deals) ---------- */
/* the last time anyone reached the lead: a call or remark in the CRM, or the last dated line of the sales sheet */
function lastTouch(l) {
  let t = l.last_contact_at || '';
  for (const r of DB.t.remarks) if (r.lead_id === l.id && r.outcome !== 'Note' && r.created_at > t) t = r.created_at;
  return t || null;
}
function kanban(box, tab, rer) {
  const busiest = () => { const by = groupBy(ldRows(tab), (l) => l.funnel); return DEPTS().map((d) => d.code).sort((a, b) => (by[b]?.length || 0) - (by[a]?.length || 0))[0]; };
  const code = ST.dept !== 'All' ? ST.dept : ST.kbDept && DEPTS().some((d) => d.code === ST.kbDept) ? ST.kbDept : busiest();
  if (!code) {
    box.innerHTML = `<div class="pickdept"><h3>Pick a department for the board</h3><p class="faint">Each department has its own ${tab === 'deals' ? 'deal stages' : 'lead statuses'}, so the Kanban shows one department at a time.</p><div class="row">${DEPTS().map((d) => `<button class="btn" data-kb="${esc(d.code)}" style="--dc:${esc(d.color)}"><i class="ddot"></i>${esc(d.name)}</button>`).join('')}</div></div>`;
    box.querySelectorAll('[data-kb]').forEach((b) => (b.onclick = () => { ST.kbDept = b.dataset.kb; saveUI(); rer(); }));
    return;
  }
  const deal = tab === 'deals';
  /* every status is a column so a card can be dropped on Won or Lost; closed columns show the last 30 days */
  const keep = LF.state; LF.state = 'all'; const all = ldRows(tab).filter((l) => l.funnel === code); LF.state = keep;
  const rows = all.filter((l) => L.open(l) || LF.quick || daysAgo(L.stageAt(l)) <= 30);
  const cols = S.list(code, deal ? 'deal' : 'lead');
  const CAP = 60;
  box.innerHTML = `${lfBar(tab)}<div class="filters" style="margin:10px 0">${ST.dept === 'All' ? `<div class="seg" role="group" aria-label="Process">${DEPTS().map((d) => `<button data-kb="${esc(d.code)}" aria-pressed="${d.code === code}" style="--dc:${esc(d.color)}"><i class="ddot"></i>${esc(d.name)}</button>`).join('')}</div>` : ''}
      <input type="search" id="kq" placeholder="Search" value="${esc(LF.q)}" aria-label="Search">${LF.quick ? `<span class="chip acc qchip">${esc(QUICK[LF.quick][0])} <button class="btn ghost small" id="qx" aria-label="Clear">${svg('x')}</button></span>` : ''}
      <span class="faint" style="font-size:12px">Drag a card to change its ${deal ? 'stage' : 'status'}. Won asks for the final value; lost asks for a reason.</span></div>
    <div class="kanban">${cols.map((s) => { const a = rows.filter((l) => l.stage === s.key); return `<div class="kcol glass ${s.is_won ? 'won' : s.is_lost ? 'lost' : s.is_closed ? 'closed' : ''}" data-col="${esc(s.key)}"><div class="khead"><b class="gtag ${({ good: 'green', bad: 'red', warn: 'amber', info: s.kind === 'deal' ? 'violet' : 'blue' })[stageTone({ funnel: code, stage: s.key, is_deal: deal })]}">${esc(s.key)}</b><span class="faint">${nfmt(a.length)}${deal ? ' · ' + inr(sum(a, (l) => l.value)) : ''}${s.is_won || s.is_lost ? ' · last 30 days' : ''}</span>${deal && !s.is_lost ? `<span class="kp">${s.prob}%</span>` : ''}</div>
      <div class="kbody">${a.slice(0, CAP).map((l) => `<div class="kcard tone-${leadTone(l) || 'none'}" draggable="true" data-lead="${l.id}" data-id="${l.id}"><b>${esc(deal ? L.company(l) || l.name : l.name)}</b><span class="s">${esc(deal ? (L.company(l) ? l.name + ' · ' : '') + inr(l.value) : L.company(l) || l.phone || '')}</span><span class="s">${esc(L.ownerLabel(l))}${deal && l.expected_close ? ` · <span class="${l.expected_close < todayStr() && L.open(l) ? 'bad' : ''}">${fmtDate(l.expected_close)}</span>` : l.next_followup_at && L.open(l) ? ' · next ' + fmtDate(l.next_followup_at) : ''}</span>${(() => { const t = lastTouch(l); return `<span class="klast ${t ? (daysAgo(t) > 14 ? 'old' : '') : 'never'}">${svg('phone')} ${t ? `Last contacted ${fmtDate(t)} · ${rel(t)}` : 'Not contacted yet'}</span>`; })()}</div>`).join('')}${a.length > CAP ? `<p class="faint" style="font-size:12px;text-align:center">+${nfmt(a.length - CAP)} more · use List to see all</p>` : ''}</div></div>`; }).join('')}</div>`;
  box.querySelectorAll('[data-kb]').forEach((b) => (b.onclick = () => { ST.kbDept = b.dataset.kb; saveUI(); rer(); }));
  bindLF(box, () => kanban(box, tab, rer));
  box.querySelector('#qx')?.addEventListener('click', () => { LF.quick = ''; rer(); });
  box.querySelector('#kq').oninput = (e) => { LF.q = e.target.value; clearTimeout(kanban._t); kanban._t = setTimeout(() => { kanban(box, tab, rer); const i = box.querySelector('#kq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  let dragId = null;
  box.querySelectorAll('.kcard').forEach((c) => { c.ondragstart = (e) => { dragId = c.dataset.id; c.classList.add('drag'); e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; }; c.ondragend = () => c.classList.remove('drag'); });
  box.querySelectorAll('.kcol').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async (e) => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain') || dragId; const l = DB.get('leads', id); if (!l || l.stage === col.dataset.col) return; if (await moveStage(l, col.dataset.col)) rer(); };
  });
  bindLeadClicks(box);
}

/* ---------- Call mode: step through the filtered records, log the outcome, set the next follow-up ---------- */
function callMode(list) {
  list = list.filter((l) => l.phone || l.contact_name);
  if (!list.length) return toast('No records with a phone number in this view.', true);
  let i = 0; let done = 0;
  const m = openModal({ title: 'Call mode', width: 640, body: '<div id="cmb"></div>' });
  const draw = () => {
    const l = DB.get('leads', list[i].id) || list[i]; const b = m.el.querySelector('#cmb');
    const last = L.remarks(l).slice(-3).reverse();
    b.innerHTML = `<div class="row between"><span class="faint">${i + 1} of ${nfmt(list.length)} · ${done} logged</span><span>${funnelChip(l.funnel)} ${stageChip(l)}</span></div>
      <h2 style="margin:8px 0 2px">${esc(l.name)}</h2><div class="faint">${esc([L.company(l), l.contact_name, l.city].filter(Boolean).join(' · '))}</div>
      <div class="row" style="margin:10px 0">${l.phone ? `<a class="btn primary" href="tel:${esc(l.phone)}">${svg('phone')} ${esc(l.phone)}</a><a class="btn" href="https://wa.me/91${esc(l.phone.replace(/\D/g, '').slice(-10))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button class="btn ghost" id="cmo">Open record</button></div>
      ${last.length ? `<div class="list">${last.map((r) => `<div class="item"><span class="grow"><span class="faint" style="font-size:12px">${fmtDT(r.created_at)} · ${esc(r.outcome)}</span><br>${esc(r.text)}</span></div>`).join('')}</div>` : l.latest_remark ? `<p class="faint">Last remark: ${esc(l.latest_remark)}</p>` : ''}
      <div class="field" style="margin-top:10px"><label>Outcome</label><div class="row" id="cmout">${['No answer', 'Busy', 'Interested', 'Follow-up', 'Not interested', 'Meeting fixed'].map((o, k) => `<button class="btn small" data-o="${o}" aria-pressed="${k === 0}">${o}</button>`).join('')}</div></div>
      ${fld('cmt', 'Remark', '<textarea id="cmt" placeholder="What was said"></textarea>')}
      <div class="field"><label>Next follow-up</label><div class="row">${[[1, '+1 day'], [3, '+3 days'], [7, '+7 days']].map(([d, t]) => `<button class="btn small" data-nd="${d}">${t}</button>`).join('')}<input type="datetime-local" id="cmn" style="width:auto" aria-label="Next follow-up"></div></div>
      <div class="row" style="justify-content:space-between;margin-top:12px"><button class="btn" id="cmp" ${i ? '' : 'disabled'}>Back</button><span class="row"><button class="btn" id="cms">Skip</button><button class="btn primary" id="cmsave">Save and next</button></span></div>`;
    let out = 'No answer';
    b.querySelectorAll('[data-o]').forEach((x) => (x.onclick = () => { out = x.dataset.o; b.querySelectorAll('[data-o]').forEach((y) => y.setAttribute('aria-pressed', y === x)); }));
    b.querySelectorAll('[data-nd]').forEach((x) => (x.onclick = () => { const d = new Date(Date.now() + Number(x.dataset.nd) * 864e5); d.setHours(11, 0, 0, 0); b.querySelector('#cmn').value = dtLocal(d.toISOString()); }));
    const next = () => { if (i < list.length - 1) { i++; draw(); } else { m.close(); toast(`Call mode finished · ${done} logged`); } };
    b.querySelector('#cmo').onclick = () => openLead(l.id);
    b.querySelector('#cmp').onclick = () => { i = Math.max(0, i - 1); draw(); };
    b.querySelector('#cms').onclick = next;
    b.querySelector('#cmsave').onclick = () => guard(async () => {
      const text = v(b, 'cmt').trim() || out;
      await DB.insert('remarks', { lead_id: l.id, channel: 'Outbound call', outcome: out, text, next_followup_at: fromLocal(v(b, 'cmn')) });
      await autoStatus(l, out); done++; next();
    }, 'Logged');
  };
  draw();
}
/* the first lead statuses move on their own after a call, as the team does in the sheet */
async function autoStatus(l, out) {
  l = DB.get('leads', l.id) || l; if (l.is_deal) return;
  const st = S.open(l.funnel, 'lead'); if (st.length < 2) return;
  const rnr = S.get(l.funnel, 'RNR');
  let to = null;
  if (CONNECTED(out) && (l.stage === st[0].key || (rnr && l.stage === 'RNR'))) to = st.find((s) => s.key !== st[0].key && s.key !== 'RNR')?.key;
  else if (!CONNECTED(out) && out !== 'Note' && rnr && l.stage === st[0].key) to = 'RNR';
  if (to && to !== l.stage) await DB.update('leads', l.id, { stage: to }).catch(() => {});
}

/* ================= New lead ================= */
/* individual buyers (has_admissions departments) vs organisations */
const isOrgDept = (code) => !dept(code).has_admissions;
const courseList = (code, cur) => [...new Set([...(dept(code).courses || []), cur].filter(Boolean))];
const campaignOptions = (code, selId) => `<option value="">None</option>${DB.t.mkt_campaigns.filter((c) => !code || !c.dept || c.dept === code || c.id === selId).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))).map((c) => `<option value="${c.id}" ${c.id === selId ? 'selected' : ''}>${esc(c.name)} · ${esc(c.kind === 'ad' ? c.platform || 'Ad' : c.type)}</option>`).join('')}`;
function newLeadModal(pre = {}) {
  const depts = myDepts(); const defFunnel = pre.funnel && depts.includes(pre.funnel) ? pre.funnel : ST.dept !== 'All' && depts.includes(ST.dept) ? ST.dept : depts[0];
  const m = openModal({
    title: 'New lead', width: 860,
    body: `<div class="seg" id="nf">${depts.map((f) => `<button data-f="${esc(f)}" aria-pressed="${f === defFunnel}" style="--dc:${esc(deptColor(f))}"><i class="ddot"></i>${esc(dept(f).name)}</button>`).join('')}</div><div id="nfb"></div>`,
    foot: `<span class="faint" id="dupe" style="margin-right:auto;font-size:12.5px"></span><button class="btn" data-c>Cancel</button><button class="btn primary" id="nsave">Save lead</button>`,
  });
  let funnel = defFunnel;
  const draw = () => {
    const isC = isOrgDept(funnel); const cl = courseList(funnel);
    m.el.querySelector('#nfb').innerHTML = `<div class="form">
      ${isC ? fld('ninst', 'Company / institution', `<input id="ninst" list="instlist" placeholder="Start typing a name" value="${esc(pre.institution || '')}"><datalist id="instlist">${DB.t.institutions.map((i) => `<option value="${esc(i.name)}">${esc(i.city)}</option>`).join('')}</datalist>`) + fld('ncontact', 'Contact person', inp('ncontact', pre.contact || '')) + fld('ndesig', 'Designation', sel('ndesig', CONTACT_ROLES, 'Principal'))
        : fld('nname', 'Name', inp('nname', pre.name || '', 'text', 'required')) + fld('norg', 'Company (optional)', inp('norg', pre.org || ''))}
      ${fld('nphone', 'Phone', inp('nphone', pre.phone || '', 'tel'))}${fld('nemail', 'Email', inp('nemail', pre.email || '', 'email'))}
      ${fld('ncity', 'City', pickSel('ncity', usedValues('city'), ''))}${fld('nsrc', 'Source', sel('nsrc', DB.settings.sources || SOURCES, pre.source || '', 'Choose…'))}
      ${fld('ncamp', 'Campaign', `<select id="ncamp">${campaignOptions(funnel, pre.mkt_campaign_id)}</select>`)}
      ${fld('nowner', 'Assigned to', `<select id="nowner">${opts(assignablePeople().map((p) => [p.id, p.full_name]), DB.me.id)}</select>`)}
      ${cl.length ? fld('ncourse', isC ? 'Interested in' : 'Course / interest', sel('ncourse', cl, pre.course || cl[0])) : ''}
      ${fld('nprod', 'Price book item (optional)', `<select id="nprod">${productOptions(funnel, pre.product_id)}</select>`)}
      ${fld('nqty', isC ? 'Quantity (students / units)' : 'Seats', inp('nqty', 1, 'number', 'min="1"'))}
      ${fld('ndisc', 'Discount %', inp('ndisc', 0, 'number', `min="0" max="100" step="0.5"`))}
      ${fld('ntemp', 'Temperature', sel('ntemp', TEMPS, 'Warm'))}
      ${!isC ? fld('ncentre', 'Preferred centre', sel('ncentre', DB.settings.centres || [], '', 'Any')) : ''}
      <div class="full" id="nprice"></div>
      <div class="full row"><label class="check"><input type="checkbox" id="nce" checked> Agreed to receive email</label><label class="check"><input type="checkbox" id="ncw"> Opted in to WhatsApp</label></div>
      ${fld('nrem', 'First remark (optional)', `<textarea id="nrem" placeholder="What did they ask for?"></textarea>`, 'full')}
    </div>`;
    const pr = () => { const p = DB.get('products', v(m.el, 'nprod')); m.el.querySelector('#nprice').innerHTML = pricePanel(p, num(m.el, 'nqty') || 1, num(m.el, 'ndisc')); };
    ['nprod', 'nqty', 'ndisc'].forEach((id) => (m.el.querySelector('#' + id).oninput = pr)); pr();
    ['nphone', 'nemail'].forEach((id) => (m.el.querySelector('#' + id).onblur = () => { const d = dupCheck(v(m.el, 'nphone'), v(m.el, 'nemail')); m.el.querySelector('#dupe').innerHTML = d ? `Possible duplicate: <a href="#" data-lead="${d.id}">${esc(d.name)} (${esc(d.lead_no)})</a>` : ''; }));
  };
  draw();
  bindLeadClicks(m.el);
  m.el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { funnel = b.dataset.f; m.el.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); }));
  m.el.querySelector('#nsave').onclick = () => guard(async () => {
    const isC = isOrgDept(funnel); const p = DB.get('products', v(m.el, 'nprod'));
    const disc = num(m.el, 'ndisc'); if (await discountBlocked(null, disc)) return;
    const qty = num(m.el, 'nqty') || 1;
    let inst = null, contact = null;
    if (isC) {
      const nm = v(m.el, 'ninst').trim(); if (!nm) throw new Error('Enter the company or institution');
      inst = DB.t.institutions.find((i) => i.name.toLowerCase() === nm.toLowerCase()) || await DB.insert('institutions', { name: nm, city: v(m.el, 'ncity'), owner: v(m.el, 'nowner') || DB.me.id });
      if (v(m.el, 'ncontact')) contact = await DB.insert('contacts', { institution_id: inst.id, name: v(m.el, 'ncontact'), designation: v(m.el, 'ndesig'), role_type: v(m.el, 'ndesig'), phone: v(m.el, 'nphone'), email: v(m.el, 'nemail'), consent_email: v(m.el, 'nce'), consent_whatsapp: v(m.el, 'ncw') });
    } else if (!v(m.el, 'nname').trim()) throw new Error('Enter the name');
    const course = v(m.el, 'ncourse') || '';
    const first = S.firstOpen(funnel, 'lead');
    const lead = await DB.insert('leads', {
      funnel, name: isC ? `${inst.name} · ${p?.name || (course && course !== 'Not Specified' ? course : 'enquiry')}` : v(m.el, 'nname').trim(), org: isC ? '' : v(m.el, 'norg').trim(), institution_id: inst?.id || null, contact_id: contact?.id || null,
      contact_name: isC ? v(m.el, 'ncontact') : '', designation: isC ? v(m.el, 'ndesig') : '', phone: v(m.el, 'nphone'), email: v(m.el, 'nemail'), city: v(m.el, 'ncity') || inst?.city || '',
      source: v(m.el, 'nsrc'), mkt_campaign_id: v(m.el, 'ncamp') || null, product_id: p?.id || null, qty, unit_price: p ? priceFor(p, qty) : COURSE_FEE[course] || 0, discount_pct: disc, gst_rate: p?.gst_rate ?? 18, share_pct: p?.share_pct ?? 100,
      stage: first?.key || 'New', course: isC ? '' : course, sub_category: isC ? course : '', temperature: v(m.el, 'ntemp'), owner: v(m.el, 'nowner') || DB.me.id, sourced_by: DB.me.id, preferred_centre: isC ? '' : v(m.el, 'ncentre') || '',
      consent_email: v(m.el, 'nce'), consent_whatsapp: v(m.el, 'ncw'),
    });
    if (v(m.el, 'nrem').trim()) await DB.insert('remarks', { lead_id: lead.id, channel: 'Inbound call', outcome: 'Interested', text: v(m.el, 'nrem').trim() });
    m.close(); toast(`Saved ${lead.lead_no || ''}`); openLead(lead.id);
  });
}
function dupCheck(phone, email) {
  const p10 = (phone || '').replace(/\D/g, '').slice(-10);
  return DB.t.leads.find((l) => (p10.length === 10 && (l.phone || '').replace(/\D/g, '').slice(-10) === p10) || (email && l.email && l.email.toLowerCase() === email.toLowerCase())) || null;
}

/* ================= Lead record ================= */
/* the record: client details on the left half, activity on the right half */
const LEAD_TABS = [['history', 'Activity'], ['tasks', 'Tasks'], ['remarks', 'Calls & remarks'], ['money', 'Quote & payments'], ['emails', 'Emails'], ['work', 'Meetings'], ['ai', 'Claude']];
/* discounts above the sales limit can only be given by an Admin */
function discountOk(l, disc) { return disc <= discountLimit() || isHead(); }
async function discountBlocked(l, disc) {
  if (discountOk(l, disc)) return false;
  toast(`Discounts above ${discountLimit()}% can only be given by an Admin.`, true);
  return true;
}
let leadTab = 'history';
function openLead(id) {
  openDrawer((ctx) => {
    const l = DB.get('leads', id); if (!l) { ctx.close(); return toast('Record not found', true); }
    const st = L.st(l); const prod = L.product(l); const inst = L.inst(l); const camp = DB.get('mkt_campaigns', l.mkt_campaign_id);
    ctx.el.innerHTML = `<div class="drawer-head"><div style="min-width:0"><div class="row">${funnelChip(l.funnel)}<span class="chip ${l.is_deal ? 'acc' : ''}">${l.is_deal ? 'Deal' : 'Lead'}</span><span class="faint mono">${esc(l.ref_id || l.lead_no)}</span>${tempChip(l.temperature)}${scoreBadge(l)}</div>
        ${L.company(l) && !l.is_deal ? `<div class="rec-org">${svg('inst')} ${esc(L.company(l))}</div>` : ''}<h2 style="margin-top:${L.company(l) && !l.is_deal ? 2 : 6}px">${esc(l.is_deal ? L.title(l) : l.name)}</h2><div class="faint" style="font-size:12.5px">${l.is_deal ? `${inr(l.value)} ex-GST · closes ${l.expected_close ? fmtDate(l.expected_close) : '—'} · ` : ''}${esc(prod?.name || l.course || l.sub_category || '')} · ${esc(DB.pname(l.owner))} · ${daysAgo(l.created_at)} days old</div></div>
        <button class="btn ghost small" data-close aria-label="Close">${svg('x')}</button></div>
      <div class="dbar row"><label class="faint" for="dstage" style="font-size:12px">${l.is_deal ? 'Stage' : 'Status'}</label><select id="dstage" style="width:auto">${S.list(l.funnel, l.is_deal ? 'deal' : 'lead').map((s) => `<option ${s.key === l.stage ? 'selected' : ''}>${esc(s.key)}</option>`).join('')}</select>
        ${l.is_deal && !st.is_won && !st.is_lost ? `<span class="faint" style="font-size:12px">${st.prob}% win</span>` : ''}
        ${!l.is_deal && L.open(l) ? `<button class="btn small primary" id="dconv">${svg('up')} Convert to deal</button>` : ''}
        <button class="btn small" id="dvisit">${svg('pin')} Plan meeting</button>
        <button class="btn small" id="dacct">${svg('inst')} ${inst ? esc(inst.name) : 'Link account'}</button>
        <button class="btn small" id="dcamp">${svg('ads')} ${camp ? esc(camp.name) : 'Campaign'}</button>
        ${l.phone ? `<a class="btn small" href="tel:${esc(l.phone)}">${svg('phone')} Call</a><a class="btn small" href="https://wa.me/91${esc(l.phone.replace(/\D/g, '').slice(-10))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn small" id="dquote">Disclose price</button>
        ${isSuper() ? `<button class="btn small danger" id="ddel" title="Delete this lead for good">${svg('x')} Delete</button>` : ''}${L.open(l) && DEPTS().length > 1 ? `<button class="btn small" id="dxfer" title="This enquiry belongs to another team">${svg('swap')} Transfer</button>` : ''}</div>
      ${l.ai_next_action ? `<div style="padding:0 18px 8px"><div class="ai-card" style="padding:8px 12px;font-size:12.5px"><b>Claude:</b> ${esc(l.ai_next_action)} <span class="faint">${l.ai_scored_at ? '· scored ' + rel(l.ai_scored_at) : ''}</span></div></div>` : ''}
      <div class="rec2"><section class="rec-left"><div class="rec-h"><h3>Client details</h3></div><div class="rec-scroll" id="dleft"></div></section>
        <section class="rec-right"><div class="tabs" role="tablist">${LEAD_TABS.map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${leadTab === k}">${t}</button>`).join('')}</div>
        <div class="rec-scroll" id="dbody"></div></section></div>`;
    ctx.el.querySelector('[data-close]').onclick = ctx.close;
    ctx.el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { leadTab = b.dataset.tab; ctx.render(); }));
    ctx.el.querySelector('#dstage').onchange = (e) => moveStage(l, e.target.value).then((ok) => { if (!ok) e.target.value = l.stage; ctx.render(); });
    ctx.el.querySelector('#dquote').onclick = () => quoteModal(l, () => ctx.render());
    ctx.el.querySelector('#dconv')?.addEventListener('click', () => convertModal(l, () => ctx.render()));
    ctx.el.querySelector('#dvisit').onclick = () => visitModal({ lead_id: l.id, institution_id: l.institution_id }, () => ctx.render());
    ctx.el.querySelector('#dacct').onclick = () => (inst ? openAccount(inst.id) : linkAccountModal(l, () => ctx.render()));
    ctx.el.querySelector('#dcamp').onclick = () => linkCampaignModal(l, () => ctx.render());
    ctx.el.querySelector('#ddel')?.addEventListener('click', () => deleteLeads([l.id], () => { ctx.close(); if (VIEWS[ST.view]) go(ST.view); }));
    ctx.el.querySelector('#dxfer')?.addEventListener('click', () => transferModal(l, () => (DB.get('leads', l.id) && visibleLeads().some((x) => x.id === l.id) ? ctx.render() : ctx.close())));
    if (!LEAD_TABS.some(([k]) => k === leadTab)) leadTab = 'history';
    tabOverview(l, ctx.el.querySelector('#dleft'), ctx);
    const body = ctx.el.querySelector('#dbody');
    if (leadTab === 'history') {
      const ot = DB.t.work_tasks.filter((t) => t.lead_id === l.id && taskOpen(t));
      body.innerHTML = `<div class="row" style="justify-content:flex-end"><button class="btn small" id="dtask">${svg('task')} Add task</button><button class="btn small primary" id="dlog">${svg('phone')} Log a call or remark</button></div>
        <section class="actasks"><div class="row between"><h4>Open tasks</h4><a href="#" id="dalltasks">${ot.length ? 'Work on them →' : 'Tasks tab →'}</a></div>${ot.length ? ot.map((t) => taskCard(t, { open: false, showLink: false })).join('') : '<p class="faint" style="margin:0">No open tasks on this record.</p>'}</section>
        <h4 style="margin:4px 0 0">Timeline</h4><div id="dtl"></div>`;
      body.querySelector('#dlog').onclick = () => { leadTab = 'remarks'; ctx.render(); };
      body.querySelector('#dtask').onclick = () => taskModal({ lead_id: l.id, institution_id: l.institution_id, owner: l.owner }, () => ctx.render());
      body.querySelector('#dalltasks').onclick = (e) => { e.preventDefault(); leadTab = 'tasks'; ctx.render(); };
      bindTaskCards(body.querySelector('.actasks'), () => ctx.render());
      tabHistory(l, body.querySelector('#dtl'), ctx);
    } else ({ tasks: tabTasks, remarks: tabRemarks, money: tabMoney, emails: tabEmails, work: tabWork, ai: tabAI })[leadTab](l, body, ctx);
  }, 'record');
}
/* turn the value into a unit price the database can multiply back (value = qty × unit × (1 − discount)) */
const unitFor = (l, value) => Math.round((Number(value) / ((Number(l.qty) || 1) * (1 - (Number(l.discount_pct) || 0) / 100))) * 100) / 100;

/* Convert to deal: same record, now with a value and a closure date */
function convertModal(l, after) {
  const stages = S.open(l.funnel, 'deal');
  if (!stages.length) return toast(`${l.funnel} has no deal stages yet. An Admin adds them in Settings.`, true);
  const feeKnown = l.fee_disclosed || DB.t.price_disclosures.some((p) => p.lead_id === l.id);
  const m = openModal({ title: 'Convert to deal', width: 560,
    body: `<p class="faint" style="margin-top:0">${esc(l.name)} becomes a deal on the same record. Its remarks and history stay with it.</p><div class="form">
      ${fld('cv', 'Deal value ex-GST (₹)', inp('cv', l.value || '', 'number', 'min="0" step="1" required'))}${fld('cd', 'Expected closure date', inp('cd', l.expected_close || localDate(new Date(Date.now() + 30 * 864e5)), 'date', 'required'))}
      ${fld('cs', 'Deal stage', sel('cs', stages.map((s) => [s.key, `${s.key} · ${s.prob}%`]), stages[0].key))}
      <div class="full" id="cfee"></div></div>`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="cgo">Convert</button>' });
  const fee = () => { const s = S.get(l.funnel, v(m.el, 'cs')); m.el.querySelector('#cfee').innerHTML = s?.needs_fee && !feeKnown ? `<label class="check"><input type="checkbox" id="cfd" checked> I told the client this value + GST (records the fee disclosure "${esc(s.key)}" needs)</label>` : ''; };
  m.el.querySelector('#cs').onchange = fee; fee();
  m.el.querySelector('#cgo').onclick = () => guard(async () => {
    const val = num(m.el, 'cv'); const close = v(m.el, 'cd'); const to = v(m.el, 'cs');
    if (!(val > 0)) throw new Error('Enter the deal value.');
    if (!close) throw new Error('Choose the expected closure date.');
    if (v(m.el, 'cfd')) await DB.insert('price_disclosures', { lead_id: l.id, product_id: l.product_id || null, qty: l.qty || 1, unit_price: unitFor(l, val), discount_pct: l.discount_pct || 0, amount: val, gst_rate: l.gst_rate ?? 18, response: 'Accepted' });
    await DB.update('leads', l.id, { is_deal: true, stage: to, unit_price: unitFor(l, val), expected_close: close, ...(v(m.el, 'cfd') ? { fee_disclosed: true } : {}) });
    m.close(); after?.();
  }, 'Converted to a deal');
}

async function moveStage(l, to) {
  if (to === l.stage) return true;
  const patch = { stage: to }; const st = S.get(l.funnel, to);
  const g = stageGate(l, to);
  if (g === 'LOST_REASON') {
    const r = await promptBox('Why was it lost?', 'Loss reason', '', { options: lossReasons(l.funnel) });
    if (!r) return false; patch.lost_reason = r;
  } else if (g) { toast(g, true); return false; }
  if (st?.is_won && l.is_deal) {
    const fv = await promptBox(`Won · ${esc(l.name)}`, 'Final deal value ex-GST (₹)', String(Math.round(Number(l.value) || 0)));
    if (fv === null) return false;
    if (!(Number(fv) > 0)) { toast('Enter the final value.', true); return false; }
    if (Number(fv) !== Number(l.value)) patch.unit_price = unitFor(l, fv);
  }
  return !!(await guard(() => DB.update('leads', l.id, patch), `Moved to ${to}`));
}
function linkAccountModal(l, after) {
  const m = openModal({ title: 'Link an account', width: 520, body: `<div class="field"><label for="la">Company, college or government body</label><input id="la" list="lal" placeholder="Start typing; a new name creates the account"><datalist id="lal">${DB.t.institutions.map((i) => `<option value="${esc(i.name)}">${esc(i.city)}</option>`).join('')}</datalist></div>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="lago">Link</button>' });
  m.el.querySelector('#lago').onclick = () => guard(async () => { const nm = v(m.el, 'la').trim(); if (!nm) throw new Error('Enter a name.'); const i = DB.t.institutions.find((x) => x.name.toLowerCase() === nm.toLowerCase()) || await DB.insert('institutions', { name: nm, owner: l.owner || DB.me.id, kind: 'Corporate' }); await DB.update('leads', l.id, { institution_id: i.id }); m.close(); after?.(); }, 'Account linked');
}
function linkCampaignModal(l, after) {
  const m = openModal({ title: 'Campaign', width: 520, body: `<div class="field"><label for="lc">Which campaign brought this ${l.is_deal ? 'deal' : 'lead'}?</label><select id="lc">${campaignOptions(l.funnel, l.mkt_campaign_id)}</select></div>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="lcgo">Save</button>' });
  m.el.querySelector('#lcgo').onclick = () => guard(async () => { await DB.update('leads', l.id, { mkt_campaign_id: v(m.el, 'lc') || null }); m.close(); after?.(); }, 'Saved');
}

function tabOverview(l, el, ctx) {
  const isC = isOrgDept(l.funnel); const cl = courseList(l.funnel, isC ? l.sub_category : l.course);
  const facts = [['Sheet ID', l.ref_id], ['Enquiry date', l.enquiry_date && fmtDate(l.enquiry_date)], ['Allocated', l.allocated_date && fmtDate(l.allocated_date)], ['Owner (sheet)', !l.owner && l.owner_name ? l.owner_name + ' · no account yet' : ''],
    ['Call attempts', l.call_attempts || ''], ['Priority score', l.priority_score ?? ''], ['Why this tier', l.tier_reason], ['Location', l.city], ['Current status', l.latest_update && !isC ? l.latest_update : ''], ['Tier', l.campaign_tier], ['Audit', l.tier_source], ['Collected to date', Number(l.collected_import) ? inrFull(l.collected_import) : ''], ['Pending PO', Number(l.pending_po) ? inrFull(l.pending_po) : ''], ['Last follow-up', l.last_followup && fmtDate(l.last_followup)]].filter(([, x]) => x !== '' && x != null && x !== false);
  el.innerHTML = `${facts.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${facts.map(([k, x]) => `<span class="chip"><span class="faint">${k}:</span>&nbsp;${esc(x)}</span>`).join('')}</div>` : ''}
    ${l.latest_remark ? `<p style="margin:0 0 10px;font-size:13px"><span class="faint">Latest remark:</span> ${esc(l.latest_remark)}</p>` : ''}<div class="form">
    ${fld('oorg', 'Organisation / institution', inp('oorg', l.org || ''))}${fld('oname', isC ? 'Opportunity title' : 'Lead name', inp('oname', l.name))}
    ${fld('oinst', 'Account (company / institution)', `<select id="oinst">${opts(DB.t.institutions.map((i) => [i.id, i.name]), l.institution_id, 'None')}</select>`)}${!isC ? fld('ocity', 'City', pickSel('ocity', usedValues('city'), l.city)) : ''}
    ${isC ? fld('ocontact', 'Contact person', inp('ocontact', l.contact_name)) : ''}${isC ? fld('odesig', 'Designation', pickSel('odesig', [...CONTACT_ROLES, ...usedValues('designation')], l.designation)) : ''}
    ${fld('ophone', 'Phone', inp('ophone', l.phone, 'tel'))}${fld('oemail', 'Email', inp('oemail', l.email, 'email'))}
    ${fld('osrc', 'Source', sel('osrc', DB.settings.sources || [], l.source, '—'))}
    ${fld('ocamp', 'Campaign', `<select id="ocamp">${campaignOptions(l.funnel, l.mkt_campaign_id)}</select>`)}
    ${fld('oowner', 'Assigned to', `<select id="oowner" ${canReassign() ? '' : 'disabled'}>${opts([...assignablePeople(), ...(l.owner && !assignablePeople().some((p) => p.id === l.owner) && DB.profile(l.owner) ? [DB.profile(l.owner)] : [])].map((p) => [p.id, p.full_name]), l.owner)}</select>`)}
    ${l.is_deal ? fld('oclose', 'Expected closure date', inp('oclose', l.expected_close || '', 'date')) : ''}
    ${fld('otemp', 'Temperature', sel('otemp', TEMPS, l.temperature))}
    ${fld('oprod', 'Product / course', `<select id="oprod">${productOptions(l.funnel, l.product_id)}</select>`)}
    ${fld('oqty', 'Quantity', inp('oqty', l.qty, 'number', 'min="1"'))}
    ${fld('ounit', 'Unit price ex-GST (₹)', inp('ounit', l.unit_price, 'number', 'min="0"'), '')}${fld('odisc', 'Discount %', inp('odisc', l.discount_pct, 'number', `min="0" max="100" step="0.5"`))}
    <div class="full" id="oprice"></div>
    ${isC ? (cl.length ? fld('osub', 'Interested in', sel('osub', cl, l.sub_category || cl[0])) : '') + fld('oalso', 'Also interested in', pickSel('oalso', cl, l.also_interested, 'Nothing else')) + fld('octype', 'Client type', pickSel('octype', [...new Set(['End User', 'Institution', 'Corporate', 'Government', 'Reseller / partner', 'Collaboration', 'Student', ...usedValues('client_type')])], l.client_type)) + fld('opo', 'PO / contract reference', inp('opo', l.po_ref)) + fld('oupd', 'Latest update', inp('oupd', l.latest_update), 'full') : ''}
    ${fld('oeng', 'Engagement status', sel('oeng', [...new Set([...ENGAGEMENT, l.engagement].filter(Boolean))], l.engagement, '—'))}
    ${!isC ? `${fld('oage', 'Age', inp('oage', l.age ?? '', 'number'))}${fld('oedu', 'Education', pickSel('oedu', [...new Set(['10th', '12th', 'ITI', 'Diploma', 'Undergraduate', 'Postgraduate', 'Other', ...usedValues('education')])], l.education))}
      ${fld('oelig', 'Eligibility', sel('oelig', ['Unknown', 'Eligible', 'Not eligible'], l.eligible))}${fld('ocentre', 'Preferred centre', sel('ocentre', DB.settings.centres || [], l.preferred_centre, 'Any'))}
      ${cl.length ? fld('ocourse', 'Course / interest', sel('ocourse', cl, l.course || cl[0])) : ''}
      ${fld('olang', 'Language', sel('olang', LANGS, l.language, 'Not captured'))}
      ${fld('otier', 'Campaign tier', sel('otier', [...new Set([...TIERS, l.campaign_tier].filter(Boolean))], l.campaign_tier, '—'))}
      ${isFinance() ? fld('ofree', 'Admission', `<label class="check"><input type="checkbox" id="ofree" ${l.free_seat ? 'checked' : ''}> Free seat (counted as a free admission)</label>`) : ''}
      ${fld('ocert', 'Certificate', sel('ocert', ['Not started', 'In training', 'Completed', 'Issued'], l.certificate))}
      <div class="full"><label class="faint" style="font-size:11.5px;font-weight:600">Documents</label><div class="row">${Object.entries(DOCS).map(([k, t]) => `<label class="check"><input type="checkbox" class="odoc" value="${k}" ${l.documents?.[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>` : ''}
    <div class="full row"><label class="check"><input type="checkbox" id="oce" ${l.consent_email ? 'checked' : ''}> Email consent</label><label class="check"><input type="checkbox" id="ocw" ${l.consent_whatsapp ? 'checked' : ''}> WhatsApp opt-in</label>${l.opted_out ? '<span class="chip bad">Unsubscribed</span>' : ''}</div>
    ${canReassign() ? `${fld('osup', 'Support credit', `<select id="osup">${opts(scopePeople().map((p) => [p.id, p.full_name]), l.support_by, 'None')}</select>`)}${fld('oclby', 'Closing credit', `<select id="oclby">${opts(scopePeople().map((p) => [p.id, p.full_name]), l.closed_by, 'Not closed')}</select>`)}` : ''}
    ${fld('onotes', 'Notes', `<textarea id="onotes">${esc(l.notes)}</textarea>`, 'full')}
  </div><div class="row" style="justify-content:flex-end"><button class="btn primary" id="osave">Save details</button></div>
  <div id="orefs"></div>`;
  referralBox(l, el.querySelector('#orefs'), () => ctx.render());
  const pr = () => { const p = DB.get('products', v(el, 'oprod')); el.querySelector('#oprice').innerHTML = pricePanel(p, num(el, 'oqty') || 1, num(el, 'odisc'), v(el, 'ounit')); };
  el.querySelector('#oprod').onchange = () => { const p = DB.get('products', v(el, 'oprod')); el.querySelector('#ounit').value = priceFor(p, num(el, 'oqty') || 1); pr(); };
  el.querySelector('#oqty').oninput = () => { const p = DB.get('products', v(el, 'oprod')); if (p) el.querySelector('#ounit').value = priceFor(p, num(el, 'oqty') || 1); pr(); };
  ['ounit', 'odisc'].forEach((id) => (el.querySelector('#' + id).oninput = pr)); pr();
  el.querySelector('#osave').onclick = () => guard(async () => {
    const disc = num(el, 'odisc'); if (disc !== Number(l.discount_pct) && (await discountBlocked(l, disc))) return;
    const p = DB.get('products', v(el, 'oprod'));
    const patch = { org: (v(el, 'oorg') || '').trim(), name: v(el, 'oname'), institution_id: v(el, 'oinst') || null, phone: v(el, 'ophone'), email: v(el, 'oemail'), source: v(el, 'osrc'), mkt_campaign_id: v(el, 'ocamp') || null, temperature: v(el, 'otemp'), product_id: p?.id || null, qty: num(el, 'oqty') || 1, unit_price: num(el, 'ounit'), discount_pct: disc, gst_rate: p?.gst_rate ?? l.gst_rate, share_pct: p?.share_pct ?? l.share_pct, consent_email: v(el, 'oce'), consent_whatsapp: v(el, 'ocw'), notes: v(el, 'onotes') };
    if (!el.querySelector('#oowner').disabled && v(el, 'oowner')) patch.owner = v(el, 'oowner');
    if (l.is_deal) patch.expected_close = v(el, 'oclose') || null;
    patch.engagement = v(el, 'oeng') || '';
    if (isC) Object.assign(patch, { contact_name: v(el, 'ocontact'), designation: v(el, 'odesig'), po_ref: v(el, 'opo'), sub_category: v(el, 'osub') ?? l.sub_category, also_interested: v(el, 'oalso'), client_type: v(el, 'octype'), latest_update: v(el, 'oupd') });
    else Object.assign(patch, { course: v(el, 'ocourse') ?? l.course, language: v(el, 'olang') || '', campaign_tier: v(el, 'otier') || '', ...(el.querySelector('#ofree') ? { free_seat: v(el, 'ofree') } : {}), city: v(el, 'ocity'), age: v(el, 'oage') ? num(el, 'oage') : null, education: v(el, 'oedu'), eligible: v(el, 'oelig'), preferred_centre: v(el, 'ocentre'), certificate: v(el, 'ocert'), documents: Object.fromEntries($$('.odoc', el).map((c) => [c.value, c.checked])) });
    if (canReassign()) Object.assign(patch, { support_by: v(el, 'osup') || null, closed_by: v(el, 'oclby') || null });
    await DB.update('leads', l.id, patch); ctx.render();
  }, 'Saved');
}

function tabRemarks(l, el, ctx) {
  const cad = (DB.settings.cadence || {})[l.funnel] || [0, 1, 3, 7];
  const rem = L.remarks(l).slice().reverse();
  const prod = L.product(l);
  el.innerHTML = `<section class="glass panel" style="padding:12px"><h3 style="margin-bottom:8px">Log a call or remark</h3><div class="form three">
      ${fld('rch', 'Channel', sel('rch', CHANNELS, 'Outbound call'))}${fld('rout', 'Outcome', sel('rout', OUTCOMES, 'Interested'))}${fld('rtemp', 'Temperature', sel('rtemp', TEMPS, l.temperature))}
      ${fld('rtext', 'Remark', `<textarea id="rtext" placeholder="What was said, objections, what you promised" required></textarea>`, 'full')}
      <div class="full row"><label class="check"><input type="checkbox" id="rfee" ${l.fee_disclosed ? '' : ''}> I disclosed the fee with GST on this call</label>
        <input id="rprice" type="number" style="width:150px" placeholder="Price quoted ₹" value="${l.unit_price || ''}" aria-label="Price quoted"><span class="faint" style="font-size:12px">${prod ? `${esc(prod.name)}: ${inrFull(l.unit_price)} + GST = ${inrFull(l.unit_price * (1 + l.gst_rate / 100))}` : 'No product chosen yet'}</span></div>
      ${fld('rnext', 'Next follow-up', inp('rnext', '', 'datetime-local'))}
      <div class="field"><label>Quick pick</label><div class="row">${cad.filter((d) => d > 0).map((d) => `<button class="btn small" data-plus="${d}">+${d} day${d > 1 ? 's' : ''}</button>`).join('')}<button class="btn small" data-plus="0.125">+3 h</button></div></div>
      <div class="field" style="justify-content:flex-end"><button class="btn primary" id="rsave">Save remark</button></div></div>
      <p class="faint" style="font-size:11.5px;margin:6px 0 0">The time is stamped by the server when you save and cannot be changed. Edits keep the original text.</p></section>
    <div class="row between"><h3>${rem.length} remark${rem.length === 1 ? '' : 's'}</h3><span class="faint" style="font-size:12px">First contact ${l.first_contact_at ? fmtDT(l.first_contact_at) + ` (${Math.round((new Date(l.first_contact_at) - new Date(l.created_at)) / 60000)} min after enquiry)` : 'not yet'}</span></div>
    <div id="shist"></div>
    <div class="tl">${rem.map((r) => { const edits = DB.t.remark_edits.filter((e) => e.remark_id === r.id); return `<div class="ev ${CALL_CH(r.channel) ? 'call' : r.channel === 'Email' ? 'mail' : ''}">
      <div class="when"><b class="mono">${new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</b> · ${esc(DB.pname(r.author))} · ${esc(r.channel)}</div>
      <div class="what"><span class="chip ${CONNECTED(r.outcome) ? 'acc' : ''}">${esc(r.outcome)}</span> ${esc(r.text)} ${r.fee_disclosed ? `<span class="chip good">fee disclosed${r.price_quoted ? ' · ' + inrFull(r.price_quoted) : ''}</span>` : ''}${r.next_followup_at ? ` <span class="chip">next ${fmtDT(r.next_followup_at)}</span>` : ''}
      ${r.author === DB.me.id || isHead() ? ` <button class="btn ghost small" data-edit="${r.id}">Edit</button>` : ''}${edits.length ? `<details style="margin-top:4px"><summary class="faint" style="font-size:12px;cursor:pointer">Edited ${edits.length}×</summary>${edits.map((e) => `<div class="faint" style="font-size:12px">${fmtDT(e.edited_at)} · ${esc(DB.pname(e.edited_by))}: was “${esc(e.old_text)}” (${esc(e.old_outcome)})</div>`).join('')}</details>` : ''}</div></div>`; }).join('') || empty('No remarks yet', 'Log the first call above.')}</div>`;
  if (l.imported) DB.history(l.id).then((t) => { const box = el.querySelector('#shist'); if (box && t) box.innerHTML = `<details open style="margin:6px 0 12px"><summary class="faint" style="cursor:pointer;font-size:12.5px">Call history from the sales sheet</summary><div class="hist">${esc(t)}</div></details>`; }).catch(() => {});
  el.querySelectorAll('[data-plus]').forEach((b) => (b.onclick = () => { const d = new Date(Date.now() + Number(b.dataset.plus) * 86400e3); if (Number(b.dataset.plus) >= 1) d.setHours(11, 0, 0, 0); el.querySelector('#rnext').value = dtLocal(d.toISOString()); }));
  el.querySelector('#rout').onchange = (e) => { if (e.target.value === 'Counselled') el.querySelector('#rfee').checked = true; };
  el.querySelector('#rsave').onclick = () => guard(async () => {
    const text = v(el, 'rtext').trim(); if (!text) throw new Error('Write what happened on the call');
    const fee = v(el, 'rfee');
    if (v(el, 'rout') === 'Counselled' && !fee && dept(l.funnel).has_admissions && !l.fee_disclosed) throw new Error('Counselling must include the fee with GST. Tick the fee box and enter the price.');
    await DB.insert('remarks', { lead_id: l.id, channel: v(el, 'rch'), outcome: v(el, 'rout'), text, temperature: v(el, 'rtemp'), fee_disclosed: fee, price_quoted: fee ? num(el, 'rprice') || null : null, next_followup_at: fromLocal(v(el, 'rnext')) });
    if (fee && num(el, 'rprice') && !DB.t.price_disclosures.some((d) => d.lead_id === l.id && daysAgo(d.disclosed_at) === 0)) {
      const p = L.product(l); await DB.insert('price_disclosures', { lead_id: l.id, product_id: p?.id || null, qty: l.qty, unit_price: num(el, 'rprice'), discount_pct: l.discount_pct, amount: Math.round(l.qty * num(el, 'rprice') * (1 - (l.discount_pct || 0) / 100)), gst_rate: l.gst_rate, response: '' });
    }
    await autoStatus(l, v(el, 'rout'));
    await DB.refreshLead(l.id);
    ctx.render();
  }, 'Remark saved');
  el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => { const r = DB.get('remarks', b.dataset.edit); const t = await promptBox('Edit remark', 'Remark text (the original is kept in history)', r.text); if (t !== null && t !== r.text) await guard(() => DB.update('remarks', r.id, { text: t }), 'Edited'); ctx.render(); }));
}

function quoteModal(l, after) {
  const m = openModal({
    title: 'Disclose price', width: 760,
    body: `<p class="faint" style="margin:0">Records the price you quoted, adds it to enquired value and marks the fee as disclosed.</p><div class="form">
      ${fld('qprod', 'Product', `<select id="qprod">${productOptions(l.funnel, l.product_id)}</select>`)}${fld('qqty', 'Quantity', inp('qqty', l.qty, 'number', 'min="1"'))}
      ${fld('qunit', 'Unit price ex-GST', inp('qunit', l.unit_price || '', 'number'))}${fld('qdisc', 'Discount %', inp('qdisc', l.discount_pct, 'number', `min="0" max="100" step="0.5"`))}
      <div class="full" id="qprice"></div>${fld('qresp', 'Their response', sel('qresp', RESPONSES, 'Thinking'))}<label class="check" style="align-self:end"><input type="checkbox" id="qupd" checked> Update the lead's product and value</label></div>`,
    foot: `<button class="btn" data-c>Cancel</button><button class="btn primary" id="qsave">Record disclosure</button>`,
  });
  const pr = () => m.el.querySelector('#qprice').innerHTML = pricePanel(DB.get('products', v(m.el, 'qprod')), num(m.el, 'qqty') || 1, num(m.el, 'qdisc'), v(m.el, 'qunit'));
  m.el.querySelector('#qprod').onchange = () => { m.el.querySelector('#qunit').value = priceFor(DB.get('products', v(m.el, 'qprod')), num(m.el, 'qqty') || 1); pr(); };
  m.el.querySelector('#qqty').oninput = () => { m.el.querySelector('#qunit').value = priceFor(DB.get('products', v(m.el, 'qprod')), num(m.el, 'qqty') || 1); pr(); };
  ['qunit', 'qdisc'].forEach((id) => (m.el.querySelector('#' + id).oninput = pr)); pr();
  m.el.querySelector('[data-c]').onclick = m.close;
  m.el.querySelector('#qsave').onclick = () => guard(async () => {
    const p = DB.get('products', v(m.el, 'qprod')); const qty = num(m.el, 'qqty') || 1; const unit = num(m.el, 'qunit'); const disc = num(m.el, 'qdisc');
    if (disc > Number(l.discount_pct || 0) && (await discountBlocked(l, disc))) return;
    if (!unit) throw new Error('Enter the unit price');
    const amount = Math.round(qty * unit * (1 - disc / 100));
    await DB.insert('price_disclosures', { lead_id: l.id, product_id: p?.id || null, qty, unit_price: unit, discount_pct: disc, amount, gst_rate: p?.gst_rate ?? 18, response: v(m.el, 'qresp') });
    if (v(m.el, 'qupd')) await DB.update('leads', l.id, { product_id: p?.id || null, qty, unit_price: unit, discount_pct: disc, gst_rate: p?.gst_rate ?? l.gst_rate, share_pct: p?.share_pct ?? l.share_pct, fee_disclosed: true });
    await DB.insert('remarks', { lead_id: l.id, channel: 'Note', outcome: 'Note', text: `Price disclosed: ${p?.name || 'product'} × ${qty} = ${inrFull(amount)} + GST. Response: ${v(m.el, 'qresp')}`, fee_disclosed: true, price_quoted: unit });
    m.close(); after?.();
  }, 'Price disclosure recorded');
}

function tabMoney(l, el, ctx) {
  const pays = DB.t.payments.filter((p) => p.lead_id === l.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const pds = DB.t.price_disclosures.filter((p) => p.lead_id === l.id).sort((a, b) => b.disclosed_at.localeCompare(a.disclosed_at));
  const verified = L.paidEx(l), claimed = L.claimedEx(l);
  el.innerHTML = `<div class="kpis">${kpi({ label: 'Deal value ex-GST', value: inr(l.value), sub: `${inr(L.gross(l))} incl. GST` })}${kpi({ label: 'Verified', value: inr(verified), sub: 'Finance confirmed' })}${kpi({ label: 'Awaiting verification', value: inr(claimed) })}${kpi({ label: 'Not collected', value: inr(L.won(l) ? Math.max(0, l.value - verified) : 0), sub: L.won(l) ? `won ${fmtDate(l.won_at)}` : 'Counts once won' })}</div>
    <section><div class="row between"><h3>Price disclosures (enquired value)</h3><button class="btn small" id="mq">Disclose price</button></div>
    ${pds.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>By</th><th>Product</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Disc.</th><th class="n">Amount ex-GST</th><th>Response</th></tr></thead><tbody>${pds.map((d) => `<tr><td>${fmtDT(d.disclosed_at)}</td><td>${esc(DB.pname(d.disclosed_by))}</td><td>${esc(DB.get('products', d.product_id)?.name || '')}</td><td class="n">${d.qty}</td><td class="n">${inrFull(d.unit_price)}</td><td class="n">${d.discount_pct || 0}%</td><td class="n">${inrFull(d.amount)}</td><td>${esc(d.response)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="faint">No price disclosed yet.</p>'}</section>
    <section><div class="row between"><h3>Payments</h3></div>
    ${pays.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Milestone</th><th>Mode / ref</th><th class="n">Received</th><th class="n">Ex-GST</th><th>Status</th><th></th></tr></thead><tbody>${pays.map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${esc(p.milestone)}</td><td>${esc(p.mode)} ${esc(p.reference)}</td><td class="n">${inrFull(p.amount)}</td><td class="n">${inrFull(p.amount_ex)}</td><td><span class="chip ${p.status === 'Verified' ? 'good' : p.status === 'Claimed' ? 'warn' : 'bad'}">${p.status}</span><div class="s">${p.status === 'Verified' ? 'by ' + esc(DB.pname(p.verified_by)) : 'claimed by ' + esc(DB.pname(p.claimed_by))}</div></td><td class="n">${isFinance() && p.status === 'Claimed' ? `<button class="btn small good" data-ver="${p.id}">Verify</button> <button class="btn small danger" data-rej="${p.id}">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="faint">No payments recorded.</p>'}
    <div class="glass panel" style="padding:12px;margin-top:10px"><h4>Record a payment received</h4><div class="form three" style="margin-top:8px">
      ${fld('pamt', 'Amount received incl. GST (₹)', inp('pamt', '', 'number', 'min="0"'))}${fld('pdate', 'Date received', inp('pdate', todayStr(), 'date'))}${fld('pmile', 'Milestone', sel('pmile', isOrgDept(l.funnel) ? ['Advance 40%', 'Delivery 40%', 'Final 20%', 'Full payment', 'Other'] : ['Full fee', 'Part payment', 'Balance', 'Other'], ''))}
      ${fld('pmode', 'Mode', sel('pmode', ['UPI', 'Bank transfer', 'Card', 'Cheque', 'Cash', 'Payment gateway'], 'UPI'))}${fld('pref', 'Reference / UTR', inp('pref'))}<div class="field" style="justify-content:flex-end"><button class="btn primary" id="psave">${isFinance() ? 'Record as verified' : 'Submit for verification'}</button></div></div>
      <p class="faint" style="font-size:12px;margin:6px 0 0" id="pex"></p></div></section>`;
  el.querySelector('#mq').onclick = () => quoteModal(l, () => ctx.render());
  el.querySelector('#pamt').oninput = () => { const a = num(el, 'pamt'); el.querySelector('#pex').textContent = a ? `Ex-GST portion at ${l.gst_rate}% GST: ${inrFull(a / (1 + l.gst_rate / 100))}` : ''; };
  el.querySelector('#psave').onclick = () => guard(async () => {
    const a = num(el, 'pamt'); if (!a) throw new Error('Enter the amount received');
    await DB.insert('payments', { lead_id: l.id, amount: a, amount_ex: Math.round((a / (1 + l.gst_rate / 100)) * 100) / 100, paid_on: v(el, 'pdate'), milestone: v(el, 'pmile'), mode: v(el, 'pmode'), reference: v(el, 'pref'), status: isFinance() ? 'Verified' : 'Claimed' });
    await DB.refreshLead(l.id); ctx.render();
  }, isFinance() ? 'Payment verified' : 'Sent to Finance for verification');
  el.querySelectorAll('[data-ver]').forEach((b) => (b.onclick = () => guard(async () => { await DB.update('payments', b.dataset.ver, { status: 'Verified' }); ctx.render(); }, 'Verified')));
  el.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => guard(async () => { await DB.update('payments', b.dataset.rej, { status: 'Rejected' }); ctx.render(); }, 'Rejected')));
}

function tabEmails(l, el, ctx) {
  const ems = DB.t.email_queue.filter((e) => e.lead_id === l.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  el.innerHTML = `<div class="row between"><h3>${ems.length} email${ems.length === 1 ? '' : 's'}</h3>${canEmail() ? `<button class="btn primary small" id="ecomp" ${!l.email ? 'disabled' : ''}>${svg('send')} Write email</button>` : '<span class="faint" style="font-size:12px">Ask the Business Head for email marketing access to send from the CRM.</span>'}</div>
    ${!l.email ? '<div class="note">No email address on this lead.</div>' : ''}${l.opted_out ? '<div class="note">This contact unsubscribed. Only internal updates will be sent.</div>' : ''}
    ${ems.length ? `<div class="tablewrap"><table><thead><tr><th>Created</th><th>Subject</th><th>Category</th><th>Status</th><th>Opened</th><th>Replied</th></tr></thead><tbody>${ems.map((e) => `<tr><td>${fmtDT(e.created_at)}<div class="s">${esc(DB.pname(e.created_by))}${e.auto_rule ? ' · auto' : ''}</div></td><td>${esc(e.subject)}</td><td>${esc(e.category)}</td><td><span class="chip ${e.status === 'Sent' ? 'good' : e.status === 'Failed' ? 'bad' : 'warn'}">${e.status}</span>${e.bounced_at ? ' <span class="chip bad">bounced</span>' : ''}</td><td>${e.opened_at ? fmtDT(e.opened_at) : '—'}</td><td>${e.replied_at ? `<span class="chip good">${fmtDT(e.replied_at)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  el.querySelector('#ecomp')?.addEventListener('click', () => composeEmail({ leadIds: [l.id], title: l.name, after: () => ctx.render() }));
}

function tabWork(l, el, ctx) {
  const visits = DB.t.visits.filter((x) => x.lead_id === l.id || (l.institution_id && x.institution_id === l.institution_id)).sort((a, b) => String(b.planned_at).localeCompare(String(a.planned_at)));
  el.innerHTML = `<div class="row between"><h3>Meetings</h3><button class="btn small" id="wv">${svg('plus')} Plan meeting</button></div><div class="list">${visits.map(visitItem).join('') || '<p class="faint">No meetings yet.</p>'}</div>`;
  el.querySelector('#wv').onclick = () => visitModal({ lead_id: l.id, institution_id: l.institution_id }, () => ctx.render());
  el.querySelectorAll('[data-visit]').forEach((b) => (b.onclick = () => visitModal(DB.get('visits', b.dataset.visit), () => ctx.render())));
}

function tabAI(l, el, ctx) {
  const last = ctx.aiResult;
  el.innerHTML = `<div class="ai-card"><div class="row between"><h3>Claude's assessment</h3><button class="btn small" id="ascore">${svg('ai')} Score now</button></div>
      ${l.ai_score != null ? `<div class="row" style="margin-top:8px">${scoreBadge(l)}<b>${esc(l.ai_band || '')}</b><span class="faint" style="font-size:12px">scored ${rel(l.ai_scored_at)}${l.ai_dirty ? ' · new activity since' : ''}</span></div><p style="margin:8px 0 4px">${esc(l.ai_summary || '')}</p><p style="margin:0"><b>Next best action:</b> ${esc(l.ai_next_action || '')} ${l.ai_channel ? `<span class="chip">${esc(l.ai_channel)}</span>` : ''}</p>` : '<p class="muted">Not scored yet.</p>'}
      ${last ? `<div class="grid g3" style="margin-top:10px">${[['Intent signals', last.intent_signals], ['Objections', last.objections], ['Risks', last.risks]].map(([h, a]) => `<div><h4>${h}</h4><ul style="padding-left:18px;margin:4px 0;font-size:12.5px">${(a || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="faint">None</li>'}</ul></div>`).join('')}</div>${last.suggested_stage && last.suggested_stage !== l.stage ? `<div class="note" style="margin-top:8px">Claude thinks the remarks support stage “${esc(last.suggested_stage)}”.</div>` : ''}` : ''}</div>
    <div class="glass panel" style="padding:12px"><h3>Draft a message</h3><div class="form three" style="margin-top:8px">${fld('ach', 'Channel', sel('ach', ['WhatsApp', 'Email'], l.consent_whatsapp ? 'WhatsApp' : 'Email'))}${fld('apur', 'Purpose', sel('apur', ['Move to the next stage', 'Collect payment', 'Re-engage after silence', 'Share batch dates', 'Answer fee objection', 'Book a campus meeting', 'Thank and ask for referral'], ''))}<div class="field" style="justify-content:flex-end"><button class="btn primary" id="adraft">Write it</button></div></div><div id="aout"></div></div>`;
  el.querySelector('#ascore').onclick = () => guard(async () => { el.querySelector('#ascore').disabled = true; ctx.aiResult = await DB.fn('ai', { action: 'score', lead_id: l.id }); await DB.refreshLead(l.id); ctx.render(); }, 'Scored');
  el.querySelector('#adraft').onclick = () => guard(async () => {
    const out = el.querySelector('#aout'); out.innerHTML = '<p class="muted">Writing…</p>';
    const ch = v(el, 'ach'); const r = await DB.fn('ai', { action: 'draft', lead_id: l.id, channel: ch, purpose: v(el, 'apur') });
    out.innerHTML = `<div class="stack" style="margin-top:10px">${r.subject ? `<input id="adsub" value="${esc(r.subject)}">` : ''}<textarea id="adbody" style="min-height:160px">${esc(ch === 'Email' ? r.body.replace(/<\/p>\s*<p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '') : r.body)}</textarea><span class="faint" style="font-size:12px">${esc(r.why || '')}</span>
      <div class="row"><button class="btn small" id="acopy">Copy</button>${ch === 'WhatsApp' && l.phone ? `<a class="btn small" id="awa" target="_blank" rel="noopener">Open in WhatsApp</a>` : ''}${ch === 'Email' && canEmail() && l.email ? '<button class="btn small primary" id="aq">Send from the CRM</button>' : ''}</div></div>`;
    const body = () => el.querySelector('#adbody').value;
    el.querySelector('#acopy').onclick = () => navigator.clipboard.writeText(body()).then(() => toast('Copied'), () => { el.querySelector('#adbody').select(); toast('Press Ctrl+C to copy'); });
    const wa = el.querySelector('#awa'); if (wa) { const upd = () => (wa.href = `https://wa.me/91${l.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(body())}`); upd(); el.querySelector('#adbody').oninput = upd; }
    el.querySelector('#aq')?.addEventListener('click', () => guard(async () => { await DB.insert('email_queue', { lead_id: l.id, to_email: l.email, to_name: l.contact_name || l.name, category: 'Follow-up', subject: el.querySelector('#adsub').value, html: body().split(/\n\n+/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''), sender: DB.settings.email?.senders?.['Follow-up'] || '' }); }, 'Queued. The mailer sends it within a minute.'));
  });
}

/* the sheet's "All Remarks (date-wise)" as dated entries: "3 JAN - RNR" lines, the year taken from the enquiry date and moved on when the months wrap */
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function sheetRemarks(text, l) {
  const out = []; let y = new Date(l.enquiry_date || l.created_at || Date.now()).getFullYear(); let last = null;
  String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).forEach((line) => {
    const m = line.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s./-]*([A-Za-z]{3,9})\.?[\s,./-]*(\d{4}|\d{2})?\s*[-–:]\s*(.*)$/) || line.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s*[-–:]?\s*(.*)$/);
    if (!m) { if (last) last.text += ' ' + line; else out.push(last = { at: null, text: line }); return; }
    const mi = isNaN(m[2]) ? MON[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)] : Number(m[2]) - 1;
    if (mi == null) { if (last) last.text += ' ' + line; return; }
    if (m[3]) y = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
    let d = new Date(y, mi, Number(m[1]), 12);
    if (!m[3] && last?.at && d < new Date(last.at) - 40 * 864e5) { y += 1; d = new Date(y, mi, Number(m[1]), 12); }
    out.push(last = { at: d.toISOString(), text: m[4] || '' });
  });
  return out;
}
async function tabHistory(l, el) {
  el.innerHTML = '<p class="muted">Loading…</p>';
  /* only what the team did: calls, remarks, notes, visits, emails, money and tasks. Field edits are not shown. */
  const ev = [];
  const sheetBy = (typeof personFrom === 'function' && personFrom(l.sheet_owner)?.full_name) || l.sheet_owner || l.owner_name || 'Sales sheet';
  let sheetRows = l.imported ? await DB.sheetRemarks(l.id) : [];
  if (l.imported && (!sheetRows || !sheetRows.length)) { const txt = await DB.history(l.id); sheetRows = sheetRemarks(txt, l).map((x) => ({ created_at: x.at || l.enquiry_date || l.created_at, text: x.text, author: l.owner, outcome: '' })); }
  const sheet = sheetRows.length;
  sheetRows.forEach((x) => ev.push({ at: x.created_at, day: true, cls: 'sheet', html: `<b>${esc(x.author ? DB.pname(x.author) : sheetBy)}</b> <span class="chip">Sales sheet</span>${x.outcome && !['Spoke', 'Note'].includes(x.outcome) ? ` <span class="chip tone ${x.outcome === 'No answer' ? 'warn' : x.outcome === 'Not interested' ? 'bad' : 'info'}">${esc(x.outcome)}</span>` : ''} ${esc(x.text)}` }));
  if (l.referred_by) { const rf = DB.get('leads', l.referred_by); ev.push({ at: l.created_at, cls: 'money', html: `<b>Referral</b> from ${rf ? `<button class="lnk" data-lead="${rf.id}">${esc(rf.name)}</button>` : 'a client'}${l.referral_by ? ` · brought in by ${esc(DB.pname(l.referral_by))}` : ''}` }); }
  DB.t.leads.filter((x) => x.referred_by === l.id).forEach((x) => ev.push({ at: x.created_at, cls: 'money', html: `<b>${esc(DB.pname(x.referral_by || x.created_by))}</b> added a referral: <button class="lnk" data-lead="${x.id}">${esc(x.name)}</button>${x.org ? ' · ' + esc(x.org) : ''}` }));
  L.remarks(l).forEach((r) => ev.push({ at: r.created_at, cls: r.channel === 'Note' ? 'note' : 'call', html: r.channel === 'Note' ? `<b>${esc(DB.pname(r.author))}</b> <span class="chip acc">Note</span> ${esc(r.text)}` : `<b>${esc(DB.pname(r.author))}</b> · ${esc(r.channel)} · <span class="chip">${esc(r.outcome)}</span> ${esc(r.text)}` }));
  DB.t.price_disclosures.filter((p) => p.lead_id === l.id).forEach((p) => ev.push({ at: p.disclosed_at, cls: '', html: `${esc(DB.pname(p.disclosed_by))} disclosed <b>${inrFull(p.amount)}</b> + GST` }));
  DB.t.payments.filter((p) => p.lead_id === l.id).forEach((p) => { ev.push({ at: p.claimed_at || p.paid_on, cls: 'money', html: `Payment ${inrFull(p.amount)} recorded by ${esc(DB.pname(p.claimed_by))}` }); if (p.verified_at) ev.push({ at: p.verified_at, cls: 'money', html: `Payment verified by ${esc(DB.pname(p.verified_by))}` }); });
  DB.t.email_queue.filter((e) => e.lead_id === l.id).forEach((e) => ev.push({ at: e.sent_at || e.created_at, cls: 'mail', html: `Email “${esc(e.subject)}” ${esc(e.status.toLowerCase())}` }));
  DB.t.visits.filter((x) => x.lead_id === l.id).forEach((x) => { ev.push({ at: x.created_at, cls: '', html: `Meeting planned by ${esc(DB.pname(x.created_by || x.owner))}: <b>${esc(x.purpose)}</b> on ${fmtDT(x.planned_at)} · ${esc(DB.pname(x.owner))}` }); (x.history || []).forEach((h) => ev.push({ at: h.at, cls: '', html: `Meeting rescheduled from ${fmtDT(h.from)}${h.reason ? ' · ' + esc(h.reason) : ''}` })); if (x.status === 'Done') ev.push({ at: x.checkin_at || x.planned_at, cls: 'call', html: `Meeting done · <b>${esc(x.outcome || '')}</b>${x.next_step ? ' · next: ' + esc(x.next_step) : ''}` }); });
  if (l.deal_at) ev.push({ at: l.deal_at, cls: 'money', html: '<b>Converted to a deal</b>' });
  DB.t.work_tasks.filter((t) => t.lead_id === l.id).forEach((t) => {
    ev.push({ at: t.created_at, cls: 'sys', html: `Task <b>${esc(t.title)}</b> added by ${esc(DB.pname(t.created_by))} for ${esc(DB.pname(t.owner))}${t.due_date ? ', due ' + fmtDate(t.due_date) : ''}` });
    taskSubs(t.id).filter((x) => x.done).forEach((x) => ev.push({ at: x.done_at, cls: 'money', html: `${esc(DB.pname(x.done_by))} completed “${esc(x.title)}” (${esc(t.title)})${x.work_done ? ': ' + esc(x.work_done) : ''}` }));
    (t.updates || []).forEach((u) => ev.push({ at: u.at, cls: '', html: `${esc(DB.pname(u.by))} on <b>${esc(t.title)}</b>: ${esc(u.text)}` }));
  });
  DB.t.complaints.filter((c) => c.lead_id === l.id).forEach((c) => ev.push({ at: c.created_at, cls: '', html: `Escalation raised: <b>${esc(c.title || c.category)}</b> · ${esc(c.severity)} · ${esc(c.status)}` }));
  ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const days = groupBy(ev, (x) => localDate(x.at));
  el.innerHTML = `<section class="glass panel notebox"><h3>${svg('note')} Add a note or remark</h3>
      <textarea id="nbtext" rows="3" placeholder="What happened, what was agreed, what to do next. It is saved under your name with today's date."></textarea>
      <div class="row between"><span class="faint" style="font-size:12px">${esc(DB.me?.full_name || '')} · ${fmtDate(todayStr())}</span><button class="btn primary small" id="nbsave">${svg('plus')} Save to activity</button></div></section>
    <div class="row between" style="margin:4px 2px 2px"><h3>Activity</h3><span class="faint" style="font-size:12px">${nfmt(ev.length)} entries${sheet ? ' · includes the sales sheet remarks' : ''}</span></div>
    <div class="tl daytl">${Object.entries(days).map(([d, a]) => `<div class="tlday"><span class="tld">${fmtDate(d)}</span></div>${a.map((x) => `<div class="ev ${x.cls}"><div class="when">${x.day ? fmtDate(x.at) : new Date(x.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div><div class="what">${x.html}</div></div>`).join('')}`).join('') || '<p class="faint">Nothing yet.</p>'}</div>`;
  el.querySelector('#nbsave').onclick = () => guard(async () => {
    const text = (el.querySelector('#nbtext').value || '').trim(); if (!text) throw new Error('Write the note first.');
    await DB.insert('remarks', { lead_id: l.id, channel: 'Note', outcome: 'Note', text });
    tabHistory(DB.get('leads', l.id) || l, el);
  }, 'Saved to activity');
  el.querySelectorAll('button[data-lead]').forEach((b) => (b.onclick = () => openLead(b.dataset.lead)));
}

