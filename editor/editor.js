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
  preview.src = `/?editor-preview=1&view=${revision}#/work/${encodeURIComponent(selected.id)}`;
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
    projectSelect.disabled = openPortfolio.disabled = false;
    selectProject();
  })
  .catch(error => { status.textContent = error.message; });

const portfolioControls = document.querySelector('#portfolio-controls');
const caseControls = document.querySelector('#case-controls');
const openPortfolio = document.querySelector('#open-portfolio');
const backToEditor = document.querySelector('#back-to-editor');
const portfolioList = document.querySelector('#portfolio-list');
const portfolioOrder = document.querySelector('#portfolio-order');
const portfolioStatus = document.querySelector('#portfolio-status');
const publishPortfolio = document.querySelector('#publish-portfolio');
const undoPortfolio = document.querySelector('#undo-portfolio');
const resetPortfolio = document.querySelector('#reset-portfolio');
const newCaseForm = document.querySelector('#new-case-form');
const newImage = document.querySelector('#new-image');
let lists;
let newProject;
let newFile;
let uploadedHero;
let portfolioUndo;
let portfolioView;
let portfolioCommit;
let portfolioBase;

function resetPortfolioDraft() {
  newCaseForm.reset();
  delete newCaseForm.elements.id.dataset.manual;
  lists = Portfolio.order(projects);
  newProject = null;
  if (newFile) URL.revokeObjectURL(newFile.previewUrl);
  newFile = uploadedHero = null;
  portfolioView = portfolioList.value;
}

function previewPortfolio() {
  if (portfolioControls.hidden) return;
  preview.contentWindow?.postMessage({
    type: 'pixelpusher-portfolio-preview', lists, newProject, view: portfolioView, base: portfolioBase,
  }, location.origin);
}

function portfolioDirty() {
  return Boolean(newProject) || JSON.stringify(lists) !== JSON.stringify(Portfolio.order(projects));
}

function renderPortfolio() {
  const key = portfolioList.value;
  const ids = lists[key];
  const candidates = newProject ? [...projects, newProject] : projects;
  portfolioOrder.replaceChildren();
  for (const [index, id] of ids.entries()) {
    const item = candidates.find(project => project.id === id);
    const row = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = item === newProject ? item.title : CaseCopy.read(item, 'title').replaceAll('\n', ' ');
    row.append(title);
    for (const [label, offset] of [['Move up', -1], ['Move down', 1]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = offset < 0 ? '↑' : '↓';
      button.setAttribute('aria-label', `${label}: ${title.textContent}`);
      button.disabled = releasing || !ids[index + offset];
      button.onclick = () => {
        [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
        portfolioView = key;
        renderPortfolio();
        const buttons = portfolioOrder.children[index + offset].querySelectorAll('button');
        (buttons[offset < 0 ? 0 : 1].disabled ? buttons[offset < 0 ? 1 : 0] : buttons[offset < 0 ? 0 : 1]).focus();
      };
      row.append(button);
    }
    if (key === 'featured') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.disabled = releasing;
      remove.onclick = () => {
        ids.splice(index, 1);
        portfolioView = key;
        renderPortfolio();
      };
      row.append(remove);
    }
    portfolioOrder.append(row);
  }
  if (key === 'featured') {
    const add = document.createElement('select');
    add.setAttribute('aria-label', 'Feature a project');
    add.add(new Option('Feature a project…', ''));
    for (const item of candidates.filter(project => !ids.includes(project.id))) {
      add.add(new Option(item === newProject ? item.title : CaseCopy.read(item, 'title').replaceAll('\n', ' '), item.id));
    }
    add.disabled = releasing || add.options.length === 1;
    add.onchange = () => {
      if (!add.value) return;
      ids.push(add.value);
      portfolioView = key;
      renderPortfolio();
    };
    const row = document.createElement('li');
    row.append(add);
    portfolioOrder.append(row);
  }
  if (newProject) {
    const row = document.createElement('li');
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'secondary';
    view.textContent = 'Preview new case study';
    view.onclick = () => { portfolioView = 'new'; previewPortfolio(); };
    row.append(view);
    portfolioOrder.append(row);
  }
  publishPortfolio.disabled = releasing || !portfolioDirty();
  undoPortfolio.disabled = releasing || portfolioDirty() || !portfolioUndo;
  resetPortfolio.disabled = releasing || !portfolioDirty();
  backToEditor.disabled = signOut.disabled = releasing;
  newCaseForm.querySelector('button').disabled = releasing || Boolean(newProject);
  previewPortfolio();
}

function loadProjectOptions(preferred) {
  projectSelect.replaceChildren();
  for (const project of projects.filter(item => !item.comingSoon)) {
    projectSelect.add(new Option(`${CaseCopy.read(project, 'client')} — ${CaseCopy.read(project, 'title').replaceAll('\n', ' ')}`, project.id));
  }
  if (projects.some(project => project.id === preferred && !project.comingSoon)) projectSelect.value = preferred;
}

openPortfolio.onclick = () => {
  if (releasing || pending || checkingImages || !selected) return;
  if ((Object.keys(edits).length || imageFiles.size || suggestion !== null) &&
      !window.confirm('Discard unpublished edits to this case study?')) return;
  selectProject();
  caseControls.hidden = openPortfolio.hidden = true;
  portfolioControls.hidden = false;
  portfolioBase = projects;
  resetPortfolioDraft();
  renderPortfolio();
};

backToEditor.onclick = () => {
  if (portfolioDirty() && !window.confirm('Discard unpublished changes to the portfolio?')) return;
  resetPortfolioDraft();
  portfolioControls.hidden = true;
  caseControls.hidden = openPortfolio.hidden = false;
  loadProjectOptions(selected?.id);
  selectProject();
};

portfolioList.onchange = () => { portfolioView = portfolioList.value; renderPortfolio(); };
resetPortfolio.onclick = () => { resetPortfolioDraft(); renderPortfolio(); };

newCaseForm.elements.title.addEventListener('input', () => {
  const slug = newCaseForm.elements.id;
  if (!slug.dataset.manual) slug.value = newCaseForm.elements.title.value.toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/, '');
});
newCaseForm.elements.id.addEventListener('input', () => { newCaseForm.elements.id.dataset.manual = 'true'; });

