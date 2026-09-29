// Calendar rendering, month navigation, and the add/edit meeting dialog.
window.BlockheadsCalendar = (function () {
  const B = window.Blockheads;

  const monthLabel = document.getElementById('calendar-month-label');
  const grid = document.getElementById('calendar-grid');
  const upcomingList = document.getElementById('upcoming-list');
  const upcomingEmpty = document.getElementById('upcoming-empty');
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
  const deleteButton = document.getElementById('delete-event-button');
  const cancelButton = document.getElementById('cancel-event-button');

  let editingId = null;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function toDateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Sort key: date, then start time (all-day events first).
  function eventSortKey(e) {
    return `${e.event_date} ${e.start_time ? e.start_time.slice(0, 5) : '00:00'}`;
  }

  function eventsOn(dateStr) {
    return B.state.events
      .filter((e) => e.event_date === dateStr)
      .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
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

  function renderCalendar() {
    const y = B.state.calendarYear;
    const m = B.state.calendarMonth;
    monthLabel.textContent = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    addEventButton.hidden = !B.isAdmin();

    grid.innerHTML = '';
    DOW.forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'calendar-dow';
      cell.textContent = d;
      grid.appendChild(cell);
    });

    const firstOfMonth = new Date(y, m, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sun
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < startWeekday; i++) {
      const filler = document.createElement('div');
      filler.className = 'calendar-day empty';
      grid.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = toDateStr(y, m, day);
      const dayEvents = eventsOn(dateStr);
      const cell = document.createElement('div');
      cell.className = 'calendar-day' + (dayEvents.length ? ' has-event' : '');

      const dayNum = document.createElement('span');
      dayNum.textContent = String(day);
      cell.appendChild(dayNum);

      dayEvents.forEach((ev) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'event-chip';
        const when = formatTimeRange(ev);
        chip.textContent = ev.start_time ? `${formatTime(ev.start_time)} ${ev.title}` : ev.title;
        const tip = when ? `${ev.title} (${when})` : ev.title;
        chip.title = B.isAdmin() ? `${tip} - click to edit` : tip;
        chip.addEventListener('click', () => {
          if (B.isAdmin()) {
            openForm(ev.id);
          } else if (ev.project_id) {
            window.BlockheadsProjects.openProjectDetail(ev.project_id);
          }
        });
        cell.appendChild(chip);
      });

      if (B.isAdmin() && dayEvents.length === 0) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => openForm(null, dateStr));
      }

      grid.appendChild(cell);
    }

    renderUpcoming();
  }

  function renderUpcoming() {
    const todayStr = toDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const upcoming = B.state.events
      .filter((e) => e.event_date >= todayStr)
      .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)))
      .slice(0, 5);

    upcomingList.innerHTML = '';
    upcomingEmpty.hidden = upcoming.length > 0;

    upcoming.forEach((ev) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'upcoming-item';
      item.innerHTML = `
        <div class="upcoming-thumb"></div>
        <div class="upcoming-meta">
          <span class="upcoming-date">${B.formatDate(ev.event_date)}${ev.start_time ? ' · ' + formatTimeRange(ev) : ''}</span>
          <span class="upcoming-title">${B.escapeHtml(ev.title)}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        if (ev.project_id) window.BlockheadsProjects.openProjectDetail(ev.project_id);
      });
      upcomingList.appendChild(item);
    });
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
    } else {
      formTitle.textContent = 'Add meeting';
      deleteButton.hidden = true;
      fieldDate.value = presetDate || '';
    }
    dialog.showModal();
  }

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

    const query = editingId
      ? window.supabaseClient.from('calendar_events').update(payload).eq('id', editingId)
      : window.supabaseClient.from('calendar_events').insert({ ...payload, created_by: B.state.user.id });

    const { error } = await query;
    if (error) { alert('Could not save meeting: ' + error.message); return; }

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
