/* Garuda CRM · Tasks on leads and deals (MoU ready, client visiting us, visit preparation …), with sub-tasks and work done.
   Task Dashboard (Overview) and the Tasks line items (Execution); each lead record has a Tasks tab beside Activity. */
'use strict';

const TASK_PRI = ['Low', 'Normal', 'High', 'Urgent'];
const taskOpen = (t) => !['Done', 'Cancelled'].includes(t.status);
const taskSubs = (id) => DB.t.work_subtasks.filter((s) => s.task_id === id).sort((a, b) => a.ord - b.ord || String(a.created_at).localeCompare(String(b.created_at)));
function taskPct(t) { const s = taskSubs(t.id); if (!s.length) return t.status === 'Done' ? 100 : 0; return Math.round((s.filter((x) => x.done).length / s.length) * 100); }
/* positive / alarming / negative */
function taskTone(t) {
  if (t.status === 'Done') return 'good';
  if (t.status === 'Cancelled') return 'mute';
  if (t.due_date && t.due_date < todayStr()) return 'bad';
  if (t.due_date && daysAgo(t.due_date) >= -2) return 'warn';
  return 'info';
}
const toneWord = { good: 'Done', bad: 'Overdue', warn: 'Due soon', info: 'On track', mute: 'Cancelled' };
const taskLink = (t) => { const l = t.lead_id && DB.get('leads', t.lead_id); const i = t.institution_id && DB.get('institutions', t.institution_id); return l ? { kind: l.is_deal ? 'Deal' : 'Lead', name: L.company(l) && !l.name.includes(L.company(l)) ? `${l.name} · ${L.company(l)}` : l.name, l } : i ? { kind: 'Account', name: i.name } : null; };
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
      ${fld('tlink', 'Lead, deal or account', recordPicker('tlink', t), 'full')}
      ${fld('to', 'Assign to', `<select id="to">${opts(people.map((p) => [p.id, p.id === DB.me.id ? `Myself (${p.full_name})` : `${p.full_name}${p.designation ? ' · ' + p.designation : ''}`]), t.owner || lead?.owner || DB.me.id)}</select>`)}${fld('td', 'Due date', inp('td', t.due_date || '', 'date'))}
      ${fld('tp', 'Priority', sel('tp', TASK_PRI, t.priority || 'Normal'))}${isNew ? '' : fld('ts', 'Status', sel('ts', ['Open', 'In progress', 'Done', 'Cancelled'], t.status))}
      ${isNew ? fld('tsubs', 'Sub-tasks (one per line)', '<textarea id="tsubs" style="min-height:140px" placeholder="Draft the MoU&#10;Internal review&#10;Share with the client"></textarea>', 'full') : `<div class="full faint" style="font-size:12.5px">${subs.length} sub-tasks · tick them and add sub-tasks on the task itself.</div>`}
      ${fld('tn', 'Notes', `<textarea id="tn">${esc(t.notes || '')}</textarea>`, 'full')}</div>`,
    foot: `${!isNew && (t.created_by === DB.me.id || canReassign()) ? '<button class="btn danger" id="tdel" style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" id="tsave">${isNew ? 'Create task' : 'Save'}</button>` });
  bindPicker(m.el, 'tlink');
  m.el.querySelectorAll('[data-tpl]').forEach((b) => (b.onclick = () => { const x = taskTemplates()[b.dataset.tpl]; if (!v(m.el, 'tt')) m.el.querySelector('#tt').value = x.name; m.el.querySelector('#tsubs').value = (x.items || []).join('\n'); }));
  m.el.querySelector('#tsave').onclick = () => guard(async () => {
    const title = v(m.el, 'tt').trim(); if (!title) throw new Error('Name the task.');
    const link = pickerVal(m.el, 'tlink');
    const row = { title, lead_id: link.lead_id, institution_id: link.institution_id, owner: v(m.el, 'to'), due_date: v(m.el, 'td') || null, priority: v(m.el, 'tp'), notes: v(m.el, 'tn') };
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

/* ---------- Tasks: line items of every task and sub-task in my scope ---------- */
const TF = { state: 'open', q: '', mine: false, byme: false };
function scopedTasks() {
  return DB.t.work_tasks.filter((t) => {
    const l = t.lead_id && DB.get('leads', t.lead_id);
    if (l && !M.deptOk(l.funnel)) return false;
    if (ST.person !== 'all' && t.owner !== ST.person) return false;
    return true;
  });
}
VIEWS.tasks = {
  title: 'Tasks', sub: 'Every task on your leads and deals, with its sub-tasks, progress and the work done.',
  actions: () => `<button class="btn primary" id="newtask">${svg('plus')} New task</button>`,
  render(el) {
    if (ST.arg) { if (['open', 'week', 'overdue', 'done', 'all'].includes(ST.arg)) TF.state = ST.arg; ST.arg = null; }
    const base = scopedTasks().filter((t) => (!TF.mine || t.owner === DB.me.id) && (!TF.byme || (t.created_by === DB.me.id && t.owner !== DB.me.id)));
    const wkEnd = localDate(new Date(Date.now() + 7 * 864e5));
    const F = { open: taskOpen, week: (t) => taskOpen(t) && t.due_date && t.due_date <= wkEnd, overdue: (t) => taskTone(t) === 'bad', done: (t) => t.status === 'Done', all: () => true };
    const rows = base.filter(F[TF.state]).filter((t) => !TF.q || `${t.title} ${taskLink(t)?.name || ''} ${taskSubs(t.id).map((s) => s.title + ' ' + s.work_done).join(' ')}`.toLowerCase().includes(TF.q.toLowerCase()))
      .sort((a, b) => ({ bad: 0, warn: 1, info: 2, good: 3, mute: 4 })[taskTone(a)] - ({ bad: 0, warn: 1, info: 2, good: 3, mute: 4 })[taskTone(b)] || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
    el.innerHTML = `${filterBar({ period: false })}<section class="glass panel">
      <div class="filters" style="margin-bottom:10px"><div class="seg">${[['open', 'Open'], ['week', 'Due in 7 days'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']].map(([k, t]) => `<button data-tf="${k}" aria-pressed="${TF.state === k}">${t} <span class="faint">${base.filter(F[k]).length}</span></button>`).join('')}</div>
        <input type="search" id="tq" placeholder="Search tasks, sub-tasks, work done" value="${esc(TF.q)}"><label class="check"><input type="checkbox" id="tmine" ${TF.mine ? 'checked' : ''}> Only mine</label><label class="check"><input type="checkbox" id="tbyme" ${TF.byme ? 'checked' : ''}> I gave to others</label></div>
      ${rows.length ? `<div class="tlist">${rows.slice(0, 150).map((t) => taskCard(t, { open: taskOpenState.has(t.id) || rows.length <= 8 })).join('')}</div>` : empty('No tasks here', 'Add tasks from a lead or deal (Tasks tab), or with New task.')}</section>`;
    const rer = () => this.render(el);
    el.querySelectorAll('[data-tf]').forEach((b) => (b.onclick = () => { TF.state = b.dataset.tf; rer(); }));
    el.querySelector('#tmine').onchange = (e) => { TF.mine = e.target.checked; rer(); };
    el.querySelector('#tbyme').onchange = (e) => { TF.byme = e.target.checked; rer(); };
    el.querySelector('#tq').oninput = (e) => { TF.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { rer(); const i = el.querySelector('#tq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    bindFilters(el, rer); bindTaskCards(el, rer);
  },
  mount() { $('#newtask')?.addEventListener('click', () => taskModal({}, () => render())); },
};

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
    bindFilters(el, () => this.render(el)); bindTaskCards(el, () => this.render(el));
    el.querySelector('#qmore').onclick = () => taskModal({ title: v(el, 'qtt'), owner: v(el, 'qto'), due_date: v(el, 'qtd') }, () => this.render(el));
    const add = () => guard(async () => {
      const title = v(el, 'qtt').trim(); if (!title) throw new Error('Write the task first.');
      await DB.insert('work_tasks', { title, owner: v(el, 'qto'), due_date: v(el, 'qtd') || null, created_by: DB.me.id, priority: 'Normal' });
      this.render(el);
    }, 'Task added');
    el.querySelector('#qgo').onclick = add; el.querySelector('#qtt').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  },
};
