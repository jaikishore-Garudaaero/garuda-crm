// Vercel build step: writes app/config.js from the project's environment variables,
// so the Supabase URL and anon key never have to be edited by hand.
//   SUPABASE_URL       https://<ref>.supabase.co
//   SUPABASE_ANON_KEY  the "anon public" key (safe in the browser; row level security protects the data)
//   GOOGLE_SIGN_IN     optional: "on" shows "Continue with Google" (switch Google on in Supabase first)
import { writeFileSync, readFileSync } from 'node:fs';
const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
const key = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const file = new URL('../app/config.js', import.meta.url);
if (!url || !key) {
  const cur = readFileSync(file, 'utf8');
  if (!/supabaseUrl:\s*"https:/.test(cur)) console.warn('SUPABASE_URL / SUPABASE_ANON_KEY are not set: the CRM will show the "Connect the database" screen.');
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url) && !url.startsWith('https://')) { console.error('SUPABASE_URL must start with https://'); process.exit(1); }
if (key.split('.').length !== 3 && !key.startsWith('sb_publishable_')) { console.error('SUPABASE_ANON_KEY does not look like a Supabase anon / publishable key'); process.exit(1); }
const google = /^(on|true|1|yes)$/i.test((process.env.GOOGLE_SIGN_IN || '').trim());
writeFileSync(file, `// Written by tools/vercel-config.mjs during the Vercel build.\nwindow.GARUDA_CONFIG = {\n  supabaseUrl: ${JSON.stringify(url)},\n  supabaseAnonKey: ${JSON.stringify(key)},\n  googleSignIn: ${google},\n};\n`);
console.log('config.js written for', url);
