/* Garuda CRM · boot, sign-in, shell, router */
'use strict';

function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('garuda-crm-theme', t || ''); } catch (_) { /* ignore */ }
}
try { const t = localStorage.getItem('garuda-crm-theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* ignore */ }

/* company name, tagline and logo come from Settings → Company; the last ones seen are kept on this device for the sign-in screen */
function brandInfo() {
  const c = DB.settings?.company;
  if (c) { try { localStorage.setItem('garuda-brand', JSON.stringify(c)); } catch (_) { /* private mode */ } return c; }
  try { return JSON.parse(localStorage.getItem('garuda-brand') || 'null') || {}; } catch (_) { return {}; }
}
const safeLogo = (x) => (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(x || '') ? x : '');
function brandHTML() {
  const c = brandInfo(); const name = c.name || 'Garuda CRM'; const logo = safeLogo(c.logo);
  return `<div class="brand"><div class="mark ${logo ? 'has-logo' : ''}">${logo ? `<img src="${logo}" alt="">` : esc((name.trim()[0] || 'G').toUpperCase())}</div><div><b>${esc(name)}</b><span>${esc(c.tagline || 'Garuda Aerospace · sales & delivery')}</span></div></div>`;
}
const NOT_LISTED = "Your email isn't registered in Garuda CRM. Ask your Admin to add you.";
/* Supabase's messages, in plain words */
function authMsg(m) {
  m = String(m || '');
  if (/registered|database error|saving new user|signups not allowed|not allowed for this instance/i.test(m)) return NOT_LISTED;
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match. Try again, or use “Forgot password?”.';
  if (/email not confirmed/i.test(m)) return 'Open the email we sent you first, then sign in.';
  if (/banned|blocked/i.test(m)) return 'Your sign-in is switched off. Ask your Admin.';
  if (/after \d+ seconds|security purposes/i.test(m)) return 'Please wait a minute before asking for another email.';
  if (/rate limit/i.test(m)) return 'Too many emails were sent just now. Try again in a while, or ask your Admin.';
  if (/expired|invalid.*(link|token)|otp/i.test(m)) return 'That link has expired or was already used. Ask for a new one below.';
  if (/same.*password|different from the old/i.test(m)) return 'Choose a password you have not used here before.';
  if (/weak|at least/i.test(m)) return 'Choose a longer password with letters and numbers.';
  return m;
}
function urlAuthError() { const q = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1)); const e = q.get('error_description') || q.get('error'); if (e) history.replaceState(null, '', location.pathname); return e ? authMsg(e.replace(/\+/g, ' ')) : ''; }
const eyeBtn = (id) => `<button type="button" class="eye" data-eye="${id}" aria-label="Show password" aria-pressed="false">${svg('eye')}</button>`;
function bindEyes(root) { root.querySelectorAll('[data-eye]').forEach((b) => (b.onclick = () => { const i = root.querySelector('#' + b.dataset.eye); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); })); }
const keepSignedIn = () => { try { return localStorage.getItem('garuda-keep') !== '0'; } catch (_) { return true; } };
const backTo = () => location.origin + location.pathname;

