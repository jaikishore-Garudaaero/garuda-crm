/* Garuda CRM · Tasks on leads and deals (MoU ready, client visiting us, visit preparation …), with sub-tasks and work done.
   Task Dashboard (Overview) and the Tasks line items (Execution); each lead record has a Tasks tab beside Activity. */
'use strict';

const TASK_PRI = ['Low', 'Normal', 'High', 'Urgent'];
const taskOpen = (t) => !['Done', 'Cancelled'].includes(t.status);
const taskSubs = (id) => DB.t.work_subtasks.filter((s) => s.task_id === id).sort((a, b) => a.ord - b.ord || String(a.created_at).localeCompare(String(b.created_at)));
/* progress: ticked sub-tasks, or the % set by hand when a task has no sub-tasks */
function taskPct(t) { const s = taskSubs(t.id); if (t.status === 'Done') return 100; if (!s.length) return clamp(Number(t.progress) || 0, 0, 100); return Math.round((s.filter((x) => x.done).length / s.length) * 100); }
const isProjTask = (t) => !!t.project_id;
const RECUR = [['', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every working day (Mon–Sat)'], ['weekly', 'Every week'], ['monthly', 'Every month']];
const RECUR_SHORT = { daily: 'Daily', weekdays: 'Mon–Sat', weekly: 'Weekly', monthly: 'Monthly' };
const recurChip = (t) => (t.recur ? `<span class="tk-rec" title="Repeats ${esc((RECUR.find((r) => r[0] === t.recur) || [])[1] || t.recur)}${t.remind_time ? ' · reminder at ' + String(t.remind_time).slice(0, 5) : ''}">${svg('repeat')} ${RECUR_SHORT[t.recur] || t.recur}</span>` : t.remind_time ? `<span class="tk-rec" title="Reminder">${svg('bell')} ${String(t.remind_time).slice(0, 5)}</span>` : '');
const projBadge = (pj) => `<span class="tk-projb" style="--dc:${esc(typeof projColor === 'function' ? projColor(pj) : '#7b5cf0')}" title="Project">${svg('proj')} ${esc(pj.name)}</span>`;
/* positive / alarming / negative */
function taskTone(t) {
  if (t.status === 'Done') return 'good';
  if (t.status === 'Cancelled') return 'mute';
  if (t.due_date && t.due_date < todayStr()) return 'bad';
  if (t.due_date && daysAgo(t.due_date) >= -2) return 'warn';
  return 'info';
}
const toneWord = { good: 'Done', bad: 'Overdue', warn: 'Due soon', info: 'On track', mute: 'Cancelled' };
const taskLink = (t) => { const pj = t.project_id && DB.get('projects', t.project_id); if (pj) return { kind: 'Project', name: pj.name, pj }; const l = t.lead_id && DB.get('leads', t.lead_id); const i = t.institution_id && DB.get('institutions', t.institution_id); return l ? { kind: l.is_deal ? 'Deal' : 'Lead', name: L.company(l) && !l.name.includes(L.company(l)) ? `${l.name} · ${L.company(l)}` : l.name, l } : i ? { kind: 'Account', name: i.name } : null; };
const taskTemplates = () => DB.settings.task_templates || [];

/* ---------- one task as a line item: name, link, progress, then its sub-tasks with the work done ---------- */
function taskCard(t, { open = true, showLink = true } = {}) {
  const subs = taskSubs(t.id); const done = subs.filter((s) => s.done).length; const pct = taskPct(t); const tone = taskTone(t); const lk = taskLink(t);
  const last = (t.updates || []).slice(-1)[0];
  return `<article class="tcard tone-${tone}" data-task="${t.id}">
    <div class="tc-head"><button class="tc-tog" data-ttog="${t.id}" aria-expanded="${open}" aria-label="Show sub-tasks">${svg(open ? 'chevl' : 'chevr')}</button>
      <div class="tc-main"><b class="tc-title">${esc(t.title)}</b>
        <span class="s">${showLink && lk ? `<a href="#" ${lk.l ? `data-lead="${lk.l.id}"` : ''}>${lk.kind} · ${esc(lk.name)}</a> · ` : ''}${esc(DB.pname(t.owner))}${t.due_date ? ` · due ${fmtDate(t.due_date)}` : ''}</span></div>
      <span class="chip tone ${tone}">${toneWord[tone]}</span>${t.priority === 'High' || t.priority === 'Urgent' ? `<span class="chip tone ${t.priority === 'Urgent' ? 'bad' : 'warn'}">${esc(t.priority)}</span>` : ''}
      <button class="btn ghost small" data-tedit="${t.id}" aria-label="Edit task">Edit</button></div>
    <div class="tc-prog"><span class="pbar ${tone}"><i style="width:${pct}%"></i></span><span class="faint">${pct}% · ${done} of ${subs.length} sub-task${subs.length === 1 ? '' : 's'}</span></div>
    ${last && !open ? `<p class="tc-last"><span class="faint">${fmtDT(last.at)} · ${esc(DB.pname(last.by))}:</span> ${esc(last.text)}</p>` : ''}
    ${open ? `<ul class="subs">${subs.map((s) => `<li class="${s.done ? 'done' : ''}"><label class="check"><input type="checkbox" data-sdone="${s.id}" ${s.done ? 'checked' : ''}> <span>${esc(s.title)}</span></label>
        ${s.done ? `<span class="faint s">${esc(DB.pname(s.done_by))} · ${fmtDT(s.done_at)}</span>` : s.due_date ? `<span class="faint s">due ${fmtDate(s.due_date)}</span>` : ''}
        <input class="wd" data-swd="${s.id}" value="${esc(s.work_done)}" placeholder="What was done" aria-label="Work done on ${esc(s.title)}"></li>`).join('')}
        <li class="addsub"><input data-sadd="${t.id}" placeholder="Add a sub-task and press Enter" aria-label="New sub-task"></li></ul>
      <div class="tc-upd"><div class="row"><input data-tupd="${t.id}" placeholder="Update: what happened on this task" aria-label="Task update"><button class="btn small" data-tupdgo="${t.id}">Add update</button></div>
        ${(t.updates || []).slice().reverse().slice(0, 4).map((u) => `<p><span class="faint">${fmtDT(u.at)} · ${esc(DB.pname(u.by))}:</span> ${esc(u.text)}</p>`).join('')}</div>` : ''}
  </article>`;
}
const taskOpenState = new Set();
function bindTaskCards(root, rer) {
  root.querySelectorAll('[data-ttog]').forEach((b) => (b.onclick = () => { const id = b.dataset.ttog; if (taskOpenState.has(id)) taskOpenState.delete(id); else taskOpenState.add(id); rer(); }));
  root.querySelectorAll('[data-tedit]').forEach((b) => (b.onclick = () => taskModal(DB.get('work_tasks', b.dataset.tedit), rer)));
  root.querySelectorAll('[data-sdone]').forEach((c) => (c.onchange = () => guard(async () => {
    const s = DB.get('work_subtasks', c.dataset.sdone); const wd = root.querySelector(`[data-swd="${s.id}"]`)?.value.trim() || s.work_done;
    await DB.update('work_subtasks', s.id, { done: c.checked, work_done: wd }); rer();
  })));
  root.querySelectorAll('[data-swd]').forEach((i) => { const save = () => { const s = DB.get('work_subtasks', i.dataset.swd); if (s && i.value.trim() !== s.work_done) guard(async () => { await DB.update('work_subtasks', s.id, { work_done: i.value.trim() }); }, 'Saved'); }; i.onblur = save; i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); }; });
  root.querySelectorAll('[data-sadd]').forEach((i) => (i.onkeydown = (e) => { if (e.key !== 'Enter' || !i.value.trim()) return; const tid = i.dataset.sadd; guard(async () => { await DB.insert('work_subtasks', { task_id: tid, title: i.value.trim(), ord: taskSubs(tid).length + 1 }); taskOpenState.add(tid); rer(); }); }));
  root.querySelectorAll('[data-tupdgo]').forEach((b) => (b.onclick = () => guard(async () => {
    const id = b.dataset.tupdgo; const inp0 = root.querySelector(`[data-tupd="${id}"]`); const text = inp0.value.trim(); if (!text) throw new Error('Write the update first.');
    const t = DB.get('work_tasks', id); await DB.update('work_tasks', id, { updates: [...(t.updates || []), { at: nowISO(), by: DB.me.id, text }] }); rer();
  }, 'Update added')));
  bindLeadClicks(root);
}

