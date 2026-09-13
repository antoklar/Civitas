// /api/bill-detail — full detail for one federal bill: metadata, sponsor,
// official CRS summary, and an excerpt of the actual bill text pulled from
// the latest text version's "Formatted Text" document on congress.gov.

const BASE = 'https://api.congress.gov/v3';
const UA = 'Civitas/1.0 (https://civitasus.com; civic engagement app)';
const TEXT_LIMIT = 20000;

function congressFetch(path, apiKey) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${BASE}${path}${sep}format=json&api_key=${apiKey}`);
}

function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// congress.gov's API returns only free-text "latestAction" descriptions, no
// clean stage enum — this is a best-effort read of that prose, not an
// authoritative status field.
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { congress, type, number } = req.query;
  if (!congress || !type || !number) {
    return res.status(400).json({ error: 'congress, type, and number are required' });
  }

  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Congress API key not configured' });

  const billType = String(type).toLowerCase();

  try {
    const [detailRes, summariesRes, textRes] = await Promise.all([
      congressFetch(`/bill/${congress}/${billType}/${number}`, apiKey),
      congressFetch(`/bill/${congress}/${billType}/${number}/summaries`, apiKey),
      congressFetch(`/bill/${congress}/${billType}/${number}/text`, apiKey),
    ]);

    if (!detailRes.ok) {
      return res.status(detailRes.status === 404 ? 404 : 502).json({ error: 'Bill not found' });
    }

    const detailData = await detailRes.json();
    const bill = detailData.bill || {};

    const summariesData = await summariesRes.json().catch(() => ({}));
    const summaries = summariesData.summaries || [];
    const latestSummary = summaries.slice()
      .sort((a, b) => new Date(b.actionDate || 0) - new Date(a.actionDate || 0))[0] || null;

    const textData = await textRes.json().catch(() => ({}));
    const versions = textData.textVersions || [];
    const latestVersion = versions.slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0] || null;
    const format = latestVersion?.formats?.find(f => /formatted text/i.test(f.type || ''))
      || latestVersion?.formats?.[0] || null;

    let officialTextExcerpt = null;
    let officialTextTruncated = false;
    const officialTextUrl = format?.url || null;

    if (officialTextUrl) {
      try {
        const tr = await fetch(officialTextUrl, { headers: { 'User-Agent': UA } });
        if (tr.ok) {
          const raw = await tr.text();
          const plain = stripHtml(raw);
          officialTextTruncated = plain.length > TEXT_LIMIT;
          officialTextExcerpt = plain.slice(0, TEXT_LIMIT);
        }
      } catch { /* text stays null; officialTextUrl still lets users read it directly */ }
    }

    const sponsor = (bill.sponsors || [])[0] || null;
    const latestActionText = bill.latestAction?.text || '';

    return res.status(200).json({
      congress: bill.congress || Number(congress),
      type: (bill.type || type).toUpperCase(),
      number: bill.number || number,
      title: bill.title || null,
      introducedDate: bill.introducedDate || null,
      policyArea: bill.policyArea?.name || null,
      originChamber: bill.originChamber || null,
      latestAction: bill.latestAction || null,
      stage: detectStage(latestActionText),
      legislationUrl: bill.legislationUrl || `https://www.congress.gov/bill/${congress}th-congress`,
      sponsor: sponsor ? {
        name: `${sponsor.firstName || ''} ${sponsor.lastName || ''}`.trim() || sponsor.fullName || null,
        fullName: sponsor.fullName || null,
        party: sponsor.party || null,
        state: sponsor.state || null,
        bioguideId: sponsor.bioguideId || null,
      } : null,
      officialSummaryHtml: latestSummary?.text || null,
      officialSummaryDate: latestSummary?.actionDate || null,
      officialTextExcerpt,
      officialTextTruncated,
      officialTextUrl,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
