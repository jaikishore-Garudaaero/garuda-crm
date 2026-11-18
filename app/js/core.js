/* Garuda CRM · core: helpers, roles, data layer (Supabase or demo) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const nowISO = () => new Date().toISOString();
const todayStr = () => localDate(new Date());
function localDate(d) { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const groupBy = (a, f) => a.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- money & dates (Indian formats) ---------- */
/* amounts are written in full with Indian commas (₹30,83,333); charts and tight spots use inrShort (₹30.83 L) */
function inr(n, opt = {}) {
  if (!opt.short) opt = { ...opt, full: true };
  n = Number(n) || 0;
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (!opt.full && n >= 1e7) s = '₹' + (n / 1e7).toFixed(n >= 1e9 ? 0 : 2).replace(/\.00$/, '') + ' Cr';
  else if (!opt.full && n >= 1e5) s = '₹' + (n / 1e5).toFixed(n >= 1e7 ? 0 : 2).replace(/\.00$/, '') + ' L';
  else s = '₹' + Math.round(n).toLocaleString('en-IN');
  return (neg ? '−' : '') + s;
}
const inrFull = (n) => inr(n, { full: true });
const inrShort = (n) => inr(n, { short: true });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function fmtDate(d) { if (!d) return '—'; const x = new Date(d); return x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: x.getFullYear() === new Date().getFullYear() ? undefined : '2-digit' }); }
function fmtDT(d) { if (!d) return '—'; const x = new Date(d); return x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + x.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
function fmtMonth(d) { if (!d) return '—'; const x = new Date(String(d).slice(0, 10) + 'T12:00:00'); return x.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); }
function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''; }
function rel(d) {
  if (!d) return '—';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const dd = Math.round(h / 24); if (dd < 31) return dd + ' d ago';
  return fmtDate(d);
}

/* ---------- roles, permissions and scope (v4: hierarchy-based access) ---------- */
const ROLES = { clevel: 'C-level', admin: 'Admin', manager: 'Manager', lead: 'Lead', member: 'Member' };
const PERMS = { finance: 'Finance', email: 'Email Marketing access', campaigns: 'Campaigns access', export: 'Export data', pricebook: 'Edit Price Book', hide_sales: 'Hide sales screens' };
const perm = (k) => !!DB.me?.perms?.[k];
/* Admin: everything including Settings */
const isHead = () => DB.me?.role === 'admin';
/* C-level and Admin see every record in every department */
const seesAll = () => ['clevel', 'admin'].includes(DB.me?.role);
const isFinance = () => isHead() || perm('finance');
const canEmail = () => isHead() || perm('email') || !!DB.me?.email_access;
const canCampaigns = () => seesAll() || perm('campaigns');
const canExport = () => isHead() || perm('export');
const canPricebook = () => isHead() || perm('pricebook');
const hideSales = () => !seesAll() && perm('hide_sales');
const canReassign = () => ['clevel', 'admin', 'manager', 'lead'].includes(DB.me?.role);
const isMember = () => DB.me?.role === 'member';
/* me + everyone below me in the Reports to tree */
function scopeIds(pid = DB.me?.id) {
  const out = new Set(pid ? [pid] : []); let grew = true;
  while (grew) { grew = false; for (const p of DB.t.profiles || []) if (p.reports_to && out.has(p.reports_to) && !out.has(p.id)) { out.add(p.id); grew = true; } }
  return out;
}
const inScope = (pid) => seesAll() || scopeIds().has(pid);
/* people the filters and assign lists offer: everyone active for C-level / Admin, otherwise my tree */
function scopePeople() { const s = scopeIds(); return (DB.t.profiles || []).filter((p) => p.active && (seesAll() || s.has(p.id))).sort((a, b) => a.full_name.localeCompare(b.full_name)); }
/* people I may hand records to (my own tree, even for C-level / Admin, plus everyone for C-level / Admin) */
function assignablePeople() { return canReassign() ? scopePeople() : (DB.t.profiles || []).filter((p) => p.id === DB.me?.id); }
const hasTeam = () => seesAll() || scopeIds().size > 1;
const isSales = (p) => !!p && p.active !== false && !p.perms?.hide_sales;

