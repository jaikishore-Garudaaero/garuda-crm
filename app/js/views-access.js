/* Garuda CRM · Super admin, page access by role and by person, deleting leads, and the org chart */
'use strict';

/* Super admin: an Admin with the super flag. Full control, including page access and deleting leads. */
const isSuper = () => isHead() && !!DB.me?.super_admin;
const roleName = (p) => (p?.role === 'admin' && p?.super_admin ? 'Super admin' : ROLES[p?.role] || p?.role || '');
/* the levels shown in Users & Access */
const ROLE_OPTS = () => [...(isSuper() ? [['super', 'Super admin: everything, including access and deleting'], ['admin', 'Admin: everything except access and deleting']] : []), ['clevel', 'C-level: sees every record'], ['manager', 'Manager'], ['lead', 'Lead'], ['member', 'Member']];

/* pages a role sees unless the Super admin changes it (null = every page its permissions allow) */
const ACCESS_DEFAULT = { admin: null, clevel: null, manager: { block: ['connect'] }, lead: { block: ['connect'] }, member: { block: ['connect'] } };
const ACCESS_ROLES = [['admin', 'Admin'], ['clevel', 'C-level'], ['manager', 'Manager'], ['lead', 'Lead'], ['member', 'Member']];
const accessCfg = () => DB.settings.access || {};
function roleBlocks(role) { const c = accessCfg().roles?.[role]; return new Set(c ? c.block || [] : ACCESS_DEFAULT[role]?.block || []); }
/* can this person open this page? (Settings stays with Admins; the Super admin sees everything) */
function canView(v, p = DB.me) {
  if (!p) return false;
  if (p.role === 'admin' && p.super_admin) return true;
  if (SUPER_PAGES.includes(v)) return false;
  if (v === 'settings') return p.role === 'admin';
  const pc = accessCfg().people?.[p.id];
  if (pc?.allow?.includes(v)) return true;
  if (pc?.block?.includes(v)) return false;
  return !roleBlocks(p.role).has(v);
}
const SUPER_PAGES = ['activity'];
const ALL_PAGES = () => [...NAV.flatMap(([g, items]) => items.filter((i) => !SUPER_PAGES.includes(i[0])).map((i) => [i[0], navLabel(i), g])), ['pricebook', 'Price Book', 'Menu']];

