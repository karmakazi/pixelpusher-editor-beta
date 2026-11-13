'use strict';

// ── STATE ──────────────────────────────────────────────────
let PROJECTS = [];
let home;
let homeLocked = false;
let homeFields;
let currentView = null;
let revealObs = null;
let casePreview = null;
const draftCaseId = new URLSearchParams(location.search).get('draft-case');
let portfolioPreview = null;
let portfolioPreviewView;
let portfolioSelectedCard = null;
let portfolioLocked = false;
let refreshCopyAI;
const editorPreview = window.parent !== window && new URLSearchParams(location.search).has('editor-preview');

if (editorPreview) {
  document.body.classList.add('editor-preview');
  refreshCopyAI = setupCopyAI();
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'pixelpusher-home-preview' && homeEditing()) {
      const { content, inline, locked, field } = event.data;
      home = content;
      homeLocked = locked;
      if (!inline && PROJECTS.length) {
        const node = field && [...document.querySelectorAll('[data-home-field]')].find(item => item.dataset.homeField === field);
        if (node) node.innerHTML = homeText(field, false);
        else renderHome(true);
      }
      for (const node of document.querySelectorAll('[data-home-field]')) {
        node.contentEditable = locked ? 'false' : 'plaintext-only';
      }
      return;
    }
    if (event.data?.type === 'pixelpusher-portfolio-preview') {
      const { lists, newProject, view, base, selectedCard, locked } = event.data;
      if (!['work', 'featured', 'new'].includes(view)) return;
      try {
        const created = newProject ? Portfolio.create(newProject, location.origin) : null;
        const projects = Array.isArray(base) ? base : PROJECTS;
        portfolioPreview = Portfolio.arrange(created ? [...projects, created] : projects, lists);
        portfolioPreviewView = view;
        portfolioSelectedCard = selectedCard;
        portfolioLocked = locked;
        if (view === 'new') {
          if (created) renderCase(created.id);
        } else {
          renderPortfolioGrid(view);
        }
      } catch {
        // The editor and preview can briefly have different deployed revisions.
      }
      return;
    }
    const { type, projectId, values, selection, locked, inline, ai, image } = event.data || {};
    if (type !== 'pixelpusher-copy-preview' || typeof projectId !== 'string' ||
        !values || typeof values !== 'object' ||
        !Object.entries(values).every(([field, value]) => CaseCopy.validPreview(field, value, location.origin))) return;
    const previous = casePreview?.projectId === projectId ? casePreview.values : {};
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(values)])]
      .filter(field => previous[field] !== values[field]);
    casePreview = { projectId, values, selection, locked, ai, image };
    if (currentView !== `case:${projectId}`) return;
    const altOnly = changed.length > 0 && changed.every(field => field.endsWith(':alt'));
    if (changed.length && !altOnly && !(inline && document.activeElement?.matches('[data-copy-field]'))) {
      renderCase(projectId, true);
    } else {
      if (altOnly) updatePreviewAlt(projectId, values, changed);
      syncEditableCopy();
    }
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-portfolio-action]');
    if (!portfolioPreview || portfolioLocked || !button) return;
    const id = button.closest('[data-portfolio-card]').dataset.portfolioCard;
    window.parent.postMessage({ type: 'pixelpusher-portfolio-card', id, action: button.dataset.portfolioAction }, location.origin);
  });

  document.addEventListener('focusin', event => {
    const node = event.target.closest('[data-copy-field]');
    if (!node || node.contentEditable === 'false') return;
    sendCopyEvent(node, 'pixelpusher-copy-select');
  });

  document.addEventListener('input', event => {
    const node = event.target.closest('[data-copy-field]');
    if (node) sendCopyEvent(node, 'pixelpusher-copy-input', node.innerText);
  });

  document.addEventListener('click', event => {
    if (event.target.closest('a')) event.preventDefault();
    const image = event.target.closest('[data-edit-image]');
    if (image) selectPreviewImage(image);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-video-options]');
    if (!button || casePreview?.locked || homeLocked) return;
    window.parent.postMessage({ type: 'pixelpusher-video-options', projectId: button.dataset.videoOptions }, location.origin);
  });
  document.addEventListener('keydown', event => {
    const image = event.target.closest('[data-edit-image]');
    if (image?.tagName === 'IMG' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      selectPreviewImage(image);
    }
  });
}

if (homeEditing()) {
  for (const [eventName, type] of [['focusin', 'select'], ['input', 'input']]) {
    document.addEventListener(eventName, event => {
      const node = event.target.closest('[data-home-field]');
      if (!node || homeLocked) return;
      window.parent.postMessage({ type: 'pixelpusher-home-' + type, field: node.dataset.homeField, value: node.innerText }, location.origin);
    });
  }
}

