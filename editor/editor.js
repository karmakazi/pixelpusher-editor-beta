'use strict';

const projectSelect = document.querySelector('#project');
const selectionLabel = document.querySelector('#selection');
const changeSummary = document.querySelector('#changes');
const copyControls = document.querySelector('#copy-controls');
const imageControls = document.querySelector('#image-controls');
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

function updateDraft(inline = false) {
  const { field, paragraph } = selection;
  const definition = CaseCopy.fields[field];
  const entries = Object.entries(edits);
  const invalid = entries.some(([key, value]) => !validEdit(key, value));
  const rule = paragraph !== null ? '' :
    definition.list ? 'Enter one item per line.' : '';
  document.querySelector('#count').textContent = `${draft.value.length}/${definition.max}`;
  draft.setAttribute('aria-invalid', String(!validEdit(field, edits[field] ?? CaseCopy.read(selected, field))));
  changeSummary.textContent = invalid ? 'Check for empty paragraphs or copy that exceeds the field limit.' :
    [rule, entries.length ? `Edited: ${entries.map(([key]) => CaseCopy.definition(key).label).join(', ')}.` : ''].join(' ').trim();
  publish.disabled = releasing || pending || suggestion !== null || !entries.length || invalid;
  undo.disabled = releasing || pending || suggestion !== null || Boolean(entries.length) ||
    !matches(selected, lastRelease.get(selected.id)?.changes);
  reset.disabled = releasing || !entries.length;
  restoreDraft.hidden = !previousDrafts.has(selectionKey());
  restoreDraft.disabled = releasing || pending;
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
      ...(suggestion === null ? {} : { [field]: fieldValue(suggestion) }),
    },
  }, location.origin);
}

function showField() {
  copyControls.hidden = Boolean(imageSelection);
  imageControls.hidden = !imageSelection;
  if (imageSelection) {
    selectionLabel.textContent = imageSelection === 'hero' ? 'Hero image' :
      `Gallery image ${Number(imageSelection.split(':')[1]) + 1}`;
    for (const [name, input] of [['url', imageUrl], ['alt', imageAlt]]) {
      const field = `${imageSelection}:${name}`;
      input.value = edits[field] ?? CaseCopy.read(selected, field);
      input.disabled = releasing;
    }
    previewImage.disabled = releasing;
    imageStatus.textContent = '';
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

imageControls.addEventListener('submit', async event => {
  event.preventDefault();
  if (releasing || !imageSelection) return;
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
  for (const [name, value] of [['url', url], ['alt', alt]]) {
    const field = `${key}:${name}`;
    if (value === CaseCopy.read(project, field)) delete edits[field];
    else edits[field] = value;
  }
  updateDraft();
  imageStatus.textContent = 'Image preview updated.';
});

imageControls.addEventListener('input', () => { revision++; });

preview.addEventListener('load', () => { if (selected) updateDraft(); });
projectSelect.addEventListener('change', () => {
  if (Object.keys(edits).length && !window.confirm('Discard unpublished edits to this case study?')) {
    projectSelect.value = selected.id;
    return;
  }
  selectProject();
});
draft.addEventListener('input', () => editField());
reset.addEventListener('click', () => {
  revision++;
  edits = {};
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
  if (releasing || pending || suggestion !== null || !selected) return;
  const project = selected;
  const changes = isUndo ? lastRelease.get(project.id)?.previous : { ...edits };
  if (!changes || !Object.keys(changes).length) return;
  const previous = Object.fromEntries(Object.keys(changes).map(field => [field, CaseCopy.read(project, field)]));
  releasing = true;
  projectSelect.disabled = draft.disabled = reset.disabled = signOut.disabled = true;
  imageUrl.disabled = imageAlt.disabled = previewImage.disabled = true;
  updateDraft();
  commitLink.hidden = liveLink.hidden = true;
  releaseStatus.textContent = isUndo ? 'Restoring the previous copy…' : 'Publishing to GitHub…';

  try {
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
    releaseStatus.textContent = error instanceof SyntaxError
      ? 'Could not confirm publication. Check Vercel and GitHub before retrying.'
      : error.message;
  } finally {
    releasing = false;
    projectSelect.disabled = draft.disabled = signOut.disabled = false;
    imageUrl.disabled = imageAlt.disabled = previewImage.disabled = false;
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
