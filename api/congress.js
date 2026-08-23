const BASE = 'https://api.congress.gov/v3';

function congressFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}format=json&api_key=${apiKey}`);
}

// House-vote responses are only documented as XML element names (beta endpoint), so we search for the array instead of trusting a guessed JSON wrapper key.
function findArrayWithKey(obj, key, depth = 0) {
  if (depth > 4 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === 'object' && key in obj[0]) return obj;
    for (const item of obj) {
      const found = findArrayWithKey(item, key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const v of Object.values(obj)) {
    const found = findArrayWithKey(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}

function currentCongressAndSession() {
  const year = new Date().getFullYear();
  const congress = Math.floor((year - 1789) / 2) + 1;
  const session = year % 2 === 1 ? 1 : 2;
  return { congress, session };
}

const VOTE_CAST_TEXT = {
  Aye: 'Voted Yes', Yea: 'Voted Yes',
  No: 'Voted No', Nay: 'Voted No',
  Present: 'Voted Present',
  'Not Voting': 'Did Not Vote',
};

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

    // ── Votes: House roll-call positions for a member, in plain English ─────
    if (action === 'votes') {
      const { bioguideId, chamber } = req.query;
      if (!bioguideId) return res.status(400).json({ error: 'bioguideId required' });

      if (chamber !== 'house') {
        const { congress, session } = currentCongressAndSession();
        return res.status(200).json({
          votes: [],
          unavailable: true,
          reason: 'senate',
          senateRollCallUrl: `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.htm`,
        });
      }

      let { congress, session } = currentCongressAndSession();
      let listData = await (await congressFetch(`/house-vote/${congress}/${session}?limit=40`, apiKey)).json();
      let voteList = findArrayWithKey(listData, 'rollCallNumber');

      if (!voteList || !voteList.length) {
        session = session === 2 ? 1 : 2;
        listData = await (await congressFetch(`/house-vote/${congress}/${session}?limit=40`, apiKey)).json();
        voteList = findArrayWithKey(listData, 'rollCallNumber');
      }

      if (!voteList || !voteList.length) {
        return res.status(200).json({ votes: [], unavailable: true, reason: 'no-data' });
      }

      const recent = voteList.slice(0, 15);

      const memberVotes = await Promise.all(recent.map(async v => {
        try {
          const detail = await (await congressFetch(`/house-vote/${congress}/${session}/${v.rollCallNumber}/members`, apiKey)).json();
          const members = findArrayWithKey(detail, 'bioguideId') || [];
          const mine = members.find(m => m.bioguideId === bioguideId);
          if (!mine) return null;

          const cast = mine.voteCast || mine.votePosition || mine.vote_cast || '';
          return {
            rollCallNumber: v.rollCallNumber,
            date: v.startDate || v.date || null,
            question: v.voteQuestion || v.question || null,
            result: v.result || null,
            legislation: v.legislationType && v.legislationNumber ? `${v.legislationType} ${v.legislationNumber}` : null,
            castRaw: cast,
            castText: VOTE_CAST_TEXT[cast] || cast || 'Unknown',
          };
        } catch {
          return null;
        }
      }));

      const votes = memberVotes.filter(Boolean);
      return res.status(200).json({ votes, congress, session });
    }

    return res.status(400).json({ error: 'Invalid action. Use search, legislation, or votes.' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
