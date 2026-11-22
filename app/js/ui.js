/* Garuda CRM · UI toolkit */
'use strict';

const ST = { view: 'command', arg: null, period: 'month', dept: 'All', prod: '', person: 'all', cfrom: '', cto: '', ldTab: 'leads', ldMode: { leads: 'list', deals: 'list' }, kbDept: '' };
const UI_KEYS = ['period', 'dept', 'prod', 'person', 'cfrom', 'cto', 'ldTab', 'ldMode', 'kbDept'];
/* filters and view choices are remembered per person on this device */
const uiKey = () => 'garuda-crm-ui-' + (DB.me?.id || 'anon');
function loadUI() { try { const x = JSON.parse(localStorage.getItem(uiKey()) || '{}'); UI_KEYS.forEach((k) => { if (x[k] !== undefined) ST[k] = x[k]; }); } catch (_) { /* private mode */ } fixUI(); }
function saveUI() { try { localStorage.setItem(uiKey(), JSON.stringify(Object.fromEntries(UI_KEYS.map((k) => [k, ST[k]])))); } catch (_) { /* ignore */ } }
function fixUI() {
  if (ST.dept !== 'All' && !DEPTS().some((d) => d.code === ST.dept)) ST.dept = 'All';
  if (ST.person !== 'all' && !scopePeople().some((p) => p.id === ST.person)) ST.person = 'all';
  if (!hasTeam()) ST.person = 'all';
  ST.ldMode = { leads: 'list', deals: 'list', ...(ST.ldMode || {}) };
}
const curRange = () => M.range(ST.period, ST.cfrom, ST.cto);

const ICON = {
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  dash: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z"/>',
  me: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5"/>',
  ai: '<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  leads: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M16 5.5a3 3 0 010 5.5M18 14c1.6.6 2.6 2.2 3 4"/>',
  pipe: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  inst: '<path d="M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>',
  task: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  eod: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  kra: '<path d="M12 3l2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 16.6 6.8 19.3l1-5.9L3.5 9.3l5.9-.9z"/>',
  rev: '<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>',
  mkt: '<path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15 9a3 3 0 010 6M18 6a7 7 0 010 12"/>',
  web: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  proj: '<path d="M4 7h16v13H4zM9 7V4h6v3M4 12h16"/>',
  warn: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  price: '<path d="M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', send: '<path d="M4 12l16-8-6 16-2-7z"/>',
  own: '<circle cx="7" cy="7" r="3"/><path d="M2 20c.6-3 2.6-5 5-5s4.4 2 5 5"/><path d="M14 6h8M14 11h8M14 16h8"/>',
  appr: '<path d="M9 12l2 2 4-4"/><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>',
  ads: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>', kanban: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>', sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  team: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 19c.7-3.2 2.8-5 5.5-5s4.8 1.8 5.5 5M14 14.5c2.6-.6 5.6.6 6.5 4.5"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  chevl: '<path d="M14.5 6l-6 6 6 6"/>', chevr: '<path d="M9.5 6l6 6-6 6"/>',
  updown: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  out: '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  tdash: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c.9 1.4 2 2 3.5 2s2.6-.6 3.5-2M9 9.5h.01M15 9.5h.01"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  deal: '<path d="M3 11l4-4 4 2 3-3 4 1 3 3-6 6-3-1-3 3-3-1z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  pay: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.6-5.3 3.6-8.3.6 1.9 1.7 3 2.9 3.7.3-2.3 1.5-4.4 3.3-6.2.4 3.8 3.2 5.6 3.2 10.5 0 3.7-2.6 6.5-6.5 6.5z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7"/>',
  ring: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  note: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;

/* ---------- toast, modal, drawer, confirm ---------- */
let toastT;
function toast(msg, err) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast glass' + (err ? ' err' : ''); el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, err ? 5200 : 2600);
}
async function guard(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { console.error(e); toast(e.message || String(e), true); return undefined; } }

