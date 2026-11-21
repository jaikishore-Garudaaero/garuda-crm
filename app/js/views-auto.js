/* Garuda CRM · celebrations, referrals, unnoticed-reminder alerts and lead automations (workflows) */
'use strict';

/* ================= celebrations: a sale, a new deal, a loss ================= */
function celebrate(before, after) {
  if (!after || !before?.id) return;
  const a = L.st(before); const b = L.st(after);
  const kind = b.is_won && !a.is_won ? 'won' : b.is_lost && !a.is_lost ? 'lost' : after.is_deal && !before.is_deal ? 'deal' : null;
  if (!kind) return;
  /* a bulk change moves many records at once: one celebration is enough */
  const now = Date.now(); if (now - (celebrate.last || 0) < 4000) return; celebrate.last = now;
  showCelebration(kind, after, DB.me?.id);
}
const CELEB = {
  won: { face: '🥳', title: 'Hurray, it’s a sale!', tone: 'good', burst: 160 },
  deal: { face: '😄', title: 'New deal! Poppers out', tone: 'info', burst: 110 },
  lost: { face: '😢', title: 'This one got away', tone: 'bad', burst: 0 },
};
function showCelebration(kind, l, by) {
  const c = CELEB[kind]; if (!c) return;
  document.querySelector('.celeb')?.remove();
  const who = by && by !== DB.me?.id ? DB.pname(by) : DB.me?.full_name?.split(' ')[0] || '';
  const sub = kind === 'won' ? `${esc(L.title(l))}${Number(l.value) ? ` · <b>${inr(l.value)}</b>` : ''}. Well done${who ? ', ' + esc(who) : ''}!`
    : kind === 'deal' ? `${esc(L.title(l))} is now a deal${Number(l.value) ? ` worth <b>${inr(l.value)}</b>` : ''}. Keep it moving${who ? ', ' + esc(who) : ''}.`
      : `${esc(L.title(l))}${l.lost_reason ? ' · ' + esc(l.lost_reason) : ''}. Learn from it and move on to the next one.`;
  const o = document.createElement('div'); o.className = `celeb celeb-${kind}`; o.setAttribute('role', 'status');
  o.innerHTML = `<canvas class="celeb-c"></canvas><div class="celeb-card glass tone-${c.tone}"><div class="celeb-face" aria-hidden="true">${c.face}</div><h2>${c.title}</h2><p>${sub}</p><button class="btn small" type="button">${kind === 'lost' ? 'OK' : 'Yay!'}</button></div>`;
  document.body.appendChild(o);
  const close = () => { o.classList.add('out'); setTimeout(() => o.remove(), 350); };
  o.querySelector('button').onclick = close; o.onclick = (e) => { if (e.target === o) close(); };
  setTimeout(close, kind === 'lost' ? 3800 : 5200);
  try { if (typeof chime === 'function') chime(kind === 'lost' ? 'alert' : 'task'); } catch (_) { /* no sound */ }
  if (c.burst) poppers(o.querySelector('canvas'), c.burst);
}
/* two party poppers firing confetti from the bottom corners */
function poppers(cv, n) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1); const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cols = ['#2477dc', '#e02446', '#f5b301', '#22b07d', '#8b5cf6', '#ff7ab6', '#ffffff'];
  const ps = [];
  [[0, H, 1], [W, H, -1]].forEach(([x, y, dir]) => { for (let i = 0; i < n; i++) { const ang = (-60 - Math.random() * 30) * (Math.PI / 180); const sp = 9 + Math.random() * 11; ps.push({ x, y, vx: Math.cos(ang) * sp * dir, vy: Math.sin(ang) * sp, r: 3 + Math.random() * 4, c: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, shape: i % 3 }); } });
  const t0 = performance.now();
  const step = (t) => {
    g.clearRect(0, 0, W, H);
    ps.forEach((p) => { p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c; if (p.shape === 0) g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else if (p.shape === 1) { g.beginPath(); g.arc(0, 0, p.r / 1.4, 0, 7); g.fill(); } else { g.beginPath(); g.moveTo(0, -p.r); g.lineTo(p.r, p.r); g.lineTo(-p.r, p.r); g.fill(); } g.restore(); });
    if (t - t0 < 4200 && cv.isConnected) requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
}

