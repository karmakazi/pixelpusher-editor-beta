'use strict';

const projectSelect = document.querySelector('#project');
const original = document.querySelector('#original');
const draft = document.querySelector('#draft');
const instruction = document.querySelector('#instruction');
const access = document.querySelector('#access');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const generate = document.querySelector('#generate');
const download = document.querySelector('#download');
const reset = document.querySelector('#reset');
const mobile = document.querySelector('#mobile');

let projects = [];
let selected;
let revision = 0;
let pending = false;

function updateDraft() {
  const value = draft.value;
  document.querySelector('#count').textContent = `${value.length}/240`;
  const changed = value.trim() !== selected.tagline;
  download.disabled = !changed || !value.trim();
  reset.disabled = !changed;
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
  if (pending || !selected) return;
  const requestedRevision = revision;
  pending = true;
  generate.disabled = true;
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
  }
});

download.addEventListener('click', () => {
  const updated = projects.map(project => project === selected
    ? { ...project, tagline: draft.value.trim() }
    : project);
  const file = new Blob([JSON.stringify(updated, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'projects.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

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
