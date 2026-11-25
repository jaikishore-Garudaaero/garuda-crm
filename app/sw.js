// Garuda CRM service worker: caches the app shell so the field app opens fast on weak networks.
// Data always comes live from Supabase.
const CACHE = 'garuda-crm-v25';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'js/core.js', 'js/metrics.js', 'js/ui.js', 'js/views-overview.js', 'js/views-leads.js', 'js/views-work.js', 'js/views-me.js', 'js/views-chat.js', 'js/views-tasks.js', 'js/views-revenue.js', 'js/views-marketing.js', 'js/views-campaigns.js', 'js/views-admin.js', 'js/views-connect.js', 'js/views-auto.js', 'js/views-access.js', 'js/views-activity.js', 'js/views-ptasks.js', 'js/main.js', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // never cache Supabase calls
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
