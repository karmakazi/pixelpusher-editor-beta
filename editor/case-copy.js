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

  function imageField(field) {
    const match = /^(hero|gallery:(0|[1-9]\d{0,2})):(url|alt)$/.exec(field);
    return match ? { index: match[2] === undefined ? null : Number(match[2]), type: match[3] } : null;
  }

  function definition(field) {
    if (Object.hasOwn(fields, field)) return fields[field];
    const image = imageField(field);
    if (!image) return null;
    const label = image.index === null ? 'Hero image' : `Gallery image ${image.index + 1}`;
    return { label: `${label} ${image.type === 'url' ? 'URL' : 'alt text'}`, max: image.type === 'url' ? 2048 : 300 };
  }

  function hasField(project, field) {
    if (Object.hasOwn(fields, field)) return true;
    const image = imageField(field);
    return Boolean(image && (image.index === null || (project.gallery[image.index] &&
      (!project.vimeoId || image.index !== project.gallery.findIndex(item => item.wide)))));
  }

  function validImageUrl(value) {
    if (!value) return true;
    if (value.length > 2048 || /[\s<>"'\\]/.test(value)) return false;
    if (/^\/?img\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(value)) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function read(project, field) {
    const image = imageField(field);
    if (image) {
      if (image.index === null) return (image.type === 'url' ? project.heroImg : project.heroAlt) ?? '';
      const asset = project.gallery[image.index];
      return image.type === 'url' ? asset?.src ?? '' : decode(asset?.alt ?? '');
    }
    if (field === 'title') return (project.titleLines || [project.title]).map(decode).join('\n');
    const value = Object.hasOwn(metadata, field) ? project.meta[metadata[field]] : project[field];
    if (Array.isArray(value)) return value.map(decode).join(fields[field].list);
    if (field === 'tagline') return value || '';
    return decode(value || '');
  }

  function valid(field, value) {
    const details = definition(field);
    if (!details || typeof value !== 'string') return false;
    if (imageField(field)?.type === 'url') return validImageUrl(value);
    const { max, required, list } = details;
    return value.length <= max && (!required || Boolean(value.trim())) &&
      (Boolean(list) || !/[\r\n]/.test(value));
  }

  function normalize(field, value) {
    if (field === 'copy') return value.trim().split(/\n\s*\n/).map(p => p.trim()).join('\n\n');
    if (definition(field).list) return value.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
    return value.trim();
  }

  function apply(project, values) {
    const updated = { ...project, meta: { ...project.meta } };
    for (const [field, value] of Object.entries(values)) {
      const text = encode(value);
      const image = imageField(field);
      if (image) {
        if (image.index === null) {
          updated[image.type === 'url' ? 'heroImg' : 'heroAlt'] = value;
        } else {
          if (updated.gallery === project.gallery) updated.gallery = [...project.gallery];
          const property = image.type === 'url' ? 'src' : 'alt';
          updated.gallery[image.index] = { ...updated.gallery[image.index], [property]: image.type === 'url' ? value : text };
        }
      } else if (field === 'title') {
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

  return { fields, definition, hasField, read, valid, normalize, apply, escape: encode };
})();

if (typeof module !== 'undefined') module.exports = CaseCopy;