/* ---------- new / edit task (with a template for the usual jobs) ---------- */
function taskModal(t = {}, after) {
  const isNew = !t.id; const subs = isNew ? [] : taskSubs(t.id);
  const lead = t.lead_id && DB.get('leads', t.lead_id);
  /* a task can go to anyone in the CRM, or to yourself */
  const people = (DB.t.profiles || []).filter((p) => p.active || p.id === t.owner).sort((a, b) => Number(b.id === DB.me.id) - Number(a.id === DB.me.id) || a.full_name.localeCompare(b.full_name));
  const m = openModal({ title: isNew ? 'New task' : esc(t.title), width: 720,
    body: `${isNew && taskTemplates().length ? `<div class="field"><label>Start from a template</label><div class="row">${taskTemplates().map((x, i) => `<button class="btn small" data-tpl="${i}">${esc(x.name)}</button>`).join('')}</div></div>` : ''}
      <div class="form">${fld('tt', 'Task', inp('tt', t.title || '', 'text', 'placeholder="e.g. MoU ready for signing"'), 'full')}
      ${fld('tkind', 'Task type', `<div class="seg" id="tkind">${[['lead', 'Lead / deal / account task'], ['project', 'Project task'], ['general', 'Routine / general']].map(([k, w]) => `<button type="button" data-tkind="${k}" aria-pressed="${(t.project_id ? 'project' : t.recur && !t.lead_id && !t.institution_id ? 'general' : 'lead') === k}">${w}</button>`).join('')}</div>`, 'full')}
      <div class="full" id="tlinkf" ${t.project_id || (t.recur && !t.lead_id && !t.institution_id) ? 'hidden' : ''}>${fld('tlink', 'Lead, deal or account', recordPicker('tlink', t))}</div>
      <div class="full" id="tprojf" ${t.project_id ? '' : 'hidden'}>${fld('tproj', 'Project', `<select id="tproj">${opts(ptProjects().map((p) => [p.id, (p.project_code ? p.project_code + ' · ' : '') + p.name]), t.project_id || '', 'Choose a project')}</select>`)}</div>
      ${fld('tsd', 'Start date', inp('tsd', t.start_date || '', 'date'))}
      ${fld('to', 'Assign to', `<select id="to">${opts(people.map((p) => [p.id, p.id === DB.me.id ? `Myself (${p.full_name})` : `${p.full_name}${p.designation ? ' · ' + p.designation : ''}`]), t.owner || lead?.owner || DB.me.id)}</select>`)}${fld('td', 'Due date', inp('td', t.due_date || '', 'date'))}
      ${fld('trec', 'Repeat', sel('trec', RECUR, t.recur || ''))}${fld('trt', 'Remind at (India time)', inp('trt', t.remind_time ? String(t.remind_time).slice(0, 5) : '', 'time'))}
      <label class="check full"><input type="checkbox" id="trem" ${t.remind_email ? 'checked' : ''}> Also send the reminder by email</label>
      ${fld('tp', 'Priority', sel('tp', TASK_PRI, t.priority || 'Normal'))}${isNew ? '' : fld('ts', 'Status', sel('ts', ['Open', 'In progress', 'Done', 'Cancelled'], t.status))}
      ${isNew ? fld('tsubs', 'Sub-tasks (one per line)', '<textarea id="tsubs" style="min-height:140px" placeholder="Draft the MoU&#10;Internal review&#10;Share with the client"></textarea>', 'full') : `<div class="full faint" style="font-size:12.5px">${subs.length} sub-tasks · tick them and add sub-tasks on the task itself.</div>`}
      ${fld('tn', 'Task description', `<textarea id="tn" rows="4" placeholder="What needs to be done, links, and what done looks like">${esc(t.notes || '')}</textarea>`, 'full')}</div>`,
    foot: `${!isNew && (t.created_by === DB.me.id || canReassign()) ? '<button class="btn danger" id="tdel" style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="tsave">${isNew ? 'Create task' : 'Save'}</button>` });
  bindPicker(m.el, 'tlink');
  m.el.querySelectorAll('[data-tkind]').forEach((b) => (b.onclick = () => { m.el.querySelectorAll('[data-tkind]').forEach((x) => x.setAttribute('aria-pressed', x === b)); m.el.querySelector('#tlinkf').hidden = b.dataset.tkind !== 'lead'; m.el.querySelector('#tprojf').hidden = b.dataset.tkind !== 'project'; }));
  m.el.querySelectorAll('[data-tpl]').forEach((b) => (b.onclick = () => { const x = taskTemplates()[b.dataset.tpl]; if (!v(m.el, 'tt')) m.el.querySelector('#tt').value = x.name; m.el.querySelector('#tsubs').value = (x.items || []).join('\n'); }));
  m.el.querySelector('#tsave').onclick = () => guard(async () => {
    const title = v(m.el, 'tt').trim(); if (!title) throw new Error('Name the task.');
    const proj = m.el.querySelector('[data-tkind="project"]').getAttribute('aria-pressed') === 'true';
    const general = m.el.querySelector('[data-tkind="general"]').getAttribute('aria-pressed') === 'true';
    const link = proj || general ? { lead_id: null, institution_id: null } : pickerVal(m.el, 'tlink');
    const recur = v(m.el, 'trec') || null; const remind_time = v(m.el, 'trt') || null;
    if (recur && !v(m.el, 'td')) m.el.querySelector('#td').value = todayStr();
    const project_id = proj ? v(m.el, 'tproj') || null : null; if (proj && !project_id) throw new Error('Choose the project.');
    const row = { title, project_id, recur, remind_time, remind_email: m.el.querySelector('#trem').checked, start_date: v(m.el, 'tsd') || (recur ? todayStr() : null), lead_id: link.lead_id, institution_id: link.institution_id, owner: v(m.el, 'to'), due_date: v(m.el, 'td') || null, priority: v(m.el, 'tp'), notes: v(m.el, 'tn') };
    if (isNew) {
      const nt = await DB.insert('work_tasks', { ...row, created_by: DB.me.id });
      const lines = v(m.el, 'tsubs').split('\n').map((x) => x.trim()).filter(Boolean);
      if (lines.length) { await DB.insertMany('work_subtasks', lines.map((x, i) => ({ task_id: nt.id, title: x, ord: i + 1 }))); DB.t.work_tasks = await DB.fetchAll('work_tasks'); }
      taskOpenState.add(nt.id);
    } else await DB.update('work_tasks', t.id, { ...row, status: v(m.el, 'ts') });
    m.close(); after?.();
  }, isNew ? 'Task created' : 'Saved');
  m.el.querySelector('#tdel')?.addEventListener('click', () => guard(async () => { if (!(await confirmBox('Delete this task and its sub-tasks?', 'Delete'))) return; await DB.remove('work_tasks', t.id); m.close(); after?.(); }, 'Deleted'));
}