function selectPreviewImage(image) {
  if (casePreview?.locked) return;
  window.parent.postMessage({
    type: 'pixelpusher-image-select',
    projectId: currentView.slice(5),
    image: image.dataset.editImage,
  }, location.origin);
}

function updatePreviewAlt(projectId, values, changed) {
  const stored = caseProject(projectId);
  if (!stored) return;
  const project = CaseCopy.apply(stored, values);
  for (const field of changed) {
    const key = field.slice(0, -4);
    const image = document.querySelector(`img[data-edit-image="${key}"]`);
    if (!image) continue;
    const alt = CaseCopy.read(project, field);
    image.alt = key === 'hero' && !alt
      ? `${CaseCopy.read(project, 'client')} — ${CaseCopy.read(project, 'title').replaceAll('\n', ' ')}`
      : alt;
  }
}

function editableImage(key, label) {
  return editorPreview && !portfolioPreview ? ` data-edit-image="${key}" role="button" tabindex="0" aria-label="${label}"` : '';
}

function galleryImage(asset, index) {
  const src = asset.src || galleryUrl(asset.seed, asset.wide);
  return `<img src="${CaseCopy.escape(src)}" alt="${asset.alt}" loading="lazy"${editableImage(`gallery:${index}`, `Edit gallery image ${index + 1}`)} />`;
}

function editableCopy(field, paragraph) {
  if (!editorPreview || portfolioPreview) return '';
  const label = paragraph === undefined ? CaseCopy.fields[field].label : `Body paragraph ${paragraph + 1}`;
  const index = paragraph === undefined ? '' : ` data-copy-paragraph="${paragraph}"`;
  return ` data-copy-field="${field}"${index} data-placeholder="${label}" role="textbox" aria-label="${label}"`;
}

function syncEditableCopy() {
  for (const node of document.querySelectorAll('[data-copy-field]')) {
    const selection = casePreview?.selection;
    const paragraph = node.dataset.copyParagraph === undefined ? null : Number(node.dataset.copyParagraph);
    node.classList.toggle('copy-selected', selection?.field === node.dataset.copyField && selection.paragraph === paragraph);
    const reviewing = casePreview?.ai?.suggested && node.classList.contains('copy-selected');
    node.contentEditable = casePreview?.locked || reviewing ? 'false' : 'plaintext-only';
  }
  for (const node of document.querySelectorAll('[data-edit-image]')) {
    node.classList.toggle('image-selected', node.dataset.editImage === casePreview?.image);
    node.setAttribute('aria-disabled', String(Boolean(casePreview?.locked)));
  }
  refreshCopyAI?.();
}

function sendCopyEvent(node, type, value) {
  window.parent.postMessage({
    type,
    projectId: currentView.slice(5),
    field: node.dataset.copyField,
    paragraph: node.dataset.copyParagraph === undefined ? null : Number(node.dataset.copyParagraph),
    value,
  }, location.origin);
}

