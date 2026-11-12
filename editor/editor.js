'use strict';

const projectSelect = document.querySelector('#project');
const selectionLabel = document.querySelector('#selection');
const changeSummary = document.querySelector('#changes');
const copyControls = document.querySelector('#copy-controls');
const imageTools = document.querySelector('#image-tools');
const imageHeading = document.querySelector('#image-heading');
const closeImage = document.querySelector('#close-image');
const imageControls = document.querySelector('#image-controls');
const imageFile = document.querySelector('#image-file');
const chosenImage = document.querySelector('#chosen-image');
const removeImage = document.querySelector('#remove-image');
const imageUrl = document.querySelector('#image-url');
const imageAlt = document.querySelector('#image-alt');
const imageStatus = document.querySelector('#image-status');
const previewImage = document.querySelector('#preview-image');
const original = document.querySelector('#original');
const draft = document.querySelector('#draft');
const access = document.querySelector('#access');
const login = document.querySelector('#login');
const loginButton = document.querySelector('#login-button');
const signOut = document.querySelector('#sign-out');
const sessionStatus = document.querySelector('#session-status');
const workspace = document.querySelector('#workspace');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const restoreDraft = document.querySelector('#restore-draft');
const publish = document.querySelector('#publish');
const undo = document.querySelector('#undo');
const releaseStatus = document.querySelector('#release-status');
const commitLink = document.querySelector('#commit');
const liveLink = document.querySelector('#live');
const reset = document.querySelector('#reset');
const mobile = document.querySelector('#mobile');

let projects = [];
let selected;
let edits = {};
const previousDrafts = new Map();
let revision = 0;
let pending = false;
let suggestion = null;
let aiNote = '';
let releasing = false;
const lastRelease = new Map();
const awaitingDeployment = new Map();
const imageFiles = new Map();
let checkingImages = 0;
try {
  for (const [id, release] of JSON.parse(sessionStorage.getItem('pixelpusher-releases') || '[]')) {
    lastRelease.set(id, typeof release.previous === 'string'
      ? { previous: { tagline: release.previous }, changes: { tagline: release.tagline } }
      : release);
  }
} catch {
  // Continue when session storage is unavailable.
}

function showSession(signedIn) {
  document.querySelector('#sign-in').hidden = signedIn;
  workspace.hidden = !signedIn;
  signOut.hidden = !signedIn;
  if (!signedIn) access.focus();
}

async function checkSession(method, password) {
  const options = { method };
  if (method === 'POST') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify({ password });
  }
  const response = await fetch('/api/session', options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  showSession(result.signedIn);
  sessionStatus.textContent = '';
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  loginButton.disabled = true;
  try {
    await checkSession('POST', access.value);
    access.value = '';
  } catch (error) {
    sessionStatus.textContent = error.message || 'Could not sign in.';
  } finally {
    loginButton.disabled = false;
  }
});

signOut.addEventListener('click', async () => {
  if (pending || releasing) return;
  signOut.disabled = true;
  try {
    await checkSession('DELETE');
  } catch {
    sessionStatus.textContent = 'Could not sign out. Try again.';
  } finally {
    signOut.disabled = false;
  }
});

function sessionExpired() {
  showSession(false);
  sessionStatus.textContent = 'Your session ended. Sign in to continue with your draft.';
}

checkSession('GET').catch(() => {
  showSession(false);
  sessionStatus.textContent = 'Could not check sign-in. Try signing in.';
});

let selection = { field: 'tagline', paragraph: null };
let imageSelection = null;

function selectedText(value) {
  return selection.paragraph === null ? value : value.split('\n\n')[selection.paragraph] ?? '';
}

function selectionKey() {
  return selection.paragraph === null ? selection.field : `copy:${selection.paragraph}`;
}

function validEdit(field, value) {
  return CaseCopy.valid(field, value) &&
    (field !== 'copy' || value.split('\n\n').every(paragraph => paragraph.trim()));
}

