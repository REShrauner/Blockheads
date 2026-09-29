// Shared state, navigation, and data loading. calendar.js / projects.js /
// admin.js hang their render functions off this same window.Blockheads
// object; auth.js calls Blockheads.onSignedIn() once someone signs in.
window.Blockheads = (function () {
  const state = {
    user: null,        // { id, email, role }
    projects: [],
    events: [],
    notices: [],
    members: [],
    pendingRequests: [],
    currentProjectId: null,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(), // 0-11
  };

  const els = {
    appView: document.getElementById('app-view'),
    signInView: document.getElementById('sign-in-view'),
    userEmailLabel: document.getElementById('user-email-label'),
    userRoleBadge: document.getElementById('user-role-badge'),
    navCalendar: document.getElementById('nav-calendar'),
    navProjects: document.getElementById('nav-projects'),
    navMembers: document.getElementById('nav-members'),
    sections: {
      calendar: document.getElementById('calendar-section'),
      projects: document.getElementById('projects-section'),
      projectDetail: document.getElementById('project-detail-section'),
      members: document.getElementById('members-section'),
    },
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    // Parse as a local calendar date, not a UTC instant, so "2026-10-03"
    // always reads as Oct 3 regardless of the viewer's timezone.
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function isAdmin() {
    return state.user && (state.user.role === 'admin' || state.user.role === 'superuser');
  }
  function isSuperuser() {
    return state.user && state.user.role === 'superuser';
  }

  async function getAccessToken() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    return session ? session.access_token : null;
  }

  // Calls the create-user Edge Function (approve / delete),
  // automatically attaching the signed-in caller's access token so the
  // function can verify who's asking, server-side.
  async function callEdgeFunction(body) {
    const callerToken = await getAccessToken();
    const resp = await fetch(window.BLOCKHEADS_EDGE_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, callerToken }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || result.error) {
      // Supabase's own gateway errors (function not deployed, JWT check on)
      // come back as { message } rather than our { error }, so show those too.
      throw new Error(result.error || result.message || result.msg || `Something went wrong (HTTP ${resp.status})`);
    }
    return result;
  }

  function showSection(name) {
    Object.entries(els.sections).forEach(([key, el]) => { el.hidden = key !== name; });
    [els.navCalendar, els.navProjects].forEach((a) => a.classList.remove('active'));
    if (name === 'calendar') els.navCalendar.classList.add('active');
    if (name === 'projects' || name === 'projectDetail') els.navProjects.classList.add('active');
    if (name === 'members') els.navMembers.classList.add('active');
    window.location.hash = name === 'projectDetail' ? 'projects' : name;
  }

  els.navCalendar.addEventListener('click', (e) => { e.preventDefault(); showSection('calendar'); });
  els.navProjects.addEventListener('click', (e) => {
    e.preventDefault();
    state.currentProjectId = null;
    showSection('projects');
    window.BlockheadsProjects.renderProjectsGrid();
  });
  els.navMembers.addEventListener('click', (e) => { e.preventDefault(); showSection('members'); });

  async function loadCore() {
    const [
      { data: projects, error: projectsError },
      { data: events, error: eventsError },
      { data: notices, error: noticesError },
    ] = await Promise.all([
      window.supabaseClient.from('projects').select('*').order('name', { ascending: true }),
      window.supabaseClient.from('calendar_events').select('*').order('event_date', { ascending: true }),
      window.supabaseClient.from('notices').select('*').order('created_at', { ascending: false }),
    ]);
    if (projectsError) { alert('Could not load projects: ' + projectsError.message); }
    if (eventsError) { alert('Could not load calendar: ' + eventsError.message); }
    state.projects = projects || [];
    state.events = events || [];
    // Notices are optional - if the table hasn't been created yet, just show none.
    if (noticesError) console.warn('Could not load notices: ' + noticesError.message);
    state.notices = notices || [];

    if (isAdmin()) {
      await window.BlockheadsAdmin.loadMembersAndRequests();
    }
  }

  async function refreshCore() {
    await loadCore();
    window.BlockheadsNotices.renderNotices();
    window.BlockheadsCalendar.renderCalendar();
    window.BlockheadsProjects.renderProjectsGrid();
    if (isAdmin()) window.BlockheadsAdmin.renderAdmin();
  }

  async function onSignedIn(sessionUser) {
    const { data: profile, error: profileError } = await window.supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', sessionUser.id)
      .single();
    if (profileError || !profile) {
      alert('Your account is signed in but has no profile record - contact the superuser.');
      await window.supabaseClient.auth.signOut();
      return;
    }
    state.user = { id: profile.id, email: profile.email, role: profile.role, displayName: profile.display_name };

    els.userEmailLabel.textContent = state.user.email;
    els.userRoleBadge.textContent = state.user.role.charAt(0).toUpperCase() + state.user.role.slice(1);
    els.navMembers.hidden = !isAdmin();

    await loadCore();
    window.BlockheadsNotices.renderNotices();
    window.BlockheadsCalendar.renderCalendar();
    window.BlockheadsProjects.renderProjectsGrid();
    if (isAdmin()) window.BlockheadsAdmin.renderAdmin();

    showSection('calendar');
  }

  return {
    state,
    els,
    escapeHtml,
    formatDate,
    isAdmin,
    isSuperuser,
    getAccessToken,
    callEdgeFunction,
    showSection,
    loadCore,
    refreshCore,
    onSignedIn,
  };
})();
