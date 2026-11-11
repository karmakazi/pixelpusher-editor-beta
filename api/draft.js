const { timingSafeEqual } = require('node:crypto');
const projects = require('../projects.json');

module.exports = async function draft(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to draft an edit.' });
  }

  const { OPENAI_API_KEY, EDITOR_ACCESS_TOKEN } = process.env;
  if (!OPENAI_API_KEY || !EDITOR_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'AI drafting needs server configuration.' });
  }

  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${EDITOR_ACCESS_TOKEN}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Enter the editor access code to use AI drafting.' });
  }

  const { projectId, instruction } = req.body || {};
  const project = projects.find(item => item.id === projectId && !item.comingSoon);
  if (!project || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 1500) {
    return res.status(400).json({ error: 'Choose a project and enter an instruction of up to 1,500 characters.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: 'gpt-6-luna',
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 350,
        instructions: 'Draft one plain-text case study intro for Pixelpusher in up to 240 characters. Use project facts only. If the requested change needs missing facts or is outside the intro, return an empty tagline and explain in note.',
        input: JSON.stringify({
          client: project.client,
          title: project.title,
          tagline: project.tagline,
          copy: project.copy,
          instruction,
        }),
        text: { format: {
          type: 'json_schema',
          name: 'intro_draft',
          strict: true,
          schema: {
            type: 'object',
            properties: { tagline: { type: 'string' }, note: { type: 'string' } },
            required: ['tagline', 'note'],
            additionalProperties: false,
          },
        } },
      }),
    });
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({ error: 'AI drafting is unavailable right now. You can still edit the draft directly.' });
    }

    const result = await response.json();
    const output = result.output?.flatMap(item => item.content || [])
      .find(part => part.type === 'output_text');
    if (result.status !== 'completed' || !output) {
      return res.status(422).json({ error: 'The model did not return a draft. Try a more specific instruction.' });
    }
    const proposal = JSON.parse(output.text);
    if (typeof proposal.tagline !== 'string' || proposal.tagline.length > 240 || typeof proposal.note !== 'string') {
      return res.status(422).json({ error: 'The draft was outside the intro limits. Try a shorter edit.' });
    }
    return res.status(200).json(proposal);
  } catch {
    return res.status(502).json({ error: 'AI drafting is unavailable right now. You can still edit the draft directly.' });
  }
};
