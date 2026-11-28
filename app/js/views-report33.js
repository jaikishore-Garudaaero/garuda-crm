/* Garuda CRM · 33-point lead report. Every lead (follow-ups and deals included) in the management 33-point format,
   split RPTO / CoE / Others. Fills a Google Sheet directly (same link, one tab per department) or downloads an Excel file.
   Rows come from the database function report_33, so each person exports only the leads they can see. */
'use strict';

const R33_HEAD = ['', 'SI NO', '2. Date of lead origin', '3. Name', '4. Phone number', '5. Email ID', '6. Organization name', '7. Location/city/state of customer',
  '8. Requirement Segment', '9. Choose from Customer Profile', '10. Lead origin', '10A. 30 different Lead avenues', '10B. Requests/Remarks from customer', '11.Lead Status',
  '12. Nature of order (Drone Sale/ Drone Service)', '13. Value of potential order (Amount in Rupees)', '14. Quantity of potential order (Number or Drones/Unit of Service contract )',
  '15. Who has assigned the lead ?', '16. To whom has the lead been assigned in GA\n(Name and Department)', '17. Has HOD or CXO been involved with the lead in the recent past',
  '18. Number of times the lead has been reached out to', '19. Last date when the lead was followed up', '20. How long has the lead been nurtured (Duration) ?',
  '21. Has the lead resulted into a sale yet ?', "22. Reasons why lead isn't converting into sale.", '23. Was the lead previously a customer of Garuda / Repeat customer',
  '24. Has 84 data points been shared to customer over the following platforms:', '25. Date when all above was sent or planned to be sent for each A-D platforms',
  '26. Response from the Client, based on # 24 and # 25', '27. Has a Gmeet or Online or Physical meeting taken place to discuss customer requirements, sharing Garuda 84 points, presentation, timeline for delivery budget',
  '28. Does the Customer require a product demonstration or a POC, to push him over the finishline?', '29. Rate the probability of the sale', '30. Predict the timeline of Closure',
  '31.Revenue Quantum Expected in INR', '32.REGULAR UPDATES IN LEADS', '33.Final summery HAS THE LEAD IS CLOSED OR NOT'];
const R33_DEPTS = ['RPTO', 'CoE', 'Others'];
const R33_PAGE = 2000;

/* all rows of one department, page by page; each row = blank col A, SI NO, then the 34 report cells */
async function r33Rows(dept, total, onPage) {
  const out = [];
  for (let off = 0; off < total; off += R33_PAGE) {
    const { data, error } = await DB.sb.rpc('report_33', { p_dept: dept, p_offset: off, p_limit: R33_PAGE });
    if (error) throw new Error(friendly(error));
    (data || []).forEach((r) => out.push(['', String(out.length + 1), ...(Array.isArray(r) ? r : r.cells)]));
    onPage?.(out.length);
    if (!data || data.length < R33_PAGE) break;
  }
  return out;
}

/* Google Sheets: a token for the person's own Google account, only for spreadsheets */
function r33Token() {
  return new Promise((ok, no) => {
    ggLoadScript().then(() => {
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: ggClientId(), scope: 'https://www.googleapis.com/auth/spreadsheets', hint: DB.me?.email || '',
        callback: (r) => (r.error ? no(new Error('Google: ' + r.error)) : ok(r.access_token)),
        error_callback: (e) => no(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed' : 'Google sign-in failed')),
      });
      tc.requestAccessToken();
    }, no);
  });
}
async function r33Api(token, path, opts = {}) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = b?.error?.message || r.status;
    if (/has not been used|is disabled/i.test(m)) throw new Error('The Google Sheets API is switched off for the CRM\'s Google project. Enable it in Google Cloud → APIs & Services → Library → Google Sheets API, wait a minute, then try again.');
    if (r.status === 403 || r.status === 404) throw new Error('Google says this account cannot edit that sheet. Sign in with the account that owns it, or share it with you as Editor.');
    throw new Error('Google Sheets: ' + m);
  }
  return b;
}
const r33SheetId = (s) => (String(s).match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(s).match(/^([a-zA-Z0-9_-]{30,})$/) || [])[1];

