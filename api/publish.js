const { timingSafeEqual } = require('node:crypto');

const repo = 'karmakazi/pixelpusher-editor-beta';
const contentsUrl = `https://api.github.com/repos/${repo}/contents/projects.json`;
const branch = 'main';

function replaceIntro(source, projectId, tagline) {
  const projects = JSON.parse(source);
  const index = projects.findIndex(project => project.id === projectId && !project.comingSoon);
  if (index < 0) return null;

  // Match the existing file layout and verify that only the selected field changes.
  const projectStarts = [...source.matchAll(/^  \{\r?$/gm)];
  if (projectStarts.length !== projects.length) throw new Error('Unexpected project layout');
  const start = projectStarts[index].index;
  const end = projectStarts[index + 1]?.index ?? source.length;
  const block = source.slice(start, end);
  const updated = block.replace(/^(    "tagline": )"(?:[^"\\]|\\.)*"/m,
    (_, prefix) => prefix + JSON.stringify(tagline));
  const result = source.slice(0, start) + updated + source.slice(end);
  projects[index].tagline = tagline;
  if (JSON.stringify(JSON.parse(result)) !== JSON.stringify(projects)) {
    throw new Error('Could not isolate the intro field');
  }
  return result;
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
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${EDITOR_ACCESS_TOKEN}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Enter the editor access code to publish.' });
  }
  const { projectId, previous, tagline, undo } = req.body || {};
  if (typeof projectId !== 'string' || typeof previous !== 'string' ||
      typeof tagline !== 'string' || !tagline.trim() ||
      tagline.length > (undo === true ? 2000 : 240) || previous === tagline) {
    return res.status(400).json({ error: 'Choose a project and enter a changed intro.' });
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
    const project = JSON.parse(source).find(item => item.id === projectId && !item.comingSoon);
    if (!project || project.tagline !== previous) {
      return res.status(409).json({ error: 'This intro changed in GitHub. Wait for the latest deployment and reload before editing it.' });
    }
    const updated = replaceIntro(source, projectId, tagline);
    const saved = await fetch(contentsUrl, {
      method: 'PUT',
      headers,
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        branch,
        sha: file.sha,
        content: Buffer.from(updated).toString('base64'),
        message: `${undo === true ? 'Restore' : 'Update'} case study intro: ${project.id}`,
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