/* ---------- lead record → Tasks tab ---------- */
function tabTasks(l, el, ctx) {
  const ts = DB.t.work_tasks.filter((t) => t.lead_id === l.id).sort((a, b) => Number(!taskOpen(a)) - Number(!taskOpen(b)) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
  el.innerHTML = `<div class="row between"><h3>${ts.length} task${ts.length === 1 ? '' : 's'}</h3><span class="row">${taskTemplates().slice(0, 3).map((x, i) => `<button class="btn small" data-qtpl="${i}">${svg('plus')} ${esc(x.name)}</button>`).join('')}<button class="btn small primary" id="tnew">${svg('plus')} New task</button></span></div>
    ${ts.length ? ts.map((t) => taskCard(t, { open: taskOpen(t) || taskOpenState.has(t.id), showLink: false })).join('') : '<p class="faint">No tasks yet. Add the work this lead needs: MoU ready, a client visit to arrange, a visit to prepare for.</p>'}`;
  el.querySelector('#tnew').onclick = () => taskModal({ lead_id: l.id, institution_id: l.institution_id, owner: l.owner }, () => ctx.render());
  el.querySelectorAll('[data-qtpl]').forEach((b) => (b.onclick = () => guard(async () => {
    const x = taskTemplates()[b.dataset.qtpl];
    const nt = await DB.insert('work_tasks', { title: x.name, lead_id: l.id, institution_id: l.institution_id, owner: l.owner || DB.me.id, created_by: DB.me.id, due_date: localDate(new Date(Date.now() + 7 * 864e5)) });
    await DB.insertMany('work_subtasks', (x.items || []).map((y, i) => ({ task_id: nt.id, title: y, ord: i + 1 }))); DB.t.work_tasks = await DB.fetchAll('work_tasks');
    taskOpenState.add(nt.id); ctx.render();
  }, 'Task added')));
  bindTaskCards(el, () => ctx.render());
}

/* ---------- Tasks: a task manager (board and list), a task drawer with sub-tasks, and live alerts ---------- */
const TF = { scope: 'mine', view: 'board', q: '', pri: '', showDone: false, kind: 'all', proj: '' };
const TSTAT = [['Open', 'To do', 'info'], ['In progress', 'In progress', 'warn'], ['Done', 'Done', 'good']];
function scopedTasks() {
  return DB.t.work_tasks.filter((t) => {
    const l = t.lead_id && DB.get('leads', t.lead_id);
    if (l && !M.deptOk(l.funnel)) return false;
    if (ST.person !== 'all' && t.owner !== ST.person) return false;
    return true;
  });
}
/* tasks I own, tasks with a sub-task on my name, tasks I gave others, or everything in my scope */
const subOwners = (id) => new Set(taskSubs(id).map((x) => x.owner).filter(Boolean));
function tasksFor(scope) {
  const me = DB.me.id; const all = scopedTasks();
  if (scope === 'mine') return all.filter((t) => t.owner === me || subOwners(t.id).has(me));
  if (scope === 'given') return all.filter((t) => t.created_by === me && t.owner !== me);
  return all;
}
const avHTML = (pid, cls = 'sm') => (pid ? `<span class="av ${cls}" style="background:${personColor(pid)}" title="${esc(DB.pname(pid))}">${esc(initials(DB.pname(pid)))}</span>` : `<span class="av ${cls} none" title="Unassigned">?</span>`);
function personColor(pid) { const c = ['#3a6fe0', '#7b5cf0', '#c2457a', '#14a3a0', '#e08a2a', '#2fb36a', '#d0503c', '#5b6bd6']; let h = 0; for (const ch of String(pid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return c[h % c.length]; }
function dueBadge(t) {
  if (!t.due_date) return '';
  const today = todayStr(); const d = t.due_date; const late = taskOpen(t) && d < today; const tod = d === today; const soon = !late && !tod && daysAgo(d) >= -2;
  const cls = t.status === 'Done' ? 'good' : late ? 'bad' : tod ? 'warn' : soon ? 'warn' : '';
  const word = late ? `${fmtDate(d)} · late` : tod ? 'Today' : daysAgo(d) === -1 ? 'Tomorrow' : fmtDate(d);
  return `<span class="tk-due ${cls}">${svg('cal')} ${word}</span>`;
}
const priFlag = (p) => (p && p !== 'Normal' ? `<span class="tk-pri p-${p.toLowerCase()}" title="${p} priority">${svg('flag')} ${p}</span>` : '');
function tkCard(t) {
  const subs = taskSubs(t.id); const done = subs.filter((x) => x.done).length; const lk = taskLink(t); const pct = taskPct(t);
  return `<article class="tk-card pri-${(t.priority || 'Normal').toLowerCase()} ${t.status === 'Done' ? 'is-done' : ''}" draggable="true" data-tk="${t.id}" tabindex="0" aria-label="${esc(t.title)}">
    <div class="tk-top">${priFlag(t.priority)}${recurChip(t)}${lk?.pj ? projBadge(lk.pj) : lk ? `<span class="tk-link">${esc(lk.kind)} · ${esc(lk.name)}</span>` : ''}</div>
    <b class="tk-title">${esc(t.title)}</b>
    ${subs.length ? `<div class="tk-prog"><span class="pbar ${pct === 100 ? 'good' : 'info'} sm"><i style="width:${pct}%"></i></span><span>${svg('check')} ${done}/${subs.length}</span></div>` : ''}
    <div class="tk-meta">${dueBadge(t)}${(t.updates || []).length ? `<span class="tk-cnt" title="Remarks">${svg('chat')} ${(t.updates || []).length}</span>` : ''}<span class="grow"></span>
      ${t.created_by && t.created_by !== t.owner ? `<span class="tk-from" title="Given by ${esc(DB.pname(t.created_by))}">${avHTML(t.created_by, 'xs')}${svg('chevr')}</span>` : ''}${avHTML(t.owner)}</div>
  </article>`;
}
function tkRow(t) {
  const subs = taskSubs(t.id); const done = subs.filter((x) => x.done).length; const lk = taskLink(t);
  return `<div class="tk-row ${t.status === 'Done' ? 'is-done' : ''}" data-tk="${t.id}" tabindex="0">
    <button class="tk-check ${t.status === 'Done' ? 'on' : ''}" data-tkdone="${t.id}" aria-label="${t.status === 'Done' ? 'Mark not done' : 'Mark done'}">${svg('check')}</button>
    <span class="tk-rt"><b>${esc(t.title)} ${recurChip(t)}</b>${lk?.pj ? `<span class="s">${projBadge(lk.pj)}</span>` : lk ? `<span class="s">${esc(lk.kind)} · ${esc(lk.name)}</span>` : ''}</span>
    <span class="tk-rs">${subs.length ? `<span class="tk-cnt">${svg('check')} ${done}/${subs.length}</span>` : ''}</span>
    <span class="tk-rs">${t.status === 'In progress' ? '<span class="chip tone warn">In progress</span>' : ''}</span>
    <span class="tk-rs">${priFlag(t.priority)}</span><span class="tk-rs">${dueBadge(t)}</span>${avHTML(t.owner)}
  </div>`;
}
/* the overview used on My dashboard and the Task Dashboard */
function taskOverview(ts, { title = 'My tasks', link = true } = {}) {
  const today = todayStr(); const wk = localDate(new Date(Date.now() - 7 * 864e5));
  const open = ts.filter((t) => t.status === 'Open'); const prog = ts.filter((t) => t.status === 'In progress'); const live = [...open, ...prog];
  const late = live.filter((t) => t.due_date && t.due_date < today); const dueT = live.filter((t) => t.due_date === today);
  const doneWk = ts.filter((t) => t.status === 'Done' && String(t.done_at || '').slice(0, 10) >= wk);
  const total = live.length + doneWk.length; const pct = total ? Math.round((doneWk.length / total) * 100) : 0;
  const bar = (n, cls) => (n ? `<i class="${cls}" style="flex:${n}" title="${n}"></i>` : '');
  const pri = ['Urgent', 'High', 'Normal', 'Low'].map((p) => [p, live.filter((t) => (t.priority || 'Normal') === p).length]);
  const next = live.slice().sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9'))).slice(0, 5);
  return `<section class="glass panel tov"><div class="panel-head"><h2><span class="gtag amber">${svg('task')} Tasks</span> ${esc(title)}</h2>${link ? '<a class="sub" href="#tasks">Open Tasks →</a>' : ''}</div>
    <div class="tov-grid">
      <div class="tov-ring">${ring(pct, pct + '%', 'Done this week', '#2fb36a')}</div>
      <div class="tov-k">
        <button class="tov-n" data-go="tasks"><b>${nfmt(open.length)}</b><span>To do</span></button>
        <button class="tov-n warn" data-go="tasks"><b>${nfmt(prog.length)}</b><span>In progress</span></button>
        <button class="tov-n bad" data-go="tasks/overdue"><b>${nfmt(late.length)}</b><span>Overdue</span></button>
        <button class="tov-n warn" data-go="tasks"><b>${nfmt(dueT.length)}</b><span>Due today</span></button>
        <button class="tov-n good" data-go="tasks/done"><b>${nfmt(doneWk.length)}</b><span>Done in 7 days</span></button>
      </div>
      <div class="tov-side"><div class="tov-bar" aria-label="By status">${bar(open.length, 'b-info')}${bar(prog.length, 'b-warn')}${bar(doneWk.length, 'b-good')}</div>
        <div class="tov-leg"><span><i class="b-info"></i>To do</span><span><i class="b-warn"></i>In progress</span><span><i class="b-good"></i>Done</span></div>
        <div class="tov-pri">${pri.map(([p, n]) => `<span class="p-${p.toLowerCase()}">${svg('flag')} ${p} <b>${n}</b></span>`).join('')}</div></div>
    </div>
    ${next.length ? `<div class="tov-next"><span class="faint">Next up</span>${next.map((t) => `<button class="tov-it" data-tkopen="${t.id}"><span class="grow">${esc(t.title)}</span>${priFlag(t.priority)}${dueBadge(t)}${avHTML(t.owner)}</button>`).join('')}</div>` : '<p class="faint" style="margin:8px 0 0">Nothing open. Add a task with New task.</p>'}
  </section>`;
}
function bindTaskOverview(root, rer) {
  root.querySelectorAll('.tov [data-go]').forEach((b) => (b.onclick = () => { const [v0, a] = b.dataset.go.split('/'); go(v0, a); }));
  root.querySelectorAll('[data-tkopen]').forEach((b) => (b.onclick = () => taskDrawer(b.dataset.tkopen, rer)));
}

/* ---------- one task, opened: status, assignee, dates, sub-tasks with owners, notes and updates ---------- */
function taskDrawer(id, after) {
  const people = () => (DB.t.profiles || []).filter((p) => p.active).sort((a, b) => Number(b.id === DB.me.id) - Number(a.id === DB.me.id) || a.full_name.localeCompare(b.full_name));
  const pOpts = (sel, blank) => opts(people().map((p) => [p.id, p.id === DB.me.id ? 'Me' : p.full_name]), sel, blank);
  const done = () => { after?.(); };
  return openDrawer((ctx) => {
    const t = DB.get('work_tasks', id); if (!t) return ctx.close();
    const subs = taskSubs(t.id); const pct = taskPct(t); const lk = taskLink(t);
    const canDel = t.created_by === DB.me.id || canReassign();
    ctx.el.innerHTML = `<div class="tkd">
      <div class="drawer-head row between"><span class="faint">${lk ? `<a href="#" ${lk.l ? `data-lead="${lk.l.id}"` : ''} ${lk.pj ? `data-pjo="${lk.pj.id}"` : ''}>${lk.pj ? projBadge(lk.pj) : `${esc(lk.kind)} · ${esc(lk.name)}`}</a>` : 'Task'}</span><button class="btn ghost small" id="tkx" aria-label="Close">${svg('x')}</button></div>
      <div class="seg tkd-st">${[...TSTAT, ['Cancelled', 'Cancelled', 'mute']].map(([k, w]) => `<button data-st="${k}" aria-pressed="${t.status === k}">${w}</button>`).join('')}</div>
      <textarea id="tkt" class="tkd-title" rows="1" aria-label="Task name">${esc(t.title)}</textarea>
      <div class="tkd-f">
        <label>Assignee</label><select id="tko">${pOpts(t.owner)}</select>
        <label>Project</label><select id="tkpj">${opts(ptProjects(t.project_id).map((p) => [p.id, p.name]), t.project_id || '', 'None (lead task)')}</select>
        <label>Start date</label><input type="date" id="tksd" value="${esc(t.start_date || '')}">
        <label>Due date</label><input type="date" id="tkdd" value="${esc(t.due_date || '')}">
        <label>Priority</label><select id="tkp">${opts(TASK_PRI, t.priority || 'Normal')}</select>
        <label>Repeat</label><select id="tkrec">${opts(RECUR, t.recur || '')}</select>
        <label>Remind at</label><span class="tkd-v"><input type="time" id="tkrt" value="${esc(t.remind_time ? String(t.remind_time).slice(0, 5) : '')}"><label class="check"><input type="checkbox" id="tkrem" ${t.remind_email ? 'checked' : ''}> email too</label></span>
        <label>Given by</label><span class="tkd-v">${avHTML(t.created_by)} ${esc(DB.pname(t.created_by))} · ${fmtDT(t.created_at)}</span>
      </div>
      <label class="tkd-l">Description</label><textarea id="tkn" class="tkd-desc" placeholder="Add details, links, what done looks like">${esc(t.notes || '')}</textarea>
      <div class="tkd-sh"><h3>Sub-tasks <span class="faint">${subs.filter((x) => x.done).length}/${subs.length}</span></h3><span class="pbar ${pct === 100 ? 'good' : 'info'} sm"><i style="width:${pct}%"></i></span><b class="tkd-pct">${pct}%</b></div>
      ${subs.length ? '' : `<div class="tkd-prog"><label for="tkpr">Progress <span class="faint">(no sub-tasks, so set it by hand)</span></label><input type="range" id="tkpr" min="0" max="100" step="5" value="${pct}"><output id="tkpro">${pct}%</output></div>`}
      <ul class="tkd-subs">${subs.map((x) => `<li class="${x.done ? 'done' : ''}">
          <button class="tk-check ${x.done ? 'on' : ''}" data-sd="${x.id}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}">${svg('check')}</button>
          <div class="grow"><input class="tkd-sti" data-stt="${x.id}" value="${esc(x.title)}" aria-label="Sub-task">
            <input class="tkd-wd" data-swd2="${x.id}" value="${esc(x.work_done)}" placeholder="Work done (optional)" aria-label="Work done">
            ${x.done ? `<span class="s faint">Done by ${esc(DB.pname(x.done_by))} · ${fmtDT(x.done_at)}</span>` : ''}</div>
          <select class="tkd-so" data-so="${x.id}" aria-label="Sub-task owner">${pOpts(x.owner || '', 'Unassigned')}</select>
          <input type="date" class="tkd-sdd" data-sdd="${x.id}" value="${esc(x.due_date || '')}" aria-label="Sub-task due date">
          <button class="btn ghost small" data-sdel="${x.id}" aria-label="Delete sub-task">${svg('x')}</button></li>`).join('')}
        <li class="tkd-add"><span class="tk-check add">${svg('plus')}</span><input id="sadd" class="grow" placeholder="Add a sub-task and press Enter"><select id="saddo" aria-label="Owner">${pOpts('', 'Unassigned')}</select></li></ul>
      <h3 class="tkd-h">Remarks <span class="faint">${(t.updates || []).length}</span></h3>
      <div class="row tkd-cm"><input id="tku" class="grow" placeholder="Write a remark: progress, a call, a blocker…"><button class="btn small primary" id="tkugo">Add remark</button></div>
      <ul class="feed">${(t.updates || []).slice().reverse().map((u) => `<li><span class="av sm" style="background:${personColor(u.by)}">${esc(initials(DB.pname(u.by)))}</span><div><b>${esc(DB.pname(u.by))}</b> ${esc(u.text)}<span class="s">${fmtDT(u.at)}</span></div></li>`).join('') || '<li class="faint">No updates yet.</li>'}</ul>
      ${canDel ? '<div class="tkd-foot"><button class="btn danger small" id="tkdel">Delete task</button></div>' : ''}
    </div>`;
    const el = ctx.el; const re = () => { ctx.render(); done(); };
    const save = (patch, msg) => guard(async () => { await DB.update('work_tasks', t.id, patch); re(); }, msg);
    el.querySelector('#tkx').onclick = () => ctx.close();
    el.querySelector('[data-pjo]')?.addEventListener('click', (e) => { e.preventDefault(); const id = e.currentTarget.dataset.pjo; ctx.close(); openProject(id); });
    el.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => save({ status: b.dataset.st })));
    const ti = el.querySelector('#tkt'); const fit = () => { ti.style.height = 'auto'; ti.style.height = ti.scrollHeight + 'px'; }; fit(); ti.oninput = fit;
    ti.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ti.blur(); } };
    ti.onblur = () => { const v0 = ti.value.trim(); if (v0 && v0 !== t.title) save({ title: v0 }, 'Saved'); };
    el.querySelector('#tko').onchange = (e) => save({ owner: e.target.value }, 'Assigned to ' + DB.pname(e.target.value));
    el.querySelector('#tkdd').onchange = (e) => save({ due_date: e.target.value || null });
    el.querySelector('#tkrec').onchange = (e) => save({ recur: e.target.value || null, ...(e.target.value && !t.due_date ? { due_date: todayStr() } : {}) }, e.target.value ? 'Repeats ' + RECUR_SHORT[e.target.value].toLowerCase() : 'No longer repeats');
    el.querySelector('#tkrt').onchange = (e) => save({ remind_time: e.target.value || null, last_reminded_on: null }, e.target.value ? 'Reminder at ' + e.target.value : 'Reminder removed');
    el.querySelector('#tkrem').onchange = (e) => save({ remind_email: e.target.checked }, e.target.checked ? 'Email reminder on' : 'Email reminder off');
    el.querySelector('#tksd').onchange = (e) => save({ start_date: e.target.value || null });
    el.querySelector('#tkpj').onchange = (e) => save(e.target.value ? { project_id: e.target.value, lead_id: null, institution_id: null } : { project_id: null }, e.target.value ? 'Moved to the project' : 'Saved');
    const pr = el.querySelector('#tkpr'); if (pr) { pr.oninput = () => { el.querySelector('#tkpro').textContent = pr.value + '%'; }; pr.onchange = () => { const n = Number(pr.value); save({ progress: n, ...(n === 100 && t.status !== 'Done' ? { status: 'Done' } : n > 0 && t.status === 'Open' ? { status: 'In progress' } : {}) }, 'Progress ' + n + '%'); }; }
    el.querySelector('#tkp').onchange = (e) => save({ priority: e.target.value });
    el.querySelector('#tkn').onblur = (e) => { if (e.target.value !== (t.notes || '')) save({ notes: e.target.value }, 'Saved'); };
    el.querySelectorAll('[data-sd]').forEach((b) => (b.onclick = () => guard(async () => { const x = DB.get('work_subtasks', b.dataset.sd); await DB.update('work_subtasks', x.id, { done: !x.done }); DB.t.work_tasks = await DB.fetchAll('work_tasks'); re(); })));
    el.querySelectorAll('[data-stt]').forEach((i) => (i.onblur = () => { const x = DB.get('work_subtasks', i.dataset.stt); if (x && i.value.trim() && i.value.trim() !== x.title) guard(async () => { await DB.update('work_subtasks', x.id, { title: i.value.trim() }); }, 'Saved'); }));
    el.querySelectorAll('[data-swd2]').forEach((i) => (i.onblur = () => { const x = DB.get('work_subtasks', i.dataset.swd2); if (x && i.value.trim() !== x.work_done) guard(async () => { await DB.update('work_subtasks', x.id, { work_done: i.value.trim() }); }, 'Saved'); }));
    el.querySelectorAll('[data-so]').forEach((s0) => (s0.onchange = () => guard(async () => { await DB.update('work_subtasks', s0.dataset.so, { owner: s0.value || null }); re(); }, s0.value ? 'Assigned to ' + DB.pname(s0.value) : 'Saved')));
    el.querySelectorAll('[data-sdd]').forEach((d) => (d.onchange = () => guard(async () => { await DB.update('work_subtasks', d.dataset.sdd, { due_date: d.value || null }); re(); })));
    el.querySelectorAll('[data-sdel]').forEach((b) => (b.onclick = () => guard(async () => { await DB.remove('work_subtasks', b.dataset.sdel); DB.t.work_tasks = await DB.fetchAll('work_tasks'); re(); })));
    const sa = el.querySelector('#sadd');
    sa.onkeydown = (e) => { if (e.key !== 'Enter' || !sa.value.trim()) return; const title = sa.value.trim(); const ow = v(el, 'saddo') || null;
      guard(async () => { await DB.insert('work_subtasks', { task_id: t.id, title, owner: ow, ord: subs.length + 1 }); DB.t.work_tasks = await DB.fetchAll('work_tasks'); re(); setTimeout(() => ctx.el.querySelector('#sadd')?.focus(), 30); }); };
    const post = () => { const text = v(el, 'tku').trim(); if (!text) return; save({ updates: [...(t.updates || []), { at: nowISO(), by: DB.me.id, text }] }, 'Remark added'); };
    el.querySelector('#tkugo').onclick = post; el.querySelector('#tku').onkeydown = (e) => { if (e.key === 'Enter') post(); };
    el.querySelector('#tkdel')?.addEventListener('click', () => guard(async () => { if (!(await confirmBox('Delete this task and its sub-tasks?', 'Delete'))) return; await DB.remove('work_tasks', t.id); ctx.close(); done(); }, 'Deleted'));
    bindLeadClicks(el);
  }, 'tkdrawer');
}

