/* Garuda CRM · Claude Connect: a ring you tap or talk to, the day's topics as cards you can pin, answers read out */
'use strict';

const CC = { open: false, topic: 'today', listening: false, card: null, busy: false, rec: null, speak: true, speaking: false, stopAsked: false };
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

/* ---------- extra icons for this screen ---------- */
Object.assign(ICON, {
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  drive: '<path d="M8.5 3h7l6 10.5-3.5 6h-12L2.5 13.5z"/><path d="M8.5 3l6.5 11H21.5M2.5 13.5h13l-3.5 6"/>',
  google: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12h8M12 12v-0"/>',
});

/* ---------- the answer card: what you asked, a short spoken answer, the numbers and the list behind it ---------- */
function ccCard(kind, F, q) {
  const now = new Date(); const today = ccDay();
  const k = (l, v, tone = '') => ({ l, v, tone });
  if (kind === 'deals') {
    const d = [...F.deals].sort((a, b) => String(a.expected_close || '9').localeCompare(String(b.expected_close || '9')));
    return { kind, icon: 'deal', title: 'Deals', kpis: [k('Open deals', nfmt(d.length)), k('Pipeline', inrShort(sum(d, (l) => l.value))), k('Weighted', inrShort(F.wtd)), k('Closing in 14 days', nfmt(F.closing.length), F.closing.length ? 'warn' : ''), k('Won today', nfmt(F.wonToday.length), F.wonToday.length ? 'good' : '')], rows: d, cols: 'deal', go: 'deals',
      say: `${nfmt(d.length)} open deals worth ${inrWords(sum(d, (l) => l.value))}, ${inrWords(F.wtd)} weighted. ${nfmt(F.closing.length)} close in the next two weeks.${d[0] ? ` The next one to close is ${L.company(d[0]) || d[0].name}${d[0].expected_close ? ' on ' + fmtDate(d[0].expected_close) : ''}.` : ''}` };
  }
  if (kind === 'follow') {
    const rows = [...F.over, ...F.dueToday.filter((l) => !F.over.includes(l))];
    return { kind, icon: 'clock', title: 'Follow-ups', kpis: [k('Overdue', nfmt(F.over.length), F.over.length ? 'bad' : 'good'), k('Due today', nfmt(F.dueToday.length), F.dueToday.length ? 'warn' : ''), k('In follow-up', nfmt(F.fu.length))], rows, go: 'followups',
      say: F.over.length ? `${nfmt(F.over.length)} follow-ups are overdue and ${nfmt(F.dueToday.length)} are due today. Start with ${F.over[0].name}.` : `No follow-up is overdue. ${nfmt(F.dueToday.length)} are due today.` };
  }
  if (kind === 'leads') {
    const rows = F.fresh.length ? F.fresh : [...F.hot, ...F.warm];
    return { kind, icon: 'leads', title: F.fresh.length ? 'New leads today' : 'Hot and warm leads', kpis: [k('New today', nfmt(F.fresh.length), F.fresh.length ? 'good' : ''), k('Open leads', nfmt(F.open.filter((l) => !l.is_deal).length)), k('Hot P1', nfmt(F.hot.length), F.hot.length ? 'bad' : ''), k('Warm P2', nfmt(F.warm.length)), k('Never called', nfmt(F.never.length), F.never.length ? 'warn' : '')], rows, go: 'leads',
      say: `${nfmt(F.fresh.length)} new leads came in today. ${nfmt(F.hot.length)} hot and ${nfmt(F.warm.length)} warm leads are open, and ${nfmt(F.never.length)} have never been called.` };
  }
  if (kind === 'revenue') {
    const X = F.X;
    return { kind, icon: 'rev', title: 'Revenue against target', kpis: [k('Target', X.t ? inrShort(X.t) : '—'), k('Achieved', inrShort(X.a), X.p == null ? '' : toneFor(X.p)), k('Collected', inrShort(X.c), 'good'), k('Balance due', inrShort(X.d), X.d ? 'warn' : ''), k(X.lag > 0 ? 'Behind pace' : 'Ahead of pace', inrShort(Math.abs(X.lag || 0)), X.lag > 0 ? 'bad' : 'good')], meter: X.t ? X.p : null, go: 'revenue',
      list: DB.t.payments.filter((p) => ccIsToday(p.verified_at || p.claimed_at)).map((p) => ({ t: inrFull(p.amount), s: DB.get('leads', p.lead_id)?.name || '', m: p.status })),
      say: X.t ? `${inrWords(X.a)} achieved of ${inrWords(X.t)}, ${X.p} percent. ${inrWords(X.c)} collected and ${inrWords(X.d)} still due. ${X.lag > 0 ? `We are ${inrWords(X.lag)} behind an even pace.` : 'We are ahead of an even pace.'}` : `${inrWords(X.a)} booked this year.` };
  }
  if (kind === 'team') {
    const ppl = Object.entries(F.byWho).sort((a, b) => b[1].length - a[1].length);
    return { kind, icon: 'team', title: 'Team today', kpis: [k('Calls and remarks', nfmt(F.rem.length)), k('People active', nfmt(ppl.length)), k('Task steps done', nfmt(F.tasksDone.length), 'good'), k('Tasks overdue', nfmt(F.tasksLate.length), F.tasksLate.length ? 'warn' : '')], go: 'team',
      list: ppl.map(([n, a]) => ({ t: n, s: `${a.length} call${a.length === 1 ? '' : 's'} or remarks`, m: a.slice(-1)[0]?.outcome || '' })),
      say: ppl.length ? `${nfmt(F.rem.length)} calls and remarks today. ${ppl.slice(0, 4).map(([n, a]) => `${n.split(' ')[0]} ${a.length}`).join(', ')}.` : 'Nobody has logged a call today yet.' };
  }
  if (kind === 'tasks') {
    return { kind, icon: 'task', title: 'Tasks', kpis: [k('Steps done today', nfmt(F.tasksDone.length), 'good'), k('Overdue', nfmt(F.tasksLate.length), F.tasksLate.length ? 'bad' : 'good')], go: 'tasks',
      list: F.tasksLate.slice(0, 20).map((t) => ({ t: t.title, s: DB.pname(t.owner), m: 'due ' + fmtDate(t.due_date) })), say: `${nfmt(F.tasksDone.length)} task steps were done today and ${nfmt(F.tasksLate.length)} tasks are overdue.` };
  }
  if (kind === 'won') {
    const w = M.leads().filter((l) => L.won(l) && l.won_at && l.won_at.slice(0, 7) === today.slice(0, 7));
    return { kind, icon: 'check', title: 'Won this month', kpis: [k('Won today', nfmt(F.wonToday.length), 'good'), k('Won this month', nfmt(w.length), 'good'), k('Value', inrShort(sum(w, (l) => l.value)))], rows: w, cols: 'deal', go: 'deals',
      say: `${nfmt(w.length)} won this month, worth ${inrWords(sum(w, (l) => l.value))}. ${nfmt(F.wonToday.length)} today.` };
  }
  if (kind === 'mail') return ccGoogleCard('mail');
  if (kind === 'drive') return ccGoogleCard('drive');
  if (kind === 'person') {
    const p = q; const r = F.rem.filter((x) => x.author === p.id); const mine = F.open.filter((l) => l.owner === p.id);
    const od = mine.filter((l) => l.next_followup_at && new Date(l.next_followup_at) < now); const x = tva({ dept: ST.dept, pid: p.id }, TG.per('fy'));
    return { kind, icon: 'me', title: p.full_name, kpis: [k('Calls today', nfmt(r.length)), k('Open leads and deals', nfmt(mine.length)), k('Follow-ups overdue', nfmt(od.length), od.length ? 'bad' : 'good'), ...(x.t ? [k('Target achieved', x.p + '%', toneFor(x.p))] : [])], rows: od.length ? od : mine.filter((l) => l.is_deal), go: 'team',
      say: `${p.full_name}: ${nfmt(r.length)} calls or remarks today, ${nfmt(mine.length)} open leads and deals, ${nfmt(od.length)} follow-ups overdue.${x.t ? ` ${x.p} percent of target.` : ''}` };
  }
  /* today */
  return { kind: 'today', icon: 'spark', title: 'Today at a glance', kpis: [k('Calls and remarks', nfmt(F.rem.length)), k('New leads', nfmt(F.fresh.length), F.fresh.length ? 'good' : ''), k('Follow-ups overdue', nfmt(F.over.length), F.over.length ? 'bad' : 'good'), k('Due today', nfmt(F.dueToday.length), F.dueToday.length ? 'warn' : ''), k('Won today', nfmt(F.wonToday.length), F.wonToday.length ? 'good' : ''), k('Payments', nfmt(F.pays.length))],
    rows: [...F.over.slice(0, 6), ...F.fresh.slice(0, 6)], say: ccTopics(F).filter((x) => ['calls', 'new', 'over', 'won'].includes(x.id)).map((x) => x.say).join(' ') };
}
function ccIntent(q, F) {
  const s = q.toLowerCase();
  const person = DB.t.profiles.find((p) => p.active && p.full_name && s.includes(p.full_name.split(' ')[0].toLowerCase()) && p.full_name.split(' ')[0].length > 2);
  if (/\b(e-?mail|mail|inbox|gmail)/.test(s)) return 'mail';
  if (/\b(drive|file|files|doc|docs|document|sheet|slides)\b/.test(s)) return 'drive';
  if (person) return { person };
  if (/revenue|target|collect|achiev|money|behind|pace|balance|payment/.test(s)) return 'revenue';
  if (/won|win|sale|closed/.test(s)) return 'won';
  if (/deal|pipeline|clos|proposal/.test(s)) return 'deals';
  if (/overdue|follow/.test(s)) return 'follow';
  if (/lead|hot|warm|p1|p2|enquir|new|never/.test(s)) return 'leads';
  if (/task/.test(s)) return 'tasks';
  if (/team|who|people|staff|calls?/.test(s)) return 'team';
  return 'today';
}
const CC_TOPIC_KIND = { today: 'today', leads: 'leads', follow: 'follow', deals: 'deals', revenue: 'revenue', team: 'team', mail: 'mail', drive: 'drive' };

