// /api/bills-search — keyword search over federal legislation.
//
// The official Congress.gov API has no free-text search endpoint (only
// listing filtered by congress/type/date — see api.congress.gov's OpenAPI
// spec). We keep a short-lived in-memory pool of the most recently updated
// bills across Congress and filter that pool by keyword. In practice this
// surfaces what people actually search for — legislation currently moving
// through Congress — without scanning the full historical corpus, which
// the API doesn't support in a single request anyway.

const BASE = 'https://api.congress.gov/v3';

function congressFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}format=json&api_key=${apiKey}`);
}

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
      const key = `${b.congress}-${b.type}-${b.number}`;
      if (seen.has(key)) return;
      seen.add(key);
      bills.push(b);
    });
  });

  if (bills.length) { pool.bills = bills; pool.ts = Date.now(); }
  return pool.bills;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Query (q) is required' });

  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Congress API key not configured' });

  try {
    const bills = await loadPool(apiKey);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = bills.filter(b => {
      const haystack = `${b.title || ''}`.toLowerCase();
      return terms.every(t => haystack.includes(t));
    });

    matches.sort((a, b) => new Date(b.updateDate || 0) - new Date(a.updateDate || 0));

    return res.status(200).json({
      results: matches.slice(0, 25).map(b => ({
        congress: b.congress,
        type: b.type,
        number: b.number,
        title: b.title,
        originChamber: b.originChamber,
        latestAction: b.latestAction || null,
        updateDate: b.updateDate || null,
      })),
      scope: 'Searches bills currently active in Congress (most recently updated), not the full historical record.',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