/* open pop-ups; opening a record closes them so it never comes back to the pop-up */
const MODALS = new Set();
function openModal({ title, body, foot = '', width = 720, onMount }) {
  const layer = $('#layer');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const m = document.createElement('div'); m.className = 'modal glass'; m.style.setProperty('--mw', width + 'px');
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="btn ghost small" data-x aria-label="Close">${svg('x')}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  layer.append(scrim, m);
  const close = () => { scrim.remove(); m.remove(); MODALS.delete(close); document.removeEventListener('keydown', onKey); };
  MODALS.add(close);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.onclick = close; m.querySelector('[data-x]').onclick = close;
  m.querySelectorAll('.modal-foot [data-c]').forEach((b) => (b.onclick = close));
  const ctx = { el: m, close };
  onMount?.(ctx);
  setTimeout(() => m.querySelector('input,select,textarea')?.focus(), 30);
  return ctx;
}
function confirmBox(text, okLabel = 'Confirm') {
  return new Promise((res) => {
    const m = openModal({ title: 'Please confirm', width: 440, body: `<p>${text}</p>`, foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${okLabel}</button>` });
    m.el.querySelector('[data-no]').onclick = () => { m.close(); res(false); };
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); res(true); };
  });
}
function promptBox(title, label, value = '', opts = {}) {
  return new Promise((res) => {
    const input = opts.options ? `<select id="pb">${opts.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input id="pb" value="${esc(value)}">`;
    const m = openModal({ title, width: 440, body: `<div class="field"><label for="pb">${label}</label>${input}</div>`, foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save</button>` });
    m.el.querySelector('[data-no]').onclick = () => { m.close(); res(null); };
    m.el.querySelector('[data-yes]').onclick = () => { const v = m.el.querySelector('#pb').value; m.close(); res(v); };
  });
}

let drawerCtx = null;
function openDrawer(render, cls = '') {
  closeDrawer(); [...MODALS].forEach((c) => c());
  const layer = $('#layer');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const d = document.createElement('aside'); d.className = 'drawer glass' + (cls ? ' ' + cls : ''); d.setAttribute('role', 'dialog');
  layer.append(scrim, d);
  const close = () => { scrim.remove(); d.remove(); drawerCtx = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !$('.modal')) close(); };
  document.addEventListener('keydown', onKey);
  scrim.onclick = close;
  drawerCtx = { el: d, close, render: () => render(drawerCtx) };
  drawerCtx.render();
  return drawerCtx;
}
function closeDrawer() { drawerCtx?.close(); }

/* ---------- small renderers ---------- */
const funnelChip = (f) => `<span class="chip dept" style="--dc:${esc(deptColor(f))}">${esc(f)}</span>`;
const deptChip = funnelChip;
/* positive (green), alarming (amber) and negative (red) colours for statuses and records */
const ALARM_STAGES = /^(RNR|Not Updated|Duplicate|Other Department|Mgmt Interference|Direct Visit Needed)$/i;
function stageTone(l) { const s = L.st(l); if (s.is_won) return 'good'; if (s.is_lost) return 'bad'; if (s.is_closed) return 'mute'; if (ALARM_STAGES.test(l.stage || '')) return 'warn'; if (l.is_deal && s.prob >= 60) return 'good'; return 'info'; }
function stageChip(l) { return `<span class="chip tone ${stageTone(l)}">${esc(l.stage)}</span>`; }
function leadTone(l) {
  if (L.won(l)) return 'good'; if (L.lost(l)) return 'bad';
  const now = new Date();
  if (l.next_followup_at && new Date(l.next_followup_at) < now && (!l.last_contact_at || new Date(l.last_contact_at) < new Date(l.next_followup_at))) return 'warn';
  if (l.is_deal && l.expected_close && l.expected_close < todayStr()) return 'warn';
  if (l.is_deal && daysAgo(L.updated(l)) >= (Number(DB.settings.stale_deal_days) || 7)) return 'warn';
  if (l.is_deal && L.prob(l) >= 60) return 'good';
  return '';
}
const toneLegend = () => '<span class="tlegend"><i class="good"></i>Won or likely <i class="warn"></i>Needs attention <i class="bad"></i>Lost <i class="mute"></i>Duplicate / other team</span>';
const tempChip = (t) => (t ? `<span class="chip ${t.toLowerCase()}">${t}</span>` : '');
function scoreBadge(l) { if (l.ai_score == null) return '<span class="faint">—</span>'; const b = (l.ai_band || 'Cold').toLowerCase(); return `<span class="score s-${b}" title="Claude score · ${esc(l.ai_band)}">${l.ai_score}</span>`; }
const personOpts = (sel, list = scopePeople(), all = true) => (all ? `<option value="all">Everyone</option>` : '') + list.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('');
const opts = (arr, sel, blank) => (blank !== undefined ? `<option value="">${blank}</option>` : '') + arr.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
function fld(id, label, input, cls = '') { return `<div class="field ${cls}"><label for="${id}">${label}</label>${input}</div>`; }
function inp(id, val = '', type = 'text', extra = '') { return `<input id="${id}" name="${id}" type="${type}" value="${esc(val ?? '')}" ${extra}>`; }
function sel(id, arr, val, blank, extra = '') { return `<select id="${id}" name="${id}" ${extra}>${opts(arr, val, blank)}</select>`; }
const v = (root, id) => { const e = root.querySelector('#' + id); if (!e) return undefined; if (e.type === 'checkbox') return e.checked; return e.value; };
const num = (root, id) => Number(v(root, id) || 0);
const dtLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (s) => (s ? new Date(s).toISOString() : null);

