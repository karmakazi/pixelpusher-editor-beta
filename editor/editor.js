'use strict';

const projectSelect = document.querySelector('#project');
const original = document.querySelector('#original');
const draft = document.querySelector('#draft');
const instruction = document.querySelector('#instruction');
const access = document.querySelector('#access');
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
let revision = 0;
let pending = false;
let releasing = false;
const lastRelease = new Map();
try {
  for (const [id, release] of JSON.parse(sessionStorage.getItem('pixelpusher-releases') || '[]')) {
    lastRelease.set(id, release);
  }
} catch {
  // Continue when session storage is unavailable.
}

function updateDraft() {
  const value = draft.value;
  document.querySelector('#count').textContent = `${value.length}/240`;
  const changed = value.trim() !== selected.tagline;
  publish.disabled = releasing || pending || !changed || !value.trim();
  undo.disabled = releasing || pending || changed || lastRelease.get(selected.id)?.tagline !== selected.tagline;
  reset.disabled = releasing || !changed;
  preview.contentWindow?.postMessage({
    type: 'pixelpusher-intro-preview',
    projectId: selected.id,
    tagline: value,
  }, location.origin);
}

function selectProject() {
  revision++;
  selected = projects.find(project => project.id === projectSelect.value);
  original.textContent = selected.tagline;
  draft.value = selected.tagline;
  draft.disabled = false;
  status.textContent = '';
  preview.src = `/?editor-preview=1#/work/${encodeURIComponent(selected.id)}`;
  updateDraft();
}

preview.addEventListener('load', () => { if (selected) updateDraft(); });
projectSelect.addEventListener('change', selectProject);
draft.addEventListener('input', () => {
  revision++;
  updateDraft();
});
reset.addEventListener('click', () => {
  revision++;
  draft.value = selected.tagline;
  status.textContent = 'Draft reset.';
  updateDraft();
});
mobile.addEventListener('click', () => {
  const enabled = preview.classList.toggle('mobile');
  mobile.setAttribute('aria-pressed', String(enabled));
  mobile.textContent = enabled ? 'Desktop view' : 'Mobile view';
});

document.querySelector('#assistant').addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || releasing || !selected) return;
  if (!access.value) {
    status.textContent = 'Enter the editor access code.';
    access.focus();
    return;
  }
  const requestedRevision = revision;
  pending = true;
  generate.disabled = true;
  updateDraft();
  status.textContent = 'Drafting…';
  try {
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access.value}`,
      },
      body: JSON.stringify({ projectId: selected.id, instruction: instruction.value }),
    });
    const proposal = await response.json();
    if (!response.ok) throw new Error(proposal.error);
    if (revision !== requestedRevision) {
      status.textContent = 'The draft changed while AI was working. Generate again to see a new suggestion.';
      return;
    }
    if (proposal.tagline.trim()) {
      draft.value = proposal.tagline;
      updateDraft();
    }
    status.textContent = proposal.note || 'Draft ready for review.';
  } catch (error) {
    status.textContent = error instanceof SyntaxError
      ? 'AI drafting is unavailable here. You can still edit the draft directly.'
      : error.message;
  } finally {
    pending = false;
    generate.disabled = false;
    updateDraft();
  }
});

async function verifyRelease(projectId, tagline) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`/projects.json?release-check=${Date.now()}`, { cache: 'no-store' });
      const current = response.ok && (await response.json()).find(item => item.id === projectId);
      if (current?.tagline === tagline) return true;
    } catch {
      // A deployment can briefly be unavailable.
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return false;
}

async function release(isUndo) {
  if (releasing || pending || !selected) return;
  if (!access.value) {
    releaseStatus.textContent = 'Enter the editor access code.';
    access.focus();
    return;
  }
  const project = selected;
  const previous = project.tagline;
  const tagline = isUndo ? lastRelease.get(project.id)?.previous : draft.value.trim();
  if (!tagline || tagline === previous) return;
  releasing = true;
  projectSelect.disabled = draft.disabled = generate.disabled = reset.disabled = true;
  updateDraft();
  commitLink.hidden = liveLink.hidden = true;
  releaseStatus.textContent = isUndo ? 'Restoring the previous intro…' : 'Publishing to GitHub…';

  try {
    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access.value}`,
      },
      body: JSON.stringify({ projectId: project.id, previous, tagline, undo: isUndo }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    if (isUndo) lastRelease.delete(project.id);
    else lastRelease.set(project.id, { previous, tagline });
    try {
      sessionStorage.setItem('pixelpusher-releases', JSON.stringify([...lastRelease]));
    } catch {
      // Undo remains available in the current page.
    }
    project.tagline = tagline;
    original.textContent = draft.value = tagline;
    commitLink.href = `https://github.com/karmakazi/pixelpusher-editor-beta/commit/${result.commit}`;
    commitLink.hidden = false;
    releaseStatus.textContent = 'Saved to GitHub. Waiting for Vercel…';
    updateDraft();

    if (await verifyRelease(project.id, tagline)) {
      releaseStatus.textContent = isUndo ? 'Previous intro restored on the beta site.' : 'Published on the beta site.';
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
    projectSelect.disabled = draft.disabled = generate.disabled = false;
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
      projectSelect.add(new Option(`${project.client} — ${project.title}`, project.id));
    }
    if (!projectSelect.options.length) throw new Error('No case studies available.');
    projectSelect.disabled = false;
    generate.disabled = false;
    selectProject();
  })
  .catch(error => { status.textContent = error.message; });
