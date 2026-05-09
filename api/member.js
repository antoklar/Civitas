module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, chamber } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const apiKey = process.env.PROPUBLICA_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ProPublica API key not configured' });

  try {
    const url = `https://api.propublica.org/congress/v1/members/search.json?name=${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: { 'X-API-Key': apiKey } });
    const data = await r.json();

    let members = data.results?.[0]?.members || [];

    if (chamber) {
      const ch = chamber.toLowerCase();
      const filtered = members.filter(m =>
        m.roles?.some(role => role.chamber?.toLowerCase().includes(ch))
      );
      if (filtered.length) members = filtered;
    }

    if (!members.length) return res.status(404).json({ error: 'Member not found' });

    const best = members[0];
    return res.status(200).json({
      member_id: best.member_id,
      name: `${best.first_name} ${best.last_name}`,
      party: best.roles?.[0]?.party || '',
      state: best.roles?.[0]?.state || '',
      chamber: best.roles?.[0]?.chamber || '',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