async function r33FillSheet(link, counts, say) {
  const id = r33SheetId(link);
  if (!id) throw new Error('Paste the full Google Sheet link (docs.google.com/spreadsheets/d/…)');
  say('Signing in to Google…');
  const tk = await r33Token();
  const meta = await r33Api(tk, `${id}?fields=sheets.properties`);
  const tabs = meta.sheets.map((s) => s.properties);
  const tmpl = tabs[0]; // the 33 POINT layout tab: its first two rows (blank + headers) are copied to each department tab
  const reqs = [];
  let nextId = Math.max(...tabs.map((t) => t.sheetId)) + 1;
  const ids = {};
  R33_DEPTS.filter((d) => counts[d]).forEach((d) => {
    const ex = tabs.find((t) => t.title === d);
    if (ex) { ids[d] = ex.sheetId; return; }
    ids[d] = nextId++;
    reqs.push({ addSheet: { properties: { sheetId: ids[d], title: d, gridProperties: { rowCount: counts[d] + 10, columnCount: 36, frozenRowCount: 2, frozenColumnCount: 4 } } } });
  });
  R33_DEPTS.filter((d) => counts[d]).forEach((d) => {
    const need = counts[d] + 10; const ex = tabs.find((t) => t.title === d);
    if (ex && (ex.gridProperties?.rowCount || 0) < need) reqs.push({ updateSheetProperties: { properties: { sheetId: ids[d], gridProperties: { rowCount: need } }, fields: 'gridProperties.rowCount' } });
    if (ex && (ex.gridProperties?.columnCount || 0) < 36) reqs.push({ updateSheetProperties: { properties: { sheetId: ids[d], gridProperties: { columnCount: 36 } }, fields: 'gridProperties.columnCount' } });
    if (tmpl && tmpl.sheetId !== ids[d]) {
      reqs.push({ copyPaste: { source: { sheetId: tmpl.sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 36 }, destination: { sheetId: ids[d], startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 36 }, pasteType: 'PASTE_NORMAL' } });
      reqs.push({ copyPaste: { source: { sheetId: tmpl.sheetId, startColumnIndex: 0, endColumnIndex: 36 }, destination: { sheetId: ids[d], startColumnIndex: 0, endColumnIndex: 36 }, pasteType: 'PASTE_COLUMN_WIDTHS' } });
    }
  });
  if (reqs.length) await r33Api(tk, `${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  let written = 0;
  for (const d of R33_DEPTS.filter((x) => counts[x])) {
    await r33Api(tk, `${id}/values/${encodeURIComponent(`'${d}'!A3:AJ`)}:clear`, { method: 'POST', body: '{}' });
    const rows = await r33Rows(d, counts[d], (n) => say(`Reading ${d}: ${n.toLocaleString('en-IN')} of ${counts[d].toLocaleString('en-IN')}…`));
    for (let i = 0; i < rows.length; i += 2500) {
      const part = rows.slice(i, i + 2500);
      await r33Api(tk, `${id}/values/${encodeURIComponent(`'${d}'!A${3 + i}:AJ${2 + i + part.length}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: part }) });
      written += part.length;
      say(`Writing ${d}: ${(i + part.length).toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} rows…`);
    }
  }
  return { id, written };
}

async function r33Excel(counts, say) {
  const X = await loadXLSX();
  const wb = X.utils.book_new();
  for (const d of R33_DEPTS.filter((x) => counts[x])) {
    const rows = await r33Rows(d, counts[d], (n) => say(`Reading ${d}: ${n.toLocaleString('en-IN')} of ${counts[d].toLocaleString('en-IN')}…`));
    const ws = X.utils.aoa_to_sheet([[], R33_HEAD, ...rows]);
    ws['!cols'] = R33_HEAD.map((h, i) => ({ wch: i === 0 ? 2 : i === 1 ? 6 : [12, 32, 33].includes(i) ? 50 : 22 }));
    ws['!freeze'] = { xSplit: 4, ySplit: 2 };
    X.utils.book_append_sheet(wb, ws, d);
  }
  X.writeFile(wb, `33 POINTS - Garuda leads - ${todayStr()}.xlsx`);
}

async function report33Modal() {
  const { data: counts, error } = await DB.sb.rpc('report_33_count');
  if (error) return toast(friendly(error), true);
  const c = counts || {};
  const total = R33_DEPTS.reduce((s, d) => s + (c[d] || 0), 0);
  let saved = ''; try { saved = localStorage.getItem('r33-link') || ''; } catch { /* storage off */ }
  openModal({
    title: '33-point lead report', width: 620,
    body: `<p class="faint" style="margin-top:0">Every lead you can see — leads, follow-ups and deals — in the 33-point format, one tab per department. RPTO enquiries routed to CoE are listed under CoE.</p>
      <div class="kpis" style="margin:10px 0">${R33_DEPTS.map((d) => kpi({ label: d, value: (c[d] || 0).toLocaleString('en-IN') })).join('')}</div>
      <div class="field"><label for="r33l">Google Sheet link</label><input id="r33l" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(saved)}">
        <small class="faint">Writes RPTO, CoE and Others tabs into this same sheet, with the headers from its first tab. Re-running replaces those tabs' rows with fresh data.</small></div>
      <p class="faint" style="font-size:12.5px">Points 24–26 (84 data points shared, date, client response) are not recorded in the CRM, so those columns are left for the team to fill.</p>
      <div id="r33s" class="faint" style="min-height:20px;font-weight:600"></div>`,
    foot: `<button class="btn" id="r33x">${svg('download')} Download Excel</button><button class="btn primary" id="r33g">${svg('upload')} Fill Google Sheet (${total.toLocaleString('en-IN')} rows)</button>`,
    onMount: ({ el }) => {
      const say = (t) => { el.querySelector('#r33s').textContent = t; };
      const lock = (on) => el.querySelectorAll('.modal-foot button').forEach((b) => (b.disabled = on));
      el.querySelector('#r33x').onclick = async () => { lock(true); try { await r33Excel(c, say); say('Excel downloaded.'); } catch (e) { say(''); toast(e.message, true); } lock(false); };
      el.querySelector('#r33g').onclick = async () => {
        const link = el.querySelector('#r33l').value.trim(); lock(true);
        try {
          try { localStorage.setItem('r33-link', link); } catch { /* storage off */ }
          const r = await r33FillSheet(link, c, say);
          say(`Done: ${r.written.toLocaleString('en-IN')} rows written.`);
          toast('33-point report written to the Google Sheet');
          window.open(`https://docs.google.com/spreadsheets/d/${r.id}/edit`, '_blank', 'noopener');
        } catch (e) { say(''); toast(e.message, true); }
        lock(false);
      };
    },
  });
}
