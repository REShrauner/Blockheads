// Copy this file to js/config.js and fill in your own project's values,
// from Supabase Dashboard > Project Settings > API.
//
// The anon/publishable key below is safe to expose in client-side code and
// to commit to git - it is not a secret. Your data is protected by the
// Row Level Security policies in supabase/schema.sql, not by keeping this
// key hidden. js/config.js should be committed for the same reason Recipe
// Box's is: this is a static site with no build step, so GitHub Pages can
// only serve what's actually in the repo.
window.BLOCKHEADS_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'sb_publishable_YOUR_KEY_HERE',
};