function matches(project, values) {
  return project && values && Object.entries(values)
    .every(([field, value]) => CaseCopy.read(project, field) === value);
}

function releaseEdits() {
  const changes = { ...edits };
  if (suggestion !== null) {
    const { field } = selection;
    const value = fieldValue(suggestion);
    if (value === CaseCopy.read(selected, field)) delete changes[field];
    else changes[field] = value;
  }
  return changes;
}

function updateDraft(inline = false) {
  const { field, paragraph } = selection;
  const definition = CaseCopy.fields[field];
  const entries = Object.entries(releaseEdits());
  const hasEdits = entries.length > 0 || imageFiles.size > 0;
  const invalid = entries.some(([key, value]) => !validEdit(key, value));
  const rule = paragraph !== null ? '' :
    definition.list ? 'Enter one item per line.' : '';
  document.querySelector('#count').textContent = `${draft.value.length}/${definition.max}`;
  draft.setAttribute('aria-invalid', String(!validEdit(field, edits[field] ?? CaseCopy.read(selected, field))));
  changeSummary.textContent = invalid ? 'Check for empty paragraphs or copy that exceeds the field limit.' :
    [rule, hasEdits ? `Edited: ${[...new Set([...entries.map(([key]) => key), ...imageFiles.keys()])]
      .map(key => CaseCopy.definition(key).label).join(', ')}.` : ''].join(' ').trim();
  publish.textContent = suggestion === null ? 'Publish to beta' : 'Publish with AI suggestion';
  publish.disabled = releasing || pending || checkingImages > 0 || !hasEdits || invalid;
  undo.disabled = releasing || pending || suggestion !== null || checkingImages > 0 || hasEdits ||
    !matches(selected, lastRelease.get(selected.id)?.changes);
  reset.disabled = releasing || (!hasEdits && suggestion === null && checkingImages === 0);
  restoreDraft.hidden = !previousDrafts.has(selectionKey());
  restoreDraft.disabled = releasing || pending;
  positionImageTools();
  preview.contentWindow?.postMessage({
    type: 'pixelpusher-copy-preview',
    projectId: selected.id,
    selection: imageSelection ? null : selection,
    image: imageSelection,
    locked: releasing,
    inline,
    ai: { pending, suggested: suggestion !== null, note: aiNote },
    values: {
      ...awaitingDeployment.get(selected.id),
      ...Object.fromEntries(entries.filter(([key, value]) => validEdit(key, value))),
      ...(suggestion === null || entries.some(([key]) => key === field) ? {} : { [field]: CaseCopy.read(selected, field) }),
      ...Object.fromEntries([...imageFiles].map(([key, item]) => [key, item.previewUrl])),
    },
  }, location.origin);
}

function positionImageTools() {
  const doc = preview.contentDocument;
  const viewport = preview.contentWindow;
  const anchor = imageSelection && doc?.querySelector(
    imageSelection === 'hero' ? '.edit-hero-image' : `[data-edit-image="${imageSelection}"]`
  );
  imageTools.hidden = !anchor || releasing;
  if (imageTools.hidden) return;
  const rect = anchor.getBoundingClientRect();
  imageTools.hidden = rect.bottom < 0 || rect.top > viewport.innerHeight;
  if (imageTools.hidden) return;
  const docked = viewport.innerWidth < 520;
  imageTools.classList.toggle('copy-ai-docked', docked);
  if (docked) {
    imageTools.style.removeProperty('left');
    imageTools.style.removeProperty('top');
    return;
  }
  const { width, height } = imageTools.getBoundingClientRect();
  imageTools.style.left = `${Math.max(12, Math.min(rect.left, viewport.innerWidth - width - 12))}px`;
  const below = rect.bottom + 8;
  const top = below + height <= viewport.innerHeight - 8 ? below : rect.top - height - 8;
  imageTools.style.top = `${Math.max(8, Math.min(top, viewport.innerHeight - height - 8))}px`;
}

