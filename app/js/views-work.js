/* Garuda CRM · Field Visits, Accounts, Project Management, Escalations */
'use strict';

const ACCOUNT_KINDS = ['College', 'School', 'Company', 'Government', 'Other'];
const CONTACT_ROLES_ALL = CONTACT_ROLES;
const VISIT_STATUS = ['Planned', 'Done', 'Rescheduled', 'Cancelled'];
const visitPurposes = () => DB.settings.visit_purposes || ['Demo', 'Proposal', 'MoU signing', 'Lab survey', 'Follow-up', 'Other'];
const visitLink = (x) => { const l = x.lead_id && DB.get('leads', x.lead_id); const i = x.institution_id && DB.get('institutions', x.institution_id); return l ? (l.is_deal ? 'Deal · ' : 'Lead · ') + (L.company(l) && !l.name.includes(L.company(l)) ? `${l.name} · ${L.company(l)}` : l.name) : i ? 'Account · ' + i.name : 'Not linked'; };
const tomorrowAt = (h) => { const d = new Date(Date.now() + 864e5); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const vStatusCls = { Planned: 'acc', Done: 'good', Rescheduled: 'warn', Cancelled: '' };

/* ---------- pick a lead, deal or account by typing ---------- */
function recordPicker(id, pre = {}) {
  const cur = pre.lead_id ? `lead:${pre.lead_id}` : pre.institution_id ? `inst:${pre.institution_id}` : '';
  const label = pre.lead_id || pre.institution_id ? visitLink(pre) : '';
  return `<div class="picker" id="${id}" data-val="${esc(cur)}"><input id="${id}-q" placeholder="Type a lead, deal or account name" value="${esc(label)}" autocomplete="off" aria-label="Link to"><div class="picks" hidden></div></div>`;
}
function bindPicker(root, id) {
  const box = root.querySelector('#' + id); if (!box) return;
  const q = box.querySelector('input'); const out = box.querySelector('.picks');
  q.oninput = () => {
    const s = q.value.trim().toLowerCase(); box.dataset.val = ''; if (s.length < 2) { out.hidden = true; return; }
    const ls = visibleLeads().filter((l) => L.open(l) && ((l.name || '').toLowerCase().includes(s) || L.company(l).toLowerCase().includes(s) || (l.phone || '').includes(s))).slice(0, 6).map((l) => [`lead:${l.id}`, `${l.is_deal ? 'Deal' : 'Lead'} · ${l.name}${L.company(l) && !l.name.includes(L.company(l)) ? ' · ' + L.company(l) : ''}`]);
    const is = DB.t.institutions.filter((i) => i.name.toLowerCase().includes(s)).slice(0, 4).map((i) => [`inst:${i.id}`, `Account · ${i.name}`]);
    const all = [...ls, ...is];
    out.innerHTML = all.map(([k, t]) => `<button type="button" data-pk="${esc(k)}">${esc(t)}</button>`).join('') || '<span class="faint">No match</span>'; out.hidden = false;
    out.querySelectorAll('[data-pk]').forEach((b) => (b.onclick = () => { box.dataset.val = b.dataset.pk; q.value = b.textContent; out.hidden = true; }));
  };
}
const pickerVal = (root, id) => { const vv = root.querySelector('#' + id)?.dataset.val || ''; const [k, x] = vv.split(':'); return { lead_id: k === 'lead' ? x : null, institution_id: k === 'inst' ? x : k === 'lead' ? DB.get('leads', x)?.institution_id || null : null }; };

/* ================= Field Visits ================= */
function visitItem(x) {
  const late = ['Planned', 'Rescheduled'].includes(x.status || 'Planned') && x.planned_at && new Date(x.planned_at) < new Date();
  return `<button class="item vitem" data-visit="${x.id}"><span class="dot ${x.status === 'Done' ? 'good' : late ? 'bad' : ''}"></span><span class="grow"><b>${esc(visitLink(x))}</b>
    <span class="s">${esc(x.purpose)} · ${fmtDT(x.planned_at)} · ${esc(DB.pname(x.owner))}${(x.history || []).length ? ` · rescheduled ${x.history.length}×` : ''}${x.checkin_at ? ' · checked in ' + fmtTime(x.checkin_at) : ''}</span>
    ${x.outcome ? `<span class="s"><b>Outcome:</b> ${esc(x.outcome)}${x.next_step ? ' · <b>Next:</b> ' + esc(x.next_step) : ''}</span>` : ''}</span><span class="chip ${late ? 'bad' : vStatusCls[x.status || 'Planned']}">${late ? 'Overdue' : esc(x.status || 'Planned')}</span></button>`;
}
function visitModal(x = {}, after) {
  const isNew = !x.id;
  const people = assignablePeople(); if (x.owner && !people.some((p) => p.id === x.owner) && DB.profile(x.owner)) people.push(DB.profile(x.owner));
  const purposes = [...new Set([...visitPurposes(), x.purpose].filter(Boolean))];
  const m = openModal({ title: isNew ? 'Plan visit' : 'Visit', width: 720,
    body: `<div class="form">
      ${fld('vlink', 'Lead, deal or account', recordPicker('vlink', x), 'full')}
      ${fld('vt', 'Date and time', inp('vt', dtLocal(x.planned_at || tomorrowAt(11)), 'datetime-local'))}
      ${fld('vo', 'Who visits', `<select id="vo">${opts(people.map((p) => [p.id, p.full_name]), x.owner || DB.me.id)}</select>`)}
      ${fld('vp', 'Purpose', sel('vp', purposes, x.purpose || purposes[0]))}
      ${fld('vs', 'Status', sel('vs', VISIT_STATUS, x.status || 'Planned'))}
      ${isNew ? '' : `${fld('vout', 'Outcome (needed to mark Done)', inp('vout', x.outcome || ''), 'full')}
      ${fld('vnext', 'Next step', inp('vnext', x.next_step || x.next_action || ''))}${fld('vnf', 'Next follow-up date', inp('vnf', x.next_followup_at ? localDate(x.next_followup_at) : '', 'date'))}
      ${fld('vrem', 'Remarks', `<textarea id="vrem">${esc(x.remarks || x.mom || '')}</textarea>`, 'full')}
      <div class="full glass panel ci"><div class="row between"><b>Check-in (optional)</b>${x.checkin_at ? `<span class="chip good">Checked in ${fmtDT(x.checkin_at)}${x.checkin_lat ? ` · <a href="https://www.google.com/maps?q=${x.checkin_lat},${x.checkin_lng}" target="_blank" rel="noopener">map</a>` : ''}</span>` : ''}</div>
        <div class="row"><button class="btn small" type="button" id="vloc">${svg('pin')} Use my location</button><label class="btn small" for="vph">Add photo</label><input type="file" id="vph" accept="image/*" capture="environment" hidden><span class="faint" id="vci" style="font-size:12px"></span></div>
        ${x.checkin_photo ? `<img src="${esc(x.checkin_photo)}" alt="Check-in photo" class="ciph">` : ''}<div id="vphp"></div></div>`}
      ${(x.history || []).length ? `<div class="full"><h4>Reschedule history</h4><ul class="faint" style="font-size:12.5px;margin:4px 0;padding-left:18px">${x.history.map((h) => `<li>${fmtDT(h.from)} → ${fmtDT(h.to)} · changed ${fmtDT(h.at)} by ${esc(DB.pname(h.by))}</li>`).join('')}</ul></div>` : ''}
    </div>`,
    foot: `${!isNew && (x.created_by === DB.me.id || isHead()) ? '<button class="btn danger" id="vdel" style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="vsave">${isNew ? 'Plan visit' : 'Save'}</button>` });
  bindPicker(m.el, 'vlink');
  const ci = { at: null, lat: null, lng: null, acc: null, photo: null };
  m.el.querySelector('#vloc')?.addEventListener('click', () => { if (!navigator.geolocation) return toast('Location is not available on this device', true); navigator.geolocation.getCurrentPosition((p) => { Object.assign(ci, { at: nowISO(), lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }); m.el.querySelector('#vci').textContent = `Location captured (±${ci.acc} m)`; }, (e) => toast('Could not get location: ' + e.message, true), { enableHighAccuracy: true, timeout: 15000 }); });
  m.el.querySelector('#vph')?.addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; shrinkPhoto(f).then((d) => { ci.photo = d; ci.at ||= nowISO(); m.el.querySelector('#vphp').innerHTML = `<img src="${d}" alt="Check-in photo" class="ciph">`; }).catch(() => toast('Could not read that photo', true)); });
  m.el.querySelector('#vsave').onclick = () => guard(async () => {
    const link = pickerVal(m.el, 'vlink');
    if (!link.lead_id && !link.institution_id) throw new Error('Link the visit to a lead, deal or account.');
    const row = { ...link, planned_at: fromLocal(v(m.el, 'vt')), owner: v(m.el, 'vo'), purpose: v(m.el, 'vp'), status: v(m.el, 'vs') };
    if (!row.planned_at) throw new Error('Choose the date and time.');
    if (!isNew) {
      Object.assign(row, { outcome: v(m.el, 'vout').trim(), next_step: v(m.el, 'vnext').trim(), next_followup_at: v(m.el, 'vnf') ? new Date(v(m.el, 'vnf') + 'T11:00:00').toISOString() : null, remarks: v(m.el, 'vrem') });
      if (row.status === 'Done' && !row.outcome) throw new Error('Add the outcome before marking the visit Done.');
      if (ci.at) Object.assign(row, { checkin_at: x.checkin_at || ci.at, ...(ci.lat != null ? { checkin_lat: ci.lat, checkin_lng: ci.lng, checkin_acc_m: ci.acc } : {}), ...(ci.photo ? { checkin_photo: ci.photo } : {}) });
      /* moving the date keeps the old one in the history; a planned visit becomes Rescheduled */
      if (row.status === 'Planned' && x.planned_at && new Date(row.planned_at).getTime() !== new Date(x.planned_at).getTime()) row.status = 'Rescheduled';
      await DB.update('visits', x.id, row);
      if (row.next_followup_at && row.lead_id) await DB.update('leads', row.lead_id, { next_followup_at: row.next_followup_at }).catch(() => {});
    } else await DB.insert('visits', { ...row, created_by: DB.me.id });
    m.close(); after?.();
  }, isNew ? 'Visit planned' : 'Visit saved');
  m.el.querySelector('#vdel')?.addEventListener('click', () => guard(async () => { if (!(await confirmBox('Delete this visit?', 'Delete'))) return; await DB.remove('visits', x.id); m.close(); after?.(); }, 'Deleted'));
}
/* check-in photos are stored small (about 60 KB) with the visit */
function shrinkPhoto(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onerror = rej; r.onload = () => { const img = new Image(); img.onerror = rej; img.onload = () => { const k = Math.min(1, 900 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.6)); }; img.src = r.result; }; r.readAsDataURL(file); });
}
const VF = { when: 'upcoming', mode: 'list', month: '' };
VIEWS.visits = {
  title: 'Field Visits', sub: 'Plan visits from a lead, deal or account. Mark them done with the outcome and the next step.',
  actions: () => `<button class="btn primary" id="newvisit">${svg('plus')} Plan visit</button>`,
  render(el) {
    if (ST.arg) { if (['today', 'week', 'upcoming', 'overdue', 'done', 'all'].includes(ST.arg)) VF.when = ST.arg; ST.arg = null; }
    const now = new Date(); const today = todayStr(); const wk = M.range('week');
    const open = (x) => ['Planned', 'Rescheduled'].includes(x.status || 'Planned');
    const base = DB.t.visits.filter((x) => M.personOk(x.owner) && M.visitDeptOk(x));
    const F = {
      today: (x) => x.planned_at && localDate(x.planned_at) === today && x.status !== 'Cancelled',
      week: (x) => M.inR(x.planned_at, wk) || (x.planned_at && new Date(x.planned_at) >= now && (new Date(x.planned_at) - now) / 864e5 <= 7),
      upcoming: (x) => open(x) && x.planned_at && new Date(x.planned_at) >= new Date(today + 'T00:00:00'),
      overdue: (x) => open(x) && x.planned_at && localDate(x.planned_at) < today,
      done: (x) => x.status === 'Done', all: () => true,
    };
    const rows = base.filter(F[VF.when] || F.all).sort((a, b) => (VF.when === 'done' || VF.when === 'all' ? -1 : 1) * String(a.planned_at).localeCompare(String(b.planned_at)));
    const counts = Object.fromEntries(Object.keys(F).map((k) => [k, base.filter(F[k]).length]));
    el.innerHTML = `${filterBar({ period: false })}
      <section class="glass panel"><div class="row between" style="margin-bottom:10px">
        <div class="seg">${[['today', 'Today'], ['week', 'This week'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']].map(([k, t]) => `<button data-vw="${k}" aria-pressed="${VF.when === k}">${t} <span class="faint">${counts[k]}</span></button>`).join('')}</div>
        <div class="seg"><button data-vm="list" aria-pressed="${VF.mode === 'list'}">${svg('list')} List</button><button data-vm="cal" aria-pressed="${VF.mode === 'cal'}">${svg('cal')} Calendar</button></div></div>
        <div id="vbody"></div></section>`;
    const body = el.querySelector('#vbody');
    if (VF.mode === 'cal') visitCalendar(body, base, () => this.render(el));
    else body.innerHTML = rows.length ? `<div class="list">${rows.map(visitItem).join('')}</div>` : empty('No visits here', VF.when === 'overdue' ? 'Nothing overdue.' : 'Plan one from a lead, deal or account.');
    el.querySelectorAll('[data-vw]').forEach((b) => (b.onclick = () => { VF.when = b.dataset.vw; VF.mode = 'list'; this.render(el); }));
    el.querySelectorAll('[data-vm]').forEach((b) => (b.onclick = () => { VF.mode = b.dataset.vm; this.render(el); }));
    el.querySelectorAll('[data-visit]').forEach((b) => (b.onclick = () => visitModal(DB.get('visits', b.dataset.visit), () => this.render(el))));
    bindFilters(el, () => this.render(el));
  },
  mount() { $('#newvisit')?.addEventListener('click', () => visitModal({}, () => render())); },
};
function visitCalendar(box, base, rer) {
  const ym = VF.month || todayStr().slice(0, 7); const [y, mo] = ym.split('-').map(Number);
  const first = new Date(y, mo - 1, 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const by = groupBy(base.filter((x) => x.planned_at), (x) => localDate(x.planned_at));
  const shift = (n) => { const d = new Date(y, mo - 1 + n, 1); VF.month = localDate(d).slice(0, 7); rer(); };
  box.innerHTML = `<div class="row between" style="margin-bottom:8px"><button class="btn small" id="cprev">‹</button><b>${first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b><button class="btn small" id="cnext">›</button></div>
    <div class="cal"><div class="cdh">Mon</div><div class="cdh">Tue</div><div class="cdh">Wed</div><div class="cdh">Thu</div><div class="cdh">Fri</div><div class="cdh">Sat</div><div class="cdh">Sun</div>
    ${days.map((d) => { const k = localDate(d); const a = by[k] || []; return `<div class="cday ${d.getMonth() !== mo - 1 ? 'off' : ''} ${k === todayStr() ? 'today' : ''}"><span class="cdn">${d.getDate()}</span>${a.slice(0, 3).map((x) => `<button class="cev ${x.status === 'Done' ? 'done' : ''}" data-visit="${x.id}" title="${esc(visitLink(x))}">${fmtTime(x.planned_at)} ${esc(visitLink(x).replace(/^(Lead|Deal|Account) · /, ''))}</button>`).join('')}${a.length > 3 ? `<span class="faint" style="font-size:11px">+${a.length - 3} more</span>` : ''}</div>`; }).join('')}</div>`;
  box.querySelector('#cprev').onclick = () => shift(-1); box.querySelector('#cnext').onclick = () => shift(1);
}

/* ================= Accounts: colleges, companies, government bodies ================= */
const AF = { q: '', kind: '' };
const acctScore = (i) => Math.round((((i.score_access || 0) + (i.score_strength || 0) + (i.score_fit || 0) + (i.score_budget || 0) + (i.score_site || 0) + (i.score_timing || 0)) / 30) * 100);
VIEWS.accounts = {
  title: 'Accounts', sub: 'Every organisation with its contacts, leads and deals, projects, visits and escalations.',
  actions: () => `<button class="btn primary" id="newacct">${svg('plus')} New account</button>`,
  render(el) {
    const ls = visibleLeads();
    const byInst = groupBy(ls.filter((l) => l.institution_id), (l) => l.institution_id);
    let rows = DB.t.institutions.filter((i) => (!AF.q || `${i.name} ${i.city}`.toLowerCase().includes(AF.q.toLowerCase())) && (!AF.kind || i.kind === AF.kind) && M.personOk(i.owner)
      && (ST.dept === 'All' || (byInst[i.id] || []).some((l) => l.funnel === ST.dept) || DB.t.projects.some((p) => p.institution_id === i.id && p.dept === ST.dept)));
    rows = rows.map((i) => { const a = byInst[i.id] || []; return { i, a, open: a.filter((l) => !l.is_deal && L.open(l)).length, deals: a.filter(L.inPipe).length, won: sum(a.filter(L.won), (l) => l.value) }; })
      .sort((a, b) => b.deals - a.deals || b.won - a.won || b.open - a.open || a.i.name.localeCompare(b.i.name));
    const kinds = [...new Set([...ACCOUNT_KINDS, ...DB.t.institutions.map((i) => i.kind).filter(Boolean)])];
    el.innerHTML = `${filterBar({ period: false })}<section class="glass panel"><div class="filters" style="margin-bottom:10px"><input type="search" id="aq" placeholder="Search name or city" value="${esc(AF.q)}">${sel('ak', kinds, AF.kind, 'Any type')}<span class="faint" style="font-size:12.5px">${nfmt(rows.length)} accounts</span></div>
      ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Account</th><th>Type</th><th>Owner</th><th class="n">Contacts</th><th class="n">Open leads</th><th class="n">Open deals</th><th class="n">Won value</th><th class="n">Projects</th><th>Last visit</th></tr></thead><tbody>
      ${rows.slice(0, 400).map(({ i, open, deals, won }) => { const lv = DB.t.visits.filter((x) => x.institution_id === i.id && x.status === 'Done').sort((a, b) => String(b.planned_at).localeCompare(String(a.planned_at)))[0]; return `<tr class="click" data-acct="${i.id}"><td><div class="t">${esc(i.name)} ${i.strategic ? '<span class="chip acc">Strategic</span>' : ''}</div><div class="s">${esc([i.city, i.state].filter(Boolean).join(', '))}</div></td><td>${esc(i.kind)}</td><td>${esc(DB.pname(i.owner))}</td><td class="n">${DB.t.contacts.filter((c) => c.institution_id === i.id).length}</td><td class="n">${open}</td><td class="n">${deals}</td><td class="n">${won ? inr(won) : '—'}</td><td class="n">${DB.t.projects.filter((p) => p.institution_id === i.id).length}</td><td>${lv ? fmtDate(lv.planned_at) : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : empty('No accounts', 'Add one, or link a lead to an account from its record.')}</section>`;
    el.querySelector('#aq').oninput = (e) => { AF.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { this.render(el); const i = el.querySelector('#aq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    el.querySelector('#ak').onchange = (e) => { AF.kind = e.target.value; this.render(el); };
    el.querySelectorAll('[data-acct]').forEach((r) => (r.onclick = () => openAccount(r.dataset.acct)));
    bindFilters(el, () => this.render(el));
  },
  mount() { $('#newacct')?.addEventListener('click', () => guard(async () => { const n = await promptBox('New account', 'Organisation name'); if (!n) return; const i = await DB.insert('institutions', { name: n.trim(), owner: DB.me.id, kind: 'College' }); openAccount(i.id); })); },
};
let acctTab = 'overview';
function openAccount(id) {
  openDrawer((ctx) => {
    const i = DB.get('institutions', id); if (!i) return ctx.close();
    const contacts = DB.t.contacts.filter((c) => c.institution_id === id);
    const ls = visibleLeads().filter((l) => l.institution_id === id);
    const visits = DB.t.visits.filter((x) => x.institution_id === id || ls.some((l) => l.id === x.lead_id)).sort((a, b) => String(b.planned_at).localeCompare(String(a.planned_at)));
    const projs = DB.t.projects.filter((p) => p.institution_id === id || ls.some((l) => l.id === p.lead_id));
    const escs = DB.t.complaints.filter((c) => c.institution_id === id || ls.some((l) => l.id === c.lead_id));
    ctx.el.innerHTML = `<div class="drawer-head"><div><div class="row"><span class="chip">${esc(i.kind)}</span>${i.strategic ? '<span class="chip acc">Strategic account</span>' : ''}</div><h2 style="margin-top:6px">${esc(i.name)}</h2><div class="faint" style="font-size:12.5px">${esc([i.city, i.state].filter(Boolean).join(', '))} · owner ${esc(DB.pname(i.owner))} · ${ls.filter(L.inPipe).length} open deals · won ${inr(sum(ls.filter(L.won), (l) => l.value))}</div></div><button class="btn ghost small" data-close>${svg('x')}</button></div>
      <div class="dbar row"><button class="btn small primary" id="anl">${svg('plus')} New lead</button><button class="btn small" id="anv">${svg('pin')} Plan visit</button><button class="btn small" id="ane">${svg('warn')} Raise escalation</button></div>
      <div class="tabs">${[['overview', 'Details'], ['contacts', `Contacts (${contacts.length})`], ['opps', `Leads & deals (${ls.length})`], ['projects', `Projects (${projs.length})`], ['visits', `Visits (${visits.length})`], ['esc', `Escalations (${escs.length})`], ['brief', 'Claude brief']].map(([k, t]) => `<button data-t="${k}" aria-selected="${acctTab === k}">${t}</button>`).join('')}</div><div class="drawer-body" id="ib"></div>`;
    ctx.el.querySelector('[data-close]').onclick = ctx.close;
    ctx.el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { acctTab = b.dataset.t; ctx.render(); }));
    ctx.el.querySelector('#anl').onclick = () => newLeadModal({ institution: i.name, funnel: myDepts().find((c) => isOrgDept(c)) });
    ctx.el.querySelector('#anv').onclick = () => visitModal({ institution_id: id }, () => ctx.render());
    ctx.el.querySelector('#ane').onclick = () => escalationModal({ institution_id: id }, () => ctx.render());
    const b = ctx.el.querySelector('#ib');
    if (acctTab === 'overview') {
      const sc = (k, t) => fld(k, t, `<input id="${k}" type="range" min="0" max="5" value="${i[k] || 0}" aria-label="${t}">`);
      b.innerHTML = `<div class="form">${fld('iname', 'Name', inp('iname', i.name))}${fld('ikind', 'Type', sel('ikind', [...new Set([...ACCOUNT_KINDS, i.kind].filter(Boolean))], i.kind))}${fld('icity', 'City', inp('icity', i.city))}${fld('istate', 'State', inp('istate', i.state))}${fld('iuni', 'University / group / ministry', inp('iuni', i.university))}${fld('iweb', 'Website', inp('iweb', i.website))}
        ${fld('istr', 'Size (students / staff)', inp('istr', i.student_strength ?? '', 'number'))}${fld('idep', 'Departments', inp('idep', i.departments))}
        ${fld('iown', 'Owner', `<select id="iown" ${canReassign() ? '' : 'disabled'}>${opts([...assignablePeople(), ...(i.owner && !assignablePeople().some((p) => p.id === i.owner) && DB.profile(i.owner) ? [DB.profile(i.owner)] : [])].map((p) => [p.id, p.full_name]), i.owner, 'Unassigned')}</select>`)}${fld('iterr', 'Territory', inp('iterr', i.territory))}
        <div class="full"><h4>Account score (0-5 each) · ${acctScore(i)}</h4><div class="form three" style="margin-top:6px">${sc('score_access', 'Decision-maker access')}${sc('score_strength', 'Size')}${sc('score_fit', 'Fit for several offers')}${sc('score_budget', 'Available budget')}${sc('score_site', 'Site readiness')}${sc('score_timing', 'Timing')}</div></div>
        <label class="check full"><input type="checkbox" id="istrat" ${i.strategic ? 'checked' : ''}> Strategic multi-site account (one named owner)</label>
        ${fld('inotes', 'Notes', `<textarea id="inotes">${esc(i.notes)}</textarea>`, 'full')}</div><div class="row" style="justify-content:flex-end"><button class="btn primary" id="isave">Save</button></div>`;
      b.querySelector('#isave').onclick = () => guard(async () => { const patch = { name: v(b, 'iname'), kind: v(b, 'ikind'), city: v(b, 'icity'), state: v(b, 'istate'), university: v(b, 'iuni'), website: v(b, 'iweb'), student_strength: v(b, 'istr') ? num(b, 'istr') : null, departments: v(b, 'idep'), territory: v(b, 'iterr'), strategic: v(b, 'istrat'), notes: v(b, 'inotes') }; ['score_access', 'score_strength', 'score_fit', 'score_budget', 'score_site', 'score_timing'].forEach((k) => (patch[k] = num(b, k))); if (canReassign()) patch.owner = v(b, 'iown') || null; await DB.update('institutions', id, patch); ctx.render(); }, 'Saved');
    } else if (acctTab === 'contacts') {
      b.innerHTML = `<div class="row between"><h3>Contacts</h3><button class="btn small" id="cadd">${svg('plus')} Add contact</button></div>${contacts.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Consent</th></tr></thead><tbody>${contacts.map((c) => `<tr class="click" data-c="${c.id}"><td><b>${esc(c.name)}</b><div class="s">${esc(c.designation)}</div></td><td>${esc(c.role_type)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td>${c.opted_out ? '<span class="chip bad">Opted out</span>' : `${c.consent_email ? '<span class="chip good">Email</span>' : ''} ${c.consent_whatsapp ? '<span class="chip good">WhatsApp</span>' : ''}`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="faint">No contacts yet. Map the decision makers: chairman or director, principal, HoD, procurement.</p>'}`;
      const cm = (c = {}) => { const m = openModal({ title: c.id ? 'Edit contact' : 'New contact', width: 620, body: `<div class="form">${fld('cn', 'Name', inp('cn', c.name))}${fld('cr', 'Role', sel('cr', CONTACT_ROLES_ALL, c.role_type || 'Principal'))}${fld('cd', 'Designation', inp('cd', c.designation))}${fld('cp', 'Phone', inp('cp', c.phone, 'tel'))}${fld('ce', 'Email', inp('ce', c.email, 'email'))}<div class="row"><label class="check"><input type="checkbox" id="cce" ${c.consent_email ? 'checked' : ''}> Email consent</label><label class="check"><input type="checkbox" id="ccw" ${c.consent_whatsapp ? 'checked' : ''}> WhatsApp</label></div></div>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="cs">Save</button>' }); m.el.querySelector('#cs').onclick = () => guard(async () => { const row = { institution_id: id, name: v(m.el, 'cn'), role_type: v(m.el, 'cr'), designation: v(m.el, 'cd'), phone: v(m.el, 'cp'), email: v(m.el, 'ce'), consent_email: v(m.el, 'cce'), consent_whatsapp: v(m.el, 'ccw') }; if (!row.name) throw new Error('Enter the name'); if (c.id) await DB.update('contacts', c.id, row); else await DB.insert('contacts', row); m.close(); ctx.render(); }, 'Saved'); };
      b.querySelector('#cadd').onclick = () => cm();
      b.querySelectorAll('[data-c]').forEach((r) => (r.onclick = () => cm(DB.get('contacts', r.dataset.c))));
    } else if (acctTab === 'opps') {
      b.innerHTML = leadRows(ls.sort((a, c) => Number(!!c.is_deal) - Number(!!a.is_deal) || String(c.created_at).localeCompare(String(a.created_at)))); bindLeadClicks(b);
    } else if (acctTab === 'projects') {
      b.innerHTML = projs.length ? `<div class="list">${projs.map((p) => `<button class="item" data-proj="${p.id}"><span class="grow"><b>${esc(p.name)}</b><span class="s">${deptChip(p.dept)} ${esc(p.status)} · ${esc(DB.pname(p.owner))}${p.end_date ? ' · ends ' + fmtDate(p.end_date) : ''}</span></span><span>${inr(p.value)}</span></button>`).join('')}</div>` : '<p class="faint">No projects. Winning a deal creates one.</p>';
      b.querySelectorAll('[data-proj]').forEach((x) => (x.onclick = () => openProject(x.dataset.proj)));
    } else if (acctTab === 'visits') {
      b.innerHTML = visits.length ? `<div class="list">${visits.map(visitItem).join('')}</div>` : '<p class="faint">No visits yet.</p>';
      b.querySelectorAll('[data-visit]').forEach((x) => (x.onclick = () => visitModal(DB.get('visits', x.dataset.visit), () => ctx.render())));
    } else if (acctTab === 'esc') {
      b.innerHTML = escs.length ? `<div class="list">${escs.map(escItem).join('')}</div>` : '<p class="faint">No escalations.</p>';
      b.querySelectorAll('[data-esc]').forEach((x) => (x.onclick = () => escalationModal(DB.get('complaints', x.dataset.esc), () => ctx.render())));
    } else {
      b.innerHTML = `<div class="ai-card"><div class="row between"><h3>Pre-visit brief</h3><button class="btn small primary" id="bgo">${svg('ai')} Prepare brief</button></div><div id="bout"><p class="muted">Claude reads the contacts, leads, deals, visits and remarks for this account and writes a one-page brief.</p></div></div>`;
      b.querySelector('#bgo').onclick = () => guard(async () => { b.querySelector('#bout').innerHTML = '<p class="muted">Preparing…</p>'; const r = await DB.fn('ai', { action: 'brief', institution_id: id }); b.querySelector('#bout').innerHTML = `<p><b>${esc(r.snapshot)}</b></p>${[['Decision makers', r.decision_makers], ['Already bought', r.what_they_have_bought], ['Open opportunities', r.open_opportunities], ['Talking points', r.talking_points], ['Cross-sell', r.cross_sell], ['Watch outs', r.watch_outs]].map(([h, a]) => (a || []).length ? `<h4 style="margin-top:8px">${h}</h4><ul style="padding-left:18px;margin:4px 0">${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '').join('')}<div class="note ok" style="margin-top:8px"><b>Visit goal:</b> ${esc(r.visit_goal)}</div>`; });
    }
  });
}

/* ================= Project Management ================= */
const PROJ_STATUS = ['Not started', 'In progress', 'On hold', 'Completed'];
const PROJ_CLS = { 'Not started': '', 'In progress': 'acc', 'On hold': 'warn', Completed: 'good' };
const ITEM_STATUS = { milestone: ['Open', 'In progress', 'Done', 'Cancelled'], task: ['Open', 'In progress', 'Done', 'Cancelled'], payment: ['Open', 'Invoiced', 'Collected', 'Cancelled'] };
const PF = { status: 'active', mode: 'list', quick: '' };
/* order value, money in (sheet opening + verified payments since), pending */
function projMoney(p) {
  const order = Number(p.order_value) || Number(p.value) || 0;
  const since = p.created_at || '1900-01-01';
  const pays = p.lead_id ? DB.t.payments.filter((y) => y.lead_id === p.lead_id && y.status === 'Verified' && (y.claimed_at || '') > since) : [];
  const received = (Number(p.opening_received) || 0) + sum(pays, (y) => y.amount_ex);
  const claimed = p.lead_id ? sum(DB.t.payments.filter((y) => y.lead_id === p.lead_id && y.status === 'Claimed'), (y) => y.amount_ex) : 0;
  return { order, received, claimed, pending: Math.max(0, order - received) };
}
/* ================= Collections: money still to come in, by project, and the Pending PO lines ================= */
VIEWS.collections = {
  title: 'Collections', sub: 'Pending payments: order value, what came in and what is still due, by project. Record a payment and it moves to Revenue.',
  render(el) {
    const today = todayStr();
    const ps = DB.t.projects.filter((p) => M.deptOk(p.dept || '') && (Number(p.order_value) || Number(p.value)));
    const rows = ps.map((p) => ({ p, m: projMoney(p), l: p.lead_id ? DB.get('leads', p.lead_id) : null })).sort((a, b) => b.m.pending - a.m.pending);
    const due = rows.filter((x) => x.m.pending > 0);
    const po = DB.t.revenue_entries.filter((e) => e.status === 'Pending PO' && M.deptOk(e.department)).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const age = (d) => (d ? Math.max(0, -daysAgo(today) + daysAgo(d)) : null);
    const D = new Map();
    el.innerHTML = `${filterBar({ person: false, period: false })}
      <div class="kpis">
        ${kpi({ label: 'Pending from projects', value: inr(sum(due, (x) => x.m.pending)), sub: `${nfmt(due.length)} projects with money due` })}
        ${kpi({ label: 'Received to date', value: inr(sum(rows, (x) => x.m.received)), sub: `of ${inr(sum(rows, (x) => x.m.order))} ordered` })}
        ${kpi({ label: 'Claimed, to verify', value: inr(sum(rows, (x) => x.m.claimed)), sub: 'Recorded by sales, waiting for Finance' })}
        ${kpi({ label: 'Balance due in the ledger', value: inr(sum(po, (e) => e.amount)), sub: `${nfmt(po.length)} lines in Revenue` })}
      </div>
      <section class="glass panel"><div class="panel-head"><h2><span class="gtag red">${svg('pay')} Money due</span> By project</h2><span class="sub">Order value minus what has come in · biggest first</span></div>
        ${rows.length ? tbl(['Project', 'Client', 'Product', 'Ordered', 'Order value', 'Received', 'Pending', 'Delivered', 'Status', ''], rows.map(({ p, m, l }) => `<tr><td><b class="mono">${esc(p.project_code || '—')}</b><div class="s">${deptChip(p.dept)}</div></td><td><div class="t">${esc(p.name)}</div>${l ? `<div class="s"><a href="#" data-lead="${l.id}">${esc(l.ref_id || l.lead_no)}</a> · ${esc(L.ownerLabel(l))}</div>` : ''}</td><td>${esc(l ? L.line(l) : '')}</td><td>${p.order_date ? fmtDate(p.order_date) + `<div class="s">${age(p.order_date)} days ago</div>` : '—'}</td><td class="n">${inr(m.order)}</td><td class="n">${inr(m.received)}${m.claimed ? `<div class="s warn">${inr(m.claimed)} claimed</div>` : ''}</td><td class="n">${m.pending ? `<b class="bad">${inr(m.pending)}</b>` : '<span class="chip good">Paid</span>'}</td><td>${p.delivered ? `<span class="chip ${/^yes$/i.test(p.delivered) ? 'good' : /partial/i.test(p.delivered) ? 'warn' : ''}">${esc(p.delivered)}</span>` : '—'}</td><td><span class="chip ${PROJ_CLS[p.status] || ''}">${esc(p.status)}</span></td><td class="n">${m.pending && p.lead_id ? `<button class="btn small primary" data-colpay="${p.id}">Record payment</button>` : ''}</td></tr>`)) : empty('No projects yet', 'Won deals become projects. Import the sales sheet in Settings → Import to load them.')}
      </section>
      <section class="glass panel"><div class="panel-head"><h2>Balance due lines</h2><span class="sub">From the revenue ledger · a verified payment on the same deal clears them</span></div>
        ${po.length ? tbl(['Month', 'Process', 'Segment', 'Client', 'Linked', 'Amount'], po.map((e) => `<tr><td>${monShort(String(e.month).slice(0, 7))}</td><td>${deptChip(e.department)}</td><td>${esc(e.segment)}</td><td>${esc(e.client)}</td><td>${e.lead_id ? `<a href="#" data-lead="${e.lead_id}">${esc(e.opp_ref || 'open')}</a>` : esc(e.opp_ref || '')}</td><td class="n"><b>${inr(e.amount)}</b></td></tr>`)) : '<p class="faint">No pending POs.</p>'}
      </section>`;
    bindFilters(el, () => this.render(el)); bindLeadClicks(el);
    el.querySelectorAll('[data-colpay]').forEach((b) => (b.onclick = () => collectModal(DB.get('projects', b.dataset.colpay), () => this.render(el))));
  },
};
function collectModal(p, after) {
  const m0 = projMoney(p); const fin = isFinance();
  const m = openModal({ title: 'Record payment · ' + esc(p.name), width: 520,
    body: `<p class="faint">${esc(p.project_code || '')} · pending ${inrFull(m0.pending)}</p><div class="form">${fld('cpa', 'Amount received (₹, as in the ledger)', inp('cpa', m0.pending, 'number'))}${fld('cpd', 'Received on', inp('cpd', todayStr(), 'date'))}${fld('cpm', 'Mode', sel('cpm', ['Bank transfer', 'UPI', 'Cheque', 'Cash', 'Other'], 'Bank transfer'))}${fld('cpr', 'Reference / UTR', inp('cpr', ''))}</div>
      <p class="note ${fin ? 'good' : 'info'}">${fin ? 'You are Finance: this is saved as verified and shows in Revenue at once.' : 'This is saved as claimed. Finance verifies it, then it shows in Revenue.'}</p>`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="cpgo">Save payment</button>' });
  m.el.querySelector('#cpgo').onclick = () => guard(async () => {
    const amt = num(m.el, 'cpa'); if (!(amt > 0)) throw new Error('Enter the amount.');
    await DB.insert('payments', { lead_id: p.lead_id, amount: amt, amount_ex: amt, paid_on: v(m.el, 'cpd') || todayStr(), mode: v(m.el, 'cpm'), reference: v(m.el, 'cpr'), milestone: 'Project collection', status: fin ? 'Verified' : 'Claimed' });
    [DB.t.payments, DB.t.revenue_entries] = await Promise.all([DB.fetchAll('payments'), DB.fetchAll('revenue_entries')]);
    m.close(); after?.(); DB.emit();
  }, 'Payment saved');
}
const projItems = (id) => DB.t.project_items.filter((i) => i.project_id === id);
const overdueItems = (id) => projItems(id).filter((i) => i.kind !== 'payment' && !['Done', 'Cancelled'].includes(i.status) && i.due_date && i.due_date < todayStr());
VIEWS.projects = {
  title: 'Project Management', sub: 'A won deal becomes a project automatically. Track milestones, tasks, payment milestones (they feed receivables), documents and renewals.',
  actions: () => (hideSales() ? '' : `<button class="btn primary" id="newproj">${svg('plus')} New project</button>`),
  render(el) {
    if (ST.arg) { if (['overdue', 'renewals'].includes(ST.arg)) PF.quick = ST.arg; ST.arg = null; }
    const today = todayStr();
    let rows = DB.t.projects.filter((p) => M.deptOk(p.dept) && (ST.person === 'all' || p.owner === ST.person || p.deal_owner === ST.person));
    if (hideSales()) rows = rows.filter((p) => p.owner === DB.me.id || projItems(p.id).some((i) => i.owner === DB.me.id));
    if (PF.quick === 'overdue') rows = rows.filter((p) => overdueItems(p.id).length);
    else if (PF.quick === 'renewals') rows = rows.filter((p) => p.renewal_date && p.renewal_date >= today && daysAgo(p.renewal_date) >= -30);
    else if (PF.status === 'active') rows = rows.filter((p) => p.status !== 'Completed');
    else if (PF.status !== 'all') rows = rows.filter((p) => p.status === PF.status);
    rows.sort((a, b) => String(a.end_date || a.target_date || '9999').localeCompare(String(b.end_date || b.target_date || '9999')));
    el.innerHTML = `${filterBar({ period: false })}<section class="glass panel"><div class="row between" style="margin-bottom:10px">
      ${PF.quick ? `<span class="chip acc qchip">${PF.quick === 'overdue' ? 'Milestones overdue' : 'Renewals in 30 days'} <button class="btn ghost small" id="pqx" aria-label="Clear">${svg('x')}</button></span>` : `<div class="seg">${[['active', 'Active'], ...PROJ_STATUS.map((s) => [s, s]), ['all', 'All']].map(([k, t]) => `<button data-ps="${k}" aria-pressed="${PF.status === k}">${t}</button>`).join('')}</div>`}
      <div class="seg"><button data-pm="list" aria-pressed="${PF.mode === 'list'}">${svg('list')} List</button><button data-pm="kanban" aria-pressed="${PF.mode === 'kanban'}">${svg('board')} Kanban</button><button data-pm="timeline" aria-pressed="${PF.mode === 'timeline'}">${svg('cal')} Timeline</button></div></div><div id="pbody"></div></section>`;
    const b = el.querySelector('#pbody'); const rer = () => this.render(el);
    if (!rows.length) b.innerHTML = empty('No projects here', 'Winning a deal creates its project. You can also add one by hand.');
    else if (PF.mode === 'kanban') {
      b.innerHTML = `<div class="kanban">${PROJ_STATUS.map((s) => { const a = rows.filter((p) => p.status === s); return `<div class="kcol glass" data-col="${s}"><div class="khead"><b>${s}</b><span class="faint">${a.length} · ${inr(sum(a, (p) => p.value))}</span></div><div class="kbody">${a.map((p) => `<div class="kcard" draggable="true" data-id="${p.id}" data-proj="${p.id}"><b>${esc(p.name)}</b><span class="s">${deptChip(p.dept)} ${inr(p.value)}</span><span class="s">${esc(DB.pname(p.owner))}${p.end_date ? ' · ends ' + fmtDate(p.end_date) : ''}${overdueItems(p.id).length ? ` · <span class="bad">${overdueItems(p.id).length} overdue</span>` : ''}</span></div>`).join('')}</div></div>`; }).join('')}</div>`;
      let dragId = null;
      b.querySelectorAll('.kcard').forEach((c) => { c.ondragstart = (e) => { dragId = c.dataset.id; e.dataTransfer.setData('text/plain', dragId); }; });
      b.querySelectorAll('.kcol').forEach((col) => { col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); }; col.ondragleave = () => col.classList.remove('over'); col.ondrop = (e) => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain') || dragId; guard(async () => { await DB.update('projects', id, { status: col.dataset.col }); rer(); }, 'Status changed'); }; });
    } else if (PF.mode === 'timeline') b.innerHTML = projTimeline(rows);
    else b.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Project</th><th>Account</th><th>Owner</th><th>Status</th><th>Start</th><th>End</th><th class="n">Order value</th><th class="n">Received</th><th class="n">Pending</th><th class="n">Milestones</th><th>Renewal</th></tr></thead><tbody>
      ${rows.map((p) => { const it = projItems(p.id); const ms = it.filter((i) => i.kind !== 'payment'); const pay = it.filter((i) => i.kind === 'payment' && ['Open', 'Invoiced'].includes(i.status)); const od = overdueItems(p.id).length; return `<tr class="click" data-proj="${p.id}"><td><div class="t">${esc(p.name)}</div><div class="s">${deptChip(p.dept)}</div></td><td>${esc(DB.get('institutions', p.institution_id)?.name || '')}</td><td>${esc(DB.pname(p.owner))}</td><td><span class="chip ${PROJ_CLS[p.status] || ''}">${esc(p.status)}</span></td><td>${fmtDate(p.start_date)}</td><td>${fmtDate(p.end_date || p.target_date)}</td><td class="n">${inr(projMoney(p).order)}</td><td class="n">${inr(projMoney(p).received)}</td><td class="n">${projMoney(p).pending ? `<b class="bad">${inr(projMoney(p).pending)}</b>` : '—'}</td><td class="n">${ms.filter((i) => i.status === 'Done').length}/${ms.length}${od ? ` <span class="chip bad">${od} late</span>` : ''}${pay.length ? ` <span class="chip warn">${inr(sum(pay, (i) => i.amount))} due</span>` : ''}</td><td>${p.renewal_date ? `<span class="${daysAgo(p.renewal_date) >= -30 && p.renewal_date >= today ? 'chip warn' : ''}">${fmtDate(p.renewal_date)}</span>` : '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
    el.querySelectorAll('[data-ps]').forEach((x) => (x.onclick = () => { PF.status = x.dataset.ps; rer(); }));
    el.querySelectorAll('[data-pm]').forEach((x) => (x.onclick = () => { PF.mode = x.dataset.pm; rer(); }));
    el.querySelector('#pqx')?.addEventListener('click', () => { PF.quick = ''; rer(); });
    el.querySelectorAll('[data-proj]').forEach((x) => (x.onclick = () => openProject(x.dataset.proj)));
    bindFilters(el, rer);
  },
  mount() { $('#newproj')?.addEventListener('click', () => newProjectModal()); },
};
function projTimeline(rows) {
  const ds = rows.flatMap((p) => [p.start_date, p.end_date || p.target_date]).filter(Boolean).sort();
  const s = new Date((ds[0] || todayStr()).slice(0, 7) + '-01T00:00:00'); const e0 = new Date((ds[ds.length - 1] || todayStr()) + 'T00:00:00'); const e = new Date(e0.getFullYear(), e0.getMonth() + 1, 1);
  if ((e - s) / 864e5 < 90) e.setMonth(s.getMonth() + 3);
  const span = e - s; const x = (d) => clamp(((new Date(d + 'T12:00:00') - s) / span) * 100, 0, 100);
  const months = []; for (let d = new Date(s); d < e; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const tx = x(todayStr());
  return `<div class="tline"><div class="tlh">${months.map((m) => `<span style="left:${x(localDate(m))}%">${m.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>`).join('')}</div>
    ${rows.map((p) => { const a = p.start_date || todayStr(); const b = p.end_date || p.target_date || a; const ms = projItems(p.id).filter((i) => i.due_date); return `<div class="tlrow" data-proj="${p.id}"><span class="tln">${esc(p.name)}</span><span class="tlt"><i class="tlb ${PROJ_CLS[p.status] || ''}" style="left:${x(a)}%;width:${Math.max(1.5, x(b) - x(a))}%;--dc:${esc(deptColor(p.dept))}"></i>${ms.map((i) => `<i class="tlm ${i.status === 'Done' || i.status === 'Collected' ? 'ok' : i.due_date < todayStr() ? 'late' : ''}" style="left:${x(i.due_date)}%" title="${esc(i.name)} · ${fmtDate(i.due_date)}"></i>`).join('')}<i class="tlnow" style="left:${tx}%"></i></span></div>`; }).join('')}</div>`;
}
function newProjectModal(pre = {}) {
  const m = openModal({ title: 'New project', width: 640, body: `<div class="form">${fld('pn', 'Project name', inp('pn', pre.name || ''), 'full')}${fld('pd', 'Department', sel('pd', DEPTS().map((d) => [d.code, d.name]), pre.dept || (ST.dept !== 'All' ? ST.dept : myDepts()[0])))}${fld('po', 'Project owner', `<select id="po">${opts(assignablePeople().map((p) => [p.id, p.full_name]), DB.me.id)}</select>`)}${fld('pa', 'Account', `<select id="pa">${opts(DB.t.institutions.map((i) => [i.id, i.name]), pre.institution_id, 'None')}</select>`)}${fld('pv', 'Value ex-GST (₹)', inp('pv', pre.value || '', 'number'))}${fld('ps', 'Start', inp('ps', todayStr(), 'date'))}${fld('pe', 'End', inp('pe', '', 'date'))}</div>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="pgo">Create</button>' });
  m.el.querySelector('#pgo').onclick = () => guard(async () => { const n = v(m.el, 'pn').trim(); if (!n) throw new Error('Name the project'); const p = await DB.insert('projects', { name: n, dept: v(m.el, 'pd'), owner: v(m.el, 'po'), deal_owner: DB.me.id, institution_id: v(m.el, 'pa') || null, value: num(m.el, 'pv'), start_date: v(m.el, 'ps') || null, end_date: v(m.el, 'pe') || null, status: 'Not started' }); m.close(); openProject(p.id); }, 'Project created');
}
let projTab = 'plan';
function openProject(id) {
  openDrawer((ctx) => {
    const p = DB.get('projects', id); if (!p) return ctx.close();
    const it = projItems(id).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
    const l = p.lead_id && DB.get('leads', p.lead_id);
    const paid = sum(it.filter((i) => i.kind === 'payment' && i.status === 'Collected'), (i) => i.amount), sched = sum(it.filter((i) => i.kind === 'payment' && i.status !== 'Cancelled'), (i) => i.amount);
    ctx.el.innerHTML = `<div class="drawer-head"><div><div class="row">${deptChip(p.dept)}<span class="chip ${PROJ_CLS[p.status] || ''}">${esc(p.status)}</span></div><h2 style="margin-top:6px">${esc(p.name)}</h2><div class="faint" style="font-size:12.5px">${inr(p.value)} · owner ${esc(DB.pname(p.owner))} · deal by ${esc(DB.pname(p.deal_owner))}${l ? ` · <a href="#" id="pdeal">open the deal</a>` : ''}</div></div><button class="btn ghost small" data-close>${svg('x')}</button></div>
      <div class="tabs">${[['plan', `Milestones & tasks (${it.filter((i) => i.kind !== 'payment').length})`], ['pay', `Payment milestones (${it.filter((i) => i.kind === 'payment').length})`], ['details', 'Details & documents']].map(([k, t]) => `<button data-t="${k}" aria-selected="${projTab === k}">${t}</button>`).join('')}</div><div class="drawer-body" id="pb"></div>`;
    ctx.el.querySelector('[data-close]').onclick = ctx.close;
    ctx.el.querySelector('#pdeal')?.addEventListener('click', (e) => { e.preventDefault(); openLead(l.id); });
    ctx.el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { projTab = b.dataset.t; ctx.render(); }));
    const b = ctx.el.querySelector('#pb');
    if (projTab === 'details') {
      b.innerHTML = `<div class="form">${fld('dn', 'Name', inp('dn', p.name), 'full')}${fld('ds', 'Status', sel('ds', PROJ_STATUS, p.status))}${fld('do', 'Project owner', `<select id="do">${opts([...assignablePeople(), ...(p.owner && !assignablePeople().some((x) => x.id === p.owner) && DB.profile(p.owner) ? [DB.profile(p.owner)] : [])].map((x) => [x.id, x.full_name]), p.owner)}</select>`)}
        ${fld('dst', 'Start', inp('dst', p.start_date || '', 'date'))}${fld('den', 'End', inp('den', p.end_date || p.target_date || '', 'date'))}${fld('dv', 'Value ex-GST (₹)', inp('dv', p.value || 0, 'number'))}${fld('drn', 'Renewal date', inp('drn', p.renewal_date || '', 'date'))}
        ${fld('da', 'Account', `<select id="da">${opts(DB.t.institutions.map((i) => [i.id, i.name]), p.institution_id, 'None')}</select>`)}${fld('dd', 'Department', sel('dd', DEPTS(true).map((d) => [d.code, d.name]), p.dept))}
        ${fld('dl', 'Documents and links (one per line: label | address)', `<textarea id="dl" placeholder="MoU | https://drive.google.com/…">${esc((p.links || []).map((x) => `${x.label || ''} | ${x.url || ''}`).join('\n'))}</textarea>`, 'full')}
        ${fld('dno', 'Notes', `<textarea id="dno">${esc(p.notes || '')}</textarea>`, 'full')}</div>
        ${(p.links || []).length ? `<div class="list" style="margin:8px 0">${p.links.map((x) => `<a class="item" href="${esc(x.url)}" target="_blank" rel="noopener">${svg('link')} <span class="grow">${esc(x.label || x.url)}</span></a>`).join('')}</div>` : ''}
        <div class="row" style="justify-content:flex-end"><button class="btn primary" id="dsave">Save</button></div>`;
      b.querySelector('#dsave').onclick = () => guard(async () => {
        const links = v(b, 'dl').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const [a, c] = x.includes('|') ? x.split('|').map((y) => y.trim()) : ['', x]; return { label: a || c, url: c }; }).filter((x) => /^https?:\/\//i.test(x.url));
        await DB.update('projects', id, { name: v(b, 'dn'), status: v(b, 'ds'), owner: v(b, 'do'), start_date: v(b, 'dst') || null, end_date: v(b, 'den') || null, value: num(b, 'dv'), renewal_date: v(b, 'drn') || null, institution_id: v(b, 'da') || null, dept: v(b, 'dd'), links, notes: v(b, 'dno') }); ctx.render();
      }, 'Saved');
    } else {
      const pay = projTab === 'pay'; const list = it.filter((i) => (i.kind === 'payment') === pay);
      b.innerHTML = `${pay ? `<div class="kpis">${kpi({ label: 'Scheduled', value: inr(sched), sub: `of ${inr(p.value)} project value` })}${kpi({ label: 'Collected', value: inr(paid), sub: 'Sent to Finance to verify' })}${kpi({ label: 'Still to collect', value: inr(sched - paid), sub: 'Feeds receivables' })}</div>` : ''}
        <div class="tablewrap"><table><thead><tr><th>${pay ? 'Payment milestone' : 'Milestone / task'}</th>${pay ? '<th class="n">Amount ex-GST</th>' : '<th>Type</th>'}<th>Due</th><th>Owner</th><th>Status</th></tr></thead><tbody>
        ${list.map((i) => `<tr><td>${esc(i.name)}${i.payment_id ? ' <span class="chip good">payment recorded</span>' : ''}</td>${pay ? `<td class="n">${inrFull(i.amount)}</td>` : `<td>${i.kind === 'milestone' ? 'Milestone' : 'Task'}</td>`}<td>${i.due_date ? `<span class="${i.due_date < todayStr() && !['Done', 'Collected', 'Cancelled'].includes(i.status) ? 'chip bad' : ''}">${fmtDate(i.due_date)}</span>` : '—'}</td><td>${esc(DB.pname(i.owner))}</td><td><select data-ist="${i.id}" aria-label="Status" ${i.payment_id ? 'disabled' : ''}>${opts(ITEM_STATUS[i.kind], i.status)}</select></td></tr>`).join('') || `<tr><td colspan="5" class="faint">Nothing yet.</td></tr>`}</tbody></table></div>
        <div class="glass panel" style="padding:12px;margin-top:10px"><div class="form three">
          ${pay ? '' : fld('ik', 'Type', sel('ik', [['milestone', 'Milestone'], ['task', 'Task']], 'milestone'))}${fld('in', pay ? 'Payment milestone' : 'Name', inp('in', '', 'text', pay ? 'placeholder="e.g. Advance 40%"' : ''))}${pay ? fld('ia', 'Amount ex-GST (₹)', inp('ia', '', 'number')) : ''}${fld('id', 'Due', inp('id', '', 'date'))}${fld('io', 'Owner', `<select id="io">${opts([...scopePeople()].map((x) => [x.id, x.full_name]), p.owner)}</select>`)}
          <div class="field" style="justify-content:flex-end"><button class="btn primary" id="iadd">${svg('plus')} Add</button></div></div>
          ${pay ? '<p class="faint" style="font-size:12px;margin:6px 0 0">Mark a payment milestone Collected and it is sent to Finance as a payment on the deal. Once verified it reaches the revenue ledger.</p>' : ''}</div>`;
      b.querySelectorAll('[data-ist]').forEach((s0) => (s0.onchange = () => guard(async () => { if (s0.value === 'Collected' && !(await confirmBox('Mark this payment milestone collected? It goes to Finance for verification.', 'Mark collected'))) { s0.value = DB.get('project_items', s0.dataset.ist).status; return; } await DB.update('project_items', s0.dataset.ist, { status: s0.value, ...(['Done', 'Collected'].includes(s0.value) ? { done_at: nowISO() } : {}) }); if (s0.value === 'Collected') { DB.t.payments = await DB.fetchAll('payments'); } ctx.render(); }, 'Updated')));
      b.querySelector('#iadd').onclick = () => guard(async () => { const n = v(b, 'in').trim(); if (!n) throw new Error('Enter the name'); await DB.insert('project_items', { project_id: id, kind: pay ? 'payment' : v(b, 'ik'), name: n, amount: pay ? num(b, 'ia') : 0, due_date: v(b, 'id') || null, owner: v(b, 'io') || null, status: 'Open' }); ctx.render(); }, 'Added');
    }
  });
}

/* ================= Escalations ================= */
const ESC_STATUS = ['Open', 'In progress', 'Escalated up', 'Resolved', 'Closed'];
const ESC_SEV = ['Low', 'Medium', 'High', 'Critical'];
const ESC_CLS = { Low: '', Medium: 'acc', High: 'warn', Critical: 'bad' };
const escTypes = () => DB.settings.escalation_types || ['Customer complaint', 'Delivery delay', 'Payment delay', 'Internal', 'Other'];
const escLink = (c) => { const l = c.lead_id && DB.get('leads', c.lead_id); const p = c.project_id && DB.get('projects', c.project_id); const i = c.institution_id && DB.get('institutions', c.institution_id); return l ? (l.is_deal ? 'Deal · ' : 'Lead · ') + l.name : p ? 'Project · ' + p.name : i ? 'Account · ' + i.name : ''; };
function escItem(c) {
  const late = ESC_OPEN.includes(c.status) && c.due_at && new Date(c.due_at) < new Date();
  return `<button class="item" data-esc="${c.id}"><span class="dot ${late ? 'bad' : ESC_OPEN.includes(c.status) ? 'warn' : 'good'}"></span><span class="grow"><b>${esc(c.title || c.category || c.description?.slice(0, 60))}</b><span class="s">${esc(c.type || c.category || '')} · ${esc(escLink(c))} · owner ${esc(DB.pname(c.owner))}${c.due_at && ESC_OPEN.includes(c.status) ? ` · respond by ${fmtDT(c.due_at)}` : ''}</span></span><span class="chip ${ESC_CLS[c.severity] || ''}">${esc(c.severity)}</span><span class="chip ${late ? 'bad' : ''}">${late ? 'Past deadline' : esc(c.status)}</span></button>`;
}
const EF = { state: 'open' };
VIEWS.escalations = {
  title: 'Escalations', sub: 'Customer complaints, delays and internal issues with a response deadline by severity. Escalate up moves it to the owner\'s manager.',
  actions: () => `<button class="btn primary" id="newesc">${svg('plus')} Raise escalation</button>`,
  render(el) {
    if (ST.arg) { if (['open', 'late', 'closed', 'all'].includes(ST.arg)) EF.state = ST.arg; ST.arg = null; }
    const base = DB.t.complaints.filter((c) => M.deptOk(c.dept || '') && M.personOk(c.owner));
    const F = { open: (c) => ESC_OPEN.includes(c.status), late: (c) => ESC_OPEN.includes(c.status) && c.due_at && new Date(c.due_at) < new Date(), closed: (c) => !ESC_OPEN.includes(c.status), all: () => true };
    const rows = base.filter(F[EF.state]).sort((a, b) => ESC_SEV.indexOf(b.severity) - ESC_SEV.indexOf(a.severity) || String(a.due_at).localeCompare(String(b.due_at)));
    el.innerHTML = `${filterBar({ period: false })}<section class="glass panel"><div class="seg" style="margin-bottom:10px">${[['open', 'Open'], ['late', 'Past deadline'], ['closed', 'Resolved & closed'], ['all', 'All']].map(([k, t]) => `<button data-es="${k}" aria-pressed="${EF.state === k}">${t} <span class="faint">${base.filter(F[k]).length}</span></button>`).join('')}</div>
      ${rows.length ? `<div class="list">${rows.map(escItem).join('')}</div>` : empty('Nothing here', EF.state === 'open' ? 'No open escalations.' : 'No escalations match.')}</section>`;
    el.querySelectorAll('[data-es]').forEach((b) => (b.onclick = () => { EF.state = b.dataset.es; this.render(el); }));
    el.querySelectorAll('[data-esc]').forEach((b) => (b.onclick = () => escalationModal(DB.get('complaints', b.dataset.esc), () => this.render(el))));
    bindFilters(el, () => this.render(el));
  },
  mount() { $('#newesc')?.addEventListener('click', () => escalationModal({}, () => render())); },
};
function escalationModal(c = {}, after) {
  const isNew = !c.id; const hrs = DB.settings.escalation_hours || {};
  const people = scopePeople(); if (c.owner && !people.some((p) => p.id === c.owner) && DB.profile(c.owner)) people.push(DB.profile(c.owner));
  const up = c.owner && DB.profile(DB.profile(c.owner)?.reports_to);
  const m = openModal({ title: isNew ? 'Raise escalation' : esc(c.title || 'Escalation'), width: 720,
    body: `<div class="form">${fld('et', 'Title', inp('et', c.title || ''), 'full')}
      ${fld('elink', 'Lead, deal or account', recordPicker('elink', c), 'full')}
      ${fld('ep', 'Project (optional)', `<select id="ep">${opts(DB.t.projects.map((p) => [p.id, p.name]), c.project_id, 'None')}</select>`)}
      ${fld('ed', 'Department', sel('ed', DEPTS(true).map((d) => [d.code, d.name]), c.dept || (ST.dept !== 'All' ? ST.dept : myDepts()[0])))}
      ${fld('ety', 'Type', sel('ety', [...new Set([...escTypes(), c.type].filter(Boolean))], c.type || escTypes()[0]))}
      ${fld('es', 'Severity', sel('es', ESC_SEV.map((s) => [s, `${s} · respond in ${hrs[s] ?? 48} h`]), c.severity || 'Medium'))}
      ${fld('eo', 'Owner', `<select id="eo">${opts(people.map((p) => [p.id, p.full_name]), c.owner || DB.me.id)}</select>`)}
      ${isNew ? '' : fld('est', 'Status', sel('est', ESC_STATUS, c.status))}
      ${fld('edesc', 'What happened', `<textarea id="edesc">${esc(c.description || '')}</textarea>`, 'full')}
      ${isNew ? '' : fld('eres', 'Resolution', `<textarea id="eres">${esc(c.closure_notes || '')}</textarea>`, 'full')}
      ${isNew ? '' : `<div class="full faint" style="font-size:12.5px">Raised by ${esc(DB.pname(c.raised_by))} ${fmtDT(c.created_at)} · respond by ${fmtDT(c.due_at)}${(c.history || []).map((h) => `<br>Escalated ${fmtDT(h.at)}: ${esc(DB.pname(h.from))} → ${esc(DB.pname(h.to))}`).join('')}</div>`}</div>`,
    foot: `${!isNew && ESC_OPEN.includes(c.status) ? `<button class="btn" id="eup" style="margin-right:auto" ${up ? '' : 'disabled title="The owner has nobody above them"'}>${svg('up')} Escalate up${up ? ' to ' + esc(up.full_name) : ''}</button>` : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="esave">${isNew ? 'Raise' : 'Save'}</button>` });
  bindPicker(m.el, 'elink');
  m.el.querySelector('#esave').onclick = () => guard(async () => {
    const t = v(m.el, 'et').trim(); if (!t) throw new Error('Give it a title.');
    const link = pickerVal(m.el, 'elink');
    const row = { title: t, ...link, project_id: v(m.el, 'ep') || null, dept: v(m.el, 'ed'), type: v(m.el, 'ety'), category: v(m.el, 'ety'), severity: v(m.el, 'es'), owner: v(m.el, 'eo'), description: v(m.el, 'edesc') };
    if (isNew) await DB.insert('complaints', { ...row, raised_by: DB.me.id, status: 'Open' });
    else { row.status = v(m.el, 'est'); row.closure_notes = v(m.el, 'eres'); if (['Resolved', 'Closed'].includes(row.status) && !row.closure_notes.trim()) throw new Error('Write the resolution before resolving or closing.'); await DB.update('complaints', c.id, row); }
    m.close(); after?.();
  }, isNew ? 'Escalation raised' : 'Saved');
  m.el.querySelector('#eup')?.addEventListener('click', () => guard(async () => { await DB.call('escalate_up', { p_id: c.id }, ['complaints']); m.close(); after?.(); }, `Escalated to ${up?.full_name || 'the manager'}`));
}
