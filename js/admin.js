// Pending membership requests, the member directory, and the add-admin
// dialog. Everything here is only reachable by an admin or the superuser -
// app.js hides the Members nav link otherwise, and the RLS policies in
// schema.sql back that up server-side.
window.BlockheadsAdmin = (function () {
  const B = window.Blockheads;

  const pendingList = document.getElementById('pending-requests-list');
  const pendingEmpty = document.getElementById('pending-empty');
  const pendingCount = document.getElementById('pending-count');
  const membersList = document.getElementById('members-list');
  const memberCount = document.getElementById('member-count');
  const addAdminButton = document.getElementById('add-admin-button');

  const dialog = document.getElementById('admin-form-dialog');
  const form = document.getElementById('admin-form');
  const fieldName = document.getElementById('admin-name');
  const fieldEmail = document.getElementById('admin-email');
  const fieldPassword = document.getElementById('admin-password');
  const formError = document.getElementById('admin-form-error');
  const cancelButton = document.getElementById('cancel-admin-button');

  async function loadMembersAndRequests() {
    const [{ data: requests, error: reqError }, { data: profiles, error: profError }] = await Promise.all([
      window.supabaseClient.from('membership_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: true }),
      window.supabaseClient.from('profiles').select('*').order('display_name', { ascending: true }),
    ]);
    if (reqError) alert('Could not load requests: ' + reqError.message);
    if (profError) alert('Could not load members: ' + profError.message);
    B.state.pendingRequests = requests || [];
    B.state.members = profiles || [];
  }

  function initials(name) {
    return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  function renderAdmin() {
    addAdminButton.hidden = !B.isSuperuser();

    pendingCount.textContent = String(B.state.pendingRequests.length);
    pendingEmpty.hidden = B.state.pendingRequests.length > 0;
    pendingList.innerHTML = '';

    B.state.pendingRequests.forEach((req) => {
      const row = document.createElement('div');
      row.className = 'request-row';
      row.innerHTML = `
        <div class="avatar">${B.escapeHtml(initials(req.name))}</div>
        <div class="request-meta">
          <strong>${B.escapeHtml(req.name)}</strong>
          <span class="hint small">${B.escapeHtml(req.email)} &middot; requested ${new Date(req.requested_at).toLocaleDateString()}</span>
          ${req.note ? `<span class="hint small">"${B.escapeHtml(req.note)}"</span>` : ''}
        </div>
        <button type="button" class="deny-button danger">Deny</button>
        <button type="button" class="approve-button primary">Approve</button>
      `;
      row.querySelector('.approve-button').addEventListener('click', (e) => approveRequest(req, e.target));
      row.querySelector('.deny-button').addEventListener('click', () => denyRequest(req.id));
      pendingList.appendChild(row);
    });

    memberCount.textContent = `${B.state.members.length} ${B.state.members.length === 1 ? 'person' : 'people'}`;
    membersList.innerHTML = '';
    B.state.members.forEach((member) => {
      const row = document.createElement('div');
      row.className = 'member-row';
      const canRemove = B.isSuperuser() && member.id !== B.state.user.id;
      row.innerHTML = `
        <span>${B.escapeHtml(member.display_name || '—')}</span>
        <span class="hint">${B.escapeHtml(member.email)}</span>
        <span class="role-pill ${member.role}">${member.role}</span>
        <span class="hint">${new Date(member.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
        <span>${canRemove ? '<button type="button" class="remove-member-button danger">Remove</button>' : ''}</span>
      `;
      const removeBtn = row.querySelector('.remove-member-button');
      if (removeBtn) removeBtn.addEventListener('click', () => removeMember(member));
      membersList.appendChild(row);
    });
  }

  async function approveRequest(req, buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Approving…';
    try {
      await B.callEdgeFunction({ action: 'approve', requestId: req.id, role: 'member' });
      await B.refreshCore();
    } catch (err) {
      alert('Could not approve: ' + err.message);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Approve';
    }
  }

  async function denyRequest(requestId) {
    if (!confirm('Deny this request? It will be removed.')) return;
    const { error } = await window.supabaseClient.from('membership_requests').delete().eq('id', requestId);
    if (error) { alert('Could not deny: ' + error.message); return; }
    await B.refreshCore();
  }

  async function removeMember(member) {
    if (!confirm(`Remove ${member.display_name || member.email}'s account? This can't be undone.`)) return;
    try {
      await B.callEdgeFunction({ action: 'delete', userId: member.id });
      await B.refreshCore();
    } catch (err) {
      alert('Could not remove: ' + err.message);
    }
  }

  addAdminButton.addEventListener('click', () => {
    form.reset();
    formError.hidden = true;
    dialog.showModal();
  });
  cancelButton.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await B.callEdgeFunction({
        action: 'createAdmin',
        name: fieldName.value.trim(),
        email: fieldEmail.value.trim(),
        password: fieldPassword.value,
      });
      dialog.close();
      await B.refreshCore();
    } catch (err) {
      formError.textContent = err.message;
      formError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  return { loadMembersAndRequests, renderAdmin };
})();
