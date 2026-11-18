/**
 * Garuda CRM · Mailer
 * Sends the CRM's email queue from your dedicated marketing mailbox (Gmail / Google Workspace),
 * then reports back opens, replies and bounces.
 *
 * SET-UP (5 minutes, signed in as the marketing mailbox, e.g. marketing@garudaaerospace.com):
 *  1. script.google.com → New project → paste this file.
 *  2. Project Settings → Script properties → add:
 *       SUPABASE_URL          https://<ref>.supabase.co
 *       SUPABASE_SERVICE_KEY  <service_role key from Supabase → Project Settings → API>
 *       REPLY_TO              (optional) address replies should go to
 *  3. Run  install()  once and approve the permissions. It adds the time triggers.
 *  4. Optional: in Gmail → Settings → Accounts → "Send mail as", add aliases such as
 *     newsletter@, training@, internal@. Then put them in CRM → Settings → Email senders.
 *
 * Quota: Google Workspace allows about 1,500 recipients a day per mailbox (Gmail free: 100).
 */

const PROPS = PropertiesService.getScriptProperties();
const BASE = () => PROPS.getProperty('SUPABASE_URL').replace(/\/$/, '');
const KEY = () => PROPS.getProperty('SUPABASE_SERVICE_KEY');
const BATCH = 40;          // emails per run (runs every minute)

function api_(method, path, body, prefer) {
  const opt = {
    method: method,
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { apikey: KEY(), Authorization: 'Bearer ' + KEY(), Prefer: prefer || 'return=minimal' },
  };
  if (body) opt.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(BASE() + '/rest/v1/' + path, opt);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('Supabase ' + code + ': ' + res.getContentText().slice(0, 300));
  const t = res.getContentText();
  return t ? JSON.parse(t) : null;
}

function trackUrl_() { return BASE() + '/functions/v1/track'; }

function decorate_(row) {
  const t = trackUrl_();
  let html = row.html || '';
  // wrap links for click tracking (skip mailto/tel and the unsubscribe link)
  html = html.replace(/href="(https?:\/\/[^"]+)"/gi, function (_, u) {
    return 'href="' + t + '?e=' + row.id + '&t=c&u=' + encodeURIComponent(u) + '"';
  });
  if (row.category !== 'Internal update') {
    html += '<p style="font-size:11px;color:#888;margin-top:24px">Garuda Aerospace Ltd · Chennai, Tamil Nadu<br>' +
            'You received this because you enquired with or work with Garuda Aerospace. ' +
            '<a href="' + t + '?e=' + row.id + '&t=u">Unsubscribe</a></p>';
  }
  html += '<img src="' + t + '?e=' + row.id + '&t=o" width="1" height="1" alt="" style="display:block;border:0">';
  return html;
}

function plain_(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Every minute: send queued emails whose time has come. */
function processQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const left = MailApp.getRemainingDailyQuota();
    if (left <= 0) return;
    const now = new Date().toISOString();
    const rows = api_('get', 'email_queue?select=*&status=eq.Queued&scheduled_at=lte.' + encodeURIComponent(now) +
                      '&order=scheduled_at.asc&limit=' + Math.min(BATCH, left));
    if (!rows || !rows.length) return;
    const aliases = GmailApp.getAliases();
    const me = Session.getActiveUser().getEmail();
    const replyTo = PROPS.getProperty('REPLY_TO') || '';
    rows.forEach(function (row) {
      try {
        api_('patch', 'email_queue?id=eq.' + row.id + '&status=eq.Queued', { status: 'Sending' });
        const unsub = trackUrl_() + '?e=' + row.id + '&t=u';
        const opts = {
          htmlBody: decorate_(row),
          name: 'Garuda Aerospace',
        };
        if (row.sender && (aliases.indexOf(row.sender) >= 0 || row.sender === me)) opts.from = row.sender;
        if (row.reply_to || replyTo) opts.replyTo = row.reply_to || replyTo;
        const draft = GmailApp.createDraft(row.to_email, row.subject, plain_(row.html), opts);
        const msg = draft.send();
        api_('patch', 'email_queue?id=eq.' + row.id, {
          status: 'Sent', sent_at: new Date().toISOString(), gmail_thread_id: msg.getThread().getId(), error: null,
        });
      } catch (e) {
        api_('patch', 'email_queue?id=eq.' + row.id, { status: 'Failed', error: String(e).slice(0, 500) });
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/** Every 15 minutes: mark replies and bounces. */
function scanReplies() {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const rows = api_('get', 'email_queue?select=id,to_email,gmail_thread_id,lead_id&status=eq.Sent&replied_at=is.null&gmail_thread_id=not.is.null&sent_at=gte.' +
                    encodeURIComponent(since) + '&limit=400');
  const mine = [Session.getActiveUser().getEmail()].concat(GmailApp.getAliases()).map(function (x) { return x.toLowerCase(); });
  (rows || []).forEach(function (row) {
    try {
      const th = GmailApp.getThreadById(row.gmail_thread_id);
      if (!th) return;
      const msgs = th.getMessages();
      for (let i = 1; i < msgs.length; i++) {
        const from = (msgs[i].getFrom().match(/<([^>]+)>/) || [null, msgs[i].getFrom()])[1].toLowerCase();
        if (mine.indexOf(from) < 0 && from.indexOf('mailer-daemon') < 0) {
          api_('patch', 'email_queue?id=eq.' + row.id, { replied_at: msgs[i].getDate().toISOString() });
          break;
        }
      }
    } catch (e) { /* thread may be deleted */ }
  });
  // bounces
  const bounces = GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:2d', 0, 50);
  bounces.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      const body = m.getPlainBody();
      const hit = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
      hit.filter(function (a) { return a.toLowerCase().indexOf('mailer-daemon') < 0 && mine.indexOf(a.toLowerCase()) < 0; })
         .slice(0, 3).forEach(function (addr) {
        try {
          api_('patch', 'email_queue?to_email=ilike.' + encodeURIComponent(addr) + '&status=eq.Sent&bounced_at=is.null',
               { bounced_at: m.getDate().toISOString() });
        } catch (e) {}
      });
    });
  });
}

/** Run once to install the triggers. */
function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('scanReplies').timeBased().everyMinutes(15).create();
  Logger.log('Installed. Remaining quota today: ' + MailApp.getRemainingDailyQuota());
}

/** Quick test: queues nothing, just checks the connection. */
function testConnection() {
  const rows = api_('get', 'email_queue?select=id,status&limit=1');
  Logger.log('Connected to Supabase. Sample: ' + JSON.stringify(rows));
}
