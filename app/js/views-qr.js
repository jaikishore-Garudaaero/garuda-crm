/* Garuda CRM · Marketing → QR Campaigns. One QR per campaign (expo stall, college visit, poster, brochure…).
   Scanning opens q.html?c=CODE; each enquiry becomes a lead tagged with the campaign and shows up here live. */
'use strict';

const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const QRS = { camp: '', q: '', day: 'all' };
const loadQR = () => (window.qrcode ? Promise.resolve(window.qrcode) : new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = QR_LIB; s.onload = () => ok(window.qrcode); s.onerror = () => no(new Error('Could not load the QR maker. Check the internet connection.')); document.head.appendChild(s);
}));
const qrUrl = (c) => `${location.origin}/q.html?c=${encodeURIComponent(c.qr_code)}`;
const qrCamps = () => (DB.t.mkt_campaigns || []).filter((c) => c.qr_code).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
const qrLeads = () => visibleLeads().filter((l) => l.source === 'QR Code' || (l.mkt_campaign_id && qrCamps().some((c) => c.id === l.mkt_campaign_id)));
const qrSlug = (name) => (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'qr') + '-' + Math.random().toString(36).slice(2, 6);

async function qrSvg(text, px = 220) {
  const q = (await loadQR())(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); const cell = px / (n + 8); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${(c + 4) * cell},${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b1f3a"/></svg>`;
}
/* printable PNG: QR + campaign name + "Scan to enquire" */
async function qrPng(c) {
  const svg = await qrSvg(qrUrl(c), 900);
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 1220; const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#005aa9'; g.fillRect(0, 0, cv.width, 130);
  g.fillStyle = '#fff'; g.font = '700 54px Sora, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('Garuda Aerospace', 500, 85);
  g.drawImage(img, 50, 150, 900, 900);
  g.fillStyle = '#0b1f3a'; g.font = '700 46px Sora, Arial, sans-serif'; g.fillText('Scan to enquire', 500, 1110);
  g.fillStyle = '#566175'; g.font = '500 32px Figtree, Arial, sans-serif'; g.fillText(c.name.slice(0, 48), 500, 1170);
  const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `QR - ${c.name}.png`; document.body.appendChild(a); a.click(); a.remove();
}

function qrCampaignModal(c = {}) {
  const depts = DB.t.departments.filter((d) => d.active !== false);
  const m = openModal({
    title: c.id ? 'Edit QR campaign' : 'New QR campaign', width: 560,
    body: `<div class="form">
      ${fld('qn', 'Campaign name', inp('qn', c.name || '', 'text', 'placeholder="e.g. Agri Expo Chennai · Stall 14"'), 'full')}
      ${fld('qd', 'Main department (for reports)', `<select id="qd"><option value="">Decided by the service chosen</option>${depts.map((d) => `<option value="${esc(d.code)}" ${c.dept === d.code ? 'selected' : ''}>${esc(d.name || d.code)}</option>`).join('')}</select>`)}
      ${fld('qs', 'Status', `<select id="qs">${['Active', 'Paused', 'Completed'].map((s) => `<option ${(c.status || 'Active') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${fld('qno', 'Where it is used', inp('qno', c.notes || '', 'text', 'placeholder="e.g. standee at the entrance, back of brochure"'), 'full')}
    </div><p class="faint" style="margin:8px 0 0">Each enquiry goes to the department of the service the person picks (RPTO training → RPTO, labs / workshops → CoE, RPTO establishment → EST), gets an owner and a first-call task.</p>`,
    foot: `<button class="btn" data-c>Cancel</button><button class="btn primary" id="qgo">${c.id ? 'Save' : 'Create QR'}</button>`,
  });
  m.el.querySelector('#qgo').onclick = () => guard(async () => {
    const name = m.el.querySelector('#qn').value.trim(); if (!name) return toast('Give the campaign a name', true);
    const row = { name, dept: m.el.querySelector('#qd').value || null, status: m.el.querySelector('#qs').value, notes: m.el.querySelector('#qno').value.trim() };
    if (c.id) await DB.update('mkt_campaigns', c.id, row);
    else await DB.insert('mkt_campaigns', { ...row, kind: 'other', type: 'QR Code', platform: 'QR', qr_code: qrSlug(name), start_date: todayStr() });
    m.close(); toast(c.id ? 'Saved' : 'QR campaign created'); render();
  });
}

VIEWS.qr = {
  title: 'QR Campaigns',
  sub: 'Make a QR for every stall, poster or visit. People scan, fill a short form, and the lead lands here live: tagged with the campaign, routed to the right team, with a first-call task.',
  actions: () => (canCampaigns() ? `<button class="btn primary" id="qrnew">${svg('plus')} New QR campaign</button>` : ''),
  mount() { $('#qrnew')?.addEventListener('click', () => qrCampaignModal()); },
  render(el) {
    const camps = qrCamps(); const leads = qrLeads();
    const today = todayStr(); const isToday = (l) => String(l.created_at || '').slice(0, 10) === today || (l.created_at && new Date(l.created_at).toLocaleDateString('en-CA') === today);
    const byCamp = (id) => leads.filter((l) => l.mkt_campaign_id === id);
    const feed = leads.filter((l) => (!QRS.camp || l.mkt_campaign_id === QRS.camp) && (QRS.day !== 'today' || isToday(l))
      && (!QRS.q || `${l.name} ${l.contact_name} ${l.phone} ${l.email} ${l.enquiry_for} ${l.referrer}`.toLowerCase().includes(QRS.q.toLowerCase())))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const owner = (id) => DB.get('profiles', id)?.full_name || '—';
    el.innerHTML = `
      <div class="kpis">${kpi({ label: 'QR leads today', value: leads.filter(isToday).length, tone: 'good' })}${kpi({ label: 'QR leads in all', value: leads.length })}${kpi({ label: 'With a referral', value: leads.filter((l) => l.referrer).length })}${kpi({ label: 'Live campaigns', value: camps.filter((c) => (c.status || 'Active') === 'Active').length })}</div>
      ${camps.length ? `<div class="qr-grid">${camps.map((c) => { const ls = byCamp(c.id); return `
        <article class="glass panel qr-card" data-qc="${c.id}">
          <div class="qr-img" data-qimg="${c.id}" aria-label="QR code for ${esc(c.name)}"></div>
          <div class="qr-meta">
            <div class="qr-name">${esc(c.name)} <span class="chip ${(c.status || 'Active') === 'Active' ? 'good' : ''}">${esc(c.status || 'Active')}</span></div>
            ${c.notes ? `<div class="faint">${esc(c.notes)}</div>` : ''}
            <div class="qr-nums"><span><b>${ls.filter(isToday).length}</b> today</span><span><b>${ls.length}</b> total</span><span><b>${ls.filter((l) => l.is_deal || L.won(l)).length}</b> deals</span></div>
            <code class="qr-link">${esc(qrUrl(c))}</code>
            <div class="qr-btns"><button class="btn small primary" data-qpng="${c.id}">${svg('download')} Download QR</button><button class="btn small" data-qcopy="${c.id}">Copy link</button>
              <a class="btn small" href="${esc(qrUrl(c))}" target="_blank" rel="noopener">Open form</a>${canCampaigns() ? `<button class="btn small ghost" data-qedit="${c.id}">Edit</button>` : ''}</div>
          </div></article>`; }).join('')}</div>`
        : empty('No QR campaigns yet', 'Create one for your next expo, college visit or poster. Each gets its own QR and link.')}
      <section class="glass panel">
        <div class="filters"><h3 style="margin:0 auto 0 0">Live QR leads <span class="qr-live" title="Updates live"></span></h3>
          <div class="seg">${[['all', 'All'], ['today', 'Today']].map(([k, t]) => `<button data-qday="${k}" aria-pressed="${QRS.day === k}">${t}</button>`).join('')}</div>
          ${sel('qrc', camps.map((c) => [c.id, c.name]), QRS.camp, 'Every campaign')}
          <input type="search" id="qrq" placeholder="Search name, phone, service" value="${esc(QRS.q)}"></div>
        ${feed.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Name</th><th>Mobile</th><th>Looking for</th><th>Campaign</th><th>Referred by</th><th>Dept · owner</th><th>Stage</th></tr></thead><tbody>
          ${feed.slice(0, 300).map((l) => `<tr class="click" data-ql="${l.id}"><td class="nowrap">${esc(rel(l.created_at))}</td>
            <td><b>${esc(l.contact_name || l.name)}</b>${l.contact_name ? `<div class="faint">${esc(l.name)}</div>` : ''}</td>
            <td class="nowrap">${esc(l.phone || '')}${l.email ? `<div class="faint">${esc(l.email)}</div>` : ''}</td>
            <td>${esc(l.enquiry_for || l.course || l.sub_category || '')}${l.also_interested ? `<div class="faint">also: ${esc(l.also_interested)}</div>` : ''}</td>
            <td>${esc(DB.get('mkt_campaigns', l.mkt_campaign_id)?.name || '—')}</td>
            <td>${l.referrer ? esc(l.referrer) : '<span class="faint">—</span>'}</td>
            <td>${esc(l.funnel)} · ${esc(owner(l.owner))}</td><td><span class="chip">${esc(l.stage)}</span></td></tr>`).join('')}
        </tbody></table></div>` : empty('No QR leads yet', 'When someone scans a QR and sends the form, they appear here within seconds.')}
      </section>`;
    camps.forEach((c) => qrSvg(qrUrl(c), 160).then((s) => { const b = el.querySelector(`[data-qimg="${c.id}"]`); if (b) b.innerHTML = s; }, () => {}));
    el.querySelectorAll('[data-qpng]').forEach((b) => (b.onclick = () => guard(() => qrPng(DB.get('mkt_campaigns', b.dataset.qpng)))));
    el.querySelectorAll('[data-qcopy]').forEach((b) => (b.onclick = async () => {
      const u = qrUrl(DB.get('mkt_campaigns', b.dataset.qcopy));
      try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { toast(u); }
    }));
    el.querySelectorAll('[data-qedit]').forEach((b) => (b.onclick = () => qrCampaignModal(DB.get('mkt_campaigns', b.dataset.qedit))));
    el.querySelectorAll('[data-qday]').forEach((b) => (b.onclick = () => { QRS.day = b.dataset.qday; render(); }));
    el.querySelector('#qrc').onchange = (e) => { QRS.camp = e.target.value; render(); };
    let t; el.querySelector('#qrq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { QRS.q = e.target.value; const at = e.target.selectionStart; render(); const s = $('#qrq'); if (s) { s.focus(); s.setSelectionRange(at, at); } }, 300); };
    el.querySelectorAll('[data-ql]').forEach((r) => (r.onclick = () => openLead(r.dataset.ql)));
  },
};