function setupCopyAI() {
  const toolbar = document.createElement('div');
  toolbar.className = 'copy-ai';
  toolbar.hidden = true;
  toolbar.innerHTML = `
    <button type="button" data-ask aria-expanded="false">Ask AI</button>
    <form hidden aria-label="Revise selected copy">
      <div class="copy-ai-heading">
        <label for="copy-ai-instruction">Revise copy</label>
        <button type="button" data-close aria-label="Close AI prompt"></button>
      </div>
      <textarea id="copy-ai-instruction" rows="2" maxlength="1500" required placeholder="Make it shorter"></textarea>
      <p role="status"></p>
      <div class="copy-ai-actions">
        <button type="submit">Draft with AI</button>
        <button type="button" data-keep hidden>Keep</button>
        <button type="button" data-discard hidden>Discard</button>
      </div>
    </form>`;
  document.body.append(toolbar);

  const ask = toolbar.querySelector('[data-ask]');
  const form = toolbar.querySelector('form');
  const instruction = form.querySelector('textarea');
  const submit = form.querySelector('[type="submit"]');
  const keep = form.querySelector('[data-keep]');
  const discard = form.querySelector('[data-discard]');
  const note = form.querySelector('[role="status"]');
  let target;
  let open = false;

  function anchor() {
    if (!target || target.project !== currentView) return null;
    return [...document.querySelectorAll('[data-copy-field]')].find(node =>
      node.dataset.copyField === target.field && node.dataset.copyParagraph === target.paragraph);
  }

  function refresh() {
    const node = anchor();
    if (!node) {
      toolbar.hidden = true;
      return;
    }
    const rect = node.getBoundingClientRect();
    const narrow = window.innerWidth < 520;
    const state = casePreview?.ai || {};
    toolbar.hidden = Boolean(casePreview?.locked || casePreview?.image) ||
      ((!open || !narrow) && (rect.bottom < 0 || rect.top > window.innerHeight));
    if (toolbar.hidden) return;

    ask.hidden = open;
    ask.setAttribute('aria-expanded', String(open));
    ask.disabled = Boolean(state.pending);
    form.hidden = !open;
    submit.hidden = Boolean(state.suggested);
    keep.hidden = discard.hidden = !state.suggested;
    instruction.hidden = Boolean(state.suggested);
    instruction.disabled = submit.disabled = Boolean(state.pending);
    note.textContent = state.note || '';
    form.querySelector('label').textContent = node.getAttribute('aria-label');

    toolbar.classList.toggle('copy-ai-docked', open && narrow);
    if (open && narrow) {
      toolbar.style.removeProperty('left');
      toolbar.style.removeProperty('top');
      return;
    }
    const { width, height } = toolbar.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    const below = rect.bottom + 8;
    const top = below + height <= window.innerHeight - 8 ? below : rect.top - height - 8;
    toolbar.style.left = `${Math.max(12, left)}px`;
    toolbar.style.top = `${Math.max(8, top)}px`;
  }

  function select(node) {
    const next = { project: currentView, field: node.dataset.copyField, paragraph: node.dataset.copyParagraph };
    if (target?.project === next.project && target.field === next.field && target.paragraph === next.paragraph) return;
    open = false;
    instruction.value = '';
    target = next;
    refresh();
  }

  function close(type) {
    const node = anchor();
    if (node) sendCopyEvent(node, type);
    open = false;
    instruction.value = '';
    refresh();
    if (!toolbar.hidden) ask.focus();
  }

  document.addEventListener('focusin', event => {
    const node = event.target.closest('[data-copy-field]');
    if (node && node.isContentEditable) select(node);
  });
  ask.addEventListener('click', () => {
    open = true;
    refresh();
    instruction.focus();
  });
  instruction.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!event.repeat && !submit.disabled && !submit.hidden && instruction.value.trim()) {
      form.requestSubmit(submit);
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const node = anchor();
    if (node && instruction.value.trim()) sendCopyEvent(node, 'pixelpusher-ai-request', instruction.value);
  });
  keep.addEventListener('click', () => close('pixelpusher-ai-keep'));
  discard.addEventListener('click', () => close('pixelpusher-ai-discard'));
  form.querySelector('[data-close]').addEventListener('click', () => close('pixelpusher-ai-discard'));
  toolbar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close('pixelpusher-ai-discard');
    }
  });
  window.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh);
  return refresh;
}

// ── CURSOR ─────────────────────────────────────────────────
const cur = document.getElementById('cur');
let mx = -200, my = -200, cx = -200, cy = -200;

document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

(function loop() {
  cx += (mx - cx) * 0.16;
  cy += (my - cy) * 0.16;
  cur.style.left = cx + 'px';
  cur.style.top  = cy + 'px';
  requestAnimationFrame(loop);
})();

// Event delegation — works on dynamically rendered content
document.addEventListener('mouseover', e => {
  if (e.target.closest('a, button, .work-item:not(.work-item--locked), .caps li')) {
    cur.classList.add('big');
  }
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('a, button, .work-item:not(.work-item--locked), .caps li')) {
    cur.classList.remove('big');
  }
});

// ── NAV SCROLL HIDE ────────────────────────────────────────
let prevY = 0;
const navEl = document.getElementById('nav');
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  navEl.classList.toggle('hide', y > prevY && y > 140);
  prevY = y;
}, { passive: true });

// ── ROUTER ────────────────────────────────────────────────
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { if (currentView && currentView.startsWith('case')) fitTitle(); });

function route() {
  if (!PROJECTS.length && !(editorPreview && draftCaseId)) return;

  const hash = location.hash;

  if (!hash || hash === '#/' || hash === '#') {
    if (currentView !== 'home') renderHome();
    return;
  }

  if (hash === '#/work') {
    renderWork();
    return;
  }

  if (hash.startsWith('#/work/')) {
    renderCase(hash.slice(7));
    return;
  }

  // Anchor link (e.g. #services, #about, #contact) — show home + scroll
  if (currentView !== 'home') renderHome();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }));
}

// ── HELPERS ───────────────────────────────────────────────
function thumbUrl(seed, wide) {
  return wide
    ? `https://picsum.photos/seed/${seed}/1600/686`
    : `https://picsum.photos/seed/${seed}/900/675`;
}

