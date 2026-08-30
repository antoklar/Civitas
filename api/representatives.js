// /api/representatives — free public data only, no paid APIs, no Anthropic.
//
//   address ─▶ US Census geocoder (no key)     ─▶ state + district numbers
//            ├▶ unitedstates/congress-legislators (no key) ─▶ U.S. House + Senate
//            └▶ OpenStates API v3 (free OPENSTATES_API_KEY) ─▶ state legislators
//
// If OPENSTATES_API_KEY is not set, the state section is simply omitted and
// federal results are still returned.

const CENSUS_URL    = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
const LEG_URL       = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const SOCIAL_URL    = 'https://unitedstates.github.io/congress-legislators/legislators-social-media.json';
const OPENSTATES_URL = 'https://v3.openstates.org/people.geo';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const legCache    = { data: null, ts: 0 };
const socialCache = { data: null, ts: 0 };

async function cachedJson(url, cache) {
  if (cache.data && Date.now() - cache.ts < SIX_HOURS) return cache.data;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${url}`);
  cache.data = await r.json();
  cache.ts = Date.now();
  return cache.data;
}

// ── Census geocoder ───────────────────────────────────────────────────────────
function firstLayerMatching(geographies, re) {
  for (const [key, val] of Object.entries(geographies || {})) {
    if (re.test(key) && Array.isArray(val) && val.length) return val[0];
  }
  return null;
}

function districtNumber(layer) {
  if (!layer) return null;
  const text = `${layer.NAMELSAD || ''} ${layer.NAME || ''}`;
  if (/at[\s-]?large/i.test(text)) return 0;
  const n = parseInt(layer.BASENAME, 10);
  if (!Number.isNaN(n)) return n;
  const m = /(\d+)/.exec(layer.NAMELSAD || '');
  return m ? parseInt(m[1], 10) : null;
}

async function geocode(address) {
  const url = `${CENSUS_URL}?address=${encodeURIComponent(address)}`
    + `&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Census geocoder error ${r.status}`);
  const data = await r.json();
  const match = data.result?.addressMatches?.[0];
  if (!match) return null;

  const geo   = match.geographies || {};
  const state = firstLayerMatching(geo, /^states$/i);
  const cd    = firstLayerMatching(geo, /congressional district/i);
  const comp  = match.addressComponents || {};

  return {
    lat: match.coordinates?.y,
    lng: match.coordinates?.x,
    stateAbbr: state?.STUSAB || comp.state || '',
    city: comp.city || '',
    zip: comp.zip || '',
    cd: districtNumber(cd),
  };
}

// ── Federal: unitedstates/congress-legislators ────────────────────────────────
function photoFor(bioguide) {
  return bioguide ? `https://unitedstates.github.io/images/congress/450x550/${bioguide}.jpg` : undefined;
}