function closeImageTools() {
  const anchor = preview.contentDocument?.querySelector(
    imageSelection === 'hero' ? '.edit-hero-image' : `[data-edit-image="${imageSelection}"]`
  );
  revision++;
  imageSelection = null;
  showField();
  anchor?.focus();
}

closeImage.addEventListener('click', closeImageTools);
imageTools.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeImageTools();
});
const imageToolsResize = new ResizeObserver(positionImageTools);
imageToolsResize.observe(imageControls);

function showField() {
  copyControls.hidden = Boolean(imageSelection);
  positionImageTools();
  if (imageSelection) {
    selectionLabel.textContent = imageSelection === 'hero' ? 'Hero image' :
      `Gallery image ${Number(imageSelection.split(':')[1]) + 1}`;
    imageHeading.textContent = `Replace ${selectionLabel.textContent.toLowerCase()}`;
    for (const [name, input] of [['url', imageUrl], ['alt', imageAlt]]) {
      const field = `${imageSelection}:${name}`;
      input.value = edits[field] ?? CaseCopy.read(selected, field);
      input.disabled = releasing;
    }
    imageFile.value = '';
    const file = imageFiles.get(`${imageSelection}:url`);
    chosenImage.hidden = removeImage.hidden = !file;
    chosenImage.textContent = file ? file.file.name : '';
    imageFile.disabled = removeImage.disabled = previewImage.disabled = releasing;
    imageStatus.textContent = '';
    positionImageTools();
    updateDraft();
    return;
  }
  const { field, paragraph } = selection;
  const baseline = CaseCopy.read(selected, field);
  selectionLabel.textContent = paragraph === null ? CaseCopy.fields[field].label : `Body paragraph ${paragraph + 1}`;
  original.textContent = selectedText(baseline);
  draft.maxLength = CaseCopy.fields[field].max;
  draft.value = selectedText(edits[field] ?? baseline);
  draft.disabled = releasing;
  status.textContent = '';
  updateDraft();
}

function selectProject() {
  revision++;
  selected = projects.find(project => project.id === projectSelect.value);
  edits = {};
  clearFiles();
  previousDrafts.clear();
  suggestion = null;
  aiNote = '';
  selection = { field: 'tagline', paragraph: null };
  imageSelection = null;
  releaseStatus.textContent = '';
  commitLink.hidden = liveLink.hidden = true;
  preview.src = `/?editor-preview=1#/work/${encodeURIComponent(selected.id)}`;
  showField();
}

function fieldValue(text) {
  const { field, paragraph } = selection;
  const baseline = CaseCopy.read(selected, field);
  let value = text;
  if (paragraph !== null) {
    const paragraphs = (edits[field] ?? baseline).split('\n\n');
    value = value.replace(/\s*\r?\n\s*/g, ' ');
    paragraphs[paragraph] = value.trim();
    value = paragraphs.join('\n\n');
  } else {
    if (!CaseCopy.fields[field].list) value = value.replace(/\s*\r?\n\s*/g, ' ');
    value = CaseCopy.normalize(field, value);
  }
  return value;
}