function heroUrl(seed) {
  return `https://picsum.photos/seed/${seed}/1600/900`;
}

function galleryUrl(seed, wide) {
  return wide
    ? `https://picsum.photos/seed/${seed}/1600/686`
    : `https://picsum.photos/seed/${seed}/900/675`;
}

/**
 * Render a work card for grid display.
 * @param {Object} p        - project object
 * @param {boolean} wide    - use the wide landscape slot
 * @param {boolean} eager   - true = loading="eager"
 * @param {string} delay    - CSS delay class ('d1', 'd2', or '')
 */
function workCard(p, wide, eager, delay, slot) {
  const locked  = p.comingSoon;
  const tag     = locked || slot ? 'div' : 'a';
  const href    = tag === 'div' ? '' : `href="#/work/${p.id}"`;
  const classes = [
    'work-item',
    wide   ? 'work-item--wide'   : '',
    locked ? 'work-item--locked' : '',
    slot ? 'portfolio-card' : 'r',
    delay  || '',
  ].filter(Boolean).join(' ');
  const loading = eager ? 'eager' : 'lazy';
  const badge   = locked
    ? '<span class="work-soon">Coming Soon</span>'
    : '<span class="work-cta">View \u2192</span>';

  const picked = slot && p.id === portfolioSelectedCard;
  const cardControls = slot ? `
    <button class="portfolio-select" type="button" data-portfolio-action="select"
      aria-label="Select ${p.title}" aria-pressed="${Boolean(picked)}"${portfolioLocked ? ' disabled' : ''}></button>
    ${picked ? `<div class="portfolio-arrows">
      <button type="button" data-portfolio-action="up" aria-label="Move ${p.title} up"${portfolioLocked || slot.first ? ' disabled' : ''}>↑</button>
      <button type="button" data-portfolio-action="down" aria-label="Move ${p.title} down"${portfolioLocked || slot.last ? ' disabled' : ''}>↓</button>
      ${slot.featured ? `<button type="button" data-portfolio-action="remove"${portfolioLocked ? ' disabled' : ''}>Remove from homepage</button>` : ''}
    </div>` : ''}` : '';

  return `
    <${tag} ${href} class="${classes}"${slot ? ` data-portfolio-card="${p.id}"` : ''}>
      <img src="${CaseCopy.escape(p.heroImg || thumbUrl(p.thumbSeed, wide))}" alt="${p.client} \u2014 ${p.title}" loading="${loading}" />
      <div class="work-caption">
        <p class="work-client">${p.client}</p>
        <p class="work-title">${p.title}</p>
      </div>
      ${slot ? cardControls : badge}
    </${tag}>`;
}

/**
 * Build grid card HTML for an ordered list of projects,
 * computing stagger delay classes automatically.
 */
function buildGrid(projects, isHome) {
  let col = 0; // tracks left(0) / right(1) column position
  return projects.map((p, i) => {
    const wide = i % 5 === 0;
    let delay = '';
    if (!wide) {
      delay = col === 0 ? '' : 'd1';
      col = (col + 1) % 2;
    } else {
      col = 0; // wide spans full row, reset
    }
    const eager = isHome && i === 0; // first card loads eagerly
    const slot = portfolioPreview && { first: i === 0, last: i === projects.length - 1, featured: isHome };
    return workCard(p, wide, eager, delay, slot);
  }).join('');
}

function updatePortfolioCards(grid, projects, featured) {
  const existing = new Map([...grid.children].map(card => [card.dataset.portfolioCard, card]));
  const template = document.createElement('template');
  template.innerHTML = buildGrid(projects, featured);
  for (const [index, fresh] of [...template.content.children].entries()) {
    const id = fresh.dataset.portfolioCard;
    const card = existing.get(id) ?? fresh;
    existing.delete(id);
    if (card !== fresh) {
      card.className = fresh.className;
      const picked = fresh.querySelector('.portfolio-select').getAttribute('aria-pressed');
      const select = card.querySelector('.portfolio-select');
      select.setAttribute('aria-pressed', picked);
      select.disabled = portfolioLocked;
      card.querySelector('.portfolio-arrows')?.remove();
      const arrows = fresh.querySelector('.portfolio-arrows');
      if (arrows) card.append(arrows);
    }
    if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
  }
  for (const card of existing.values()) card.remove();
}