/* ================= referrals: a client names friends; each becomes a lead with source Student referral ================= */
function referralBox(l, box, after) {
  if (!box) return;
  const refs = DB.t.leads.filter((x) => x.referred_by === l.id);
  const row = (i) => `<div class="refrow" data-r="${i}"><input class="rn" placeholder="Name" aria-label="Name"><input class="rp" type="tel" placeholder="Phone" aria-label="Phone"><input class="ro" placeholder="Organisation / university" aria-label="Organisation or university"><button type="button" class="btn ghost small rdel" aria-label="Remove">${svg('x')}</button></div>`;
  box.innerHTML = `<section class="refbox"><div class="row between"><h3>${svg('team')} Referrals ${refs.length ? `<span class="chip good">${refs.length}</span>` : ''}</h3><span class="faint" style="font-size:12px">Friends this client recommends. Each one becomes a lead with source “Student referral”.</span></div>
    ${refs.length ? `<ul class="reflist">${refs.map((x) => `<li><button class="lnk" data-lead="${x.id}">${esc(x.name)}</button><span class="faint">${esc(x.phone || '')}${x.org ? ' · ' + esc(x.org) : ''}</span>${stageChip(x)}<span class="faint">by ${esc(DB.pname(x.referral_by || x.created_by))} · ${fmtDate(x.created_at)}</span></li>`).join('')}</ul>` : ''}
    <div id="refrows">${row(0)}</div>
    <div class="row between"><button type="button" class="btn small" id="refadd">${svg('plus')} Add another</button><button type="button" class="btn primary small" id="refsave">Save referrals</button></div></section>`;
  let n = 1;
  const rows = box.querySelector('#refrows');
  const bindDel = () => rows.querySelectorAll('.rdel').forEach((b) => (b.onclick = () => { if (rows.children.length > 1) b.closest('.refrow').remove(); else b.closest('.refrow').querySelectorAll('input').forEach((i) => (i.value = '')); }));
  bindDel();
  box.querySelector('#refadd').onclick = () => { rows.insertAdjacentHTML('beforeend', row(n++)); bindDel(); rows.lastElementChild.querySelector('.rn').focus(); };
  box.querySelectorAll('button[data-lead]').forEach((b) => (b.onclick = () => openLead(b.dataset.lead)));
  box.querySelector('#refsave').onclick = () => guard(async () => {
    const list = [...rows.querySelectorAll('.refrow')].map((r) => ({ name: r.querySelector('.rn').value.trim(), phone: r.querySelector('.rp').value.trim(), org: r.querySelector('.ro').value.trim() })).filter((x) => x.name || x.phone);
    if (!list.length) throw new Error('Enter at least one name and phone number.');
    const bad = list.find((x) => !x.name || (x.phone.replace(/\D/g, '').length < 10)); if (bad) throw new Error('Each referral needs a name and a 10-digit phone number.');
    const first = S.firstOpen(l.funnel, 'lead'); let made = 0; const dups = [];
    for (const x of list) {
      const d = typeof dupCheck === 'function' ? dupCheck(x.phone, '') : null; if (d) { dups.push(`${x.name} (already ${d.lead_no || d.name})`); continue; }
      await DB.insert('leads', { funnel: l.funnel, name: x.name, org: x.org, phone: x.phone, source: 'Student referral', stage: first?.key || 'New', owner: DB.me.id, sourced_by: DB.me.id, referred_by: l.id, referral_by: DB.me.id, course: l.course || '', sub_category: l.sub_category || '', temperature: 'Warm', city: l.city || '' });
      made++;
    }
    if (made) await DB.insert('remarks', { lead_id: l.id, channel: 'Note', outcome: 'Note', text: `Referred ${made} ${made === 1 ? 'person' : 'people'}: ${list.filter((x) => !dups.some((d) => d.startsWith(x.name))).map((x) => `${x.name}${x.org ? ' (' + x.org + ')' : ''}`).join(', ')}` });
    toast(made ? `${made} referral${made === 1 ? '' : 's'} added to Leads${dups.length ? ' · skipped duplicates: ' + dups.join(', ') : ''}` : 'All of them are already in the CRM: ' + dups.join(', '), !made);
    after?.();
  });
}

