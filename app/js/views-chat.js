/* Garuda CRM · Garuda Chat: everyone, team rooms, direct messages and notes to self, with emoji.
   A message that reads like a task becomes one: given straight to the person in a direct message,
   and offered ("Add as a task?") in notes to self and in group rooms. */
'use strict';

const EMOJI = ['👍', '🙏', '🎉', '✅', '🔥', '🚀', '👏', '💯', '😀', '😂', '😊', '😍', '🤝', '🙌', '😅', '🤔', '😎', '😢', '😮', '👀', '💪', '⭐', '📌', '📞', '📅', '⏰', '📍', '✈️', '🛩️', '🎓', '🏫', '📄', '💰', '📈', '📉', '⚠️', '❗', '❓', '☕', '🍕', '🌧️', '☀️', '👋', '🫡', '💡', '🧾', '🗂️', '🛠️'];
const CH = { room: 'general', q: '', draft: {}, offer: null, emoji: false, inRoom: false };
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');
const selfRoom = () => dmRoom(DB.me.id, DB.me.id);
function roomName(room) {
  if (room === 'general') return 'Everyone';
  if (room.startsWith('dept:')) { const d = dept(room.slice(5)); return d.name || room.slice(5); }
  const [a, b] = room.slice(3).split(':'); if (a === b) return 'Notes to self';
  return DB.pname(a === DB.me.id ? b : a);
}
const roomOther = (room) => { if (!room.startsWith('dm:')) return null; const [a, b] = room.slice(3).split(':'); return a === b ? null : a === DB.me.id ? b : a; };
const canRoom = (room) => room === 'general' || room.startsWith('dept:') || (room.startsWith('dm:') && room.includes(DB.me?.id));

/* read markers live on this device */
const chatKey = () => 'garuda-chat-read-' + (DB.me?.id || '');
function chatRead() { try { return JSON.parse(localStorage.getItem(chatKey()) || 'null'); } catch (_) { return null; } }
function chatMark(room) { const r = chatRead() || {}; r[room] = nowISO(); try { localStorage.setItem(chatKey(), JSON.stringify(r)); } catch (_) { /* private mode */ } }
function myRooms() { return ['general', ...DEPTS().filter((d) => seesAll() || myDepts().includes(d.code)).map((d) => 'dept:' + d.code)]; }
function roomUnread(room, read = chatRead() || {}) {
  const since = read[room] || read._start || ''; return (DB.t.chat_messages || []).filter((m) => m.room === room && m.sender !== DB.me?.id && m.created_at > since).length;
}
function chatUnread() {
  if (!DB.me) return 0;
  let read = chatRead(); if (!read) { read = { _start: nowISO() }; try { localStorage.setItem(chatKey(), JSON.stringify(read)); } catch (_) { /* private mode */ } }
  const rooms = new Set([...myRooms(), ...(DB.t.chat_messages || []).filter((m) => m.room.startsWith('dm:') && m.room.includes(DB.me.id)).map((m) => m.room)]);
  return sum([...rooms], (r) => roomUnread(r, read));
}

