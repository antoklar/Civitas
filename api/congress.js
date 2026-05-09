const BASE = 'https://api.congress.gov/v3';

function congressFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}format=json&api_key=${apiKey}`);
}

function nameMatch(memberName, searchName) {
  // memberName from Congress.gov: "Cruz, Ted" format
  // searchName from Civitas: "Ted Cruz" format
  const parts = memberName.toLowerCase().split(',').map(s => s.trim());
  const lastName  = parts[0] || '';
  const firstName = parts[1] || '';
  const search    = searchName.toLowerCase().split(' ').filter(Boolean);
  const sFirst = search[0] || '';
  const sLast  = search[search.length - 1] || '';
  return lastName.includes(sLast) && (firstName.startsWith(sFirst) || sFirst.startsWith(firstName.split(' ')[0]));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, name, id } = req.query;
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Congress API key not configured' });

  try {
    // ── Search: find a member by name ────────────────────────────────────────
    if (action === 'search') {
      if (!name) return res.status(400).json({ error: 'name required' });

      const r    = await congressFetch('/member?limit=600&currentMember=true', apiKey);
      const data = await r.json();
      const members = data.members || [];

      const match = members.find(m => nameMatch(m.name, name));
      if (!match) return res.status(404).json({ error: 'Member not found in current Congress' });

      // Fetch full profile for the matched member
      const pr    = await congressFetch(`/member/${match.bioguideId}`, apiKey);
      const pdata = await pr.json();
      const m     = pdata.member || {};

      const latestParty = (m.partyHistory || []).slice(-1)[0]?.partyName || match.partyName || '';
      const latestTerm  = (m.terms || []).slice(-1)[0] || {};
      const photoUrl    = m.depiction?.imageUrl || `https://www.congress.gov/img/member/${match.bioguideId.toLowerCase()}_200.jpg`;

      return res.status(200).json({
        bioguideId:        match.bioguideId,
        name:              m.directOrderName || name,
        party:             latestParty,
        state:             m.state || match.state,
        birthYear:         m.birthYear || null,
        chamber:           latestTerm.memberType || '',
        termStart:         latestTerm.startYear || '',
        termEnd:           latestTerm.endYear   || '',
        photoUrl,
        sponsoredCount:    m.sponsoredLegislation?.count   || 0,
        cosponsoredCount:  m.cosponsoredLegislation?.count || 0,
      });
    }

    // ── Legislation: sponsored bills for a member ────────────────────────────
    if (action === 'legislation') {
      if (!id) return res.status(400).json({ error: 'id required' });

      const r    = await congressFetch(`/member/${id}/sponsored-legislation?limit=20`, apiKey);
      const data = await r.json();

      const bills = (data.sponsoredLegislation || [])
        .filter(b => b.title && b.number && b.type && !b.type.includes('AMDT') && !b.type.includes('SA'))
        .slice(0, 12)
        .map(b => ({
          title:        b.title,
          number:       `${b.type} ${b.number}`,
          congress:     b.congress,
          introduced:   b.introducedDate,
          policyArea:   b.policyArea?.name || null,
          latestAction: b.latestAction?.text || null,
          actionDate:   b.latestAction?.actionDate || null,
        }));

      return res.status(200).json({ bills });
    }

    return res.status(400).json({ error: 'Invalid action. Use search or legislation.' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
