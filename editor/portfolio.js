'use strict';

const Portfolio = ((CaseCopy) => {
  function order(projects) {
    return {
      work: projects.map(project => project.id),
      featured: projects.filter(project => project.featured)
        .sort((a, b) => (a.featuredOrder || 99) - (b.featuredOrder || 99))
        .map(project => project.id),
    };
  }

  function create(input, previewOrigin) {
    if (!input || typeof input.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id) ||
        input.id.length > 100) throw Error('Enter a valid project URL slug.');
    const fields = ['client', 'title', 'tagline', 'agency', 'services', 'industry', 'pullQuote', 'copy'];
    const values = {};
    for (const field of fields) {
      const value = input[field] ?? '';
      if (!CaseCopy.valid(field, value) || !CaseCopy.valid(field, CaseCopy.normalize(field, value))) throw Error(`Check the ${CaseCopy.fields[field].label.toLowerCase()} field.`);
      values[field] = CaseCopy.normalize(field, value);
    }
    if (!input.image || !(previewOrigin ? CaseCopy.validPreview('hero:url', input.image, previewOrigin) : CaseCopy.valid('hero:url', input.image)) ||
        !CaseCopy.valid('hero:alt', input.alt ?? '')) throw Error('Provide a valid hero image URL and alt text.');
    return CaseCopy.apply({
      id: input.id, meta: {}, gallery: [], comingSoon: false,
    }, { ...values, clientCredit: values.client, 'hero:url': input.image, 'hero:alt': input.alt ?? '' });
  }

  function starter(id) {
    const placeholder = '/img/case-study-placeholder.png';
    return {
      id, client: 'Brand name', title: 'Project title',
      tagline: 'Write a short introduction to this project.',
      pullQuote: 'Add a quote or a standout line from the project.',
      copy: ['Describe the brief and what your team set out to achieve.',
        'Describe what you made and what happened next.'],
      meta: { client: 'Client name', agency: '', services: [], industry: '' },
      heroImg: placeholder, heroAlt: 'Hero image placeholder',
      gallery: [
        { wide: false, src: placeholder, alt: 'Gallery image placeholder' },
        { wide: false, src: placeholder, alt: 'Gallery image placeholder' },
        { wide: true, src: placeholder, alt: 'Gallery image placeholder' },
      ],
      comingSoon: false,
    };
  }

  function newDraft(id, changes, finalId) {
    if (!/^draft-[a-f0-9-]{36}$/.test(id) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalId) || finalId.length > 100) {
      throw Error('Invalid project URL.');
    }
    const project = starter(id);
    for (const [field, value] of Object.entries(changes)) {
      if (!CaseCopy.hasField(project, field) || !CaseCopy.valid(field, value) ||
          CaseCopy.normalize(field, value) !== value) throw Error('Check the edited case-study fields.');
    }
    const updated = CaseCopy.apply(project, changes);
    for (const field of ['client', 'title', 'tagline', 'copy']) {
      const original = CaseCopy.read(project, field);
      const edited = CaseCopy.read(updated, field);
      if (edited.split('\n\n').some(value => original.split('\n\n').includes(value))) {
        throw Error('Replace the placeholder brand, title, intro and body copy before publishing.');
      }
    }
    if (!updated.heroImg || updated.heroImg === project.heroImg) throw Error('Replace the placeholder hero image before publishing.');
    if (updated.meta.client === project.meta.client) updated.meta.client = updated.client;
    if (updated.heroAlt === project.heroAlt) delete updated.heroAlt;
    for (const image of updated.gallery) if (image.alt === 'Gallery image placeholder') image.alt = '';
    if (updated.pullQuote === project.pullQuote) updated.pullQuote = '';
    updated.gallery = updated.gallery.filter(image => image.src && image.src !== project.heroImg);
    updated.id = finalId;
    return updated;
  }

  function arrange(projects, lists) {
    const byId = new Map(projects.map(project => [project.id, project]));
    if (!Array.isArray(lists?.work) || !Array.isArray(lists.featured) ||
        lists.work.length !== byId.size || new Set(lists.work).size !== byId.size ||
        new Set(lists.featured).size !== lists.featured.length ||
        [...lists.work, ...lists.featured].some(id => !byId.has(id))) {
      throw Error('The project lists changed. Reload and try again.');
    }
    const featured = new Map(lists.featured.map((id, index) => [id, index + 1]));
    return lists.work.map(id => {
      const project = byId.get(id);
      const position = featured.get(id);
      if (position ? project.featured && project.featuredOrder === position : !project.featured) return project;
      const updated = { ...project, featured: Boolean(position) };
      if (position) updated.featuredOrder = position;
      else delete updated.featuredOrder;
      return updated;
    });
  }

  return { order, create, starter, newDraft, arrange };
})(typeof module !== 'undefined' ? require('./case-copy') : CaseCopy);

if (typeof module !== 'undefined') module.exports = Portfolio;