function renderPortfolioGrid(view) {
  const featured = view === 'featured';
  const sameView = currentView === (featured ? 'home' : 'work');
  const cards = featured
    ? Portfolio.order(portfolioPreview).featured.map(id => portfolioPreview.find(project => project.id === id))
    : portfolioPreview;
  const focusedAction = document.activeElement?.dataset.portfolioAction;
  const grid = document.querySelector('.work-grid');
  if (sameView && grid) updatePortfolioCards(grid, cards, featured);
  else if (featured) {
    renderHome();
    document.querySelector('#work')?.scrollIntoView();
  } else {
    renderWork();
    document.querySelector('.work-grid')?.scrollIntoView();
  }
  if (!portfolioSelectedCard) return;
  const card = document.querySelector(`[data-portfolio-card="${portfolioSelectedCard}"]`);
  card?.scrollIntoView({ block: 'nearest' });
  if (focusedAction && card) {
    const button = card.querySelector(`[data-portfolio-action="${focusedAction}"]`);
    (button && !button.disabled ? button : card.querySelector('.portfolio-select'))?.focus({ preventScroll: true });
  }
}

function initReveal() {
  if (revealObs) revealObs.disconnect();
  revealObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      const n = entry.target.dataset.count;
      if (n) countUp(entry.target, +n, entry.target.dataset.suffix || '');
      revealObs.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.r').forEach(el => revealObs.observe(el));
}

