const BASE = 'https://api.congress.gov/v3';

// Free public data sources (no key required)
const LEG_URL                  = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const COMMITTEE_MEMBERSHIP_URL = 'https://unitedstates.github.io/congress-legislators/committee-membership-current.json';
const COMMITTEES_URL           = 'https://unitedstates.github.io/congress-legislators/committees-current.json';

const SENATE_MENU = (c, s)    => `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${c}_${s}.xml`;
const SENATE_VOTE = (c, s, n) => `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${c}${s}/vote_${c}_${s}_${String(n).padStart(5, '0')}.xml`;

const UA = 'Civitas/1.0 (https://civitasus.com; civic engagement app)';
const SIX_HOURS = 6 * 60 * 60 * 1000;

// ── Small cached-JSON helper (module-scoped, survives warm invocations) ────────
const jsonCache = {};
async function cachedJson(url) {
  const c = jsonCache[url] || (jsonCache[url] = { data: null, ts: 0 });
  if (c.data && Date.now() - c.ts < SIX_HOURS) return c.data;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${url}`);
  c.data = await r.json();
  c.ts = Date.now();
  return c.data;
}

function congressFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}format=json&api_key=${apiKey}`);
}

// Congress.gov vote payloads vary by wrapper key, so search for the array/value
// by a field we know the items carry rather than trusting a guessed wrapper key.
function findArrayWithKey(obj, key, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
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

function findFirstValue(obj, key, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  if (key in obj && (typeof obj[key] === 'string' || typeof obj[key] === 'number')) return obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findFirstValue(v, key, depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

function currentCongressAndSession() {
  const year = new Date().getFullYear();
  const congress = Math.floor((year - 1789) / 2) + 1;
  const session = year % 2 === 1 ? 1 : 2;
  return { congress, session };
}

// Normalise every chamber's raw vote wording into plain English.
function castText(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'yea' || v === 'aye' || v === 'yes')       return 'Voted Yes';
  if (v === 'nay' || v === 'no')                        return 'Voted No';
  if (v.startsWith('present'))                          return 'Voted Present';
  if (v === 'not voting' || v === 'absent' || v === '') return 'Did Not Vote';
  return raw || 'Unknown';
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
}

function nameMatch(memberName, searchName) {
  // memberName from Congress.gov: "Cruz, Ted" — searchName from Civitas: "Ted Cruz"
  const parts = memberName.toLowerCase().split(',').map(s => s.trim());
  const lastName  = parts[0] || '';
  const firstName = parts[1] || '';
  const search    = searchName.toLowerCase().split(' ').filter(Boolean);
  const sFirst = search[0] || '';
  const sLast  = search[search.length - 1] || '';
  return lastName.includes(sLast) && (firstName.startsWith(sFirst) || sFirst.startsWith(firstName.split(' ')[0]));
}

// ── Voting record: House roll calls (Congress.gov API) ───────────────────────
async function houseVotes(bioguideId, apiKey) {
  const { congress } = currentCongressAndSession();
  const wanted = bioguideId.toUpperCase();

  async function listFor(session) {
    const first = await congressFetch(`/house-vote/${congress}/${session}?limit=250`, apiKey)
      .then(r => r.json()).catch(() => null);
    if (!first) return [];
    let arr = findArrayWithKey(first, 'rollCallNumber') || [];
    const count = findFirstValue(first, 'count');
    if (count && count > arr.length) {
      // Natural order is chronological — page to the tail for the most recent votes.
      const offset = Math.max(0, count - 250);
      const more = await congressFetch(`/house-vote/${congress}/${session}?limit=250&offset=${offset}`, apiKey)
        .then(r => r.json()).catch(() => null);
      if (more) arr = findArrayWithKey(more, 'rollCallNumber') || arr;
    }
    return arr.map(v => ({ ...v, session }));
  }

  let combined = await listFor(2);
  if (combined.length < 15) combined = combined.concat(await listFor(1));
  if (!combined.length) return { votes: [], unavailable: true, reason: 'no-data' };

  combined.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  const recent = combined.slice(0, 12);

  // Member rows use "bioguideID" (capital D); tolerate other casings just in case.
  const memberBioguide = m => m.bioguideID || m.bioguideId || m.bioGuideId || '';

  const settled = await Promise.all(recent.map(async v => {
    try {
      // This sub-resource returns the full roster in one page (no real pagination).
      const detail = await congressFetch(
        `/house-vote/${congress}/${v.session}/${v.rollCallNumber}/members?limit=250`, apiKey
      ).then(r => r.json());

      const members = findArrayWithKey(detail, 'voteCast') || [];
      const mine = members.find(m => String(memberBioguide(m)).toUpperCase() === wanted);
      if (!mine) return null;

      return {
        rollCallNumber: v.rollCallNumber,
        date: v.startDate || null,
        question: findFirstValue(detail, 'voteQuestion') || v.voteQuestion || null,
        result: v.result || null,
        legislation: v.legislationType && v.legislationNumber
          ? `${v.legislationType} ${v.legislationNumber}` : null,
        castText: castText(mine.voteCast || mine.votePosition),
      };
    } catch {
      return null;
    }
  }));

  const votes = settled.filter(Boolean);
  if (!votes.length) return { votes: [], unavailable: true, reason: 'no-data' };
  return { votes, chamber: 'house', congress };
}

// ── Voting record: Senate roll calls (Senate.gov XML — no API key needed) ─────
async function senateVotes(bioguideId) {
  const { congress, session } = currentCongressAndSession();
  const wanted = bioguideId.toUpperCase();

  const fallback = {
    votes: [], unavailable: true, reason: 'senate',
    senateRollCallUrl: `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.htm`,
  };

  // bioguide → LIS member id (Senate XML keys votes by LIS id)
  let lisId = null;
  try {
    const leg = await cachedJson(LEG_URL);
    const person = (leg || []).find(p => String(p.id?.bioguide || '').toUpperCase() === wanted);
    lisId = person?.id?.lis || null;
  } catch { /* fall through */ }
  if (!lisId) return fallback;

  async function menuFor(s) {
    try {
      const r = await fetch(SENATE_MENU(congress, s), { headers: { 'User-Agent': UA } });
      if (!r.ok) return [];
      const xml = await r.text();
      return [...xml.matchAll(/<vote>([\s\S]*?)<\/vote>/g)]
        .map(m => ({
          number:   parseInt(xmlTag(m[1], 'vote_number'), 10),
          session:  s,
          question: xmlTag(m[1], 'question').replace(/\s+/g, ' '),
          result:   xmlTag(m[1], 'result'),
          title:    xmlTag(m[1], 'title').replace(/\s+/g, ' '),
          issue:    xmlTag(m[1], 'issue'),
        }))
        .filter(v => v.number);
    } catch {
      return [];
    }
  }

  // Menu XML is newest-first within a session.
  let menu = await menuFor(session);
  if (menu.length < 12 && session === 2) menu = menu.concat(await menuFor(1));
  if (!menu.length) return fallback;

  const recent = menu.slice(0, 12);

  const settled = await Promise.all(recent.map(async v => {
    try {
      const r = await fetch(SENATE_VOTE(congress, v.session, v.number), { headers: { 'User-Agent': UA } });
      if (!r.ok) return null;
      const xml = await r.text();

      const member = [...xml.matchAll(/<member>([\s\S]*?)<\/member>/g)]
        .find(mm => xmlTag(mm[1], 'lis_member_id').toUpperCase() === lisId.toUpperCase());
      if (!member) return null;

      let legislation = null;
      const doc = xml.match(/<document>([\s\S]*?)<\/document>/);
      if (doc) {
        const dt = xmlTag(doc[1], 'document_type');
        const dn = xmlTag(doc[1], 'document_number');
        if (dt && dn) legislation = `${dt} ${dn}`.trim();
      }

      const rawDate = xmlTag(xml, 'vote_date').replace(/\s+/g, ' ');
      const parsed = rawDate ? new Date(rawDate) : null;

      return {
        rollCallNumber: v.number,
        date: parsed && !isNaN(parsed) ? parsed.toISOString() : null,
        question: v.title || v.question || 'Senate roll call vote',
        result: v.result || null,
        legislation,
        castText: castText(xmlTag(member[1], 'vote_cast')),
      };
    } catch {
      return null;
    }
  }));

  const votes = settled.filter(Boolean);
  if (!votes.length) return fallback;
  return { votes, chamber: 'senate', congress };
}

// ── Committee assignments (congress-legislators — free, keyed by bioguide) ────
async function committeeAssignments(bioguideId) {
  const wanted = bioguideId.toUpperCase();
  const [membership, committees] = await Promise.all([
    cachedJson(COMMITTEE_MEMBERSHIP_URL),
    cachedJson(COMMITTEES_URL),
  ]);

  const topName = {}; // "HSIF"   -> "House Committee on Energy and Commerce"
  const subInfo = {}; // "HSIF02" -> { name, parentCode }
  (committees || []).forEach(c => {
    if (!c.thomas_id) return;
    topName[c.thomas_id] = c.name || c.thomas_id;
    (c.subcommittees || []).forEach(s => {
      if (s.thomas_id) subInfo[c.thomas_id + s.thomas_id] = { name: s.name || '', parentCode: c.thomas_id };
    });
  });

  const mine = [];
  Object.entries(membership || {}).forEach(([code, members]) => {
    const entry = (members || []).find(m => String(m.bioguide || '').toUpperCase() === wanted);
    if (!entry) return;

    const isSub = code.length > 4;
    const rawTitle = entry.title || null; // "Chairman", "Ranking Member", "Vice Chair"…

    if (isSub) {
      const info = subInfo[code];
      if (!info) return;
      const parent = topName[info.parentCode] || info.parentCode;
      mine.push({
        name: info.name ? `${info.name} (Subcommittee)` : `${parent} — Subcommittee`,
        parent,
        rawTitle,
        isSub: true,
        rank: entry.rank || 99,
      });
    } else {
      mine.push({
        name: topName[code] || code,
        rawTitle,
        isSub: false,
        rank: entry.rank || 99,
      });
    }
  });

  // Full committees first; chairs / ranking members first; then seniority rank.
  mine.sort((a, b) => {
    if (a.isSub !== b.isSub) return a.isSub ? 1 : -1;
    const at = a.rawTitle ? 0 : 1, bt = b.rawTitle ? 0 : 1;
    if (at !== bt) return at - bt;
    return a.rank - b.rank;
  });

  return {
    committees: mine.map(c => ({
      name: c.name,
      parent: c.parent || null,
      role: c.rawTitle || 'Member',
    })),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, name, id } = req.query;
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Congress API key not configured' });

  try {
    // ── Search: resolve a member by bioguide id (preferred) or by name ──────
    if (action === 'search') {
      let bioguideId = req.query.bioguideId || null;
      let listParty  = '';
      let listState  = '';

      if (!bioguideId) {
        if (!name) return res.status(400).json({ error: 'name or bioguideId required' });

        const r    = await congressFetch('/member?limit=600&currentMember=true', apiKey);
        const data = await r.json();
        const members = data.members || [];

        const match = members.find(m => nameMatch(m.name, name));
        if (!match) return res.status(404).json({ error: 'Member not found in current Congress' });
        bioguideId = match.bioguideId;
        listParty  = match.partyName || '';
        listState  = match.state || '';
      }

      const pr    = await congressFetch(`/member/${bioguideId}`, apiKey);
      const pdata = await pr.json();
      const m     = pdata.member || {};
      if (!m.directOrderName && !m.invertedOrderName && !m.terms) {
        return res.status(404).json({ error: 'Member not found in current Congress' });
      }

      const termsArr    = Array.isArray(m.terms) ? m.terms : (m.terms?.item || []);
      const latestParty = (m.partyHistory || []).slice(-1)[0]?.partyName || listParty || '';
      const latestTerm  = termsArr.slice(-1)[0] || {};
      const photoUrl    = m.depiction?.imageUrl || `https://www.congress.gov/img/member/${bioguideId.toLowerCase()}_200.jpg`;

      return res.status(200).json({
        bioguideId,
        name:              m.directOrderName || name || m.invertedOrderName || '',
        party:             latestParty,
        state:             m.state || listState,
        birthYear:         m.birthYear || null,
        chamber:           latestTerm.memberType || '',
        district:          latestTerm.district !== undefined ? latestTerm.district : null,
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

    // ── Committees: current committee & subcommittee assignments ─────────────
    if (action === 'committees') {
      const bioguideId = req.query.bioguideId || id;
      if (!bioguideId) return res.status(400).json({ error: 'bioguideId required' });
      return res.status(200).json(await committeeAssignments(bioguideId));
    }

    // ── Votes: recent roll-call positions, in plain English ─────────────────
    if (action === 'votes') {
      const { bioguideId, chamber } = req.query;
      if (!bioguideId) return res.status(400).json({ error: 'bioguideId required' });

      const result = chamber === 'senate'
        ? await senateVotes(bioguideId)
        : await houseVotes(bioguideId, apiKey);

      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid action. Use search, legislation, committees, or votes.' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