/* ---------- task detection ---------- */
const TASK_VERBS = 'call|send|share|prepare|follow up|follow-up|arrange|book|schedule|update|complete|finish|submit|review|check|visit|meet|draft|create|collect|confirm|email|mail|remind|fix|plan|organise|organize|get|make|ensure|print|order|pay|raise|close|upload|coordinate|contact|reply|respond|ask|set up|setup|bring|deliver|install|demo|present|quote|invoice|sign';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDue(t) {
  const s = t.toLowerCase(); const d = new Date(); d.setHours(12, 0, 0, 0); const at = (n) => localDate(new Date(d.getTime() + n * 864e5));
  if (/\bday after tomorrow\b/.test(s)) return at(2);
  if (/\b(tomorrow|tmrw|tmr)\b/.test(s)) return at(1);
  if (/\b(today|tonight|eod|end of (the )?day|asap|right away|now)\b/.test(s)) return at(0);
  if (/\bnext week\b/.test(s)) return at(((8 - d.getDay()) % 7) || 7);
  if (/\b(this week|eow|end of (the )?week)\b/.test(s)) return at((5 - d.getDay() + 7) % 7);
  const wd = s.match(/\b(?:by |on |this |next )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?\b/);
  if (wd) { const i = WEEKDAYS.findIndex((w) => w.startsWith(wd[1].slice(0, 3))); const n = (i - d.getDay() + 7) % 7 || 7; return at(n); }
  let m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) || s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) { const [day, mon] = /\d/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2]), m[1]]; const x = new Date(d.getFullYear(), MONTHS.indexOf(mon), day, 12); if (x < d) x.setFullYear(x.getFullYear() + 1); return localDate(x); }
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) { const y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : d.getFullYear(); const x = new Date(y, Number(m[2]) - 1, Number(m[1]), 12); if (!isNaN(x) && x.getMonth() === Number(m[2]) - 1) { if (!m[3] && x < d) x.setFullYear(y + 1); return localDate(x); } }
  m = s.match(/\bby (?:the )?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) { const x = new Date(d.getFullYear(), d.getMonth(), Number(m[1]), 12); if (x < d) x.setMonth(x.getMonth() + 1); return localDate(x); }
  return null;
}
function mentions(text) {
  const out = []; const s = text.toLowerCase();
  (DB.t.profiles || []).filter((p) => p.active).forEach((p) => { const f = (p.full_name || '').split(' ')[0].toLowerCase(); const full = (p.full_name || '').toLowerCase(); if ((full && s.includes('@' + full)) || (f.length > 1 && new RegExp('@' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(s))) out.push(p); });
  return out;
}
/* is this a task? returns { title, due, sure } or null */
function detectTask(text) {
  const raw = text.trim(); if (raw.length < 6 || raw.endsWith('?') && !/^(can|could|would|will) you\b/i.test(raw)) return null;
  const s = raw.toLowerCase();
  const explicit = /^(#task|task:|todo:|to do:|to-do:|action:|ai:)/.test(s) || /#task\b/.test(s);
  const polite = /^(?:@\S+\s+)?(please|pls|plz|kindly|can you|could you|would you|will you|you need to|need you to|make sure|don'?t forget to|remember to)\b/.test(s);
  const verb = new RegExp(`^(?:@\\S+\\s+|(?:please|pls|plz|kindly|can you|could you|would you|will you|you need to|need you to|make sure( to)?|don'?t forget to|remember to)\\s+)*(${TASK_VERBS})\\b`).test(s);
  const due = parseDue(s); const hasMention = /@\w/.test(s);
  if (!(explicit || (verb && (polite || due || hasMention)) || (polite && due))) return null;
  let title = raw.replace(/#task\b/ig, '').replace(/^(task|todo|to do|to-do|action|ai):\s*/i, '').replace(/^(@\S+\s+)+/, '')
    .replace(/^(please|pls|plz|kindly|can you|could you|would you|will you|you need to|need you to|make sure( to)?|don'?t forget to|remember to)\s+/i, '').replace(/\s*\?$/, '').replace(/\s+/g, ' ').trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title: title.slice(0, 140) || raw.slice(0, 140), due, sure: explicit || verb };
}

/* ---------- the screen ---------- */
const QUICK_REACT = ['👍', '✅', '🙏', '🎉', '😂', '🔥'];
const roomAvatar = (room, big = false) => {
  if (room === 'general') return `<span class="cav g ${big ? 'big' : ''}">#</span>`;
  if (room.startsWith('dept:')) return `<span class="cav d ${big ? 'big' : ''}" style="--dc:${esc(deptColor(room.slice(5)))}">${esc(room.slice(5, 7))}</span>`;
  const o = roomOther(room); return o ? `<span class="cav ${big ? 'big' : ''}">${esc(initials(DB.pname(o)))}</span>` : `<span class="cav s ${big ? 'big' : ''}">${svg('me')}</span>`;
};
const roomMembers = (room) => (room === 'general' ? (DB.t.profiles || []).filter((p) => p.active).length : room.startsWith('dept:') ? (DB.t.profiles || []).filter((p) => p.active && (p.departments || []).includes(room.slice(5))).length : roomOther(room) ? 2 : 1);
VIEWS.chat = {
  title: 'Garuda Chat', sub: 'Everyone, your teams and one-to-one. Messages that read like a task become tasks.',
  render(el) {
    if (ST.arg) { const a = decodeURIComponent(ST.arg); ST.arg = null; if (canRoom(a)) CH.room = a; else if (DB.profile(a)) CH.room = dmRoom(DB.me.id, a); }
    if (!canRoom(CH.room)) CH.room = 'general';
    const read = chatRead() || {}; CH.lastRead = read[CH.room] || read._start || '';
    const msgs = DB.t.chat_messages || [];
    const last = (room) => msgs.filter((m) => m.room === room).reduce((a, m) => (m.created_at > a ? m.created_at : a), '');
    const dms = (DB.t.profiles || []).filter((p) => p.active && p.id !== DB.me.id && (!CH.q || p.full_name.toLowerCase().includes(CH.q.toLowerCase()))).map((p) => ({ p, room: dmRoom(DB.me.id, p.id) })).map((x) => ({ ...x, last: last(x.room), un: roomUnread(x.room, read) })).sort((a, b) => b.un - a.un || b.last.localeCompare(a.last) || a.p.full_name.localeCompare(b.p.full_name));
    const when = (iso) => (!iso ? '' : localDate(iso) === todayStr() ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    const prev = (room) => { const m = msgs.filter((x) => x.room === room).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]; return m ? `${m.sender === DB.me.id ? 'You' : DB.pname(m.sender).split(' ')[0]}: ${m.body.slice(0, 60)}` : ''; };
    const item = (room, label, sub, un) => `<button class="croom ${CH.room === room ? 'on' : ''} ${un ? 'unread' : ''}" data-room="${esc(room)}">${roomAvatar(room)}<span class="grow"><span class="crt"><b>${esc(label)}</b><span class="ctime">${when(last(room))}</span></span><span class="s">${esc(sub)}</span></span>${un ? `<span class="badge">${un}</span>` : ''}</button>`;
    const other = roomOther(CH.room); const op = other && DB.profile(other);
    const tasks = msgs.filter((m) => m.room === CH.room && m.task_id).map((m) => DB.get('work_tasks', m.task_id)).filter(Boolean);
    el.innerHTML = `<section class="glass chat v2 ${CH.inRoom ? 'in-room' : ''}">
      <aside class="crooms">
        <div class="csearch">${svg('search')}<input type="search" id="cq" placeholder="Search people" value="${esc(CH.q)}" aria-label="Search people"></div>
        <div class="cgrp">Channels</div>
        ${myRooms().map((r) => item(r, r === 'general' ? 'Everyone' : roomName(r), prev(r) || (r === 'general' ? 'The whole company' : 'Team room'), roomUnread(r, read))).join('')}
        ${item(selfRoom(), 'Notes to self', prev(selfRoom()) || 'Reminders become tasks', 0)}
        <div class="cgrp">Direct messages</div>
        <div class="cdms">${dms.slice(0, 80).map((x) => item(x.room, x.p.full_name, prev(x.room) || x.p.designation || ROLES[x.p.role] || '', x.un)).join('')}</div>
      </aside>
      <div class="cmain">
        <div class="chead"><button class="btn ghost small cback" id="cback" aria-label="All conversations">${svg('chevl')}</button>${roomAvatar(CH.room, true)}
          <div class="grow"><b>${esc(roomName(CH.room))}</b><span class="faint">${CH.room === selfRoom() ? 'Only you' : op ? esc(op.designation || ROLES[op.role] || '') + ' · tasks you write here go to them' : `${nfmt(roomMembers(CH.room))} people`}</span></div>
          <div class="csearch in">${svg('search')}<input type="search" id="cmq" placeholder="Search this chat" value="${esc(CH.mq || '')}" aria-label="Search this chat"></div>
          <button class="btn ghost small" id="ctasks" aria-pressed="${!!CH.showTasks}" title="Tasks from this chat">${svg('task')}<span class="cnum">${tasks.length || ''}</span></button></div>
        <div class="cbodywrap"><div class="cmsgs" id="cmsgs"></div>
          ${CH.showTasks ? `<aside class="ctpanel"><h4>${svg('task')} Tasks from this chat</h4>${tasks.length ? tasks.map((t) => `<button class="ctrow" data-ctask="${t.id}"><span class="pbar ${taskTone(t)}"><i style="width:${taskPct(t)}%"></i></span><b>${esc(t.title)}</b><span class="s">${esc(DB.pname(t.owner).split(' ')[0])}${t.due_date ? ' · ' + fmtDate(t.due_date) : ''} · ${t.status}</span></button>`).join('') : '<p class="faint">No tasks yet. Write "Please send … by Friday" or start a line with #task.</p>'}</aside>` : ''}</div>
        <div id="coffer"></div>
        <div class="ccomp"><div class="cemo glass" id="cemo" ${CH.emoji ? '' : 'hidden'}>${EMOJI.map((e) => `<button data-emo="${e}" aria-label="${e}">${e}</button>`).join('')}</div>
          <div class="cpill"><button class="btn ghost" id="cemob" aria-label="Emoji" aria-expanded="${CH.emoji}">${svg('smile')}</button>
          <textarea id="cin" rows="1" placeholder="Message ${esc(roomName(CH.room))}" aria-label="Message">${esc(CH.draft[CH.room] || '')}</textarea>
          <button class="btn ghost ctag" id="ctag" title="Make this message a task">#task</button>
          <button class="btn primary csend" id="csend" aria-label="Send">${svg('send')}</button></div>
          <div class="chint faint">Enter to send · Shift + Enter for a new line · ${other ? 'a request with a date becomes a task for ' + esc(DB.pname(other).split(' ')[0]) : 'start with #task or @name to hand out a task'}</div></div>
      </div></section>`;
    this.bind(el);
    this.list(el);
  },
  list(el) {
    const box = el.querySelector('#cmsgs'); if (!box) return;
    const q = (CH.mq || '').toLowerCase();
    const ms = (DB.t.chat_messages || []).filter((m) => m.room === CH.room && (!q || m.body.toLowerCase().includes(q))).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-400);
    let day = ''; let newShown = false;
    const body = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(@[A-Za-z][\w.]*)/g, '$1<b class="mention">$2</b>').replace(/(^|\s)(#task)\b/gi, '$1<b class="htag">$2</b>').replace(/\n/g, '<br>');
    const emojiOnly = (t) => /^(\p{Extended_Pictographic}|️|‍|\s){1,8}$/u.test(t.trim());
    box.innerHTML = ms.length ? ms.map((m, i) => {
      const d = localDate(m.created_at); const head = d !== day ? `<div class="cday"><span>${d === todayStr() ? 'Today' : fmtDate(d)}</span></div>` : ''; day = d;
      const mine = m.sender === DB.me.id;
      const isNew = !newShown && !mine && CH.lastRead && m.created_at > CH.lastRead; if (isNew) newShown = true;
      const same = !head && !isNew && i && ms[i - 1].sender === m.sender && new Date(m.created_at) - new Date(ms[i - 1].created_at) < 5 * 6e4;
      const t = m.task_id && DB.get('work_tasks', m.task_id);
      const rx = Object.entries(m.reactions || {}).filter(([, who]) => (who || []).length);
      return `${head}${isNew ? '<div class="cnew"><span>New</span></div>' : ''}<div class="cmsg ${mine ? 'me' : ''} ${same ? 'cont' : ''}" data-mid="${m.id}">${same ? '<span class="cav sp"></span>' : `<span class="cav">${esc(initials(DB.pname(m.sender)))}</span>`}<div class="cb">${same ? '' : `<div class="cwho"><b>${esc(mine ? 'You' : DB.pname(m.sender))}</b><span class="faint">${new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></div>`}
        <div class="cbody ${emojiOnly(m.body) ? 'emo' : ''}">${body(m.body)}</div>
        ${t ? `<button class="ctask" data-ctask="${t.id}"><span class="gtag ${taskOpen(t) ? 'amber' : 'green'}">${svg('task')} Task</span><span>${esc(t.title)}</span><span class="faint">${esc(DB.pname(t.owner).split(' ')[0])}${t.due_date ? ' · ' + fmtDate(t.due_date) : ''} · ${t.status}</span></button>` : ''}
        ${rx.length ? `<div class="crx">${rx.map(([e, who]) => `<button class="${who.includes(DB.me.id) ? 'on' : ''}" data-rx="${m.id}" data-e="${e}" title="${esc(who.map((x) => DB.pname(x)).join(', '))}">${e} <b>${who.length}</b></button>`).join('')}</div>` : ''}</div>
        <div class="cact glass">${QUICK_REACT.map((e) => `<button data-rx="${m.id}" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}${t ? '' : `<button data-mtask="${m.id}" title="Make a task">${svg('task')}</button>`}${mine ? `<button data-mdel="${m.id}" title="Delete">${svg('x')}</button>` : ''}</div></div>`;
    }).join('') : `<div class="cempty">${roomAvatar(CH.room, true)}<b>${q ? 'Nothing matches' : CH.room === selfRoom() ? 'Your notes' : 'Start the conversation'}</b><span class="faint">${q ? 'Try another word.' : CH.room === selfRoom() ? 'Write reminders to yourself. A line that reads like a task (“Call Anna University tomorrow”) can go straight to your tasks.' : 'Say hello 👋'}</span></div>`;
    const nw = box.querySelector('.cnew'); if (nw && !q) nw.scrollIntoView({ block: 'center' }); else box.scrollTop = box.scrollHeight;
    box.querySelectorAll('[data-ctask]').forEach((b) => (b.onclick = () => { const t = DB.get('work_tasks', b.dataset.ctask); if (t) taskModal(t, () => this.list(el)); }));
    el.querySelectorAll('.ctpanel [data-ctask]').forEach((b) => (b.onclick = () => { const t = DB.get('work_tasks', b.dataset.ctask); if (t) taskModal(t, () => this.render(el)); }));
    box.querySelectorAll('[data-rx]').forEach((b) => (b.onclick = () => guard(async () => {
      const m = DB.get('chat_messages', b.dataset.rx); if (!m) return; const e = b.dataset.e; const rx = { ...(m.reactions || {}) }; const who = new Set(rx[e] || []);
      if (who.has(DB.me.id)) who.delete(DB.me.id); else who.add(DB.me.id); rx[e] = [...who]; if (!rx[e].length) delete rx[e];
      await DB.update('chat_messages', m.id, { reactions: rx }); this.list(el);
    })));
    box.querySelectorAll('[data-mtask]').forEach((b) => (b.onclick = () => { const m = DB.get('chat_messages', b.dataset.mtask); const t = detectTask(m.body) || { title: m.body.slice(0, 140), due: null }; CH.offer = { room: CH.room, msg: m.id, title: t.title, due: t.due, owner: roomOther(CH.room) || mentions(m.body)[0]?.id || DB.me.id }; this.offer(el); }));
    box.querySelectorAll('[data-mdel]').forEach((b) => (b.onclick = () => guard(async () => { if (!(await confirmBox('Delete this message?', 'Delete'))) return; await DB.remove('chat_messages', b.dataset.mdel); this.list(el); })));
    chatMark(CH.room);
    this.offer(el);
  },
  /* "Add as a task?" bar */
  offer(el) {
    const box = el.querySelector('#coffer'); if (!box) return; const o = CH.offer;
    if (!o || o.room !== CH.room) { box.innerHTML = ''; return; }
    const people = (DB.t.profiles || []).filter((p) => p.active).sort((a, b) => Number(b.id === DB.me.id) - Number(a.id === DB.me.id) || a.full_name.localeCompare(b.full_name));
    box.innerHTML = `<div class="coffer glass"><span class="gtag amber">${svg('task')} Add as a task?</span><input id="cot" value="${esc(o.title)}" aria-label="Task">
      <select id="coo" aria-label="Assign to">${opts(people.map((p) => [p.id, p.id === DB.me.id ? 'Myself' : p.full_name]), o.owner || DB.me.id)}</select><input type="date" id="cod" value="${esc(o.due || '')}" aria-label="Due date">
      <button class="btn primary small" id="coy">Yes, add</button><button class="btn small" id="con">No</button></div>`;
    box.querySelector('#con').onclick = () => { CH.offer = null; box.innerHTML = ''; };
    box.querySelector('#coy').onclick = () => guard(async () => {
      const title = v(box, 'cot').trim(); if (!title) throw new Error('Name the task.');
      const t = await DB.insert('work_tasks', { title, owner: v(box, 'coo'), due_date: v(box, 'cod') || null, created_by: DB.me.id, priority: 'Normal', notes: 'From Garuda Chat' });
      if (o.msg) await DB.update('chat_messages', o.msg, { task_id: t.id });
      CH.offer = null; this.list(el);
    }, 'Task added');
  },
  bind(el) {
    el.querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => { CH.room = b.dataset.room; CH.emoji = false; CH.inRoom = true; this.render(el); }));
    el.querySelector('#cback').onclick = () => { CH.inRoom = false; el.querySelector('.chat').classList.remove('in-room'); };
    const q = el.querySelector('#cq'); q.oninput = () => { CH.q = q.value; clearTimeout(this._t); this._t = setTimeout(() => { this.render(el); const i = el.querySelector('#cq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
    const inp = el.querySelector('#cin'); const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 160) + 'px'; }; grow();
    inp.oninput = () => { CH.draft[CH.room] = inp.value; grow(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(el); } };
    el.querySelector('#csend').onclick = () => this.send(el);
    el.querySelector('#ctag').onclick = () => { if (!/#task/i.test(inp.value)) inp.value = '#task ' + inp.value; CH.draft[CH.room] = inp.value; inp.focus(); };
    el.querySelector('#ctasks').onclick = () => { CH.showTasks = !CH.showTasks; this.render(el); };
    const mq = el.querySelector('#cmq'); mq.oninput = () => { CH.mq = mq.value; clearTimeout(this._m); this._m = setTimeout(() => this.list(el), 200); };
    const emo = el.querySelector('#cemo');
    el.querySelector('#cemob').onclick = (e) => { e.stopPropagation(); CH.emoji = emo.hidden; emo.hidden = !emo.hidden; };
    emo.querySelectorAll('[data-emo]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const s = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, s) + b.dataset.emo + inp.value.slice(inp.selectionEnd ?? s); CH.draft[CH.room] = inp.value; inp.focus(); inp.setSelectionRange(s + b.dataset.emo.length, s + b.dataset.emo.length); }));
  },
  async send(el) {
    const inp = el.querySelector('#cin'); const text = inp.value.trim(); if (!text) return;
    if (text.length > 4000) return toast('Keep a message under 4,000 characters.', true);
    const room = CH.room;
    await guard(async () => {
      const msg = await DB.insert('chat_messages', { room, sender: DB.me.id, body: text });
      CH.draft[room] = ''; inp.value = '';
      const t = detectTask(text);
      if (t) {
        const other = roomOther(room); const at = mentions(text).filter((p) => p.id !== DB.me.id);
        if (other && t.sure) {
          /* a direct message that reads like a task is given straight to that person */
          const nt = await DB.insert('work_tasks', { title: t.title, owner: other, due_date: t.due, created_by: DB.me.id, priority: 'Normal', notes: 'From Garuda Chat: ' + text.slice(0, 500) });
          await DB.update('chat_messages', msg.id, { task_id: nt.id });
          toast(`Added as a task for ${DB.pname(other)}${t.due ? ' · due ' + fmtDate(t.due) : ''}`);
        } else if (!other && room !== selfRoom() && at.length === 1 && t.sure) {
          const nt = await DB.insert('work_tasks', { title: t.title, owner: at[0].id, due_date: t.due, created_by: DB.me.id, priority: 'Normal', notes: 'From Garuda Chat (' + roomName(room) + '): ' + text.slice(0, 500) });
          await DB.update('chat_messages', msg.id, { task_id: nt.id });
          toast(`Added as a task for ${at[0].full_name}`);
        } else CH.offer = { room, msg: msg.id, title: t.title, due: t.due, owner: other || at[0]?.id || DB.me.id };
      }
    });
    this.list(el); el.querySelector('#cin')?.focus();
  },
};
/* new messages arrive live: refresh only the conversation, not the whole page */
let chatSeen = 0;
function chatLive() {
  const n = (DB.t.chat_messages || []).length; if (n === chatSeen) return; chatSeen = n;
  if (ST.view === 'chat') { const el = $('#view'); if (el && el.querySelector('#cmsgs')) VIEWS.chat.list(el); }
}
