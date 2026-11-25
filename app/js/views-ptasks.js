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

/* project type: business (official work) or lead (a department and a lead) */
const projKind = (p) => p.kind || (p.lead_id ? 'lead' : 'business');
const projOk = (p) => projKind(p) === 'business' ? ST.dept === 'All' || !p.dept || p.dept === ST.dept : M.deptOk(p.dept);
function projTag(p) {
  if (projKind(p) === 'business') return '<span class="chip pj-biz">Business</span>';
  const l = p.lead_id && DB.get('leads', p.lead_id);
  return `${p.dept ? deptChip(p.dept) : ''}${l ? `<span class="pj-lead">${esc(l.name)}</span>` : ''}`;
}
const projColor = (p) => (projKind(p) === 'business' ? '#7b5cf0' : deptColor(p.dept));

const PTS = { sort: 'due', closed: new Set(), topen: new Set(), ropen: new Set(), q: '' };
/* Project Management → Overview: the totals and a card per project with its % complete */
function ptOverview(box, projects, { onPick } = {}) {
  const today = todayStr();
  const G = new Map(projects.map((p) => [p.id, projProgress(p)]));
  const S = { due: (a, b) => String(a.end_date || a.target_date || '9999').localeCompare(String(b.end_date || b.target_date || '9999')), progress: (a, b) => G.get(a.id).pct - G.get(b.id).pct, name: (a, b) => a.name.localeCompare(b.name) };
  projects = [...projects].sort(S[PTS.sort] || S.due);
  const all = [...G.values()]; const tasksN = sum(all, (g) => g.tasks); const tasksD = sum(all, (g) => g.tasksDone); const lateN = sum(all, (g) => g.late);
  const avg = projects.length ? Math.round(sum(all, (g) => g.pct) / projects.length) : 0;
  const attention = projects.filter((p) => ['Late', 'At risk', 'Behind'].includes(projHealth(p, G.get(p.id))[0])).length;
  const nb = projects.filter((p) => projKind(p) === 'business').length;
  const card = (p) => { const g = G.get(p.id); const [hw, ht] = projHealth(p, g); const end = p.end_date || p.target_date;
    return `<button class="pt-card" data-ptcard="${p.id}" style="--dc:${esc(projColor(p))}">
      <div class="pt-ch">${ptRing(g.pct)}<div class="pt-cn"><b>${esc(p.name)}</b><span class="pt-tags">${p.project_code ? `<span class="faint">${esc(p.project_code)}</span>` : ''}${projTag(p)}</span></div></div>
      <div class="pt-stack" title="To do · In progress · Done">${g.tasks ? `<i class="s-todo" style="flex:${g.tasks - g.tasksDone - g.prog}"></i><i class="s-prog" style="flex:${g.prog}"></i><i class="s-done" style="flex:${g.tasksDone}"></i>` : '<i class="s-none" style="flex:1"></i>'}</div>
      <div class="pt-cm"><span>${g.from === 'tasks' ? `<b>${g.tasksDone}</b>/${g.tasks} tasks${g.subs ? ` · <b>${g.subsDone}</b>/${g.subs} sub-tasks` : ''}` : g.from === 'milestones' ? 'From milestones' : 'No tasks yet'}</span></div>
      <div class="pt-cf">${avHTML(p.owner, 'xs')}<span class="faint">${end ? (end < today && hw !== 'Done' ? `<span class="bad">Ended ${fmtDate(end)}</span>` : `Due ${fmtDate(end)}`) : 'No end date'}</span><span class="grow"></span>${g.late ? `<span class="chip tone bad">${g.late} late</span>` : ''}<span class="chip tone ${ht}">${hw}</span></div></button>`; };
  box.innerHTML = `<div class="pt-wrap">
    <div class="pt-kpis">
      <div class="pt-k big">${ptRing(avg, 74)}<div><b>Average completion</b><span class="faint">${nfmt(projects.length)} project${projects.length === 1 ? '' : 's'} · ${nfmt(nb)} business · ${nfmt(projects.length - nb)} lead</span></div></div>
      <div class="pt-k"><b>${nfmt(tasksD)}<span class="faint">/${nfmt(tasksN)}</span></b><span>Tasks done</span></div>
      <div class="pt-k ${lateN ? 'bad' : ''}"><b>${nfmt(lateN)}</b><span>Tasks overdue</span></div>
      <div class="pt-k ${attention ? 'warn' : ''}"><b>${nfmt(attention)}</b><span>Projects needing attention</span></div>
    </div>
    <div class="pt-head"><h3>All projects</h3><span class="grow"></span><select id="ptsort" aria-label="Sort projects">${opts([['due', 'Sort: end date'], ['progress', 'Sort: least done first'], ['name', 'Sort: name']], PTS.sort)}</select></div>
    <div class="pt-cards">${projects.map(card).join('')}</div></div>`;
  box.querySelector('#ptsort').onchange = (e) => { PTS.sort = e.target.value; onPick?.(null, true); };
  box.querySelectorAll('[data-ptcard]').forEach((b) => (b.onclick = () => onPick?.(b.dataset.ptcard)));
}

