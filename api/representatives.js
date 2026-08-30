// Representatives lookup — calls the Google Civic Information API directly.
// Free / public; uses the same GOOGLE_API_KEY as /api/autocomplete. No paid APIs.

const CHANNEL_TO_IDENTIFIER = {
  Twitter: 'TWITTER',
  Facebook: 'FACEBOOK',
  YouTube: 'YOUTUBE',
  Instagram: 'INSTAGRAM',
  GooglePlus: 'GOOGLEPLUS',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Address is required' });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GOOGLE_API_KEY not configured' });

  const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${apiKey}`;

  try {
    const r = await fetch(url);
    const data = await r.json();

    if (data.error) {
      return res.status(data.error.code || 400).json({ error: data.error.message || 'Lookup failed' });
    }

    const rawOfficials = data.officials || [];
    const rawOffices = data.offices || [];

    if (rawOfficials.length === 0) {
      return res.status(400).json({ error: 'No representatives found for this address.' });
    }

    const ni = data.normalizedInput || {};
    const normalizedInput = { city: ni.city || '', state: ni.state || '' };

    // Normalize Google Civic's shape into the shape the frontend already consumes.
    const officials = rawOfficials.map(o => {
      const phone = (o.phones || [])[0] || '';

      const addresses = (o.address || []).map(a => ({
        address_1: a.line1 || '',
        address_2: [a.line2, a.line3].filter(Boolean).join(', '),
        city: a.city || '',
        state: a.state || '',
        postal_code: a.zip || '',
        phone_1: phone,
        fax_1: '',
      }));

      const identifiers = (o.channels || [])
        .filter(c => c.id && CHANNEL_TO_IDENTIFIER[c.type])
        .map(c => ({ identifier_type: CHANNEL_TO_IDENTIFIER[c.type], identifier: c.id }));

      return {
        name: o.name || '',
        party: o.party || '',
        phones: o.phones || [],
        urls: o.urls || [],
        photoUrl: o.photoUrl || undefined,
        addresses,
        emailAddresses: o.emails || [],
        notes: [],
        committees: [],
        identifiers,
        termStart: '',
        termEnd: '',
      };
    });

    const offices = rawOffices.map(office => ({
      name: office.name || 'Unknown Office',
      levels: office.levels && office.levels.length ? office.levels : ['locality'],
      officialIndices: office.officialIndices || [],
    }));

    return res.status(200).json({ normalizedInput, offices, officials });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