VIEWS.tasks = {
  title: 'Tasks', sub: 'Lead tasks and project tasks: a board by status, a list by due date, sub-tasks with owners, and live updates. Each project task shows its project.',
  actions: () => `<button class="btn primary" id="newtask">${svg('plus')} New task</button>`,
  render(el) {
    let openId = null;
    if (ST.arg) { if (/^p-[0-9a-f-]{36}$/.test(ST.arg)) { TF.proj = ST.arg.slice(2); TF.kind = 'project'; TF.scope = 'team'; if (TF.view === 'projects') TF.view = 'list'; } else if (/^[0-9a-f-]{36}$/.test(ST.arg)) openId = ST.arg; else if (ST.arg === 'overdue') { TF.view = 'list'; TF.q = ''; } else if (ST.arg === 'done') { TF.showDone = true; } ST.arg = null; }
    const today = todayStr(); const wkEnd = localDate(new Date(Date.now() + 7 * 864e5)); const doneSince = localDate(new Date(Date.now() - 30 * 864e5));
    const base = tasksFor(TF.scope).filter((t) => t.status !== 'Cancelled')
      .filter((t) => TF.kind === 'all' || (TF.kind === 'routine' ? !!t.recur : (TF.kind === 'project') === isProjTask(t)))
      .filter((t) => !TF.proj || t.project_id === TF.proj)
      .filter((t) => !TF.pri || (t.priority || 'Normal') === TF.pri)
      .filter((t) => !TF.q || `${t.title} ${t.notes || ''} ${taskLink(t)?.name || ''} ${taskSubs(t.id).map((x) => x.title).join(' ')}`.toLowerCase().includes(TF.q.toLowerCase()));
    const byDue = (a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')) || ({ Urgent: 0, High: 1, Normal: 2, Low: 3 })[a.priority || 'Normal'] - ({ Urgent: 0, High: 1, Normal: 2, Low: 3 })[b.priority || 'Normal'];
    const doneOk = (t) => TF.showDone || String(t.done_at || t.updated_at || '').slice(0, 10) >= doneSince;
    const cnt = { mine: tasksFor('mine'), given: tasksFor('given'), team: tasksFor('team') };
    const live = base.filter(taskOpen);
    const board = () => `<div class="tk-board">${TSTAT.map(([k, w, tone]) => { const col = base.filter((t) => t.status === k && (k !== 'Done' || doneOk(t))).sort(k === 'Done' ? (a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')) : byDue);
      return `<section class="tk-col" data-col="${k}"><div class="tk-colh"><span class="dot ${tone}"></span><b>${w}</b><span class="faint">${col.length}</span><span class="grow"></span>${k !== 'Done' ? `<button class="btn ghost small" data-qadd="${k}" aria-label="Add to ${w}">${svg('plus')}</button>` : `<button class="lnk small" id="tshowdone">${TF.showDone ? 'Last 30 days only' : 'Show all'}</button>`}</div>
        <div class="tk-qa" data-qa="${k}" hidden><input placeholder="Task name, then Enter" data-qain="${k}"></div>
        <div class="tk-cards" data-drop="${k}">${col.map(tkCard).join('') || '<p class="tk-empty">Drop a task here</p>'}</div></section>`; }).join('')}</div>`;
    const groups = [['Overdue', (t) => taskOpen(t) && t.due_date && t.due_date < today, 'bad'], ['Today', (t) => taskOpen(t) && t.due_date === today, 'warn'], ['Next 7 days', (t) => taskOpen(t) && t.due_date > today && t.due_date <= wkEnd, 'info'], ['Later', (t) => taskOpen(t) && t.due_date > wkEnd, 'info'], ['No date', (t) => taskOpen(t) && !t.due_date, 'mute'], ['Done', (t) => t.status === 'Done' && doneOk(t), 'good']];
    const list = () => groups.map(([g, f, tone]) => { const xs = base.filter(f).sort(g === 'Done' ? (a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')) : byDue); return xs.length ? `<section class="tk-grp tone-${tone}"><h3><span class="dot ${tone}"></span>${g} <span class="faint">${xs.length}</span></h3>${xs.map(tkRow).join('')}</section>` : ''; }).join('') || empty('No tasks here', 'Add one with New task, or change the filters.');
    el.innerHTML = `${filterBar({ period: false })}
      ${taskOverview(base, { title: TF.scope === 'mine' ? 'My tasks' : TF.scope === 'given' ? 'Tasks I gave to others' : 'Team tasks', link: false })}
      <section class="glass panel tk-wrap">
        <div class="tk-bar">
          <div class="seg">${[['mine', 'My tasks'], ['given', 'Assigned by me'], ['team', 'Team']].map(([k, w]) => `<button data-sc="${k}" aria-pressed="${TF.scope === k}">${w} <span class="faint">${cnt[k].filter(taskOpen).length}</span></button>`).join('')}</div>
          <div class="seg">${[['lead', 'Lead tasks'], ['project', 'Project tasks'], ['routine', 'Routines'], ['all', 'All']].map(([k, w]) => `<button data-tkk="${k}" aria-pressed="${TF.kind === k}">${w}</button>`).join('')}</div>
          <div class="seg">${[['board', 'Board', 'kanban'], ['list', 'List', 'list']].map(([k, w, ic]) => `<button data-vw="${k}" aria-pressed="${TF.view === k}">${svg(ic)} ${w}</button>`).join('')}</div>
          <input type="search" id="tq" placeholder="Search tasks" value="${esc(TF.q)}">
          <select id="tpri" aria-label="Priority"><option value="">Any priority</option>${opts(TASK_PRI, TF.pri)}</select>
          <span class="faint tk-sum">${live.length} open · ${live.filter((t) => t.due_date && t.due_date < today).length} overdue</span>
        </div>
        ${TF.proj && DB.get('projects', TF.proj) ? `<div class="tk-pjf">${svg('proj')} Tasks of <b>${esc(DB.get('projects', TF.proj).name)}</b><button class="btn ghost small" id="tpjx">${svg('x')} Show all</button><a class="btn small" href="#projects/p-${TF.proj}">Project overview</a></div>` : ''}
        ${TF.view === 'board' ? board() : `<div class="tk-list">${list()}</div>`}
      </section>`;
    const rer = () => this.render(el);
    el.querySelectorAll('[data-sc]').forEach((b) => (b.onclick = () => { TF.scope = b.dataset.sc; rer(); }));
    el.querySelectorAll('[data-vw]').forEach((b) => (b.onclick = () => { TF.view = b.dataset.vw; rer(); }));
    el.querySelectorAll('[data-tkk]').forEach((b) => (b.onclick = () => { TF.kind = b.dataset.tkk; if (TF.kind === 'lead') TF.proj = ''; rer(); }));
    el.querySelector('#tpjx')?.addEventListener('click', () => { TF.proj = ''; rer(); });
    el.querySelector('#tpri').onchange = (e) => { TF.pri = e.target.value; rer(); };
    el.querySelector('#tshowdone')?.addEventListener('click', () => { TF.showDone = !TF.showDone; rer(); });
    el.querySelector('#tq').oninput = (e) => { TF.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { rer(); const i = el.querySelector('#tq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    el.querySelectorAll('[data-tk]').forEach((c) => { c.onclick = (e) => { if (e.target.closest('[data-tkdone]')) return; taskDrawer(c.dataset.tk, rer); }; c.onkeydown = (e) => { if (e.key === 'Enter') taskDrawer(c.dataset.tk, rer); }; });
    el.querySelectorAll('[data-tkdone]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = DB.get('work_tasks', b.dataset.tkdone); guard(async () => { await DB.update('work_tasks', t.id, { status: t.status === 'Done' ? 'Open' : 'Done' }); rer(); }, t.status === 'Done' ? 'Reopened' : 'Done'); }));
    el.querySelectorAll('[data-qadd]').forEach((b) => (b.onclick = () => { const q = el.querySelector(`[data-qa="${b.dataset.qadd}"]`); q.hidden = !q.hidden; if (!q.hidden) q.querySelector('input').focus(); }));
    el.querySelectorAll('[data-qain]').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Escape') { i.parentElement.hidden = true; return; } if (e.key !== 'Enter' || !i.value.trim()) return;
      guard(async () => { await DB.insert('work_tasks', { title: i.value.trim(), owner: DB.me.id, created_by: DB.me.id, status: i.dataset.qain, priority: 'Normal' }); rer(); }, 'Task added'); }));
    /* drag a card to another column to change its status */
    el.querySelectorAll('.tk-card').forEach((c) => { c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', c.dataset.tk); e.dataTransfer.effectAllowed = 'move'; c.classList.add('drag'); }; c.ondragend = () => c.classList.remove('drag'); });
    el.querySelectorAll('[data-drop]').forEach((z) => {
      z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); }; z.ondragleave = () => z.classList.remove('over');
      z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); const t = DB.get('work_tasks', id); if (!t || t.status === z.dataset.drop) return; guard(async () => { await DB.update('work_tasks', id, { status: z.dataset.drop }); rer(); }, 'Moved to ' + TSTAT.find((x) => x[0] === z.dataset.drop)[1]); };
    });
    bindFilters(el, rer); bindTaskOverview(el, rer);
    if (openId) taskDrawer(openId, rer);
  },
  mount() { $('#newtask')?.addEventListener('click', () => taskModal({}, () => render())); },
};

/* ---------- live alerts: a sound and a pop-up when a task or sub-task lands on my name ---------- */
const SOUND = { ctx: null, on() { try { return localStorage.getItem('garuda-sound') !== '0'; } catch (_) { return true; } } };
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { try { SOUND.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (SOUND.ctx.state === 'suspended') SOUND.ctx.resume(); } catch (_) { /* no audio */ } }, { passive: true }));
/* a short two-note chime; 'task' rises, 'chat' is a soft single note, 'alert' repeats */
function chime(kind = 'task') {
  if (!SOUND.on() || !SOUND.ctx) return;
  try {
    const c = SOUND.ctx; const t0 = c.currentTime + 0.01;
    const notes = kind === 'chat' ? [[880, 0, 0.18]] : kind === 'alert' ? [[784, 0, 0.16], [784, 0.22, 0.16], [1047, 0.44, 0.3]] : [[659, 0, 0.18], [988, 0.16, 0.34]];
    notes.forEach(([f, at, dur]) => {
      const o = c.createOscillator(); const g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(kind === 'chat' ? 0.12 : 0.22, t0 + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(c.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
    });
  } catch (_) { /* ignore */ }
}
function liveNotice(title, sub, open) {
  let box = $('#alerts'); if (!box) { box = document.createElement('div'); box.id = 'alerts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const n = document.createElement('div'); n.className = 'atoast glass tone-info';
  n.innerHTML = `<span class="ai info">${svg('task')}</span><div class="grow"><b>${esc(title)}</b>${sub ? `<span class="s">${esc(sub)}</span>` : ''}<span class="row"><button class="btn small primary" data-x="open">Open</button></span></div><button class="btn ghost small" data-x="close" aria-label="Close">${svg('x')}</button>`;
  n.querySelector('[data-x="open"]').onclick = () => { n.remove(); open(); };
  n.querySelector('[data-x="close"]').onclick = () => n.remove();
  box.appendChild(n); setTimeout(() => n.remove(), 20000);
  try { if ('Notification' in window && window.Notification.permission === 'granted' && document.hidden) { const w = new window.Notification('Garuda CRM · ' + title, { body: sub || '', tag: 'tk-' + Date.now() }); w.onclick = () => { window.focus(); open(); }; } } catch (_) { /* ignore */ }
}
/* called by the live feed (core.js) for every change; prev is the row as it was on this screen */
function onLiveChange(t, type, row, prev) {
  if (!DB.me || !row || type === 'DELETE') return;
  /* wait a moment: if this screen made the change itself, its own save marks the row first */
  setTimeout(() => liveCheck(t, type, row, prev), 1200);
}
function liveCheck(t, type, row, prev) {
  if (DB.recentLocal(row.id)) return;
  const me = DB.me.id;
  if (t === 'work_tasks' && row.owner === me && (type === 'INSERT' || (prev && prev.owner !== me)) && row.created_by !== me) {
    chime('task'); liveNotice(`New task from ${DB.pname(row.created_by)}`, row.title + (row.due_date ? ' · due ' + fmtDate(row.due_date) : ''), () => go('tasks', row.id));
  } else if (t === 'work_subtasks' && row.owner === me && (type === 'INSERT' || (prev && prev.owner !== me))) {
    const parent = DB.get('work_tasks', row.task_id);
    chime('task'); liveNotice('New sub-task for you', row.title + (parent ? ' · in ' + parent.title : ''), () => go('tasks', row.task_id));
  } else if (t === 'leads' && prev && row.owner === me && typeof celebrate === 'function') {
    celebrate(prev, row);
  } else if (t === 'notifications' && type === 'INSERT' && row.user_id === me) {
    chime(row.kind === 'bad' ? 'alert' : 'task'); liveNotice(row.title, row.body || '', () => (String(row.link || '').startsWith('tasks/') ? go('tasks', row.link.slice(6)) : row.lead_id ? openLead(row.lead_id) : go('automations')));
  } else if (t === 'chat_messages' && type === 'INSERT' && row.sender !== me) {
    const r = row.room || ''; const mine = r.startsWith('dm:') ? r.includes(me) : r === 'general' || (r.startsWith('dept:') && (DB.me.departments || []).includes(r.slice(5)));
    if (mine && ST.view !== 'chat') chime('chat');
  }
}
/* ---------- Task Dashboard ---------- */
VIEWS.taskdash = {
  title: 'Task Dashboard', sub: 'Add a task for yourself or give it to anyone. See what is open, late and done, by person, with the latest work done.',
  actions: () => `<button class="btn primary" id="newtask2">${svg('plus')} New task</button>`,
  mount() { $('#newtask2')?.addEventListener('click', () => taskModal({}, () => render())); },
  render(el) {
    const r = curRange(); const ts = scopedTasks(); const open = ts.filter(taskOpen); const today = todayStr();
    const late = open.filter((t) => taskTone(t) === 'bad'); const dueToday = open.filter((t) => t.due_date === today);
    const doneR = ts.filter((t) => t.status === 'Done' && M.inR(t.done_at, r));
    const avg = open.length ? Math.round(sum(open, taskPct) / open.length) : 0;
    const ids = new Set(ts.map((t) => t.id));
    const feed = [
      ...DB.t.work_subtasks.filter((s) => ids.has(s.task_id) && s.done && M.inR(s.done_at, r)).map((s) => ({ at: s.done_at, by: s.done_by, t: DB.get('work_tasks', s.task_id), text: `ticked “${s.title}”${s.work_done ? ': ' + s.work_done : ''}`, tone: 'good' })),
      ...ts.flatMap((t) => (t.updates || []).filter((u) => M.inR(u.at, r)).map((u) => ({ at: u.at, by: u.by, t, text: u.text, tone: 'info' }))),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 14);
    const people = scopePeople().filter((p) => ts.some((t) => t.owner === p.id));
    const soon = open.filter((t) => t.due_date && t.due_date >= today && daysAgo(t.due_date) >= -7).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const mineOpen = DB.t.work_tasks.filter((t) => t.owner === DB.me.id && taskOpen(t)).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
    const gave = DB.t.work_tasks.filter((t) => t.created_by === DB.me.id && t.owner !== DB.me.id && taskOpen(t)).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
    el.innerHTML = `${filterBar()}
      ${taskOverview(ts, { title: 'Everyone in my view' })}
      <section class="glass panel qadd"><div class="row"><span class="gtag blue">${svg('plus')} Quick task</span><input id="qtt" placeholder="What needs doing? e.g. Prepare MoU draft for SRM by Friday" aria-label="Task">
        <select id="qto" aria-label="Assign to">${opts((DB.t.profiles || []).filter((p) => p.active).sort((a, b) => Number(b.id === DB.me.id) - Number(a.id === DB.me.id) || a.full_name.localeCompare(b.full_name)).map((p) => [p.id, p.id === DB.me.id ? 'Myself' : p.full_name]), DB.me.id)}</select>
        <input type="date" id="qtd" aria-label="Due date" value="${localDate(new Date(Date.now() + 864e5))}"><button class="btn primary" id="qgo">Add</button><button class="btn" id="qmore">More details</button></div></section>
      <div class="kpis">
        ${kpi({ label: 'Open tasks', value: nfmt(open.length), sub: `${avg}% done on average` , meter: avg })}
        <div class="kpi tone-k bad"><span class="l">Overdue</span><span class="v">${nfmt(late.length)}</span><span class="s"><a href="#tasks/overdue">Open the list →</a></span></div>
        <div class="kpi tone-k warn"><span class="l">Due today</span><span class="v">${nfmt(dueToday.length)}</span><span class="s">Still open</span></div>
        <div class="kpi tone-k good"><span class="l">Completed</span><span class="v">${nfmt(doneR.length)}</span><span class="s">${r.label}</span></div>
      </div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag violet">People</span> Tasks by person</h2><span class="sub">Open now · completed in ${r.label.toLowerCase()}</span></div>
          ${tbl(['Person', 'Open', 'Overdue', 'Completed', 'Progress'], people.map((p) => { const o = open.filter((t) => t.owner === p.id); const lt = o.filter((t) => taskTone(t) === 'bad').length; const pr = o.length ? Math.round(sum(o, taskPct) / o.length) : 100; return `<tr><td>${esc(p.full_name)}</td><td class="n">${o.length}</td><td class="n">${lt ? `<span class="chip tone bad">${lt}</span>` : '0'}</td><td class="n">${doneR.filter((t) => t.owner === p.id).length}</td><td class="n"><span class="pbar ${lt ? 'bad' : pr >= 70 ? 'good' : 'info'} sm"><i style="width:${pr}%"></i></span> ${pr}%</td></tr>`; }))}</section>
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag teal">Work done</span> Latest</h2><span class="sub">${r.label}</span></div>
          ${feed.length ? `<ul class="feed">${feed.map((x) => `<li class="tone-${x.tone}"><span class="av sm">${esc(initials(DB.pname(x.by)))}</span><div><b>${esc(DB.pname(x.by))}</b> ${esc(x.text)}<span class="s">${esc(x.t?.title || '')}${x.t && taskLink(x.t) ? ' · ' + esc(taskLink(x.t).name) : ''} · ${rel(x.at)}</span></div></li>`).join('')}</ul>` : '<p class="faint">No work recorded in this period.</p>'}</section>
      </div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag blue">Mine</span> My open tasks</h2><span class="sub">${mineOpen.length} open</span></div>${mineOpen.length ? `<div class="tlist">${mineOpen.slice(0, 8).map((t) => taskCard(t, { open: false })).join('')}</div>` : '<p class="faint">Nothing open on your name.</p>'}</section>
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag violet">Given</span> Tasks I gave to others</h2><span class="sub">${gave.length} open</span></div>${gave.length ? `<div class="tlist">${gave.slice(0, 8).map((t) => taskCard(t, { open: false })).join('')}</div>` : '<p class="faint">You have not given anyone a task that is still open.</p>'}</section>
      </div>
      <div class="grid g2">
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag amber">Next 7 days</span> Due soon</h2></div>${soon.length ? `<div class="tlist">${soon.slice(0, 8).map((t) => taskCard(t, { open: false })).join('')}</div>` : '<p class="faint">Nothing due in the next 7 days.</p>'}</section>
        <section class="glass panel"><div class="panel-head"><h2><span class="gtag red">Late</span> Overdue</h2></div>${late.length ? `<div class="tlist">${late.slice(0, 8).map((t) => taskCard(t, { open: false })).join('')}</div>` : '<p class="faint">Nothing overdue.</p>'}</section>
      </div>`;
    bindFilters(el, () => this.render(el)); bindTaskCards(el, () => this.render(el)); bindTaskOverview(el, () => this.render(el));
    el.querySelector('#qmore').onclick = () => taskModal({ title: v(el, 'qtt'), owner: v(el, 'qto'), due_date: v(el, 'qtd') }, () => this.render(el));
    const add = () => guard(async () => {
      const title = v(el, 'qtt').trim(); if (!title) throw new Error('Write the task first.');
      await DB.insert('work_tasks', { title, owner: v(el, 'qto'), due_date: v(el, 'qtd') || null, created_by: DB.me.id, priority: 'Normal' });
      this.render(el);
    }, 'Task added');
    el.querySelector('#qgo').onclick = add; el.querySelector('#qtt').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  },
};
