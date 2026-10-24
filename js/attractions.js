// Coming Attractions: a read-only page for everyone signed in, plus the
// admin-side tools (enter / edit attractions, and a private notes list for
// ideas about possible attractions). Speaker and date are optional. Only
// admins and the superuser can write; the RLS policies in schema.sql back
// that up server-side, and the notes are readable by admins only.
window.BlockheadsAttractions = (function () {
  const B = window.Blockheads;

  // Public page
  const listEl = document.getElementById('attractions-list');
  const emptyEl = document.getElementById('attractions-empty');
  const addButton = document.getElementById('add-attraction-button');

  // Admin-only Notes page
  const notesList = document.getElementById('attraction-notes-list');
  const notesEmpty = document.getElementById('attraction-notes-empty');
  const addNoteButton = document.getElementById('add-attraction-note-button');

  // Attraction dialog
  const dialog = document.getElementById('attraction-form-dialog');
  const form = document.getElementById('attraction-form');
  const formTitle = document.getElementById('attraction-form-title');
  const fieldTitle = document.getElementById('attraction-title');
  const fieldSpeaker = document.getElementById('attraction-speaker');
  const fieldDate = document.getElementById('attraction-date');
  const deleteButton = document.getElementById('delete-attraction-button');
  const cancelButton = document.getElementById('cancel-attraction-button');

  // Note dialog
  const noteDialog = document.getElementById('attraction-note-dialog');
  const noteForm = document.getElementById('attraction-note-form');
  const noteFormTitle = document.getElementById('attraction-note-form-title');
  const noteField = document.getElementById('attraction-note-body');
  const noteDeleteButton = document.getElementById('delete-attraction-note-button');
  const noteCancelButton = document.getElementById('cancel-attraction-note-button');

  let editingId = null;
  let editingNoteId = null;

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isPast(a) {
    return !!a.attraction_date && a.attraction_date < todayStr();
  }

  // Upcoming dated attractions first (soonest at the top), then ones with no
  // date yet, then past ones.
  function sortedAttractions() {
    const rank = (a) => (isPast(a) ? 2 : (a.attraction_date ? 0 : 1));
    return [...B.state.attractions].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      if (a.attraction_date && b.attraction_date && a.attraction_date !== b.attraction_date) {
        return a.attraction_date < b.attraction_date ? -1 : 1;
      }
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }

  function renderPublic() {
    const admin = B.isAdmin();
    addButton.hidden = !admin;
    // Members only see what's still coming up; admins also see past ones
    // (dimmed) so they can edit or clear them out.
    const visible = sortedAttractions().filter((a) => admin || !isPast(a));
    listEl.innerHTML = '';
    emptyEl.hidden = visible.length > 0;
    listEl.hidden = visible.length === 0;
    visible.forEach((a) => {
      // Same card look as the notices board.
      const item = document.createElement('article');
      item.className = 'notice' + (isPast(a) ? ' expired' : '');
      const date = a.attraction_date ? B.formatDate(a.attraction_date) : 'Date to be announced';
      item.innerHTML = `
        <div class="notice-head">
          <h3>${B.escapeHtml(a.title)}${isPast(a) ? '<span class="past-tag">Past</span>' : ''}</h3>
          ${admin ? '<button type="button" class="small-button notice-edit">Edit</button>' : ''}
        </div>
        ${a.speaker ? `<p class="notice-body">${B.escapeHtml(a.speaker)}</p>` : ''}
        <p class="hint small">${B.escapeHtml(date)}</p>
      `;
      if (admin) item.querySelector('.notice-edit').addEventListener('click', () => openForm(a.id));
      listEl.appendChild(item);
    });
  }

  function renderAdminBlocks() {
    const notes = B.state.attractionNotes;
    notesList.innerHTML = '';
    notesEmpty.hidden = notes.length > 0;
    notesList.hidden = notes.length === 0;
    notes.forEach((n) => {
      const posted = new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const byline = [n.created_by_name, posted].filter(Boolean).join(' · ');
      const row = document.createElement('div');
      row.className = 'attraction-note-row';
      row.innerHTML = `
        <div class="attraction-note-main">
          <p class="attraction-note-body">${B.escapeHtml(n.body)}</p>
          <span class="hint small">${B.escapeHtml(byline)}</span>
        </div>
        <button type="button" class="small-button attraction-note-edit">Edit</button>
      `;
      row.querySelector('.attraction-note-edit').addEventListener('click', () => openNoteForm(n.id));
      notesList.appendChild(row);
    });
  }

  function render() {
    renderPublic();
    if (B.isAdmin()) renderAdminBlocks();
  }

  // ---- attraction dialog --------------------------------------------------
  function openForm(id) {
    editingId = id || null;
    form.reset();
    if (editingId) {
      const a = B.state.attractions.find((x) => x.id === editingId);
      if (!a) return;
      formTitle.textContent = 'Edit attraction';
      deleteButton.hidden = false;
      fieldTitle.value = a.title;
      fieldSpeaker.value = a.speaker || '';
      fieldDate.value = a.attraction_date || '';
    } else {
      formTitle.textContent = 'Enter attraction';
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
      speaker: fieldSpeaker.value.trim() || null,
      attraction_date: fieldDate.value || null,
    };
    if (!payload.title) { alert('The attraction is required.'); return; }

    const query = editingId
      ? window.supabaseClient.from('attractions').update(payload).eq('id', editingId)
      : window.supabaseClient.from('attractions').insert({
          ...payload,
          created_by: B.state.user.id,
          created_by_name: B.state.user.displayName || B.state.user.email,
        });
    const { error } = await query;
    if (error) { alert('Could not save attraction: ' + error.message); return; }
    dialog.close();
    await B.refreshCore();
  });

  deleteButton.addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Delete this attraction? This can\'t be undone.')) return;
    const { error } = await window.supabaseClient.from('attractions').delete().eq('id', editingId);
    if (error) { alert('Could not delete attraction: ' + error.message); return; }
    dialog.close();
    await B.refreshCore();
  });

  // ---- notes dialog -------------------------------------------------------
  function openNoteForm(id) {
    editingNoteId = id || null;
    noteForm.reset();
    if (editingNoteId) {
      const n = B.state.attractionNotes.find((x) => x.id === editingNoteId);
      if (!n) return;
      noteFormTitle.textContent = 'Edit note';
      noteDeleteButton.hidden = false;
      noteField.value = n.body;
    } else {
      noteFormTitle.textContent = 'Add note';
      noteDeleteButton.hidden = true;
    }
    noteDialog.showModal();
  }

  addNoteButton.addEventListener('click', () => openNoteForm(null));
  noteCancelButton.addEventListener('click', () => noteDialog.close());

  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = noteField.value.trim();
    if (!body) { alert('Please type a note first.'); return; }

    const query = editingNoteId
      ? window.supabaseClient.from('attraction_notes').update({ body }).eq('id', editingNoteId)
      : window.supabaseClient.from('attraction_notes').insert({
          body,
          created_by: B.state.user.id,
          created_by_name: B.state.user.displayName || B.state.user.email,
        });
    const { error } = await query;
    if (error) { alert('Could not save note: ' + error.message); return; }
    noteDialog.close();
    await B.refreshCore();
  });

  noteDeleteButton.addEventListener('click', async () => {
    if (!editingNoteId) return;
    if (!confirm('Delete this note? This can\'t be undone.')) return;
    const { error } = await window.supabaseClient.from('attraction_notes').delete().eq('id', editingNoteId);
    if (error) { alert('Could not delete note: ' + error.message); return; }
    noteDialog.close();
    await B.refreshCore();
  });

  return { render };
})();
