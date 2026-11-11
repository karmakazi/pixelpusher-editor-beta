const { isSignedIn } = require('../lib/editor-session');
const CaseCopy = require('../editor/case-copy');
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

  if (!isSignedIn(req, EDITOR_ACCESS_TOKEN)) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  const { projectId, instruction, field = 'tagline', current, originalCopy, paragraph = null } = req.body || {};
  const isParagraph = paragraph !== null;
  const legacy = req.body?.field === undefined;
  const project = projects.find(item => item.id === projectId && !item.comingSoon);
  if (!project || !Object.hasOwn(CaseCopy.fields, field) ||
      [current, originalCopy].some(value => value !== undefined &&
        (typeof value !== 'string' || value.length > CaseCopy.fields[field].max)) ||
      typeof instruction !== 'string' || !instruction.trim() || instruction.length > 1500) {
    return res.status(400).json({ error: 'Choose a project and enter an instruction of up to 1,500 characters.' });
  }

  const definition = CaseCopy.fields[field];
  const fieldCopy = CaseCopy.read(project, field);
  const paragraphs = fieldCopy.split('\n\n');
  if (isParagraph && (field !== 'copy' || !Number.isInteger(paragraph) || paragraph < 0 || paragraph >= paragraphs.length)) {
    return res.status(400).json({ error: 'Select a paragraph in the case study.' });
  }
  const fallback = isParagraph ? paragraphs[paragraph] : fieldCopy;
  const label = isParagraph ? `Body paragraph ${paragraph + 1}` : definition.label;
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
        max_output_tokens: field === 'copy' ? 4200 : 600,
        instructions: 'Rewrite only the requested case study field in plain text. Use workingDraft as the text to revise for follow-ups such as “make it shorter,” even when it differs from publishedCopy. Use publishedCopy as the rewrite target only if the editor explicitly refers to the published or original version. Use the other fields as factual context. Preserve project facts and credits unless the editor explicitly supplies a correction. Ask for missing facts when needed by returning null and a note. Multiple sentences are allowed in the intro. When the selected field is a body paragraph, return exactly one paragraph with no line breaks. For whole body copy, separate paragraphs with a blank line. For title and services, use one item per line. Keep other fields on one line.',
        input: JSON.stringify({
          field: label,
          maxCharacters: definition.max,
          workingDraft: current ?? fallback,
          publishedCopy: originalCopy ?? fallback,
          otherProjectFields: Object.fromEntries(Object.keys(CaseCopy.fields)
            .filter(key => key !== field || isParagraph)
            .map(key => [key, CaseCopy.read(project, key)])),
          instruction,
        }),
        text: { format: {
          type: 'json_schema',
          name: 'case_copy_draft',
          strict: true,
          schema: {
            type: 'object',
            properties: { value: { type: ['string', 'null'] }, note: { type: 'string' } },
            required: ['value', 'note'],
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
    if ((proposal.value !== null && (!CaseCopy.valid(field, proposal.value) || (isParagraph && /[\r\n]/.test(proposal.value)))) || typeof proposal.note !== 'string') {
      return res.status(422).json({ error: 'The draft was outside the field limits. Try a shorter edit.' });
    }
    return res.status(200).json(legacy ? { tagline: proposal.value || '', note: proposal.note } : proposal);
  } catch {
    return res.status(502).json({ error: 'AI drafting is unavailable right now. You can still edit the draft directly.' });
  }
};