/* ---------- departments (managed in Settings; no code change to add one) ---------- */
const DEPTS = (all = false) => (DB.t.departments || []).filter((d) => all || d.active).sort((a, b) => a.ord - b.ord || a.code.localeCompare(b.code));
const dept = (code) => (DB.t.departments || []).find((d) => d.code === code) || { code, name: code, color: '#7a8aa0', segments: [], loss_reasons: [], courses: [], has_admissions: false };
const deptColor = (code) => dept(code).color || '#7a8aa0';
/* departments I work in: my profile's list plus any department I own records in */
/* is this person in that department? (the departments ticked in Users & Access; nobody ticked = every department) */
const inDept = (p, code) => !code || code === 'All' || !(p?.departments || []).length || p.departments.includes(code);
function myDepts() {
  if (seesAll()) return DEPTS().map((d) => d.code);
  const mine = new Set(DB.me?.departments || []); if (!mine.size) (DB.t.leads || []).forEach((l) => { if (l.owner === DB.me?.id) mine.add(l.funnel); });
  const out = DEPTS().map((d) => d.code).filter((c) => mine.has(c));
  return out.length ? out : DEPTS().map((d) => d.code);
}

const CHANNELS = ['Outbound call', 'Inbound call', 'WhatsApp', 'Email', 'Visit', 'Meeting', 'Note'];
const OUTCOMES = ['No answer', 'Busy', 'Interested', 'Follow-up', 'Counselled', 'Meeting fixed', 'Not eligible', 'Not interested', 'Converted', 'Note'];
const CONNECTED = (o) => !['No answer', 'Busy', 'Note'].includes(o);
const CALL_CH = (c) => c === 'Outbound call' || c === 'Inbound call';
const TEMPS = ['Hot', 'Warm', 'Cold', 'Drop', 'Nurture'];
/* the team's sales sheet vocabulary */
const COURSES = ['Small Class RPC', 'Medium Class RPC', 'Small + Medium RPC', 'Top-up Medium', 'Train the Trainer (TTT)', 'Not Specified'];
const COURSE_FEE = { 'Small Class RPC': 20000, 'Medium Class RPC': 30000, 'Train the Trainer (TTT)': 40000 };
const SUBCATS = ['UAV Lab - Basic', 'UAV Lab - Standard', 'UAV Lab - Advanced', 'UAV Lab - Type TBC', 'RPTO Establishment', 'RPTO Admissions (Bulk)', 'IV (Industrial Visit)', 'Workshop', 'Course / Curriculum', 'Internship', 'Faculty Training (FDP)', 'Collaboration / MoU', 'Research / Consultancy', 'Not Specified'];
const LAB_SUBCATS = ['UAV Lab - Basic', 'UAV Lab - Standard', 'UAV Lab - Advanced', 'UAV Lab - Type TBC'];
const SOURCES = ['Paid Media - Meta', 'Paid Media - Google Ads', 'IVR', 'WhatsApp', 'Inbound Call', 'Website - SEO/Website', 'Website - Enquiry Form', 'Website - Email Enquiry', 'Outbound - Webinars', 'OG', 'Email', 'Reference', 'AICTE', 'Field visit', 'Webinar', 'Other'];
const TIERS = ['P1 - Hot', 'P2 - Warm', 'P3 - Never Reached', 'P4 - Retry (Unreachable)', 'P5 - Nurture', 'R1 - Win-back', 'X1 Exclude - Already Won', 'X2 Exclude - Invalid Number', 'X3 Exclude - Other Dept / Academy', 'X4 Exclude - Not Interested', 'X5 - Exclude - Lost/Drop', 'X6 - Exclude - Duplicate'];
const ENGAGEMENT = ['Contacted', 'Qualified', 'Dormant', 'In Progress', 'Closed', 'Closed - Lost', 'New'];
const LANGS = ['Tamil', 'English', 'Hindi', 'Telugu', 'Kannada', 'Malayalam'];
const REV_SEG_RPTO = ['Small', 'Medium', 'Top-Up Medium (Garuda RPC)', 'Top-Up Medium', 'TTT (Small)', 'Refresher', 'Extra Flying Hours', 'Other', 'CFMTTI / NERFMTTI Admissions'];
const REV_SEG_COE = ['UAV Lab - Basic', 'UAV Lab - Standard', 'UAV Lab - Advanced', 'UAV Lab (type not stated)', 'RPTO Establishment', 'RPTO Products', 'IV (Industrial Visit)', 'Workshop', 'Not stated'];
const RESPONSES = ['Accepted', 'Thinking', 'Too costly', 'Comparing', 'Will discuss with family', 'Needs approval', 'Other'];
const DOCS = { aadhaar: 'Aadhaar / ID', tenth: '10th certificate', photo: 'Photo', rpc: 'Existing RPC (top-up / TTT)', degree: 'Degree (TTT)' };
const TASK_KINDS = ['Call', 'Follow-up', 'Meeting', 'Visit', 'Proposal', 'Payment', 'Document', 'Renewal', 'Escalation', 'Approval', 'Other'];
const BT_STATUS = ['New', 'Open', 'In progress', 'Recurring', 'Management support needed', 'Closed'];
const BT_STATUS_CLS = { New: 'acc', Open: '', 'In progress': 'warn', Recurring: 'rpto', 'Management support needed': 'bad', Closed: 'good' };
const BT_RECUR = ['None', 'Daily', 'Weekly', 'Monthly', 'TBC'];
const MOM_CATS = ['Interdepartmental meetings (with other HODs)', 'Client & Vendor meetings', 'INTRA departmental meetings (within your own Department)', 'PROJECT management meetings', 'PRODUCT Management meetings', 'Escalation Meeting (Vijay sir/Other)', 'Boss EOD Download meeting'];
const APPROVAL_TYPES = ['Discount', 'Price exception', 'Free seat', 'Proposal', 'Payment terms', 'Refund', 'Revenue share', 'Rate card', 'Other'];
const APPROVAL_CLS = { Pending: 'warn', Escalated: 'bad', Approved: 'good', Answered: 'good', Rejected: 'bad', Withdrawn: '' };
const ATT_STATUS = ['Registered', 'Payment pending', 'Active', 'Cancelled', 'Refunded'];
/* week number as used in the daily MOM sheet: weeks start on Monday, W1 begins on the first Monday of the year (23 Oct 2026 = W42) */
function weekNo(d) {
  d = new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00' : d);
  const y = d.getFullYear(); const jan1 = new Date(y, 0, 1);
  const doy = Math.round((new Date(y, d.getMonth(), d.getDate()) - jan1) / 864e5) + 1;
  const firstMon = ((8 - jan1.getDay()) % 7) + 1;
  return Math.max(1, Math.floor((doy - firstMon) / 7) + 1);
}
const dayName = (d) => new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase();
const EVENT_KINDS = ['Dronistaan Day', 'Workshop', 'FDP', 'Webinar', 'Industrial visit', 'Demo', 'Awareness talk', 'Elective', 'Other'];
const VISIT_PURPOSE = ['Discovery', 'Qualified meeting', 'Proposal discussion', 'Site assessment', 'Negotiation', 'Event coordination', 'Account expansion'];
const INST_KINDS = ['Engineering', 'Agri', 'Polytechnic', 'University', 'Arts & Science', 'School', 'Government', 'Corporate', 'Other'];
const CONTACT_ROLES = ['Chairman', 'Trustee', 'Principal', 'Director', 'Dean', 'HoD', 'TPO', 'Procurement', 'Finance', 'Other'];
const EMAIL_CATS = ['Newsletter', 'Marketing', 'Training update', 'Internal update', 'Follow-up', 'Webinar'];

