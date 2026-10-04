// Projects grid, project detail (file list backed by Supabase Storage), and
// the add/edit project dialog. Editing and deleting are limited to admins and
// the superuser (buttons hidden for members; enforced by RLS in schema.sql).
window.BlockheadsProjects = (function () {
  const B = window.Blockheads;
  const BUCKET = 'project-files';

  const grid = document.getElementById('projects-grid');
  const gridEmpty = document.getElementById('projects-empty');
  const addProjectButton = document.getElementById('add-project-button');
  const backToProjects = document.getElementById('back-to-projects');

  const detailIcon = document.getElementById('project-detail-icon');
  const detailName = document.getElementById('project-detail-name');
  const detailDescription = document.getElementById('project-detail-description');
  const detailByline = document.getElementById('project-detail-byline');
  const detailAdminActions = document.getElementById('project-detail-admin-actions');
  const replaceIconButton = document.getElementById('replace-icon-button');
  const uploadFileButton = document.getElementById('upload-file-button');
  const iconFileInput = document.getElementById('icon-file-input');
  const attachmentFileInput = document.getElementById('attachment-file-input');
  const filesList = document.getElementById('project-files-list');
  const filesEmpty = document.getElementById('project-files-empty');

  const dialog = document.getElementById('project-form-dialog');
  const form = document.getElementById('project-form');
  const formTitle = document.getElementById('project-form-title');
  const fieldName = document.getElementById('project-name');
  const fieldDescription = document.getElementById('project-description');
  const fieldIcon = document.getElementById('project-icon-input');
  const fieldIconLabel = document.getElementById('project-icon-label');
  const deleteButton = document.getElementById('delete-project-button');
  const editProjectButton = document.getElementById('edit-project-button');
  const deleteProjectDetailButton = document.getElementById('delete-project-detail-button');
  const cancelButton = document.getElementById('cancel-project-button');

  let editingId = null;

  function fileTypeLabel(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return 'PDF';
    if (ext === 'doc' || ext === 'docx') return 'DOC';
    if (ext === 'txt' || ext === 'md') return 'TXT';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'IMG';
    return ext.slice(0, 3).toUpperCase() || 'FILE';
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function iconBackground(project) {
    if (!project.icon_path) return '';
    const { data } = await window.supabaseClient.storage.from(BUCKET).createSignedUrl(project.icon_path, 3600);
    return data ? `background-image: url('${data.signedUrl}')` : '';
  }

  function renderProjectsGrid() {
    addProjectButton.hidden = !B.isAdmin();
    grid.innerHTML = '';
    gridEmpty.hidden = B.state.projects.length > 0;

    B.state.projects.forEach((project) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'project-tile';
      tile.innerHTML = `
        <div class="project-icon" data-icon-for="${project.id}"></div>
        <div class="project-tile-body">
          <strong>${B.escapeHtml(project.name)}</strong>
          ${project.description ? `<span class="hint">${B.escapeHtml(project.description)}</span>` : ''}
        </div>
      `;
      tile.addEventListener('click', () => openProjectDetail(project.id));
      grid.appendChild(tile);

      if (project.icon_path) {
        iconBackground(project).then((style) => {
          if (style) tile.querySelector('.project-icon').setAttribute('style', style + '; background-size: cover; background-position: center;');
        });
      }
    });

    if (B.isAdmin()) {
      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'project-tile-add';
      addTile.textContent = '+ Add project';
      addTile.addEventListener('click', () => openForm(null));
      grid.appendChild(addTile);
    }
  }

  async function openProjectDetail(projectId) {
    const project = B.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    B.state.currentProjectId = projectId;
    B.showSection('projectDetail');

    detailName.textContent = project.name;
    detailDescription.textContent = project.description || '';
    detailDescription.hidden = !project.description;
    detailByline.textContent = project.created_by_name
      ? `Added by ${project.created_by_name} · ${new Date(project.created_at).toLocaleDateString()}`
      : `Added ${new Date(project.created_at).toLocaleDateString()}`;
    detailIcon.setAttribute('style', '');
    detailAdminActions.hidden = !B.isAdmin();

    if (project.icon_path) {
      const style = await iconBackground(project);
      if (style) detailIcon.setAttribute('style', style + '; background-size: cover; background-position: center;');
    }

    await renderFileList(projectId);
  }

  async function renderFileList(projectId) {
    filesList.innerHTML = '';
    const { data: files, error } = await window.supabaseClient.storage.from(BUCKET).list(`${projectId}/files`, {
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      filesEmpty.hidden = false;
      filesEmpty.textContent = 'Could not load files: ' + error.message;
      return;
    }
    const realFiles = (files || []).filter((f) => f.id); // Supabase returns a placeholder row for empty folders
    filesEmpty.hidden = realFiles.length > 0;
    filesEmpty.textContent = 'No files yet.';

    for (const file of realFiles) {
      const path = `${projectId}/files/${file.name}`;
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div class="file-icon">${fileTypeLabel(file.name)}</div>
        <div class="file-meta">
          <strong>${B.escapeHtml(file.name)}</strong>
          <span class="hint small">${formatBytes(file.metadata && file.metadata.size)} &middot; uploaded ${new Date(file.created_at).toLocaleDateString()}</span>
        </div>
        <button type="button" class="file-download">Download</button>
        ${B.isAdmin() ? '<button type="button" class="file-delete danger">Delete</button>' : ''}
      `;
      row.querySelector('.file-download').addEventListener('click', async () => {
        const { data, error: urlError } = await window.supabaseClient.storage.from(BUCKET).createSignedUrl(path, 60, { download: true });
        if (urlError) { alert('Could not download: ' + urlError.message); return; }
        window.open(data.signedUrl, '_blank');
      });
      const del = row.querySelector('.file-delete');
      if (del) {
        del.addEventListener('click', async () => {
          if (!confirm(`Delete "${file.name}"? This can't be undone.`)) return;
          const { error: deleteError } = await window.supabaseClient.storage.from(BUCKET).remove([path]);
          if (deleteError) { alert('Could not delete: ' + deleteError.message); return; }
          renderFileList(projectId);
        });
      }
      filesList.appendChild(row);
    }
  }

  uploadFileButton.addEventListener('click', () => attachmentFileInput.click());
  attachmentFileInput.addEventListener('change', async () => {
    const projectId = B.state.currentProjectId;
    if (!projectId || !attachmentFileInput.files.length) return;
    uploadFileButton.disabled = true;
    uploadFileButton.textContent = 'Uploading…';
    try {
      for (const file of Array.from(attachmentFileInput.files)) {
        const path = `${projectId}/files/${file.name}`;
        const { error } = await window.supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (error) throw error;
      }
      await renderFileList(projectId);
    } catch (err) {
      alert('Could not upload: ' + err.message);
    } finally {
      uploadFileButton.disabled = false;
      uploadFileButton.textContent = '+ Upload file';
      attachmentFileInput.value = '';
    }
  });

  // Icon photos: convert iPhone HEIC photos to JPEG (most browsers can't show
  // HEIC) and shrink big photos so they load quickly. Other files pass through.
  let heicLoader = null;
  function loadHeicConverter() {
    if (window.heic2any) return Promise.resolve();
    if (!heicLoader) {
      heicLoader = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
        s.onload = resolve;
        s.onerror = () => { heicLoader = null; reject(new Error('Could not load the HEIC converter.')); };
        document.head.appendChild(s);
      });
    }
    return heicLoader;
  }

  function isHeic(file) {
    return /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  }

  async function prepareIconPhoto(file) {
    let blob = file;
    let baseName = file.name.replace(/\.[^.]+$/, '');
    if (isHeic(file)) {
      await loadHeicConverter();
      const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      blob = Array.isArray(out) ? out[0] : out;
    } else if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
      throw new Error('Please choose a JPG, PNG, WebP, GIF, or HEIC photo.');
    } else if (/gif/i.test(file.type)) {
      return file; // keep animated GIFs as-is
    }

    // Shrink to at most 1200px on the long side, saved as JPEG.
    const MAX = 1200;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && blob !== file) {
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
    }
    if (scale === 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return new File([jpeg], `${baseName}.jpg`, { type: 'image/jpeg' });
  }

  replaceIconButton.addEventListener('click', () => iconFileInput.click());
  iconFileInput.addEventListener('change', async () => {
    const projectId = B.state.currentProjectId;
    if (!projectId || !iconFileInput.files.length) return;
    replaceIconButton.disabled = true;
    replaceIconButton.textContent = 'Uploading…';
    try {
      const file = await prepareIconPhoto(iconFileInput.files[0]);
      const path = `${projectId}/icon/${Date.now()}-${file.name}`;
      const { error: uploadError } = await window.supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { error: updateError } = await window.supabaseClient.from('projects').update({ icon_path: path }).eq('id', projectId);
      if (updateError) throw updateError;
      await B.refreshCore();
      await openProjectDetail(projectId);
    } catch (err) {
      alert('Could not update photo: ' + err.message);
    } finally {
      replaceIconButton.disabled = false;
      replaceIconButton.textContent = 'Replace photo';
      iconFileInput.value = '';
    }
  });

  backToProjects.addEventListener('click', (e) => {
    e.preventDefault();
    B.state.currentProjectId = null;
    B.showSection('projects');
  });

  function openForm(id) {
    editingId = id || null;
    form.reset();
    if (editingId) {
      const project = B.state.projects.find((p) => p.id === editingId);
      if (!project) return;
      formTitle.textContent = 'Edit project';
      deleteButton.hidden = false;
      fieldName.value = project.name;
      fieldDescription.value = project.description || '';
      fieldIconLabel.innerHTML = 'New icon photo <span class="hint-inline">(optional &mdash; leave blank to keep the current one)</span>';
    } else {
      formTitle.textContent = 'Add project';
      deleteButton.hidden = true;
      fieldIconLabel.innerHTML = 'Icon photo <span class="hint-inline">(optional)</span>';
    }
    dialog.showModal();
  }

  addProjectButton.addEventListener('click', () => openForm(null));
  cancelButton.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = fieldName.value.trim();
    const description = fieldDescription.value.trim() || null;
    if (!name) { alert('Name is required.'); return; }

    if (editingId) {
      const { error } = await window.supabaseClient.from('projects').update({ name, description }).eq('id', editingId);
      if (error) { alert('Could not save: ' + error.message); return; }

      if (fieldIcon.files.length) {
        try {
          const file = await prepareIconPhoto(fieldIcon.files[0]);
          const path = `${editingId}/icon/${Date.now()}-${file.name}`;
          const { error: uploadError } = await window.supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: true });
          if (uploadError) throw uploadError;
          const { error: iconError } = await window.supabaseClient.from('projects').update({ icon_path: path }).eq('id', editingId);
          if (iconError) throw iconError;
        } catch (err) {
          alert('Changes saved, but the photo could not be updated: ' + err.message);
        }
      }
    } else {
      const { data: inserted, error } = await window.supabaseClient
        .from('projects')
        .insert({
          name,
          description,
          created_by: B.state.user.id,
          created_by_name: B.state.user.displayName || B.state.user.email,
        })
        .select()
        .single();
      if (error) { alert('Could not save: ' + error.message); return; }

      if (fieldIcon.files.length && inserted) {
        try {
          const file = await prepareIconPhoto(fieldIcon.files[0]);
          const path = `${inserted.id}/icon/${Date.now()}-${file.name}`;
          const { error: uploadError } = await window.supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: true });
          if (uploadError) throw uploadError;
          await window.supabaseClient.from('projects').update({ icon_path: path }).eq('id', inserted.id);
        } catch (err) {
          alert('Project saved, but the photo could not be added: ' + err.message + ' You can add it with "Replace photo".');
        }
      }
    }

    const editedId = editingId;
    dialog.close();
    await B.refreshCore();
    // If we were editing from the project's own page, redraw it with the new details.
    if (editedId && B.state.currentProjectId === editedId) await openProjectDetail(editedId);
  });

  // Removes everything stored under a folder in the bucket (Supabase can only
  // list one level at a time, so this walks the known subfolders).
  async function removeStoredFiles(projectId) {
    const paths = [];
    for (const sub of ['icon', 'files']) {
      const { data } = await window.supabaseClient.storage.from(BUCKET).list(`${projectId}/${sub}`, { limit: 1000 });
      (data || []).filter((f) => f.id).forEach((f) => paths.push(`${projectId}/${sub}/${f.name}`));
    }
    if (paths.length) {
      const { error } = await window.supabaseClient.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }
  }

  async function deleteProject(projectId) {
    const project = B.state.projects.find((p) => p.id === projectId);
    if (!project) return false;
    if (!confirm(`Delete "${project.name}"? Its photo and all of its files will be deleted, and any calendar meetings linked to it will be unlinked (the meetings themselves stay). This can't be undone.`)) return false;
    const { error } = await window.supabaseClient.from('projects').delete().eq('id', projectId);
    if (error) { alert('Could not delete: ' + error.message); return false; }
    try {
      await removeStoredFiles(projectId);
    } catch (err) {
      console.warn('Project deleted, but some stored files could not be removed: ' + err.message);
    }
    B.state.currentProjectId = null;
    B.showSection('projects');
    await B.refreshCore();
    return true;
  }

  deleteButton.addEventListener('click', async () => {
    if (!editingId) return;
    if (await deleteProject(editingId)) dialog.close();
  });

  editProjectButton.addEventListener('click', () => {
    if (B.state.currentProjectId) openForm(B.state.currentProjectId);
  });

  deleteProjectDetailButton.addEventListener('click', () => {
    if (B.state.currentProjectId) deleteProject(B.state.currentProjectId);
  });

  return { renderProjectsGrid, openProjectDetail, prepareIconPhoto };
})();