/* ---------- Google: today's email and Drive, read in the browser with the signed-in person's own Google account ---------- */
const GG = { token: null, exp: 0, mail: null, drive: null, loading: false, err: '' };
const ggClientId = () => DB.settings.google?.client_id || '';
const ggOn = () => GG.token && Date.now() < GG.exp;
function ggLoadScript() {
  return new Promise((res, rej) => { if (window.google?.accounts?.oauth2) return res(); const s0 = document.createElement('script'); s0.src = 'https://accounts.google.com/gsi/client'; s0.async = true; s0.onload = () => res(); s0.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.appendChild(s0); });
}
async function ggConnect(el) {
  if (!ggClientId()) return toast(isHead() ? 'Add the Google client ID first (the setup box under the ring).' : 'Ask your Admin to set up Google in Claude Connect.', true);
  try {
    await ggLoadScript();
    const tc = window.google.accounts.oauth2.initTokenClient({ client_id: ggClientId(), scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.metadata.readonly', hint: DB.me?.email || '',
      callback: async (r) => { if (r.error) { GG.err = r.error; ccPaint(el); return; } GG.token = r.access_token; GG.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60e3; GG.err = ''; await ggFetch(); ccPaint(el); } });
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
function ccSay(text) {
  if (!CC.speak || !text || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(String(text).replace(/₹/g, 'rupees ').replace(/\bP1\b/g, 'P 1').replace(/\bP2\b/g, 'P 2'));
    const v0 = ccVoice(); if (v0) { u.voice = v0; u.lang = v0.lang; } else u.lang = 'en-IN';
    u.rate = 1.0; u.pitch = 1.12;
    u.onstart = () => { CC.speaking = true; ccVoiceUI(); }; u.onend = u.onerror = () => { CC.speaking = false; ccVoiceUI(); };
    CC.speaking = true; ccVoiceUI();
    window.speechSynthesis.speak(u);
  } catch (_) { /* no voice */ }
}
function ccHush() { try { window.speechSynthesis?.cancel(); } catch (_) { /* */ } CC.speaking = false; ccVoiceUI(); }
function ccVoiceUI() { document.querySelectorAll('.cc-hush').forEach((b) => { b.hidden = !CC.speaking; }); document.querySelector('.cc-hud')?.classList.toggle('speaking', !!CC.speaking); }
/* leaving the screen stops the voice */
window.addEventListener('hashchange', () => { if (CC.speaking) ccHush(); if (CC.listening) CC.rec?.abort?.(); });

function ccListen(el, on) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice needs Chrome, Edge or Safari. Type the question instead.', true);
  if (on === false || (on === undefined && CC.listening)) { CC.stopAsked = true; CC.rec?.stop(); return; }
  if (CC.listening) return;
  ccHush();
  const r = new SR(); CC.rec = r; r.lang = 'en-IN'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
  CC.listening = true; CC.stopAsked = false; ccPaint(el);
  let finalText = '';
  r.onresult = (e) => { let s = ''; finalText = ''; for (const res of e.results) { s += res[0].transcript; if (res.isFinal) finalText += res[0].transcript; } const i = el.querySelector('#ccq'); if (i) i.value = s; };
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Allow the microphone for this site (the lock icon in the address bar) to talk to the CRM.' : 'Could not hear that: ' + e.error, true); };
  r.onend = () => { CC.listening = false; CC.rec = null; const q = (el.querySelector('#ccq')?.value || finalText).trim(); ccPaint(el); if (q) ccAsk(q, el); };
  try { r.start(); } catch (_) { CC.listening = false; ccPaint(el); }
}

/* ---------- asking ---------- */
async function ccAsk(q, el) {
  q = (q || '').trim(); if (!q) return;
  const F = ccFacts(); const it = ccIntent(q, F);
  if ((it === 'mail' || it === 'drive') && ggOn() && !GG.mail) await ggFetch();
  const card = it.person ? ccCard('person', F, it.person) : ccCard(it, F);
  CC.busy = true; CC.card = { ...card, q, text: '', src: '' }; ccPaint(el);
  let text = '', src = 'From the CRM';
  if (DB.settings.ai?.enabled !== false && DB.mode === 'live') {
    try {
      const r = await DB.fn('ai', { action: 'ask', question: `${q}\n\nAnswer in 2 to 4 short spoken sentences. What the CRM shows today (${fmtDate(ccDay())}):\n${ccContext(F)}\nCard on screen: ${card.title}: ${card.kpis.map((x) => x.l + ' ' + x.v).join(', ')}${ggContext()}` });
      if (r?.answer) { text = r.answer; src = 'Claude'; }
    } catch (_) { /* Claude is not connected yet: answer from the numbers */ }
  }
  if (!text) text = card.say;
  CC.busy = false; CC.card = { ...card, q, text, src }; ccPaint(el); ccSay(text);
}
function ccContext(F) {
  return ccTopics(F).map((x) => `${x.title}: ${x.big}. ${x.say}`).join('\n') + '\nPeople today: ' + Object.entries(F.byWho).map(([n, a]) => `${n} ${a.length}`).join(', ');
}
function ccShowTopic(k, el, speak = true) {
  CC.topic = k; const F = ccFacts(); const card = ccCard(CC_TOPIC_KIND[k] || 'today', F);
  CC.card = { ...card, q: '', text: card.say, src: 'From the CRM' }; ccPaint(el); if (speak) ccSay(card.say);
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
    <circle cx="150" cy="150" r="148" fill="url(#ccg)" class="cc-glow"/>
    <g class="cc-ticks">${ticks}</g>
    <circle class="cc-a1" cx="150" cy="150" r="118" fill="none" stroke-width="2.5" stroke-dasharray="120 40 30 60 200 80" />
    <circle class="cc-a2" cx="150" cy="150" r="104" fill="none" stroke-width="7" stroke-dasharray="60 300" stroke-linecap="round"/>
    <circle class="cc-a3" cx="150" cy="150" r="92" fill="none" stroke-width="1.5" stroke-dasharray="4 7"/>
    <circle class="cc-core" cx="150" cy="150" r="78" fill="none" stroke-width="5"/>
  </svg>`;
}
function ccCardHTML(c) {
  const rows = (c.rows || []).slice(0, 12);
  return `<article class="cc-acard" data-kind="${esc(c.kind)}">
    <header><span class="cc-aic">${svg(c.icon)}</span><div class="grow"><h3>${esc(c.title)}</h3>${c.q ? `<span class="cc-q">“${esc(c.q)}”</span>` : ''}</div>
      <button type="button" class="cc-mini" id="ccsayc" title="Read it out">${svg('sound')}</button><button type="button" class="cc-mini" id="ccx" title="Close">${svg('x')}</button></header>
    ${CC.busy ? '<div class="cc-think"><i></i><i></i><i></i> <span>Thinking…</span></div>' : c.text ? `<p class="cc-text">${esc(c.text)}</p><span class="cc-src">${esc(c.src || '')}</span>` : ''}
    ${c.needsGoogle ? `<div class="cc-gnote">${svg('google')} <span class="grow">Connect your Google account to see your email and Drive here. It stays in this browser; nothing is stored in the CRM.</span><button type="button" class="btn small primary" data-ggc>Connect Google</button></div>` : ''}
    ${c.kpis?.length ? `<div class="cc-kpis">${c.kpis.map((x) => `<div class="cc-k ${x.tone ? 't-' + x.tone : ''}"><b>${x.v}</b><span>${esc(x.l)}</span></div>`).join('')}</div>` : ''}
    ${c.meter != null ? `<div class="cc-meter"><i class="t-${toneFor(c.meter)}" style="width:${clamp(c.meter, 0, 100)}%"></i><span>${c.meter}% of target</span></div>` : ''}
    ${rows.length ? `<ul class="cc-rows">${rows.map((l) => `<li><button type="button" data-lead="${l.id}"><span class="grow"><b>${esc(c.cols === 'deal' ? L.company(l) || l.name : l.name)}</b><span>${esc(c.cols === 'deal' ? `${l.stage} · ${L.ownerLabel(l)}` : `${L.company(l) || l.phone || ''} · ${L.ownerLabel(l)}`)}</span></span><span class="r">${c.cols === 'deal' ? `<b>${inrShort(l.value)}</b><span>${l.expected_close ? fmtDate(l.expected_close) : 'no date'}</span>` : l.next_followup_at ? `<span class="${new Date(l.next_followup_at) < new Date() ? 'bad' : ''}">${fmtDT(l.next_followup_at)}</span>` : stageChip(l)}</span></button></li>`).join('')}</ul>${(c.rows || []).length > 12 ? `<button type="button" class="lnk cc-more" data-ccgo="${esc(c.go || '')}">See all ${nfmt(c.rows.length)} →</button>` : ''}` : ''}
    ${c.list?.length ? `<ul class="cc-rows">${c.list.slice(0, 15).map((x) => `<li>${x.href ? `<a href="${esc(x.href)}" target="_blank" rel="noopener" class="${x.hot ? 'hot' : ''}">` : '<div>'}<span class="grow"><b>${esc(x.t)}</b><span>${esc(x.s || '')}</span></span><span class="r"><span>${esc(x.m || '')}</span></span>${x.href ? '</a>' : '</div>'}</li>`).join('')}</ul>` : ''}
    ${c.go && !rows.length ? `<button type="button" class="lnk cc-more" data-ccgo="${esc(c.go)}">Open ${esc(c.title)} →</button>` : ''}
  </article>`;
}
function ccPaint(el) {
  const box = el.querySelector('#ccbox'); if (!box) return;
  const F = ccFacts(); const tp = ccTopics(F); const pins = ccPins();
  if (!CC.card) { const c0 = ccCard(CC_TOPIC_KIND[CC.topic] || 'today', F); CC.card = { ...c0, q: '', text: c0.say, src: 'From the CRM' }; }
  const card = (x, pinned) => `<div class="cc-card tone-${x.tone}" draggable="true" data-cct="${x.id}"><span class="cc-ic">${svg(x.icon)}</span><div class="grow"><span class="cc-t">${esc(x.title)}</span><b>${esc(x.big)}</b><span class="cc-s">${esc(x.say)}</span></div>
    <div class="cc-act"><button type="button" class="cc-mini" data-ccsay="${x.id}" title="Read it out">${svg('sound')}</button>${x.rows || x.go ? `<button type="button" class="cc-mini" data-ccopen="${x.id}" title="Open the list">${svg('list')}</button>` : ''}<button type="button" class="cc-mini" data-ccpin="${x.id}" title="${pinned ? 'Unpin' : 'Pin'}">${svg(pinned ? 'x' : 'flag')}</button></div></div>`;
  const ring = [...CC_RING, ['mail', 'Email', 'mail'], ['drive', 'Drive', 'drive']];
  box.innerHTML = `<div class="cc-stage">
      <div class="cc-hud ${CC.open ? 'open' : ''} ${CC.listening ? 'listening' : ''} ${CC.busy ? 'busy' : ''} ${CC.speaking ? 'speaking' : ''}">
        <div class="cc-ring">${ccRingSVG()}
          <button type="button" class="cc-btn" id="ccring" aria-label="${CC.open ? 'Close the topics' : 'Open the topics'}"><span class="cc-name">${CC.listening ? 'LISTENING' : CC.busy ? 'THINKING' : CC.speaking ? 'SPEAKING' : 'GARUDA'}</span><span class="cc-sub">${CC.listening ? 'press Stop when done' : CC.open ? 'pick a topic' : 'tap for topics'}</span></button>
          ${ring.map(([k, t, ic], i) => `<button type="button" class="cc-seg ${CC.topic === k ? 'on' : ''}" data-ccr="${k}" style="--a:${i * (360 / ring.length) - 90}deg">${svg(ic)}<span>${t}</span></button>`).join('')}
        </div>
        <div class="cc-talk">
          ${CC.listening ? `<button type="button" class="cc-tbtn stop" id="ccstop">${svg('stop')} Stop</button>` : `<button type="button" class="cc-tbtn go" id="ccstart">${svg('mic')} Start talking</button>`}
          <button type="button" class="cc-tbtn hush cc-hush" id="cchush" ${CC.speaking ? '' : 'hidden'}>${svg('mute')} Stop voice</button>
        </div>
        <form class="cc-ask" id="ccform"><input id="ccq" placeholder="Ask: “Show my deals”, “What happened today?”, “Any new email?”" autocomplete="off"><button class="btn primary small" type="submit">Ask</button></form>
        <div class="cc-opts"><label class="cc-voice"><input type="checkbox" id="ccspk" ${CC.speak ? 'checked' : ''}> Read answers out loud</label>
          ${ggOn() ? `<span class="cc-gon">${svg('google')} Google connected · <button type="button" class="lnk" id="ggref">refresh</button></span>` : `<button type="button" class="lnk" data-ggc>${svg('google')} Connect Gmail and Drive</button>`}</div>
        ${isHead() && !ggClientId() ? `<details class="cc-gset"><summary>Set up Gmail and Drive for everyone</summary><p>In Google Cloud Console: create an OAuth client of type <b>Web application</b>, add <code>${esc(location.origin)}</code> as an authorised JavaScript origin, and enable the Gmail API and the Google Drive API. Set the consent screen to <b>Internal</b> so only your company’s accounts can use it. Paste the client ID here (it is not a secret).</p><div class="row"><input id="ggcid" placeholder="1234-abc.apps.googleusercontent.com"><button type="button" class="btn small primary" id="ggsave">Save</button></div></details>` : ''}
        ${GG.err ? `<span class="faint bad" style="font-size:12px">${esc(GG.err)}</span>` : ''}
      </div>
      <aside class="cc-panel">${ccCardHTML(CC.card)}</aside>
    </div>
    <div class="cc-board">
      <section class="cc-col" data-ccdrop="day"><div class="cc-ch"><h3>What happened today</h3><span class="faint">${fmtDate(ccDay())} · drag a card to Pinned</span></div><div class="cc-cards">${tp.filter((x) => !pins.includes(x.id)).map((x) => card(x, false)).join('')}</div></section>
      <section class="cc-col pin" data-ccdrop="pin"><div class="cc-ch"><h3>${svg('flag')} Pinned for today</h3><span class="faint">${pins.length ? 'tap the ring to hear them' : 'drop the topics that matter here'}</span></div><div class="cc-cards">${pins.map((id) => tp.find((x) => x.id === id)).filter(Boolean).map((x) => card(x, true)).join('') || '<div class="cc-empty">Drag a topic here</div>'}</div></section>
    </div>`;
  ccBind(el, F, tp);
}
function ccBind(el, F, tp) {
  el.querySelector('#ccring').onclick = () => { CC.open = !CC.open; if (!CC.open) { const pins = ccPins(); if (pins.length) ccSay(pins.map((id) => tp.find((x) => x.id === id)?.say).filter(Boolean).join(' ')); } ccPaint(el); };
  el.querySelectorAll('[data-ccr]').forEach((b) => (b.onclick = () => { const k = b.dataset.ccr; if ((k === 'mail' || k === 'drive') && ggOn() && !GG.mail) { ggFetch().then(() => ccShowTopic(k, el)); return; } ccShowTopic(k, el); }));
  el.querySelector('#ccstart')?.addEventListener('click', () => ccListen(el, true));
  el.querySelector('#ccstop')?.addEventListener('click', () => ccListen(el, false));
  el.querySelector('#cchush').onclick = () => ccHush();
  el.querySelector('#ccform').onsubmit = (e) => { e.preventDefault(); ccAsk(el.querySelector('#ccq').value, el); };
  el.querySelector('#ccspk').onchange = (e) => { CC.speak = e.target.checked; try { localStorage.setItem('garuda-cc-speak', CC.speak ? '1' : '0'); } catch (_) { /* */ } if (!CC.speak) ccHush(); };
  el.querySelector('#ccsayc')?.addEventListener('click', () => ccSay(CC.card?.text || CC.card?.say));
  el.querySelector('#ccx')?.addEventListener('click', () => { CC.card = null; CC.topic = 'today'; ccHush(); ccPaint(el); });
  el.querySelectorAll('[data-ggc]').forEach((b) => (b.onclick = () => ggConnect(el)));
  el.querySelector('#ggref')?.addEventListener('click', async () => { await ggFetch(); if (CC.card?.google) ccShowTopic(CC.card.kind, el, false); else ccPaint(el); });
  el.querySelector('#ggsave')?.addEventListener('click', () => guard(async () => { const id = (el.querySelector('#ggcid').value || '').trim(); if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('That does not look like a Google OAuth client ID.'); await DB.setSetting('google', { ...(DB.settings.google || {}), client_id: id }); ccPaint(el); }, 'Saved. Everyone can now connect their own Gmail and Drive.'));
  el.querySelectorAll('[data-ccgo]').forEach((b) => (b.onclick = () => b.dataset.ccgo && go(b.dataset.ccgo)));
  el.querySelectorAll('.cc-acard [data-lead]').forEach((b) => (b.onclick = () => openLead(b.dataset.lead)));
  const byId = (id) => tp.find((x) => x.id === id);
  el.querySelectorAll('[data-ccsay]').forEach((b) => (b.onclick = () => ccSay(byId(b.dataset.ccsay)?.say)));
  el.querySelectorAll('[data-ccopen]').forEach((b) => (b.onclick = () => { const x = byId(b.dataset.ccopen); if (x?.rows) drill(esc(x.title), leadRows(x.rows)); else if (x?.go) go(x.go); }));
  el.querySelectorAll('[data-ccpin]').forEach((b) => (b.onclick = () => { const id = b.dataset.ccpin; const p = ccPins(); ccSetPins(p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); ccPaint(el); }));
  el.querySelectorAll('.cc-card').forEach((c) => { c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', c.dataset.cct); c.classList.add('drag'); }; c.ondragend = () => c.classList.remove('drag'); });
  el.querySelectorAll('[data-ccdrop]').forEach((z) => { z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); }; z.ondragleave = () => z.classList.remove('over');
    z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); const p = ccPins().filter((x) => x !== id); ccSetPins(z.dataset.ccdrop === 'pin' ? [...p, id] : p); ccPaint(el); }; });
}
VIEWS.connect = {
  title: 'Claude Connect', sub: 'Ask the CRM, your email and your Drive. Press Start talking, speak, then Stop. Tap the ring for topics; drag what matters into Pinned.',
  render(el) {
    el.innerHTML = `${filterBar({ person: false, period: false })}<section class="cc-shell" id="ccbox"></section>
      <p class="faint" style="font-size:12px;margin:4px 6px">${DB.settings.ai?.enabled === false ? 'Claude is switched off in Settings → Claude AI, so answers come from the CRM’s own numbers.' : 'Answers come from Claude when it is connected (an Anthropic key in Supabase), otherwise from the CRM’s own numbers.'} Voice uses your browser’s microphone and speech; your email and Drive are read in your browser with your own Google sign-in.</p>`;
    bindFilters(el, () => { CC.card = null; this.render(el); });
    ccPaint(el);
  },
};
