/* Garuda CRM · price book and settings */
'use strict';

let pbQ = '';
VIEWS.pricebook = {
  title: 'Price book', sub: 'Every approved price, ex-GST. Sales sees this price on every enquiry.',
  actions: () => (canPricebook() ? `<button class="btn primary" id="newprod">${svg('plus')} New product</button>` : ''),
  render(el) {
    const ps = DB.t.products.filter((p) => (canPricebook() || p.active) && (!pbQ || (p.name + p.category + p.code).toLowerCase().includes(pbQ.toLowerCase()))).sort((a, b) => a.sort - b.sort);
    const g = groupBy(ps, (p) => `${p.funnel}|${p.category}`);
    const gcat = (p) => (DB.settings.gst?.categories || []).find((c) => c.key === p.gst_category);
    el.innerHTML = `<section class="glass panel"><div class="filters" style="margin-bottom:10px"><input type="search" id="pbq" placeholder="Search products" value="${esc(pbQ)}"><span class="faint" style="font-size:12.5px">Bulk prices apply automatically at 25+ and 50+ seats. GST is shown per product; labs use the blended rate of their line items.</span></div>
      ${Object.entries(g).map(([k, a], gi) => { const [fn, cat] = k.split('|'); return `<div class="pbgroup" style="--dc:${esc(deptColor(fn))}"><div class="pbhead"><span class="pbnum">${String(gi + 1).padStart(2, '0')}</span><div class="grow"><span class="pbteam">${deptChip(fn)} ${esc(dept(fn).name)}</span><h3>${esc(cat || 'Other')}</h3></div><span class="faint">${a.length} product${a.length === 1 ? '' : 's'}${a.some((p) => p.price) ? ` · from ${inrFull(Math.min(...a.filter((p) => p.price).map((p) => Number(p.price))))}` : ''}</span></div><div class="tablewrap"><table class="pbtable"><thead><tr><th>Product</th><th>Unit</th><th class="n">List ex-GST</th><th class="n">25+</th><th class="n">50+</th><th class="n">GST</th><th class="n">Incl. GST</th><th class="n">Garuda share</th><th>Notes</th></tr></thead><tbody>
        ${a.map((p) => `<tr ${canPricebook() ? `class="click" data-prod="${p.id}"` : ''}><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="chip">inactive</span>'}<div class="s mono">${esc(p.code)}${p.duration ? ' · ' + esc(p.duration) : ''}</div></td><td>${esc(p.unit)}</td><td class="n">${p.price ? inrFull(p.price) : '<span class="faint">On request</span>'}</td><td class="n">${p.tier25 ? inrFull(p.tier25) : '—'}</td><td class="n">${p.tier50 ? inrFull(p.tier50) : '—'}</td><td class="n">${(+p.gst_rate).toFixed(p.gst_rate % 1 ? 2 : 0)}%${gcat(p) ? `<div class="s">${esc(gcat(p).label.split(' ')[0])}${gcat(p).sac ? ' · ' + esc(gcat(p).sac) : ''}</div>` : ''}</td><td class="n">${p.price ? inrFull(p.price * (1 + p.gst_rate / 100)) : '—'}</td><td class="n">${p.share_pct}%</td><td class="s">${esc(p.notes)}${DB.t.product_items.some((i) => i.product_id === p.id) ? ` <button class="btn ghost small" data-items="${p.id}">Line items</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`; }).join('')}</section>`;
    el.querySelector('#pbq').oninput = (e) => { pbQ = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { this.render(el); const i = el.querySelector('#pbq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    el.querySelectorAll('[data-prod]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('[data-items]')) return; productModal(DB.get('products', tr.dataset.prod), () => this.render(el)); }));
    el.querySelectorAll('[data-items]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); itemsModal(DB.get('products', b.dataset.items)); }));
  },
  mount() { $('#newprod')?.addEventListener('click', () => productModal({}, () => render())); },
};
function productModal(p = {}, after) {
  const m = openModal({ title: p.id ? 'Edit ' + esc(p.name) : 'New product', width: 760,
    body: `<div class="form three">${fld('pc', 'Code', inp('pc', p.code || ''))}${fld('pf', 'Funnel', sel('pf', DEPTS(true).map((d) => [d.code, d.name]), p.funnel || DEPTS()[0]?.code))}${fld('pv', 'Vertical', sel('pv', ['Academy', 'UAV Lab', 'RPTO Establishment', 'Training / Certification'], p.vertical || 'Training / Certification'))}
      ${fld('pn', 'Name', inp('pn', p.name || ''), 'full')}${fld('pcat', 'Category', inp('pcat', p.category || ''))}${fld('pline', 'Product line (revenue reports)', inp('pline', p.line || '', 'text', 'placeholder="e.g. Dronistaan Day"'))}${fld('pgc', 'GST category', `<select id="pgc">${opts((DB.settings.gst?.categories || []).map((c) => [c.key, c.label]), p.gst_category, '—')}</select>`)}${fld('pu', 'Unit', inp('pu', p.unit || 'unit'))}${fld('pd', 'Duration', inp('pd', p.duration || ''))}
      ${fld('pp', 'List price ex-GST (₹)', inp('pp', p.price ?? 0, 'number'))}${fld('pt25', 'Price at 25+ (₹)', inp('pt25', p.tier25 ?? '', 'number'))}${fld('pt50', 'Price at 50+ (₹)', inp('pt50', p.tier50 ?? '', 'number'))}
      ${fld('pg', 'GST %', inp('pg', p.gst_rate ?? 18, 'number', 'step="0.0001"'))}${fld('ps', 'Garuda share %', inp('ps', p.share_pct ?? 100, 'number'))}${fld('pm', 'Minimum quantity', inp('pm', p.min_qty ?? 1, 'number'))}
      ${fld('pnote', 'Notes shown to sales', inp('pnote', p.notes || ''), 'full')}<label class="check"><input type="checkbox" id="pa" ${p.active !== false ? 'checked' : ''}> Active (shown to sales)</label></div>`,
    foot: '<button class="btn primary" id="psave">Save price</button>' });
  m.el.querySelector('#psave').onclick = () => guard(async () => { const row = { code: v(m.el, 'pc'), funnel: v(m.el, 'pf'), vertical: v(m.el, 'pv'), name: v(m.el, 'pn'), category: v(m.el, 'pcat'), line: v(m.el, 'pline') || v(m.el, 'pcat'), gst_category: v(m.el, 'pgc') || '', unit: v(m.el, 'pu'), duration: v(m.el, 'pd'), price: num(m.el, 'pp'), tier25: v(m.el, 'pt25') ? num(m.el, 'pt25') : null, tier50: v(m.el, 'pt50') ? num(m.el, 'pt50') : null, gst_rate: num(m.el, 'pg'), share_pct: num(m.el, 'ps'), min_qty: num(m.el, 'pm') || 1, notes: v(m.el, 'pnote'), active: v(m.el, 'pa'), sort: p.sort ?? 500 }; if (!row.code || !row.name) throw new Error('Code and name are required'); if (p.id) await DB.update('products', p.id, row); else await DB.insert('products', row); m.close(); after?.(); }, 'Price saved');
}
function itemsModal(p) {
  const items = DB.t.product_items.filter((i) => i.product_id === p.id).sort((a, b) => a.sort - b.sort);
  const ex = sum(items, (i) => i.qty * i.unit_price), gst = sum(items, (i) => (i.qty * i.unit_price * i.gst_rate) / 100);
  openModal({ title: esc(p.name) + ' · line items', width: 760, body: `<div class="tablewrap"><table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">GST</th><th class="n">Amount</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td><td class="n">${inrFull(i.unit_price)}</td><td class="n">${i.gst_rate}%</td><td class="n">${inrFull(i.qty * i.unit_price)}</td></tr>`).join('')}<tr class="tot"><td colspan="4">Total ex-GST</td><td class="n">${inrFull(ex)}</td></tr><tr><td colspan="4">GST</td><td class="n">${inrFull(gst)}</td></tr><tr class="tot"><td colspan="4">Total incl. GST</td><td class="n">${inrFull(ex + gst)}</td></tr></tbody></table></div><p class="faint" style="font-size:12px">From the UAV Lab quotation. Edit line items in Supabase → Table editor → product_items.</p>` });
}

/* ================= Settings (Admin only) ================= */
let setTab = 'users';
const SET_TABS = [['company', 'Company & logo'], ['users', 'Users & Access'], ['depts', 'Teams & processes'], ['import', 'Import sales sheet'], ['config', 'Statuses, stages & lists'], ['targets', 'Sales targets'], ['camptypes', 'Campaign types'], ['rules', 'Visits, escalations & rules'], ['kra', 'KRA'], ['gst', 'GST'], ['lists', 'Lists'], ['email', 'Email senders'], ['ai', 'Claude AI'], ['data', 'Data']];
VIEWS.settings = {
  title: 'Settings', sub: 'Departments and their pipelines, people and access, campaign types, rules, KRA, GST, email, Claude and data. Only Admins open Settings.',
  render(el) {
    if (ST.arg) { setTab = ST.arg; ST.arg = null; }
    if (!SET_TABS.some(([k]) => k === setTab)) setTab = 'users';
    el.innerHTML = `<div class="seg wrap">${SET_TABS.map(([k, t]) => `<button data-st="${k}" aria-pressed="${setTab === k}">${t}${k === 'users' && badgeFor('settings') ? ` <span class="badge">${badgeFor('settings')}</span>` : ''}</button>`).join('')}</div><div id="setb" class="view"></div>`;
    el.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => { setTab = b.dataset.st; this.render(el); }));
    const b = el.querySelector('#setb'); const rer = () => this.render(el);
    ({ company: setCompany, users: setUsers, depts: setDepts, import: setImport, config: setConfig, targets: setTargets, camptypes: setCampTypes, rules: setRules, kra: setKra, gst: setGst, lists: setLists, email: setEmail, ai: setAI, data: setData })[setTab](b, rer);
  },
};
/* tables keyed by something other than id */
async function upsertKey(t, row, keys) {
  const { error } = await DB.sb.from(t).upsert(row, { onConflict: keys.join(',') });
  if (error) throw new Error(friendly(error));
  DB.t[t] = await DB.fetchAll(t); DB.emit();
}
async function deleteKey(t, match) {
  let q = DB.sb.from(t).delete(); Object.entries(match).forEach(([k, x]) => (q = q.eq(k, x)));
  const { error } = await q; if (error) throw new Error(friendly(error));
  DB.t[t] = await DB.fetchAll(t); DB.emit();
}

/* ---------- Company name, logo, office city (for the weather) and an announcement ---------- */
function setCompany(b, rer) {
  const c = { ...(DB.settings.company || {}) };
  b.innerHTML = `<div class="grid g2"><section class="glass panel"><div class="panel-head"><h2>Company and logo</h2><span class="sub">Shown in the sidebar, on the phone header and on the sign-in screen</span></div>
      <div class="row" style="gap:16px;align-items:center;margin-bottom:12px"><div class="brand big"><div class="mark ${safeLogo(c.logo) ? 'has-logo' : ''}" id="cmark">${safeLogo(c.logo) ? `<img src="${safeLogo(c.logo)}" alt="Logo">` : esc((c.name || 'G')[0])}</div></div>
        <div class="row"><label class="btn" for="clogo">${svg('plus')} Upload logo</label><input type="file" id="clogo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>${c.logo ? '<button class="btn ghost" id="cnolog">Remove logo</button>' : ''}</div></div>
      <p class="faint" style="font-size:12px;margin-top:0">PNG, JPG, WebP or SVG. Square works best; it is shrunk to 256 px.</p>
      <div class="form">${fld('cname', 'Company or CRM name', inp('cname', c.name || 'Garuda CRM'))}${fld('ctag', 'Tagline', inp('ctag', c.tagline || 'Garuda Aerospace · sales & delivery'))}</div></section>
    <section class="glass panel"><div class="panel-head"><h2>Welcome screen</h2><span class="sub">The greeting at the top of the Command Centre</span></div>
      <div class="form">${fld('ccity', 'Office city (for the weather)', inp('ccity', c.city || 'Chennai'))}<div class="field" style="justify-content:flex-end"><button class="btn" id="cfind">Find city</button></div>
        ${fld('clat', 'Latitude', inp('clat', c.lat ?? 13.0827, 'number', 'step="0.0001"'))}${fld('clon', 'Longitude', inp('clon', c.lon ?? 80.2707, 'number', 'step="0.0001"'))}
        ${fld('cann', 'Announcement for everyone (optional)', `<textarea id="cann" placeholder="e.g. Quarter-end review on Friday 4 pm">${esc(c.announcement || '')}</textarea>`, 'full')}</div></section></div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" id="csave">Save</button></div>`;
  let logo = c.logo || '';
  b.querySelector('#clogo').onchange = (e) => { const f = e.target.files[0]; if (!f) return; shrinkLogo(f).then((d) => { logo = d; b.querySelector('#cmark').classList.add('has-logo'); b.querySelector('#cmark').innerHTML = `<img src="${d}" alt="Logo">`; }).catch((er) => toast(er.message, true)); };
  b.querySelector('#cnolog')?.addEventListener('click', () => { logo = ''; b.querySelector('#cmark').classList.remove('has-logo'); b.querySelector('#cmark').textContent = (v(b, 'cname') || 'G')[0]; });
  b.querySelector('#cfind').onclick = () => guard(async () => {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(v(b, 'ccity'))}&count=1`).catch(() => null);
    const j = r && r.ok ? await r.json() : null; const g = j?.results?.[0];
    if (!g) throw new Error('City not found. Enter the latitude and longitude yourself.');
    b.querySelector('#clat').value = g.latitude.toFixed(4); b.querySelector('#clon').value = g.longitude.toFixed(4); b.querySelector('#ccity').value = g.name;
  });
  b.querySelector('#csave').onclick = () => guard(async () => {
    await DB.setSetting('company', { ...(DB.settings.company || {}), name: v(b, 'cname').trim() || 'Garuda CRM', tagline: v(b, 'ctag').trim(), logo, city: v(b, 'ccity').trim(), lat: num(b, 'clat'), lon: num(b, 'clon'), announcement: v(b, 'cann').trim() });
    renderShell();
  }, 'Saved');
}
function shrinkLogo(file) {
  return new Promise((res, rej) => {
    if (file.size > 3e6) return rej(new Error('That file is over 3 MB. Use a smaller logo.'));
    const r = new FileReader(); r.onerror = () => rej(new Error('Could not read that file.'));
    r.onload = () => {
      if (file.type === 'image/svg+xml') return file.size < 2e5 ? res(r.result) : rej(new Error('SVG logos must be under 200 KB.'));
      const img = new Image(); img.onerror = () => rej(new Error('That is not an image we can read.'));
      img.onload = () => { const k = Math.min(1, 256 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/png')); };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

/* ---------- Users & Access ---------- */
let usersTab = 'table';
const below = (pid) => scopeIds(pid).size - 1;
/* sign-in state per person (Admins): last sign-in, password set, invited */
let SIGNIN = null, SIGNIN_AT = 0, SIGNIN_BUSY = false, SIGNIN_TIMER = null;
/* fetched again every 20 seconds while Users & Access is open, so a person who just signed in shows up without a refresh */
async function loadSignIns(rer) {
  if (!isHead() || SIGNIN_BUSY || Date.now() - SIGNIN_AT < 15e3) return;
  SIGNIN_BUSY = true;
  try {
    const { data, error } = await DB.sb.rpc('sign_in_status');
    if (!error) {
      const next = new Map(); (data || []).forEach((r) => next.set(r.profile_id, r));
      const changed = !SIGNIN || JSON.stringify([...next]) !== JSON.stringify([...SIGNIN]);
      SIGNIN = next; SIGNIN_AT = Date.now(); if (changed) rer?.();
    }
  } catch (_) { /* older database: statuses stay simple */ } finally { SIGNIN_BUSY = false; }
  clearInterval(SIGNIN_TIMER);
  SIGNIN_TIMER = setInterval(() => { if (!document.querySelector('#uinvall')) { clearInterval(SIGNIN_TIMER); return; } if (!document.hidden && !document.querySelector('.modal')) loadSignIns(rer); }, 20e3);
}
function userStatus(p) {
  if (!p.active) return '<span class="chip">Deactivated · cannot sign in</span>';
  const s = SIGNIN?.get(p.id);
  if (!p.auth_id) return '<span class="chip warn">Not invited yet</span>';
  if (s && !s.last_sign_in_at) return '<span class="chip warn">Invited · not signed in yet</span>';
  if (s && !s.has_password) return `<span class="chip info">Signed in · no password yet</span>`;
  if (s) return `<span class="chip good">Active</span><div class="s">last sign-in ${rel(s.last_sign_in_at)}</div>`;
  return '<span class="chip good">Signed in before</span>';
}
/* sign-in emails go out from Supabase: an invite (a sign-in link; the first visit asks for a password) or a password reset */
async function sendSignIn(p, kind) {
  const to = location.origin + location.pathname;
  const { error } = kind === 'reset' ? await DB.sb.auth.resetPasswordForEmail(p.email, { redirectTo: to + '?reset=1' }) : await DB.sb.auth.signInWithOtp({ email: p.email, options: { emailRedirectTo: to, shouldCreateUser: true } });
  if (error) throw new Error(typeof authMsg === 'function' ? authMsg(error.message) : error.message);
  SIGNIN_AT = 0;
  toast(kind === 'reset' ? `Password reset email sent to ${p.email}` : `Invite sent to ${p.email}. They open it, then create their password.`);
}
function setUsers(b, rer) {
  const ps = DB.t.profiles.slice().sort((a, c) => Number(c.active) - Number(a.active) || a.full_name.localeCompare(c.full_name));
  b.innerHTML = `<div class="row between"><div class="seg"><button data-ut="table" aria-pressed="${usersTab === 'table'}">People</button><button data-ut="org" aria-pressed="${usersTab === 'org'}">Org chart</button></div><div class="row"><button class="btn" id="uinvall">${svg('mail')} Invite everyone not signed in</button><button class="btn primary" id="uadd">${svg('plus')} Add person</button></div></div>
    <div class="note info">Only people listed here can sign in. <b>Add person</b> sends them an invite email; their first visit asks them to create a password, and from then on they sign in with their work email and password (or Google, if switched on). <b>Send password reset</b> helps anyone who forgot theirs. Work emails must end in @garudaaerospace.com unless "Allow external email" is ticked. Each person sees their own records and everyone below them in <b>Reports to</b>; C-level and Admin see everything. Deactivating hands their open work to someone else and blocks sign-in.</div>
    ${usersTab === 'org' ? `<section class="glass panel"><div class="org">${orgTree(null, ps.filter((p) => p.active))}</div></section>` : `<section class="glass panel"><div class="tablewrap"><table><thead><tr><th>Person</th><th>Employee ID</th><th>Departments</th><th>Role</th><th>Reports to</th><th>Work email</th><th>Daily report</th><th>Status</th><th></th></tr></thead><tbody>
    ${ps.map((p) => `<tr class="${p.active ? '' : 'off'}"><td><b>${esc(p.full_name)}</b><div class="s">${esc(p.designation || '')}</div>${Object.entries(PERMS).filter(([k]) => p.perms?.[k]).map(([, t]) => `<span class="chip">${t}</span>`).join(' ')}</td><td>${esc(p.emp_id || '')}</td><td>${(p.departments || []).map(deptChip).join(' ')}</td><td>${ROLES[p.role] || esc(p.role)}</td><td>${p.reports_to ? esc(DB.pname(p.reports_to)) : '<span class="faint">—</span>'}${below(p.id) ? `<div class="s">${below(p.id)} below</div>` : ''}</td><td class="s">${esc(p.email)}${p.allow_external ? ' <span class="chip warn">external</span>' : ''}</td><td class="s">${esc(p.daily_report || '')}</td><td>${userStatus(p)}</td><td class="n"><button class="btn small" data-ue="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div></section>`}`;
  b.querySelectorAll('[data-ut]').forEach((x) => (x.onclick = () => { usersTab = x.dataset.ut; rer(); }));
  b.querySelector('#uadd').onclick = () => userModal({}, rer);
  b.querySelector('#uinvall')?.addEventListener('click', () => guard(async () => {
    const todo = ps.filter((p) => p.active && p.email && (!p.auth_id || (SIGNIN?.get(p.id) && !SIGNIN.get(p.id).last_sign_in_at)));
    if (!todo.length) return toast('Everyone has signed in already.');
    if (!(await confirmBox(`Email a sign-in invite to ${todo.length} ${todo.length === 1 ? 'person' : 'people'} who have not signed in yet?`, 'Send invites'))) return;
    let ok = 0; const bad = [];
    for (const p of todo) { try { await sendSignIn(p, 'invite'); ok++; } catch (e) { bad.push(`${p.full_name}: ${e.message}`); } await new Promise((r) => setTimeout(r, 1200)); }
    toast(`${ok} invite${ok === 1 ? '' : 's'} sent${bad.length ? ` · ${bad.length} failed` : ''}`, !!bad.length); if (bad.length) console.warn(bad.join('\n'));
  }));
  loadSignIns(rer);
  b.querySelectorAll('[data-ue]').forEach((x) => (x.onclick = () => userModal(DB.profile(x.dataset.ue), rer)));
  b.querySelectorAll('[data-org]').forEach((x) => (x.onclick = () => userModal(DB.profile(x.dataset.org), rer)));
}
function orgTree(boss, ps) {
  const kids = ps.filter((p) => (p.reports_to || null) === boss || (boss === null && p.reports_to && !ps.some((q) => q.id === p.reports_to)));
  if (!kids.length) return '';
  return `<ul>${kids.map((p) => `<li><button class="onode" data-org="${p.id}"><b>${esc(p.full_name)}</b><span>${esc(p.designation || ROLES[p.role])}</span><span class="faint">${ROLES[p.role]}${below(p.id) ? ` · ${below(p.id)} below` : ''}</span></button>${orgTree(p.id, ps)}</li>`).join('')}</ul>`;
}
function userModal(p = {}, rer) {
  const isNew = !p.id; const mine = isNew ? new Set() : scopeIds(p.id);
  const bosses = DB.t.profiles.filter((x) => x.active && !mine.has(x.id)).sort((a, c) => a.full_name.localeCompare(c.full_name));
  const m = openModal({ title: isNew ? 'Add person' : esc(p.full_name), width: 820,
    body: `<div class="form">${fld('un', 'Full name', inp('un', p.full_name || ''))}${fld('ud', 'Designation', inp('ud', p.designation || ''))}${fld('ui', 'Employee ID', inp('ui', p.emp_id || ''))}
      ${fld('ue', 'Work email', inp('ue', p.email || '', 'email', 'placeholder="name@garudaaerospace.com"'))}
      ${fld('ur', 'Role', sel('ur', Object.entries(ROLES), p.role || 'member', undefined, p.id === DB.me.id ? 'disabled' : ''))}
      ${fld('ub', 'Reports to', `<select id="ub">${opts(bosses.map((x) => [x.id, `${x.full_name} · ${ROLES[x.role]}`]), p.reports_to, 'Nobody (top of the tree)')}</select>`)}
      ${fld('udr', 'Daily report', inp('udr', p.daily_report || '', 'text', 'placeholder="e.g. Telesales – Enquiries & fees"'))}${fld('usn', 'Name in the sales sheet', inp('usn', p.sheet_name || '', 'text', 'placeholder="e.g. Sowmya"'))}
      <div class="full"><label class="faint" style="font-size:11.5px;font-weight:600">Departments</label><div class="row">${DEPTS(true).map((d) => `<label class="check"><input type="checkbox" class="udp" value="${esc(d.code)}" ${(p.departments || []).includes(d.code) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div></div>
      <div class="full"><label class="faint" style="font-size:11.5px;font-weight:600">Permissions</label><div class="row">${Object.entries(PERMS).map(([k, t]) => `<label class="check"><input type="checkbox" class="upm" value="${k}" ${p.perms?.[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div>
        <p class="faint" style="font-size:12px;margin:4px 0 0">Hide sales screens: the person sees only Field Visits, Project Management and Escalations, limited to work assigned to them.</p></div>
      <label class="check full"><input type="checkbox" id="ux" ${p.allow_external ? 'checked' : ''}> Allow external email (not @garudaaerospace.com)</label>
      ${isNew ? '<label class="check full"><input type="checkbox" id="uinv" checked> Email them an invite now (they create their password on the first visit)</label>' : ''}</div>
      ${isNew ? '' : `<div class="signbox"><div><b>Sign-in</b><div>${userStatus(p)}</div></div>${p.active && p.email ? `<div class="row"><button class="btn small" id="uinv1">${svg('mail')} ${SIGNIN?.get(p.id)?.last_sign_in_at ? 'Send sign-in link' : 'Send invite'}</button>${p.auth_id ? `<button class="btn small" id="urst">${svg('lock')} Send password reset</button>` : ''}</div>` : ''}</div>${below(p.id) ? `<p class="faint" style="font-size:12.5px">${below(p.id)} people below them.</p>` : ''}`}`,
    foot: `${!isNew && p.id !== DB.me.id ? (p.active ? '<button class="btn danger" id="udeac" style="margin-right:auto">Deactivate</button>' : '<button class="btn" id="ureac" style="margin-right:auto">Reactivate</button>') : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="usave">Save</button>` });
  m.el.querySelector('#usave').onclick = () => guard(async () => {
    const email = v(m.el, 'ue').trim().toLowerCase(); const ext = v(m.el, 'ux');
    if (!v(m.el, 'un').trim()) throw new Error('Enter the name.');
    const same = !isNew && email === (p.email || '').trim().toLowerCase();
    if (!same && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email.');
    if (!same && !ext && !email.endsWith('@garudaaerospace.com')) throw new Error('Use a @garudaaerospace.com email, or tick "Allow external email".');
    const clash = !same && DB.t.profiles.find((x) => x.id !== p.id && (x.email || '').trim().toLowerCase() === email);
    if (clash) throw new Error(`${clash.full_name}${clash.active ? '' : ' (deactivated)'} already has this email.`);
    const perms = Object.fromEntries($$('.upm', m.el).map((c) => [c.value, c.checked]).filter(([, x]) => x));
    const row = { full_name: v(m.el, 'un').trim(), designation: v(m.el, 'ud').trim(), emp_id: v(m.el, 'ui').trim(), email, reports_to: v(m.el, 'ub') || null, daily_report: v(m.el, 'udr').trim(), sheet_name: v(m.el, 'usn').trim(), departments: $$('.udp:checked', m.el).map((c) => c.value), perms, allow_external: ext };
    if (p.id !== DB.me.id) row.role = v(m.el, 'ur');
    if (same) delete row.email; /* unchanged: never rewrite the sign-in email */
    if (isNew) {
      const np = await DB.insert('profiles', { ...row, active: true, role: row.role || 'member' });
      m.close(); rer();
      if (v(m.el, 'uinv')) { try { await sendSignIn(np || { email }, 'invite'); } catch (e) { toast(`Saved, but the invite did not go: ${e.message}`, true); } }
      return;
    }
    await DB.update('profiles', p.id, row);
    m.close(); rer();
  }, 'Saved');
  m.el.querySelector('#uinv1')?.addEventListener('click', () => guard(() => sendSignIn(p, 'invite')));
  m.el.querySelector('#urst')?.addEventListener('click', () => guard(() => sendSignIn(p, 'reset')));
  m.el.querySelector('#udeac')?.addEventListener('click', () => { m.close(); deactivateModal(p, rer); });
  m.el.querySelector('#ureac')?.addEventListener('click', () => guard(async () => { await DB.update('profiles', p.id, { active: true, deactivated_at: null }); m.close(); rer(); }, 'Reactivated'));
}
function deactivateModal(p, rer) {
  const open = visibleLeads().filter((l) => l.owner === p.id && L.open(l)).length;
  const others = DB.t.profiles.filter((x) => x.active && x.id !== p.id).sort((a, c) => a.full_name.localeCompare(c.full_name));
  const m = openModal({ title: 'Deactivate ' + esc(p.full_name), width: 560,
    body: `<p>${esc(p.full_name)} will no longer be able to sign in. Their ${nfmt(open)} open leads and deals, planned visits, open escalations and active projects move to the person you choose. People who report to them will report to that person. Closed records keep their name.</p>
      ${fld('dto', 'Hand the open work to', `<select id="dto">${opts(others.map((x) => [x.id, `${x.full_name} · ${ROLES[x.role]}`]), p.reports_to || DB.me.id)}</select>`)}`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn danger" id="dgo">Deactivate and reassign</button>' });
  m.el.querySelector('#dgo').onclick = () => guard(async () => { const to = v(m.el, 'dto'); const n = await DB.rpc('deactivate_user', { p_user: p.id, p_to: to }); m.close(); toast(`${p.full_name} deactivated · ${nfmt(n)} open items moved to ${DB.pname(to)}`); rer(); });
}

/* ---------- Departments ---------- */
function setDepts(b, rer) {
  const ds = DEPTS(true);
  b.innerHTML = `<div class="note info">Each <b>team</b> holds its <b>processes</b> (RPTO Team → RPTO Academy, CoE, RPTO Establishment, Other Services), and each process has its own statuses and products under <b>Statuses, stages & lists</b>. A process you add appears everywhere: filters, Leads & Deals, dashboards, revenue and campaigns. Delete moves its records to another process first.</div>
    <section class="glass panel"><div class="tablewrap"><table><thead><tr><th>Team</th><th>Short code</th><th>Process name</th><th>Colour</th><th>Counts admissions</th><th>Active</th><th class="n">Records</th><th class="n">Order</th><th></th></tr></thead><tbody>
    ${ds.map((d) => `<tr data-dc="${esc(d.code)}"><td><input class="dteam" value="${esc(d.team || 'RPTO Team')}" aria-label="Team" style="width:130px"></td><td><b class="mono">${esc(d.code)}</b></td><td><input class="dn" value="${esc(d.name)}" aria-label="Name"></td><td><input class="dcol" type="color" value="${esc(d.color)}" aria-label="Colour"></td><td><input type="checkbox" class="dadm" ${d.has_admissions ? 'checked' : ''} aria-label="Counts admissions"></td><td><input type="checkbox" class="dact" ${d.active ? 'checked' : ''} aria-label="Active"></td><td class="n">${nfmt(DB.t.leads.filter((l) => l.funnel === d.code).length)}</td><td class="n"><input class="dord" type="number" value="${d.ord}" style="width:64px" aria-label="Order"></td><td class="n"><button class="btn small primary" data-dsave="${esc(d.code)}">Save</button> <button class="btn small danger" data-ddel="${esc(d.code)}" aria-label="Delete ${esc(d.name)}">${svg('trash')}</button></td></tr>`).join('')}</tbody></table></div>
    <div class="glass panel" style="padding:12px;margin-top:12px"><h3>Add a process</h3><div class="form three" style="margin-top:8px">${fld('nteam', 'Team', inp('nteam', TEAMS()[0] || 'RPTO Team'))}${fld('ncode', 'Short code', inp('ncode', '', 'text', 'placeholder="e.g. DaaS" maxlength="12"'))}${fld('nname', 'Name', inp('nname', '', 'text', 'placeholder="e.g. Drone as a Service"'))}${fld('ncol', 'Colour', inp('ncol', '#6a5ae0', 'color'))}<label class="check"><input type="checkbox" id="nadm"> Counts admissions (individual buyers)</label><div class="field" style="justify-content:flex-end"><button class="btn primary" id="dadd">${svg('plus')} Add process</button></div></div></div></section>`;
  b.querySelectorAll('[data-dsave]').forEach((x) => (x.onclick = () => guard(async () => { const tr = x.closest('tr'); await upsertKey('departments', { ...dept(x.dataset.dsave), team: tr.querySelector('.dteam').value.trim() || 'RPTO Team', name: tr.querySelector('.dn').value.trim(), color: tr.querySelector('.dcol').value, has_admissions: tr.querySelector('.dadm').checked, active: tr.querySelector('.dact').checked, ord: Number(tr.querySelector('.dord').value) || 0 }, ['code']); rer(); }, 'Saved')));
  b.querySelector('#dadd').onclick = () => guard(async () => {
    const code = v(b, 'ncode').trim(); const name = v(b, 'nname').trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,11}$/.test(code)) throw new Error('Use a short code of 2-12 letters or numbers, starting with a letter.');
    if (DEPTS(true).some((d) => d.code.toLowerCase() === code.toLowerCase())) throw new Error('That code is taken.');
    if (!name) throw new Error('Enter the name.');
    const { error } = await DB.sb.from('departments').insert({ code, name, team: v(b, 'nteam').trim() || 'RPTO Team', color: v(b, 'ncol'), has_admissions: v(b, 'nadm'), active: true, ord: (Math.max(0, ...DEPTS(true).map((d) => d.ord)) + 1), segments: [], loss_reasons: ['Budget', 'Not interested', 'No response', 'Went with a competitor', 'Timing', 'Other'], courses: [] });
    if (error) throw new Error(friendly(error));
    [DB.t.departments, DB.t.stages] = await Promise.all([DB.fetchAll('departments'), DB.fetchAll('stages')]); DB.emit(); rer();
  }, 'Process added');
  b.querySelectorAll('[data-ddel]').forEach((x) => (x.onclick = () => deleteDeptModal(dept(x.dataset.ddel), rer)));
}
function deleteDeptModal(d, rer) {
  const n = DB.t.leads.filter((l) => l.funnel === d.code).length; const rev = DB.t.revenue_entries.filter((e) => e.department === d.code).length;
  const others = DEPTS(true).filter((x) => x.code !== d.code);
  const needMove = n > 0 || rev > 0;
  const m = openModal({ title: 'Delete ' + esc(d.name), width: 560,
    body: `<p>${needMove ? `${esc(d.name)} has <b>${nfmt(n)}</b> leads and deals and <b>${nfmt(rev)}</b> revenue lines. Choose where they go; statuses that do not exist there become the first open status.` : `${esc(d.name)} has no leads or revenue.`} Its statuses are removed, and people, targets, campaigns, projects and escalations move with it.</p>
      ${others.length ? fld('ddto', needMove ? 'Move everything to' : 'Move people and settings to (optional)', `<select id="ddto">${opts(others.map((x) => [x.code, `${x.team || 'RPTO Team'} · ${x.name}`]), needMove ? others[0].code : '', needMove ? undefined : 'Nowhere, just delete')}</select>`) : ''}
      ${fld('ddok', `Type <b>${esc(d.code)}</b> to confirm`, inp('ddok', ''))}`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn danger" id="ddgo">Delete process</button>' });
  m.el.querySelector('#ddgo').onclick = () => guard(async () => {
    if (v(m.el, 'ddok').trim() !== d.code) throw new Error(`Type ${d.code} to confirm.`);
    const to = v(m.el, 'ddto') || null; if (needMove && !to) throw new Error('Choose where the records go.');
    const r = await DB.rpc('delete_department', { p_code: d.code, p_to: to });
    if (ST.dept === d.code) { ST.dept = 'All'; ST.prod = ''; saveUI(); }
    await DB.load(); m.close(); toast(`${d.name} deleted${r?.moved ? ` · ${nfmt(r.moved)} records moved to ${dept(to).name}` : ''}`); rer();
  });
}

/* ---------- Import the sales sheet (Excel): leads, pipeline, won projects, revenue ledger, admissions ---------- */
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXLSX = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('Could not load the Excel reader. Check the internet connection.')); document.head.appendChild(s); }));
const IMP = { plan: null, status: '', running: false };
/* the screen can re-render while an import runs (live updates); keep the progress in IMP and paint it into whatever panel is showing */
function impPaint() { const bar = document.querySelector('#xlbar'); if (!bar) return; bar.innerHTML = IMP.status; bar.querySelector('#xlre')?.addEventListener('click', () => location.reload()); const go0 = document.querySelector('#xlgo'); if (go0) go0.disabled = IMP.running || IMP.plan?.warn.some((w) => w.startsWith('Statuses')); }
function setImport(b, rer) {
  b.innerHTML = `<section class="glass panel"><div class="panel-head"><h2>${svg('upload')} Import the sales sheet</h2><span class="sub">RPTO_CoE_Sales_Sheet (.xlsx)</span></div>
    <p class="muted" style="margin:0 0 10px">Two workbooks load here. The <b>sales sheet</b> brings RPTO Leads, CoE Leads, CoE Pipeline, Converted Clients and the Admissions Log. The <b>targets workbook</b> brings the yearly targets (by process, product and person) and every revenue line from <b>Revenue So Far</b>. You see what will load before anything is saved. Run it again after a sheet changes: matching IDs are updated, never doubled. Leads someone has already worked in the CRM keep their CRM status and owner.</p>
    <input type="file" id="xlf" accept=".xlsx,.xlsm"><div id="xlp" style="margin-top:12px"></div></section>
    <section class="glass panel"><div class="panel-head"><h2>${svg('trash')} Start again</h2><span class="sub">Remove what earlier imports brought in</span></div>
      <p class="muted" style="margin:0 0 10px">Deletes imported leads nobody has worked yet, their remark history, imported projects, admissions and revenue lines. People, settings, tasks, targets and anything entered in the CRM stay. Then import the new sheet.</p>
      <div class="row"><input id="clrc" placeholder="Type CLEAR to confirm" style="max-width:200px" aria-label="Type CLEAR to confirm"><button class="btn danger" id="clrgo">Remove imported data</button></div><div id="clrout"></div></section>`;
  b.querySelector('#clrgo').onclick = () => guard(async () => {
    if (b.querySelector('#clrc').value.trim().toUpperCase() !== 'CLEAR') throw new Error('Type CLEAR in the box first.');
    b.querySelector('#clrout').innerHTML = '<p class="faint">Removing… keep this page open.</p>';
    const r = await DB.rpc('clear_imported'); await DB.load(); IMP.plan = null;
    b.querySelector('#clrout').innerHTML = `<div class="note good">Removed ${nfmt(r.leads)} imported leads and ${nfmt(r.revenue)} revenue lines.${r.kept_worked ? ` ${nfmt(r.kept_worked)} leads already worked in the CRM were kept.` : ''} Now import the new sheet above.</div>`;
  });
  const out = b.querySelector('#xlp');
  if (IMP.plan) { showPlan(out, IMP.plan, rer); impPaint(); }
  b.querySelector('#xlf').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    out.innerHTML = '<p class="faint">Reading the workbook…</p>';
    guard(async () => {
      const X = await loadXLSX(); const buf = await f.arrayBuffer();
      const wb = X.read(buf, { type: 'array', cellDates: true });
      IMP.plan = planImport(wb, X); IMP.status = ''; showPlan(out, IMP.plan, rer);
    });
  };
}
function sheetRows(wb, X, name, key) {
  const ws = wb.Sheets[name]; if (!ws) return [];
  const a = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hi = a.findIndex((r) => (r || []).some((c) => String(c ?? '').trim() === key)); if (hi < 0) return [];
  const h = a[hi].map((c) => String(c ?? '').trim());
  return a.slice(hi + 1).filter((r) => r && r.some((c) => c !== null && c !== '')).map((r) => { const o = { _raw: r, _h: h }; h.forEach((k, i) => { if (k && !(k in o)) o[k] = r[i]; }); return o; });
}
const xT = (x) => (x == null ? '' : String(x).trim());
const xN = (x) => { if (x == null || x === '') return null; const n = Number(String(x).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : null; };
function xD(x) {
  if (x == null || x === '') return null;
  if (x instanceof Date) return isNaN(x) ? null : localDate(x);
  if (typeof x === 'number') { const d = new Date(Math.round((x - 25569) * 864e5)); return localDate(new Date(d.getTime() + d.getTimezoneOffset() * 6e4)); }
  const s = String(x).trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  const d = new Date(s); return isNaN(d) ? null : localDate(d);
}
const VG = { 'Academy (RPTO Training)': 'RPTO', 'CoE Labs': 'CoE', 'RPTO Establishment': 'EST', 'Other Services & Events': 'OTH' };
/* a person from a sheet name (same rule as the database) */
const personFrom = (lab) => { const t = xT(lab).toLowerCase(); return t ? DB.t.profiles.filter((p) => [p.full_name, p.sheet_name, ...(p.sheet_aliases || [])].filter(Boolean).some((x) => x.toLowerCase() === t)).sort((a, c) => Number(c.active) - Number(a.active))[0] || null : null; };
/* the targets workbook: yearly target by process and product, each person's target by process, and how Academy collections split between callers */
function planTargets(wb, X, P) {
  const raw = (n) => (wb.Sheets[n] ? X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) : []);
  const gx = raw('GAP Executive'); const fs = gx.find((r) => /^fy start/i.test(xT(r?.[0]))); const d0 = fs && xD(fs[1]); if (d0) { const d = new Date(d0 + 'T12:00:00'); P.fy = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }
  const va = sheetRows(wb, X, 'Vertical Target Allocation', 'Sub-vertical');
  const team = {};
  for (const r of va) { if (/^total/i.test(xT(r['Sub-vertical']))) break; const d = VG[xT(r['Vertical group'])]; const amt = xN(r['Annual target (₹)']); if (!d || amt == null) continue;
    P.targets.push({ dept: d, segment: xT(r['Sub-vertical']), person_label: '', amount: amt }); team[d] = (team[d] || 0) + amt; }
  Object.entries(team).forEach(([d, amt]) => P.targets.push({ dept: d, segment: '', person_label: '', amount: amt }));
  const ew = raw('Employee Daily Weekly Monthly'); const hi = ew.findIndex((r) => (r || []).some((c) => xT(c) === 'Employee') && (r || []).some((c) => xT(c) === 'Academy (RPTO Training)'));
  if (hi >= 0) { const h = ew[hi].map(xT);
    for (const r of ew.slice(hi + 1)) { const who = xT(r?.[0]); if (!who || /^total/i.test(who)) break; Object.entries(VG).forEach(([g, d]) => { const amt = xN(r[h.indexOf(g)]); if (amt) P.targets.push({ dept: d, segment: '', person_label: who, amount: amt }); }); } }
  const it = raw('Individual Targets'); const si = it.findIndex((r) => (r || []).some((c) => /^share of academy collections/i.test(xT(c))));
  if (si >= 0) { const h = it[si].map(xT); const ci = h.findIndex((c) => /share of academy/i.test(c)); const shares = [];
    for (const r of it.slice(si + 1)) { const who = xT(r?.[0]); if (!who || /to split|^total/i.test(who)) break; const sh = xN(r[ci]); if (sh == null) continue; const p = personFrom(who); shares.push({ label: who, pid: p?.id || null, share: sh }); }
    if (shares.length) P.split = { fy: P.fy, shares }; }
  const miss = [...new Set(P.targets.map((t) => t.person_label).filter((x) => x && !personFrom(x)))];
  if (miss.length) P.warn.push(`No CRM person for target holder: ${miss.join(', ')}. Add the name under Users & Access → Edit → Sheet name, or their target is skipped.`);
  P.counts.targets = P.targets.length; P.counts.targetTotal = sum(P.targets.filter((t) => !t.segment && !t.person_label), (t) => t.amount);
}
const PROC = { 'RPTO Training': 'RPTO', CoE: 'CoE', 'RPTO Establishment': 'EST', 'Other Services': 'OTH' };
/* a lead is handed over when the sheet names a hand-over code ("Sowmiya SJ2") or someone who is not in the CRM (staff who left) */
const oldStaff = (who) => !!who && (/\d$/.test(who) || !personFrom(who));
const xOrg = (x) => { const t = xT(x); return /^(none|not specified|n\/a|-|na)$/i.test(t) ? '' : t; };
const acadStatus = (x) => { const t = xT(x).toLowerCase(); return Object.entries(ACAD_ST).find(([k]) => k.toLowerCase() === t)?.[1] || (t ? xT(x) : 'New'); };
const ACAD_ST = { RNR: 'RNR', 'Follow Up': 'Follow Up', 'Future Follow up': 'Future Follow Up', Pipeline: 'Pipeline', 'Closed Won': 'Closed Won', 'Closed Lost': 'Closed Lost', Duplicate: 'Duplicate', 'Other Department': 'Other Department', 'CoE Other Department': 'CoE Other Department' };
const tierTemp = (t) => (/^P1/.test(t) ? 'Hot' : /^P2/.test(t) ? 'Warm' : /^P5|^R1/.test(t) ? 'Nurture' : /^X/.test(t) ? 'Drop' : /^P[34]/.test(t) ? 'Cold' : '');
function planImport(wb, X) {
  const P = { leads: [], projects: [], revenue: [], adm: [], src: [], targets: [], split: null, fy: TG.fy(), revScope: null, counts: {}, warn: [], note: [] };
  /* RPTO Academy leads */
  const ra = sheetRows(wb, X, 'RPTO Leads', 'Lead ID').filter((r) => xT(r['Lead ID']));
  ra.forEach((r) => { const st = acadStatus(r['Lead Status']); const tier = xT(r['Current Campaign Tier'] ?? r['Campaign Tier']); const who = xT(r['Assigned To']);
    const audit = xT(r['Audit Tier (17 Oct)']); const changed = xT(r['Tier changed?']);
    P.leads.push({ funnel: 'RPTO', ref_id: xT(r['Lead ID']).replace(/\.0$/, ''), stage: st, is_deal: st === 'Pipeline' || st === 'Closed Won', name: xT(r['Client Name']), phone: xT(r['Phone']), email: xT(r['Email']).replace(/^not specified$/i, ''),
      city: xOrg(r['Location'] ?? r['Location / Org']), org: xOrg(r['Organisation / Institution']), latest_update: xT(r['Current Status (latest remark)']), source: xT(r['Lead Origin']), enquiry_date: xD(r['Enquiry Date']), allocated_date: xD(r['Allocation Date']), owner_label: who, course: xT(r['Course / Interest']), routed_dept: xT(r['Routed Department']),
      value: xN(r['Value (₹)']) || 0, temperature: tierTemp(tier), campaign_tier: tier, priority_score: xN(r['Priority Score']), tier_reason: xT(r['Why this tier']), tier_source: xT(r['Tier Source']) || (audit ? `Audit 17 Oct: ${audit}${/^yes/i.test(changed) ? ' · ' + changed : ''}` : ''), language: xT(r['Language']).replace(/^not captured$/i, ''),
      eligible: /^yes/i.test(xT(r['Eligible?'])) ? 'Eligible' : /^no/i.test(xT(r['Eligible?'])) ? 'Not eligible' : 'Unknown', call_attempts: xN(r['Call Attempts']) || 0, latest_remark: xT(r['Latest Remark']), history: xT(r['All Remarks (date-wise)']),
      lost_reason: st === 'Closed Lost' ? (xT(r['Why this tier']) || 'From the sales sheet') : '', won_at: st === 'Closed Won' ? xD(r['Enquiry Date']) : null, inherited: oldStaff(who) });
  });
  P.counts.academy = ra.length;
  /* CoE leads */
  const ca = sheetRows(wb, X, 'CoE Leads', 'Lead ID').filter((r) => xT(r['Lead ID']));
  const coeStage = (r) => { const s = xT(r['Lead Stage']); const e = xT(r['Engagement Status']);
    if (/lost/i.test(s)) return 'Closed Lost'; if (/won/i.test(s)) return 'Closed Won'; if (['New', 'Contacted', 'Qualified'].includes(s)) return s;
    if (/closed/i.test(e)) return 'Closed Lost'; if (/qualified/i.test(e)) return 'Qualified'; if (/contacted|progress/i.test(e)) return 'Contacted'; return 'New'; };
  ca.forEach((r) => { const st = coeStage(r); const pr = xT(r['Priority']); const who = xT(r['Assigned To']);
    P.leads.push({ funnel: 'CoE', ref_id: xT(r['Lead ID']).replace(/\.0$/, ''), stage: st, is_deal: st === 'Closed Won', name: xT(r['Client Name']), phone: xT(r['Phone']), email: xT(r['Email']).replace(/^not specified$/i, ''), org: xOrg(r['Organisation / Institution'] ?? r['Location / Org']), city: xOrg(r['Location']),
      source: xT(r['Lead Origin']), enquiry_date: xD(r['Enquiry Date']), allocated_date: xD(r['Allocation Date']), owner_label: who, sub_category: xT(r['Interest (Sub-Category)']), temperature: ['Hot', 'Warm', 'Cold', 'Drop'].includes(pr) ? pr : '',
      latest_update: [xT(r['Current Status (latest remark)']), xT(r['Final Summary'])].filter(Boolean).join(' · '), call_attempts: xN(r['Call Attempts']) || 0, latest_remark: xT(r['Latest Remark']), history: xT(r['All Remarks (date-wise)']), lost_reason: st === 'Closed Lost' ? (xT(r['Final Summary']) || 'From the sales sheet') : '', inherited: oldStaff(who) });
  });
  P.counts.coe = ca.length;
  /* CoE pipeline: deals, by service */
  const pl = sheetRows(wb, X, 'CoE Pipeline', 'Opp ID').filter((r) => /^[A-Z]/.test(xT(r['Opp ID'])));
  pl.forEach((r) => { const f = PROC[xT(r['Service'])] || 'CoE'; const st = f === 'RPTO' ? 'Pipeline' : xT(r['Status']) || 'In Progress';
    P.leads.push({ funnel: f, ref_id: xT(r['Opp ID']), stage: st, is_deal: true, name: xT(r['Organisation']), org: xT(r['Organisation']), contact_name: xT(r['Contact Person']), phone: xT(r['Phone']), email: xT(r['Email']), client_type: xT(r['Client Type']),
      source: xT(r['Source']), owner_label: xT(r['Lead Owner']), sub_category: xT(r['Sub-Category']), course: f === 'RPTO' ? 'Small Class RPC' : '', also_interested: xT(r['Also Interested In']), value: xN(r['Approx Value (₹)']) || 0, expected_close: xD(r['Expected Closure']),
      meeting_date: xD(r['Our Meeting Date']), latest_update: xT(r['Latest Update']), history: xT(r['All Remarks (date-wise)']), collected_import: xN(r['Collected (₹)']) || 0, pending_po: xN(r['Balance Due (₹)'] ?? r['Pending PO (₹)']) || 0, won_at: /won/i.test(st) ? xD(r['Expected Closure']) : null, lost_reason: /lost/i.test(st) ? 'From the sales sheet' : '' });
  });
  P.counts.pipeline = pl.length;
  /* converted clients: a won deal and a project each */
  const cc = sheetRows(wb, X, 'CoE Converted Clients', 'CC ID').filter((r) => /^CC/.test(xT(r['CC ID'])));
  cc.forEach((r) => { const prod = xT(r['Product']); const f = /establishment/i.test(prod) ? 'EST' : 'CoE'; const id = xT(r['CC ID']);
    const awaiting = /awaiting po|^pipeline/i.test(xT(r['Current Status'])); /* the sheet keeps a deal still waiting for its PO in the pipeline, not as a sale */
    P.leads.push({ funnel: f, ref_id: id, stage: awaiting ? 'In Progress' : 'Closed Won', is_deal: true, name: xT(r['Institution']), org: xT(r['Institution']), sub_category: prod, value: xN(r['Order Value (₹)']) || 0, won_at: awaiting ? null : xD(r['Date of Order']),
      collected_import: xN(r['Received (₹)']) || 0, pending_po: xN(r['Pending (₹)'] ?? r['Balance Due (₹)'] ?? r['Not yet received (₹)']) || 0, latest_update: xT(r['Current Status']), history: xT(r['Remarks']) });
    if (!awaiting) P.projects.push({ import_key: id, project_code: xT(r['Project ID']), lead_ref: id, name: xT(r['Institution']), dept: f, status: /completed/i.test(xT(r['Current Status'])) ? 'Completed' : 'In progress',
      order_value: xN(r['Order Value (₹)']) || 0, received: xN(r['Received (₹)']) || 0, delivered: xT(r['Product Delivered']), order_date: xD(r['Date of Order']), notes: [xT(r['Current Status']), xT(r['Remarks'])].filter(Boolean).join(' · ') });
  });
  P.counts.projects = P.projects.length;
  /* revenue: the 'Revenue So Far' sheet of the targets workbook (product and owner on every line) */
  const seen = {}; const rsf = sheetRows(wb, X, 'Revenue So Far', 'Month').filter((r) => xD(r['Month']) && xN(r['Amount (₹)']) && !/awaiting/i.test(xT(r['Status'])));
  rsf.forEach((r) => {
    const dept0 = VG[xT(r['Vertical group'])] || 'OTH'; const ps = xT(r['Status']); const status = /^(collected|received|paid)/i.test(ps) ? 'Collected' : 'Pending PO'; const month = xD(r['Month']).slice(0, 7) + '-01';
    const seg = xT(r['Sub-vertical']); const k = [month, dept0, seg, xT(r['Client / detail']), xT(r['Label in Revenue tab']), status].join('|'); seen[k] = (seen[k] || 0) + 1;
    P.revenue.push({ import_key: 'rsf|' + k + '|' + seen[k], month, paid_on: null, dept: dept0, channel: '', segment: seg, client: xT(r['Client / detail']), amount: xN(r['Amount (₹)']), status, opp_ref: xT(r['Linked ID']), owner_label: xT(r['Owner']),
      note: [status === 'Pending PO' ? ps : '', xT(r['Label in Revenue tab']), xT(r['Owner basis'])].filter(Boolean).join(' · ') });
  });
  if (rsf.length) P.revScope = 'rsf|';
  const haveRsf = DB.t.revenue_entries.some((e) => String(e.import_key || '').startsWith('rsf|'));
  if (!rsf.length && haveRsf && wb.Sheets['Revenue Ledger']) P.note.push('Revenue comes from the targets workbook (Revenue So Far), so the Revenue Ledger in this sheet is skipped.');
  if (!rsf.length && !haveRsf) sheetRows(wb, X, 'Revenue Ledger', 'Month').filter((r) => xN(r['Amount (₹)']) && !/awaiting/i.test(xT(r['Payment Status']))).forEach((r) => {
    const dept0 = PROC[xT(r['Department'])] || 'OTH'; const ps = xT(r['Payment Status']); const status = /^(collected|received|paid)/i.test(ps) ? 'Collected' : 'Pending PO'; const month = (xD(r['Month']) || '').slice(0, 7) + '-01';
    const k = [month, dept0, xT(r['Segment']), xT(r['Client']), xN(r['Amount (₹)']), status].join('|'); seen[k] = (seen[k] || 0) + 1;
    P.revenue.push({ import_key: 'rev|' + k + '|' + seen[k], month, dept: dept0, channel: xT(r['Channel']), segment: xT(r['Segment']), client: xT(r['Client']), amount: xN(r['Amount (₹)']), status, opp_ref: xT(r['Linked ID']), note: [status === 'Pending PO' ? ps : '', xT(r['Basis / note']), xT(r['Original label (Revenue tab)'])].filter(Boolean).join(' · ') });
  });
  planTargets(wb, X, P);
  P.counts.revenue = P.revenue.length; P.counts.pending = P.revenue.filter((x) => x.status === 'Pending PO').length;
  /* admissions log: three tables side by side */
  const aw = wb.Sheets['Admissions Log'];
  if (aw) { const a = X.utils.sheet_to_json(aw, { header: 1, raw: true, defval: null }); const hi = a.findIndex((r) => (r || []).filter((c) => xT(c) === 'Month').length >= 2);
    if (hi >= 0) { const h = a[hi].map(xT); const m1 = h.indexOf('Month'); const m2 = h.indexOf('Month', m1 + 1);
      a.slice(hi + 1).forEach((r) => { if (!r) return; const mo = xD(r[m1]); const seg = xT(r[h.indexOf('Segment')]);
        if (mo && seg) P.adm.push({ import_key: `adm|${mo.slice(0, 7)}|${seg}|${xT(r[h.indexOf('Original label')])}`, month: mo.slice(0, 7) + '-01', segment: seg, paid: xN(r[h.indexOf('Paid')]) || 0, free: xN(r[h.indexOf('Free')]) || 0 });
        const mo2 = xD(r[m2]); const srcI = h.indexOf('Lead Source (grouped)'); const src = xT(r[srcI]);
        if (m2 >= 0 && mo2 && src) P.src.push({ import_key: `src|${mo2.slice(0, 7)}|${src}|${xT(r[srcI + 1])}`, month: mo2.slice(0, 7) + '-01', source: src, admissions: xN(r[h.indexOf('Admissions')]) || 0 }); }); } }
  P.counts.admissions = P.adm.length + P.src.length;
  /* checks: owners and statuses the CRM does not know */
  const known = (lab) => !lab || DB.t.profiles.some((p) => [p.full_name, p.sheet_name, ...(p.sheet_aliases || [])].filter(Boolean).some((x) => x.toLowerCase() === lab.toLowerCase()));
  const unk = [...new Set(P.leads.map((l) => l.owner_label).filter((x) => x && !known(x)))];
  if (unk.length) P.note.push(`Not in the CRM: ${unk.join(', ')}. Their leads are marked as handed over. A lead already in the CRM keeps the person it is with now; a new one loads unassigned (reassign it from Leads, or add the name under Users & Access → Sheet name).`);
  const badSt = [...new Set(P.leads.filter((l) => !S.get(l.funnel, l.stage)).map((l) => `${l.funnel}: ${l.stage}`))];
  if (badSt.length) P.warn.push(`Statuses not set up yet: ${badSt.join(', ')}. Add them in Statuses, stages & lists first.`);
  P.counts.inherited = P.leads.filter((l) => l.inherited).length;
  return P;
}
function showPlan(out, P, rer) {
  const c = P.counts;
  const tiles = [['RPTO Academy leads', c.academy], ['CoE leads', c.coe], ['Pipeline deals', c.pipeline], ['Won projects', c.projects], ['Revenue lines', c.revenue], ['… of them balance due', c.pending], ['Admissions rows', c.admissions], ['Handed-over leads', c.inherited], ['Target rows · ' + TG.label(P.fy), c.targets], ['Yearly target', c.targetTotal, 'inr']].filter(([, n]) => n);
  const what = [P.leads.length && `${nfmt(P.leads.length)} leads and deals`, P.projects.length && `${nfmt(P.projects.length)} projects`, P.revenue.length && `${nfmt(P.revenue.length)} revenue lines`, P.targets.length && `${TG.label(P.fy)} targets`].filter(Boolean);
  out.innerHTML = `<div class="kpis">${tiles.map(([t, n, f]) => `<div class="glass kpi"><span class="l">${t}</span><span class="v">${f ? inr(n) : nfmt(n || 0)}</span></div>`).join('') || '<p class="faint">Nothing this screen can read in that workbook.</p>'}</div>
    ${P.warn.map((w) => `<div class="note warn">${esc(w)}</div>`).join('')}${P.note.map((w) => `<div class="note info">${esc(w)}</div>`).join('')}
    ${what.length ? `<div class="row" style="margin-top:10px"><button class="btn primary" id="xlgo" ${P.warn.some((w) => w.startsWith('Statuses')) ? 'disabled' : ''}>${svg('upload')} Import ${what.join(', ')}</button></div>` : ''}<div id="xlbar"></div>`;
  out.querySelector('#xlgo')?.addEventListener('click', () => { if (!IMP.running) runImport(P); });
}
/* one batch of leads; if the server runs out of time on it, save it again in smaller pieces */
async function importLeadRows(rows, tot) {
  try { const r = await DB.call('import_leads', { p_rows: rows }); tot.new += r.new; tot.updated += r.updated; tot.no_owner += r.no_owner; }
  catch (e) {
    if (!/timeout|canceling statement/i.test(e.message || '') || rows.length <= 10) throw e;
    const h = Math.ceil(rows.length / 2); await importLeadRows(rows.slice(0, h), tot); await importLeadRows(rows.slice(h), tot);
  }
}
async function runImport(P) {
  IMP.running = true;
  const steps = []; for (let i = 0; i < P.leads.length; i += 200) steps.push(['leads', P.leads.slice(i, i + 200)]);
  steps.push(['projects', P.projects], ['revenue', P.revenue], ['admissions', null], ['targets', P.targets], ['accounts', P.leads.length ? [1] : []]);
  const tot = { new: 0, updated: 0, no_owner: 0 };
  try {
    for (let i = 0; i < steps.length; i++) {
      const [k, rows] = steps[i];
      IMP.status = `<div class="pbar info" style="margin-top:12px"><i style="width:${Math.round((i / steps.length) * 100)}%"></i></div><p class="faint">Saving ${k}… step ${i + 1} of ${steps.length}. Keep this page open.</p>`; impPaint();
      if (k === 'leads') await importLeadRows(rows, tot);
      else if (k === 'projects' && rows.length) await DB.call('import_projects', { p_rows: rows });
      else if (k === 'revenue' && rows.length) await DB.call('import_revenue', { p_rows: rows, p_scope: P.revScope });
      else if (k === 'accounts' && rows.length) { try { await DB.call('link_accounts', {}); } catch (_) { /* accounts are a convenience; the import itself is done */ } }
      else if (k === 'targets' && rows.length) { const r = await DB.call('import_targets', { p_fy: P.fy, p_rows: rows }); if (r?.not_matched?.length) tot.miss = r.not_matched; if (P.split) await DB.setSetting('academy_split', P.split); }
      else if (k === 'admissions' && (P.adm.length || P.src.length)) await DB.call('import_admissions', { p_adm: P.adm, p_src: P.src });
    }
    /* everything is saved; refresh the screen once (a failed refresh is not a failed import) */
    try { await DB.load(); } catch (_) { /* the Reload button below reads everything again */ }
    IMP.status = `<div class="note good" style="margin-top:12px"><b>Import finished.</b> ${nfmt(tot.new)} new and ${nfmt(tot.updated)} updated leads and deals, ${nfmt(P.projects.length)} projects, ${nfmt(P.revenue.length)} revenue lines, ${nfmt(P.counts.admissions)} admissions rows${P.targets.length ? `, ${TG.label(P.fy)} targets` : ''}.${tot.miss ? ` Targets skipped for: ${esc(tot.miss.join(', '))}.` : ''}${tot.no_owner ? ` ${nfmt(tot.no_owner)} name someone who is not in the CRM: they are marked as handed over and stay with their current owner where they had one.` : ''}</div><button class="btn primary" id="xlre">Reload the CRM</button>`;
  } catch (e) {
    IMP.status = `<div class="note bad" style="margin-top:12px"><b>Stopped:</b> ${esc(e.message || String(e))}. Nothing is doubled if you run it again.</div>`;
  }
  IMP.running = false; impPaint();
}

/* ---------- per-department statuses, stages, loss reasons, products, segments, targets ---------- */
let cfgDept = '';
function setConfig(b, rer) {
  if (!DEPTS(true).some((d) => d.code === cfgDept)) cfgDept = DEPTS(true)[0]?.code || '';
  const d = dept(cfgDept); const st = S.list(cfgDept);
  const used = (k) => DB.t.leads.filter((l) => l.funnel === cfgDept && l.stage === k).length;
  const fy = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const months = Array.from({ length: 12 }, (_, i) => localDate(new Date(fy, 3 + i, 1)));
  const tgt = (mo) => DB.t.revenue_targets.find((t) => t.dept === cfgDept && String(t.month).slice(0, 7) === mo.slice(0, 7))?.amount ?? '';
  b.innerHTML = `<div class="seg">${DEPTS(true).map((x) => `<button data-cd="${esc(x.code)}" aria-pressed="${x.code === cfgDept}" style="--dc:${esc(x.color)}"><i class="ddot"></i>${esc(x.name)}</button>`).join('')}</div>
    <section class="glass panel"><div class="panel-head"><h2>Lead statuses and deal stages · ${esc(d.code)}</h2><span class="sub">Lead statuses are used before a lead becomes a deal; deal stages after. Win % weights the pipeline.</span></div>
      <div class="tablewrap"><table><thead><tr><th class="n">Order</th><th>Name</th><th>Used for</th><th class="n">Win %</th><th>Won</th><th>Lost</th><th title="Closed but not a loss, e.g. Duplicate">Closed, not lost</th><th>Needs loss reason</th><th>Needs fee</th><th>Needs payment / PO</th><th class="n">Records</th><th></th></tr></thead><tbody>
      ${st.map((s) => `<tr data-sk="${esc(s.key)}"><td class="n"><input class="so" type="number" value="${s.ord}" style="width:60px" aria-label="Order"></td><td><b>${esc(s.key)}</b></td><td><select class="skind" aria-label="Used for">${opts([['lead', 'Lead status'], ['deal', 'Deal stage'], ['both', 'Both']], s.kind)}</select></td><td class="n"><input class="sp" type="number" min="0" max="100" value="${s.prob}" style="width:64px" aria-label="Win %"></td><td><input type="checkbox" class="sw" ${s.is_won ? 'checked' : ''} aria-label="Won"></td><td><input type="checkbox" class="sl" ${s.is_lost ? 'checked' : ''} aria-label="Lost"></td><td><input type="checkbox" class="sclo" ${s.is_closed ? 'checked' : ''} aria-label="Closed, not lost"></td><td><input type="checkbox" class="sr" ${s.needs_reason ? 'checked' : ''} aria-label="Needs reason"></td><td><input type="checkbox" class="sf" ${s.needs_fee ? 'checked' : ''} aria-label="Needs fee"></td><td><input type="checkbox" class="spay" ${s.needs_payment ? 'checked' : ''} aria-label="Needs payment"></td><td class="n">${nfmt(used(s.key))}</td><td class="n">${used(s.key) ? '' : `<button class="btn ghost small" data-sdel="${esc(s.key)}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="justify-content:space-between;margin-top:8px"><span class="row"><input id="snew" placeholder="New status or stage name" style="width:220px"><select id="snk">${opts([['lead', 'Lead status'], ['deal', 'Deal stage']], 'deal')}</select><button class="btn small" id="sadd">${svg('plus')} Add</button></span><button class="btn primary" id="ssave">Save statuses and stages</button></div></section>
    <div class="grid g3">
      <section class="glass panel"><div class="panel-head"><h2>Loss reasons</h2></div><textarea id="clr" style="min-height:180px" aria-label="Loss reasons">${esc((d.loss_reasons || []).join('\n'))}</textarea></section>
      <section class="glass panel"><div class="panel-head"><h2>Products / courses</h2><span class="sub">The "interested in" list on a lead</span></div><textarea id="ccr" style="min-height:180px" aria-label="Products or courses">${esc((d.courses || []).join('\n'))}</textarea></section>
      <section class="glass panel"><div class="panel-head"><h2>Revenue segments</h2></div><textarea id="csg" style="min-height:180px" aria-label="Revenue segments">${esc((d.segments || []).join('\n'))}</textarea></section>
    </div><div class="row" style="justify-content:flex-end"><button class="btn primary" id="clsave">Save lists</button></div>`;
  b.querySelectorAll('[data-cd]').forEach((x) => (x.onclick = () => { cfgDept = x.dataset.cd; rer(); }));
  b.querySelector('#ssave').onclick = () => guard(async () => {
    const rows = $$('[data-sk]', b).map((tr) => ({ funnel: cfgDept, key: tr.dataset.sk, ord: Number(tr.querySelector('.so').value) || 0, kind: tr.querySelector('.skind').value, prob: clamp(Number(tr.querySelector('.sp').value) || 0, 0, 100), is_won: tr.querySelector('.sw').checked, is_lost: tr.querySelector('.sl').checked, is_closed: tr.querySelector('.sclo').checked, needs_reason: tr.querySelector('.sr').checked, needs_fee: tr.querySelector('.sf').checked, needs_payment: tr.querySelector('.spay').checked }));
    if (rows.some((r) => r.is_won && r.is_lost)) throw new Error('A stage cannot be both won and lost.');
    if (rows.some((r) => r.is_closed && (r.is_won || r.is_lost))) throw new Error('“Closed, not lost” cannot also be Won or Lost.');
    if (!rows.some((r) => r.is_won)) throw new Error('Keep at least one Won stage.');
    if (rows.some((r) => r.is_won && r.kind === 'lead')) throw new Error('Won must be a deal stage.');
    const old = S.list(cfgDept);
    for (const r of rows) { const o = old.find((x) => x.key === r.key); r.grp = o?.grp || ''; }
    await upsertKey('stages', rows, ['funnel', 'key']); rer();
  }, 'Saved');
  b.querySelector('#sadd').onclick = () => guard(async () => { const k = v(b, 'snew').trim(); if (!k) throw new Error('Enter a name.'); if (S.get(cfgDept, k)) throw new Error('That name exists.'); const kind = v(b, 'snk'); const last = S.list(cfgDept, kind).filter((s) => !s.is_won && !s.is_lost).pop(); await upsertKey('stages', { funnel: cfgDept, key: k, kind, ord: (last?.ord || 0) + 1, prob: kind === 'deal' ? 50 : 10, is_won: false, is_lost: false, needs_reason: false, needs_fee: false, needs_payment: false, grp: '' }, ['funnel', 'key']); rer(); }, 'Added');
  b.querySelectorAll('[data-sdel]').forEach((x) => (x.onclick = () => guard(async () => { if (!(await confirmBox(`Remove “${esc(x.dataset.sdel)}”?`, 'Remove'))) return; await deleteKey('stages', { funnel: cfgDept, key: x.dataset.sdel }); rer(); }, 'Removed')));
  const lines = (id) => v(b, id).split('\n').map((x) => x.trim()).filter(Boolean);
  b.querySelector('#clsave').onclick = () => guard(async () => { await upsertKey('departments', { ...d, loss_reasons: lines('clr'), courses: lines('ccr'), segments: lines('csg') }, ['code']); rer(); }, 'Saved');
}

/* ---------- campaign types and their extra fields ---------- */
function setCampTypes(b, rer) {
  const ts = campTypes();
  b.innerHTML = `<div class="note info">Each type of Other Campaign can carry its own fields (text, number, date or dropdown). Built-in types can get extra fields but cannot be removed.</div>
    <div class="grid g2">${ts.map((t) => `<section class="glass panel" data-ct="${esc(t.name)}"><div class="panel-head"><h2>${esc(t.name)}</h2><span class="sub">${t.built_in ? 'Built in' : 'Custom'} · ${nfmt(DB.t.mkt_campaigns.filter((c) => c.type === t.name).length)} campaigns</span></div>
      <div class="tablewrap free"><table><thead><tr><th>Field</th><th>Type</th><th>Dropdown options (comma separated)</th><th></th></tr></thead><tbody>${(t.fields || []).map((f, i) => `<tr data-fi="${i}"><td><input class="fl" value="${esc(f.label)}" aria-label="Label"></td><td><select class="ft" aria-label="Type">${opts([['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['dropdown', 'Dropdown']], f.type)}</select></td><td><input class="fo" value="${esc((f.options || []).join(', '))}" aria-label="Options"></td><td><button class="btn ghost small" data-frm="${i}">${svg('x')}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="justify-content:space-between;margin-top:8px"><button class="btn small" data-fadd>${svg('plus')} Field</button><span class="row">${t.built_in ? '' : '<button class="btn small danger" data-tdel>Remove type</button>'}<button class="btn small primary" data-tsave>Save</button></span></div></section>`).join('')}
    <section class="glass panel"><div class="panel-head"><h2>Add a campaign type</h2></div><div class="row"><input id="ctn" placeholder="e.g. Radio spot" style="flex:1"><button class="btn primary" id="ctadd">${svg('plus')} Add type</button></div></section></div>`;
  const collect = (box, extra) => { const t = campType(box.dataset.ct); const fields = $$('[data-fi]', box).map((tr) => { const label = tr.querySelector('.fl').value.trim(); const old = (t.fields || [])[+tr.dataset.fi] || {}; return { key: old.key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30), label, type: tr.querySelector('.ft').value, options: tr.querySelector('.fo').value.split(',').map((x) => x.trim()).filter(Boolean) }; }).filter((f) => f.label); return { ...t, fields: [...fields, ...(extra || [])] }; };
  b.querySelectorAll('[data-ct]').forEach((box) => {
    box.querySelector('[data-tsave]').onclick = () => guard(async () => { await upsertKey('campaign_types', collect(box), ['name']); rer(); }, 'Saved');
    box.querySelector('[data-fadd]').onclick = () => guard(async () => { const label = await promptBox('New field', 'Field label'); if (!label) return; await upsertKey('campaign_types', collect(box, [{ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) + '_' + Math.random().toString(36).slice(2, 5), label, type: 'text', options: [] }]), ['name']); rer(); });
    box.querySelectorAll('[data-frm]').forEach((x) => (x.onclick = () => { x.closest('tr').remove(); }));
    box.querySelector('[data-tdel]')?.addEventListener('click', () => guard(async () => { if (DB.t.mkt_campaigns.some((c) => c.type === box.dataset.ct)) throw new Error('Campaigns use this type.'); await deleteKey('campaign_types', { name: box.dataset.ct }); rer(); }, 'Removed'));
  });
  b.querySelector('#ctadd').onclick = () => guard(async () => { const n = v(b, 'ctn').trim(); if (!n) throw new Error('Enter a name.'); if (campTypes().some((t) => t.name.toLowerCase() === n.toLowerCase())) throw new Error('That type exists.'); await upsertKey('campaign_types', { name: n, fields: [], built_in: false, ord: 50 }, ['name']); rer(); }, 'Type added');
}

/* ---------- visits, escalations and other rules ---------- */
function setRules(b, rer) {
  const s = DB.settings; const eh = s.escalation_hours || {}; const d = s.discounts || {}; const kp = s.kpi || {};
  b.innerHTML = `<div class="grid g2">
    <section class="glass panel"><div class="panel-head"><h2>Field visit purposes</h2><span class="sub">One per line</span></div><textarea id="rvp" style="min-height:170px">${esc((s.visit_purposes || []).join('\n'))}</textarea></section>
    <section class="glass panel"><div class="panel-head"><h2>Escalations</h2><span class="sub">Response deadline by severity</span></div><div class="form">${ESC_SEV.map((x) => fld('eh' + x, `${x} (hours)`, inp('eh' + x, eh[x] ?? 48, 'number', 'min="1"'))).join('')}${fld('rety', 'Types (one per line)', `<textarea id="rety">${esc((s.escalation_types || []).join('\n'))}</textarea>`, 'full')}</div></section>
    <section class="glass panel"><div class="panel-head"><h2>Command Centre</h2></div><div class="form">${fld('rst', 'A deal is stale after (days with no update)', inp('rst', s.stale_deal_days ?? 7, 'number', 'min="1"'))}${fld('rfc', 'First contact expected within (hours)', inp('rfc', s.first_contact_hours ?? 48, 'number', 'min="1"'))}</div></section>
    <section class="glass panel"><div class="panel-head"><h2>Discounts and calls</h2></div><div class="form">${fld('rds', 'Discount limit · everyone (%)', inp('rds', d.sales ?? 5, 'number'))}${fld('rdh', 'Discount limit · Admin (%)', inp('rdh', d.head ?? 10, 'number'))}${fld('rcd', 'Calls per day target', inp('rcd', kp.calls_per_day ?? 50, 'number'))}</div></section>
  </div><div class="row" style="justify-content:flex-end"><button class="btn primary" id="rsv">Save rules</button></div>`;
  const lines = (id) => v(b, id).split('\n').map((x) => x.trim()).filter(Boolean);
  b.querySelector('#rsv').onclick = () => guard(async () => {
    if (!lines('rvp').length) throw new Error('Keep at least one visit purpose.');
    await DB.setSetting('visit_purposes', lines('rvp'));
    await DB.setSetting('escalation_hours', Object.fromEntries(ESC_SEV.map((x) => [x, Math.max(1, num(b, 'eh' + x))])));
    await DB.setSetting('escalation_types', lines('rety'));
    await DB.setSetting('stale_deal_days', Math.max(1, num(b, 'rst')));
    await DB.setSetting('first_contact_hours', Math.max(1, num(b, 'rfc')));
    await DB.setSetting('discounts', { sales: num(b, 'rds'), head: num(b, 'rdh') });
    await DB.setSetting('kpi', { ...kp, calls_per_day: num(b, 'rcd') });
    rer();
  }, 'Rules saved');
}

/* ---------- KRA weights and monthly targets ---------- */
const KRA_KEYS = { calls: 'Calls / month', followups: 'Follow-ups on time (%)', conversions: 'Conversions (deals won) / month', visits: 'Field visits completed / month', crm: 'Open records updated within the stale-deal days (%)', team_revenue: 'Team collections (₹ / month)', team_closures: 'Team conversions / month', team_pipeline: 'Team pipeline built (₹ / month)', team_tasks: 'Team follow-ups on time (%)', team_discipline: 'Team calls against target (%)' };
function setKra(b, rer) {
  const w = JSON.parse(JSON.stringify(DB.settings.kra_v4 || { member: [], team: [] })); const t = DB.settings.kpi_targets || {};
  const grp = (k, title, sub) => `<section class="glass panel"><div class="panel-head"><h2>${title}</h2><span class="sub" data-tot="${k}"></span></div><p class="faint" style="font-size:12.5px;margin-top:0">${sub}</p><div class="tablewrap free"><table><thead><tr><th>KRA</th><th class="n">Weight %</th><th class="n">Monthly target</th></tr></thead><tbody>${(w[k] || []).map((r, i) => `<tr><td>${esc(r[0])}<div class="s">${esc(KRA_KEYS[r[2]] || r[2])}</div></td><td class="n"><input type="number" class="kw" data-g="${k}" data-i="${i}" value="${r[1]}" style="width:70px;text-align:right" aria-label="Weight"></td><td class="n"><input type="number" class="kt" data-k="${r[2]}" value="${t[r[2]] ?? (r[2] === 'conversions' ? t.closures ?? '' : '')}" style="width:120px;text-align:right" aria-label="Target"></td></tr>`).join('')}</tbody></table></div></section>`;
  b.innerHTML = `<div class="grid g2">${grp('member', 'People with nobody below them', 'Scored on their own work.')}${grp('team', 'People with a team', 'Scored on the results of everyone below them in Reports to.')}</div><div class="row" style="justify-content:flex-end"><button class="btn primary" id="ksv">Save</button></div>`;
  const tot = () => ['member', 'team'].forEach((g) => { const s = sum($$(`.kw[data-g="${g}"]`, b), (i) => Number(i.value)); b.querySelector(`[data-tot="${g}"]`).innerHTML = s === 100 ? 'Weights total 100%' : `<span style="color:var(--bad)">${s}% · must total 100</span>`; });
  $$('.kw', b).forEach((i) => (i.oninput = tot)); tot();
  b.querySelector('#ksv').onclick = () => guard(async () => {
    $$('.kw', b).forEach((i) => (w[i.dataset.g][+i.dataset.i][1] = Number(i.value)));
    for (const g of ['member', 'team']) if (sum(w[g] || [], (r) => r[1]) !== 100) throw new Error('Each set of weights must total 100%.');
    await DB.setSetting('kra_v4', w);
    await DB.setSetting('kpi_targets', { ...t, ...Object.fromEntries($$('.kt', b).map((i) => [i.dataset.k, Number(i.value)])) });
  }, 'Saved');
}

function setGst(b, rer) {
  const g = JSON.parse(JSON.stringify(DB.settings.gst || { categories: [] }));
  const prods = DB.t.products.slice().sort((a, c) => a.sort - c.sort);
  const catOpts = (sel0) => `<option value="">—</option>${g.categories.map((c) => `<option value="${esc(c.key)}" ${c.key === sel0 ? 'selected' : ''}>${esc(c.label)}${c.rate != null && c.rate !== '' ? ` · ${c.rate}%` : ''}</option>`).join('')}`;
  b.innerHTML = `<div class="note info">GST differs by service. Set each category's rate and SAC / HSN code once (Finance can confirm the codes), assign products to categories, then apply. Labs use a blended rate worked out from their line items (drones 5%, kits and accessories 18%).</div>
  <section class="glass panel"><details class="acc" open><summary>Company GST details<span class="sub">${esc(g.gstin || 'GSTIN not set')}</span></summary><div class="acc-body"><div class="form three">${fld('g1', 'GSTIN', inp('g1', g.gstin || '', 'text', 'placeholder="33XXXXX0000X1Z5" maxlength="15" style="text-transform:uppercase"'))}${fld('g2', 'Legal name', inp('g2', g.legal_name || ''))}${fld('g3', 'State', inp('g3', g.state || 'Tamil Nadu'))}${fld('g4', 'State code', inp('g4', g.state_code || '33'))}<label class="check"><input type="checkbox" id="g5" ${g.prices_include_gst ? 'checked' : ''}> Price book prices include GST</label></div></div></details>
    <details class="acc" open><summary>GST categories<span class="sub">${g.categories.length} categories</span></summary><div class="acc-body"><div class="tablewrap free"><table><thead><tr><th>Category</th><th class="n">Rate %</th><th>SAC / HSN code</th><th>Covers</th><th class="n">Products</th><th></th></tr></thead><tbody>
      ${g.categories.map((c, i) => `<tr data-ci="${i}"><td><input class="cl" value="${esc(c.label)}" style="min-width:220px"><div class="s mono">${esc(c.key)}</div></td><td class="n"><input class="cr" type="number" step="0.01" value="${c.rate ?? ''}" placeholder="${c.key === 'lab' ? 'blended' : ''}" style="width:80px" ${c.key === 'lab' ? 'disabled' : ''}></td><td><input class="cs" value="${esc(c.sac || '')}" placeholder="to be confirmed by Finance" style="width:170px"></td><td><input class="cn" value="${esc(c.notes || '')}" style="min-width:200px"></td><td class="n">${prods.filter((p) => p.gst_category === c.key).length}</td><td class="n">${prods.some((p) => p.gst_category === c.key) ? '' : `<button class="btn ghost small" data-cdel="${i}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div><div class="row"><button class="btn small" id="gadd">${svg('plus')} Add category</button></div></div></details>
    <details class="acc"><summary>Products and their GST category<span class="sub">${prods.filter((p) => !p.gst_category).length} without a category</span></summary><div class="acc-body"><div class="tablewrap"><table><thead><tr><th>Product</th><th>Category</th><th class="n">Current GST</th></tr></thead><tbody>${prods.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="s mono">${esc(p.code)}</div></td><td><select class="pg" data-pid="${p.id}" style="width:auto">${catOpts(p.gst_category)}</select></td><td class="n">${(+p.gst_rate).toFixed(p.gst_rate % 1 ? 2 : 0)}%</td></tr>`).join('')}</tbody></table></div></div></details>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="gsave">Save</button><button class="btn primary" id="gapply">Save and apply rates to the price book</button></div></section>`;
  const collect = () => {
    const ng = { ...g, gstin: v(b, 'g1').toUpperCase().trim(), legal_name: v(b, 'g2'), state: v(b, 'g3'), state_code: v(b, 'g4'), prices_include_gst: v(b, 'g5') };
    if (ng.gstin && !/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(ng.gstin)) throw new Error('The GSTIN should be 15 characters, for example 33ABCDE1234F1Z5');
    ng.categories = $$('[data-ci]', b).map((tr) => { const c = g.categories[+tr.dataset.ci]; const r = tr.querySelector('.cr').value; return { ...c, label: tr.querySelector('.cl').value, rate: c.key === 'lab' ? null : r === '' ? null : Number(r), sac: tr.querySelector('.cs').value.trim(), notes: tr.querySelector('.cn').value }; });
    return ng;
  };
  const save = async () => {
    await DB.setSetting('gst', collect());
    for (const s0 of $$('.pg', b)) { const p = DB.get('products', s0.dataset.pid); if (p && (p.gst_category || '') !== s0.value) await DB.update('products', p.id, { gst_category: s0.value }); }
  };
  b.querySelector('#gsave').onclick = () => guard(async () => { await save(); rer(); }, 'GST settings saved');
  b.querySelector('#gapply').onclick = () => guard(async () => { await save(); const n = await DB.rpc('apply_gst_rates'); toast(`GST applied to ${n} product${n === 1 ? '' : 's'}`); rer(); });
  b.querySelector('#gadd').onclick = () => guard(async () => { const label = await promptBox('New GST category', 'Name', ''); if (!label) return; const ng = collect(); ng.categories.push({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30), label, rate: 18, sac: '', notes: '' }); await DB.setSetting('gst', ng); rer(); });
  b.querySelectorAll('[data-cdel]').forEach((x) => (x.onclick = () => guard(async () => { const ng = collect(); ng.categories.splice(+x.dataset.cdel, 1); await DB.setSetting('gst', ng); rer(); })));
}
function setLists(b) {
  const s = DB.settings;
  b.innerHTML = `<section class="glass panel"><div class="form three">${fld('l1', 'Lead sources (one per line)', `<textarea id="l1" style="min-height:260px">${esc((s.sources || []).join('\n'))}</textarea>`)}${fld('l2', 'Training centres', `<textarea id="l2" style="min-height:260px">${esc((s.centres || []).join('\n'))}</textarea>`)}${fld('l3', 'Lost reasons', `<textarea id="l3" style="min-height:260px">${esc((s.lost_reasons || []).join('\n'))}</textarea>`)}</div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="lsv">Save lists</button></div></section>`;
  const lines = (id) => v(b, id).split('\n').map((x) => x.trim()).filter(Boolean);
  const w = s.webinar || {};
  b.insertAdjacentHTML('beforeend', `<section class="glass panel"><div class="panel-head"><h2>Webinar registration</h2></div><div class="form">${fld('w1', 'Public registration page address (leave blank to use this CRM\'s address + /register.html)', inp('w1', w.public_url || '', 'url', 'placeholder="https://crm.garudaaerospace.com/register.html"'), 'full')}${fld('w2', 'Default fee for paid webinars (₹ ex-GST)', inp('w2', w.default_fee ?? 499, 'number'))}${fld('w3', 'Default GST %', inp('w3', w.default_gst ?? 18, 'number'))}${fld('w4', 'Terms shown on the form', inp('w4', w.terms || ''), 'full')}</div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="wsv">Save</button></div></section>`);
  b.querySelector('#wsv').onclick = () => guard(() => DB.setSetting('webinar', { ...w, public_url: v(b, 'w1').trim(), default_fee: num(b, 'w2'), default_gst: num(b, 'w3'), terms: v(b, 'w4') }), 'Saved');
  b.querySelector('#lsv').onclick = () => guard(async () => { await DB.setSetting('sources', lines('l1')); await DB.setSetting('centres', lines('l2')); await DB.setSetting('lost_reasons', lines('l3')); }, 'Saved');
}
function setEmail(b) {
  const e = DB.settings.email || { senders: {} };
  b.innerHTML = `<section class="glass panel"><div class="note info">Emails are sent by the Apps Script mailer running on your dedicated marketing mailbox. Add each address below as a Gmail "Send mail as" alias on that mailbox; the mailer uses it as the From address for that email type.</div>
    <div class="form" style="margin-top:10px">${EMAIL_CATS.map((c, i) => fld('se' + i, c + ' sender', inp('se' + i, e.senders?.[c] || '', 'email', 'placeholder="e.g. marketing@garudaaerospace.com"'))).join('')}${fld('sel', 'Daily sending limit', inp('sel', e.daily_limit ?? 1500, 'number'))}${fld('sef', 'Footer line', inp('sef', e.footer || ''))}</div>
    <h4 style="margin-top:12px">Who can send</h4><p class="muted" style="margin:4px 0">${DB.t.profiles.filter((p) => p.active && (p.role === 'admin' || p.perms?.email || p.email_access)).map((p) => esc(p.full_name)).join(', ') || 'Nobody yet'} · change in Users & Access.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" id="esv">Save</button></div></section>`;
  b.querySelector('#esv').onclick = () => guard(() => DB.setSetting('email', { senders: Object.fromEntries(EMAIL_CATS.map((c, i) => [c, v(b, 'se' + i)])), daily_limit: num(b, 'sel'), footer: v(b, 'sef') }), 'Saved');
}
function setAI(b) {
  const a = DB.settings.ai || {};
  b.innerHTML = `<section class="glass panel"><div class="form">${fld('a1', 'Scoring model (fast, used for every lead)', inp('a1', a.score_model || 'claude-haiku-5-5'))}${fld('a2', 'Writing model (drafts, briefs, morning brief)', inp('a2', a.writer_model || 'claude-sonnet-5-5'))}${fld('a3', 'Maximum leads re-scored per run', inp('a3', a.max_scores_per_run ?? 200, 'number'))}<div></div>
    <label class="check"><input type="checkbox" id="a4" ${a.enabled !== false ? 'checked' : ''}> Claude features on</label><label class="check"><input type="checkbox" id="a5" ${a.auto_score !== false ? 'checked' : ''}> Re-score leads automatically after new activity</label><label class="check"><input type="checkbox" id="a6" ${a.daily_digest !== false ? 'checked' : ''}> Morning brief at 7:30 am</label></div>
    <p class="faint" style="font-size:12px;margin-top:10px">The Claude API key is stored as the ANTHROPIC_API_KEY secret in Supabase, never in the app. Usage is logged in the ai_runs table with token counts.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" id="asv">Save</button></div></section>`;
  b.querySelector('#asv').onclick = () => guard(() => DB.setSetting('ai', { score_model: v(b, 'a1'), writer_model: v(b, 'a2'), max_scores_per_run: num(b, 'a3'), enabled: v(b, 'a4'), auto_score: v(b, 'a5'), daily_digest: v(b, 'a6') }), 'Saved');
}
function setData(b) {
  b.innerHTML = `<div class="grid g2"><section class="glass panel"><div class="panel-head"><h2>Import leads from CSV</h2></div><p class="muted" style="margin:0 0 8px">Columns: name, phone, email, city, source, department (${DEPTS().map((d) => esc(d.code)).join(', ')}), course, institution, product_code, owner_email, notes. To load the whole sales sheet again use the SQL import in SETUP.md.</p><input type="file" id="csvf" accept=".csv,text/csv"><div id="csvp" style="margin-top:8px"></div></section>
    <section class="glass panel"><div class="panel-head"><h2>Export</h2></div><div class="row">${['leads', 'remarks', 'payments', 'price_disclosures', 'revenue_entries', 'admissions', 'institutions', 'contacts', 'visits', 'projects', 'project_items', 'complaints', 'mkt_campaigns', 'campaign_spend', 'email_queue'].map((t) => `<button class="btn small" data-exp="${t}">${t}</button>`).join('')}</div><p class="faint" style="font-size:12px;margin-top:8px">Full backups: Supabase → Database → Backups.</p></section></div>`;
  b.querySelectorAll('[data-exp]').forEach((x) => (x.onclick = () => downloadCSV('garuda-' + x.dataset.exp, (DB.t[x.dataset.exp] || []).map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === 'object' && val !== null ? JSON.stringify(val) : val]))))));
  b.querySelector('#csvf').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const rows = parseCSV(rd.result); if (!rows.length) return toast('No rows found', true);
      const head = rows[0].map((h) => h.trim().toLowerCase()); const data = rows.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
      const dupes = data.filter((r) => dupCheck(r.phone, r.email));
      b.querySelector('#csvp').innerHTML = `<p><b>${data.length}</b> rows · ${dupes.length} look like existing leads and will be skipped.</p><button class="btn primary" id="csvgo">Import ${data.length - dupes.length} leads</button>`;
      b.querySelector('#csvgo').onclick = () => guard(async () => {
        let n = 0;
        for (const r of data) {
          if (dupCheck(r.phone, r.email)) continue;
          const funnel = DEPTS().find((d) => d.code.toLowerCase() === String(r.department || r.funnel || '').trim().toLowerCase())?.code || DEPTS()[0].code;
          const p = DB.t.products.find((x) => x.code === r.product_code);
          let inst = null; if (r.institution) inst = DB.t.institutions.find((i) => i.name.toLowerCase() === r.institution.toLowerCase()) || await DB.insert('institutions', { name: r.institution, city: r.city, owner: DB.me.id });
          const owner = assignablePeople().find((x) => x.email.toLowerCase() === (r.owner_email || '').toLowerCase())?.id || DB.me.id;
          const course = r.course || r.sub_category || ''; const org = isOrgDept(funnel);
          await DB.insert('leads', { funnel, name: r.name || (inst ? inst.name + ' · enquiry' : 'Imported lead'), institution_id: inst?.id || null, phone: r.phone, email: r.email, city: r.city, source: r.source || 'Import', product_id: p?.id || null, unit_price: p?.price || 0, gst_rate: p?.gst_rate ?? 18, stage: S.firstOpen(funnel, 'lead')?.key || 'New', course: org ? '' : course, sub_category: org ? course : '', owner, notes: r.notes || '', consent_email: !!r.email });
          n++;
        }
        toast(`${n} leads imported`); b.querySelector('#csvp').innerHTML = '';
      });
    };
    rd.readAsText(f);
  };
}