function editField(inline = false) {
  revision++;
  suggestion = null;
  aiNote = '';
  const { field } = selection;
  const value = fieldValue(draft.value);
  if (value === CaseCopy.read(selected, field)) delete edits[field];
  else edits[field] = value;
  updateDraft(inline);
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== preview.contentWindow || !selected || releasing) return;
  const { type, projectId, field, paragraph, value, image } = event.data || {};
  if (projectId !== selected.id) return;
  if (type === 'pixelpusher-image-select') {
    if (typeof image !== 'string' || !CaseCopy.hasField(selected, `${image}:url`)) return;
    if (imageSelection === image) return;
    revision++;
    suggestion = null;
    aiNote = '';
    imageSelection = image;
    showField();
    imageFile.focus({ preventScroll: true });
    return;
  }
  if (!Object.hasOwn(CaseCopy.fields, field)) return;
  if (field === 'copy' ? !Number.isInteger(paragraph) || paragraph < 0 ||
    paragraph >= (edits.copy ?? CaseCopy.read(selected, 'copy')).split('\n\n').length : paragraph !== null) return;
  if (['pixelpusher-ai-request', 'pixelpusher-ai-keep', 'pixelpusher-ai-discard'].includes(type)) {
    if (imageSelection || selection.field !== field || selection.paragraph !== paragraph) return;
    if (type === 'pixelpusher-ai-request' && typeof value === 'string') requestDraft(value);
    if (type === 'pixelpusher-ai-keep' && suggestion !== null) {
      previousDrafts.set(selectionKey(), draft.value);
      draft.value = suggestion;
      editField();
      status.textContent = 'AI suggestion kept in your draft.';
    }
    if (type === 'pixelpusher-ai-discard') {
      revision++;
      suggestion = null;
      aiNote = '';
      updateDraft();
    }
    return;
  }
  if (type !== 'pixelpusher-copy-select' && type !== 'pixelpusher-copy-input') return;
  if (imageSelection || selection.field !== field || selection.paragraph !== paragraph) {
    revision++;
    imageSelection = null;
    selection = { field, paragraph };
    suggestion = null;
    aiNote = '';
    showField();
  }
  if (type === 'pixelpusher-copy-input' && typeof value === 'string') {
    draft.value = value;
    editField(true);
  }
});

function removeFile(key) {
  const item = imageFiles.get(key);
  if (item) URL.revokeObjectURL(item.previewUrl);
  imageFiles.delete(key);
}

function clearFiles() {
  for (const key of imageFiles.keys()) removeFile(key);
}

function stageImageField(field, value) {
  if (value === CaseCopy.read(selected, field)) delete edits[field];
  else edits[field] = value;
}

imageFile.addEventListener('change', async () => {
  if (!imageSelection || releasing) return;
  const file = imageFile.files[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
    imageFile.value = '';
    imageStatus.textContent = 'Choose a JPEG, PNG, WebP, GIF, or AVIF image up to 20 MB.';
    return;
  }
  const key = `${imageSelection}:url`;
  const requestedRevision = ++revision;
  const previewUrl = URL.createObjectURL(file);
  let staged = false;
  checkingImages++;
  updateDraft();
  try {
    const candidate = new Image();
    candidate.src = previewUrl;
    await candidate.decode();
    if (revision !== requestedRevision || releasing) return;
    removeFile(key);
    delete edits[key];
    imageFiles.set(key, { file, previewUrl });
    staged = true;
    showField();
    imageStatus.textContent = 'File ready to publish.';
    positionImageTools();
  } catch {
    if (revision === requestedRevision) imageStatus.textContent = 'This file could not be opened as an image.';
  } finally {
    if (!staged) URL.revokeObjectURL(previewUrl);
    checkingImages--;
    updateDraft();
  }
});

removeImage.addEventListener('click', () => {
  revision++;
  removeFile(`${imageSelection}:url`);
  showField();
});

imageAlt.addEventListener('input', () => {
  const field = `${imageSelection}:alt`;
  stageImageField(field, imageAlt.value.trim());
  updateDraft();
});

