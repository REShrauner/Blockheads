// Scheduled Meetings list (three months at a time, arrows move one month),
// and the add/edit meeting dialog.
window.BlockheadsCalendar = (function () {
  const B = window.Blockheads;

  const meetingList = document.getElementById('meeting-list');
  const addEventButton = document.getElementById('add-event-button');
  const prevMonthButton = document.getElementById('calendar-prev-month');
  const nextMonthButton = document.getElementById('calendar-next-month');

  const dialog = document.getElementById('event-form-dialog');
  const form = document.getElementById('event-form');
  const formTitle = document.getElementById('event-form-title');
  const fieldDate = document.getElementById('event-date');
  const fieldStart = document.getElementById('event-start-time');
  const fieldEnd = document.getElementById('event-end-time');
  const fieldTitle = document.getElementById('event-title');
  const fieldProject = document.getElementById('event-project');
  const fieldNotes = document.getElementById('event-notes');
  const fieldPhoto = document.getElementById('event-photo-input');
  const photoPreview = document.getElementById('event-photo-preview');
  const photoRemoveButton = document.getElementById('event-photo-remove');
  const BUCKET = 'project-files';
  let removePhoto = false;

  // Signed URLs for photos, cached for ~50 minutes so month-to-month
  // navigation doesn't re-request them every time.
  const urlCache = new Map();
  async function photoUrl(path) {
    if (!path) return null;
    const hit = urlCache.get(path);
    if (hit && hit.expires > Date.now()) return hit.url;
    const { data } = await window.supabaseClient.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (!data) return null;
    urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }

  // Meeting photo first, then the linked project's photo, else none.
  function photoPathFor(ev) {
    if (ev.photo_path) return ev.photo_path;
    const project = ev.project_id && B.state.projects.find((p) => p.id === ev.project_id);
    return project && project.icon_path ? project.icon_path : null;
  }

  async function setThumb(el, path) {
    const url = await photoUrl(path);
    el.style.backgroundImage = url ? `url('${url}')` : '';
  }
  const deleteButton = document.getElementById('delete-event-button');
  const cancelButton = document.getElementById('cancel-event-button');

  let editingId = null;

  function toDateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Sort key: date, then start time (all-day events first).
  function eventSortKey(e) {
    return `${e.event_date} ${e.start_time ? e.start_time.slice(0, 5) : '00:00'}`;
  }

  // "14:30:00" -> "2:30 PM"
  function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  // "10:00 AM – 2:00 PM", "10:00 AM", or "" for all-day.
  function formatTimeRange(ev) {
    if (!ev.start_time) return '';
    return ev.end_time
      ? `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`
      : formatTime(ev.start_time);
  }

  // "2026-10-03" -> "Saturday, October 3, 2026" (local date, no timezone shift)
  function longDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  const MONTHS_SHOWN = 3;

  function monthName(y, m) {
    return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long' });
  }

  function meetingCard(ev, today) {
    const past = ev.event_date < today;
    const project = ev.project_id && B.state.projects.find((p) => p.id === ev.project_id);
    const when = formatTimeRange(ev);
    const card = document.createElement('article');
    card.className = 'meeting-card' + (past ? ' past' : '');
    card.innerHTML = `
      <div class="meeting-thumb"></div>
      <div class="meeting-info">
        <div class="meeting-date">${B.escapeHtml(longDate(ev.event_date))}${past ? '<span class="past-tag">Past</span>' : ''}</div>
        ${when ? `<div class="meeting-time">${B.escapeHtml(when)}</div>` : ''}
        <div class="meeting-title">${B.escapeHtml(ev.title)}</div>
        ${project ? `<button type="button" class="meeting-project">Project: ${B.escapeHtml(project.name)}</button>` : ''}
        ${ev.notes ? `<p class="meeting-notes">${B.escapeHtml(ev.notes)}</p>` : ''}
      </div>
      ${B.isAdmin() ? '<button type="button" class="small-button meeting-edit">Edit</button>' : ''}
    `;
    const thumbPath = photoPathFor(ev);
    if (thumbPath) setThumb(card.querySelector('.meeting-thumb'), thumbPath);
    const projBtn = card.querySelector('.meeting-project');
    if (projBtn) projBtn.addEventListener('click', () => window.BlockheadsProjects.openProjectDetail(project.id));
    const editBtn = card.querySelector('.meeting-edit');
    if (editBtn) editBtn.addEventListener('click', () => openForm(ev.id));
    return card;
  }

  // Shows three months at a time, starting with B.state.calendarMonth.
  // The arrows move the window one month per click.
  function renderCalendar() {
    const y = B.state.calendarYear;
    const m = B.state.calendarMonth;
    addEventButton.hidden = !B.isAdmin();
    const today = todayStr();

    meetingList.innerHTML = '';
    for (let i = 0; i < MONTHS_SHOWN; i++) {
      const d = new Date(y, m + i, 1);
      const my = d.getFullYear(), mm = d.getMonth();
      const prefix = toDateStr(my, mm, 1).slice(0, 7);
      const monthEvents = B.state.events
        .filter((e) => e.event_date.startsWith(prefix))
        .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));

      const group = document.createElement('section');
      group.className = 'month-group';

      if (monthEvents.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'meeting-list-empty hint';
        empty.textContent = `No meeting scheduled for ${monthName(my, mm)}.`;
        group.appendChild(empty);
      } else {
        monthEvents.forEach((ev) => group.appendChild(meetingCard(ev, today)));
      }
      meetingList.appendChild(group);
    }
  }

  function populateProjectOptions() {
    fieldProject.innerHTML = '<option value="">(none)</option>';
    B.state.projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      fieldProject.appendChild(opt);
    });
  }

  function openForm(id, presetDate) {
    editingId = id || null;
    form.reset();
    populateProjectOptions();
    removePhoto = false;
    photoPreview.style.backgroundImage = '';
    photoRemoveButton.hidden = true;

    if (editingId) {
      const ev = B.state.events.find((e) => e.id === editingId);
      if (!ev) return;
      formTitle.textContent = 'Edit meeting';
      deleteButton.hidden = false;
      fieldDate.value = ev.event_date;
      fieldStart.value = ev.start_time ? ev.start_time.slice(0, 5) : '';
      fieldEnd.value = ev.end_time ? ev.end_time.slice(0, 5) : '';
      fieldTitle.value = ev.title;
      fieldProject.value = ev.project_id || '';
      fieldNotes.value = ev.notes || '';
      if (ev.photo_path) {
        setThumb(photoPreview, ev.photo_path);
        photoRemoveButton.hidden = false;
      }
    } else {
      formTitle.textContent = 'Add meeting';
      deleteButton.hidden = true;
      fieldDate.value = presetDate || '';
    }
    dialog.showModal();
  }

  fieldPhoto.addEventListener('change', () => {
    const file = fieldPhoto.files[0];
    if (!file) return;
    removePhoto = false;
    photoRemoveButton.hidden = false;
    // HEIC can't be previewed in most browsers; show the gradient until saved.
    const canPreview = /^image\/(jpeg|png|webp|gif)$/i.test(file.type);
    photoPreview.style.backgroundImage = canPreview ? `url('${URL.createObjectURL(file)}')` : '';
  });

  photoRemoveButton.addEventListener('click', () => {
    fieldPhoto.value = '';
    removePhoto = true;
    photoPreview.style.backgroundImage = '';
    photoRemoveButton.hidden = true;
  });

  addEventButton.addEventListener('click', () => openForm(null));
  cancelButton.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      event_date: fieldDate.value,
      start_time: fieldStart.value || null,
      end_time: fieldEnd.value || null,
      title: fieldTitle.value.trim(),
      project_id: fieldProject.value || null,
      notes: fieldNotes.value.trim() || null,
    };
    if (!payload.event_date || !payload.title) {
      alert('Date and title are required.');
      return;
    }
    if (payload.end_time && !payload.start_time) {
      alert('Please add a start time too (or clear the end time).');
      return;
    }
    if (payload.start_time && payload.end_time && payload.end_time <= payload.start_time) {
      alert('End time must be after the start time.');
      return;
    }

    if (removePhoto) payload.photo_path = null;

    let eventId = editingId;
    if (editingId) {
      const { error } = await window.supabaseClient.from('calendar_events').update(payload).eq('id', editingId);
      if (error) { alert('Could not save meeting: ' + error.message); return; }
    } else {
      const { data: inserted, error } = await window.supabaseClient
        .from('calendar_events')
        .insert({ ...payload, created_by: B.state.user.id })
        .select()
        .single();
      if (error) { alert('Could not save meeting: ' + error.message); return; }
      eventId = inserted && inserted.id;
    }

    if (fieldPhoto.files.length && eventId) {
      try {
        const file = await window.BlockheadsProjects.prepareIconPhoto(fieldPhoto.files[0]);
        const path = `meetings/${eventId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await window.supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { error: updateError } = await window.supabaseClient.from('calendar_events').update({ photo_path: path }).eq('id', eventId);
        if (updateError) throw updateError;
      } catch (err) {
        alert('Meeting saved, but the photo could not be added: ' + err.message);
      }
    }

    dialog.close();
    await B.refreshCore();
  });

  deleteButton.addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Delete this meeting? This can\'t be undone.')) return;
    const { error } = await window.supabaseClient.from('calendar_events').delete().eq('id', editingId);
    if (error) { alert('Could not delete meeting: ' + error.message); return; }
    dialog.close();
    await B.refreshCore();
  });

  prevMonthButton.addEventListener('click', () => {
    B.state.calendarMonth -= 1;
    if (B.state.calendarMonth < 0) { B.state.calendarMonth = 11; B.state.calendarYear -= 1; }
    renderCalendar();
  });
  nextMonthButton.addEventListener('click', () => {
    B.state.calendarMonth += 1;
    if (B.state.calendarMonth > 11) { B.state.calendarMonth = 0; B.state.calendarYear += 1; }
    renderCalendar();
  });

  return { renderCalendar };
})();
