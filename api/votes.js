module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { member_id } = req.query;
  if (!member_id) return res.status(400).json({ error: 'member_id required' });

  const apiKey = process.env.PROPUBLICA_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ProPublica API key not configured' });

  try {
    const url = `https://api.propublica.org/congress/v1/members/${member_id}/votes.json`;
    const r = await fetch(url, { headers: { 'X-API-Key': apiKey } });
    const data = await r.json();

    const votes = data.results?.[0]?.votes || [];
    return res.status(200).json({ votes: votes.slice(0, 25) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
