/* Garuda CRM · Project tasks: Project → Task → Sub-task → Progress.
   The Projects view inside Tasks: every project with its % complete, then a project-wise tree of tasks and sub-tasks. */
'use strict';

/* projects for the pickers: open ones, plus the one already chosen */
const ptProjects = (keep) => DB.t.projects.filter((p) => p.status !== 'Completed' || p.id === keep).sort((a, b) => a.name.localeCompare(b.name));
const projTasks = (pid) => DB.t.work_tasks.filter((t) => t.project_id === pid && t.status !== 'Cancelled');
/* % complete: each sub-task counts once, a task without sub-tasks counts as one (its own % by hand) */
function projProgress(p) {
  const ts = projTasks(p.id);
  if (ts.length) {
    let units = 0; let done = 0; let subsAll = 0; let subsDone = 0;
    ts.forEach((t) => { const s = taskSubs(t.id); const w = Math.max(1, s.length); units += w; done += (taskPct(t) / 100) * w; subsAll += s.length; subsDone += s.filter((x) => x.done).length; });
    return { pct: Math.round((done / units) * 100), tasks: ts.length, tasksDone: ts.filter((t) => t.status === 'Done').length, subs: subsAll, subsDone, late: ts.filter((t) => taskOpen(t) && t.due_date && t.due_date < todayStr()).length, prog: ts.filter((t) => t.status === 'In progress').length, from: 'tasks' };
  }
  const ms = projItems(p.id).filter((i) => i.kind !== 'payment' && i.status !== 'Cancelled');
  if (ms.length) return { pct: Math.round((ms.filter((i) => i.status === 'Done').length / ms.length) * 100), tasks: 0, tasksDone: 0, subs: 0, subsDone: 0, late: 0, prog: 0, from: 'milestones' };
  return { pct: p.status === 'Completed' ? 100 : 0, tasks: 0, tasksDone: 0, subs: 0, subsDone: 0, late: 0, prog: 0, from: 'none' };
}
/* on track, behind, at risk, late or done, from the dates and the % */
function projHealth(p, g = projProgress(p)) {
  const today = todayStr(); const end = p.end_date || p.target_date; const start = p.start_date || String(p.created_at || '').slice(0, 10);
  if (p.status === 'Completed' || g.pct === 100) return ['Done', 'good'];
  if (p.status === 'On hold') return ['On hold', 'mute'];
  if (end && end < today) return ['Late', 'bad'];
  if (g.late) return ['At risk', 'warn'];
  if (start && end && end > start) { const exp = ((new Date(today) - new Date(start)) / (new Date(end) - new Date(start))) * 100; if (exp > 0 && g.pct < exp - 20) return ['Behind', 'warn']; }
  return ['On track', 'info'];
}
const ptDays = (a, b) => (a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5) + 1) : 0);
const ptTone = (pct) => (pct >= 100 ? 'good' : pct >= 60 ? 'info' : pct >= 25 ? 'warn' : 'low');
function ptRing(pct, size = 58) {
  const r = (size - 8) / 2; const c = 2 * Math.PI * r;
  return `<svg class="pt-ring t-${ptTone(pct)}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="${pct}% complete"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="50%" dy=".35em" text-anchor="middle">${pct}%</text></svg>`;
}
const ptBar = (pct) => `<span class="pt-bar t-${ptTone(pct)}"><i style="width:${pct}%"></i></span><b class="pt-pc">${pct}%</b>`;