/* ---------- Settings → Access control (Super admin) ---------- */
function setAccess(b, rer) {
  if (!isSuper()) { b.innerHTML = `<section class="glass panel">${empty('Only the Super admin changes page access', 'Ask the Super admin if someone needs a page added or removed.')}</section>`; return; }
  const cfg = JSON.parse(JSON.stringify(accessCfg())); cfg.roles ||= {}; cfg.people ||= {};
  ACCESS_ROLES.forEach(([r]) => { cfg.roles[r] ||= { block: [...(ACCESS_DEFAULT[r]?.block || [])] }; });
  const pages = ALL_PAGES(); const groups = [...new Set(pages.map((x) => x[2]))];
  const people = DB.t.profiles.filter((p) => p.active && !(p.role === 'admin' && p.super_admin)).sort((a, c) => a.full_name.localeCompare(c.full_name));
  let who = b.dataset.who || people[0]?.id || '';
  const draw = () => {
    const P = DB.profile(who); const pc = cfg.people[who] || { allow: [], block: [] };
    const stateFor = (pg) => (pc.allow?.includes(pg) ? 'allow' : pc.block?.includes(pg) ? 'block' : 'role');
    const roleHas = (pg) => P && !(cfg.roles[P.role]?.block || []).includes(pg);
    b.innerHTML = `<div class="note info"><b>Super admin</b> sees and does everything. Here you decide which pages each role sees, then make exceptions for one person. Pages hidden here disappear from that person’s menu and cannot be opened by link. Settings is always Admin-only.</div>
      <div class="grid g2 accgrid">
      <section class="glass panel"><div class="panel-head"><h2>By role</h2><span class="sub">Tick the pages each role can open</span></div>
        <div class="tablewrap"><table class="acc"><thead><tr><th>Page</th>${ACCESS_ROLES.map(([, t]) => `<th class="c">${t}</th>`).join('')}</tr></thead><tbody>
        ${groups.map((g) => `<tr class="grp"><td colspan="${ACCESS_ROLES.length + 1}">${esc(g)}</td></tr>${pages.filter((x) => x[2] === g).map(([k, t]) => `<tr><td>${esc(t)}</td>${ACCESS_ROLES.map(([r]) => `<td class="c"><input type="checkbox" class="arole" data-r="${r}" data-p="${k}" aria-label="${esc(t)} for ${r}" ${(cfg.roles[r].block || []).includes(k) ? '' : 'checked'}></td>`).join('')}</tr>`).join('')}`).join('')}
        </tbody></table></div></section>
      <section class="glass panel"><div class="panel-head"><h2>For one person</h2><span class="sub">Exceptions to their role</span></div>
        <label class="field"><span>Person</span><select id="awho">${people.map((p) => `<option value="${p.id}" ${p.id === who ? 'selected' : ''}>${esc(p.full_name)} · ${esc(roleName(p))}</option>`).join('')}</select></label>
        ${P ? `<div class="tablewrap"><table class="acc"><thead><tr><th>Page</th><th class="c">As role</th><th class="c">Always</th><th class="c">Never</th></tr></thead><tbody>
        ${pages.map(([k, t]) => `<tr><td>${esc(t)} <span class="faint" style="font-size:11.5px">${roleHas(k) ? '' : '(role: hidden)'}</span></td>${['role', 'allow', 'block'].map((s) => `<td class="c"><input type="radio" name="ap_${k}" class="aperson" data-p="${k}" value="${s}" aria-label="${esc(t)}: ${s}" ${stateFor(k) === s ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
        </tbody></table></div>` : '<p class="faint">Nobody to set.</p>'}
      </section></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="areset">Back to defaults</button><button class="btn primary" id="asave">Save access</button></div>`;
    b.querySelectorAll('.arole').forEach((c) => (c.onchange = () => { const r = cfg.roles[c.dataset.r]; const s0 = new Set(r.block || []); if (c.checked) s0.delete(c.dataset.p); else s0.add(c.dataset.p); r.block = [...s0]; }));
    b.querySelectorAll('.aperson').forEach((c) => (c.onchange = () => { const x = cfg.people[who] ||= { allow: [], block: [] }; const k = c.dataset.p; x.allow = (x.allow || []).filter((y) => y !== k); x.block = (x.block || []).filter((y) => y !== k); if (c.value === 'allow') x.allow.push(k); if (c.value === 'block') x.block.push(k); }));
    b.querySelector('#awho')?.addEventListener('change', (e) => { who = e.target.value; b.dataset.who = who; draw(); });
    b.querySelector('#asave').onclick = () => guard(async () => { Object.keys(cfg.people).forEach((k) => { const x = cfg.people[k]; if (!x.allow?.length && !x.block?.length) delete cfg.people[k]; }); await DB.setSetting('access', cfg); }, 'Access saved. People see the change the next time their screen refreshes.');
    b.querySelector('#areset').onclick = async () => { if (await confirmBox('Put every role back to the default pages and remove all exceptions for individual people?', 'Reset')) guard(async () => { await DB.setSetting('access', {}); rer(); }, 'Back to defaults'); };
  };
  draw();
}

/* ---------- deleting leads (Super admin) ---------- */
async function deleteLeads(ids, after) {
  if (!isSuper() || !ids.length) return;
  const one = ids.length === 1 ? DB.get('leads', ids[0]) : null;
  const ok = await confirmBox(`${one ? `Delete <b>${esc(one.name)}</b>` : `Delete <b>${ids.length} leads</b>`} and everything on ${one ? 'it' : 'them'}: remarks, tasks, quotes and emails? This cannot be undone from the CRM (a copy stays in the audit log).`, 'Delete for good');
  if (!ok) return;
  await guard(async () => {
    let n = 0; for (let i = 0; i < ids.length; i += 500) n += Number(await DB.call('delete_leads', { p_ids: ids.slice(i, i + 500) })) || 0;
    const gone = new Set(ids); DB.t.leads = DB.t.leads.filter((l) => !gone.has(l.id)); DB.emit?.();
    toast(`${n} lead${n === 1 ? '' : 's'} deleted`); after?.();
  });
}

/* ---------- the org chart: boxes and connector lines, collapsible, zoomable ---------- */
const ORG = { zoom: 1, shut: new Set() };
function orgChart(ps) {
  const ids = new Set(ps.map((p) => p.id));
  const kidsOf = (id) => ps.filter((p) => (id === null ? !p.reports_to || !ids.has(p.reports_to) : p.reports_to === id)).sort((a, c) => (rank(a) - rank(c)) || a.full_name.localeCompare(c.full_name));
  const rank = (p) => ({ admin: 0, clevel: 1, manager: 2, lead: 3, member: 4 })[p.role] ?? 5;
  const count = (id) => kidsOf(id).reduce((n, k) => n + 1 + count(k.id), 0);
  const node = (p) => {
    const kids = kidsOf(p.id); const shut = ORG.shut.has(p.id); const tone = p.role === 'admin' ? (p.super_admin ? 'super' : 'admin') : p.role;
    return `<li><div class="ocard r-${tone}"><button type="button" class="obody" data-org="${p.id}" title="Edit ${esc(p.full_name)}"><span class="oav">${esc(initials(p.full_name))}</span><span class="otx"><b>${esc(p.full_name)}</b><span>${esc(p.designation || roleName(p))}</span><span class="orole">${esc(roleName(p))}${(p.departments || []).length ? ' · ' + (p.departments || []).map((d) => esc(dept(d)?.name?.split(' ')[0] || d)).join(', ') : ''}</span></span></button>
      ${kids.length ? `<button type="button" class="otog" data-otog="${p.id}" aria-expanded="${!shut}" title="${shut ? 'Show' : 'Hide'} their team">${shut ? '+' + count(p.id) : '−'}</button>` : ''}</div>
      ${kids.length && !shut ? (kids.length > 3 && kids.every((k) => !kidsOf(k.id).length) ? `<ul class="leafs">${kids.map(node).join('')}</ul>` : `<ul>${kids.map(node).join('')}</ul>`) : ''}</li>`;
  };
  const roots = kidsOf(null);
  return `<div class="orgbar"><span class="faint">${ps.length} people · click a card to edit, − to fold a team</span><span class="row"><button type="button" class="btn small" data-oz="-1" aria-label="Zoom out">−</button><button type="button" class="btn small" data-oz="0">${Math.round(ORG.zoom * 100)}%</button><button type="button" class="btn small" data-oz="1" aria-label="Zoom in">+</button><button type="button" class="btn small" data-oz="all">${ORG.shut.size ? 'Open all' : 'Fold all'}</button></span></div>
    <div class="orgwrap"><div class="otree" style="zoom:${ORG.zoom}"><ul>${roots.map(node).join('')}</ul></div></div>
    <div class="olegend">${[['super', 'Super admin'], ['admin', 'Admin'], ['clevel', 'C-level'], ['manager', 'Manager'], ['lead', 'Lead'], ['member', 'Member']].map(([k, t]) => `<span><i class="r-${k}"></i>${t}</span>`).join('')}</div>`;
}
function bindOrg(box, ps, rer) {
  const w = box.querySelector('.orgwrap'); const t = box.querySelector('.otree');
  if (w && t) requestAnimationFrame(() => { if (!ORG.fitted) { ORG.fitted = true; const need = t.scrollWidth / ORG.zoom; if (need > w.clientWidth) { ORG.zoom = Math.max(0.5, Math.floor((w.clientWidth / need) * 20) / 20); t.style.zoom = ORG.zoom; const z = box.querySelector('[data-oz="0"]'); if (z) z.textContent = Math.round(ORG.zoom * 100) + '%'; } } w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2; });
  box.querySelectorAll('[data-otog]').forEach((x) => (x.onclick = () => { const id = x.dataset.otog; if (ORG.shut.has(id)) ORG.shut.delete(id); else ORG.shut.add(id); rer(); }));
  box.querySelectorAll('[data-oz]').forEach((x) => (x.onclick = () => { const z = x.dataset.oz; if (z === 'all') { if (ORG.shut.size) ORG.shut.clear(); else ps.filter((p) => ps.some((q) => q.reports_to === p.id)).forEach((p) => ORG.shut.add(p.id)); } else ORG.zoom = z === '0' ? 1 : Math.min(1.4, Math.max(0.5, ORG.zoom + Number(z) * 0.1)); rer(); }));
}
