'use strict';

const HomeContent = (() => {
  const video = typeof module !== 'undefined' ? require('./case-copy') : CaseCopy;
  const special = {
    'seo.title': 'Page title',
    'seo.description': 'Meta description',
    'hero.video': 'Hero video',
    'clients.names': 'Client names',
    'contact.email': 'Contact email',
  };

  function read(content, field) {
    const value = field.split('.').reduce((part, key) => part?.[key], content);
    return field === 'clients.names' ? value.join('\n') : value;
  }

  function fields(content, path = '') {
    if (path === 'clients.names' || typeof content === 'string') {
      return { [path]: special[path] ?? path.split('.').map(part =>
        /^\d+$/.test(part) ? Number(part) + 1 : part.replace(/([A-Z])/g, ' $1')
      ).join(' / ').replace(/^./, char => char.toUpperCase()) };
    }
    return Object.assign({}, ...Object.entries(content).map(([key, value]) =>
      fields(value, path ? path + '.' + key : key)
    ));
  }

  function normalize(field, value) {
    const text = value.replace(/\r\n?/g, '\n').trim();
    if (field === 'hero.video') return text ? video.normalizeVideo(text) : '';
    if (field === 'clients.names') return text.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
    return text;
  }

  function valid(field, value) {
    if (typeof value !== 'string' || value.length > 4000 || normalize(field, value) !== value) return false;
    if (field === 'hero.video') return true;
    if (field === 'contact.email') return /^[A-Z0-9._+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(value);
    if (/^about\.stats\.\d+\.number$/.test(field)) return /^\d{1,7}\+?$/.test(value);
    if (field === 'clients.names') return value.split('\n').every(name => name.length > 0 && name.length <= 100);
    return Boolean(value) && (field.endsWith('.heading') || field === 'hero.headline' || !value.includes('\n'));
  }

  function apply(content, changes) {
    const next = structuredClone(content);
    for (const [field, value] of Object.entries(changes)) {
      const keys = field.split('.');
      const key = keys.pop();
      const parent = keys.reduce((part, name) => part[name], next);
      parent[key] = field === 'clients.names' ? value.split('\n') : value;
    }
    return next;
  }

  return { read, fields, normalize, valid, apply };
})();

if (typeof module !== 'undefined') module.exports = HomeContent;