/* ---------- sign in: work email + password; a sign-in link or Google as the other ways in ---------- */
function renderLogin(msg = '', view = 'password', email = '') {
  const cfg = window.GARUDA_CONFIG || {};
  const card = (inner) => `<div class="glass auth signin">${brandHTML()}${inner}<p class="faint auth-foot">Only people your Admin has added can sign in. New here? You will get an email to set your password.</p></div>`;
  const emailField = `<div class="field"><label for="le">Work email</label><input id="le" type="email" autocomplete="username" inputmode="email" placeholder="name@garudaaerospace.com" value="${esc(email)}" required></div>`;
  const note = `<p class="auth-msg" id="lmsg" role="status" aria-live="polite">${esc(msg)}</p>`;
  if (view === 'forgot') {
    $('#root').innerHTML = card(`<h1>Reset your password</h1><p class="muted">We will email you a link to choose a new password. It works for one hour.</p>
      <form id="lform" class="auth-form" novalidate>${emailField}<button class="btn primary" id="lgo">Email me a reset link</button></form>${note}
      <button class="lnk" id="lback">${svg('chevl')} Back to sign in</button>`);
  } else if (view === 'link') {
    $('#root').innerHTML = card(`<h1>Sign in with an email link</h1><p class="muted">No password needed this time. We email you a link that signs you in.</p>
      <form id="lform" class="auth-form" novalidate>${emailField}<button class="btn primary" id="lgo">Email me a sign-in link</button></form>${note}
      <button class="lnk" id="lback">${svg('chevl')} Back to sign in</button>`);
  } else {
    $('#root').innerHTML = card(`<h1>Sign in</h1><p class="muted">Welcome back. Use your Garuda work email.</p>
      <form id="lform" class="auth-form" novalidate>${emailField}
        <div class="field"><div class="row between"><label for="lp">Password</label><button type="button" class="lnk small" id="lforgot">Forgot password?</button></div>
          <div class="pwbox"><input id="lp" type="password" autocomplete="current-password" required>${eyeBtn('lp')}</div></div>
        <label class="check"><input type="checkbox" id="lkeep" ${keepSignedIn() ? 'checked' : ''}> Keep me signed in on this device</label>
        <button class="btn primary" id="lgo">Sign in</button></form>${note}
      <div class="auth-or"><span>or</span></div>
      <button class="btn" id="llink">${svg('mail')} Email me a sign-in link</button>
      ${cfg.googleSignIn ? `<button class="btn" id="lgoogle">${svg('web')} Continue with Google</button>` : ''}`);
  }
  bindEyes($('#root'));
  const say = (t, bad) => { const m = $('#lmsg'); m.textContent = t; m.classList.toggle('bad', !!bad); };
  const em = () => $('#le').value.trim().toLowerCase();
  $('#lback')?.addEventListener('click', () => renderLogin('', 'password', em()));
  $('#lforgot')?.addEventListener('click', () => renderLogin('', 'forgot', em()));
  $('#llink')?.addEventListener('click', () => renderLogin('', 'link', em()));
  $('#lgoogle')?.addEventListener('click', () => DB.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: backTo() } }));
  $('#lform').onsubmit = async (e) => {
    e.preventDefault();
    const email = em(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say('Enter your work email.', true);
    const go = $('#lgo'); go.disabled = true; go.classList.add('busy');
    try {
      if (view === 'forgot') {
        const { error } = await DB.sb.auth.resetPasswordForEmail(email, { redirectTo: backTo() + '?reset=1' }); if (error) throw error;
        say(`If ${email} is registered, a reset link is on its way. Check your inbox and spam.`);
      } else if (view === 'link') {
        const { error } = await DB.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: backTo(), shouldCreateUser: true } }); if (error) throw error;
        say(`If ${email} is registered, a sign-in link is on its way. Check your inbox and spam.`);
      } else {
        const pw = $('#lp').value; if (!pw) throw new Error('Enter your password.');
        const keep = $('#lkeep').checked;
        try { localStorage.setItem('garuda-keep', keep ? '1' : '0'); } catch (_) { /* private mode */ }
        if (keep !== DB.keep) DB.makeClient(keep);
        const { error } = await DB.sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error;
        say('Signing you in…');
      }
    } catch (err) { say(authMsg(err.message), true); } finally { go.disabled = false; go.classList.remove('busy'); }
  };
  setTimeout(() => (email ? $('#lp') || $('#le') : $('#le'))?.focus(), 50);
}
/* signed in with Supabase, but not (or no longer) in the people directory */
function renderNotListed() {
  $('#root').innerHTML = `<div class="glass auth">${brandHTML()}<h1>No access</h1><p class="muted">${NOT_LISTED}</p><p class="faint" style="font-size:12.5px">Signed in as ${esc(DB.session.user.email)}.</p><button class="btn primary" id="lo">Sign out</button></div>`;
  $('#lo').onclick = () => DB.sb.auth.signOut();
}

