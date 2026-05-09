export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { input } = req.query;
  if (!input) return res.status(400).json({ error: "Input is required" });

  const apiKey = process.env.GOOGLE_API_KEY;
  const encoded = encodeURIComponent(input);
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encoded}&components=country:us&types=geocode&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const suggestions = (data.predictions || []).map(p => ({
      main: p.structured_formatting?.main_text || p.description,
      secondary: p.structured_formatting?.secondary_text || "",
      full: p.description
    }));
    return res.status(200).json({ suggestions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
