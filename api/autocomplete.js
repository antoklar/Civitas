module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { input } = req.query;
  if (!input) return res.status(400).json({ error: "Input is required" });
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&types=geocode&key=${apiKey}`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    const suggestions = (data.predictions||[]).map(p => ({
      main: p.structured_formatting?.main_text || p.description,
      secondary: p.structured_formatting?.secondary_text || '',
      full: p.description
    }));
    return res.status(200).json({ suggestions });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