/* Project Management → Tasks: project → task → sub-task, with owner, status, dates, % complete, duration and priority */
function ptTree(box, projects, { sel = '', onSel, rer } = {}) {
  const today = todayStr(); const q = PTS.q.trim().toLowerCase();
  const taskShown = (t) => !q || `${t.title} ${t.notes || ''} ${taskSubs(t.id).map((x) => x.title).join(' ')}`.toLowerCase().includes(q);
  const sel1 = sel && DB.get('projects', sel);
  const tree = sel1 ? [sel1] : projects.filter((p) => !q || p.name.toLowerCase().includes(q) || projTasks(p.id).some(taskShown));
  const dur = (a, b) => { const d = ptDays(a, b); return d ? `${d} day${d === 1 ? '' : 's'}` : '—'; };
  const due = (d, open) => (d ? `<span class="${open && d < today ? 'bad' : ''}">${fmtDate(d)}</span>` : '—');
  const stChip = (t) => { const tone = t.status === 'Done' ? 'good' : t.status === 'In progress' ? 'warn' : taskOpen(t) && t.due_date && t.due_date < today ? 'bad' : 'info'; return `<span class="chip tone ${tone}">${t.status === 'Open' ? (tone === 'bad' ? 'Overdue' : 'To do') : esc(t.status)}</span>`; };
  const who = (pid) => (pid ? `<span class="pt-who">${avHTML(pid, 'xs')}<span>${esc(DB.pname(pid))}</span></span>` : '<span class="faint">Unassigned</span>');
  const trio = (o, m, a) => `<span class="pt-trio">${o ? `<span title="Owner: ${esc(DB.pname(o))}">${avHTML(o, 'xs')}</span>` : ''}${m ? `<i>›</i><span title="Manager: ${esc(DB.pname(m))}">${avHTML(m, 'xs')}</span>` : ''}${a !== undefined ? `<i>›</i>${who(a)}` : ''}</span>`;
  const rows = tree.map((p) => {
    const g = projProgress(p); const [hw, ht] = projHealth(p, g); const open = !PTS.closed.has(p.id);
    const ts = projTasks(p.id).filter(taskShown).sort((a, b) => String(a.start_date || a.due_date || '9').localeCompare(String(b.start_date || b.due_date || '9')) || String(a.created_at).localeCompare(String(b.created_at)));
    const end = p.end_date || p.target_date;
    let h = `<tr class="pt-p" style="--dc:${esc(projColor(p))}"><td class="pt-n"><button class="pt-tg ${open ? 'on' : ''}" data-ptp="${p.id}" aria-label="${open ? 'Collapse' : 'Expand'}">${svg('chevr')}</button><span class="pt-sw"></span><a href="#" data-ptpj="${p.id}"><b>${esc(p.name)}</b></a> <span class="faint">${g.tasks} task${g.tasks === 1 ? '' : 's'}</span></td>
      <td>${p.manager ? trio(p.owner, p.manager) : who(p.owner)}</td><td><span class="chip ${PROJ_CLS[p.status] || ''}">${esc(p.status)}</span></td><td>${fmtDate(p.start_date)}</td><td>${due(end, p.status !== 'Completed')}</td><td class="pt-pr">${ptBar(g.pct)}</td><td>${dur(p.start_date, end)}</td><td><span class="chip tone ${ht}">${hw}</span></td></tr>`;
    if (!open) return h;
    h += ts.map((t) => { const subs = taskSubs(t.id); const to = PTS.topen.has(t.id); const pc = taskPct(t);
      return `<tr class="pt-t ${t.status === 'Done' ? 'is-done' : ''}"><td class="pt-n"><span class="pt-in1"></span>${subs.length ? `<button class="pt-tg sm ${to ? 'on' : ''}" data-ptt="${t.id}" aria-label="${to ? 'Hide' : 'Show'} sub-tasks">${svg('chevr')}</button>` : '<span class="pt-tgx"></span>'}<button class="tk-check ${t.status === 'Done' ? 'on' : ''}" data-ptdone="${t.id}" aria-label="${t.status === 'Done' ? 'Mark not done' : 'Mark done'}">${svg('check')}</button><a href="#" class="pt-tt" data-ptopen="${t.id}">${esc(t.title)}</a>${recurChip(t)}${subs.length ? ` <span class="pt-sc">${svg('check')} ${subs.filter((x) => x.done).length}/${subs.length}</span>` : ''}<button class="pt-rm ${PTS.ropen.has(t.id) ? 'on' : ''}" data-ptrm="${t.id}" title="Remarks" aria-label="Remarks on ${esc(t.title)}">${svg('chat')} ${(t.updates || []).length || 'Add remark'}</button>${(() => { const u = (t.updates || []).slice(-1)[0]; return u ? `<span class="pt-last">${esc(DB.pname(u.by))} · ${fmtDate(u.at)}: ${esc(u.text.length > 90 ? u.text.slice(0, 87) + '…' : u.text)}</span>` : ''; })()}</td>
        <td>${(t.task_owner || t.created_by) !== t.owner || t.manager ? trio(t.task_owner || t.created_by, t.manager, t.owner) : who(t.owner)}</td><td>${stChip(t)}</td><td>${fmtDate(t.start_date)}</td><td>${due(t.due_date, taskOpen(t))}</td><td class="pt-pr">${ptBar(pc)}</td><td>${dur(t.start_date, t.due_date)}</td><td>${priFlag(t.priority) || '<span class="faint">Normal</span>'}</td></tr>
        ${PTS.ropen.has(t.id) ? `<tr class="pt-r"><td colspan="8"><div class="pt-rbox"><div class="pt-rin"><input data-ptrin="${t.id}" placeholder="Write a remark on this task and press Enter"><button class="btn small primary" data-ptrgo="${t.id}">Add remark</button></div>
          ${(t.updates || []).length ? `<ul class="pt-rl">${(t.updates || []).slice().reverse().map((u) => `<li><span class="av xs" style="background:${personColor(u.by)}">${esc(initials(DB.pname(u.by)))}</span><div><b>${esc(DB.pname(u.by))}</b> <span class="faint">${fmtDT(u.at)}</span><p>${esc(u.text)}</p></div></li>`).join('')}</ul>` : '<p class="faint">No remarks yet.</p>'}</div></td></tr>` : ''}
        ${to ? subs.map((x) => `<tr class="pt-s ${x.done ? 'is-done' : ''}"><td class="pt-n"><span class="pt-in2"></span><button class="tk-check sm ${x.done ? 'on' : ''}" data-ptsd="${x.id}" aria-label="${x.done ? 'Mark not done' : 'Mark done'}">${svg('check')}</button><span class="pt-st">${esc(x.title)}${x.work_done ? `<span class="s faint">${esc(x.work_done)}</span>` : ''}</span></td>
          <td>${who(x.owner)}</td><td><span class="chip tone ${x.done ? 'good' : 'info'}">${x.done ? 'Done' : 'To do'}</span></td><td>—</td><td>${due(x.due_date, !x.done)}</td><td class="pt-pr">${ptBar(x.done ? 100 : 0)}</td><td>${x.done && x.done_at ? `<span class="faint">${fmtDate(x.done_at)}</span>` : '—'}</td><td></td></tr>`).join('') : ''}`; }).join('');
    h += `<tr class="pt-add"><td colspan="8"><span class="pt-in1"></span><span class="tk-check add">${svg('plus')}</span><input data-ptadd="${p.id}" placeholder="Add a task to ${esc(p.name)} and press Enter" aria-label="New task in ${esc(p.name)}"></td></tr>`;
    return h;
  }).join('');
  box.innerHTML = `<div class="pt-head"><h3>${sel1 ? `Tasks in <span class="pt-selname">${esc(sel1.name)}</span>` : 'Project-wise tasks'}</h3>${sel1 ? `<button class="btn ghost small" id="ptx">${svg('x')} All projects</button>` : ''}
      <input type="search" id="ptq" placeholder="Search projects and tasks" value="${esc(PTS.q)}"><span class="grow"></span><button class="btn ghost small" id="ptexp">Expand all</button><button class="btn ghost small" id="ptcol">Collapse all</button></div>
    ${tree.length ? `<div class="tablewrap pt-tw"><table class="pt"><thead><tr><th>Project · task · sub-task</th><th title="Owner › Manager › Assignee">Owner › Manager › Assignee</th><th>Status</th><th>Start</th><th>Due</th><th>% complete</th><th>Duration</th><th>Priority</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('Nothing matches', 'Clear the search.')}`;
  box.querySelector('#ptx')?.addEventListener('click', () => onSel?.(''));
  const qi = box.querySelector('#ptq'); qi.oninput = () => { PTS.q = qi.value; clearTimeout(ptTree._t); ptTree._t = setTimeout(() => { rer(); const i = document.querySelector('#ptq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); };
  box.querySelector('#ptexp').onclick = () => { PTS.closed.clear(); tree.forEach((p) => projTasks(p.id).forEach((t) => PTS.topen.add(t.id))); rer(); };
  box.querySelector('#ptcol').onclick = () => { PTS.topen.clear(); tree.forEach((p) => PTS.closed.add(p.id)); rer(); };
  box.querySelectorAll('[data-ptp]').forEach((b) => (b.onclick = () => { const id = b.dataset.ptp; if (PTS.closed.has(id)) PTS.closed.delete(id); else PTS.closed.add(id); rer(); }));
  box.querySelectorAll('[data-ptt]').forEach((b) => (b.onclick = () => { const id = b.dataset.ptt; if (PTS.topen.has(id)) PTS.topen.delete(id); else PTS.topen.add(id); rer(); }));
  box.querySelectorAll('[data-ptpj]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProject(a.dataset.ptpj); }));
  box.querySelectorAll('[data-ptrm]').forEach((b) => (b.onclick = () => { const id = b.dataset.ptrm; if (PTS.ropen.has(id)) PTS.ropen.delete(id); else PTS.ropen.add(id); rer(); setTimeout(() => document.querySelector(`[data-ptrin="${id}"]`)?.focus(), 40); }));
  const addRemark = (id) => { const i = box.querySelector(`[data-ptrin="${id}"]`); const text = i?.value.trim(); if (!text) return;
    guard(async () => { const t = DB.get('work_tasks', id); await DB.update('work_tasks', id, { updates: [...(t.updates || []), { at: nowISO(), by: DB.me.id, text }] }); rer(); setTimeout(() => document.querySelector(`[data-ptrin="${id}"]`)?.focus(), 40); }, 'Remark added'); };
  box.querySelectorAll('[data-ptrin]').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') addRemark(i.dataset.ptrin); }));
  box.querySelectorAll('[data-ptrgo]').forEach((b) => (b.onclick = () => addRemark(b.dataset.ptrgo)));
  box.querySelectorAll('[data-ptopen]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); taskDrawer(a.dataset.ptopen, rer); }));
  box.querySelectorAll('[data-ptdone]').forEach((b) => (b.onclick = () => { const t = DB.get('work_tasks', b.dataset.ptdone); guard(async () => { await DB.update('work_tasks', t.id, { status: t.status === 'Done' ? 'Open' : 'Done' }); rer(); }, t.status === 'Done' ? 'Reopened' : 'Done'); }));
  box.querySelectorAll('[data-ptsd]').forEach((b) => (b.onclick = () => guard(async () => { const x = DB.get('work_subtasks', b.dataset.ptsd); await DB.update('work_subtasks', x.id, { done: !x.done }); DB.t.work_tasks = await DB.fetchAll('work_tasks'); rer(); })));
  box.querySelectorAll('[data-ptadd]').forEach((i) => (i.onkeydown = (e) => { if (e.key !== 'Enter' || !i.value.trim()) return; const pid = i.dataset.ptadd;
    guard(async () => { await DB.insert('work_tasks', { title: i.value.trim(), project_id: pid, owner: DB.me.id, created_by: DB.me.id, status: 'Open', priority: 'Normal', start_date: todayStr() }); PTS.closed.delete(pid); rer(); setTimeout(() => document.querySelector(`[data-ptadd="${pid}"]`)?.focus(), 40); }, 'Task added'); }));
}

/* a lead picker for lead projects: leads and deals of one department only (no accounts) */
function leadOnlyPicker(id, leadId) {
  const l = leadId && DB.get('leads', leadId);
  return `<div class="picker" id="${id}" data-val="${esc(leadId || '')}"><input id="${id}-q" placeholder="Type the lead or deal name" value="${esc(l ? l.name : '')}" autocomplete="off" aria-label="Lead"><div class="picks" hidden></div></div>`;
}
function bindLeadOnlyPicker(root, id, deptOf) {
  const box = root.querySelector('#' + id); if (!box) return;
  const q = box.querySelector('input'); const out = box.querySelector('.picks');
  q.oninput = () => {
    const s = q.value.trim().toLowerCase(); box.dataset.val = ''; if (s.length < 2) { out.hidden = true; return; }
    const d = deptOf();
    const ls = visibleLeads().filter((l) => (!d || l.funnel === d) && ((l.name || '').toLowerCase().includes(s) || L.company(l).toLowerCase().includes(s) || (l.phone || '').includes(s)))
      .sort((a, b) => Number(!!b.is_deal) - Number(!!a.is_deal)).slice(0, 8);
    out.innerHTML = ls.map((l) => `<button type="button" data-pk="${l.id}">${l.is_deal ? 'Deal' : 'Lead'} · ${esc(l.name)}${L.company(l) && !l.name.includes(L.company(l)) ? ' · ' + esc(L.company(l)) : ''}</button>`).join('') || `<span class="faint">No ${d ? esc(dept(d).name) + ' ' : ''}lead matches</span>`; out.hidden = false;
    out.querySelectorAll('[data-pk]').forEach((b) => (b.onclick = () => { box.dataset.val = b.dataset.pk; q.value = DB.get('leads', b.dataset.pk)?.name || b.textContent; out.hidden = true; }));
  };
}
/* the type question shared by New project and the Details tab */
function projTypeFields(p = {}) {
  const k = p.id ? projKind(p) : p.kind || 'business';
  return `${fld('pk', 'Is this project lead related or business related?', `<div class="seg" id="pkind">${[['business', 'Business related'], ['lead', 'Lead related']].map(([x, w]) => `<button type="button" data-pkind="${x}" aria-pressed="${k === x}">${w}</button>`).join('')}</div>`, 'full')}
    <div class="full pk-lead" ${k === 'lead' ? '' : 'hidden'}><div class="form">${fld('pkd', 'Department', sel('pkd', DEPTS(true).map((d) => [d.code, d.name]), p.dept || (ST.dept !== 'All' ? ST.dept : myDepts()[0]), 'Choose the department'))}${fld('pkl', 'Lead', leadOnlyPicker('pkl', p.lead_id))}</div></div>`;
}
function bindProjType(root) {
  root.querySelectorAll('[data-pkind]').forEach((b) => (b.onclick = () => { root.querySelectorAll('[data-pkind]').forEach((x) => x.setAttribute('aria-pressed', x === b)); root.querySelector('.pk-lead').hidden = b.dataset.pkind !== 'lead'; }));
  bindLeadOnlyPicker(root, 'pkl', () => v(root, 'pkd'));
  root.querySelector('#pkd').onchange = () => { const box = root.querySelector('#pkl'); const l = DB.get('leads', box.dataset.val); if (l && l.funnel !== v(root, 'pkd')) { box.dataset.val = ''; box.querySelector('input').value = ''; } };
}
function projTypeVal(root) {
  const kind = root.querySelector('[data-pkind][aria-pressed="true"]')?.dataset.pkind || 'business';
  if (kind === 'business') return { kind, dept: null, lead_id: null, institution_id: null };
  const d = v(root, 'pkd'); const lid = root.querySelector('#pkl')?.dataset.val || '';
  if (!d) throw new Error('Choose the department.');
  if (!lid) throw new Error('Choose the lead (type its name and pick it from the list).');
  return { kind, dept: d, lead_id: lid, institution_id: DB.get('leads', lid)?.institution_id || null };
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
