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

  return { order, create, arrange };
})(typeof module !== 'undefined' ? require('./case-copy') : CaseCopy);

if (typeof module !== 'undefined') module.exports = Portfolio;
