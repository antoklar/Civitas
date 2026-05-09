const DISTRICT_TYPE_TO_LEVEL = {
  NATIONAL_EXEC: 'country',
  NATIONAL_UPPER: 'country',
  NATIONAL_LOWER: 'country',
  STATE_EXEC: 'administrativeArea1',
  STATE_UPPER: 'administrativeArea1',
  STATE_LOWER: 'administrativeArea1',
  LOCAL_EXEC: 'locality',
  LOCAL_UPPER: 'locality',
  LOCAL_LOWER: 'locality',
  CITY_EXEC: 'locality',
  COUNTY_EXEC: 'administrativeArea2',
  COUNTY_UPPER: 'administrativeArea2',
  COUNTY_LOWER: 'administrativeArea2',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Address is required' });

  const apiKey = process.env.CICERO_API_KEY;
  const url = `https://app.cicerodata.com/v3.1/official?search_loc=${encodeURIComponent(address)}&format=json&key=${apiKey}`;

  try {
    const r = await fetch(url);
    const data = await r.json();

    if (data.response?.errors?.length) {
      return res.status(400).json({ error: data.response.errors[0] });
    }

    const candidates = data.response?.results?.candidates || [];
    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No representatives found for this address.' });
    }

    const firstDistrict = candidates[0]?.office?.district || {};
    const normalizedInput = {
      city: firstDistrict.city || '',
      state: firstDistrict.state || '',
    };

    const officials = [];
    const offices = [];

    candidates.forEach((candidate, idx) => {
      const nameParts = [candidate.first_name, candidate.middle_initial, candidate.last_name, candidate.name_suffix];
      const name = nameParts.filter(Boolean).join(' ');
      const phone = candidate.addresses?.[0]?.phone_1 || '';
      const siteUrl = candidate.urls?.[0] || '';
      const photoUrl = candidate.photo_origin_url || '';

      officials.push({
        name,
        party: candidate.party || '',
        phones: phone ? [phone] : [],
        urls: siteUrl ? [siteUrl] : [],
        photoUrl: photoUrl || undefined,
      });

      const districtType = candidate.office?.district?.district_type || '';
      const level = DISTRICT_TYPE_TO_LEVEL[districtType] || 'locality';
      const officeName = candidate.office?.title || 'Unknown Office';

      const existing = offices.find(o => o.name === officeName && o.levels[0] === level);
      if (existing) {
        existing.officialIndices.push(idx);
      } else {
        offices.push({ name: officeName, levels: [level], officialIndices: [idx] });
      }
    });

    return res.status(200).json({ normalizedInput, offices, officials });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
