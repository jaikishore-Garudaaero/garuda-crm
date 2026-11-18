// Garuda CRM configuration.
// On Vercel this file is written automatically from the SUPABASE_URL and SUPABASE_ANON_KEY
// environment variables (tools/vercel-config.mjs). Elsewhere, fill in the two values by hand.
window.GARUDA_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",  // the "anon public" key (safe to publish; security is enforced by row level security)
  googleSignIn: false,  // true shows "Continue with Google" (switch Google on in Supabase first)
};
