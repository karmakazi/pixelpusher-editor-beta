'use strict';

const CaseCopy = (() => {
  const fields = {
    client: { label: 'Brand name', max: 100, required: true },
    title: { label: 'Project title', max: 160, required: true, list: '\n' },
    tagline: { label: 'Intro', max: 600, required: true },
    clientCredit: { label: 'Client credit', max: 200, required: true },
    agency: { label: 'Agency credit', max: 200 },
    services: { label: 'Services', max: 600, list: '\n' },
    industry: { label: 'Industry', max: 200 },
    pullQuote: { label: 'Pull quote', max: 600 },
    copy: { label: 'Body copy', max: 12000, required: true, list: '\n\n' },
  };
  const metadata = { clientCredit: 'client', agency: 'agency', services: 'services', industry: 'industry' };
  const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);
  const encode = value => value.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function read(project, field) {
    if (field === 'title') return (project.titleLines || [project.title]).map(decode).join('\n');
    const value = Object.hasOwn(metadata, field) ? project.meta[metadata[field]] : project[field];
    if (Array.isArray(value)) return value.map(decode).join(fields[field].list);
    if (field === 'tagline') return value || '';
    return decode(value || '');
  }

  function valid(field, value) {
    if (!Object.hasOwn(fields, field) || typeof value !== 'string') return false;
    const { max, required, list } = fields[field];
    return value.length <= max && (!required || Boolean(value.trim())) &&
      (Boolean(list) || !/[\r\n]/.test(value));
  }

  function normalize(field, value) {
    if (field === 'copy') return value.trim().split(/\n\s*\n/).map(p => p.trim()).join('\n\n');
    if (fields[field].list) return value.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
    return value.trim();
  }

  function apply(project, values) {
    const updated = { ...project, meta: { ...project.meta } };
    for (const [field, value] of Object.entries(values)) {
      const text = encode(value);
      if (field === 'title') {
        updated.titleLines = text.split('\n');
        updated.title = updated.titleLines.join(' ');
      } else if (field === 'services') {
        updated.meta.services = text ? text.split('\n') : [];
      } else if (field === 'copy') {
        updated.copy = text.split('\n\n');
      } else if (Object.hasOwn(metadata, field)) {
        updated.meta[metadata[field]] = text;
      } else {
        updated[field] = field === 'tagline' ? value : text;
      }
    }
    return updated;
  }

  return { fields, read, valid, normalize, apply };
})();

if (typeof module !== 'undefined') module.exports = CaseCopy;
