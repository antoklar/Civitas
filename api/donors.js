const BASE = 'https://api.open.fec.gov/v1';

function fecFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}api_key=${apiKey}`);
}

// FEC contribution data carries placeholder employer/occupation strings that
// aren't real donor categories — drop them before they reach the UI.
function isJunkLabel(value) {
  if (value == null) return true;
  const v = String(value).trim().toUpperCase();
  if (!v) return true;
  if (['NULL', 'NONE', 'N/A', 'NA', 'UNKNOWN'].includes(v)) return true;
  if (v.includes('INFORMATION REQUESTED')) return true; // incl. "…PER BEST EFFORTS"
  return false;
}

function aggregate(rows, keyField, labelField) {
  const map = new Map();
  rows.forEach(r => {
    const key = r[keyField];
    if (!key || isJunkLabel(key)) return;
    const existing = map.get(key) || { total: 0, count: 0, label: labelField ? r[labelField] : key };
    existing.total += r.total || 0;
    existing.count += r.count || 0;
    map.set(key, existing);
  });
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, chamber, state } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const apiKey = process.env.FEC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'FEC API key not configured' });

  try {
    const searchRes = await fecFetch(`/candidates/search/?q=${encodeURIComponent(name)}&per_page=10`, apiKey);
    const searchData = await searchRes.json();
    let results = searchData.results || [];

    if (chamber === 'house') results = results.filter(c => c.office === 'H');
    if (chamber === 'senate') results = results.filter(c => c.office === 'S');
    if (state) {
      const stateFiltered = results.filter(c => c.state === state);
      if (stateFiltered.length) results = stateFiltered;
    }

    const candidate = results.find(c => c.candidate_status === 'C') || results[0];
    if (!candidate) return res.status(200).json({ found: false });

    const committee = (candidate.principal_committees || []).find(c => c.designation === 'P') || candidate.principal_committees?.[0];
    if (!committee) return res.status(200).json({ found: false });

    const [employerRes, stateRes, totalsRes] = await Promise.all([
      fecFetch(`/schedules/schedule_a/by_employer/?committee_id=${committee.committee_id}&sort=-total&per_page=60`, apiKey),
      fecFetch(`/schedules/schedule_a/by_state/?committee_id=${committee.committee_id}&sort=-total&per_page=60`, apiKey),
      fecFetch(`/candidate/${candidate.candidate_id}/totals/?sort=-coverage_end_date&per_page=1`, apiKey),
    ]);

    const employerData = await employerRes.json();
    const stateData = await stateRes.json();
    const totalsData = await totalsRes.json();

    const byEmployer = aggregate(employerData.results || [], 'employer').map(e => ({ label: e.key, total: e.total }));
    const byState = aggregate(stateData.results || [], 'state').map(s => {
      const full = (stateData.results || []).find(r => r.state === s.key)?.state_full || s.key;
      return { label: full, total: s.total };
    });

    const totals = totalsData.results?.[0] || null;

    return res.status(200).json({
      found: true,
      candidateName: candidate.name,
      office: candidate.office_full,
      totals: totals ? {
        receipts: totals.receipts,
        individualContributions: totals.individual_contributions,
        cashOnHand: totals.last_cash_on_hand_end_period,
      } : null,
      byEmployer,
      byState,
      fecUrl: `https://www.fec.gov/data/candidate/${candidate.candidate_id}/`,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
