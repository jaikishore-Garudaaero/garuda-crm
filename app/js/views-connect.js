/* Garuda CRM · Garuda Connect: a full-screen ring you talk to; answers appear as glass panels with the numbers and lists behind them, read out in a female voice */
'use strict';

const CC = { listening: false, busy: false, rec: null, speak: true, speaking: false, ans: null, q: '', heard: '', capParts: [], capAt: -1, unlocked: false, aiErr: '' };
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

/* ---------- extra icons for this screen ---------- */
Object.assign(ICON, {
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  drive: '<path d="M8.5 3h7l6 10.5-3.5 6h-12L2.5 13.5z"/><path d="M8.5 3l6.5 11H21.5M2.5 13.5h13l-3.5 6"/>',
  google: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12h8M12 12v-0"/>',
});

/* ---------- Google: today's email and Drive, read in the browser with the signed-in person's own Google account ---------- */
const GG = { token: null, exp: 0, mail: null, drive: null, loading: false, err: '' };
const ggClientId = () => DB.settings.google?.client_id || '';
const ggOn = () => GG.token && Date.now() < GG.exp;
function ggLoadScript() {
  return new Promise((res, rej) => { if (window.google?.accounts?.oauth2) return res(); const s0 = document.createElement('script'); s0.src = 'https://accounts.google.com/gsi/client'; s0.async = true; s0.onload = () => res(); s0.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.appendChild(s0); });
}
async function ggConnect(el) {
  if (!ggClientId()) return ggHelp(el);
  try {
    await ggLoadScript();
    const tc = window.google.accounts.oauth2.initTokenClient({ client_id: ggClientId(), scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.metadata.readonly', hint: DB.me?.email || '',
      callback: async (r) => { if (r.error) { GG.err = r.error; toast('Google: ' + r.error, true); return; } GG.token = r.access_token; GG.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60e3; GG.err = ''; await ggFetch(); ccPaint(el); toast('Google connected'); } });
    tc.requestAccessToken({ prompt: '' });
  } catch (e) { toast(e.message, true); }
}
async function ggGet(url) { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + GG.token } }); if (r.status === 401) { GG.token = null; throw new Error('Google sign-in expired. Connect again.'); } if (!r.ok) throw new Error('Google said ' + r.status); return r.json(); }
async function ggFetch() {
  if (!ggOn()) return; GG.loading = true;
  try {
    const list = await ggGet('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=' + encodeURIComponent('newer_than:1d -category:promotions -category:social'));
    const msgs = await Promise.all((list.messages || []).slice(0, 20).map((m) => ggGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null)));
    GG.mail = msgs.filter(Boolean).map((m) => { const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name, x.value])); return { id: m.id, from: (h.From || '').replace(/<.*>/, '').replace(/"/g, '').trim() || h.From, subject: h.Subject || '(no subject)', at: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet || '', unread: (m.labelIds || []).includes('UNREAD') }; });
    const since = new Date(Date.now() - 864e5).toISOString();
    const files = await ggGet('https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,lastModifyingUser(displayName),webViewLink)&q=' + encodeURIComponent(`modifiedTime > '${since}' and trashed = false`));
    GG.drive = files.files || [];
  } catch (e) { GG.err = e.message; }
  GG.loading = false;
}
function ccGoogleCard(kind) {
  const base = { kind, icon: kind === 'mail' ? 'mail' : 'drive', title: kind === 'mail' ? 'Your email, last 24 hours' : 'Your Drive, last 24 hours', google: true };
  if (!ggOn()) return { ...base, kpis: [], say: 'Connect your Google account to read your email and Drive here.', needsGoogle: true };
  if (kind === 'mail') {
    const m = GG.mail || []; const un = m.filter((x) => x.unread);
    return { ...base, kpis: [{ l: 'Emails', v: nfmt(m.length) }, { l: 'Unread', v: nfmt(un.length), tone: un.length ? 'warn' : 'good' }], list: m.map((x) => ({ t: x.subject, s: x.from + (x.snippet ? ' · ' + x.snippet.slice(0, 90) : ''), m: new Date(x.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), href: `https://mail.google.com/mail/u/0/#all/${x.id}`, hot: x.unread })),
      say: m.length ? `You have ${nfmt(m.length)} emails in the last day, ${nfmt(un.length)} unread. The latest is from ${m[0].from}: ${m[0].subject}.` : 'No new email in the last day.' };
  }
  const d = GG.drive || [];
  return { ...base, kpis: [{ l: 'Files changed', v: nfmt(d.length) }], list: d.map((f) => ({ t: f.name, s: (f.lastModifyingUser?.displayName || '') + ' · ' + (f.mimeType || '').split('.').pop().replace('application/', ''), m: new Date(f.modifiedTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), href: f.webViewLink })),
    say: d.length ? `${nfmt(d.length)} files changed in your Drive in the last day. The latest is ${d[0].name}${d[0].lastModifyingUser?.displayName ? ', by ' + d[0].lastModifyingUser.displayName : ''}.` : 'Nothing changed in your Drive in the last day.' };
}
function ggContext() {
  if (!ggOn()) return '';
  return `\nMy email today: ${(GG.mail || []).slice(0, 15).map((m) => `${m.from}: ${m.subject}${m.unread ? ' (unread)' : ''}`).join('; ') || 'none'}\nMy Drive files changed today: ${(GG.drive || []).slice(0, 15).map((f) => f.name).join('; ') || 'none'}`;
}