/* ================= reminders nobody acted on ================= */
const UNN = { key: () => `garuda-unnoticed-${DB.me?.id}`, load() { try { return JSON.parse(localStorage.getItem(this.key()) || '{}'); } catch (_) { return {}; } }, save(x) { try { localStorage.setItem(this.key(), JSON.stringify(x)); } catch (_) { /* no storage */ } } };
/* leads given to me that nobody has called yet (the last 30 days, older than a day) */
function untouchedMine() {
  if (!DB.me) return [];
  const now = Date.now();
  return visibleLeads().filter((l) => l.owner === DB.me.id && L.open(l) && !l.is_deal && !l.imported && !l.last_contact_at && !l.first_contact_at
    && now - new Date(l.allocated_date || l.created_at).getTime() > 864e5 && now - new Date(l.allocated_date || l.created_at).getTime() < 30 * 864e5
    && !DB.t.remarks.some((r) => r.lead_id === l.id));
}
function checkUnnoticed() {
  if (!DB.me || typeof alertsList !== 'function') return;
  const st = UNN.load(); const now = Date.now(); const live = alertsList().filter((a) => a.tone === 'bad' && a.due);
  const ids = new Set(live.map((a) => a.id));
  Object.keys(st.seen || {}).forEach((k) => { if (!ids.has(k)) delete st.seen[k]; });
  st.seen ||= {}; live.forEach((a) => { st.seen[a.id] ||= now; });
  const old = live.filter((a) => now - st.seen[a.id] > 2 * 36e5);
  if (old.length && now - (st.shown || 0) > 36e5 && !document.querySelector('.unnoticed')) {
    st.shown = now;
    const m = openModal({ title: `${svg('warn')} ${old.length} reminder${old.length === 1 ? ' has' : 's have'} gone unnoticed`, width: 620,
      body: `<p class="faint" style="margin:0 0 10px">These have been due for more than 2 hours and nobody opened or snoozed them.</p><ul class="alerts unnoticed">${old.slice(0, 12).map((a) => `<li class="tone-bad"><span class="ai bad">${svg(a.ic)}</span><div class="grow"><button class="lnk at" data-ao="${esc(a.to)}">${a.title}</button>${a.sub ? `<span class="s">${a.sub}</span>` : ''}</div></li>`).join('')}</ul>${old.length > 12 ? `<p class="faint">+${old.length - 12} more in the bell.</p>` : ''}`,
      foot: '<button class="btn" data-snzall>Snooze all for 1 hour</button><button class="btn primary" data-c>I’ll do them now</button>' });
    m.el.querySelectorAll('[data-ao]').forEach((x) => (x.onclick = () => { m.close(); openAlert(x.dataset.ao); }));
    m.el.querySelector('[data-snzall]').onclick = () => { const s0 = RM.load(); old.forEach((a) => { s0[a.id] = Date.now() + 36e5; }); RM.save(s0); m.close(); refreshBell(); };
    try { if (typeof chime === 'function') chime('alert'); } catch (_) { /* no sound */ }
  }
  UNN.save(st);
}
setInterval(() => { try { checkUnnoticed(); } catch (_) { /* never break the app */ } }, 5 * 6e4);
setTimeout(() => { try { checkUnnoticed(); } catch (_) { /* */ } }, 90e3);

