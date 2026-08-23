const UA = 'Civitas/1.0 (https://civitasus.com; civic engagement app)';
const POLITICAL_DESC = /senator|representative|politician|congress|governor|mayor|council|assembly|legislator|attorney general|secretary of state|commissioner|supervisor|alderman|selectman|state house|state senate|judge|sheriff/i;

async function wdFetch(params) {
  const url = `https://www.wikidata.org/w/api.php?${params}&format=json`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return r.json();
}

function yearFromWdTime(timeVal) {
  if (!timeVal) return null;
  const m = /^[+-](\d{4})/.exec(timeVal);
  return m ? parseInt(m[1], 10) : null;
}

function claimYears(claim) {
  const q = claim.qualifiers || {};
  const start = q.P580?.[0]?.datavalue?.value?.time;
  const end = q.P582?.[0]?.datavalue?.value?.time;
  return { startYear: yearFromWdTime(start), endYear: yearFromWdTime(end) };
}

function claimTargetId(claim) {
  return claim.mainsnak?.datavalue?.value?.id || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const search = await wdFetch(`action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=6`);
    const candidates = (search.search || []).map(s => s.id);
    if (!candidates.length) return res.status(200).json({ found: false });

    const entitiesData = await wdFetch(`action=wbgetentities&ids=${candidates.join('|')}&props=labels|descriptions|claims|sitelinks&languages=en`);
    const entities = entitiesData.entities || {};

    let chosenId = null;
    for (const id of candidates) {
      const desc = entities[id]?.descriptions?.en?.value || '';
      if (POLITICAL_DESC.test(desc)) { chosenId = id; break; }
    }
    if (!chosenId) return res.status(200).json({ found: false });

    const entity = entities[chosenId];
    const claims = entity.claims || {};

    const positionClaims = claims.P39 || [];
    const educationClaims = claims.P69 || [];
    const membershipClaims = claims.P463 || [];
    const employerClaims = claims.P108 || [];

    const idsToResolve = new Set();
    [...positionClaims, ...educationClaims, ...membershipClaims, ...employerClaims].forEach(c => {
      const id = claimTargetId(c);
      if (id) idsToResolve.add(id);
    });

    let labels = {};
    if (idsToResolve.size) {
      const idList = [...idsToResolve];
      const chunks = [];
      for (let i = 0; i < idList.length; i += 50) chunks.push(idList.slice(i, i + 50));
      const results = await Promise.all(chunks.map(c => wdFetch(`action=wbgetentities&ids=${c.join('|')}&props=labels&languages=en`)));
      results.forEach(r => {
        Object.entries(r.entities || {}).forEach(([id, e]) => {
          labels[id] = e.labels?.en?.value || null;
        });
      });
    }

    const timeline = [];

    positionClaims.forEach(c => {
      const targetId = claimTargetId(c);
      const label = targetId ? labels[targetId] : null;
      if (!label) return;
      const { startYear, endYear } = claimYears(c);
      timeline.push({ type: 'position', label, startYear, endYear });
    });

    educationClaims.forEach(c => {
      const targetId = claimTargetId(c);
      const label = targetId ? labels[targetId] : null;
      if (!label) return;
      const { startYear, endYear } = claimYears(c);
      timeline.push({ type: 'education', label, startYear, endYear });
    });

    membershipClaims.forEach(c => {
      const targetId = claimTargetId(c);
      const label = targetId ? labels[targetId] : null;
      if (!label) return;
      const { startYear, endYear } = claimYears(c);
      timeline.push({ type: 'membership', label, startYear, endYear });
    });

    employerClaims.forEach(c => {
      const targetId = claimTargetId(c);
      const label = targetId ? labels[targetId] : null;
      if (!label) return;
      const { startYear, endYear } = claimYears(c);
      timeline.push({ type: 'employment', label, startYear, endYear });
    });

    const merged = [];
    const byKey = new Map();
    timeline.forEach(t => {
      const key = `${t.type}::${t.label}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(t);
    });
    byKey.forEach(entries => {
      entries.sort((a, b) => (a.startYear || 0) - (b.startYear || 0));
      let current = null;
      entries.forEach(e => {
        if (current && e.startYear !== null && current.endYear !== null && e.startYear <= current.endYear + 1) {
          current.endYear = e.endYear === null ? null : Math.max(current.endYear, e.endYear);
          if (e.endYear === null) current.endYear = null;
        } else {
          current = { ...e };
          merged.push(current);
        }
      });
    });

    merged.sort((a, b) => (b.startYear || b.endYear || 0) - (a.startYear || a.endYear || 0));

    let wikipediaExtract = null;
    let wikipediaUrl = null;
    const wikiTitle = entity.sitelinks?.enwiki?.title;
    if (wikiTitle) {
      try {
        const wpRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`, { headers: { 'User-Agent': UA } });
        if (wpRes.ok) {
          const wpData = await wpRes.json();
          wikipediaExtract = wpData.extract || null;
          wikipediaUrl = wpData.content_urls?.desktop?.page || null;
        }
      } catch {}
    }

    return res.status(200).json({ found: true, wikipediaExtract, wikipediaUrl, timeline: merged });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