function kpi({ label, value, sub = '', color, drill, meter, tone = '' }) {
  const tag = drill ? 'button' : 'div';
  return `<${tag} class="glass kpi ${tone ? 'k-' + tone : ''}" ${drill ? `data-drill="${drill}" type="button"` : ''}>
    <span class="l">${color ? `<i style="background:${color}"></i>` : ''}${label}</span><span class="v">${value}</span>${sub ? `<span class="s">${sub}</span>` : ''}
    ${meter !== undefined ? `<div class="meter ${meter >= 100 ? 'good' : meter >= 70 ? '' : meter >= 40 ? 'warn' : 'bad'}"><i style="width:${clamp(meter, 0, 100)}%"></i></div>` : ''}
    ${drill ? '<span class="drill">See details →</span>' : ''}</${tag}>`;
}
function empty(title, text, action = '') { return `<div class="empty"><b>${title}</b>${text}${action ? `<div style="margin-top:10px">${action}</div>` : ''}</div>`; }

/* ---------- charts (inline SVG, one scale per chart) ---------- */
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
let _gid = 0;
/* a lighter and a deeper tone of one colour, for the liquid gradients */
function shadeHex(hex, f) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return hex; const n = parseInt(m[1], 16); const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f))); return '#' + ch.map((c) => clamp(c, 0, 255).toString(16).padStart(2, '0')).join(''); }
const liquidDef = (id, c) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shadeHex(c, 0.45)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${shadeHex(c, -0.28)}"/></linearGradient>`;
function barChart({ labels, series, height = 220, fmt = inr, stacked = false, target }) {
  const W = 720, H = height, padL = 60, padB = 26, padT = 14, padR = 8;
  const totals = labels.map((_, i) => (stacked ? sum(series, (s) => s.values[i]) : Math.max(...series.map((s) => s.values[i] || 0))));
  const max = niceMax(Math.max(...totals, ...(target ? target : [0]), 1));
  const iw = W - padL - padR, ih = H - padT - padB, bw = iw / labels.length;
  const y = (val) => padT + ih - (val / max) * ih;
  const ids = series.map(() => 'lq' + ++_gid);
  let g = `<defs>${series.map((s, k) => liquidDef(ids[k], s.color)).join('')}<linearGradient id="${ids[0]}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
  for (let k = 0; k <= 4; k++) { const val = (max * k) / 4; g += `<line x1="${padL}" x2="${W - padR}" y1="${y(val)}" y2="${y(val)}" stroke="var(--hair)"/><text x="${padL - 6}" y="${y(val) + 4}" text-anchor="end">${(fmt === inr ? inrShort : fmt)(val)}</text>`; }
  const bar = (x, yy, w, h, k, tip) => (h > 0 ? `<g><rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${Math.min(5, w / 3)}" fill="url(#${ids[k]})"><title>${tip}</title></rect><rect x="${x + w * 0.12}" y="${yy + 1.5}" width="${w * 0.32}" height="${Math.max(0, h - 3)}" rx="${Math.min(4, w / 5)}" fill="url(#${ids[0]}g)" pointer-events="none"/></g>` : '');
  labels.forEach((lab, i) => {
    const x0 = padL + i * bw;
    if (stacked) {
      let acc = 0;
      series.forEach((s, k) => { const val = s.values[i] || 0; if (val > 0) g += bar(x0 + bw * 0.18, y(acc + val), bw * 0.64, Math.max(0, y(acc) - y(acc + val)), k, `${esc(lab)} · ${esc(s.name)}: ${fmt(val)}`); acc += val; });
    } else {
      const n = series.length, w = (bw * 0.7) / n;
      series.forEach((s, k) => { const val = s.values[i] || 0; g += bar(x0 + bw * 0.15 + k * w, y(val), Math.max(1, w - 2), Math.max(0, padT + ih - y(val)), k, `${esc(lab)} · ${esc(s.name)}: ${fmt(val)}`); });
    }
    if (target && target[i]) g += `<line x1="${x0 + bw * 0.08}" x2="${x0 + bw * 0.92}" y1="${y(target[i])}" y2="${y(target[i])}" stroke="var(--ink2)" stroke-width="1.6" stroke-dasharray="5 4"><title>Target ${fmt(target[i])}</title></line>`;
    g += `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:linear-gradient(180deg,${shadeHex(s.color, 0.45)},${s.color} 45%,${shadeHex(s.color, -0.28)})"></i>${esc(s.name)}</span>`).join('')}${target ? '<span><i class="tgt"></i>Target</span>' : ''}</div>`;
  return `<div class="chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
}
function funnelBars(rows, { onclick = 'stage' } = {}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<div class="funnel">${rows.filter((r) => !r.is_lost).map((r) => `<div class="frow ${r.is_won ? 'won' : ''}"><span>${esc(r.key)}</span><button class="bar" style="border:0;padding:0;cursor:pointer" data-${onclick}="${esc(r.funnel)}|${esc(r.key)}" title="Open ${esc(r.key)}"><i style="width:${(r.count / max) * 100}%"></i></button><span class="num" style="text-align:right"><b>${r.count}</b> · ${inr(r.value)}</span></div>`).join('')}</div>`;
}

/* ---------- lead table (used in many places) ---------- */
const LEAD_ROW_CAP = 300;
function leadRows(rows, { showOwner = true, showValue = true, extra } = {}) {
  if (!rows.length) return empty('Nothing here', 'No records match.');
  const more = rows.length > LEAD_ROW_CAP ? `<p class="faint" style="font-size:12.5px;margin:8px 2px 0">Showing the first ${LEAD_ROW_CAP} of ${rows.length.toLocaleString('en-IN')}. Use the Leads & Deals filters to narrow down.</p>` : '';
  rows = rows.slice(0, LEAD_ROW_CAP);
  return `<div class="tablewrap"><table><thead><tr><th>Lead</th><th>Stage</th><th>Score</th>${showOwner ? '<th>Owner</th>' : ''}${showValue ? '<th class="n">Value</th>' : ''}<th>Last contact</th><th>Next follow-up</th>${extra ? `<th>${extra.h}</th>` : ''}</tr></thead><tbody>
  ${rows.map((l) => `<tr class="click" data-lead="${l.id}"><td><div class="t">${esc(L.title(l))}</div><div class="s">${esc(l.ref_id || l.lead_no)} · ${funnelChip(l.funnel)} ${l.is_deal ? '<span class="chip acc">Deal</span>' : ''} ${esc(L.company(l) || l.course || l.sub_category || '')}</div></td><td>${stageChip(l)} ${tempChip(l.temperature)}</td><td>${scoreBadge(l)}</td>
  ${showOwner ? `<td>${esc(L.ownerLabel(l))}</td>` : ''}${showValue ? `<td class="n">${inr(l.value)}</td>` : ''}<td>${l.last_contact_at ? rel(l.last_contact_at) : l.call_attempts ? `${l.call_attempts} call${l.call_attempts === 1 ? '' : 's'}` : '<span class="chip warn">Never</span>'}</td>
  <td>${l.next_followup_at ? `<span class="${new Date(l.next_followup_at) < new Date() && L.open(l) ? 'chip bad' : ''}">${fmtDT(l.next_followup_at)}</span>` : '—'}</td>${extra ? `<td>${extra.f(l)}</td>` : ''}</tr>`).join('')}</tbody></table></div>${more}`;
}
/* ---------- every money figure can show where it comes from ---------- */
const RD = { m: new Map(), n: 0, put(spec) { const k = 'rd' + ++this.n; this.m.set(k, spec); if (this.m.size > 1500) this.m.delete(this.m.keys().next().value); return k; } };
/* a figure that opens its revenue lines and deals: spec = { title, u, r, status } */
const rdNum = (text, spec) => `<button class="lnk rdn" type="button" data-rd="${RD.put(spec)}" title="See where this comes from">${text}</button>`;
function revDrillOpen(spec) {
  if (!spec) return;
  if (spec.html) return drill(esc(spec.title), spec.html);
  const lines = TG.lines(spec.u, spec.r, spec.status).sort((a, c) => String(a.e.month).localeCompare(String(c.e.month)) || c.e.amount - a.e.amount);
  const deals = spec.status === 'Collected' || spec.status === 'Pending PO' ? [] : TG.wonExtra(spec.u, spec.r);
  const tot = sum(lines, (x) => x.w * Number(x.e.amount || 0)) + sum(deals, (x) => x.v);
  const who = (e) => (e.owner ? DB.pname(e.owner) : e.owner_label || '—');
  const html = `<p class="faint" style="margin:0 0 8px">${nfmt(lines.length)} ledger line${lines.length === 1 ? '' : 's'}${deals.length ? ` and ${nfmt(deals.length)} deal${deals.length === 1 ? '' : 's'} won in the CRM` : ''} · total <b>${inrFull(tot)}</b>${spec.u.pid ? ` · for ${esc(DB.pname(spec.u.pid))}: their own lines, plus their share of Academy collections where the line is split` : ''}</p>
    ${lines.length ? `<div class="tablewrap"><table><thead><tr><th>Month</th><th>Process</th><th>Product</th><th>Client</th><th>Owner</th><th>Status</th><th class="n">Line</th>${spec.u.pid ? '<th class="n">Counted</th>' : ''}</tr></thead><tbody>
      ${lines.map(({ e, w }) => `<tr ${e.lead_id ? `class="click" data-lead="${e.lead_id}"` : ''}><td>${e.paid_on ? fmtDate(e.paid_on) : fmtMonth(e.month)}</td><td>${deptChip(e.department)}</td><td>${esc(e.segment)}</td><td>${esc(e.client)}${e.opp_ref ? ` <span class="faint">${esc(e.opp_ref)}</span>` : ''}</td><td>${esc(who(e))}</td><td>${e.status === 'Collected' ? '<span class="chip good">Collected</span>' : '<span class="chip warn">Balance due</span>'}</td><td class="n">${inrFull(e.amount)}</td>${spec.u.pid ? `<td class="n">${w < 1 ? `<span class="faint">${Math.round(w * 1000) / 10}% ·</span> ` : ''}${inrFull(w * e.amount)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''}
    ${deals.length ? `<h4 style="margin:12px 0 4px">Won in the CRM, not in the ledger yet</h4><div class="tablewrap"><table><thead><tr><th>Deal</th><th>Won</th><th>Owner</th><th class="n">Counted</th></tr></thead><tbody>${deals.map(({ l, v }) => `<tr class="click" data-lead="${l.id}"><td>${esc(L.title(l))} ${deptChip(l.funnel)}</td><td>${fmtDate(l.won_at)}</td><td>${esc(L.ownerLabel(l))}</td><td class="n">${inrFull(v)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${!lines.length && !deals.length ? empty('Nothing behind this figure', 'No revenue lines or won deals in this period.') : ''}`;
  drill(esc(spec.title || 'Where this comes from'), html);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-rd]'); if (!b) return; e.preventDefault(); e.stopPropagation(); revDrillOpen(RD.m.get(b.dataset.rd)); }, true);

function bindLeadClicks(root) { root.addEventListener('click', (e) => { const r = e.target.closest('[data-lead]'); if (r && r.dataset.lead && !e.target.closest('input,select,[data-tick],[data-tedit]')) { e.preventDefault(); openLead(r.dataset.lead); } }); }

function drill(title, html) {
  const m = openModal({ title, body: html, width: 1000 });
  bindLeadClicks(m.el);
  return m;
}

/* ---------- navigation (v4 sidebar) ---------- */
const canCEO = () => !hideSales() && (seesAll() || (hasTeam() && !isMember()));
const canRevenue = () => (!isMember() && !hideSales()) || isFinance();
const NAV = [
  ['Workspace', [['connect', 'Garuda Connect', 'ring', () => !hideSales()], ['chat', 'Garuda Chat', 'chat', () => true]]],
  ['Overview', [['command', 'Command Centre', 'dash', canCEO], ['mydash', 'My dashboard', 'me', () => true], ['revenue', 'Revenue', 'rev', canRevenue], ['collections', 'Collections', 'pay', canRevenue], ['sales', 'Sales Dashboard', 'pipe', () => !hideSales()], ['team', 'Team Dashboard', 'team', () => !hideSales() && hasTeam()], ['taskdash', 'Task Dashboard', 'tdash', () => true]]],
  ['Sales', [['leads', 'Leads', 'leads', () => !hideSales()], ['followups', 'Follow-ups', 'clock', () => !hideSales()], ['deals', 'Deals', 'deal', () => !hideSales()], ['visits', 'Field Visits', 'pin', () => true], ['accounts', 'Accounts', 'inst', () => !hideSales()], ['automations', 'Automations', 'spark', () => !hideSales() && !isMember()]]],
  ['Marketing', [['email', 'Email Marketing', 'mkt', () => canEmail()], ['ads', 'Ad Campaigns', 'ads', () => canCampaigns()], ['campaigns', 'Other Campaigns', 'web', () => canCampaigns()]]],
  ['Execution', [['tasks', 'Tasks', 'task', () => true], ['projects', 'Project Management', 'proj', () => true], ['escalations', 'Escalations', 'warn', () => true]]],
];
/* Price Book and Settings live in the menu under the user's name */
const USER_MENU = [['pricebook', 'Price Book', 'price', () => (!isMember() && !hideSales()) || canPricebook()], ['settings', 'Settings', 'set', () => isHead()]];
const homeView = () => (canCEO() ? 'command' : 'mydash');
/* old screen addresses land on their new home */
const MOVED = { me: 'mydash', targets: 'revenue', dashboard: 'team', ownership: 'team', performance: 'team', pipeline: 'leads', telecalling: 'leads', insights: 'command', webinars: 'campaigns', complaints: 'escalations', institutions: 'accounts' };
const navLabel = (i) => (typeof i[1] === 'function' ? i[1]() : i[1]);
function navItems() { return NAV.map(([g, items]) => [g, items.filter((i) => i[3]())]).filter(([, i]) => i.length); }
const menuItems = () => USER_MENU.filter((i) => i[3]());
const ESC_OPEN = ['Open', 'In progress', 'Escalated up'];
function badgeFor(k) {
  if (k === 'escalations') return DB.t.complaints.filter((c) => ESC_OPEN.includes(c.status)).length || '';
  if (k === 'settings' && isHead()) return DB.t.profiles.filter((p) => p.active && !p.auth_id).length || '';
  if (k === 'chat') return typeof chatUnread === 'function' ? chatUnread() || '' : '';
  if (k === 'tasks') return DB.t.work_tasks.filter((t) => t.owner === DB.me?.id && taskOpen(t) && t.due_date && t.due_date < todayStr()).length || '';
  if (k === 'revenue' && isFinance()) return DB.t.payments.filter((p) => p.status === 'Claimed').length || '';
  return '';
}
function go(view, arg) { location.hash = view + (arg ? '/' + arg : ''); }

/* ---------- the shared filter bar: Department · Period · Person (remembered per person) ---------- */
/* Team → process (department) → product; one team today, more later */
const TEAMS = () => [...new Set(DEPTS().map((d) => d.team || 'RPTO Team'))];
function deptSelect() {
  const ts = TEAMS();
  const all = ts.length === 1 ? `${ts[0]} · all processes` : 'All teams';
  const groups = ts.map((t) => { const o = DEPTS().filter((d) => (d.team || 'RPTO Team') === t).map((d) => `<option value="${esc(d.code)}" ${ST.dept === d.code ? 'selected' : ''}>${esc(d.name)}</option>`).join(''); return ts.length === 1 ? o : `<optgroup label="${esc(t)}">${o}</optgroup>`; }).join('');
  return `<label class="dsel" style="--dc:${esc(ST.dept === 'All' ? 'var(--accent)' : deptColor(ST.dept))}"><i class="ddot"></i><span class="sr">Team and process</span><select id="pdept" aria-label="Team and process"><option value="All" ${ST.dept === 'All' ? 'selected' : ''}>${esc(all)}</option>${groups}</select></label>`;
}
/* the products / courses of the chosen process */
const prodList = (code) => [...new Set([...(dept(code).courses || []), ...visibleLeads().filter((l) => l.funnel === code).map(L.line)].filter((x) => x && x !== 'Not Specified'))].sort();
function prodSelect() { const ps = prodList(ST.dept); if (!ps.length) return ''; return `<select id="pprod" aria-label="Product">${opts(ps, ST.prod || '', 'All products')}</select>`; }
function filterBar({ person = true, dept = true, period = true, extra = '' } = {}) {
  const ps = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['fy', 'FY'], ['custom', 'Custom']];
  return `<div class="filters fbar" id="fbar">
    ${dept ? deptSelect() : ''}${dept && ST.dept !== 'All' ? prodSelect() : ''}
    ${period ? `<div class="seg" role="group" aria-label="Period">${ps.map(([k, t]) => `<button data-period="${k}" aria-pressed="${ST.period === k}">${t}</button>`).join('')}</div>
    ${ST.period === 'custom' ? `<input type="date" id="cfrom" value="${ST.cfrom}" aria-label="From"><input type="date" id="cto" value="${ST.cto}" aria-label="To">` : ''}` : ''}
    ${person && hasTeam() ? `<select id="pperson" aria-label="Person">${personOpts(ST.person, scopePeople().filter((p) => inDept(p, ST.dept) || p.id === ST.person))}</select>` : ''}${extra}
    ${period ? `<span class="faint rlabel">${curRange().label}</span>` : ''}</div>`;
}
function bindFilters(root, rerender) {
  root.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => { ST.period = b.dataset.period; if (ST.period === 'custom' && !ST.cfrom) { ST.cfrom = localDate(new Date(Date.now() - 30 * 864e5)); ST.cto = todayStr(); } saveUI(); rerender(); }));
  const pd = root.querySelector('#pdept'); if (pd) pd.onchange = () => { ST.dept = pd.value; ST.prod = ''; saveUI(); rerender(); };
  const pr = root.querySelector('#pprod'); if (pr) pr.onchange = () => { ST.prod = pr.value; saveUI(); rerender(); };
  const pp = root.querySelector('#pperson'); if (pp) pp.onchange = () => { ST.person = pp.value; saveUI(); rerender(); };
  ['cfrom', 'cto'].forEach((id) => { const e = root.querySelector('#' + id); if (e) e.onchange = () => { ST[id] = e.value; saveUI(); rerender(); }; });
}

/* ---------- CSV export (works on the hosted app; artifact previews block downloads) ---------- */
/* CSV or tab-separated text → rows of cells (quotes and line breaks inside quotes handled) */
function parseCSV(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim()));
}
function downloadCSV(name, rows) {
  if (!rows.length) return toast('Nothing to export', true);
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  if (!canExport()) return toast('Exporting needs the Export data permission. Ask an Admin.', true);
  if (DB.mode === 'demo') { navigator.clipboard?.writeText(csv).then(() => toast('Copied as CSV (the hosted CRM downloads a file)'), () => toast('Export works in the hosted CRM', true)); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
}


/* ---------- dropdowns for free-text fields: the known values, plus "Other…" to type a new one ---------- */
function pickSel(id, list, value, blank = '—') {
  const vals = [...new Set([...(list || []).filter(Boolean), ...(value ? [value] : [])])];
  return `<select id="${id}" name="${id}" data-other>${blank !== null ? `<option value="">${esc(blank)}</option>` : ''}${vals.map((x) => `<option ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('')}<option value="__other">Other… (type a new one)</option></select>`;
}
/* the values already used on records, most used first */
function usedValues(field, rows = DB.t.leads, limit = 300) {
  const c = new Map(); (rows || []).forEach((r) => { const x = String(r[field] || '').trim(); if (x) c.set(x, (c.get(x) || 0) + 1); });
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k).sort((a, b) => a.localeCompare(b));
}
document.addEventListener('change', (e) => {
  const s = e.target; if (s.tagName !== 'SELECT' || !s.hasAttribute('data-other') || s.value !== '__other') return;
  const i = document.createElement('input'); i.id = s.id; i.name = s.name; i.placeholder = 'Type the new value'; i.className = s.className;
  s.replaceWith(i); i.focus();
});

/* ---------- Indian digit grouping (1,23,45,678) everywhere, also while typing ---------- */
const NUM_PROTO = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
function groupIN(raw) {
  let s = String(raw ?? '').replace(/,/g, '').trim(); if (s === '' || s === '-') return s;
  const neg = s.startsWith('-'); if (neg) s = s.slice(1);
  const [i, d] = s.split('.'); const ip = i.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const g = ip.length > 3 ? ip.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + ip.slice(-3) : ip;
  return (neg ? '-' : '') + g + (d !== undefined ? '.' + d.replace(/\D/g, '') : '');
}
/* number inputs become text inputs that show commas; reading .value still gives the plain number */
function numberize(el) {
  if (el.__num || el.dataset.raw !== undefined) return; el.__num = true;
  const step = el.getAttribute('step'); el.type = 'text'; el.inputMode = step && step !== '1' && step !== 'any' ? 'decimal' : step === 'any' ? 'decimal' : 'numeric';
  if (!el.inputMode || el.inputMode === 'numeric') el.inputMode = 'decimal';
  el.dataset.num = '';
  Object.defineProperty(el, 'value', { configurable: true, get() { return NUM_PROTO.get.call(this).replace(/,/g, ''); }, set(x) { NUM_PROTO.set.call(this, groupIN(x)); } });
  NUM_PROTO.set.call(el, groupIN(NUM_PROTO.get.call(el)));
  el.addEventListener('input', () => {
    const shown = NUM_PROTO.get.call(el); const pos = el.selectionStart ?? shown.length;
    const digitsBefore = shown.slice(0, pos).replace(/[^\d.-]/g, '').length;
    const next = groupIN(shown.replace(/[^\d.,-]/g, '')); if (next === shown) return;
    NUM_PROTO.set.call(el, next);
    let n = 0, p = 0; while (p < next.length && n < digitsBefore) { if (/[\d.-]/.test(next[p])) n++; p++; }
    try { el.setSelectionRange(p, p); } catch (_) { /* not focusable */ }
  }, true);
}
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.matches?.('input[type=number]')) numberize(n); n.querySelectorAll?.('input[type=number]').forEach(numberize); } })
  .observe(document.documentElement, { childList: true, subtree: true });
