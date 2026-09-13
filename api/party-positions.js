// /api/party-positions — generates a labeled, AI-produced analysis of how
// Democrats, Republicans, and Independents commonly argue about a bill, and
// what each side speculates could happen if it passes. This is Civitas's own
// generated commentary to help readers understand the debate — explicitly
// NOT an official party statement, a poll, or a verified forecast. The
// disclaimer shown alongside this in the UI is load-bearing; keep it.

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

const SCHEMA_HINT = `{
  "democrats": { "stance": "support" | "oppose" | "mixed", "reasoning": string, "predictions": { "five_year": string, "ten_year": string, "twenty_year": string } },
  "republicans": { "stance": "support" | "oppose" | "mixed", "reasoning": string, "predictions": { "five_year": string, "ten_year": string, "twenty_year": string } },
  "independents": { "stance": "support" | "oppose" | "mixed", "reasoning": string, "predictions": { "five_year": string, "ten_year": string, "twenty_year": string } }
}`;

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
  if (!source) return res.status(400).json({ error: 'No bill text or summary available to analyze' });

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'medium' },
      system: `You summarize the political debate around a piece of U.S. legislation for a civic-education app. This is your own analysis of commonly articulated arguments, written to help a reader understand the debate — it is NOT an official party statement, a poll, or a verified fact, and the reader will be shown that disclaimer alongside your output. Write evenhandedly about all three groups; do not editorialize about who is right. For "predictions", clearly hedge them as what that side argues or fears might happen, not as forecasts you are asserting will come true. Keep each "reasoning" field to 2-3 sentences and each prediction field to 1-2 sentences. Base everything on the provided bill text/summary — don't invent provisions that aren't in it. Respond with ONLY raw JSON matching exactly this shape, no markdown code fences, no commentary before or after:\n${SCHEMA_HINT}`,
      messages: [{
        role: 'user',
        content: `Bill: ${title}\n\nOfficial summary and/or text excerpt:\n${source}`,
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let positions;
    try {
      positions = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'Could not parse AI analysis. Please try again.' });
    }

    return res.status(200).json({ positions });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Party positions generation failed' });
  }
};