imageControls.addEventListener('submit', async event => {
  event.preventDefault();
  if (releasing || !imageSelection || event.submitter !== previewImage || !previewImage.closest('details').open) return;
  const key = imageSelection;
  const project = selected;
  const url = imageUrl.value.trim();
  const alt = imageAlt.value.trim();
  if (!CaseCopy.valid(`${key}:url`, url) || !CaseCopy.valid(`${key}:alt`, alt)) {
    imageStatus.textContent = 'Enter a direct HTTPS image URL or a file path in /img.';
    return;
  }
  const requestedRevision = ++revision;
  const currentUrl = edits[`${key}:url`] ?? CaseCopy.read(project, `${key}:url`);
  if (url && url !== currentUrl) {
    imageStatus.textContent = 'Checking image…';
    const candidate = new Image();
    candidate.src = url;
    try {
      await Promise.race([
        candidate.decode(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Image load timed out')), 8000)),
      ]);
    } catch {
      if (revision === requestedRevision) imageStatus.textContent = 'This image could not be loaded. Check the URL and try again.';
      return;
    }
  }
  if (revision !== requestedRevision || releasing || selected !== project || imageSelection !== key) return;
  removeFile(`${key}:url`);
  stageImageField(`${key}:url`, url);
  stageImageField(`${key}:alt`, alt);
  showField();
  updateDraft();
  imageStatus.textContent = 'Image preview updated.';
});

imageUrl.addEventListener('input', () => { revision++; });

preview.addEventListener('load', () => {
  const doc = preview.contentDocument;
  if (!doc?.body?.classList.contains('editor-preview')) return;
  doc.body.append(imageTools);
  preview.contentWindow.addEventListener('scroll', positionImageTools, { passive: true });
  preview.contentWindow.addEventListener('resize', positionImageTools);
  positionImageTools();
  if (selected) updateDraft();
});
projectSelect.addEventListener('change', () => {
  if ((Object.keys(edits).length || imageFiles.size || suggestion !== null) && !window.confirm('Discard unpublished edits to this case study?')) {
    projectSelect.value = selected.id;
    return;
  }
  selectProject();
});
draft.addEventListener('input', () => editField());
reset.addEventListener('click', () => {
  revision++;
  edits = {};
  clearFiles();
  previousDrafts.clear();
  suggestion = null;
  aiNote = '';
  showField();
  status.textContent = 'Draft reset.';
});
restoreDraft.addEventListener('click', () => {
  const key = selectionKey();
  if (!previousDrafts.has(key)) return;
  draft.value = previousDrafts.get(key);
  previousDrafts.delete(key);
  editField();
  status.textContent = 'Previous draft restored.';
});
mobile.addEventListener('click', () => {
  const enabled = preview.classList.toggle('mobile');
  mobile.setAttribute('aria-pressed', String(enabled));
  mobile.textContent = enabled ? 'Desktop view' : 'Mobile view';
});

async function requestDraft(instruction) {
  if (pending || releasing || !selected || !instruction.trim() || instruction.length > 1500) return;
  const requestedRevision = revision;
  const { field, paragraph } = selection;
  const current = draft.value;
  const originalCopy = selectedText(CaseCopy.read(selected, field));
  pending = true;
  signOut.disabled = true;
  suggestion = null;
  aiNote = 'Drafting…';
  updateDraft();
  try {
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: selected.id, field, paragraph, current, originalCopy, instruction }),
    });
    if (response.status === 401) return sessionExpired();
    const proposal = await response.json();
    if (revision !== requestedRevision) return;
    if (!response.ok) throw new Error(proposal.error);
    if (proposal.value !== null && proposal.value !== current) {
      if (!validEdit(field, fieldValue(proposal.value))) {
        aiNote = 'The suggestion does not fit this field. Try a shorter revision.';
        return;
      }
      suggestion = proposal.value;
    }
    aiNote = proposal.note || (suggestion === null ? 'No change suggested.' : 'Review the suggestion in the preview.');
  } catch (error) {
    if (revision === requestedRevision) {
      aiNote = error instanceof SyntaxError ? 'AI drafting is unavailable right now.' : error.message;
    }
  } finally {
    pending = false;
    signOut.disabled = false;
    updateDraft();
  }
}

async function verifyRelease(projectId, changes) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`/projects.json?release-check=${Date.now()}`, { cache: 'no-store' });
      const current = response.ok && (await response.json()).find(item => item.id === projectId);
      if (matches(current, changes)) return true;
    } catch {
      // A deployment can briefly be unavailable.
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return false;
}