/* ---------- data layer ---------- */
const TABLES = ['profiles', 'sales_targets', 'chat_messages', 'work_tasks', 'work_subtasks', 'departments', 'revenue_targets', 'campaign_types', 'mkt_campaigns', 'campaign_spend', 'project_items', 'stages', 'products', 'product_items', 'institutions', 'contacts', 'campaigns', 'leads', 'remarks', 'remark_edits',
  'price_disclosures', 'payments', 'events', 'event_attendees', 'visits', 'email_templates', 'email_queue',
  'unsubscribes', 'automation_rules', 'ai_insights', 'projects', 'complaints', 'targets', 'revenue_entries', 'admissions', 'admission_sources',
  'email_contacts', 'email_lists', 'email_list_members', 'email_sequences', 'sequence_steps', 'sequence_enrollments', 'email_clicks'];
const RT_TABLES = ['leads', 'remarks', 'payments', 'price_disclosures', 'email_queue', 'visits', 'event_attendees', 'revenue_entries', 'admissions', 'complaints', 'projects', 'project_items', 'work_tasks', 'work_subtasks', 'chat_messages', 'sales_targets'];
/* screens retired in v3 (tasks, approvals, EOD & MIS, training calendar): kept empty so nothing old can break */
const RETIRED = ['tasks', 'batches', 'eod_reports', 'business_tasks', 'review_meetings', 'review_items', 'daily_mom', 'comments', 'approval_rules', 'approvals'];
const PAGE = 1000;
/* tables without an id column are paged by their primary key */
const ORDER_KEYS = { departments: ['code'], revenue_targets: ['dept', 'month'], campaign_types: ['name'], stages: ['funnel', 'key'], unsubscribes: ['email'], email_list_members: ['list_id', 'contact_id'] }; /* Supabase returns at most 1,000 rows per request, so every table is read in pages */

