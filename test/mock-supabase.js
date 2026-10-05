// In-browser mock of the Supabase client + create-user Edge Function, used
// only by test/run.js. Never shipped - real config.js/supabaseClient.js
// load the real @supabase/supabase-js client in the actual app.
(function () {
  function iso(daysFromNow) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString();
  }
  function dateStr(daysFromNow) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
  }

  // ---- fixture data -------------------------------------------------------
  const AUTH_USERS = [
    { id: 'u-super', email: 'rex@blockheads.test', password: 'superpass' },
    { id: 'u-admin', email: 'jane@blockheads.test', password: 'adminpass' },
    { id: 'u-member', email: 'pat@blockheads.test', password: 'memberpass' },
  ];

  const DB = {
    profiles: [
      { id: 'u-super', email: 'rex@blockheads.test', display_name: 'Rex', role: 'superuser', approved_at: iso(-100), created_at: iso(-100) },
      { id: 'u-admin', email: 'jane@blockheads.test', display_name: 'Jane Admin', role: 'admin', approved_at: iso(-80), created_at: iso(-80) },
      { id: 'u-member', email: 'pat@blockheads.test', display_name: 'Pat Member', role: 'member', approved_at: iso(-30), created_at: iso(-30) },
    ],
    membership_requests: [
      { id: 'req-1', name: 'New Quilter', email: 'newbie@example.com', password: 'whatever1', note: 'Excited to join!', status: 'pending', requested_at: iso(-1), decided_by: null, decided_at: null },
      { id: 'req-2', name: 'Another Person', email: 'another@example.com', password: 'whatever2', note: null, status: 'pending', requested_at: iso(-2), decided_by: null, decided_at: null },
    ],
    projects: [
      { id: 'proj-1', name: 'Half-Square Triangles', description: 'Classic HST block, good for beginners.', icon_path: 'proj-1/icon/hst.jpg', created_by: 'u-admin', created_by_name: 'Jane Admin', created_at: iso(-20) },
      { id: 'proj-2', name: 'Flying Geese', description: '', icon_path: null, created_by: 'u-super', created_by_name: 'Rex', created_at: iso(-10) },
    ],
    calendar_events: [
      { id: 'ev-1', event_date: dateStr(7), start_time: '10:00:00', end_time: '14:00:00', title: 'HST Workshop', project_id: 'proj-1', notes: 'Bring rotary cutter', created_by: 'u-admin', created_at: iso(-5) },
      { id: 'ev-2', event_date: dateStr(14), title: 'Flying Geese Bee', project_id: 'proj-2', notes: null, created_by: 'u-super', created_at: iso(-4) },
      { id: 'ev-3', event_date: dateStr(-3), title: 'Past Meeting', project_id: null, notes: null, created_by: 'u-admin', created_at: iso(-20) },
    ],
    notices: [
      { id: 'n-1', title: 'Charity quilt drive', body: 'Bring finished blocks to the next meeting.\nThank you!', show_until: null, created_by: 'u-super', created_by_name: 'Rex', created_at: iso(-2) },
      { id: 'n-2', title: 'Old notice', body: 'This one has expired.', show_until: dateStr(-1), created_by: 'u-admin', created_by_name: 'Jane Admin', created_at: iso(-9) },
    ],
  };

  const STORAGE = {
    'proj-1/icon/hst.jpg': { size: 20480, created_at: iso(-20) },
    'proj-1/files/instructions.pdf': { size: 102400, created_at: iso(-19) },
    'proj-1/files/pattern.docx': { size: 51200, created_at: iso(-18) },
    'proj-2/files/notes.txt': { size: 512, created_at: iso(-9) },
  };

  const TOKEN_TO_USER = {}; // access_token -> auth user

  function uid() {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function defaultsFor(table) {
    const base = { id: uid(), created_at: new Date().toISOString() };
    if (table === 'membership_requests') {
      return { ...base, status: 'pending', requested_at: new Date().toISOString(), decided_by: null, decided_at: null };
    }
    return base;
  }

  // ---- query builder --------------------------------------------------
  function makeBuilder(table) {
    const q = { table, mode: null, filters: [], payload: null, orderCol: null, orderAsc: true, singleFlag: false };

    async function exec() {
      const rows = DB[table] || (DB[table] = []);
      const matches = (row) => q.filters.every(([c, v]) => row[c] === v);
      let result;

      if (q.mode === 'insert') {
        const toInsert = Array.isArray(q.payload) ? q.payload : [q.payload];
        result = toInsert.map((r) => {
          const row = { ...defaultsFor(table), ...r };
          rows.push(row);
          return row;
        });
      } else if (q.mode === 'update') {
        const matched = rows.filter(matches);
        matched.forEach((row) => Object.assign(row, q.payload));
        result = matched;
      } else if (q.mode === 'delete') {
        const matched = rows.filter(matches);
        DB[table] = rows.filter((r) => !matches(r));
        result = matched;
      } else {
        result = rows.filter(matches);
        if (q.orderCol) {
          const col = q.orderCol, asc = q.orderAsc;
          result = [...result].sort((a, b) => {
            if (a[col] < b[col]) return asc ? -1 : 1;
            if (a[col] > b[col]) return asc ? 1 : -1;
            return 0;
          });
        }
      }

      if (q.singleFlag) {
        if (result.length === 1) return { data: result[0], error: null };
        return { data: null, error: { message: 'Results contain 0 rows, expected 1' } };
      }
      return { data: result, error: null };
    }

    q.select = function () { if (!q.mode) q.mode = 'select'; return q; };
    q.insert = function (payload) { q.mode = 'insert'; q.payload = payload; return q; };
    q.update = function (payload) { q.mode = 'update'; q.payload = payload; return q; };
    q.delete = function () { q.mode = 'delete'; return q; };
    q.eq = function (col, val) { q.filters.push([col, val]); return q; };
    q.order = function (col, opts) { q.orderCol = col; q.orderAsc = !opts || opts.ascending !== false; return q; };
    q.single = function () { q.singleFlag = true; return q; };
    q.then = function (onFulfilled, onRejected) { return exec().then(onFulfilled, onRejected); };
    return q;
  }

  // ---- storage ------------------------------------------------------------
  function makeStorage() {
    return {
      from(bucket) {
        return {
          async list(prefix) {
            const p = prefix.endsWith('/') ? prefix : prefix + '/';
            const names = Object.keys(STORAGE)
              .filter((k) => k.startsWith(p) && k.slice(p.length).indexOf('/') === -1)
              .map((k) => ({
                id: k, name: k.slice(p.length),
                created_at: STORAGE[k].created_at,
                metadata: { size: STORAGE[k].size },
              }));
            return { data: names, error: null };
          },
          async upload(path, file, opts) {
            if (STORAGE[path] && !(opts && opts.upsert)) {
              return { data: null, error: { message: 'File already exists' } };
            }
            STORAGE[path] = { size: (file && file.size) || 0, created_at: new Date().toISOString() };
            return { data: { path }, error: null };
          },
          async remove(paths) {
            paths.forEach((p) => { delete STORAGE[p]; });
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
          async createSignedUrl(path) {
            if (!STORAGE[path]) return { data: null, error: { message: 'Object not found' } };
            // A real, loadable URL (rather than a fake "mock://" scheme) so
            // background-image / window.open calls in the app don't throw
            // network errors that would pollute the "zero console errors"
            // check for reasons that have nothing to do with the app's code.
            const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
            return { data: { signedUrl: TRANSPARENT_PNG }, error: null };
          },
        };
      },
    };
  }

  // ---- auth -----------------------------------------------------------
  function makeAuth() {
    let session = null;
    const listeners = [];
    const fire = (event) => listeners.forEach((cb) => cb(event, session));

    return {
      async signInWithPassword({ email, password }) {
        const u = AUTH_USERS.find((a) => a.email === email && a.password === password);
        if (!u) return { data: {}, error: { message: 'Invalid login credentials' } };
        const token = 'token-' + u.id + '-' + Date.now();
        session = { access_token: token, user: { id: u.id, email: u.email } };
        TOKEN_TO_USER[token] = u;
        fire('SIGNED_IN');
        return { data: { session }, error: null };
      },
      async signOut() {
        session = null;
        fire('SIGNED_OUT');
        return { error: null };
      },
      async getSession() {
        return { data: { session } };
      },
      onAuthStateChange(cb) {
        listeners.push(cb);
        setTimeout(() => cb('INITIAL_SESSION', session), 0);
        return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
      },
    };
  }

  window.supabaseClient = {
    from: makeBuilder,
    storage: makeStorage(),
    auth: makeAuth(),
  };
  window.BLOCKHEADS_EDGE_FN_URL = 'mock://edge-function/create-user';

  // ---- mocked create-user Edge Function, reached via window.fetch --------
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    if (url !== window.BLOCKHEADS_EDGE_FN_URL) return realFetch(url, opts);

    const body = JSON.parse((opts && opts.body) || '{}');
    const caller = TOKEN_TO_USER[body.callerToken];
    const callerProfile = caller && DB.profiles.find((p) => p.id === caller.id);
    const respond = (status, json) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });

    if (!callerProfile) return respond(401, { error: 'Not signed in' });

    if (body.action === 'approve') {
      if (!['admin', 'superuser'].includes(callerProfile.role)) return respond(403, { error: 'Not authorized' });
      const req = DB.membership_requests.find((r) => r.id === body.requestId);
      if (!req) return respond(404, { error: 'Request not found' });
      const newId = uid();
      DB.profiles.push({ id: newId, email: req.email, display_name: req.name, role: body.role || 'member', approved_at: new Date().toISOString(), created_at: new Date().toISOString() });
      AUTH_USERS.push({ id: newId, email: req.email, password: req.password });
      DB.membership_requests = DB.membership_requests.filter((r) => r.id !== req.id);
      return respond(200, { ok: true });
    }

    if (body.action === 'createAdmin') {
      if (callerProfile.role !== 'superuser') return respond(403, { error: 'Not authorized' });
      const newId = uid();
      DB.profiles.push({ id: newId, email: body.email, display_name: body.name, role: 'admin', approved_at: new Date().toISOString(), created_at: new Date().toISOString() });
      AUTH_USERS.push({ id: newId, email: body.email, password: body.password });
      return respond(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (callerProfile.role !== 'superuser') return respond(403, { error: 'Not authorized' });
      DB.profiles = DB.profiles.filter((p) => p.id !== body.userId);
      return respond(200, { ok: true });
    }

    return respond(400, { error: 'Unknown action' });
  };

  window.__BLOCKHEADS_TEST_DB__ = DB;
  window.__mockStorageKeys = () => Object.keys(STORAGE);
  window.__mockStorageSize = (k) => STORAGE[k] && STORAGE[k].size;
})();