/* ================= Automations ================= */
const AUTO_TRIGGERS = [
  ['lead_created', 'A new lead comes in', 'plus'], ['no_contact', 'Lead not contacted for some days', 'phone'], ['followup_overdue', 'A follow-up is overdue', 'clock'],
  ['stage_changed', 'Status changes', 'swap'], ['became_deal', 'Lead becomes a deal', 'deal'], ['won', 'Deal is won', 'check'], ['lost', 'Lead or deal is lost', 'x'], ['referral_added', 'A referral is added', 'team'],
];
const AUTO_STEPS = {
  email: ['Send email', 'mail'], whatsapp: ['Send WhatsApp', 'chat'], task: ['Create a call task', 'task'], notify: ['Notify someone', 'bell'], wait: ['Wait', 'clock'],
  assign: ['Assign the lead', 'team'], tier: ['Set campaign tier', 'flag'], stage: ['Set status', 'swap'], remark: ['Add a note', 'note'],
};
const AUTO_IDEAS = [
  ['Welcome a new lead', 'Email and WhatsApp the moment an enquiry lands, then a call task in 2 hours.'], ['Speed to lead', 'Alert the owner and the head when a lead is not called within a day.'],
  ['Missed follow-up escalation', 'Remind the owner after 4 hours; tell the head after a day.'], ['RNR retry', 'WhatsApp the lead when the status is RNR, then a fresh call task in 2 days.'],
  ['Deal created', 'A proposal task for the owner, good news to the head.'], ['Won', 'Thank-you email, onboarding call, and a request for referrals a week later.'],
  ['Lost win-back', 'After 30 days, WhatsApp the new batch dates and move the lead to R1 Win-back.'], ['Referral', 'Call a referred friend within 4 hours.'],
  ['Webinar no-show', 'Coming next: use Email Marketing → Sequences for webinar reminders today.'], ['Payment due', 'Coming next: payment reminders run from Collections today.'],
];
const trgName = (k) => (AUTO_TRIGGERS.find((t) => t[0] === k) || [k, k])[1];
function stepText(s) {
  if (s.type === 'wait') { const m = Number(s.minutes) || 60; return `Wait ${m >= 1440 ? `${Math.round(m / 144) / 10} day${m === 1440 ? '' : 's'}` : m >= 60 ? `${Math.round(m / 6) / 10} h` : m + ' min'}`; }
  if (s.type === 'email') return `Email: “${s.subject || ''}”`;
  if (s.type === 'whatsapp') return `WhatsApp: “${String(s.text || '').slice(0, 60)}${String(s.text || '').length > 60 ? '…' : ''}”`;
  if (s.type === 'task') return `Task for the owner: ${s.title || 'Call'} (in ${s.hours ?? 4} h)`;
  if (s.type === 'notify') return `Notify ${({ owner: 'the owner', head: 'the head', both: 'the owner and the head' })[s.to || 'owner']}: ${s.title || ''}`;
  if (s.type === 'assign') return s.to === 'round_robin' ? 'Assign round-robin to the team' : `Assign to ${DB.pname(s.to)}`;
  if (s.type === 'tier') return `Set tier: ${s.value}`;
  if (s.type === 'stage') return `Set status: ${s.value}`;
  if (s.type === 'remark') return `Note: ${s.text || ''}`;
  return s.type;
}
function condText(a) {
  const c = a.conditions || {}; const x = [];
  if (a.trigger === 'no_contact') x.push(`after ${c.days || 2} day${(c.days || 2) == 1 ? '' : 's'}`);
  if (a.trigger === 'followup_overdue') x.push(`${c.hours ?? 2} h overdue`);
  if (a.trigger === 'stage_changed' && c.to_stage) x.push(`to ${c.to_stage}`);
  if (c.funnels?.length) x.push(c.funnels.join(', ')); if (c.sources) x.push('source ~ ' + c.sources); if (c.tiers?.length) x.push(c.tiers.join(', ')); if (c.stages?.length) x.push('in ' + c.stages.join(', '));
  return x.join(' · ');
}
VIEWS.automations = {
  title: 'Automations', sub: 'Workflows that run by themselves: welcome messages, speed-to-lead alerts, follow-up escalations, win-backs and referrals.',
  actions: () => (isHead() ? `<button class="btn primary" id="anew">${svg('plus')} New workflow</button>` : ''),
  async render(el) {
    const list = [...(DB.t.automations || [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    const on = list.filter((a) => a.active);
    el.innerHTML = `<div class="kpis">${kpi({ label: 'Workflows on', value: nfmt(on.length), sub: `${nfmt(list.length)} in all` })}${kpi({ label: 'Leads processed', value: nfmt(sum(list, (a) => a.runs)), sub: 'Finished runs, all time' })}${kpi({ label: 'Runs today', value: '<span id="arToday">…</span>', sub: 'Started today' })}${kpi({ label: 'Waiting', value: '<span id="arWait">…</span>', sub: 'Paused on a Wait step' })}</div>
      ${!list.length ? `<section class="glass panel">${empty('No workflows yet', 'Run supabase/v49.sql in Supabase to add the ready-made workflows, then turn on the ones you want.')}</section>` : ''}
      <div class="autogrid">${list.map((a) => `<section class="glass panel acard ${a.active ? 'on' : ''}">
        <div class="row between"><div><span class="chip tone ${a.active ? 'good' : 'mute'}">${a.active ? 'On' : 'Off'}</span> <span class="faint" style="font-size:12px">${nfmt(a.runs)} run${a.runs === 1 ? '' : 's'}</span></div>
          ${isHead() ? `<label class="aswitch" title="${a.active ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-atog="${a.id}" ${a.active ? 'checked' : ''}><i></i></label>` : ''}</div>
        <h3>${esc(a.name)}</h3>
        <div class="aflow"><div class="anode trig">${svg((AUTO_TRIGGERS.find((t) => t[0] === a.trigger) || [])[2] || 'spark')}<span><b>When</b> ${esc(trgName(a.trigger))}${condText(a) ? ` <span class="faint">· ${esc(condText(a))}</span>` : ''}</span></div>
          ${(a.steps || []).map((s) => `<div class="anode ${s.type}">${svg(AUTO_STEPS[s.type]?.[1] || 'spark')}<span>${esc(stepText(s))}</span></div>`).join('')}</div>
        ${isHead() ? `<div class="row" style="justify-content:flex-end"><button class="btn small" data-aedit="${a.id}">Edit</button><button class="btn small" data-acopy="${a.id}">Duplicate</button><button class="btn ghost small" data-adel="${a.id}">Delete</button></div>` : ''}</section>`).join('')}</div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2>Recent runs</h2>${isHead() ? '<button class="btn small" id="arun">Run due steps now</button>' : ''}</div><div id="aruns"><p class="faint">Loading…</p></div></section>
        <section class="glass panel"><div class="panel-head"><h2>How it works</h2></div><ul class="mini">
          <li><b>Email</b> goes out through the CRM mailer (the same one as Email Marketing), only to leads with an email address who have not unsubscribed.</li>
          <li><b>WhatsApp</b> lands in the owner’s bell with the message ready: one tap opens WhatsApp with the text filled in. Sending it automatically needs the WhatsApp Business API; tell your Admin if you want it connected.</li>
          <li><b>Tasks and alerts</b> go to the lead’s owner (or the head) and show in the bell and in Reminders.</li>
          <li>Workflows check for due steps every 5 minutes, and straight away when a lead is created or changes status. Leads imported from the sales sheet do not start the “new lead” workflows.</li>
          <li>Each workflow runs once per lead. Use <code>{{first_name}}</code>, <code>{{name}}</code>, <code>{{org}}</code>, <code>{{course}}</code>, <code>{{owner}}</code> in messages.</li></ul>
          <h4 style="margin:12px 0 6px">Ideas</h4><div class="list">${AUTO_IDEAS.map(([t, d]) => `<div class="item"><span class="grow"><b>${esc(t)}</b><br><span class="faint" style="font-size:12.5px">${esc(d)}</span></span></div>`).join('')}</div></section>
      </div>`;
    el.querySelectorAll('[data-atog]').forEach((c) => (c.onchange = () => guard(() => DB.update('automations', c.dataset.atog, { active: c.checked, updated_at: nowISO() }), c.checked ? 'Workflow on' : 'Workflow off')));
    el.querySelectorAll('[data-aedit]').forEach((b) => (b.onclick = () => autoEditor(DB.get('automations', b.dataset.aedit))));
    el.querySelectorAll('[data-acopy]').forEach((b) => (b.onclick = () => { const a = DB.get('automations', b.dataset.acopy); autoEditor({ ...a, id: null, name: a.name + ' (copy)', active: false }); }));
    el.querySelectorAll('[data-adel]').forEach((b) => (b.onclick = async () => { const a = DB.get('automations', b.dataset.adel); if (await confirmBox(`Delete the workflow “${esc(a.name)}”?`, 'Delete')) guard(() => DB.remove('automations', a.id), 'Deleted'); }));
    el.querySelector('#arun')?.addEventListener('click', () => guard(async () => { const n = await DB.call('run_automations', {}, ['automations', 'notifications']); toast(`${n} run${n === 1 ? '' : 's'} processed`); this.render(el); }));
    /* recent runs */
    try {
      const { data } = await DB.sb.from('automation_runs').select('*').order('created_at', { ascending: false }).limit(60);
      const runs = data || []; const today = todayStr();
      const t1 = el.querySelector('#arToday'); if (t1) t1.textContent = nfmt(runs.filter((r) => localDate(r.created_at) === today).length);
      const t2 = el.querySelector('#arWait'); if (t2) t2.textContent = nfmt(runs.filter((r) => r.status === 'Waiting').length);
      const box = el.querySelector('#aruns');
      if (box) box.innerHTML = runs.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Workflow</th><th>Lead</th><th>Status</th><th>Last step</th></tr></thead><tbody>${runs.map((r) => { const a = DB.get('automations', r.automation_id); const l = DB.get('leads', r.lead_id); const last = (r.log || []).at(-1); return `<tr ${l ? `class="click" data-lead="${l.id}"` : ''}><td>${fmtDT(r.created_at)}</td><td>${esc(a?.name || '—')}</td><td>${esc(l?.name || '—')}</td><td><span class="chip tone ${r.status === 'Done' ? 'good' : r.status === 'Waiting' ? 'info' : r.status === 'Failed' ? 'bad' : 'mute'}">${esc(r.status)}</span>${r.status === 'Waiting' ? ` <span class="faint">until ${fmtDT(r.due_at)}</span>` : ''}</td><td class="${last && !last.ok ? 'bad' : 'faint'}">${esc(last?.msg || '')}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="faint">No runs yet. Turn a workflow on; it starts with the next new lead or status change.</p>';
      if (box) bindLeadClicks(box);
    } catch (_) { const box = el.querySelector('#aruns'); if (box) box.innerHTML = '<p class="faint">Run supabase/v49.sql to start the automation engine.</p>'; }
  },
  mount() { $('#anew')?.addEventListener('click', () => autoEditor({ name: '', trigger: 'lead_created', conditions: {}, steps: [{ type: 'task', title: 'Call {{name}}', hours: 2 }], active: false })); },
};
function autoEditor(a0) {
  const a = JSON.parse(JSON.stringify(a0)); a.conditions ||= {}; a.steps ||= [];
  const codes = DEPTS().map((d) => d.code);
  const allStages = [...new Set(codes.flatMap((c) => S.list(c).map((s) => s.key)))];
  const people = assignablePeople();
  const stepForm = (s, i) => {
    const f = (k, label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
    const t = (k, ph = '') => `<input data-sk="${k}" value="${esc(s[k] ?? '')}" placeholder="${esc(ph)}">`;
    const ta = (k, ph = '') => `<textarea data-sk="${k}" rows="3" placeholder="${esc(ph)}">${esc(s[k] ?? '')}</textarea>`;
    let body = '';
    if (s.type === 'email') body = f('subject', 'Subject', t('subject', 'Welcome to Garuda Aerospace, {{first_name}}')) + f('body', 'Message', ta('body', 'Hi {{first_name}}, …'));
    else if (s.type === 'whatsapp') body = f('text', 'Message', ta('text', 'Hi {{first_name}}, this is {{owner}} from Garuda Aerospace…'));
    else if (s.type === 'task') body = f('title', 'Task', t('title', 'Call {{name}}')) + f('hours', 'Due in (hours)', `<input type="number" min="0" data-sk="hours" value="${esc(s.hours ?? 4)}">`);
    else if (s.type === 'notify') body = f('to', 'Who', `<select data-sk="to">${opts([['owner', 'The lead’s owner'], ['head', 'The head (Admin)'], ['both', 'Both']], s.to || 'owner')}</select>`) + f('kind', 'Colour', `<select data-sk="kind">${opts([['bad', 'Red: urgent'], ['warn', 'Amber: attention'], ['good', 'Green: good news'], ['info', 'Blue: info']], s.kind || 'warn')}</select>`) + f('title', 'Title', t('title', 'Not called yet: {{name}}')) + f('text', 'Text', t('text'));
    else if (s.type === 'wait') body = f('minutes', 'Wait for', `<select data-sk="minutes">${opts([[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'], [10080, '1 week'], [20160, '2 weeks'], [43200, '30 days']].map(([x, y]) => [String(x), y]), String(s.minutes || 60))}</select>`);
    else if (s.type === 'assign') body = f('to', 'Assign to', `<select data-sk="to">${opts([['round_robin', 'Round-robin: whoever got the fewest today'], ...people.map((p) => [p.id, p.full_name])], s.to || 'round_robin')}</select>`);
    else if (s.type === 'tier') body = f('value', 'Tier', `<select data-sk="value">${opts(TIERS, s.value || TIERS[0])}</select>`);
    else if (s.type === 'stage') body = f('value', 'Status', `<select data-sk="value">${opts(allStages, s.value || allStages[0])}</select>`);
    else if (s.type === 'remark') body = f('text', 'Note', t('text'));
    return `<div class="astep" data-i="${i}"><div class="row between"><b>${svg(AUTO_STEPS[s.type]?.[1] || 'spark')} ${i + 1}. ${esc(AUTO_STEPS[s.type]?.[0] || s.type)}</b><span class="row"><button type="button" class="btn ghost small" data-mv="-1" aria-label="Move up">↑</button><button type="button" class="btn ghost small" data-mv="1" aria-label="Move down">↓</button><button type="button" class="btn ghost small" data-rm aria-label="Remove">${svg('x')}</button></span></div><div class="form">${body}</div></div>`;
  };
  const m = openModal({ title: a.id ? 'Edit workflow' : 'New workflow', width: 820, body: '<div id="aed"></div>', foot: `<button class="btn" data-c>Cancel</button><button class="btn primary" id="asave">${a.id ? 'Save' : 'Create'}</button>` });
  const box = m.el.querySelector('#aed');
  const pull = () => {
    a.name = v(box, 'aname'); a.trigger = v(box, 'atrig'); a.active = v(box, 'aact');
    const c = {}; const fs = $$('.afun:checked', box).map((x) => x.value); if (fs.length) c.funnels = fs;
    if (v(box, 'asrc')) c.sources = v(box, 'asrc'); const ts = $$('.atier:checked', box).map((x) => x.value); if (ts.length) c.tiers = ts;
    if (box.querySelector('#adays')) c.days = num(box, 'adays') || 1; if (box.querySelector('#ahours')) c.hours = num(box, 'ahours');
    if (box.querySelector('#ato')) c.to_stage = v(box, 'ato'); a.conditions = c;
    $$('.astep', box).forEach((d) => { const s = a.steps[Number(d.dataset.i)]; d.querySelectorAll('[data-sk]').forEach((i) => { s[i.dataset.sk] = i.type === 'number' || i.dataset.sk === 'minutes' || i.dataset.sk === 'hours' ? Number(i.value) : i.value; }); });
  };
  const draw = () => {
    const c = a.conditions;
    box.innerHTML = `<div class="form">
        <label class="field full"><span>Name</span><input id="aname" value="${esc(a.name)}" placeholder="Welcome a new lead"></label>
        <label class="field"><span>When</span><select id="atrig">${opts(AUTO_TRIGGERS.map(([k, t]) => [k, t]), a.trigger)}</select></label>
        ${a.trigger === 'no_contact' ? `<label class="field"><span>Not contacted for (days)</span><input id="adays" type="number" min="1" value="${esc(c.days || 2)}"></label>` : ''}
        ${a.trigger === 'followup_overdue' ? `<label class="field"><span>Overdue by (hours)</span><input id="ahours" type="number" min="0" value="${esc(c.hours ?? 2)}"></label>` : ''}
        ${a.trigger === 'stage_changed' ? `<label class="field"><span>To status</span><select id="ato">${opts(allStages, c.to_stage || '', 'Any status')}</select></label>` : ''}
        <div class="field full"><span>Only for</span><div class="row">${codes.map((k) => `<label class="check"><input type="checkbox" class="afun" value="${esc(k)}" ${(c.funnels || []).includes(k) ? 'checked' : ''}> ${esc(dept(k).name)}</label>`).join('')}<span class="faint" style="font-size:12px">none ticked = every process</span></div></div>
        <label class="field"><span>Source contains</span><input id="asrc" value="${esc(c.sources || '')}" placeholder="e.g. Meta|Google (blank = any)"></label>
        <div class="field"><span>Tiers</span><div class="row">${['P1', 'P2', 'P3', 'P4', 'R1'].map((k) => `<label class="check"><input type="checkbox" class="atier" value="${k}" ${(c.tiers || []).includes(k) ? 'checked' : ''}> ${k}</label>`).join('')}</div></div>
        <label class="check full"><input type="checkbox" id="aact" ${a.active ? 'checked' : ''}> Workflow is on</label></div>
      <h4 style="margin:14px 0 6px">Then</h4><div class="asteps">${a.steps.map(stepForm).join('') || '<p class="faint">Add the first step.</p>'}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${Object.entries(AUTO_STEPS).map(([k, [t, ic]]) => `<button type="button" class="btn small" data-add="${k}">${svg(ic)} ${t}</button>`).join('')}</div>
      <p class="faint" style="font-size:12px;margin-top:8px">Placeholders: {{first_name}} {{name}} {{org}} {{course}} {{owner}} {{owner_phone}} {{phone}}</p>`;
    box.querySelector('#atrig').onchange = () => { pull(); draw(); };
    box.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { pull(); a.steps.push({ type: b.dataset.add, ...(b.dataset.add === 'wait' ? { minutes: 1440 } : b.dataset.add === 'task' ? { title: 'Call {{name}}', hours: 4 } : b.dataset.add === 'notify' ? { to: 'owner', kind: 'warn', title: '{{name}}' } : {}) }); draw(); }));
    box.querySelectorAll('.astep').forEach((d) => { const i = Number(d.dataset.i);
      d.querySelector('[data-rm]').onclick = () => { pull(); a.steps.splice(i, 1); draw(); };
      d.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => { pull(); const j = i + Number(b.dataset.mv); if (j < 0 || j >= a.steps.length) return; [a.steps[i], a.steps[j]] = [a.steps[j], a.steps[i]]; draw(); })); });
  };
  draw();
  m.el.querySelector('#asave').onclick = () => guard(async () => {
    pull(); if (!a.name.trim()) throw new Error('Give the workflow a name.'); if (!a.steps.length) throw new Error('Add at least one step.');
    const row = { name: a.name.trim(), trigger: a.trigger, conditions: a.conditions, steps: a.steps, active: !!a.active, updated_at: nowISO() };
    if (a.id) await DB.update('automations', a.id, row); else await DB.insert('automations', row);
    m.close(); if (ST.view === 'automations') go('automations');
  }, 'Workflow saved');
}