async function release(isUndo) {
  if (releasing || pending || checkingImages > 0 || !selected || (isUndo && suggestion !== null)) return;
  const project = selected;
  const changes = isUndo ? lastRelease.get(project.id)?.previous : releaseEdits();
  if (!changes || (!Object.keys(changes).length && !imageFiles.size) ||
      !Object.entries(changes).every(([field, value]) => validEdit(field, value))) return;
  releasing = true;
  projectSelect.disabled = draft.disabled = reset.disabled = signOut.disabled = true;
  imageFile.disabled = removeImage.disabled = imageUrl.disabled = imageAlt.disabled = previewImage.disabled = true;
  updateDraft();
  commitLink.hidden = liveLink.hidden = true;
  releaseStatus.textContent = isUndo ? 'Restoring the previous copy…' : 'Publishing to GitHub…';

  try {
    if (!isUndo && imageFiles.size) {
      const { uploadImage } = await import('/editor/image-upload.bundle.js');
      let count = 0;
      for (const [field, item] of imageFiles) {
        releaseStatus.textContent = `Uploading image ${++count} of ${imageFiles.size}…`;
        item.uploadedUrl ??= await uploadImage(item.file);
        changes[field] = item.uploadedUrl;
      }
      releaseStatus.textContent = 'Publishing to GitHub…';
    }
    const previous = Object.fromEntries(Object.keys(changes).map(field => [field, CaseCopy.read(project, field)]));
    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, previous, changes, undo: isUndo }),
    });
    if (response.status === 401) return sessionExpired();
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    if (isUndo) lastRelease.delete(project.id);
    else lastRelease.set(project.id, { previous, changes });
    try {
      sessionStorage.setItem('pixelpusher-releases', JSON.stringify([...lastRelease]));
    } catch {
      // Undo remains available in the current page.
    }
    const expectedOnSite = { ...awaitingDeployment.get(project.id), ...changes };
    awaitingDeployment.set(project.id, expectedOnSite);
    Object.assign(project, CaseCopy.apply(project, changes));
    projectSelect.selectedOptions[0].textContent =
      `${CaseCopy.read(project, 'client')} — ${CaseCopy.read(project, 'title').replaceAll('\n', ' ')}`;
    edits = {};
    clearFiles();
    previousDrafts.clear();
    suggestion = null;
    aiNote = '';
    showField();
    commitLink.href = `https://github.com/karmakazi/pixelpusher-editor-beta/commit/${result.commit}`;
    commitLink.hidden = false;
    releaseStatus.textContent = 'Saved to GitHub. Waiting for Vercel…';
    updateDraft();

    if (await verifyRelease(project.id, expectedOnSite)) {
      awaitingDeployment.delete(project.id);
      preview.src = `/?editor-preview=1&release=${result.commit}&refresh=${Date.now()}#/work/${encodeURIComponent(project.id)}`;
      releaseStatus.textContent = isUndo ? 'Previous copy restored on the beta site.' : 'Published on the beta site.';
      liveLink.href = `/#/work/${encodeURIComponent(project.id)}`;
      liveLink.hidden = false;
    } else {
      releaseStatus.textContent = 'Saved to GitHub. The beta URL has yet to show the change. Check Vercel Deployments.';
    }
  } catch (error) {
    if (error.status === 401) return sessionExpired();
    releaseStatus.textContent = error instanceof SyntaxError
      ? 'Could not confirm publication. Check Vercel and GitHub before retrying.'
      : error.message;
  } finally {
    releasing = false;
    projectSelect.disabled = draft.disabled = signOut.disabled = false;
    imageFile.disabled = removeImage.disabled = imageUrl.disabled = imageAlt.disabled = previewImage.disabled = false;
    updateDraft();
  }
}

publish.addEventListener('click', () => release(false));
undo.addEventListener('click', () => release(true));

fetch('/projects.json')
  .then(response => {
    if (!response.ok) throw new Error('Could not load projects.');
    return response.json();
  })
  .then(data => {
    projects = data;
    for (const project of projects.filter(item => !item.comingSoon)) {
      projectSelect.add(new Option(`${CaseCopy.read(project, 'client')} — ${CaseCopy.read(project, 'title').replaceAll('\n', ' ')}`, project.id));
    }
    if (!projectSelect.options.length) throw new Error('No case studies available.');
    projectSelect.disabled = false;
    selectProject();
  })
  .catch(error => { status.textContent = error.message; });