newCaseForm.onsubmit = async event => {
  event.preventDefault();
  if (newProject || releasing) return;
  const input = Object.fromEntries(new FormData(newCaseForm));
  if (projects.some(project => project.id === input.id)) {
    portfolioStatus.textContent = 'That project URL is already in use.';
    return;
  }
  const file = newImage.files[0];
  let previewUrl;
  try {
    if (file) {
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
        throw Error('Choose a JPEG, PNG, WebP, GIF, or AVIF image up to 20 MB.');
      }
      previewUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = previewUrl;
      await image.decode();
      if (portfolioControls.hidden || newProject || releasing) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      input.image = previewUrl;
    }
    Portfolio.create(input, location.origin);
    newProject = input;
    newFile = file ? { file, previewUrl } : null;
    lists.work.unshift(input.id);
    portfolioView = 'new';
    document.querySelector('#new-case').open = false;
    portfolioStatus.textContent = 'Case study added to the draft. Publish when ready.';
    renderPortfolio();
  } catch (error) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    portfolioStatus.textContent = error.message;
  }
};

async function releasePortfolio(undoing) {
  if (releasing || (undoing ? !portfolioUndo || portfolioDirty() : !portfolioDirty())) return;
  const before = Portfolio.order(projects);
  const createdId = newProject?.id;
  releasing = true;
  renderPortfolio();
  try {
    const change = undoing ? { before, ...portfolioUndo } : { before, after: lists };
    if (!undoing && newProject) {
      if (newFile) {
        portfolioStatus.textContent = 'Uploading hero image…';
        const { uploadImage } = await import('/editor/image-upload.bundle.js');
        uploadedHero ??= await uploadImage(newFile.file);
      }
      change.newProject = { ...newProject, image: uploadedHero ?? newProject.image };
    }
    portfolioStatus.textContent = 'Publishing to GitHub…';
    const response = await fetch('/api/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio: change }),
    });
    if (response.status === 401) return sessionExpired();
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    projects = result.projects;
    portfolioCommit = result.commit;
    portfolioUndo = undoing ? null : {
      after: before,
      ...(createdId ? { removeProject: projects.find(project => project.id === createdId) } : {}),
    };
    portfolioBase = projects;
    resetPortfolioDraft();
    loadProjectOptions(createdId ?? selected?.id);
    portfolioStatus.replaceChildren('Saved to GitHub. Vercel is deploying. ');
    const link = document.createElement('a');
    link.href = `https://github.com/karmakazi/pixelpusher-editor-beta/commit/${portfolioCommit}`;
    link.textContent = 'View commit';
    link.target = '_blank';
    link.rel = 'noopener';
    portfolioStatus.append(link);
    const expected = JSON.stringify(Portfolio.order(projects));
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const deployed = await fetch(`/projects.json?portfolio=${Date.now()}`, { cache: 'no-store' });
        if (deployed.ok && JSON.stringify(Portfolio.order(await deployed.json())) === expected) {
          portfolioStatus.firstChild.textContent = undoing ? 'Previous portfolio restored. ' : 'Portfolio is live on the beta site. ';
          break;
        }
      } catch {
        // The next check can recover from a temporary network error.
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (portfolioStatus.firstChild.textContent.startsWith('Saved')) {
      portfolioStatus.firstChild.textContent = 'Saved to GitHub. Check Vercel for deployment status. ';
    }
  } catch (error) {
    if (error.status === 401) return sessionExpired();
    portfolioStatus.textContent = error.message;
  } finally {
    releasing = false;
    renderPortfolio();
  }
}

publishPortfolio.onclick = () => releasePortfolio(false);
undoPortfolio.onclick = () => releasePortfolio(true);
preview.addEventListener('load', previewPortfolio);