/* ---------- passwords: the rules, the first password after an invite, a reset, and a change ---------- */
function pwChecks(pw, email = '') {
  const local = String(email).split('@')[0].toLowerCase();
  return [
    [pw.length >= 8, 'At least 8 characters'],
    [/[A-Za-z]/.test(pw) && /\d/.test(pw), 'Letters and numbers'],
    [!!pw && !/^(password|garuda|qwerty|12345|admin|welcome)/i.test(pw) && (!local || !pw.toLowerCase().includes(local)), 'Not a common word or your email'],
  ];
}
function pwMeter(root, inputId, email) {
  const i = root.querySelector('#' + inputId); const box = root.querySelector('[data-meter]');
  const draw = () => { const c = pwChecks(i.value, email); const n = c.filter((x) => x[0]).length + (i.value.length >= 12 ? 1 : 0);
    box.innerHTML = `<span class="pwbar s${Math.min(n, 4)}"><i></i></span><ul class="pwrules">${c.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${svg(ok ? 'check' : 'dot')} ${t}</li>`).join('')}</ul>`; };
  i.addEventListener('input', draw); draw();
}
const pwOk = (pw, email) => pwChecks(pw, email).every((x) => x[0]);
/* after an invite or email link (no password yet), or a reset link: choose a password before going in */
function renderSetPassword(kind) {
  const email = DB.session?.user?.email || ''; const first = (DB.me?.full_name || '').split(' ')[0];
  $('#root').innerHTML = `<div class="glass auth signin">${brandHTML()}
    <h1>${kind === 'reset' ? 'Choose a new password' : `Welcome${first ? ', ' + esc(first) : ''}`}</h1>
    <p class="muted">${kind === 'reset' ? 'Set a new password for' : 'Create your password. From now on you sign in with'} <b>${esc(email)}</b>${kind === 'reset' ? '.' : ' and this password.'}</p>
    <form id="pform" class="auth-form" novalidate>
      <div class="field"><label for="np1">New password</label><div class="pwbox"><input id="np1" type="password" autocomplete="new-password" required>${eyeBtn('np1')}</div></div>
      <div data-meter></div>
      <div class="field"><label for="np2">Type it again</label><div class="pwbox"><input id="np2" type="password" autocomplete="new-password" required>${eyeBtn('np2')}</div></div>
      <button class="btn primary" id="pgo">${kind === 'reset' ? 'Save and sign in' : 'Save and continue'}</button></form>
    <p class="auth-msg" id="pmsg" role="status" aria-live="polite"></p>
    <button class="lnk" id="pout">Not you? Sign out</button></div>`;
  bindEyes($('#root')); pwMeter($('#root'), 'np1', email);
  $('#pout').onclick = () => { try { sessionStorage.removeItem('garuda-auth-link'); } catch (_) { /* ignore */ } DB.sb.auth.signOut(); };
  $('#pform').onsubmit = async (e) => {
    e.preventDefault(); const a = $('#np1').value, b = $('#np2').value; const msg = $('#pmsg'); msg.classList.add('bad');
    if (!pwOk(a, email)) return (msg.textContent = 'The password needs every tick above.');
    if (a !== b) return (msg.textContent = 'The two passwords do not match.');
    $('#pgo').disabled = true;
    const { error } = await DB.sb.auth.updateUser({ password: a, data: { pw_set: true } });
    $('#pgo').disabled = false;
    if (error) return (msg.textContent = authMsg(error.message));
    try { sessionStorage.removeItem('garuda-auth-link'); } catch (_) { /* ignore */ }
    msg.classList.remove('bad'); msg.textContent = 'Password saved. Opening the CRM…';
    history.replaceState(null, '', location.pathname); setTimeout(() => location.reload(), 600);
  };
  setTimeout(() => $('#np1')?.focus(), 50);
}
/* does this person still have to choose a password? 'reset' (came from a reset link), 'first' (no password yet) or '' */
async function passwordStep() {
  const prov = DB.session?.user?.app_metadata?.provider; if (prov && prov !== 'email') return '';
  /* signed in with a password: they know it, so never force a new one (and forget any old reset flag) */
  let amr = []; try { amr = JSON.parse(atob(DB.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).amr || []; } catch (_) { /* ignore */ }
  if (amr.some((x) => x.method === 'password')) {
    try { sessionStorage.removeItem('garuda-auth-link'); } catch (_) { /* ignore */ }
    if (!DB.session.user.user_metadata?.pw_set) DB.sb.auth.updateUser({ data: { pw_set: true } }).catch(() => {});
    return '';
  }
  /* opened a "Reset password" email: choose a new password (only for reset emails, never for sign-in links) */
  let link = ''; try { link = sessionStorage.getItem('garuda-auth-link') || ''; } catch (_) { /* ignore */ }
  if (link === 'recovery') return 'reset';
  try { const { data, error } = await DB.sb.rpc('i_have_password'); if (error) return ''; return data === false ? 'first' : ''; } catch (_) { return ''; }
}
/* the menu's Change password: the current one is checked first */
async function setPasswordModal() {
  const email = DB.session?.user?.email || DB.me.email; const has = (await passwordStep()) !== 'first';
  const m = openModal({ title: has ? 'Change password' : 'Create a password', width: 480,
    body: `<form class="form" id="cpf" onsubmit="return false">${has ? fld('pw0', 'Current password', `<div class="pwbox"><input id="pw0" type="password" autocomplete="current-password">${eyeBtn('pw0')}</div>`, 'full') : ''}
      ${fld('pw1', 'New password', `<div class="pwbox"><input id="pw1" type="password" autocomplete="new-password">${eyeBtn('pw1')}</div>`, 'full')}<div class="full" data-meter></div>
      ${fld('pw2', 'Type it again', `<div class="pwbox"><input id="pw2" type="password" autocomplete="new-password">${eyeBtn('pw2')}</div>`, 'full')}</form>
      <p class="faint" style="font-size:12px;margin:8px 0 0">Forgot the current one? Sign out and use “Forgot password?” on the sign-in screen.</p>`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" id="pwgo">Save password</button>' });
  bindEyes(m.el); pwMeter(m.el, 'pw1', email);
  m.el.querySelector('#pwgo').onclick = () => guard(async () => {
    const a = v(m.el, 'pw1'), b = v(m.el, 'pw2');
    if (!pwOk(a, email)) throw new Error('The new password needs every tick.');
    if (a !== b) throw new Error('The two new passwords do not match.');
    if (has) { const { error } = await DB.sb.auth.signInWithPassword({ email, password: v(m.el, 'pw0') }); if (error) throw new Error(/invalid/i.test(error.message) ? 'The current password is not right.' : authMsg(error.message)); }
    const { error } = await DB.sb.auth.updateUser({ password: a, data: { pw_set: true } });
    if (error) throw new Error(authMsg(error.message));
    m.close();
  }, 'Password saved');
}

/* ---------- phone tab bar: four sections this person uses most, plus More for everything else ---------- */
function tabItems(allowed) {
  const pick = [[homeView(), 'Home'], ['leads', 'Leads'], ['chat', 'Chat'], ['visits', 'Visits'], ['mydash', 'Me'], ['projects', 'Projects'], ['escalations', 'Issues'], ['sales', 'Sales'], ['revenue', 'Revenue']];
  const icon = Object.fromEntries(navItems().flatMap(([, i]) => i).map((x) => [x[0], x[2]]));
  return pick.filter((x, i) => allowed.includes(x[0]) && pick.findIndex((y) => y[0] === x[0]) === i).slice(0, 4).map((x) => [x[0], x[1], icon[x[0]] || 'dash']);
}

/* ---------- shell ---------- */
/* ---------- glass light / dark switch: a bubble that slides over a pill ---------- */
const isDark = () => { const cur = document.documentElement.dataset.theme; return cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
function themeSwitch(id, mini = false) {
  const d = isDark();
  return `<button class="tswitch ${d ? 'on' : ''} ${mini ? 'mini' : ''}" id="${id}" role="switch" aria-checked="${d}" aria-label="Dark mode" title="${d ? 'Switch to light' : 'Switch to dark'}">
    <span class="tw-l">${d ? 'Dark' : 'Light'}</span><span class="tw-k">${svg(d ? 'moon' : 'sun')}</span></button>`;
}
function bindTheme(root) {
  $$('.tswitch', root).forEach((b) => (b.onclick = () => { b.classList.toggle('on'); setTimeout(() => { setTheme(isDark() ? 'light' : 'dark'); renderShell(); }, 260); }));
}
let sbMini = (() => { try { return localStorage.getItem('garuda-sb-mini') === '1'; } catch (_) { return false; } })();
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
/* ---------- search pages (⌘K / Ctrl K): screens and records in one box ---------- */
function searchPages() {
  const pages = [...navItems().flatMap(([g, it]) => it.map((x) => ({ k: x[0], t: navLabel(x), g, ic: x[2] }))), ...menuItems().map((x) => ({ k: x[0], t: x[1], g: 'Account', ic: x[2] }))];
  const m = openModal({ title: 'Search pages', width: 560, body: `<input id="qp" placeholder="Type a screen, a lead, a deal or an account" autocomplete="off"><div class="qres" id="qres"></div>` });
  const q = m.el.querySelector('#qp'); const out = m.el.querySelector('#qres');
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const pg = pages.filter((p) => !s || p.t.toLowerCase().includes(s) || p.g.toLowerCase().includes(s));
    const ls = s.length > 1 && !hideSales() ? visibleLeads().filter((l) => (l.name || '').toLowerCase().includes(s) || L.company(l).toLowerCase().includes(s) || (l.phone || '').includes(s) || (l.ref_id || '').toLowerCase() === s).slice(0, 6) : [];
    out.innerHTML = `${pg.map((p) => `<button class="qi" data-qv="${p.k}">${svg(p.ic)}<span>${esc(p.t)}</span><span class="faint">${esc(p.g)}</span></button>`).join('')}
      ${ls.map((l) => `<button class="qi" data-ql="${l.id}">${svg('leads')}<span>${esc(l.name)}</span><span class="faint">${l.is_deal ? 'Deal' : 'Lead'} · ${esc(l.funnel)}</span></button>`).join('')}` || '<p class="faint">Nothing found.</p>';
    out.querySelectorAll('[data-qv]').forEach((b) => (b.onclick = () => { m.close(); go(b.dataset.qv); }));
    out.querySelectorAll('[data-ql]').forEach((b) => (b.onclick = () => { m.close(); openLead(b.dataset.ql); }));
  };
  q.oninput = draw; q.onkeydown = (e) => { if (e.key === 'Enter') out.querySelector('.qi')?.click(); }; draw(); setTimeout(() => q.focus(), 30);
}
document.addEventListener('click', () => { const mm = document.getElementById('sbmenu'); if (mm) mm.hidden = true; });
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && DB.me) { e.preventDefault(); if (!$('.modal')) searchPages(); } });

function renderShell() {
  const items = navItems();
  const allowed = [...items.flatMap(([, i]) => i.map((x) => x[0])), ...menuItems().map((x) => x[0])];
  if (!allowed.includes(ST.view)) ST.view = allowed.includes(homeView()) ? homeView() : allowed[0];
  const setBadge = badgeFor('settings');
  const V = VIEWS[ST.view];
  const navBtn = (x) => { const [k, , ic] = x; const t = navLabel(x); const bd = badgeFor(k); return `<button data-v="${k}" data-tip="${esc(t)}" ${ST.view === k ? 'aria-current="page"' : ''}>${svg(ic)}<span class="lbl">${t}</span>${bd ? `<span class="badge ${k === 'escalations' ? 'alarm' : ''}">${bd}</span>` : ''}</button>`; };
  $('#root').innerHTML = `<div class="app ${sbMini ? 'sb-mini' : ''}">
    <aside class="side sbar glass" aria-label="Main navigation">
      <div class="sb-top">${brandHTML()}<button class="sb-col" id="sbcol" aria-label="${sbMini ? 'Expand menu' : 'Collapse menu'}" title="${sbMini ? 'Expand' : 'Collapse'}">${svg(sbMini ? 'chevr' : 'chevl')}</button></div>
      <button class="sb-search" id="sbsearch" data-tip="Search">${svg('search')}<span class="lbl">Search pages</span><kbd>⌘K</kbd></button>
      <nav class="nav"><span class="glider" aria-hidden="true"></span>${items.map(([g, it]) => `<div class="grp"><span class="lbl">${g}</span></div>${it.map((x) => navBtn(x)).join('')}`).join('')}</nav>
      <div class="sb-foot">
        <div class="sb-theme" data-tip="${isDark() ? 'Dark mode' : 'Light mode'}">${svg(isDark() ? 'moon' : 'sun')}<span class="lbl">Night mode</span>${themeSwitch('thm', sbMini)}</div>
        <button class="sb-user" id="sbuser" aria-haspopup="menu"><span class="av">${esc(initials(DB.me.full_name))}<i></i>${setBadge ? `<b class="avb">${setBadge}</b>` : ''}</span><span class="lbl"><b>${esc(DB.me.full_name)}</b><span class="faint">${esc(DB.me.designation || ROLES[DB.me.role] || '')}</span></span>${svg('updown')}</button>
        <div class="sb-menu glass" id="sbmenu" hidden><div class="faint" style="font-size:11.5px;padding:4px 8px">${esc(DB.me.email)}</div>${menuItems().map((x) => `<button data-v="${x[0]}" ${ST.view === x[0] ? 'aria-current="page"' : ''}>${svg(x[2])} ${x[1]}${x[0] === 'settings' && setBadge ? ` <span class="badge">${setBadge}</span>` : ''}</button>`).join('')}${menuItems().length ? '<hr>' : ''}<button id="setpw">${svg('lock')} Change password</button><button id="signout">${svg('out')} Sign out</button><button id="signoutall">${svg('lock')} Sign out everywhere</button></div>
      </div>
    </aside>
    <main class="main">
      <div class="mhead glass">${brandHTML()}<span class="row">${themeSwitch('thm2', true)}<button class="btn small" id="mmenu" aria-label="Open menu" aria-expanded="false">${svg('menu')}<span>Menu</span></button></span></div>
      <header class="glass topbar"><div class="grow"><h1>${typeof V.title === 'function' ? V.title() : V.title}</h1><div class="sub">${(typeof V.sub === 'function' ? V.sub() : V.sub) || ''}</div></div><div class="row" id="vactions">${V.actions ? V.actions() : ''}</div>${bellHTML()}</header>
      <div class="view" id="view"></div>
    </main>
    <div class="side-scrim" id="sscrim"></div>
    <nav class="tabbar glass" aria-label="Quick sections">${tabItems(allowed).map((x) => `<button data-v="${x[0]}" ${ST.view === x[0] ? 'aria-current="page"' : ''}>${svg(x[2])}<span>${esc(x[1])}</span></button>`).join('')}<button id="tmore" aria-label="All sections">${svg('menu')}<span>More</span></button></nav></div>`;
  $$('[data-v]').forEach((b) => (b.onclick = () => { document.body.classList.remove('menu-open'); go(b.dataset.v); }));
  const menu = (on) => { document.body.classList.toggle('menu-open', on); $('#mmenu')?.setAttribute('aria-expanded', String(on)); };
  $('#mmenu')?.addEventListener('click', () => menu(!document.body.classList.contains('menu-open')));
  $('#tmore')?.addEventListener('click', () => menu(!document.body.classList.contains('menu-open')));
  $('#sscrim')?.addEventListener('click', () => menu(false));
  $('#sbcol').onclick = () => { sbMini = !sbMini; try { localStorage.setItem('garuda-sb-mini', sbMini ? '1' : '0'); } catch (_) { /* ignore */ } renderShell(); };
  $('#sbsearch').onclick = () => { menu(false); searchPages(); };
  $('#sbuser').onclick = (e) => { e.stopPropagation(); const mm = $('#sbmenu'); mm.hidden = !mm.hidden; };
  bindTheme(document);
  $('#signout')?.addEventListener('click', () => DB.sb.auth.signOut());
  $('#signoutall')?.addEventListener('click', async () => { if (await confirmBox('Sign out on every phone and computer where you are signed in?', 'Sign out everywhere')) DB.sb.auth.signOut({ scope: 'global' }); });
  $('#setpw')?.addEventListener('click', setPasswordModal);
  bindBell();
  renderView();
  V.mount?.();
  shellKey = shellSig();
  placeGlider(false);
}
/* ---------- moving between screens: the shell stays, the glass pill glides to the new item and the page eases in ---------- */
let shellKey = '', viewTimer = null;
const shellSig = () => [sbMini, DB.me?.id, isDark(), navItems().map(([, i]) => i.map((x) => x[0]).join()).join('|'), menuItems().map((x) => x[0]).join()].join('#');
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function placeGlider(animate) {
  const nav = $('.sbar .nav'); const g = nav?.querySelector('.glider'); if (!g) return;
  const b = nav.querySelector('button[aria-current="page"]');
  if (!b) { g.style.opacity = '0'; return; }
  g.classList.toggle('still', !animate || calm());
  g.style.opacity = '1'; g.style.transform = `translateY(${b.offsetTop}px)`; g.style.height = b.offsetHeight + 'px'; g.style.width = b.offsetWidth + 'px'; g.style.left = b.offsetLeft + 'px';
  if (animate && !calm()) { g.classList.remove('squish'); void g.offsetWidth; g.classList.add('squish'); }
}
function switchView() {
  const allowed = [...navItems().flatMap(([, i]) => i.map((x) => x[0])), ...menuItems().map((x) => x[0])];
  if (!allowed.includes(ST.view)) ST.view = allowed.includes(homeView()) ? homeView() : allowed[0];
  const V = VIEWS[ST.view];
  $$('[data-v]').forEach((b) => { if (b.dataset.v === ST.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const mm = $('#sbmenu'); if (mm) mm.hidden = true; document.body.classList.remove('menu-open');
  placeGlider(true);
  const tb = $('.topbar .grow');
  const swapHead = () => {
    tb.innerHTML = `<h1>${typeof V.title === 'function' ? V.title() : V.title}</h1><div class="sub">${(typeof V.sub === 'function' ? V.sub() : V.sub) || ''}</div>`;
    $('#vactions').innerHTML = V.actions ? V.actions() : '';
  };
  const el = $('#view');
  clearTimeout(viewTimer);
  if (calm()) { swapHead(); renderView(); V.mount?.(); return; }
  el.classList.remove('v-in'); tb.classList.remove('t-in'); el.classList.add('v-out'); tb.classList.add('t-out');
  viewTimer = setTimeout(() => {
    swapHead(); el.classList.remove('v-out'); tb.classList.remove('t-out');
    renderView(); V.mount?.();
    window.scrollTo({ top: 0, behavior: 'auto' }); $('.main')?.scrollTo?.({ top: 0 });
    void el.offsetWidth; el.classList.add('v-in'); tb.classList.add('t-in');
    viewTimer = setTimeout(() => { el.classList.remove('v-in'); tb.classList.remove('t-in'); }, 1100);
  }, 150);
}
window.addEventListener('resize', () => placeGlider(false));
function renderView() {
  const el = $('#view'); if (!el) return;
  try { VIEWS[ST.view].render(el); } catch (e) { console.error(e); el.innerHTML = `<div class="glass panel note">Something went wrong showing this page: ${esc(e.message)}</div>`; }
}
/* re-render the current page (used after saves and live updates) */
let stale = false;
function render() {
  const a = document.activeElement;
  if ($('.modal') || (a && $('#view')?.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox')) { stale = true; return; }
  stale = false;
  $$('.nav [data-v]').forEach((b) => { const k = b.dataset.v; const n = badgeFor(k); let s = b.querySelector('.badge'); if (n) { if (!s) { s = document.createElement('span'); s.className = 'badge'; b.appendChild(s); } s.textContent = n; } else s?.remove(); });
  refreshBell();
  renderView();
}
document.addEventListener('click', () => { if (stale) setTimeout(() => { if (!$('.modal')) render(); }, 50); });

function route() {
  let [v, arg] = location.hash.slice(1).split('/');
  if (MOVED[v]) v = MOVED[v];
  if (v && VIEWS[v]) { ST.view = v; ST.arg = arg || null; }
  closeDrawer(); $$('#layer .modal, #layer .scrim').forEach((x) => x.remove());
  if (DB.me) { if ($('.app') && shellKey === shellSig()) switchView(); else renderShell(); }
}

(async function boot() {
  $('#root').innerHTML = `<div class="glass auth">${brandHTML()}<p class="muted" id="bootmsg">Loading…</p></div>`;
  try {
    await DB.init();
    if (DB.mode === 'live') {
      if (!DB.session) return renderLogin(urlAuthError());
      $('#bootmsg') && ($('#bootmsg').textContent = 'Loading leads, revenue and campaigns…');
      await DB.load();
      if (!DB.me || !DB.me.active) return renderNotListed();
      const step = await passwordStep(); if (step) return renderSetPassword(step);
    }
    loadUI();
    let [v, arg] = location.hash.slice(1).split('/');
    if (MOVED[v]) v = MOVED[v];
    if (v && VIEWS[v]) { ST.view = v; ST.arg = arg || null; } else ST.view = homeView();
    window.addEventListener('hashchange', route);
    DB.on(render); DB.on(chatLive);
    renderShell();
    startReminders();
  } catch (e) {
    console.error(e);
    if (e.message === 'NOT_CONFIGURED') {
      $('#root').innerHTML = `<div class="glass auth">${brandHTML()}<h1>Connect the database</h1><p class="muted">This CRM is not connected to Supabase yet. In Vercel, add the environment variables <b>SUPABASE_URL</b> and <b>SUPABASE_ANON_KEY</b> and redeploy (or fill in <span class="mono">config.js</span>). SETUP.md has the steps.</p></div>`;
      return;
    }
    $('#root').innerHTML = `<div class="glass auth">${brandHTML()}<h1>Could not start</h1><p class="muted">${esc(e.message)}</p><p class="faint" style="font-size:12.5px">Check your internet connection, then the Supabase URL and anon key. Refresh to try again.</p><button class="btn primary" onclick="location.reload()">Try again</button></div>`;
  }
})();

if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.includes('claude')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
