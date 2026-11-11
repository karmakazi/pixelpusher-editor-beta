'use strict';

const projectSelect = document.querySelector('#project');
const fieldSelect = document.querySelector('#field');
const changeSummary = document.querySelector('#changes');
const original = document.querySelector('#original');
const draft = document.querySelector('#draft');
const instruction = document.querySelector('#instruction');
const access = document.querySelector('#access');
const login = document.querySelector('#login');
const loginButton = document.querySelector('#login-button');
const signOut = document.querySelector('#sign-out');
const sessionStatus = document.querySelector('#session-status');
const workspace = document.querySelector('#workspace');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const generate = document.querySelector('#generate');
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
let revision = 0;
let pending = false;
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

for (const [field, definition] of Object.entries(CaseCopy.fields)) {
  fieldSelect.add(new Option(definition.label, field));
}
fieldSelect.value = 'tagline';

function matches(project, values) {
  return project && values && Object.entries(values)
    .every(([field, value]) => CaseCopy.read(project, field) === value);
}

function updateDraft() {
  const field = fieldSelect.value;
  const definition = CaseCopy.fields[field];
  const entries = Object.entries(edits);
  const invalid = entries.some(([key, value]) => !CaseCopy.valid(key, value));
  const rule = field === 'copy' ? 'Separate paragraphs with a blank line.' :
    definition.list ? 'Enter one item per line.' : 'Use a single line.';
  document.querySelector('#count').textContent = `${draft.value.length}/${definition.max}`;
  draft.setAttribute('aria-invalid', String(!CaseCopy.valid(field, draft.value)));
  changeSummary.textContent = invalid ? 'Check the length and line breaks in your edited copy.' :
    [rule, entries.length ? `Edited: ${entries.map(([key]) => CaseCopy.fields[key].label).join(', ')}.` : ''].join(' ').trim();
  publish.disabled = releasing || pending || !entries.length || invalid;
  undo.disabled = releasing || pending || Boolean(entries.length) ||
    !matches(selected, lastRelease.get(selected.id)?.changes);
  reset.disabled = releasing || !entries.length;
  preview.contentWindow?.postMessage({
    type: 'pixelpusher-copy-preview',
    projectId: selected.id,
    values: {
      ...awaitingDeployment.get(selected.id),
      ...Object.fromEntries(entries.filter(([key, value]) => CaseCopy.valid(key, value))),
    },
  }, location.origin);
}

function showField() {
  const field = fieldSelect.value;
  original.textContent = CaseCopy.read(selected, field);
  draft.maxLength = CaseCopy.fields[field].max;
  draft.value = edits[field] ?? original.textContent;
  draft.disabled = releasing;
  status.textContent = '';
  updateDraft();
}

function selectProject() {
  revision++;
  selected = projects.find(project => project.id === projectSelect.value);
  edits = {};
  releaseStatus.textContent = '';
  commitLink.hidden = liveLink.hidden = true;
  preview.src = `/?editor-preview=1#/work/${encodeURIComponent(selected.id)}`;
  showField();
}

function editField() {
  revision++;
  const field = fieldSelect.value;
  const value = CaseCopy.normalize(field, draft.value);
  if (value === CaseCopy.read(selected, field)) delete edits[field];
  else edits[field] = value;
  updateDraft();
}

preview.addEventListener('load', () => { if (selected) updateDraft(); });
projectSelect.addEventListener('change', () => {
  if (Object.keys(edits).length && !window.confirm('Discard unpublished edits to this case study?')) {
    projectSelect.value = selected.id;
    return;
  }
  selectProject();
});
fieldSelect.addEventListener('change', () => { revision++; showField(); });
draft.addEventListener('input', editField);
reset.addEventListener('click', () => {
  revision++;
  edits = {};
  showField();
  status.textContent = 'Draft reset.';
});
mobile.addEventListener('click', () => {
  const enabled = preview.classList.toggle('mobile');
  mobile.setAttribute('aria-pressed', String(enabled));
  mobile.textContent = enabled ? 'Desktop view' : 'Mobile view';
});

document.querySelector('#assistant').addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || releasing || !selected) return;
  const requestedRevision = revision;
  pending = true;
  generate.disabled = signOut.disabled = true;
  updateDraft();
  status.textContent = 'Drafting…';
  try {
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: selected.id, field: fieldSelect.value, current: draft.value, instruction: instruction.value }),
    });
    if (response.status === 401) return sessionExpired();
    const proposal = await response.json();
    if (!response.ok) throw new Error(proposal.error);
    if (revision !== requestedRevision) {
      status.textContent = 'The draft changed while AI was working. Generate again to see a new suggestion.';
      return;
    }
    if (proposal.value !== null) {
      draft.value = proposal.value;
      editField();
    }
    status.textContent = proposal.note || 'Draft ready for review.';
  } catch (error) {
    status.textContent = error instanceof SyntaxError
      ? 'AI drafting is unavailable here. You can still edit the draft directly.'
      : error.message;
  } finally {
    pending = false;
    generate.disabled = signOut.disabled = false;
    updateDraft();
  }
});

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
  if (releasing || pending || !selected) return;
  const project = selected;
  const changes = isUndo ? lastRelease.get(project.id)?.previous : { ...edits };
  if (!changes || !Object.keys(changes).length) return;
  const previous = Object.fromEntries(Object.keys(changes).map(field => [field, CaseCopy.read(project, field)]));
  releasing = true;
  projectSelect.disabled = fieldSelect.disabled = draft.disabled = generate.disabled = reset.disabled = signOut.disabled = true;
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
    if (isUndo) instruction.value = '';
    showField();
    commitLink.href = `https://github.com/karmakazi/pixelpusher-editor-beta/commit/${result.commit}`;
    commitLink.hidden = false;
    releaseStatus.textContent = 'Saved to GitHub. Waiting for Vercel…';
    updateDraft();

    if (await verifyRelease(project.id, expectedOnSite)) {
      awaitingDeployment.delete(project.id);
      preview.src = `/?editor-preview=1&release=${result.commit}#/work/${encodeURIComponent(project.id)}`;
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
    projectSelect.disabled = fieldSelect.disabled = draft.disabled = generate.disabled = signOut.disabled = false;
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
    projectSelect.disabled = fieldSelect.disabled = false;
    generate.disabled = false;
    selectProject();
  })
  .catch(error => { status.textContent = error.message; });