/* ---------- voice: a female voice, and a Stop button ---------- */
const CC_FEMALE = /(female|woman|heera|neerja|veena|kalpana|swara|priya|aditi|raveena|samantha|zira|aria|jenny|michelle|sonia|libby|natasha|karen|moira|tessa|serena|fiona|victoria|allison|ava|susan|catherine|emma|joanna|salli|kimberly|kendra|ivy|google uk english female|google us english)/i;
const CC_MALE = /(male|david|mark|guy|ravi|rishi|prabhat|daniel|alex|fred|thomas|george|ryan|eric|brian|matthew|justin|joey|google uk english male)/i;
function ccVoice() {
  const vs = ('speechSynthesis' in window ? window.speechSynthesis.getVoices() : []).filter((x) => /^en/i.test(x.lang));
  const fem = vs.filter((x) => CC_FEMALE.test(x.name) && !/\bmale\b/i.test(x.name.replace(/female/i, '')));
  return fem.find((x) => /en-IN/i.test(x.lang)) || fem.find((x) => /natural|neural|online/i.test(x.name)) || fem[0] || vs.find((x) => /en-IN/i.test(x.lang) && !CC_MALE.test(x.name)) || vs.find((x) => !CC_MALE.test(x.name)) || vs[0] || null;
}
if ('speechSynthesis' in window) { try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices(); } catch (_) { /* */ } }
/* ---------- speaking: sentence by sentence (long speech gets cut off in Chrome), with captions; phones need a first tap to unlock sound ---------- */
function ccUnlock() {
  if (CC.unlocked || !('speechSynthesis' in window)) return;
  try { const u = new window.SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); window.speechSynthesis.resume(); CC.unlocked = true; } catch (_) { /* */ }
}
function ccSentences(t) { return String(t || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || []; }
function ccSay(text) {
  const parts = ccSentences(text); CC.capParts = parts; CC.capAt = -1; ccCaption();
  if (!CC.speak || !parts.length || !('speechSynthesis' in window)) return;
  try {
    const ss = window.speechSynthesis; ss.cancel(); ss.resume();
    const v0 = ccVoice(); CC.speaking = true; ccVoiceUI();
    parts.forEach((p, i) => {
      const u = new window.SpeechSynthesisUtterance(p.replace(/₹\s?/g, 'rupees ').replace(/\bP([1-5])\b/g, 'P $1').replace(/\bCoE\b/g, 'C O E').replace(/\bRPTO\b/g, 'R P T O'));
      if (v0) { u.voice = v0; u.lang = v0.lang; } else u.lang = 'en-IN';
      u.rate = 1.0; u.pitch = 1.1;
      u.onstart = () => { CC.capAt = i; ccCaption(); };
      if (i === parts.length - 1) u.onend = u.onerror = () => { CC.speaking = false; CC.capAt = parts.length; ccVoiceUI(); ccCaption(); };
      ss.speak(u);
    });
  } catch (_) { CC.speaking = false; ccVoiceUI(); }
}
function ccHush() { try { window.speechSynthesis?.cancel(); } catch (_) { /* */ } CC.speaking = false; ccVoiceUI(); }
function ccVoiceUI() { document.querySelectorAll('.gc-hush').forEach((b) => { b.hidden = !CC.speaking; }); document.querySelector('.gc')?.classList.toggle('speaking', !!CC.speaking); }
function ccCaption() {
  const box = document.querySelector('.gc-cap'); if (!box) return;
  const p = CC.capParts || []; box.hidden = !p.length;
  box.innerHTML = p.map((x, i) => `<span class="${i < CC.capAt ? 'said' : i === CC.capAt ? 'now' : ''}">${esc(x)}</span>`).join(' ');
}
window.addEventListener('hashchange', () => { if (!/^#connect/.test(location.hash)) { ccHush(); CC.rec?.abort?.(); document.body.classList.remove('gc-on'); } });

/* ---------- listening: tap Talk to Garuda, speak, and a 2-second pause sends it ---------- */
function ccListen(el, on) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  ccUnlock();
  if (!SR) return toast('This browser cannot listen. Use Chrome (Android, Windows, Mac) or Safari on iPhone with Siri switched on, or type the question.', true);
  if (on === false) { CC.rec?.stop(); return; }
  if (CC.listening) return;
  ccHush();
  const r = new SR(); CC.rec = r; r.lang = 'en-IN'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
  CC.listening = true; CC.heard = ''; ccPaint(el);
  let pause = null; const quiet = setTimeout(() => { if (!CC.heard) r.stop(); }, 9000);
  const arm = () => { clearTimeout(pause); pause = setTimeout(() => r.stop(), 2000); };
  r.onresult = (e) => { let s0 = ''; for (const res of e.results) s0 += res[0].transcript; CC.heard = s0.trim(); const h = el.querySelector('.gc-heard'); if (h) h.textContent = CC.heard || 'Listening…'; arm(); };
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Allow the microphone for this site (tap the lock or “aA” in the address bar → Microphone → Allow).' : 'Could not hear that: ' + e.error, true); };
  r.onend = () => { clearTimeout(pause); clearTimeout(quiet); CC.listening = false; CC.rec = null; const q = CC.heard; ccPaint(el); if (q) ccAsk(q, el); };
  try { r.start(); } catch (_) { CC.listening = false; ccPaint(el); }
}

/* ---------- understanding the question: when, and about what ---------- */
function ccRange(s) {
  const d0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const now = new Date(); const today = d0(now); const day = 864e5;
  const mk = (from, to, label) => ({ from, to, label, ds: localDate(from), de: localDate(new Date(to - 1)) });
  if (/yesterday/.test(s)) return mk(new Date(today - day), today, 'yesterday');
  if (/last week|previous week/.test(s)) { const mon = new Date(today - ((today.getDay() + 6) % 7) * day); return mk(new Date(mon - 7 * day), mon, 'last week'); }
  if (/this week|week/.test(s)) { const mon = new Date(today - ((today.getDay() + 6) % 7) * day); return mk(mon, new Date(+today + day), 'this week'); }
  if (/last month|previous month/.test(s)) { const a = new Date(today.getFullYear(), today.getMonth() - 1, 1); return mk(a, new Date(today.getFullYear(), today.getMonth(), 1), 'last month'); }
  if (/this month|month/.test(s)) return mk(new Date(today.getFullYear(), today.getMonth(), 1), new Date(+today + day), 'this month');
  if (/this year|financial year|\bfy\b|year/.test(s)) { const fy = TG.per('fy'); return mk(new Date(fy.start), new Date(+today + day), TG.label(TG.fy())); }
  const m = s.match(/last (\d+) days?/); if (m) return mk(new Date(today - (Number(m[1]) - 1) * day), new Date(+today + day), `the last ${m[1]} days`);
  return mk(today, new Date(+today + day), 'today');
}
function ccTopic(s) {
  if (/\b(e-?mails?|mail|inbox|gmail)\b/.test(s)) return 'mail';
  if (/\b(drive|files?|docs?|documents?|sheets?|slides)\b/.test(s)) return 'drive';
  if (/potential|pipeline|deal|forecast|closing|proposal|quotation/.test(s)) return 'deals';
  if (/revenue|target|collect|achiev|money|behind|pace|balance|payment|sales figure|how much/.test(s)) return 'revenue';
  if (/\bwon\b|\bwin|sale|closed/.test(s)) return 'won';
  if (/\blost\b|drop/.test(s)) return 'lost';
  if (/overdue|follow/.test(s)) return 'follow';
  if (/referr/.test(s)) return 'referrals';
  if (/source|campaign|instagram|facebook|meta|google ads|website|justdial|indiamart/.test(s)) return 'sources';
  if (/\blead|hot|warm|p1|p2|enquir|never/.test(s)) return 'leads';
  if (/task/.test(s)) return 'tasks';
  if (/team|who|people|staff|perform|best|top caller|calls?\b/.test(s)) return 'team';
  return 'day';
}
const inR = (d, R) => d && localDate(d) >= R.ds && localDate(d) <= R.de;
async function ccSheetCalls(R) {
  if (DB.mode !== 'live' || !DB.sb) return [];
  try { const { data } = await DB.sb.from('remarks').select('lead_id,author,created_at,outcome').eq('channel', 'Sales sheet').neq('outcome', 'Note').gte('created_at', R.from.toISOString()).lt('created_at', R.to.toISOString()).limit(5000); return data || []; } catch (_) { return []; }
}
const slab = (label, value, sub = '', tone = '', extra = {}) => ({ label, value, sub, tone, ...extra });
const leadItems = (ls, deal = false) => ls.map((l) => ({ t: deal ? L.company(l) || l.name : l.name, s: deal ? `${l.stage} · ${L.ownerLabel(l)}` : `${L.company(l) || l.phone || ''} · ${L.ownerLabel(l)}`, r: deal ? inrShort(l.value) : l.next_followup_at ? fmtDate(l.next_followup_at) : (l.campaign_tier || '').slice(0, 2), lead: l.id }));

/* the answer: a sentence to say, and the glass panels to show */
async function ccAnswer(q) {
  const s = q.toLowerCase(); const R = ccRange(s); const F = ccFacts(); const ls = F.ls; const now = new Date();
  const person = DB.t.profiles.find((p) => p.active && p.full_name && p.full_name.split(' ')[0].length > 2 && new RegExp('\\b' + p.full_name.split(' ')[0].toLowerCase() + '\\b').test(s));
  const topic = person ? 'person' : ccTopic(s);
  const crmCalls = DB.t.remarks.filter((r) => r.outcome !== 'Note' && inR(r.created_at, R) && ls.some((l) => l.id === r.lead_id));
  const newLeads = ls.filter((l) => !l.is_deal && inR(l.enquiry_date || l.created_at, R));
  const won = ls.filter((l) => L.won(l) && inR(l.won_at, R)); const lost = ls.filter((l) => L.lost(l) && inR(l.stage_changed_at || l.updated_at, R));
  const newDeals = ls.filter((l) => l.is_deal && inR(l.deal_at, R));
  const pays = DB.t.payments.filter((p) => inR(p.verified_at || p.claimed_at, R));
  const when = R.label;
  if (topic === 'mail' || topic === 'drive') {
    if (ggOn() && !GG.mail) await ggFetch();
    const c = ccGoogleCard(topic);
    return { title: c.title, icon: c.icon, say: c.say, needsGoogle: c.needsGoogle, slabs: c.needsGoogle ? [] : [slab(c.kpis[0]?.l || '', c.kpis[0]?.v || '', '', '', {}), ...(c.kpis[1] ? [slab(c.kpis[1].l, c.kpis[1].v, '', c.kpis[1].tone)] : []), slab(topic === 'mail' ? 'Inbox · last 24 h' : 'Files changed', '', '', '', { wide: true, list: (c.list || []).map((x) => ({ t: x.t, s: x.s, r: x.m, href: x.href, hot: x.hot })) })] };
  }
  if (topic === 'deals') {
    const d = [...F.deals].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
    const byStage = Object.entries(groupBy(d, (l) => l.stage)).map(([k, a]) => ({ t: k, s: `${a.length} deal${a.length === 1 ? '' : 's'}`, r: inrShort(sum(a, (l) => l.value)) })).sort((a, b) => b.s.localeCompare(a.s));
    const soon = [...F.closing].sort((a, b) => String(a.expected_close).localeCompare(String(b.expected_close)));
    return { title: 'Deal potential', icon: 'deal', go: 'deals', say: `The pipeline holds ${nfmt(d.length)} open deals worth ${inrWords(sum(d, (l) => l.value))}. Weighted by stage, the realistic potential is ${inrWords(F.wtd)}. ${soon.length ? `${nfmt(soon.length)} are due to close in the next two weeks, starting with ${L.company(soon[0]) || soon[0].name}.` : 'None has a closing date in the next two weeks.'}${d[0] ? ` The biggest is ${L.company(d[0]) || d[0].name} at ${inrWords(d[0].value)}.` : ''}`,
      slabs: [slab('Pipeline', inrShort(sum(d, (l) => l.value)), `${nfmt(d.length)} open deals`), slab('Weighted potential', inrShort(F.wtd), 'value × stage win %', 'info'), slab('Top deals', '', '', '', { wide: true, list: leadItems(d.slice(0, 10), true) }), slab('Closing in 14 days', nfmt(soon.length), soon[0] ? `next: ${fmtDate(soon[0].expected_close)}` : 'no dates set', soon.length ? 'warn' : ''), slab('By stage', '', '', '', { list: byStage.slice(0, 8) })] };
  }
  if (topic === 'revenue') {
    const X = F.X;
    return { title: 'Revenue against target', icon: 'rev', go: 'revenue', say: X.t ? `For ${TG.label(TG.fy())}, ${inrWords(X.a)} is achieved against a target of ${inrWords(X.t)}, which is ${X.p} percent. ${inrWords(X.c)} has been collected and ${inrWords(X.d)} is still due. ${X.lag > 0 ? `That is ${inrWords(X.lag)} behind an even pace.` : 'That is ahead of an even pace.'}${pays.length ? ` ${nfmt(pays.length)} payments came in ${when}.` : ''}` : `${inrWords(X.a)} is booked this year. No target is set.`,
      slabs: [slab('Target', X.t ? inrShort(X.t) : '—', TG.label(TG.fy())), slab('Achieved', inrShort(X.a), X.t ? `${X.p}% of target` : '', X.p == null ? '' : toneFor(X.p), { meter: X.t ? X.p : null }), slab('Collected', inrShort(X.c), 'money in the bank', 'good'), slab('Balance due', inrShort(X.d), 'still to collect', X.d ? 'warn' : ''), slab(X.lag > 0 ? 'Behind pace' : 'Ahead of pace', inrShort(Math.abs(X.lag || 0)), 'against an even pace', X.lag > 0 ? 'bad' : 'good')] };
  }
  if (topic === 'won' || topic === 'lost') {
    const a = topic === 'won' ? won : lost; const v = sum(a, (l) => l.value);
    return { title: topic === 'won' ? `Won ${when}` : `Lost ${when}`, icon: topic === 'won' ? 'check' : 'x', go: 'deals', say: a.length ? `${nfmt(a.length)} ${topic === 'won' ? 'sales were won' : 'leads and deals were lost'} ${when}${v ? `, worth ${inrWords(v)}` : ''}. ${a.slice(0, 3).map((l) => L.company(l) || l.name).join(', ')}.` : `Nothing was ${topic} ${when}.`,
      slabs: [slab(topic === 'won' ? 'Won' : 'Lost', nfmt(a.length), when, topic === 'won' ? 'good' : 'bad'), slab('Value', inrShort(v), ''), slab(topic === 'won' ? 'The sales' : 'Lost', '', '', '', { wide: true, list: leadItems(a.slice(0, 12), true) }), ...(topic === 'lost' ? [slab('Reasons', '', '', '', { list: Object.entries(groupBy(a, (l) => l.lost_reason || 'No reason given')).map(([k, x]) => ({ t: k, r: nfmt(x.length) })).slice(0, 6) })] : [])] };
  }
  if (topic === 'follow') {
    const done = crmCalls.filter((r) => { const l = DB.get('leads', r.lead_id); return l && /follow/i.test(l.stage || ''); });
    return { title: 'Follow-ups', icon: 'clock', go: 'followups', say: F.over.length ? `${nfmt(F.over.length)} follow-ups are overdue and ${nfmt(F.dueToday.length)} are due today. The oldest is ${F.over.sort((a, b) => String(a.next_followup_at).localeCompare(String(b.next_followup_at)))[0].name}. Clear the overdue ones first.` : `No follow-up is overdue. ${nfmt(F.dueToday.length)} are due today.`,
      slabs: [slab('Overdue', nfmt(F.over.length), 'past their date', F.over.length ? 'bad' : 'good'), slab('Due today', nfmt(F.dueToday.length), '', F.dueToday.length ? 'warn' : ''), slab('Overdue first', '', '', '', { wide: true, list: leadItems(F.over.slice(0, 12)) }), slab('In follow-up', nfmt(F.fu.length), `${nfmt(done.length)} worked ${when}`)] };
  }
  if (topic === 'referrals') {
    const refs = ls.filter((l) => l.referred_by || /referr?al/i.test(l.source || ''));
    const inr = refs.filter((l) => inR(l.created_at, R));
    return { title: 'Referrals', icon: 'team', go: 'leads', say: `${nfmt(refs.length)} referral leads in all, ${nfmt(inr.length)} ${when}. ${nfmt(refs.filter((l) => l.is_deal || L.won(l)).length)} became deals or sales.`, slabs: [slab('Referrals', nfmt(refs.length), 'all time'), slab(when, nfmt(inr.length), 'new referrals'), slab('Latest referrals', '', '', '', { wide: true, list: leadItems(refs.slice(-10).reverse()) })] };
  }
  if (topic === 'sources') {
    const pool = /all|total|ever/.test(s) ? ls : newLeads.length ? newLeads : ls.filter((l) => inR(l.enquiry_date || l.created_at, ccRange('this month')));
    const by = Object.entries(groupBy(pool, (l) => l.source || 'Unknown')).sort((a, b) => b[1].length - a[1].length);
    return { title: 'Where leads come from', icon: 'leads', go: 'leads', say: by.length ? `Of ${nfmt(pool.length)} leads, ${by.slice(0, 3).map(([k, a]) => `${nfmt(a.length)} came from ${k}`).join(', ')}.` : 'No leads in that period.',
      slabs: [slab('Leads', nfmt(pool.length), newLeads.length ? when : 'this month'), slab('Top source', by[0]?.[0] || '—', by[0] ? `${nfmt(by[0][1].length)} leads` : ''), slab('By source', '', '', '', { wide: true, list: by.slice(0, 10).map(([k, a]) => ({ t: k, s: `${nfmt(a.filter((l) => l.is_deal || L.won(l)).length)} became deals`, r: nfmt(a.length) })) })] };
  }
  if (topic === 'leads') {
    return { title: `Leads ${when}`, icon: 'leads', go: 'leads', say: `${nfmt(newLeads.length)} new leads came in ${when}. ${nfmt(F.hot.length)} hot P1 and ${nfmt(F.warm.length)} warm P2 leads are open, and ${nfmt(F.never.length)} have never been called.${F.hot[0] ? ` Call ${F.hot[0].name} first.` : ''}`,
      slabs: [slab('New', nfmt(newLeads.length), when, newLeads.length ? 'good' : ''), slab('Hot P1', nfmt(F.hot.length), 'call now', F.hot.length ? 'bad' : ''), slab(newLeads.length ? 'New leads' : 'Hot and warm', '', '', '', { wide: true, list: leadItems((newLeads.length ? newLeads : [...F.hot, ...F.warm]).slice(0, 12)) }), slab('Warm P2', nfmt(F.warm.length), ''), slab('Never called', nfmt(F.never.length), 'no call yet', F.never.length ? 'warn' : '')] };
  }
  if (topic === 'tasks') {
    return { title: 'Tasks', icon: 'task', go: 'tasks', say: `${nfmt(F.tasksDone.length)} task steps were done today and ${nfmt(F.tasksLate.length)} tasks are overdue.`, slabs: [slab('Done today', nfmt(F.tasksDone.length), 'task steps', 'good'), slab('Overdue', nfmt(F.tasksLate.length), '', F.tasksLate.length ? 'bad' : 'good'), slab('Overdue tasks', '', '', '', { wide: true, list: F.tasksLate.slice(0, 12).map((t) => ({ t: t.title, s: DB.pname(t.owner), r: fmtDate(t.due_date) })) })] };
  }
  const sheet = R.label === 'today' ? [] : await ccSheetCalls(R);
  const calls = [...crmCalls, ...sheet];
  const byWho = Object.entries(groupBy(calls, (r) => DB.pname(r.author))).sort((a, b) => b[1].length - a[1].length);
  if (topic === 'person') {
    const p = person; const mine = F.open.filter((l) => l.owner === p.id); const od = mine.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < now);
    const pc = calls.filter((r) => r.author === p.id); const pw = won.filter((l) => l.owner === p.id || l.closed_by === p.id); const x = tva({ dept: ST.dept, pid: p.id }, TG.per('fy'));
    return { title: p.full_name, icon: 'me', go: 'team', say: `${p.full_name.split(' ')[0]} logged ${nfmt(pc.length)} calls or remarks ${when}${pw.length ? ` and won ${nfmt(pw.length)}` : ''}. ${nfmt(mine.length)} leads and deals are open with ${nfmt(od.length)} follow-ups overdue.${x.t ? ` ${x.p} percent of the yearly target is achieved.` : ''}`,
      slabs: [slab('Calls ' + when, nfmt(pc.length), ''), slab('Open', nfmt(mine.length), 'leads and deals'), slab(od.length ? 'Overdue follow-ups' : 'Open deals', '', '', '', { wide: true, list: leadItems((od.length ? od : mine.filter((l) => l.is_deal)).slice(0, 12), !od.length) }), slab('Overdue', nfmt(od.length), '', od.length ? 'bad' : 'good'), ...(x.t ? [slab('Target', `${x.p}%`, inrShort(x.a) + ' of ' + inrShort(x.t), toneFor(x.p), { meter: x.p })] : [])] };
  }
  if (topic === 'team') {
    return { title: `Team ${when}`, icon: 'team', go: 'team', say: byWho.length ? `${nfmt(calls.length)} calls and remarks ${when}. ${byWho.slice(0, 4).map(([n, a]) => `${n.split(' ')[0]} ${a.length}`).join(', ')}.${won.length ? ` ${nfmt(won.length)} sales won.` : ''}` : `No calls were logged ${when}.`,
      slabs: [slab('Calls and remarks', nfmt(calls.length), when), slab('People active', nfmt(byWho.length), ''), slab('Who did what', '', '', '', { wide: true, list: byWho.slice(0, 12).map(([n, a]) => ({ t: n, s: `${a.filter((r) => r.outcome === 'No answer').length} not answered`, r: nfmt(a.length) })) }), slab('Won', nfmt(won.length), inrShort(sum(won, (l) => l.value)), won.length ? 'good' : '')] };
  }
  /* what happened (today, yesterday, this week …) */
  const happened = [
    calls.length ? `${nfmt(calls.length)} calls and remarks were logged${byWho[0] ? `, most by ${byWho[0][0].split(' ')[0]} with ${byWho[0][1].length}` : ''}` : 'no calls were logged',
    `${nfmt(newLeads.length)} new lead${newLeads.length === 1 ? '' : 's'} came in`,
    newDeals.length ? `${nfmt(newDeals.length)} became deals` : '',
    won.length ? `${nfmt(won.length)} sale${won.length === 1 ? ' was' : 's were'} won worth ${inrWords(sum(won, (l) => l.value))}` : '',
    pays.length ? `${nfmt(pays.length)} payments came in` : '',
  ].filter(Boolean);
  return { title: `What happened ${when}`, icon: 'spark', say: `${when[0].toUpperCase() + when.slice(1)}, ${happened.join(', ')}. ${R.label === 'today' ? (F.over.length ? `${nfmt(F.over.length)} follow-ups are overdue.` : 'No follow-up is overdue.') : ''}`,
    slabs: [slab('Calls', nfmt(calls.length), byWho[0] ? `top: ${byWho[0][0].split(' ')[0]}` : when), slab('New leads', nfmt(newLeads.length), when, newLeads.length ? 'good' : ''), slab('Activity', '', '', '', { wide: true, list: [...won.map((l) => ({ t: '🏆 Won: ' + (L.company(l) || l.name), s: L.ownerLabel(l), r: inrShort(l.value), lead: l.id })), ...newDeals.map((l) => ({ t: 'New deal: ' + (L.company(l) || l.name), s: L.ownerLabel(l), r: inrShort(l.value), lead: l.id })), ...newLeads.slice(0, 8).map((l) => ({ t: 'New lead: ' + l.name, s: l.source || '', r: '', lead: l.id })), ...byWho.slice(0, 6).map(([n, a]) => ({ t: n, s: 'calls and remarks', r: nfmt(a.length) }))].slice(0, 14) }), slab('Won', nfmt(won.length), inrShort(sum(won, (l) => l.value)), won.length ? 'good' : ''), slab(R.label === 'today' ? 'Overdue now' : 'Lost', nfmt(R.label === 'today' ? F.over.length : lost.length), '', (R.label === 'today' ? F.over.length : lost.length) ? 'bad' : 'good')] };
}

/* ---------- asking ---------- */
async function ccAsk(q, el) {
  q = (q || '').trim(); if (!q) return;
  CC.q = q; CC.busy = true; CC.ans = null; ccPaint(el);
  const A = await ccAnswer(q);
  let text = '', src = 'From the CRM';
  if (DB.settings.ai?.enabled !== false && DB.mode === 'live') {
    try {
      const r = await DB.fn('ai', { action: 'ask', question: `${q}\n\nYou are Garuda, the CRM's voice assistant. Answer in 2 to 4 short spoken sentences, numbers in Indian style (lakh, crore). Facts the CRM computed for this question (${A.title}): ${A.say}\nPanels on screen: ${A.slabs.map((x) => `${x.label}: ${x.value || ''} ${x.sub || ''}${x.list ? ' [' + x.list.slice(0, 8).map((i) => `${i.t} ${i.r || ''}`).join('; ') + ']' : ''}`).join(' | ')}\nThe day so far: ${ccTopics(ccFacts()).map((x) => x.say).join(' ')}${ggContext()}` });
      if (r?.answer) { text = r.answer; src = 'Claude'; CC.aiErr = ''; }
    } catch (e) { CC.aiErr = String(e.message || e); }
  }
  if (!text) text = A.say;
  CC.busy = false; CC.ans = { ...A, text, src }; ccPaint(el); ccSay(text);
}

/* ---------- the screen ---------- */
const GC_RING = [['day', 'Today', 'spark', 'What happened today'], ['yday', 'Yesterday', 'cal', 'What happened yesterday'], ['leads', 'Leads', 'leads', 'How are the leads today'], ['follow', 'Follow-ups', 'clock', 'Which follow-ups are overdue'], ['deals', 'Deal potential', 'deal', 'What is the deal potential'], ['revenue', 'Revenue', 'rev', 'How is revenue against target'], ['team', 'Team', 'team', 'How is the team doing today'], ['mail', 'Email', 'mail', 'Any new email'], ['drive', 'Drive', 'drive', 'What changed in my Drive']];
function gcRing() {
  const ticks = Array.from({ length: 72 }, (_, i) => { const a = (i / 72) * Math.PI * 2; const r1 = 140, r2 = i % 6 ? 145 : 151; return `<line x1="${160 + r1 * Math.cos(a)}" y1="${160 + r1 * Math.sin(a)}" x2="${160 + r2 * Math.cos(a)}" y2="${160 + r2 * Math.sin(a)}"/>`; }).join('');
  return `<svg viewBox="0 0 320 320" aria-hidden="true" class="gc-svg"><defs><radialGradient id="gcg" cx="50%" cy="50%" r="50%"><stop offset="50%" stop-color="#4599FE" stop-opacity="0"/><stop offset="78%" stop-color="#4599FE" stop-opacity=".28"/><stop offset="100%" stop-color="#4599FE" stop-opacity="0"/></radialGradient></defs>
    <circle cx="160" cy="160" r="158" fill="url(#gcg)"/><g class="gc-ticks">${ticks}</g>
    <circle class="gc-a1" cx="160" cy="160" r="128" fill="none" stroke-width="2.5" stroke-dasharray="140 40 30 60 220 80"/>
    <circle class="gc-a2" cx="160" cy="160" r="113" fill="none" stroke-width="8" stroke-dasharray="70 330" stroke-linecap="round"/>
    <circle class="gc-a3" cx="160" cy="160" r="100" fill="none" stroke-width="1.5" stroke-dasharray="4 7"/>
    <circle class="gc-core" cx="160" cy="160" r="86" fill="none" stroke-width="5"/></svg>`;
}
function gcSlab(x, i, n) {
  const mid = (n - 1) / 2; const off = i - mid;
  return `<section class="gc-slab ${x.wide ? 'wide' : ''} ${x.tone ? 't-' + x.tone : ''}" style="--o:${off};--d:${i * 70}ms">
    <h4>${esc(x.label)}</h4>
    <div class="gc-glass">${x.value !== '' && x.value != null ? `<b class="gc-v">${esc(String(x.value))}</b>` : ''}${x.sub ? `<span class="gc-s">${esc(x.sub)}</span>` : ''}
      ${x.meter != null ? `<div class="gc-meter"><i style="width:${clamp(x.meter, 0, 100)}%"></i></div>` : ''}
      ${x.list ? (x.list.length ? `<ul class="gc-list">${x.list.map((r) => `<li>${r.lead ? `<button type="button" data-lead="${r.lead}">` : r.href ? `<a href="${esc(r.href)}" target="_blank" rel="noopener" class="${r.hot ? 'hot' : ''}">` : '<div>'}<span class="grow"><b>${esc(r.t || '')}</b>${r.s ? `<span>${esc(r.s)}</span>` : ''}</span>${r.r ? `<em>${esc(String(r.r))}</em>` : ''}${r.lead ? '</button>' : r.href ? '</a>' : '</div>'}</li>`).join('')}</ul>` : '<p class="gc-none">Nothing here.</p>') : ''}
    </div></section>`;
}
function ccPaint(el) {
  const box = el.querySelector('#gcbox'); if (!box) return;
  const F = ccFacts(); const A = CC.ans;
  const brief = `${nfmt(F.rem.length)} calls · ${nfmt(F.fresh.length)} new · ${nfmt(F.over.length)} overdue`;
  const state = CC.listening ? 'listening' : CC.busy ? 'thinking' : A ? 'answer' : 'idle';
  box.className = `gc ${state} ${CC.speaking ? 'speaking' : ''}`;
  box.innerHTML = `
    <header class="gc-top"><button type="button" class="gc-x" id="gcexit" aria-label="Leave Garuda Connect">${svg('chevl')} <span>Exit</span></button>
      <div class="gc-brand"><i></i> GARUDA CONNECT <span>· ${esc(dept(ST.dept)?.name || 'RPTO Team')}</span></div>
      <div class="gc-tr">${ggOn() ? `<span class="gc-chip on">${svg('google')} Google on</span>` : `<button type="button" class="gc-chip" data-gghelp>${svg('google')} Connect Google</button>`}${themeSwitch('gcthm', true)}</div></header>
    <div class="gc-center">
      <div class="gc-ring">${gcRing()}
        <button type="button" class="gc-core-btn" id="gctalk2" aria-label="Talk to Garuda"><span class="gc-name">${state === 'listening' ? 'LISTENING' : state === 'thinking' ? 'THINKING' : CC.speaking ? 'SPEAKING' : 'GARUDA'}</span><span class="gc-sub">${state === 'listening' ? 'pause to send' : esc(brief)}</span></button>
        ${A || CC.busy ? '' : GC_RING.map(([k, t, ic], i) => `<button type="button" class="gc-seg" data-gq="${esc(GC_RING[i][3])}" style="--a:${i * (360 / GC_RING.length) - 90}deg">${svg(ic)}<span>${t}</span></button>`).join('')}
      </div>
      ${state === 'listening' ? `<p class="gc-heard">${esc(CC.heard || 'Listening… ask anything')}</p>` : ''}
      ${CC.busy ? `<p class="gc-heard">“${esc(CC.q || '')}”</p>` : ''}
    </div>
    ${A ? `<div class="gc-deck-wrap"><div class="gc-q"><span>“${esc(CC.q || '')}”</span><button type="button" id="gcclose" aria-label="Close the answer">${svg('x')}</button></div>
      <div class="gc-deck">${A.slabs.map((x, i) => gcSlab(x, i, A.slabs.length)).join('')}</div>
      ${A.needsGoogle ? `<div class="gc-gneed">${svg('google')} <span>Connect your Google account to see your email and Drive.</span><button type="button" class="btn small primary" data-gghelp>How to connect</button></div>` : ''}
      ${A.go ? `<button type="button" class="gc-open" data-ccgo="${esc(A.go)}">Open in the CRM →</button>` : ''}</div>` : ''}
    <div class="gc-cap" ${CC.capParts?.length ? '' : 'hidden'}></div>
    <footer class="gc-bot">
      ${CC.listening ? `<button type="button" class="gc-talk stop" id="gcstop">${svg('stop')} Stop</button>` : `<button type="button" class="gc-talk" id="gctalk">${svg('mic')} Talk to Garuda</button>`}
      <button type="button" class="gc-talk hush gc-hush" id="gchush" ${CC.speaking ? '' : 'hidden'}>${svg('mute')} Stop voice</button>
      <form class="gc-type" id="gcform"><input id="gcq" placeholder="or type: what happened yesterday? what’s the deal potential?" autocomplete="off" aria-label="Ask Garuda"><button type="submit" aria-label="Ask">${svg('send')}</button></form>
      <label class="gc-spk"><input type="checkbox" id="gcspk" ${CC.speak ? 'checked' : ''}> Voice</label>
      ${A ? `<span class="gc-src">${esc(A.src)}${A.src !== 'Claude' && CC.aiErr ? ` · Claude not connected (${esc(CC.aiErr.includes('ANTHROPIC') ? 'Anthropic key not added in Supabase' : CC.aiErr.slice(0, 60))})` : ''}</span>` : ''}
    </footer>`;
  ccCaption(); ccBind(el);
}
function ccBind(el) {
  const q = (id) => el.querySelector(id);
  q('#gcexit').onclick = () => { ccHush(); document.body.classList.remove('gc-on'); history.length > 1 ? history.back() : go('command'); };
  const talk = () => { ccUnlock(); if (CC.listening) ccListen(el, false); else ccListen(el, true); };
  q('#gctalk')?.addEventListener('click', talk); q('#gctalk2').onclick = talk;
  q('#gcstop')?.addEventListener('click', () => ccListen(el, false));
  q('#gchush').onclick = () => ccHush();
  q('#gcform').onsubmit = (e) => { e.preventDefault(); ccUnlock(); const v = q('#gcq').value; q('#gcq').value = ''; ccAsk(v, el); };
  q('#gcspk').onchange = (e) => { CC.speak = e.target.checked; try { localStorage.setItem('garuda-cc-speak', CC.speak ? '1' : '0'); } catch (_) { /* */ } if (!CC.speak) ccHush(); else ccUnlock(); };
  q('#gcclose')?.addEventListener('click', () => { CC.ans = null; CC.capParts = []; ccHush(); ccPaint(el); });
  el.querySelectorAll('[data-gq]').forEach((b) => (b.onclick = () => { ccUnlock(); ccAsk(b.dataset.gq, el); }));
  el.querySelectorAll('[data-ccgo]').forEach((b) => (b.onclick = () => { document.body.classList.remove('gc-on'); go(b.dataset.ccgo); }));
  el.querySelectorAll('.gc-deck [data-lead]').forEach((b) => (b.onclick = () => openLead(b.dataset.lead)));
  el.querySelectorAll('[data-gghelp]').forEach((b) => (b.onclick = () => ggHelp(el)));
  bindTheme(el);
}
/* connecting Google, step by step */
function ggHelp(el) {
  if (ggClientId()) return ggConnect(el);
  const admin = isHead();
  const m = openModal({ title: `${svg('google')} Connect Gmail and Drive`, width: 640,
    body: `<p>Garuda reads <b>your own</b> email and Drive, in your browser, after you sign in with Google. Nothing is copied into the CRM.</p>
      <p class="faint">This needs a one-time setup by an Admin (about 10 minutes, free). After that everyone just taps <b>Connect Google</b> and picks their account.</p>
      <ol class="gsteps">
        <li>Open <b>console.cloud.google.com</b> signed in with your company Google account. Top bar → <b>Select a project → New project</b> → name it <i>Garuda CRM</i> → Create.</li>
        <li>Search bar → <b>Gmail API</b> → Enable. Search again → <b>Google Drive API</b> → Enable.</li>
        <li>Left menu → <b>Google Auth Platform</b> (or “OAuth consent screen”) → Get started. App name <i>Garuda CRM</i>, your email for support → Audience: <b>Internal</b> → Create. (Internal means only @your-company accounts can use it, and Google does not need to review it.)</li>
        <li><b>Clients → Create client</b> → Application type <b>Web application</b> → under <b>Authorised JavaScript origins</b> add <code>${esc(location.origin)}</code> → Create.</li>
        <li>Copy the <b>Client ID</b> (it ends in <code>.apps.googleusercontent.com</code>; it is not a secret) and paste it below.</li>
      </ol>
      ${admin ? '<label class="field"><span>Client ID</span><input id="ggcid" placeholder="1234567890-abc.apps.googleusercontent.com"></label>' : '<p class="bad">Ask your Admin to do this once. Then come back and tap Connect Google.</p>'}
      <p class="faint" style="font-size:12px">If your company email is not on Google Workspace, choose Audience <b>External</b> instead and add each person’s email under <b>Test users</b>.</p>`,
    foot: `<button class="btn" data-c>Close</button>${admin ? '<button class="btn primary" id="ggsave">Save and connect</button>' : ''}` });
  m.el.querySelector('#ggsave')?.addEventListener('click', () => guard(async () => {
    const id = (m.el.querySelector('#ggcid').value || '').trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('That does not look like a Google client ID. It ends in .apps.googleusercontent.com');
    await DB.setSetting('google', { ...(DB.settings.google || {}), client_id: id }); m.close(); ggConnect(el);
  }, 'Saved. Everyone can now connect their own Gmail and Drive.'));
}
VIEWS.connect = {
  title: 'Garuda Connect', sub: 'Talk to the CRM.',
  render(el) {
    document.body.classList.add('gc-on');
    el.innerHTML = '<section id="gcbox" class="gc"></section>';
    ccPaint(el);
  },
};
