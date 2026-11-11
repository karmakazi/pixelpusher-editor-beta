'use strict';

// ── STATE ──────────────────────────────────────────────────
let PROJECTS = [];
let currentView = null;
let revealObs = null;
let introPreview = null;

if (window.parent !== window && new URLSearchParams(location.search).has('editor-preview')) {
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const { type, projectId, tagline } = event.data || {};
    if (type !== 'pixelpusher-intro-preview' || typeof projectId !== 'string' ||
        typeof tagline !== 'string' || tagline.length > 240) return;
    introPreview = { projectId, tagline };
    const intro = document.querySelector('.case-tagline');
    if (intro && currentView === `case:${projectId}`) intro.textContent = tagline;
  });
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
  if (!PROJECTS.length) return;

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
 * @param {boolean} isHome  - true = use featuredWide flag; false = use wide flag
 * @param {boolean} eager   - true = loading="eager"
 * @param {string} delay    - CSS delay class ('d1', 'd2', or '')
 */
function workCard(p, isHome, eager, delay) {
  const wide    = isHome ? p.featuredWide : p.wide;
  const locked  = p.comingSoon;
  const tag     = locked ? 'div' : 'a';
  const href    = locked ? '' : `href="#/work/${p.id}"`;
  const classes = [
    'work-item',
    wide   ? 'work-item--wide'   : '',
    locked ? 'work-item--locked' : '',
    'r',
    delay  || '',
  ].filter(Boolean).join(' ');
  const loading = eager ? 'eager' : 'lazy';
  const badge   = locked
    ? '<span class="work-soon">Coming Soon</span>'
    : '<span class="work-cta">View \u2192</span>';

  return `
    <${tag} ${href} class="${classes}">
      <img src="${p.heroImg || thumbUrl(p.thumbSeed, wide)}" alt="${p.client} \u2014 ${p.title}" loading="${loading}" />
      <div class="work-caption">
        <p class="work-client">${p.client}</p>
        <p class="work-title">${p.title}</p>
      </div>
      ${badge}
    </${tag}>`;
}

/**
 * Build grid card HTML for an ordered list of projects,
 * computing stagger delay classes automatically.
 */