function buildFederal(legislators, social, stateAbbr, cd) {
  const socialBy = {};
  (social || []).forEach(s => { if (s.id?.bioguide) socialBy[s.id.bioguide] = s.social || {}; });

  const officials = [];
  const offices = [];

  const add = (leg, term, officeName) => {
    const bioguide = leg.id?.bioguide;
    const soc = socialBy[bioguide] || {};
    const identifiers = [];
    if (soc.twitter)                    identifiers.push({ identifier_type: 'TWITTER',   identifier: soc.twitter });
    if (soc.facebook)                   identifiers.push({ identifier_type: 'FACEBOOK',  identifier: soc.facebook });
    if (soc.youtube_id || soc.youtube)  identifiers.push({ identifier_type: 'YOUTUBE',   identifier: soc.youtube_id || soc.youtube });
    if (soc.instagram)                  identifiers.push({ identifier_type: 'INSTAGRAM', identifier: soc.instagram });

    const line = term.office || term.address || '';
    const idx = officials.length;
    officials.push({
      name: leg.name?.official_full || `${leg.name?.first || ''} ${leg.name?.last || ''}`.trim(),
      party: term.party || '',
      phones: term.phone ? [term.phone] : [],
      urls: term.url ? [term.url] : [],
      photoUrl: photoFor(bioguide),
      addresses: line ? [{ address_1: line, address_2: '', city: '', state: '', postal_code: '', phone_1: term.phone || '', fax_1: '' }] : [],
      emailAddresses: [],
      notes: [],
      committees: [],
      identifiers,
      termStart: term.start || '',
      termEnd: term.end || '',
    });
    offices.push({ name: officeName, levels: ['country'], officialIndices: [idx] });
  };

  legislators.forEach(leg => {
    const terms = leg.terms || [];
    const term = terms[terms.length - 1];
    if (!term || term.state !== stateAbbr) return;

    if (term.type === 'sen') {
      add(leg, term, 'U.S. Senator');
    } else if (term.type === 'rep' && cd != null && Number(term.district) === Number(cd)) {
      add(leg, term, `U.S. Representative, ${term.state} ${cd === 0 ? 'At-Large' : `District ${cd}`}`);
    }
  });

  return { officials, offices };
}

// ── State: OpenStates API v3 ─────────────────────────────────────────────────
async function buildState(lat, lng) {
  const key = process.env.OPENSTATES_API_KEY;
  if (!key || lat == null || lng == null) return { officials: [], offices: [] };

  try {
    const url = `${OPENSTATES_URL}?lat=${lat}&lng=${lng}&include=offices&include=links&apikey=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    if (!r.ok) return { officials: [], offices: [] };
    const data = await r.json();

    const officials = [];
    const offices = [];

    (data.results || []).forEach(p => {
      const role = p.current_role || {};
      const chamber = role.org_classification === 'upper' ? 'Senate'
                    : role.org_classification === 'lower' ? 'House'
                    : 'Legislature';
      const juris = p.jurisdiction?.name || 'State';
      const distr = role.district != null && role.district !== '' ? ` — District ${role.district}` : '';
      const officeName = `${role.title || 'Legislator'}, ${juris} ${chamber}${distr}`;

      const addresses = (p.offices || [])
        .map(o => ({ address_1: o.address || '', address_2: '', city: '', state: '', postal_code: '', phone_1: o.voice || '', fax_1: o.fax || '' }))
        .filter(a => a.address_1 || a.phone_1);

      const idx = officials.length;
      officials.push({
        name: p.name || '',
        party: p.party || '',
        phones: (p.offices || []).map(o => o.voice).filter(Boolean),
        urls: (p.links || []).map(l => l.url).filter(Boolean).slice(0, 1),
        photoUrl: p.image || undefined,
        addresses,
        emailAddresses: p.email ? [p.email] : [],
        notes: [],
        committees: [],
        identifiers: [],
        termStart: '',
        termEnd: '',
      });
      offices.push({ name: officeName, levels: ['administrativeArea1'], officialIndices: [idx] });
    });

    return { officials, offices };
  } catch {
    return { officials: [], offices: [] };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Address is required' });

  try {
    const loc = await geocode(address);
    if (!loc) return res.status(400).json({ error: 'Could not locate that address. Add a city and state and try again.' });

    const [legislators, social] = await Promise.all([
      cachedJson(LEG_URL, legCache),
      cachedJson(SOCIAL_URL, socialCache).catch(() => []),
    ]);

    const fed = buildFederal(legislators, social, loc.stateAbbr, loc.cd);
    const st  = await buildState(loc.lat, loc.lng);

    const officials = [...fed.officials, ...st.officials];
    const offices = [
      ...fed.offices,
      ...st.offices.map(o => ({ ...o, officialIndices: o.officialIndices.map(i => i + fed.officials.length) })),
    ];

    return res.status(200).json({
      normalizedInput: { city: loc.city, state: loc.stateAbbr },
      offices,
      officials,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