/* a reset or invite link: remember it before the Supabase client reads the address, so the CRM asks for a new password */
(() => { const m = (location.hash + '&' + location.search).match(/type=(recovery|invite)/); if (m) { try { sessionStorage.setItem('garuda-auth-link', m[1] === 'recovery' ? 'recovery' : 'invite'); } catch (_) { /* ignore */ } } })();
const DB = {
  mode: 'live', loadErrors: [], sb: null, session: null, me: null, t: {}, settings: {}, listeners: new Set(), rtTimer: null,

  keep: true,
  /* the Supabase client: "Keep me signed in" keeps the session on this device; otherwise it ends when the browser closes */
  makeClient(keep) {
    const cfg = window.GARUDA_CONFIG || {};
    this.keep = keep;
    this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: keep ? window.localStorage : window.sessionStorage } });
    this.sb.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') { try { sessionStorage.setItem('garuda-auth-link', 'recovery'); } catch (_) { /* ignore */ } }
      const had = !!this.session; this.session = s; if (!!s !== had) location.reload();
    });
  },
  async init() {
    const cfg = window.GARUDA_CONFIG || {};
    if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) {
      this.mode = 'live';
      let keep = true; try { keep = localStorage.getItem('garuda-keep') !== '0'; } catch (_) { /* private mode */ }
      this.makeClient(keep);
      const { data } = await this.sb.auth.getSession();
      this.session = data.session;
    } else {
      throw new Error('NOT_CONFIGURED');
    }
  },

  /* read a whole table, 1,000 rows at a time (several pages in parallel) */
  async fetchAll(t, build = (x) => x) {
    const keys = ORDER_KEYS[t] || ['id'];
    const head = await build(this.sb.from(t).select(keys[0], { count: 'exact', head: true }));
    if (head.error) throw new Error(`${t}: ${friendly(head.error)}`);
    const total = head.count || 0; const pages = [];
    for (let from = 0; from < total; from += PAGE) pages.push(from);
    const out = [];
    for (let i = 0; i < pages.length; i += 6) {
      const res = await Promise.all(pages.slice(i, i + 6).map((from) => keys.reduce((q, k) => q.order(k), build(this.sb.from(t).select('*'))).range(from, from + PAGE - 1)));
      for (const r of res) { if (r.error) throw new Error(`${t}: ${friendly(r.error)}`); out.push(...(r.data || [])); }
    }
    return out;
  },
  async load() {
    this.loadErrors = [];
    const since = new Date(Date.now() - 200 * 86400e3).toISOString();
    const build = (t) => (x) => {
      if (t === 'remarks' || t === 'email_queue') return x.gte('created_at', since);
      if (t === 'email_clicks') return x.gte('clicked_at', since);
      if (t === 'chat_messages') return x.gte('created_at', new Date(Date.now() - 90 * 86400e3).toISOString());
      return x;
    };
    const res = await Promise.all(TABLES.map((t) => (t === 'ai_insights'
      ? this.sb.from(t).select('*').order('created_at', { ascending: false }).limit(10).then((r) => r.data || [])
      : this.fetchAll(t, build(t)).catch((e) => { console.error('Could not load ' + e.message); this.loadErrors.push(t); return []; }))));
    if (['profiles', 'departments', 'stages', 'leads'].some((t) => this.loadErrors.includes(t))) throw new Error('Could not load ' + this.loadErrors.join(', ') + '. Check that every SQL file in SETUP.md has been run, then refresh.');
    res.forEach((r, i) => { this.t[TABLES[i]] = r; });
    RETIRED.forEach((t) => { this.t[t] = []; });
    const s = await this.sb.from('settings').select('*');
    this.settings = Object.fromEntries((s.data || []).map((x) => [x.key, x.value]));
    this.me = this.t.profiles.find((p) => p.auth_id === this.session.user.id && p.active) || null;
    this.subscribe();
  },
  /* the full call history from the sales sheet is only read when a lead is opened */
  async history(leadId) {
    const { data } = await this.sb.from('lead_history').select('text').eq('lead_id', leadId).maybeSingle();
    return data?.text || '';
  },

  subscribe() {
    if (this.mode !== 'live') return;
    const ch = this.sb.channel('crm');
    RT_TABLES.forEach((t) => {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => {
        const arr = this.t[t] || (this.t[t] = []);
        if (p.eventType === 'DELETE') { const i = arr.findIndex((x) => x.id === p.old.id); if (i >= 0) arr.splice(i, 1); }
        else { const i = arr.findIndex((x) => x.id === p.new.id); if (i >= 0) arr[i] = p.new; else arr.push(p.new); }
        clearTimeout(this.rtTimer); this.rtTimer = setTimeout(() => this.emit(), 400);
      });
    });
    ch.subscribe();
  },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); },

  get(t, id) { return (this.t[t] || []).find((x) => x.id === id) || null; },
  profile(id) { return this.get('profiles', id); },
  pname(id) { const p = this.profile(id); return p ? p.full_name || p.email : id ? 'Unknown' : 'Unassigned'; },

  async insert(t, row) {
    const { data, error } = await this.sb.from(t).insert(row).select().single();
    if (error) throw new Error(friendly(error));
    (this.t[t] ||= []).push(data);
    if (['remarks', 'price_disclosures', 'payments'].includes(t)) await this.refreshLead(data.lead_id);
    if (t === 'payments' || t === 'leads') await this.refreshMoney();
    if (t === 'work_subtasks') this.t.work_tasks = await this.fetchAll('work_tasks');
    this.emit();
    return data;
  },
  async update(t, id, patch) {
    const { data, error } = await this.sb.from(t).update(patch).eq('id', id).select().single();
    if (error) throw new Error(friendly(error));
    const arr = this.t[t]; const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = data;
    if (t === 'leads' || t === 'remarks' || t === 'payments') await this.refreshLead(data.lead_id || (t === 'leads' ? id : null));
    if (t === 'payments' || t === 'leads') await this.refreshMoney();
    if (t === 'project_items' && data.payment_id) this.t.payments = await this.fetchAll('payments');
    if (t === 'work_subtasks') this.t.work_tasks = await this.fetchAll('work_tasks');
    this.emit();
    return data;
  },
  async remove(t, id) {
    const { error } = await this.sb.from(t).delete().eq('id', id);
    if (error) throw new Error(friendly(error));
    this.t[t] = this.t[t].filter((x) => x.id !== id);
    if (t === 'work_subtasks') this.t.work_tasks = await this.fetchAll('work_tasks');
    if (t === 'work_tasks') this.t.work_subtasks = this.t.work_subtasks.filter((x) => x.task_id !== id);
    this.emit();
  },
  async insertMany(t, rows) {
    if (!rows.length) return [];
    const { data, error } = await this.sb.from(t).insert(rows).select();
    if (error) throw new Error(friendly(error));
    (this.t[t] ||= []).push(...data);
    this.emit();
    return data;
  },
  /* one change to many rows (bulk reassign, bulk status), 300 ids per request */
  async bulkUpdate(t, ids, patch) {
    ids = [...ids]; let n = 0;
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await this.sb.from(t).update(patch).in('id', ids.slice(i, i + 300)).select();
      if (error) throw new Error(friendly(error));
      for (const row of data || []) { const arr = this.t[t]; const k = arr.findIndex((x) => x.id === row.id); if (k >= 0) arr[k] = row; n++; }
    }
    if (t === 'leads') await this.refreshMoney();
    this.emit();
    return n;
  },
  /* triggers change the lead (fee flag, last contact, tasks); fetch it again after related writes */
  async refreshLead(id) {
    if (this.mode !== 'live' || !id) return;
    const { data } = await this.sb.from('leads').select('*').eq('id', id).maybeSingle();
    if (data) { const arr = this.t.leads; const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = data; else arr.push(data); }
    this.emit();
  },
  /* payments and stage changes write the revenue ledger and admissions in the database */
  async refreshMoney() {
    if (this.mode !== 'live') return;
    /* a won deal also creates its project in the database */
    const [a, b, c] = await Promise.all([this.fetchAll('revenue_entries'), this.fetchAll('admissions'), this.fetchAll('projects')]);
    this.t.revenue_entries = a; this.t.admissions = b; this.t.projects = c;
  },
  async setSetting(key, value) {
    if (this.mode === 'live') {
      const { error } = await this.sb.from('settings').upsert({ key, value, updated_at: nowISO(), updated_by: this.me.id });
      if (error) throw new Error(friendly(error));
    }
    this.settings[key] = value; this.emit();
  },
  /* call a database function (start_review, launch_campaign, apply_gst_rates ...) */
  async rpc(name, args = {}) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw new Error(friendly(error));
    await this.load(); this.emit();
    return data;
  },
  /* call a database function and re-read only the tables it touches */
  async call(name, args = {}, tables = []) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw new Error(friendly(error));
    for (const t of tables) this.t[t] = await this.fetchAll(t);
    this.emit();
    return data;
  },
  /* call an edge function */
  async fn(name, body) {
    const { data, error } = await this.sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (_) { /* keep */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
  async fetchAudit(rowId) {
    const { data } = await this.sb.from('audit_log').select('*').eq('row_id', rowId).order('changed_at', { ascending: false }).limit(100);
    return data || [];
  },
};

function friendly(e) {
  const m = e.message || String(e);
  if (/row-level security/i.test(m)) return 'You do not have permission for this action.';
  if (/duplicate key/i.test(m)) return 'A record with the same details already exists.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

/* ---------- stages & lead helpers ---------- */
/* kind: 'lead' = lead statuses, 'deal' = deal stages; 'both' rows (Closed Lost, Not Updated) appear in either list */
const S = {
  list(funnel, kind) { return DB.t.stages.filter((s) => s.funnel === funnel && (!kind || s.kind === kind || s.kind === 'both')).sort((a, b) => a.ord - b.ord); },
  get(funnel, key) { return DB.t.stages.find((s) => s.funnel === funnel && s.key === key); },
  open(funnel, kind) { return this.list(funnel, kind).filter((s) => !s.is_won && !s.is_lost && !s.is_closed); },
  firstWon(funnel) { return this.list(funnel, 'deal').find((s) => s.is_won); },
  firstLost(funnel, kind) { return this.list(funnel, kind).find((s) => s.is_lost); },
  firstOpen(funnel, kind) { return this.open(funnel, kind)[0]; },
};
const L = {
  st: (l) => S.get(l.funnel, l.stage) || { prob: 0, is_won: false, is_lost: false, is_closed: false, ord: 0 },
  /* closed, not lost: Duplicate, Other Department (neither open nor lost) */
  won: (l) => L.st(l).is_won, lost: (l) => L.st(l).is_lost, closed: (l) => !!L.st(l).is_closed, open: (l) => !L.st(l).is_won && !L.st(l).is_lost && !L.st(l).is_closed,
  prob: (l) => L.st(l).prob,
  gross: (l) => (Number(l.value) || 0) * (1 + (Number(l.gst_rate) || 0) / 100),
  paidEx: (l) => (Number(l.collected_import) || 0) + sum(DB.t.payments.filter((p) => p.lead_id === l.id && p.status === 'Verified'), (p) => p.amount_ex),
  /* an open deal is on the pipeline */
  inPipe: (l) => !!l.is_deal && L.open(l),
  isDeal: (l) => !!l.is_deal,
  ownerLabel: (l) => (l.owner ? DB.pname(l.owner) : l.owner_name || 'Unassigned'),
  claimedEx: (l) => sum(DB.t.payments.filter((p) => p.lead_id === l.id && p.status === 'Claimed'), (p) => p.amount_ex),
  /* fees imported from the sales sheet already sit in the revenue ledger as monthly totals, so sheet admissions with no CRM payment show no balance */
  due: (l) => (L.won(l) && !(l.imported && dept(l.funnel).has_admissions && !DB.t.payments.some((p) => p.lead_id === l.id)) ? Math.max(0, (Number(l.value) || 0) - L.paidEx(l)) : 0),
  product: (l) => DB.get('products', l.product_id),
  inst: (l) => DB.get('institutions', l.institution_id),
  company: (l) => L.inst(l)?.name || l.org || '',
  remarks: (l) => DB.t.remarks.filter((r) => r.lead_id === l.id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  latestRemark: (l) => { const r = DB.t.remarks.filter((x) => x.lead_id === l.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]; return r && (!l.latest_remark || r.created_at > (l.updated_at || '')) ? r.text : l.latest_remark || (r ? r.text : ''); },
  title: (l) => l.name + (L.inst(l) && !l.name.includes(L.inst(l).name) ? ' · ' + L.inst(l).name : ''),
  closeDate: (l) => l.expected_close || null,
  /* sheet imports carry the import time as their stage and deal dates; use the sheet's own dates for those */
  importStamp: (l, x) => !!(l.imported && x && l.created_at && Math.abs(new Date(x) - new Date(l.created_at)) < 864e5),
  sheetDate: (l) => l.last_followup || l.allocated_date || l.enquiry_date || l.created_at,
  stageAt: (l) => (L.importStamp(l, l.stage_changed_at) || !l.stage_changed_at ? (l.imported ? L.sheetDate(l) : l.created_at) : l.stage_changed_at),
  dealAt: (l) => (l.is_deal ? (L.importStamp(l, l.deal_at) || !l.deal_at ? (l.imported ? L.sheetDate(l) : l.created_at) : l.deal_at) : null),
  updated: (l) => [L.stageAt(l), l.last_contact_at, l.imported && L.importStamp(l, l.updated_at) ? null : l.updated_at].filter(Boolean).sort().pop() || l.created_at,
};

/* client-side copy of the database stage gates (the database enforces them again) */
function stageGate(l, to) {
  const st = S.get(l.funnel, to); if (!st) return 'Unknown status';
  if (st.kind === 'deal' && !l.is_deal) return `"${to}" is a deal stage. Use Convert to deal first.`;
  if (st.kind === 'lead' && l.is_deal) return `"${to}" is a lead status. Choose a deal stage.`;
  if (st.needs_reason && !l.lost_reason) return 'LOST_REASON';
  if (st.needs_fee && !(l.fee_disclosed || DB.t.price_disclosures.some((p) => p.lead_id === l.id))) return `Record the fee told to the client (price + GST) before moving to ${to}.`;
  if (st.needs_payment && !l.po_ref && !isFinance() && !DB.t.payments.some((p) => p.lead_id === l.id && ['Claimed', 'Verified'].includes(p.status))) return `Record a payment or the PO / contract reference before moving to ${to}.`;
  return null;
}

/* the database only returns records in my scope; this keeps the client in step (and the preview honest) */
function visibleLeads() {
  const me = DB.me; if (!me) return [];
  if (seesAll()) return DB.t.leads;
  const s = scopeIds();
  return DB.t.leads.filter((l) => s.has(l.owner) || l.created_by === me.id);
}

function priceFor(product, qty) {
  if (!product) return 0;
  if (qty >= 50 && product.tier50) return Number(product.tier50);
  if (qty >= 25 && product.tier25) return Number(product.tier25);
  return Number(product.price);
}
function discountLimit() { const d = DB.settings.discounts || { sales: 5, head: 10 }; return isHead() ? d.head : d.sales; }
