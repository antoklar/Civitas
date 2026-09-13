// /api/plain-english — generates a plain-English explanation of a bill's
// official text/summary on demand, using the Claude API. This is an
// AI-generated explanation grounded only in the source text provided; it is
// not itself an official government document.

const Anthropic = require('@anthropic-ai/sdk');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Anthropic API key not configured' });

  const { title, officialSummary, officialTextExcerpt } = await readJsonBody(req);
  if (!title) return res.status(400).json({ error: 'title is required' });

  const source = (officialSummary || officialTextExcerpt || '').slice(0, 12000);
  if (!source) return res.status(400).json({ error: 'No bill text or summary available to translate' });

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1200,
      output_config: { effort: 'medium' },
      system: "You explain U.S. legislation to a general audience in plain, neutral English. Base your explanation only on the provided source text — never invent provisions, numbers, or effects that aren't in it. Explain what the bill would actually do if it became law, in 3-5 short paragraphs or a short bulleted list. Avoid legal jargon. Do not offer an opinion on whether the bill is good or bad, and do not use partisan framing. If the source text is only a partial excerpt of a much longer bill, say so rather than guessing at what the rest contains.",
      messages: [{
        role: 'user',
        content: `Bill: ${title}\n\nSource text (official summary and/or an excerpt of the bill text):\n${source}\n\nExplain in plain English what this bill does.`,
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    return res.status(200).json({ plainEnglish: text });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Plain-English generation failed' });
  }
};