function countUp(el, target, suffix) {
  const t0 = performance.now(), dur = 1800;
  (function tick(now) {
    const p = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(ease * target) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

function homeEditing() {
  return editorPreview && new URLSearchParams(location.search).has('home-editor');
}

function sendHomeReady() {
  window.parent.postMessage({ type: 'pixelpusher-home-ready' }, location.origin);
}

function homeText(field, editable = true) {
  const value = CaseCopy.escape(HomeContent.read(home, field)).replaceAll('\n', '<br>');
  if (!homeEditing() || !editable) return value;
  return `<span data-home-field="${field}" aria-label="${CaseCopy.escape(homeFields[field])}" role="textbox" contenteditable="${homeLocked ? 'false' : 'plaintext-only'}">${value}</span>`;
}

function homeStat(index) {
  const number = home.about.stats[index].number;
  return ` data-count="${parseInt(number, 10)}"${number.endsWith('+') ? ' data-suffix="+"' : ''}`;
}

function homeMarquee() {
  const names = home.clients.names;
  return [...names, ...names].map(name =>
    `<span class="marquee-name">${CaseCopy.escape(name)}</span><span class="marquee-sep">—</span>`
  ).join('');
}

function homeService(service, index) {
  const key = `services.${index}`;
  const style = ['cream', 'ecru', 'warm', 'charcoal'][index];
  return `
    <section class="service service--${style}"${index === 0 ? ' id="services"' : ''}>
      <div>
        <p class="service-num r">${String(index + 1).padStart(2, '0')}</p>
        <h2 class="service-title r d1">${homeText(key + '.heading')}</h2>
      </div>
      <div class="r d2">
        <p class="service-copy">${homeText(key + '.intro')}</p>
        <ul class="caps">
          ${service.capabilities.map((_, i) => {
            const field = `${key}.capabilities.${i}`;
            return `<li class="cap-item">
              <button class="cap-btn"><span>${homeText(field + '.heading', false)}</span><span class="cap-icon">+</span></button>
              <div class="cap-body"><div class="cap-inner">${homeText(field + '.description')}</div></div>
            </li>`;
          }).join('')}
        </ul>
      </div>
    </section>`;
}

function homePlayer() {
  const urls = CaseCopy.videoUrls(home.hero.video);
  if (!urls) return '';
  const url = new URL(urls.player);
  for (const [key, value] of Object.entries({ background: 1, autoplay: 1, loop: 1, muted: 1, byline: 0, title: 0 })) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

function videoOptionsButton(projectId, hasVideo) {
  return `<div class="case-video-editor${projectId === 'homepage' ? ' home-video-editor' : ''}">
    <button type="button" data-video-options="${CaseCopy.escape(projectId)}" aria-haspopup="dialog">${hasVideo ? 'Edit video' : 'Add video'}</button>
  </div>`;
}

// ── RENDER: HOME ──────────────────────────────────────────
function renderHome(preserveScroll = false) {
  if (!home) return;
  if (homeEditing()) homeFields ??= HomeContent.fields(home);
  currentView = 'home';
  document.title = home.seo.title;
  setMeta(home.seo.description);
  const opened = preserveScroll ? [...document.querySelectorAll('.cap-item')].map(item => item.classList.contains('open')) : [];
  if (!preserveScroll) window.scrollTo(0, 0);

  const featured = (portfolioPreview || PROJECTS)
    .filter(p => p.featured)
    .sort((a, b) => (a.featuredOrder || 99) - (b.featuredOrder || 99));

  document.getElementById('app').innerHTML = `

    <section class="hero" id="hero">
      ${home.hero.video ? `<div class="hero-video">
        <iframe
          src="${CaseCopy.escape(homePlayer())}" title="Pixelpusher reel"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>` : ''}
      <div class="hero-overlay"></div>
      ${homeEditing() ? videoOptionsButton('homepage', Boolean(home.hero.video)) : ''}
      <p class="hero-eyebrow">${homeText('hero.eyebrow')}</p>
      <h1 class="hero-h1">${homeText('hero.headline')}</h1>
      <p class="hero-sub">${homeText('hero.intro')}</p>
      <span class="hero-location">${homeText('hero.established')}</span>
      <span class="hero-scroll">${homeText('hero.scrollLabel')}</span>
    </section>

    <section class="work" id="work">
      <div class="section-header r">
        <span class="section-header-title">${homeText('work.heading')}</span>
        <a href="#/work" class="section-header-link">${homeText('work.linkLabel')}</a>
      </div>
      <p class="work-intro r d1">${homeText('work.intro')}</p>
      <div class="work-grid">
        ${buildGrid(featured, true)}
      </div>
    </section>

    ${home.services.map(homeService).join('')}

    <section class="about" id="about">
      <h2 class="about-h2 r">${homeText('about.heading')}</h2>
      <div class="about-stats">
        <div>
          <p class="stat-n r"${homeStat(0)}>0</p>
          <p class="stat-l">${homeText('about.stats.0.label')}</p>
        </div>
        <div>
          <p class="stat-n r d1"${homeStat(1)}>0</p>
          <p class="stat-l">${homeText('about.stats.1.label')}</p>
        </div>
        <div>
          <p class="stat-n r d2"${homeStat(2)}>0</p>
          <p class="stat-l">${homeText('about.stats.2.label')}</p>
        </div>
      </div>
      <div class="about-body">
        <p class="about-p r">${homeText('about.paragraphs.0')}</p>
        <p class="about-p r d1">${homeText('about.paragraphs.1')}</p>
      </div>
    </section>

    <section class="clients">
      <p class="clients-label">${homeText('clients.heading')}</p>
      <div class="marquee">
        ${homeMarquee()}
      </div>
    </section>

    <section class="contact" id="contact">
      <p class="contact-label r">${homeText('contact.eyebrow')}</p>
      <h2 class="contact-h2 r d1">${homeText('contact.heading')}</h2>
      <p class="contact-sub r d2">${homeText('contact.intro')}</p>
      <a href="mailto:${CaseCopy.escape(home.contact.email)}" class="contact-btn r d3">${homeText('contact.linkLabel')}</a>
    </section>

  `;

  initReveal();
  initCaps();
  document.querySelectorAll('.cap-item').forEach((item, index) => item.classList.toggle('open', Boolean(opened[index])));
}

// ── CAPS EXPAND ───────────────────────────────────────────
function initCaps() {
  document.querySelectorAll('.cap-item').forEach(item => {
    const btn = item.querySelector('.cap-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      item.closest('.caps').querySelectorAll('.cap-item').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
}

// ── RENDER: ALL PROJECTS ──────────────────────────────────
function renderWork() {
  currentView = 'work';
  document.title = 'All Projects \u2014 Pixelpusher';
  setMeta('Every campaign, digital experience, and brand moment Pixelpusher has created over 25 years.');
  window.scrollTo(0, 0);

  document.getElementById('app').innerHTML = `

    <section class="hero hero--short">
      <p class="hero-eyebrow">Pixelpusher \u2014 All Projects</p>
      <h1 class="hero-h1">Every<br>Impossible<br>Thing We\u2019ve Done</h1>
      <p class="hero-sub">25 years of campaigns, digital experiences, and brand moments that changed how people feel about the brands they love.</p>
    </section>

    <div class="work-grid">
      ${buildGrid(portfolioPreview || PROJECTS, false)}
    </div>

  `;

  initReveal();
}

// ── RENDER: CASE STUDY ────────────────────────────────────
function caseProject(id) {
  return editorPreview && draftCaseId === id && /^draft-[a-f0-9-]{36}$/.test(id)
    ? Portfolio.starter(id) : (portfolioPreview || PROJECTS).find(project => project.id === id);
}

function videoBlock(id) {
  return `<div class="case-gallery-wide case-gallery-video r" data-vimeo="${CaseCopy.escape(id)}">
    <div class="video-thumb"></div>
    <button class="video-play" aria-label="Play video">
      <span class="play-ring"><svg viewBox="0 0 40 40"><polygon points="14,10 32,20 14,30" fill="white"/></svg></span>
      <span class="play-label">Play</span>
    </button>
  </div>`;
}

function renderCase(id, preserveScroll = false) {
  const stored = caseProject(id);
  const p = stored && casePreview?.projectId === id ? CaseCopy.apply(stored, casePreview.values) : stored;

  if (!p || p.comingSoon) {
    location.hash = '#/work';
    return;
  }

  currentView = `case:${id}`;
  const clientName = CaseCopy.read(p, 'client');
  const projectTitle = CaseCopy.read(p, 'title').replaceAll('\n', ' ');
  document.title = `${clientName} \u2014 ${projectTitle} \u2014 Pixelpusher`;
  setMeta(`How Pixelpusher created ${projectTitle} for ${clientName}. ${p.tagline || ''}`);
  if (!preserveScroll) window.scrollTo(0, 0);

  const next = p.nextProject ? PROJECTS.find(x => x.id === p.nextProject) : null;

  // Build gallery blocks
  const galleryBlocks = [];
  const imgs = p.gallery;
  let videoInserted = false;
  for (let i = 0; i < imgs.length; i++) {
    const g = imgs[i];
    if (g.wide) {
      if (!videoInserted && p.vimeoId) {
        videoInserted = true;
        if (p.videoId === undefined && !editorPreview) galleryBlocks.push(videoBlock(p.vimeoId));
      } else {
        galleryBlocks.push(`
      <div class="case-gallery-wide r">
        ${galleryImage(g, i)}
      </div>`);
      }
    } else {
      // Pair up two consecutive non-wide images
      const n = imgs[i + 1];
      if (n && !n.wide) {
        galleryBlocks.push(`
      <div class="case-gallery-pair">
        <div class="case-gallery-half r d1">
          ${galleryImage(g, i)}
        </div>
        <div class="case-gallery-half r d2">
          ${galleryImage(n, i + 1)}
        </div>
      </div>`);
        i++; // consumed next item
      } else {
        galleryBlocks.push(`
      <div class="case-gallery-pair">
        <div class="case-gallery-half r">
          ${galleryImage(g, i)}
        </div>
      </div>`);
      }
    }
  }

  // h1 line breaks: use titleLines if defined, else split on first space
  const h1Html = p.titleLines
    ? p.titleLines.join('<br>')
    : p.title.replace(' ', '<br>');

  // Case-copy paragraphs with stagger
  const copyHtml = p.copy.map((para, i) => {
    const d = i === 0 ? ' d1' : i === 1 ? ' d2' : ' d3';
    return `<p class="case-copy r${d}"${editableCopy('copy', i)}>${para}</p>`;
  }).join('\n        ');

  // Next project block
  const nextH1 = next
    ? (next.titleLines ? next.titleLines.join('<br>') : next.title.replace(' ', '<br>'))
    : '';
  const nextBlock = next ? `
    <section class="case-next">
      <p class="case-next-label r">Next Project</p>
      <a href="#/work/${next.id}" class="case-next-link r d1">${next.client}<br>${nextH1}</a>
      <br>
      <a href="#/work" class="case-back r d2">\u2190 All Projects</a>
    </section>` : `
    <section class="case-next">
      <a href="#/work" class="case-back r">\u2190 All Projects</a>
    </section>`;

  document.getElementById('app').innerHTML = `

    <section class="case-hero">
      <div class="case-hero-img">
        <img src="${CaseCopy.escape(p.heroImg || heroUrl(p.heroSeed))}" alt="${p.heroAlt ? CaseCopy.escape(p.heroAlt) : `${p.client} \u2014 ${p.title}`}"${editorPreview && !portfolioPreview ? ' data-edit-image="hero"' : ''} />
      </div>
      ${editorPreview && !portfolioPreview ? '<button class="edit-hero-image" type="button" data-edit-image="hero">Edit hero image</button>' : ''}
      <p class="case-eyebrow"${editableCopy('client')}>${p.client}</p>
      <h1 class="case-h1"${editableCopy('title')}>${h1Html}</h1>
      <p class="case-tagline"${editableCopy('tagline')}></p>
      <span class="case-hero-scroll">Scroll to explore</span>
    </section>

    <section class="case-meta">
      <div>
        <p class="case-meta-label">Client</p>
        <p class="case-meta-value"${editableCopy('clientCredit')}>${p.meta.client}</p>
      </div>
      <div>
        <p class="case-meta-label">Agency</p>
        <p class="case-meta-value"${editableCopy('agency')}>${p.meta.agency || (editorPreview ? '' : '\u2014')}</p>
      </div>
      <div>
        <p class="case-meta-label">Services</p>
        <p class="case-meta-value"${editableCopy('services')}>${p.meta.services.join('<br>')}</p>
      </div>
      <div>
        <p class="case-meta-label">Industry</p>
        <p class="case-meta-value"${editableCopy('industry')}>${p.meta.industry}</p>
      </div>
    </section>

    <section class="case-overview">
      ${editorPreview
        ? `<p class="case-pull r"${editableCopy('pullQuote')}>${p.pullQuote || ''}</p>`
        : p.pullQuote ? `<p class="case-pull r">\u201c${p.pullQuote}\u201d</p>` : ''}
      <div>
        ${copyHtml}
      </div>
    </section>

    ${editorPreview && !portfolioPreview ? videoOptionsButton(id, Boolean(CaseCopy.read(p, 'video'))) : ''}
    ${p.videoId || (editorPreview && p.videoId === undefined && p.vimeoId)
      ? videoBlock(CaseCopy.read(p, 'video')) : ''}

    <div class="case-gallery">
      ${galleryBlocks.join('')}
    </div>

    ${nextBlock}

  `;
  document.querySelector('.case-tagline').textContent =
    p.tagline;

  initReveal();
  fitTitle();
  initVideoBlocks();
  if (editorPreview) syncEditableCopy();
}

// ── VIDEO BLOCKS ──────────────────────────────────────────
function initVideoBlocks() {
  document.querySelectorAll('.case-gallery-video').forEach(block => {
    const urls = CaseCopy.videoUrls(block.dataset.vimeo);
    if (!urls) return;
    const player = new URL(urls.player);
    for (const [key, value] of Object.entries({ autoplay: '1', title: '0', byline: '0', portrait: '0' })) {
      player.searchParams.set(key, value);
    }
    const thumb = block.querySelector('.video-thumb');

    // Fetch thumbnail via Vimeo oEmbed
    fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(urls.watch)}`)
      .then(r => r.json())
      .then(data => {
        if (data.thumbnail_url && thumb) {
          const url = data.thumbnail_url
            .split('?')[0]
            .replace(/(-d_|_)\d+x\d+(\.\w+)?$/, '$11280x720$2');
          thumb.style.backgroundImage = `url(${url})`;
          thumb.classList.add('loaded');
        }
      })
      .catch(() => {});

    // Click to swap in the live player
    block.addEventListener('click', () => {
      block.innerHTML = `<iframe src="${CaseCopy.escape(player.href)}" title="Case study video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
      block.classList.add('playing');
      // Hide cursor immediately — iframe steals all mouse events from here
      document.getElementById('cur').style.opacity = '0';
    });

    // Restore cursor when mouse leaves the video block
    block.addEventListener('mouseleave', () => {
      if (block.classList.contains('playing')) {
        document.getElementById('cur').style.opacity = '1';
      }
    });

    // Re-hide cursor if mouse re-enters a playing block
    block.addEventListener('mouseenter', () => {
      if (block.classList.contains('playing')) {
        document.getElementById('cur').style.opacity = '0';
      }
    });
  });
}

// ── FIT TITLE ─────────────────────────────────────────────
// Scales .case-h1 down until no single word overflows the container.
function fitTitle() {
  const h1 = document.querySelector('.case-h1');
  if (!h1) return;
  h1.style.fontSize = '';
  let fs = parseFloat(window.getComputedStyle(h1).fontSize);
  while (h1.scrollWidth > h1.clientWidth && fs > 20) {
    fs--;
    h1.style.fontSize = fs + 'px';
  }
}

// ── UTILITY ───────────────────────────────────────────────
function setMeta(content) {
  const el = document.querySelector('meta[name="description"]');
  if (el) el.setAttribute('content', content);
}

// ── BOOT ──────────────────────────────────────────────────
fetch('/home.json')
  .then(response => {
    if (!response.ok) throw new Error('Could not load homepage content.');
    return response.json();
  })
  .then(content => {
    home ??= content;
    if (portfolioPreviewView === 'featured' && currentView !== 'home') renderPortfolioGrid('featured');
    else if (!currentView) route();
  })
  .catch(() => {
    if (!currentView && (!location.hash || location.hash === '#/')) {
      document.getElementById('app').textContent = 'Could not load homepage content.';
    }
  });

fetch('projects.json')
  .then(r => r.json())
  .then(data => {
    PROJECTS = data;
    if (!portfolioPreview) route();
    if (homeEditing()) sendHomeReady();
  })
  .catch(() => {
    document.getElementById('app').innerHTML =
      '<p style="padding:8rem var(--gutter);color:var(--mid)">Failed to load projects data. Try running from a local server.</p>';
  });
