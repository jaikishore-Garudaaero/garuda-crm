/* Garuda CRM · Claude Connect: a ring you tap or talk to, the day's topics as cards you can pin, answers read out */
'use strict';

const CC = { open: false, topic: 'today', listening: false, answer: null, busy: false, rec: null, speak: true };
try { CC.speak = localStorage.getItem('garuda-cc-speak') !== '0'; } catch (_) { /* no storage */ }
const ccDay = () => todayStr();
const ccIsToday = (d) => d && localDate(d) === ccDay();

/* ---------- the day in numbers, read from what is loaded ---------- */
function ccFacts() {
  const now = new Date(); const ls = M.leads(); const today = ccDay();
  const rem = DB.t.remarks.filter((r) => ccIsToday(r.created_at) && ls.some((l) => l.id === r.lead_id));
  const byWho = groupBy(rem, (r) => DB.pname(r.author));
  const fresh = ls.filter((l) => !l.is_deal && ccIsToday(l.enquiry_date || l.created_at));
  const open = ls.filter(L.open); const fu = open.filter((l) => !l.is_deal && /follow/i.test(l.stage || ''));
  const over = open.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < now);
  const dueToday = open.filter((l) => l.next_followup_at && localDate(l.next_followup_at) === today);
  const deals = ls.filter(L.inPipe); const wtd = sum(deals, (l) => (l.value * L.prob(l)) / 100);
  const closing = deals.filter((l) => l.expected_close && l.expected_close >= today && daysAgo(l.expected_close) >= -14);
  const wonToday = ls.filter((l) => L.won(l) && ccIsToday(l.won_at));
  const pays = DB.t.payments.filter((p) => ccIsToday(p.verified_at || p.claimed_at));
  const tasksDone = DB.t.work_subtasks.filter((x) => x.done && ccIsToday(x.done_at));
  const tasksLate = DB.t.work_tasks.filter((t) => taskOpen(t) && t.due_date && t.due_date < today);
  const fy = TG.per('fy'); const u = { dept: ST.dept }; const X = tva(u, fy);
  const hot = open.filter((l) => /^P1/.test(l.campaign_tier || '')); const warm = open.filter((l) => /^P2/.test(l.campaign_tier || ''));
  const never = open.filter((l) => !l.is_deal && !l.call_attempts && !l.last_contact_at);
  return { ls, rem, byWho, fresh, open, fu, over, dueToday, deals, wtd, closing, wonToday, pays, tasksDone, tasksLate, X, fy, hot, warm, never };
}
/* the topic cards of the day: each one a sentence you can read out, and a list behind it */
function ccTopics(F) {
  const t = [];
  const who = Object.entries(F.byWho).sort((a, b) => b[1].length - a[1].length);
  t.push({ id: 'calls', icon: 'phone', tone: F.rem.length ? 'info' : 'mute', title: 'Calls and remarks today', big: nfmt(F.rem.length), say: F.rem.length ? `${nfmt(F.rem.length)} calls and remarks were logged today. ${who.slice(0, 3).map(([n, a]) => `${n.split(' ')[0]} logged ${a.length}`).join(', ')}.` : 'No calls or remarks have been logged today yet.', go: 'leads' });
  t.push({ id: 'new', icon: 'plus', tone: F.fresh.length ? 'good' : 'mute', title: 'New leads today', big: nfmt(F.fresh.length), say: `${nfmt(F.fresh.length)} new leads came in today.`, rows: F.fresh });
  t.push({ id: 'over', icon: 'clock', tone: F.over.length ? 'bad' : 'good', title: 'Follow-ups overdue', big: nfmt(F.over.length), say: F.over.length ? `${nfmt(F.over.length)} follow-ups are overdue. Clear these first.` : 'No follow-up is overdue.', rows: F.over });
  t.push({ id: 'due', icon: 'cal', tone: F.dueToday.length ? 'warn' : 'mute', title: 'Follow-ups due today', big: nfmt(F.dueToday.length), say: `${nfmt(F.dueToday.length)} follow-ups are due today.`, rows: F.dueToday });
  t.push({ id: 'hot', icon: 'flame', tone: F.hot.length ? 'bad' : 'mute', title: 'Hot and warm leads', big: `${nfmt(F.hot.length)} · ${nfmt(F.warm.length)}`, say: `${nfmt(F.hot.length)} hot P1 leads and ${nfmt(F.warm.length)} warm P2 leads are open.`, rows: [...F.hot, ...F.warm] });
  t.push({ id: 'won', icon: 'check', tone: F.wonToday.length ? 'good' : 'mute', title: 'Won today', big: nfmt(F.wonToday.length), say: F.wonToday.length ? `${nfmt(F.wonToday.length)} deal${F.wonToday.length === 1 ? ' was' : 's were'} won today${sum(F.wonToday, (l) => l.value) ? `, worth ${inrWords(sum(F.wonToday, (l) => l.value))}` : ''}.` : 'No deal was won today.', rows: F.wonToday });
  t.push({ id: 'deals', icon: 'deal', tone: 'info', title: 'Deals closing in 14 days', big: nfmt(F.closing.length), say: `${nfmt(F.deals.length)} deals are open, ${inrWords(F.wtd)} weighted. ${nfmt(F.closing.length)} are due to close in the next two weeks.`, rows: F.closing });
  t.push({ id: 'rev', icon: 'rev', tone: F.X.p == null ? 'mute' : toneFor(F.X.p), title: 'Revenue against target', big: F.X.t ? `${F.X.p}%` : inrShort(F.X.a), say: F.X.t ? `${TG.label(TG.fy())}: ${inrWords(F.X.a)} achieved of ${inrWords(F.X.t)}, that is ${F.X.p} percent. Collected ${inrWords(F.X.c)}, balance due ${inrWords(F.X.d)}. ${F.X.lag > 0 ? `We are ${inrWords(F.X.lag)} behind an even pace.` : 'We are ahead of an even pace.'}` : `${inrWords(F.X.a)} booked this year.`, go: 'revenue' });
  t.push({ id: 'pay', icon: 'pay', tone: F.pays.length ? 'good' : 'mute', title: 'Payments today', big: nfmt(F.pays.length), say: F.pays.length ? `${nfmt(F.pays.length)} payments were recorded today, ${inrWords(sum(F.pays, (p) => p.amount))} in all.` : 'No payment was recorded today.', go: 'collections' });
  t.push({ id: 'tasks', icon: 'task', tone: F.tasksLate.length ? 'warn' : 'good', title: 'Tasks', big: `${nfmt(F.tasksDone.length)} done`, say: `${nfmt(F.tasksDone.length)} task steps were completed today. ${nfmt(F.tasksLate.length)} tasks are overdue.`, go: 'tasks' });
  t.push({ id: 'never', icon: 'phone', tone: F.never.length ? 'warn' : 'good', title: 'Never contacted', big: nfmt(F.never.length), say: `${nfmt(F.never.length)} open leads have never been called.`, rows: F.never });
  return t;
}
/* rupees the way people say them */
function inrWords(n) { n = Math.round(Number(n) || 0); if (n >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} crore rupees`; if (n >= 1e5) return `${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} lakh rupees`; return `${nfmt(n)} rupees`; }

/* ---------- the topics on the ring ---------- */
const CC_RING = [['today', 'Today', 'spark'], ['leads', 'Leads', 'leads'], ['follow', 'Follow-ups', 'clock'], ['deals', 'Deals', 'deal'], ['revenue', 'Revenue', 'rev'], ['team', 'Team', 'team']];
function ccBrief(k, F) {
  const tp = ccTopics(F); const pick = (ids) => tp.filter((x) => ids.includes(x.id));
  if (k === 'today') return { title: 'Today at a glance', cards: pick(['calls', 'new', 'over', 'due', 'won', 'pay']) };
  if (k === 'leads') return { title: 'Leads', cards: pick(['new', 'hot', 'never']), say: `${nfmt(F.open.filter((l) => !l.is_deal).length)} leads are open.` };
  if (k === 'follow') return { title: 'Follow-ups', cards: pick(['over', 'due']), say: `${nfmt(F.fu.length)} leads are in a follow-up status.` };
  if (k === 'deals') return { title: 'Deals', cards: pick(['deals', 'won']) };
  if (k === 'revenue') return { title: 'Revenue', cards: pick(['rev', 'pay']) };
  const ppl = Object.entries(F.byWho).sort((a, b) => b[1].length - a[1].length);
  return { title: 'Team today', cards: pick(['calls', 'tasks']), people: ppl, say: ppl.length ? ppl.map(([n, a]) => `${n.split(' ')[0]}: ${a.length}`).join(', ') : 'Nobody has logged a call today yet.' };
}

/* ---------- answers: Claude when it is connected, otherwise straight from the CRM's numbers ---------- */
function ccLocal(q, F) {
  const s = q.toLowerCase();
  const person = DB.t.profiles.find((p) => p.active && s.includes(p.full_name.split(' ')[0].toLowerCase()));
  if (person) {
    const r = F.rem.filter((x) => x.author === person.id); const P = TG.per('fy'); const x = tva({ dept: ST.dept, pid: person.id }, P);
    const mine = F.open.filter((l) => l.owner === person.id); const od = mine.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < new Date());
    return `${person.full_name}: ${nfmt(r.length)} calls or remarks today, ${nfmt(mine.length)} open leads and deals, ${nfmt(od.length)} follow-ups overdue.${x.t ? ` Achieved ${inrWords(x.a)} of a ${inrWords(x.t)} target, ${x.p} percent.` : ''}`;
  }
  const tp = Object.fromEntries(ccTopics(F).map((x) => [x.id, x.say]));
  if (/revenue|target|collect|achiev|money|sale|behind|pace|balance/.test(s)) return tp.rev + ' ' + tp.pay;
  if (/overdue|follow/.test(s)) return tp.over + ' ' + tp.due;
  if (/deal|pipeline|clos/.test(s)) return tp.deals + ' ' + tp.won;
  if (/hot|warm|p1|p2|priority/.test(s)) return tp.hot;
  if (/new lead|came in|enquir/.test(s)) return tp.new;
  if (/task/.test(s)) return tp.tasks;
  if (/never|not called|untouched/.test(s)) return tp.never;
  return [tp.calls, tp.new, tp.over, tp.won, tp.rev].join(' ');
}
function ccContext(F) {
  return ccTopics(F).map((x) => `${x.title}: ${x.big}. ${x.say}`).join('\n') + '\nPeople today: ' + Object.entries(F.byWho).map(([n, a]) => `${n} ${a.length}`).join(', ');
}
async function ccAsk(q, el) {
  q = (q || '').trim(); if (!q) return;
  const F = ccFacts(); CC.busy = true; CC.answer = { q, text: 'Thinking…', src: '' }; ccPaint(el);
  let text = '', src = 'From the CRM’s numbers';
  if (DB.settings.ai?.enabled !== false && DB.mode === 'live') {
    try {
      const r = await DB.fn('ai', { action: 'ask', question: `${q}\n\nWhat the CRM shows today (${fmtDate(ccDay())}):\n${ccContext(F)}` });
      if (r?.answer) { text = r.answer; src = 'Claude'; }
    } catch (_) { /* Claude is not connected yet: answer from the numbers */ }
  }
  if (!text) text = ccLocal(q, F);
  CC.busy = false; CC.answer = { q, text, src }; ccPaint(el); ccSay(text);
}
function ccSay(text) {
  if (!CC.speak || !('speechSynthesis' in window)) return;
  try { window.speechSynthesis.cancel(); const u = new window.SpeechSynthesisUtterance(String(text).replace(/₹/g, 'rupees ')); u.lang = 'en-IN'; u.rate = 1.02; const v0 = window.speechSynthesis.getVoices().find((x) => /en-IN/i.test(x.lang)) || window.speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang)); if (v0) u.voice = v0; window.speechSynthesis.speak(u); } catch (_) { /* no voice */ }
}
function ccListen(el) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice needs Chrome, Edge or Safari. Type the question instead.', true);
  if (CC.listening && CC.rec) { CC.rec.stop(); return; }
  const r = new SR(); CC.rec = r; r.lang = 'en-IN'; r.interimResults = true; r.maxAlternatives = 1;
  CC.listening = true; ccPaint(el);
  let finalText = '';
  r.onresult = (e) => { let s = ''; for (const res of e.results) { s += res[0].transcript; if (res.isFinal) finalText = s; } const i = el.querySelector('#ccq'); if (i) i.value = s; };
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Allow the microphone for this site to talk to the CRM.' : 'Could not hear that: ' + e.error, true); };
  r.onend = () => { CC.listening = false; CC.rec = null; ccPaint(el); const q = finalText || el.querySelector('#ccq')?.value; if (q) ccAsk(q, el); };
  try { r.start(); } catch (_) { CC.listening = false; ccPaint(el); }
}

/* ---------- pinned topics, per person per day ---------- */
const ccPinKey = () => `garuda-cc-pins-${DB.me?.id}-${ccDay()}`;
function ccPins() { try { return JSON.parse(localStorage.getItem(ccPinKey()) || '[]'); } catch (_) { return []; } }
function ccSetPins(a) { try { localStorage.setItem(ccPinKey(), JSON.stringify(a)); } catch (_) { /* no storage */ } }

/* ---------- the screen ---------- */
function ccRingSVG() {
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2; const r1 = 132, r2 = i % 5 ? 136 : 141; return `<line x1="${150 + r1 * Math.cos(a)}" y1="${150 + r1 * Math.sin(a)}" x2="${150 + r2 * Math.cos(a)}" y2="${150 + r2 * Math.sin(a)}"/>`; }).join('');
  return `<svg viewBox="0 0 300 300" aria-hidden="true" class="cc-svg">
    <defs><radialGradient id="ccg" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#0B63D6" stop-opacity="0"/><stop offset="80%" stop-color="#4599FE" stop-opacity=".35"/><stop offset="100%" stop-color="#4599FE" stop-opacity="0"/></radialGradient></defs>
    <circle cx="150" cy="150" r="148" fill="url(#ccg)"/>
    <g class="cc-ticks">${ticks}</g>
    <circle class="cc-a1" cx="150" cy="150" r="118" fill="none" stroke-width="2.5" stroke-dasharray="120 40 30 60 200 80" />
    <circle class="cc-a2" cx="150" cy="150" r="104" fill="none" stroke-width="7" stroke-dasharray="60 300" stroke-linecap="round"/>
    <circle class="cc-a3" cx="150" cy="150" r="92" fill="none" stroke-width="1.5" stroke-dasharray="4 7"/>
    <circle class="cc-core" cx="150" cy="150" r="78" fill="none" stroke-width="5"/>
  </svg>`;
}
function ccPaint(el) {
  const box = el.querySelector('#ccbox'); if (!box) return;
  const F = ccFacts(); const tp = ccTopics(F); const pins = ccPins(); const br = ccBrief(CC.topic, F);
  const card = (x, pinned) => `<div class="cc-card tone-${x.tone}" draggable="true" data-cct="${x.id}"><span class="cc-ic">${svg(x.icon)}</span><div class="grow"><span class="cc-t">${esc(x.title)}</span><b>${esc(x.big)}</b><span class="cc-s">${esc(x.say)}</span></div>
    <div class="cc-act"><button type="button" class="cc-mini" data-ccsay="${x.id}" title="Read it out">${svg('sound')}</button>${x.rows || x.go ? `<button type="button" class="cc-mini" data-ccopen="${x.id}" title="Open the list">${svg('list')}</button>` : ''}<button type="button" class="cc-mini" data-ccpin="${x.id}" title="${pinned ? 'Unpin' : 'Pin'}">${svg(pinned ? 'x' : 'flag')}</button></div></div>`;
  box.innerHTML = `<div class="cc-stage">
      <div class="cc-hud ${CC.open ? 'open' : ''} ${CC.listening ? 'listening' : ''} ${CC.busy ? 'busy' : ''}">
        <div class="cc-ring">${ccRingSVG()}
          <button type="button" class="cc-btn" id="ccring" aria-label="${CC.listening ? 'Stop listening' : 'Open topics; hold to talk'}"><span class="cc-name">${CC.listening ? 'LISTENING' : CC.busy ? 'THINKING' : 'GARUDA'}</span><span class="cc-sub">${CC.listening ? 'speak now' : 'tap · hold to talk'}</span></button>
          ${CC_RING.map(([k, t, ic], i) => `<button type="button" class="cc-seg ${CC.topic === k ? 'on' : ''}" data-ccr="${k}" style="--a:${i * (360 / CC_RING.length) - 90}deg">${svg(ic)}<span>${t}</span></button>`).join('')}
        </div>
        <form class="cc-ask" id="ccform"><button type="button" class="cc-mic ${CC.listening ? 'on' : ''}" id="ccmic" aria-label="Talk">${svg('mic')}</button><input id="ccq" placeholder="Ask the CRM: “What happened today?”, “How is Pooja doing?”, “How far behind target are we?”" autocomplete="off"><button class="btn primary small" type="submit">Ask</button></form>
        <label class="cc-voice"><input type="checkbox" id="ccspk" ${CC.speak ? 'checked' : ''}> Read answers out loud</label>
      </div>
      <aside class="cc-panel">
        ${CC.answer ? `<div class="cc-ans"><span class="cc-q">“${esc(CC.answer.q)}”</span><p>${esc(CC.answer.text)}</p><span class="faint">${esc(CC.answer.src)}</span></div>` : ''}
        <div class="cc-ph"><h3>${esc(br.title)}</h3><button type="button" class="cc-mini" id="ccbr" title="Read it out">${svg('sound')}</button></div>
        ${br.say ? `<p class="cc-lede">${esc(br.say)}</p>` : ''}
        <div class="cc-list">${br.cards.map((x) => card(x, pins.includes(x.id))).join('')}</div>
        ${br.people?.length ? `<div class="cc-ppl">${br.people.map(([n, a]) => `<span class="chip">${esc(n)} · ${a.length}</span>`).join('')}</div>` : ''}
      </aside>
    </div>
    <div class="cc-board">
      <section class="cc-col" data-ccdrop="day"><div class="cc-ch"><h3>What happened today</h3><span class="faint">${fmtDate(ccDay())} · drag a card to Pinned</span></div><div class="cc-cards">${tp.filter((x) => !pins.includes(x.id)).map((x) => card(x, false)).join('')}</div></section>
      <section class="cc-col pin" data-ccdrop="pin"><div class="cc-ch"><h3>${svg('flag')} Pinned for today</h3><span class="faint">${pins.length ? 'tap the ring to hear them' : 'drop the topics that matter here'}</span></div><div class="cc-cards">${pins.map((id) => tp.find((x) => x.id === id)).filter(Boolean).map((x) => card(x, true)).join('') || '<div class="cc-empty">Drag a topic here</div>'}</div></section>
    </div>`;
  ccBind(el, F, tp);
}
function ccBind(el, F, tp) {
  const ring = el.querySelector('#ccring'); let hold = null; let held = false;
  const down = () => { held = false; hold = setTimeout(() => { held = true; ccListen(el); }, 450); };
  const up = () => { clearTimeout(hold); if (!held) { if (CC.listening) ccListen(el); else { CC.open = !CC.open; if (!CC.open) { const pins = ccPins(); if (pins.length) ccSay(pins.map((id) => tp.find((x) => x.id === id)?.say).filter(Boolean).join(' ')); } ccPaint(el); } } };
  ring.addEventListener('pointerdown', down); ring.addEventListener('pointerup', up); ring.addEventListener('pointerleave', () => clearTimeout(hold));
  ring.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); CC.open = !CC.open; ccPaint(el); } });
  el.querySelectorAll('[data-ccr]').forEach((b) => (b.onclick = () => { CC.topic = b.dataset.ccr; CC.answer = null; ccPaint(el); const br = ccBrief(CC.topic, ccFacts()); ccSay([br.title + '.', br.say, ...br.cards.map((x) => x.say)].filter(Boolean).join(' ')); }));
  el.querySelector('#ccmic').onclick = () => ccListen(el);
  el.querySelector('#ccform').onsubmit = (e) => { e.preventDefault(); ccAsk(el.querySelector('#ccq').value, el); };
  el.querySelector('#ccspk').onchange = (e) => { CC.speak = e.target.checked; try { localStorage.setItem('garuda-cc-speak', CC.speak ? '1' : '0'); } catch (_) { /* */ } if (!CC.speak && 'speechSynthesis' in window) window.speechSynthesis.cancel(); };
  el.querySelector('#ccbr').onclick = () => { const br = ccBrief(CC.topic, F); ccSay([br.title + '.', br.say, ...br.cards.map((x) => x.say)].filter(Boolean).join(' ')); };
  const byId = (id) => tp.find((x) => x.id === id);
  el.querySelectorAll('[data-ccsay]').forEach((b) => (b.onclick = () => ccSay(byId(b.dataset.ccsay)?.say)));
  el.querySelectorAll('[data-ccopen]').forEach((b) => (b.onclick = () => { const x = byId(b.dataset.ccopen); if (x?.rows) drill(esc(x.title), leadRows(x.rows)); else if (x?.go) go(x.go); }));
  el.querySelectorAll('[data-ccpin]').forEach((b) => (b.onclick = () => { const id = b.dataset.ccpin; const p = ccPins(); ccSetPins(p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); ccPaint(el); }));
  /* drag a card between the day and Pinned */
  el.querySelectorAll('.cc-card').forEach((c) => { c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', c.dataset.cct); c.classList.add('drag'); }; c.ondragend = () => c.classList.remove('drag'); });
  el.querySelectorAll('[data-ccdrop]').forEach((z) => { z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); }; z.ondragleave = () => z.classList.remove('over');
    z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); const p = ccPins().filter((x) => x !== id); ccSetPins(z.dataset.ccdrop === 'pin' ? [...p, id] : p); ccPaint(el); }; });
}
VIEWS.connect = {
  title: 'Claude Connect', sub: 'Tap the ring for the day’s topics, hold it (or the mic) to ask out loud. Drag what matters into Pinned.',
  render(el) {
    el.innerHTML = `${filterBar({ person: false, period: false })}<section class="cc-shell" id="ccbox"></section>
      <p class="faint" style="font-size:12px;margin:4px 6px">${DB.settings.ai?.enabled === false ? 'Claude is switched off in Settings → Claude AI, so answers come from the CRM’s own numbers.' : 'Questions go to Claude when it is connected (Settings → Claude AI and an Anthropic key in Supabase); otherwise the answer comes from the CRM’s own numbers.'} Voice uses your browser’s microphone and speech.</p>`;
    bindFilters(el, () => this.render(el));
    ccPaint(el);
  },
};
