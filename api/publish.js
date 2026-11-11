const { isSignedIn } = require('../lib/editor-session');
const CaseCopy = require('../editor/case-copy');

const repo = 'karmakazi/pixelpusher-editor-beta';
const contentsUrl = `https://api.github.com/repos/${repo}/contents/projects.json`;
const branch = 'main';

function replaceCopy(source, projects, index, changes) {
  const blocks = [...source.matchAll(/^  \{\r?$/gm)];
  if (blocks.length !== projects.length) throw new Error('Unexpected project layout');
  const start = blocks[index].index;
  const end = blocks[index + 1]?.index ?? source.length;
  const block = source.slice(start, end);
  const close = block.lastIndexOf('\n  }');
  if (close < 0) throw new Error('Unexpected project boundary');
  const suffix = block.slice(close + 4);
  projects[index] = CaseCopy.apply(projects[index], changes);
  const json = JSON.stringify(projects[index], null, 2).replace(/^/gm, '  ');
  const updated = source.slice(0, start) + json + suffix + source.slice(end);
  if (JSON.stringify(JSON.parse(updated)) !== JSON.stringify(projects)) {
    throw new Error('Could not isolate the case study');
  }
  return updated;
}

module.exports = async function publish(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to publish an edit.' });
  }
  const { EDITOR_ACCESS_TOKEN, GITHUB_PUBLISH_TOKEN } = process.env;
  if (!EDITOR_ACCESS_TOKEN || !GITHUB_PUBLISH_TOKEN) {
    return res.status(503).json({ error: 'Publishing needs EDITOR_ACCESS_TOKEN and GITHUB_PUBLISH_TOKEN in Vercel.' });
  }
  if (!isSignedIn(req, EDITOR_ACCESS_TOKEN)) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  const { projectId, previous, tagline, undo } = req.body || {};
  const changes = req.body?.changes ?? { tagline };
  const baseline = typeof previous === 'string' ? { tagline: previous } : previous;
  const entries = changes && typeof changes === 'object' ? Object.entries(changes) : [];
  if (typeof projectId !== 'string' || !baseline || !entries.length ||
      !entries.every(([field, value]) => CaseCopy.valid(field, value) &&
        Object.hasOwn(baseline, field) && typeof baseline[field] === 'string' &&
        baseline[field] !== value && CaseCopy.normalize(field, value) === value)) {
    return res.status(400).json({ error: 'Choose a case study and check the edited fields.' });
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB_PUBLISH_TOKEN}`,
    'Content-Type': 'application/json',
  };
  try {
    const response = await fetch(`${contentsUrl}?ref=${branch}`, {
      headers, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return res.status(502).json({ error: 'GitHub could not read the beta repo. Check the publishing token and repo access.' });
    }
    const file = await response.json();
    const source = Buffer.from(file.content, 'base64').toString('utf8');
    const projects = JSON.parse(source);
    const index = projects.findIndex(item => item.id === projectId && !item.comingSoon);
    if (index < 0 || entries.some(([field]) => !CaseCopy.hasField(projects[index], field) ||
      CaseCopy.read(projects[index], field) !== baseline[field])) {
      return res.status(409).json({ error: 'This case study changed in GitHub. Wait for the latest deployment and reload before editing it.' });
    }
    const updated = replaceCopy(source, projects, index, changes);
    const saved = await fetch(contentsUrl, {
      method: 'PUT',
      headers,
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        branch,
        sha: file.sha,
        content: Buffer.from(updated).toString('base64'),
        message: `${undo === true ? 'Restore' : 'Update'} case study content: ${projectId}`,
      }),
    });
    if (saved.status === 409) {
      return res.status(409).json({ error: 'The repository changed during publishing. Try again to check the latest version.' });
    }
    if (!saved.ok) {
      return res.status(502).json({ error: 'GitHub rejected the change. Check the token’s Contents write access and the main branch rules.' });
    }
    const result = await saved.json();
    return res.status(200).json({ commit: result.commit.sha });
  } catch {
    return res.status(502).json({ error: 'Could not confirm the GitHub commit. Check the beta repo before retrying.' });
  }
};
