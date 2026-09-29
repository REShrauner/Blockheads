// Notices board at the top of the calendar page. Everyone signed in can read
// notices; only admins and the superuser can add, edit, or delete them.
// A notice with a "show until" date disappears for members after that day;
// admins still see it (marked Expired) so they can edit or delete it.
window.BlockheadsNotices = (function () {
  const B = window.Blockheads;

  const panel = document.getElementById('notices-panel');
  const list = document.getElementById('notices-list');
  const emptyMsg = document.getElementById('notices-empty');
  const addButton = document.getElementById('add-notice-button');

  const dialog = document.getElementById('notice-form-dialog');
  const form = document.getElementById('notice-form');
  const formTitle = document.getElementById('notice-form-title');
  const fieldTitle = document.getElementById('notice-title');
  const fieldBody = document.getElementById('notice-body');
  const fieldUntil = document.getElementById('notice-until');
  const deleteButton = document.getElementById('delete-notice-button');
  const cancelButton = document.getElementById('cancel-notice-button');

  let editingId = null;

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isExpired(n) {
    return !!n.show_until && n.show_until < todayStr();
  }

  function renderNotices() {
    const admin = B.isAdmin();
    addButton.hidden = !admin;
    const visible = B.state.notices.filter((n) => admin || !isExpired(n));

    list.innerHTML = '';
    // Members with nothing to read don't need an empty box taking up space.
    panel.hidden = !admin && visible.length === 0;
    emptyMsg.hidden = visible.length > 0;

    visible.forEach((n) => {
      const item = document.createElement('article');
      item.className = 'notice' + (isExpired(n) ? ' expired' : '');
      const posted = new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const byline = [n.created_by_name, posted].filter(Boolean).join(' · ');
      const until = n.show_until
        ? (isExpired(n) ? ' · <strong>Expired</strong>' : ` · until ${B.formatDate(n.show_until)}`)
        : '';
      item.innerHTML = `
        <div class="notice-head">
          <h3>${B.escapeHtml(n.title)}</h3>
          ${admin ? '<button type="button" class="small-button notice-edit">Edit</button>' : ''}
        </div>
        ${n.body ? `<p class="notice-body">${B.escapeHtml(n.body)}</p>` : ''}
        <p class="hint small">${B.escapeHtml(byline)}${admin ? until : ''}</p>
      `;
      if (admin) item.querySelector('.notice-edit').addEventListener('click', () => openForm(n.id));
      list.appendChild(item);
    });
  }

  function openForm(id) {
    editingId = id || null;
    form.reset();
    if (editingId) {
      const n = B.state.notices.find((x) => x.id === editingId);
      if (!n) return;
      formTitle.textContent = 'Edit notice';
      deleteButton.hidden = false;
      fieldTitle.value = n.title;
      fieldBody.value = n.body || '';
      fieldUntil.value = n.show_until || '';
    } else {
      formTitle.textContent = 'Add notice';
      deleteButton.hidden = true;
    }
    dialog.showModal();
  }

  addButton.addEventListener('click', () => openForm(null));
  cancelButton.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: fieldTitle.value.trim(),
      body: fieldBody.value.trim() || null,
      show_until: fieldUntil.value || null,
    };
    if (!payload.title) { alert('A title is required.'); return; }

    const query = editingId
      ? window.supabaseClient.from('notices').update(payload).eq('id', editingId)
      : window.supabaseClient.from('notices').insert({
          ...payload,
          created_by: B.state.user.id,
          created_by_name: B.state.user.displayName || B.state.user.email,
        });
    const { error } = await query;
    if (error) { alert('Could not save notice: ' + error.message); return; }
    dialog.close();
    await B.refreshCore();
  });

  deleteButton.addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Delete this notice? This can\'t be undone.')) return;
    const { error } = await window.supabaseClient.from('notices').delete().eq('id', editingId);
    if (error) { alert('Could not delete notice: ' + error.message); return; }
    dialog.close();
    await B.refreshCore();
  });

  return { renderNotices };
})();
