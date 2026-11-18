/* Garuda CRM · Marketing → Ad Campaigns and Other Campaigns (webinars, expos, referrals, WhatsApp, seminars, custom types) */
'use strict';

const AD_PLATFORMS = ['Meta (Facebook / Instagram)', 'Google Ads', 'LinkedIn', 'YouTube', 'Other'];
const CAMP_STATUS = ['Planned', 'Active', 'Paused', 'Completed'];
const CF = { q: '', status: '', type: '' };
const campTypes = () => (DB.t.campaign_types || []).slice().sort((a, b) => a.ord - b.ord || a.name.localeCompare(b.name));
const campType = (name) => campTypes().find((t) => t.name === name) || { name, fields: [] };
/* every number for one campaign; the period limits leads by lead date and spend by spend date */
function campStats(c, r) {
  const ls = visibleLeads().filter((l) => l.mkt_campaign_id === c.id);
  const lr = r ? ls.filter((l) => M.inR(l.enquiry_date || l.created_at, r)) : ls;
  const deals = lr.filter((l) => l.is_deal); const won = lr.filter(L.won);
  const sp = DB.t.campaign_spend.filter((x) => x.campaign_id === c.id && (!r || M.inR(x.spent_on, r)));
  const spend = sum(sp, (x) => x.amount) + (c.kind === 'other' && !sp.length && !r ? Number(c.extra?.booth_cost || 0) : 0);
  const revenue = sum(won, (l) => l.value);
  return { leads: lr.length, deals: deals.length, won: won.length, revenue, spend, cpl: lr.length && spend ? spend / lr.length : null, cpa: won.length && spend ? spend / won.length : null, roi: spend ? ((revenue - spend) / spend) * 100 : null, rows: lr, wonRows: won, spends: sp };
}
const roiTxt = (x) => (x == null ? '—' : `<span class="chip ${x >= 0 ? 'good' : 'bad'}">${Math.round(x).toLocaleString('en-IN')}%</span>`);
function campaignsView(kind) {
  const ad = kind === 'ad';
  return {
    title: ad ? 'Ad Campaigns' : 'Other Campaigns',
    sub: ad ? 'Paid ads by platform: spend, leads, deals, won, revenue, cost per lead and per acquisition, and ROI. Leads link by UTM, by the picker on the lead, or by CSV.' : 'Webinars, expos and events, referrals, WhatsApp broadcasts, college seminars and your own types, with the same metrics as ads.',
    actions: () => `${ad ? '<button class="btn" disabled title="Coming soon" aria-disabled="true">Connect ad account</button>' : ''}${canCampaigns() ? `<button class="btn primary" id="newcamp">${svg('plus')} New ${ad ? 'ad campaign' : 'campaign'}</button>` : ''}`,
    render(el) {
      const r = curRange();
      let cs = DB.t.mkt_campaigns.filter((c) => c.kind === kind && M.deptOk(c.dept || '') && M.personOk(c.owner) && (!CF.status || c.status === CF.status) && (!CF.type || (ad ? c.platform : c.type) === CF.type) && (!CF.q || `${c.name} ${c.utm} ${c.platform} ${c.type}`.toLowerCase().includes(CF.q.toLowerCase())));
      const rows = cs.map((c) => ({ c, s: campStats(c, r) })).sort((a, b) => b.s.leads - a.s.leads || String(b.c.start_date).localeCompare(String(a.c.start_date)));
      const T = { spend: sum(rows, (x) => x.s.spend), leads: sum(rows, (x) => x.s.leads), deals: sum(rows, (x) => x.s.deals), won: sum(rows, (x) => x.s.won), revenue: sum(rows, (x) => x.s.revenue) };
      const types = ad ? AD_PLATFORMS : campTypes().map((t) => t.name);
      el.innerHTML = `${filterBar()}
        <section class="glass panel"><div class="filters" style="margin-bottom:10px"><input type="search" id="cq" placeholder="Search name or UTM" value="${esc(CF.q)}">${sel('cty', types, CF.type, ad ? 'Any platform' : 'Any type')}${sel('cst', CAMP_STATUS, CF.status, 'Any status')}<span class="faint" style="font-size:12px">Leads, deals and won count leads dated in ${r.label.toLowerCase()}; spend counts entries in the same period.</span></div>
        ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Campaign</th><th>${ad ? 'Platform' : 'Type'}</th><th>Status</th><th class="n">Spend</th><th class="n">Leads</th><th class="n">Deals</th><th class="n">Won</th><th class="n">Revenue</th><th class="n">CPL</th><th class="n">CPA</th><th class="n">ROI</th></tr></thead><tbody>
          ${rows.map(({ c, s }) => `<tr class="click" data-mc="${c.id}"><td><div class="t">${esc(c.name)}</div><div class="s">${c.dept ? deptChip(c.dept) : ''} ${esc(c.utm || '')}${c.start_date ? ' · ' + fmtDate(c.start_date) + (c.end_date ? ' – ' + fmtDate(c.end_date) : '') : ''}</div></td><td>${esc(ad ? c.platform : c.type)}</td><td><span class="chip ${c.status === 'Active' ? 'good' : c.status === 'Paused' ? 'warn' : ''}">${esc(c.status)}</span></td><td class="n">${s.spend ? inr(s.spend) : '—'}</td><td class="n">${nfmt(s.leads)}</td><td class="n">${nfmt(s.deals)}</td><td class="n">${nfmt(s.won)}</td><td class="n">${s.revenue ? inr(s.revenue) : '—'}</td><td class="n">${s.cpl ? inr(s.cpl) : '—'}</td><td class="n">${s.cpa ? inr(s.cpa) : '—'}</td><td class="n">${roiTxt(s.roi)}</td></tr>`).join('')}
          <tr class="tot"><td colspan="3">Total · ${rows.length} campaigns</td><td class="n">${inr(T.spend)}</td><td class="n">${nfmt(T.leads)}</td><td class="n">${nfmt(T.deals)}</td><td class="n">${nfmt(T.won)}</td><td class="n">${inr(T.revenue)}</td><td class="n">${T.leads && T.spend ? inr(T.spend / T.leads) : '—'}</td><td class="n">${T.won && T.spend ? inr(T.spend / T.won) : '—'}</td><td class="n">${roiTxt(T.spend ? ((T.revenue - T.spend) / T.spend) * 100 : null)}</td></tr></tbody></table></div>`
          : empty('No campaigns yet', ad ? 'Add your Meta or Google campaign with its UTM. Web leads carrying that UTM link to it on their own.' : 'Add a webinar, expo, referral drive, WhatsApp broadcast or seminar.')}</section>
        ${ad ? `<details class="glass panel acc"><summary>Lead forms → CRM<span class="sub">Webhook addresses for Google, Meta and website forms</span></summary><div class="acc-body" id="intake"></div></details>` : ''}`;
      const rer = () => this.render(el);
      el.querySelector('#cq').oninput = (e) => { CF.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { rer(); const i = el.querySelector('#cq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
      el.querySelector('#cty').onchange = (e) => { CF.type = e.target.value; rer(); };
      el.querySelector('#cst').onchange = (e) => { CF.status = e.target.value; rer(); };
      el.querySelectorAll('[data-mc]').forEach((tr) => (tr.onclick = () => openCampaign(tr.dataset.mc)));
      const ib = el.querySelector('#intake'); if (ib) mkAds(ib);
      bindFilters(el, rer);
    },
    mount() { $('#newcamp')?.addEventListener('click', () => campaignEdit({ kind }, (c) => openCampaign(c.id))); },
  };
}
VIEWS.ads = campaignsView('ad');
VIEWS.campaigns = campaignsView('other');

function extraFields(type, extra = {}) {
  return (campType(type).fields || []).map((f) => {
    const id = 'x_' + f.key; const val = extra?.[f.key] ?? '';
    const input = f.type === 'number' ? inp(id, val, 'number') : f.type === 'date' ? inp(id, val, 'date') : f.type === 'dropdown' ? sel(id, f.options || [], val, '—') : inp(id, val);
    return fld(id, esc(f.label), input);
  }).join('');
}
function campaignEdit(c = {}, after) {
  const ad = c.kind === 'ad'; const types = campTypes().map((t) => t.name);
  const m = openModal({ title: c.id ? 'Edit ' + esc(c.name) : ad ? 'New ad campaign' : 'New campaign', width: 760,
    body: `<div class="form">${fld('mn', 'Name', inp('mn', c.name || ''), 'full')}
      ${ad ? fld('mp', 'Platform', sel('mp', AD_PLATFORMS, c.platform || AD_PLATFORMS[0])) : fld('mty', 'Type', sel('mty', types, c.type || types[0]))}
      ${fld('md', 'Department', sel('md', DEPTS().map((d) => [d.code, d.name]), c.dept || (ST.dept !== 'All' ? ST.dept : myDepts()[0])))}
      ${fld('ms', 'Status', sel('ms', CAMP_STATUS, c.status || 'Active'))}${fld('mo', 'Owner', `<select id="mo">${opts(scopePeople().map((p) => [p.id, p.full_name]), c.owner || DB.me.id)}</select>`)}
      ${fld('msd', 'Start', inp('msd', c.start_date || todayStr(), 'date'))}${fld('med', 'End', inp('med', c.end_date || '', 'date'))}
      ${fld('mb', 'Budget (₹)', inp('mb', c.budget || '', 'number'))}${fld('mu', 'UTM campaign', inp('mu', c.utm || '', 'text', 'placeholder="e.g. rpto_nov_meta"'))}
      ${ad ? fld('mal', 'Ad link', inp('mal', c.ad_link || '', 'url'), 'full') : ''}${fld('mll', 'Landing page / form link', inp('mll', c.landing_link || '', 'url'), 'full')}
      <div class="full form" id="mx" style="padding:0">${ad ? '' : extraFields(c.type || types[0], c.extra)}</div>
      ${fld('mno', 'Notes', `<textarea id="mno">${esc(c.notes || '')}</textarea>`, 'full')}</div>`,
    foot: `${c.id && canCampaigns() ? '<button class="btn danger" id="mdel" style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="msave">Save</button>` });
  m.el.querySelector('#mty')?.addEventListener('change', (e) => { m.el.querySelector('#mx').innerHTML = extraFields(e.target.value, c.extra); });
  m.el.querySelector('#msave').onclick = () => guard(async () => {
    const name = v(m.el, 'mn').trim(); if (!name) throw new Error('Name the campaign.');
    const type = ad ? 'Ad' : v(m.el, 'mty');
    const extra = { ...(c.extra || {}) }; (campType(type).fields || []).forEach((f) => { const x = v(m.el, 'x_' + f.key); extra[f.key] = f.type === 'number' ? (x === '' ? null : Number(x)) : x; });
    const row = { kind: ad ? 'ad' : 'other', type, name, platform: ad ? v(m.el, 'mp') : '', dept: v(m.el, 'md'), status: v(m.el, 'ms'), owner: v(m.el, 'mo'), start_date: v(m.el, 'msd') || null, end_date: v(m.el, 'med') || null, budget: num(m.el, 'mb'), utm: v(m.el, 'mu').trim(), ad_link: ad ? v(m.el, 'mal').trim() : '', landing_link: v(m.el, 'mll').trim(), extra, notes: v(m.el, 'mno') };
    const saved = c.id ? await DB.update('mkt_campaigns', c.id, row) : await DB.insert('mkt_campaigns', row);
    m.close(); after?.(saved);
  }, 'Campaign saved');
  m.el.querySelector('#mdel')?.addEventListener('click', () => guard(async () => { if (!(await confirmBox('Delete this campaign? Leads keep their data but lose the link.', 'Delete'))) return; await DB.remove('mkt_campaigns', c.id); m.close(); closeDrawer(); render(); }, 'Deleted'));
}
let campTab = 'overview';
function openCampaign(id) {
  openDrawer((ctx) => {
    const c = DB.get('mkt_campaigns', id); if (!c) return ctx.close();
    const ad = c.kind === 'ad'; const s = campStats(c, null);
    ctx.el.innerHTML = `<div class="drawer-head"><div><div class="row">${c.dept ? deptChip(c.dept) : ''}<span class="chip">${esc(ad ? c.platform : c.type)}</span><span class="chip ${c.status === 'Active' ? 'good' : ''}">${esc(c.status)}</span></div><h2 style="margin-top:6px">${esc(c.name)}</h2><div class="faint" style="font-size:12.5px">${c.start_date ? fmtDate(c.start_date) : ''}${c.end_date ? ' – ' + fmtDate(c.end_date) : ''}${c.utm ? ' · UTM ' + esc(c.utm) : ''} · owner ${esc(DB.pname(c.owner))}</div></div><button class="btn ghost small" data-close>${svg('x')}</button></div>
      <div class="dbar row">${canCampaigns() ? `<button class="btn small primary" id="cspend">${svg('plus')} Update spend</button><button class="btn small" id="cedit">Edit</button><label class="btn small" for="ccsv">Tag leads from CSV</label><input type="file" id="ccsv" accept=".csv,text/csv" hidden>` : ''}${c.type === 'Webinar' ? `<button class="btn small" id="cweb">${svg('web')} ${c.event_id ? 'Registrations & attendance' : 'Set up registration page'}</button>` : ''}${c.ad_link ? `<a class="btn small" href="${esc(c.ad_link)}" target="_blank" rel="noopener">${svg('link')} Ad</a>` : ''}${c.landing_link ? `<a class="btn small" href="${esc(c.landing_link)}" target="_blank" rel="noopener">${svg('link')} Landing page</a>` : ''}</div>
      <div class="tabs">${[['overview', 'Results'], ['leads', `Linked leads (${s.leads})`], ['spend', `Spend (${s.spends.length})`]].map(([k, t]) => `<button data-t="${k}" aria-selected="${campTab === k}">${t}</button>`).join('')}</div><div class="drawer-body" id="cb"></div>`;
    ctx.el.querySelector('[data-close]').onclick = ctx.close;
    ctx.el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { campTab = b.dataset.t; ctx.render(); }));
    ctx.el.querySelector('#cedit')?.addEventListener('click', () => campaignEdit(c, () => ctx.render()));
    ctx.el.querySelector('#cspend')?.addEventListener('click', () => spendModal(c, () => ctx.render()));
    ctx.el.querySelector('#ccsv')?.addEventListener('change', (e) => tagCsv(c, e.target.files[0], () => ctx.render()));
    ctx.el.querySelector('#cweb')?.addEventListener('click', () => { if (c.event_id && DB.get('events', c.event_id)) webinarDetail(c.event_id); else webinarModal({ kind: 'Webinar', title: c.name, segment: c.dept }, (ev) => ev && guard(() => DB.update('mkt_campaigns', c.id, { event_id: ev.id }))); });
    const b = ctx.el.querySelector('#cb');
    if (campTab === 'overview') {
      const months = M.months({ from: new Date(c.start_date || c.created_at || Date.now()), to: new Date(Date.now() + 864e5) });
      const x = (c.extra && Object.keys(c.extra).length) ? (campType(c.type).fields || []).filter((f) => c.extra[f.key] != null && c.extra[f.key] !== '').map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.type === 'number' ? nfmt(c.extra[f.key]) : c.extra[f.key])}</dd>`).join('') : '';
      b.innerHTML = `<div class="kpis">${kpi({ label: 'Spend', value: inr(s.spend), sub: c.budget ? `of ${inr(c.budget)} budget` : '', meter: c.budget ? pct(s.spend, c.budget) : undefined })}${kpi({ label: 'Leads', value: nfmt(s.leads), sub: s.cpl ? `${inr(s.cpl)} per lead` : 'CPL —' })}${kpi({ label: 'Deals', value: nfmt(s.deals) })}${kpi({ label: 'Won', value: nfmt(s.won), sub: s.cpa ? `${inr(s.cpa)} per acquisition` : 'CPA —' })}${kpi({ label: 'Revenue', value: inr(s.revenue), sub: 'Won deal value' })}${kpi({ label: 'ROI', value: s.roi == null ? '—' : Math.round(s.roi) + '%', sub: '(revenue − spend) ÷ spend' })}</div>
        <section><h3>Trend</h3>${barChart({ labels: months.map(monShort), series: [{ name: 'Leads', color: '#86b8e2', values: months.map((m) => s.rows.filter((l) => monthKey(l.enquiry_date || l.created_at) === m).length) }, { name: 'Won', color: '#004a8c', values: months.map((m) => s.wonRows.filter((l) => monthKey(l.won_at) === m).length) }], fmt: (n) => nfmt(Math.round(n)), height: 180 })}</section>
        ${x ? `<dl class="kv">${x}</dl>` : ''}${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
        <p class="faint" style="font-size:12px">Web and ad leads whose UTM campaign is “${esc(c.utm || 'not set')}” link here on their own. You can also pick this campaign on any lead, or tag a list of phone numbers or emails with “Tag leads from CSV”.</p>`;
    } else if (campTab === 'leads') { b.innerHTML = leadRows(s.rows); bindLeadClicks(b); }
    else {
      b.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Date</th><th class="n">Amount</th><th>Note</th><th>By</th><th></th></tr></thead><tbody>${s.spends.sort((a, z) => String(z.spent_on).localeCompare(String(a.spent_on))).map((x) => `<tr><td>${fmtDate(x.spent_on)}</td><td class="n">${inrFull(x.amount)}</td><td>${esc(x.note)}</td><td>${esc(DB.pname(x.created_by))}</td><td>${canCampaigns() ? `<button class="btn ghost small" data-sdel="${x.id}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="faint">No spend entered yet.</td></tr>'}<tr class="tot"><td>Total</td><td class="n">${inrFull(s.spend)}</td><td colspan="3"></td></tr></tbody></table></div>`;
      b.querySelectorAll('[data-sdel]').forEach((x) => (x.onclick = () => guard(async () => { await DB.remove('campaign_spend', x.dataset.sdel); ctx.render(); }, 'Removed')));
    }
  });
}
function spendModal(c, after) {
  const m = openModal({ title: 'Update spend · ' + esc(c.name), width: 520, body: `<div class="form">${fld('sa', 'Amount spent (₹)', inp('sa', '', 'number', 'min="0" step="1"'))}${fld('sd', 'Date (or end of the period it covers)', inp('sd', todayStr(), 'date'))}${fld('sn', 'Note', inp('sn', '', 'text', 'placeholder="e.g. Week 2 Meta spend"'), 'full')}</div>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="sgo">Add spend</button>' });
  m.el.querySelector('#sgo').onclick = () => guard(async () => { const a = num(m.el, 'sa'); if (!(a > 0)) throw new Error('Enter the amount.'); await DB.insert('campaign_spend', { campaign_id: c.id, amount: a, spent_on: v(m.el, 'sd') || todayStr(), note: v(m.el, 'sn'), created_by: DB.me.id }); m.close(); after?.(); }, 'Spend added');
}
/* a CSV with phone or email columns: matching leads get this campaign */
function tagCsv(c, file, after) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => guard(async () => {
    const rows = parseCSV(rd.result); if (rows.length < 2) throw new Error('No rows found.');
    const head = rows[0].map((h) => h.trim().toLowerCase()); const pi = head.findIndex((h) => /phone|mobile|number/.test(h)); const ei = head.findIndex((h) => /mail/.test(h));
    if (pi < 0 && ei < 0) throw new Error('The CSV needs a phone or email column.');
    const p10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);
    const phones = new Set(rows.slice(1).map((r) => p10(r[pi])).filter((x) => x.length === 10)); const emails = new Set(rows.slice(1).map((r) => String(r[ei] || '').trim().toLowerCase()).filter(Boolean));
    const ids = visibleLeads().filter((l) => (phones.has(p10(l.phone)) || emails.has((l.email || '').toLowerCase())) && l.mkt_campaign_id !== c.id).map((l) => l.id);
    if (!ids.length) throw new Error(`None of the ${rows.length - 1} rows matched a lead you can see.`);
    if (!(await confirmBox(`Tag ${nfmt(ids.length)} matching leads with “${esc(c.name)}”?`, 'Tag leads'))) return;
    const n = await DB.bulkUpdate('leads', ids, { mkt_campaign_id: c.id }); toast(`${nfmt(n)} leads tagged`); after?.();
  });
  rd.readAsText(file);
}