function buildGrid(projects, isHome) {
  let col = 0; // tracks left(0) / right(1) column position
  return projects.map((p, i) => {
    const wide = isHome ? p.featuredWide : p.wide;
    let delay = '';
    if (!wide) {
      delay = col === 0 ? '' : 'd1';
      col = (col + 1) % 2;
    } else {
      col = 0; // wide spans full row, reset
    }
    const eager = isHome && i === 0; // first card loads eagerly
    return workCard(p, isHome, eager, delay);
  }).join('');
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

function marqueeHtml() {
  const names = [
    'Colgate', 'Cadillac', 'Gatorade', 'Adidas', 'Ford', 'Shiseido',
    'D\u2019Italiano', 'Sport Chek', 'Volkswagen',
    'Rick Hansen Foundation', 'Michael Hill', 'MiO',
  ];
  // Doubled for seamless loop
  return [...names, ...names]
    .map(n => `<span class="marquee-name">${n}</span><span class="marquee-sep">\u2014</span>`)
    .join('');
}

// ── RENDER: HOME ──────────────────────────────────────────
function renderHome() {
  currentView = 'home';
  document.title = 'Pixelpusher \u2014 We Do Impossible';
  setMeta('Pixelpusher is a Toronto-based creative studio building campaigns, digital experiences, and brand moments for the world\u2019s most ambitious brands.');
  window.scrollTo(0, 0);

  const featured = PROJECTS
    .filter(p => p.featured)
    .sort((a, b) => (a.featuredOrder || 99) - (b.featuredOrder || 99));

  document.getElementById('app').innerHTML = `

    <section class="hero" id="hero">
      <div class="hero-video">
        <iframe
          src="https://player.vimeo.com/video/1217666625?h=dfce6ecff5&background=1&autoplay=1&loop=1&muted=1&byline=0&title=0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
      <div class="hero-overlay"></div>
      <p class="hero-eyebrow">Creative Studio \u2014 Toronto</p>
      <h1 class="hero-h1">We Do<br>Impossible</h1>
      <p class="hero-sub">Twenty-five years of campaigns, digital experiences, and brand moments that changed how people feel about the brands they love.</p>
      <span class="hero-location">Est. 1999</span>
      <span class="hero-scroll">Scroll to explore</span>
    </section>

    <section class="work" id="work">
      <div class="section-header r">
        <span class="section-header-title">Selected Work</span>
        <a href="#/work" class="section-header-link">All Projects \u2192</a>
      </div>
      <p class="work-intro r d1">Ambitious briefs. Impossible results. A curated look at work that moved culture for the world\u2019s biggest brands.</p>
      <div class="work-grid">
        ${buildGrid(featured, true)}
      </div>
    </section>

    <section class="service service--cream" id="services">
      <div>
        <p class="service-num r">01</p>
        <h2 class="service-title r d1">User<br>Experience</h2>
      </div>
      <div class="r d2">
        <p class="service-copy">We design digital products people actually want to use. From the first interaction to the last, we map every moment of friction, every point of delight, and build experiences that feel inevitable \u2014 like they couldn\u2019t have been made any other way.</p>
        <ul class="caps">
          <li class="cap-item">
            <button class="cap-btn"><span>UX Research &amp; Strategy</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">We start by understanding people before we start designing for them. Interviews, usability tests, and analytics \u2014 we dig until we know what actually matters.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Information Architecture</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Every piece of content has a home. We build the structures that make complex information feel effortless to navigate.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Interaction Design</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">The details that make digital feel physical. Micro-interactions, transitions, and feedback states that turn using software into a pleasure.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Prototyping &amp; Testing</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">We build to learn. Rapid prototypes put real ideas in front of real people before a single line of production code is written.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Design Systems</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Consistency at scale. A single source of truth for every component, pattern, and decision across your entire product.</div></div>
          </li>
        </ul>
      </div>
    </section>

    <section class="service service--ecru">
      <div>
        <p class="service-num r">02</p>
        <h2 class="service-title r d1">Development</h2>
      </div>
      <div class="r d2">
        <p class="service-copy">Code is craft. We build what others say can\u2019t be built \u2014 performant, accessible, and obsessively detailed. Whether it\u2019s a marketing site or a custom interactive platform, we write the kind of code that holds up five years from now.</p>
        <ul class="caps">
          <li class="cap-item">
            <button class="cap-btn"><span>Web &amp; Application Development</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">From marketing sites to complex web apps, we build with modern standards \u2014 fast, accessible, and designed to last.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Custom CMS Integration</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Content management that fits the way your team actually works. We make Sanity, Contentful, and Prismic feel completely native to your product.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>API &amp; Backend Engineering</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">The invisible architecture that makes everything run. Scalable, secure, and designed for the demands of modern digital products.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Performance Optimization</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Speed is a feature. We audit, refactor, and optimize until your product loads fast on any device, anywhere in the world.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>QA &amp; Launch Support</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Nothing ships without our sign-off. We test across devices, browsers, and edge cases so launch day is a celebration, not a crisis.</div></div>
          </li>
        </ul>
      </div>
    </section>

    <section class="service service--warm">
      <div>
        <p class="service-num r">03</p>
        <h2 class="service-title r d1">Digital<br>Activations</h2>
      </div>
      <div class="r d2">
        <p class="service-copy">The best brand moments don\u2019t live on a screen \u2014 they happen in the world and get shared everywhere else. We design physical-digital experiences that put people inside the story, from concept through build to the last social post.</p>
        <ul class="caps">
          <li class="cap-item">
            <button class="cap-btn"><span>Experiential Concept &amp; Design</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">The big idea that makes people stop, stay, and share. We concept experiences that are genuinely worth showing up for.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Interactive Installations</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Physical technology that responds to people in real time \u2014 touch, motion, sound, and light, orchestrated into a single unforgettable moment.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Event Technology</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">The infrastructure behind the magic. Custom software, hardware integration, and tech production that runs flawlessly under pressure.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Content Capture &amp; Distribution</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Every activation is a content opportunity. We plan the capture strategy before the doors open so nothing great goes unrecorded.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Live Production Support</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">On the ground, on the day. Our team manages every technical aspect of your activation from load-in to strike.</div></div>
          </li>
        </ul>
      </div>
    </section>

    <section class="service service--charcoal">
      <div>
        <p class="service-num r">04</p>
        <h2 class="service-title r d1">Artificial<br>Intelligence</h2>
      </div>
      <div class="r d2">
        <p class="service-copy">AI isn\u2019t a trend we\u2019re chasing \u2014 it\u2019s a tool we\u2019ve been building with. We use it to accelerate creative, personalize experiences at scale, and solve problems that used to require ten times the budget and twice the time.</p>
        <ul class="caps">
          <li class="cap-item">
            <button class="cap-btn"><span>Generative Creative Production</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">AI that accelerates without homogenizing. We use generative tools to push creative volume and variation while keeping the work unmistakably yours.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>AI-Powered Personalization</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Experiences that adapt in real time to who is experiencing them. Relevance at a scale no human team could manage alone.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Conversational Interfaces</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">Chatbots built to actually be useful \u2014 trained on your brand voice, connected to your data, and designed for real conversations.</div></div>
          </li>
          <li class="cap-item">
            <button class="cap-btn"><span>Workflow Automation</span><span class="cap-icon">+</span></button>
            <div class="cap-body"><div class="cap-inner">The repetitive work that drains your team? We automate it \u2014 briefing, resizing, reporting, scheduling \u2014 so people can focus on what only people can do.</div></div>
          </li>
        </ul>
      </div>
    </section>

    <section class="about" id="about">
      <h2 class="about-h2 r">Impossible<br>is our<br>brief.</h2>
      <div class="about-stats">
        <div>
          <p class="stat-n r" data-count="25" data-suffix="+">0</p>
          <p class="stat-l">Years of doing impossible</p>
        </div>
        <div>
          <p class="stat-n r d1" data-count="200" data-suffix="+">0</p>
          <p class="stat-l">Campaigns launched worldwide</p>
        </div>
        <div>
          <p class="stat-n r d2" data-count="47">0</p>
          <p class="stat-l">Industry awards</p>
        </div>
      </div>
      <div class="about-body">
        <p class="about-p r">Pixelpusher is a Toronto-based creative studio that has spent over two decades proving that the best ideas are the ones nobody thought could work. We are relentless in the pursuit of work that matters \u2014 work that changes how people feel about a brand, a product, or an idea.</p>
        <p class="about-p r d1">We\u2019ve partnered with Colgate, Cadillac, Gatorade, Adidas, Ford, and Shiseido, among many others. The briefs were ambitious. The results were things nobody had seen before. That\u2019s not a coincidence \u2014 that\u2019s the standard we set for every project we take on.</p>
      </div>
    </section>

    <section class="clients">
      <p class="clients-label">Our Clients</p>
      <div class="marquee">
        ${marqueeHtml()}
      </div>
    </section>

    <section class="contact" id="contact">
      <p class="contact-label r">Get in Touch</p>
      <h2 class="contact-h2 r d1">Ready to do<br>impossible?</h2>
      <p class="contact-sub r d2">Let\u2019s build something nobody\u2019s ever seen before. Tell us about your brief \u2014 the more impossible it sounds, the more interested we are.</p>
      <a href="mailto:hello@pixelpusher.ca" class="contact-btn r d3">Start a Project \u2192</a>
    </section>

  `;

  initReveal();
  initCaps();
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
      ${buildGrid(PROJECTS, false)}
    </div>

  `;

  initReveal();
}

// ── RENDER: CASE STUDY ────────────────────────────────────
function renderCase(id) {
  const p = PROJECTS.find(x => x.id === id);

  if (!p || p.comingSoon) {
    location.hash = '#/work';
    return;
  }

  currentView = `case:${id}`;
  document.title = `${p.client} \u2014 ${p.title} \u2014 Pixelpusher`;
  setMeta(`How Pixelpusher created ${p.title} for ${p.client}. ${p.tagline || ''}`);
  window.scrollTo(0, 0);

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
        galleryBlocks.push(`
      <div class="case-gallery-wide case-gallery-video r" data-vimeo="${p.vimeoId}">
        <div class="video-thumb"></div>
        <button class="video-play" aria-label="Play video">
          <span class="play-ring">
            <svg viewBox="0 0 40 40"><polygon points="14,10 32,20 14,30" fill="white"/></svg>
          </span>
          <span class="play-label">Play</span>
        </button>
      </div>`);
      } else {
        galleryBlocks.push(`
      <div class="case-gallery-wide r">
        <img src="${galleryUrl(g.seed, true)}" alt="${g.alt}" loading="lazy" />
      </div>`);
      }
    } else {
      // Pair up two consecutive non-wide images
      const n = imgs[i + 1];
      if (n && !n.wide) {
        galleryBlocks.push(`
      <div class="case-gallery-pair">
        <div class="case-gallery-half r d1">
          <img src="${galleryUrl(g.seed, false)}" alt="${g.alt}" loading="lazy" />
        </div>
        <div class="case-gallery-half r d2">
          <img src="${galleryUrl(n.seed, false)}" alt="${n.alt}" loading="lazy" />
        </div>
      </div>`);
        i++; // consumed next item
      } else {
        galleryBlocks.push(`
      <div class="case-gallery-pair">
        <div class="case-gallery-half r">
          <img src="${galleryUrl(g.seed, false)}" alt="${g.alt}" loading="lazy" />
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
    return `<p class="case-copy r${d}">${para}</p>`;
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
        <img src="${p.heroImg || heroUrl(p.heroSeed)}" alt="${p.client} \u2014 ${p.title}" />
      </div>
      <p class="case-eyebrow">${p.client}</p>
      <h1 class="case-h1">${h1Html}</h1>
      <p class="case-tagline"></p>
      <span class="case-hero-scroll">Scroll to explore</span>
    </section>

    <section class="case-meta">
      <div>
        <p class="case-meta-label">Client</p>
        <p class="case-meta-value">${p.meta.client}</p>
      </div>
      <div>
        <p class="case-meta-label">Agency</p>
        <p class="case-meta-value">${p.meta.agency || '\u2014'}</p>
      </div>
      <div>
        <p class="case-meta-label">Services</p>
        <p class="case-meta-value">${p.meta.services.join('<br>')}</p>
      </div>
      <div>
        <p class="case-meta-label">Industry</p>
        <p class="case-meta-value">${p.meta.industry}</p>
      </div>
    </section>

    <section class="case-overview">
      <p class="case-pull r">\u201c${p.pullQuote}\u201d</p>
      <div>
        ${copyHtml}
      </div>
    </section>

    <div class="case-gallery">
      ${galleryBlocks.join('')}
    </div>

    ${nextBlock}

  `;
  document.querySelector('.case-tagline').textContent =
    introPreview?.projectId === id ? introPreview.tagline : p.tagline;

  initReveal();
  fitTitle();
  initVideoBlocks();
}

// ── VIDEO BLOCKS ──────────────────────────────────────────
function initVideoBlocks() {
  document.querySelectorAll('.case-gallery-video').forEach(block => {
    const id = block.dataset.vimeo;
    const thumb = block.querySelector('.video-thumb');

    // Fetch thumbnail via Vimeo oEmbed
    fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}`)
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
      block.innerHTML = `<iframe src="https://player.vimeo.com/video/${id}?autoplay=1&title=0&byline=0&portrait=0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
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
fetch('projects.json')
  .then(r => r.json())
  .then(data => {
    PROJECTS = data;
    route();
  })
  .catch(() => {
    document.getElementById('app').innerHTML =
      '<p style="padding:8rem var(--gutter);color:var(--mid)">Failed to load projects data. Try running from a local server.</p>';
  });
