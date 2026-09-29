// Creates the shared Supabase client from js/config.js. Every other script
// reads window.supabaseClient.
(function () {
  const cfg = window.BLOCKHEADS_CONFIG;
  if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes('YOUR-PROJECT-REF')) {
    document.body.innerHTML =
      '<div style="max-width:520px;margin:80px auto;padding:24px;font-family:sans-serif;">' +
      '<h1>Blockheads isn\'t set up yet</h1>' +
      '<p>Copy <code>js/config.example.js</code> to <code>js/config.js</code> and fill in your Supabase project URL and anon key.</p>' +
      '</div>';
    throw new Error('Missing Blockheads config');
  }
  window.supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  // The create-user Edge Function lives at this project's /functions/v1/create-user
  window.BLOCKHEADS_EDGE_FN_URL = cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/create-user';
})();