const PTS = { status: 'active', sort: 'due', closed: new Set(), topen: new Set() };
function ptRender(box, rer) {
  if (!box) return;
  const today = todayStr();
  let projects = DB.t.projects.filter((p) => M.deptOk(p.dept) && (ST.person === 'all' || p.owner === ST.person || p.deal_owner === ST.person || projTasks(p.id).some((t) => t.owner === ST.person)));
  if (PTS.status === 'active') projects = projects.filter((p) => p.status !== 'Completed');
  else if (PTS.status === 'Completed') projects = projects.filter((p) => p.status === 'Completed');
  const G = new Map(projects.map((p) => [p.id, projProgress(p)]));
  const S = { due: (a, b) => String(a.end_date || a.target_date || '9999').localeCompare(String(b.end_date || b.target_date || '9999')), progress: (a, b) => G.get(a.id).pct - G.get(b.id).pct, name: (a, b) => a.name.localeCompare(b.name) };
  projects.sort(S[PTS.sort] || S.due);
  const all = [...G.values()]; const tasksN = sum(all, (g) => g.tasks); const tasksD = sum(all, (g) => g.tasksDone); const lateN = sum(all, (g) => g.late);
  const avg = projects.length ? Math.round(sum(all, (g) => g.pct) / projects.length) : 0;
  const attention = projects.filter((p) => ['Late', 'At risk', 'Behind'].includes(projHealth(p, G.get(p.id))[0])).length;
  const q = TF.q.trim().toLowerCase();
  const taskShown = (t) => (!TF.pri || (t.priority || 'Normal') === TF.pri) && (!q || `${t.title} ${t.notes || ''} ${taskSubs(t.id).map((x) => x.title).join(' ')}`.toLowerCase().includes(q));
  const sel1 = TF.proj && DB.get('projects', TF.proj);
  const tree = sel1 ? [sel1] : projects.filter((p) => !q || p.name.toLowerCase().includes(q) || projTasks(p.id).some(taskShown));
  if (sel1 && !G.has(sel1.id)) G.set(sel1.id, projProgress(sel1));

  const card = (p) => { const g = G.get(p.id); const [hw, ht] = projHealth(p, g); const end = p.end_date || p.target_date;
    return `<button class="pt-card ${TF.proj === p.id ? 'sel' : ''}" data-ptcard="${p.id}" style="--dc:${esc(deptColor(p.dept))}">
      <div class="pt-ch">${ptRing(g.pct)}<div class="pt-cn"><b>${esc(p.name)}</b><span class="faint">${p.project_code ? esc(p.project_code) + ' · ' : ''}${esc(dept(p.dept)?.name || p.dept || '')}</span></div></div>
      <div class="pt-stack" title="To do · In progress · Done">${g.tasks ? `<i class="s-todo" style="flex:${g.tasks - g.tasksDone - g.prog}"></i><i class="s-prog" style="flex:${g.prog}"></i><i class="s-done" style="flex:${g.tasksDone}"></i>` : '<i class="s-none" style="flex:1"></i>'}</div>
      <div class="pt-cm"><span>${g.from === 'tasks' ? `<b>${g.tasksDone}</b>/${g.tasks} tasks${g.subs ? ` · <b>${g.subsDone}</b>/${g.subs} sub-tasks` : ''}` : g.from === 'milestones' ? 'From milestones' : 'No tasks yet'}</span></div>
      <div class="pt-cf">${avHTML(p.owner, 'xs')}<span class="faint">${end ? (end < today && hw !== 'Done' ? `<span class="bad">Ended ${fmtDate(end)}</span>` : `Due ${fmtDate(end)}`) : 'No end date'}</span><span class="grow"></span>${g.late ? `<span class="chip tone bad">${g.late} late</span>` : ''}<span class="chip tone ${ht}">${hw}</span></div></button>`; };

  const dur = (a, b) => { const d = ptDays(a, b); return d ? `${d} day${d === 1 ? '' : 's'}` : '—'; };
  const due = (d, open) => (d ? `<span class="${open && d < today ? 'bad' : ''}">${fmtDate(d)}</span>` : '—');
  const stChip = (t) => { const tone = t.status === 'Done' ? 'good' : t.status === 'In progress' ? 'warn' : taskOpen(t) && t.due_date && t.due_date < today ? 'bad' : 'info'; return `<span class="chip tone ${tone}">${t.status === 'Open' ? (tone === 'bad' ? 'Overdue' : 'To do') : esc(t.status)}</span>`; };
  const who = (pid) => (pid ? `<span class="pt-who">${avHTML(pid, 'xs')}<span>${esc(DB.pname(pid))}</span></span>` : '<span class="faint">Unassigned</span>');
  const rows = tree.map((p) => {
    const g = G.get(p.id); const [hw, ht] = projHealth(p, g); const open = !PTS.closed.has(p.id) || !!sel1;
    const ts = projTasks(p.id).filter(taskShown).sort((a, b) => String(a.start_date || a.due_date || '9').localeCompare(String(b.start_date || b.due_date || '9')) || String(a.created_at).localeCompare(String(b.created_at)));
    const end = p.end_date || p.target_date;
    let h = `<tr class="pt-p" style="--dc:${esc(deptColor(p.dept))}"><td class="pt-n"><button class="pt-tg ${open ? 'on' : ''}" data-ptp="${p.id}" aria-label="${open ? 'Collapse' : 'Expand'}">${svg('chevr')}</button><span class="pt-sw"></span><a href="#" data-ptpj="${p.id}"><b>${esc(p.name)}</b></a> <span class="faint">${g.tasks} task${g.tasks === 1 ? '' : 's'}</span></td>
      <td>${who(p.owner)}</td><td><span class="chip ${PROJ_CLS[p.status] || ''}">${esc(p.status)}</span></td><td>${fmtDate(p.start_date)}</td><td>${due(end, p.status !== 'Completed')}</td><td class="pt-pr">${ptBar(g.pct)}</td><td>${dur(p.start_date, end)}</td><td><span class="chip tone ${ht}">${hw}</span></td></tr>`;
    if (!open) return h;
    h += ts.map((t) => { const subs = taskSubs(t.id); const to = PTS.topen.has(t.id); const pc = taskPct(t);
      return `<tr class="pt-t ${t.status === 'Done' ? 'is-done' : ''}"><td class="pt-n"><span class="pt-in1"></span>${subs.length ? `<button class="pt-tg sm ${to ? 'on' : ''}" data-ptt="${t.id}" aria-label="${to ? 'Hide' : 'Show'} sub-tasks">${svg('chevr')}</button>` : '<span class="pt-tgx"></span>'}<button class="tk-check ${t.status === 'Done' ? 'on' : ''}" data-ptdone="${t.id}" aria-label="${t.status === 'Done' ? 'Mark not done' : 'Mark done'}">${svg('check')}</button><a href="#" class="pt-tt" data-ptopen="${t.id}">${esc(t.title)}</a>${subs.length ? ` <span class="pt-sc">${svg('check')} ${subs.filter((x) => x.done).length}/${subs.length}</span>` : ''}</td>
        <td>${who(t.owner)}</td><td>${stChip(t)}</td><td>${fmtDate(t.start_date)}</td><td>${due(t.due_date, taskOpen(t))}</td><td class="pt-pr">${ptBar(pc)}</td><td>${dur(t.start_date, t.due_date)}</td><td>${priFlag(t.priority) || '<span class="faint">Normal</span>'}</td></tr>
        ${to ? subs.map((x) => `<tr class="pt-s ${x.done ? 'is-done' : ''}"><td class="pt-n"><span class="pt-in2"></span><button class="tk-check sm ${x.done ? 'on' : ''}" data-ptsd="${x.id}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}">${svg('check')}</button><span class="pt-st">${esc(x.title)}${x.work_done ? `<span class="s faint">${esc(x.work_done)}</span>` : ''}</span></td>
          <td>${who(x.owner)}</td><td><span class="chip tone ${x.done ? 'good' : 'info'}">${x.done ? 'Done' : 'To do'}</span></td><td>—</td><td>${due(x.due_date, !x.done)}</td><td class="pt-pr">${ptBar(x.done ? 100 : 0)}</td><td>${x.done && x.done_at ? `<span class="faint">${fmtDate(x.done_at)}</span>` : '—'}</td><td></td></tr>`).join('') : ''}`; }).join('');
    h += `<tr class="pt-add"><td colspan="8"><span class="pt-in1"></span><span class="tk-check add">${svg('plus')}</span><input data-ptadd="${p.id}" placeholder="Add a task to ${esc(p.name)} and press Enter" aria-label="New task in ${esc(p.name)}"></td></tr>`;
    return h;
  }).join('');

  box.innerHTML = `<div class="pt-wrap">
    <div class="pt-kpis">
      <div class="pt-k big">${ptRing(avg, 74)}<div><b>Average completion</b><span class="faint">${nfmt(projects.length)} project${projects.length === 1 ? '' : 's'} ${PTS.status === 'active' ? 'running' : PTS.status === 'Completed' ? 'completed' : 'in all'}</span></div></div>
      <div class="pt-k"><b>${nfmt(tasksD)}<span class="faint">/${nfmt(tasksN)}</span></b><span>Tasks done</span></div>
      <div class="pt-k ${lateN ? 'bad' : ''}"><b>${nfmt(lateN)}</b><span>Tasks overdue</span></div>
      <div class="pt-k ${attention ? 'warn' : ''}"><b>${nfmt(attention)}</b><span>Projects needing attention</span></div>
    </div>
    <div class="pt-head"><h3>All projects</h3>
      <div class="seg">${[['active', 'Running'], ['Completed', 'Completed'], ['all', 'All']].map(([k, w]) => `<button data-pts="${k}" aria-pressed="${PTS.status === k}">${w}</button>`).join('')}</div>
      <select id="ptsort" aria-label="Sort projects">${opts([['due', 'Sort: end date'], ['progress', 'Sort: least done first'], ['name', 'Sort: name']], PTS.sort)}</select></div>
    ${projects.length ? `<div class="pt-cards">${projects.map(card).join('')}</div>` : empty('No projects here', 'A won deal becomes a project. You can also add one in Project Management.', '<a class="btn small" href="#projects">Open Project Management</a>')}
    <div class="pt-head"><h3>${sel1 ? `Tasks in <span class="pt-selname">${esc(sel1.name)}</span>` : 'Project-wise tasks'}</h3>${sel1 ? `<button class="btn ghost small" id="ptx">${svg('x')} All projects</button>` : ''}
      <span class="grow"></span><button class="btn ghost small" id="ptexp">Expand all</button><button class="btn ghost small" id="ptcol">Collapse all</button></div>
    ${tree.length ? `<div class="tablewrap pt-tw"><table class="pt"><thead><tr><th>Project · task · sub-task</th><th>Owner</th><th>Status</th><th>Start</th><th>Due</th><th>% complete</th><th>Duration</th><th>Priority</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('Nothing matches', 'Clear the search or the priority filter.')}
  </div>`;

  box.querySelectorAll('[data-pts]').forEach((b) => (b.onclick = () => { PTS.status = b.dataset.pts; TF.proj = ''; rer(); }));
  box.querySelector('#ptsort').onchange = (e) => { PTS.sort = e.target.value; rer(); };
  box.querySelectorAll('[data-ptcard]').forEach((b) => (b.onclick = () => { TF.proj = TF.proj === b.dataset.ptcard ? '' : b.dataset.ptcard; rer(); setTimeout(() => $('.pt-tw')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }));
  box.querySelector('#ptx')?.addEventListener('click', () => { TF.proj = ''; rer(); });
  box.querySelector('#ptexp').onclick = () => { PTS.closed.clear(); tree.forEach((p) => projTasks(p.id).forEach((t) => PTS.topen.add(t.id))); rer(); };
  box.querySelector('#ptcol').onclick = () => { PTS.topen.clear(); if (!sel1) tree.forEach((p) => PTS.closed.add(p.id)); rer(); };
  box.querySelectorAll('[data-ptp]').forEach((b) => (b.onclick = () => { const id = b.dataset.ptp; if (PTS.closed.has(id)) PTS.closed.delete(id); else PTS.closed.add(id); rer(); }));
  box.querySelectorAll('[data-ptt]').forEach((b) => (b.onclick = () => { const id = b.dataset.ptt; if (PTS.topen.has(id)) PTS.topen.delete(id); else PTS.topen.add(id); rer(); }));
  box.querySelectorAll('[data-ptpj]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProject(a.dataset.ptpj); }));
  box.querySelectorAll('[data-ptopen]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); taskDrawer(a.dataset.ptopen, rer); }));
  box.querySelectorAll('[data-ptdone]').forEach((b) => (b.onclick = () => { const t = DB.get('work_tasks', b.dataset.ptdone); guard(async () => { await DB.update('work_tasks', t.id, { status: t.status === 'Done' ? 'Open' : 'Done' }); rer(); }, t.status === 'Done' ? 'Reopened' : 'Done'); }));
  box.querySelectorAll('[data-ptsd]').forEach((b) => (b.onclick = () => guard(async () => { const x = DB.get('work_subtasks', b.dataset.ptsd); await DB.update('work_subtasks', x.id, { done: !x.done }); DB.t.work_tasks = await DB.fetchAll('work_tasks'); rer(); })));
  box.querySelectorAll('[data-ptadd]').forEach((i) => (i.onkeydown = (e) => { if (e.key !== 'Enter' || !i.value.trim()) return; const pid = i.dataset.ptadd;
    guard(async () => { await DB.insert('work_tasks', { title: i.value.trim(), project_id: pid, owner: DB.me.id, created_by: DB.me.id, status: 'Open', priority: 'Normal', start_date: todayStr() }); PTS.closed.delete(pid); rer(); setTimeout(() => document.querySelector(`[data-ptadd="${pid}"]`)?.focus(), 40); }, 'Task added'); }));
}

/* the project drawer: its tasks and % complete at the top of "Milestones & tasks" */
function ptProjectBlock(p) {
  const g = projProgress(p); const [hw, ht] = projHealth(p, g); const ts = projTasks(p.id).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
  return `<section class="pt-pb"><div class="pt-pbh">${ptRing(g.pct, 66)}<div class="grow"><b>Tasks</b><span class="faint">${g.tasks ? `${g.tasksDone}/${g.tasks} tasks done${g.subs ? ` · ${g.subsDone}/${g.subs} sub-tasks` : ''}` : 'No tasks yet'}</span></div><span class="chip tone ${ht}">${hw}</span></div>
    ${ts.length ? `<div class="pt-pbl">${ts.map((t) => `<button class="pt-pbi" data-pbt="${t.id}"><span class="grow">${esc(t.title)}<span class="s faint">${esc(DB.pname(t.owner))}${t.due_date ? ' · due ' + fmtDate(t.due_date) : ''}</span></span>${ptBar(taskPct(t))}</button>`).join('')}</div>` : ''}
    <div class="row" style="justify-content:flex-end;gap:6px"><button class="btn small" id="pbtadd">${svg('plus')} Add task</button><button class="btn small primary" id="pbtgo">Open in Tasks</button></div></section>`;
}
function bindProjectBlock(root, p, rerender) {
  root.querySelectorAll('[data-pbt]').forEach((b) => (b.onclick = () => taskDrawer(b.dataset.pbt, rerender)));
  root.querySelector('#pbtadd')?.addEventListener('click', () => taskModal({ project_id: p.id, owner: p.owner }, rerender));
  root.querySelector('#pbtgo')?.addEventListener('click', () => { closeDrawer(); go('tasks', 'p-' + p.id); });
}
