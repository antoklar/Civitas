// /api/bills-feed — powers the dashboard's "What's Happening in Congress"
// feed: Trending Now, Your Reps' Activity, and Under the Radar. Each card
// gets a pre-generated one-sentence plain-English summary (batched into a
// single Claude call per cold cache, not generated on demand per card).
//
// Scope note: "Your Reps' Activity" surfaces bills your representatives have
// sponsored (via bioguide ID, from Congress.gov). Cross-referencing recent
// roll-call votes to specific bills isn't included in this pass — vote
// records only carry a loosely-formatted legislation string, not a reliable
// bill key, so it's left out rather than guessed at.

const Anthropic = require('@anthropic-ai/sdk');

const BASE = 'https://api.congress.gov/v3';

function congressFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}format=json&api_key=${apiKey}`);
}

function billKey(b) {
  return `${b.congress}-${String(b.type).toUpperCase()}-${b.number}`;
}

// ── Recently-active bill pool (same approach as /api/bills-search) ─────────
const POOL_PAGES = 3;
const PAGE_SIZE = 250;
const POOL_TTL = 15 * 60 * 1000;
const pool = { bills: [], ts: 0 };

async function loadPool(apiKey) {
  if (pool.bills.length && Date.now() - pool.ts < POOL_TTL) return pool.bills;

  const pages = await Promise.all(
    Array.from({ length: POOL_PAGES }, (_, i) =>
      congressFetch(`/bill?limit=${PAGE_SIZE}&offset=${i * PAGE_SIZE}`, apiKey)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );

  const seen = new Set();
  const bills = [];
  pages.forEach(page => {
    (page?.bills || []).forEach(b => {
      const key = billKey(b);
      if (seen.has(key)) return;
      seen.add(key);
      bills.push(b);
    });
  });

  if (bills.length) { pool.bills = bills; pool.ts = Date.now(); }
  return pool.bills;
}

// congress.gov gives free-text "latestAction" prose, not a status enum.
function detectStage(text = '') {
  const t = text.toLowerCase();
  if (/became public law|signed by president/.test(t)) return 'Became Law';
  if (/presented to president|sent to the president/.test(t)) return 'Sent to President';
  if (/passed senate.*passed house|passed house.*passed senate/.test(t)) return 'Passed Both Chambers';
  if (/passed (the )?senate/.test(t)) return 'Passed Senate';
  if (/passed (the )?house/.test(t)) return 'Passed House';
  if (/reported (by|to)|ordered to be reported/.test(t)) return 'Reported by Committee';
  if (/referred to the (sub)?committee/.test(t)) return 'In Committee';
  if (/introduced in (the )?(house|senate)/.test(t)) return 'Introduced';
  return 'In Progress';
}

const COMMITTEE_FORWARD_RE = /ordered to be reported|reported (by|to)|markup|hearing held|discharged/i;

// ── Sponsored legislation for a given rep ───────────────────────────────────
async function sponsoredBillsFor(bioguideId, apiKey) {
  try {
    const r = await congressFetch(`/member/${bioguideId}/sponsored-legislation?limit=10`, apiKey);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.sponsoredLegislation || [])
      .filter(b => b.title && b.number && b.type && !b.type.includes('AMDT') && !b.type.includes('SA'))
      .map(b => ({
        congress: b.congress, type: b.type, number: b.number, title: b.title,
        latestAction: b.latestAction || null, updateDate: b.latestAction?.actionDate || b.introducedDate || null,
        sponsorBioguideId: bioguideId,
      }));
  } catch {
    return [];
  }
}

// ── One-sentence summaries, batched into a single Claude call, cached ──────
const summaryCache = new Map(); // key -> { text, ts }
const SUMMARY_TTL = 6 * 60 * 60 * 1000;

async function fetchSummarySource(bill, apiKey) {
  try {
    const r = await congressFetch(`/bill/${bill.congress}/${String(bill.type).toLowerCase()}/${bill.number}/summaries`, apiKey);
    if (!r.ok) return null;
    const data = await r.json();
    const summaries = data.summaries || [];
    const latest = summaries.slice().sort((a, b) => new Date(b.actionDate || 0) - new Date(a.actionDate || 0))[0];
    if (!latest?.text) return null;
    return latest.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

async function ensureSummaries(bills, apiKey, anthropicKey) {
  const now = Date.now();
  const needed = bills.filter(b => {
    const cached = summaryCache.get(billKey(b));
    return !cached || now - cached.ts > SUMMARY_TTL;
  });

  if (needed.length && anthropicKey) {
    const sources = await Promise.all(needed.map(b => fetchSummarySource(b, apiKey)));
    const items = needed.map((b, i) => ({ key: billKey(b), title: b.title, source: sources[i] }));

    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const listText = items.map((it, idx) =>
        `${idx + 1}. [key: ${it.key}] "${it.title}"\n${it.source ? `Official summary: ${it.source.slice(0, 600)}` : '(no official summary published yet — infer only from the title, staying general and hedged)'}`
      ).join('\n\n');

      const response = await client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 1500,
        output_config: { effort: 'low' },
        system: 'For each numbered bill below, write exactly ONE short, plain, neutral sentence describing what it would do — no jargon, no opinion, no partisan framing. Respond with ONLY raw JSON: an object mapping each bill\'s "key" value to its one-sentence summary string. No markdown fences, no commentary.',
        messages: [{ role: 'user', content: listText }],
      });

      const text = response.content.find(b => b.type === 'text')?.text || '{}';
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      items.forEach(it => {
        if (parsed[it.key]) summaryCache.set(it.key, { text: parsed[it.key], ts: now });
      });
    } catch {
      // Leave uncached bills without a summary rather than failing the feed.
    }
  }

  return bills.map(b => ({
    ...b,
    summary: summaryCache.get(billKey(b))?.text || null,
  }));
}

function toCard(b) {
  return {
    congress: b.congress,
    type: String(b.type).toUpperCase(),
    number: b.number,
    title: b.title,
    status: detectStage(b.latestAction?.text || ''),
    sponsorBioguideId: b.sponsorBioguideId || null,
    summary: b.summary || null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Congress API key not configured' });
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const bioguideIds = (req.query.bioguideIds || '').toString().split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

  try {
    const bills = await loadPool(apiKey);

    const trendingRaw = bills.slice().sort((a, b) => new Date(b.updateDate || 0) - new Date(a.updateDate || 0)).slice(0, 4);
    const trendingKeys = new Set(trendingRaw.map(billKey));

    const underRadarRaw = bills
      .filter(b => COMMITTEE_FORWARD_RE.test(b.latestAction?.text || '') && !trendingKeys.has(billKey(b)))
      .sort((a, b) => new Date(b.updateDate || 0) - new Date(a.updateDate || 0))
      .slice(0, 4);

    let repsActivityRaw = [];
    if (bioguideIds.length) {
      const perRep = await Promise.all(bioguideIds.map(id => sponsoredBillsFor(id, apiKey)));
      const seen = new Set();
      repsActivityRaw = perRep.flat()
        .filter(b => { const k = billKey(b); if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => new Date(b.updateDate || 0) - new Date(a.updateDate || 0))
        .slice(0, 4);
    }

    const allForSummary = [...trendingRaw, ...underRadarRaw, ...repsActivityRaw];
    const withSummaries = await ensureSummaries(allForSummary, apiKey, anthropicKey);
    const summaryByKey = new Map(withSummaries.map(b => [billKey(b), b.summary]));

    const attach = b => ({ ...b, summary: summaryByKey.get(billKey(b)) || null });

    return res.status(200).json({
      trending: trendingRaw.map(attach).map(toCard),
      repsActivity: repsActivityRaw.map(attach).map(toCard),
      underRadar: underRadarRaw.map(attach).map(toCard),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
