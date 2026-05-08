export default async function handler(req, res) {
  const { input } = req.query;

  if (!input) {
    return res.status(400).json({ error: "Input is required" });
  }

  const apiKey = process.env.GOOGLE_API_KEY;

  try {
    const encoded = encodeURIComponent(input);
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encoded}&components=country:us&types=geocode&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(400).json({ error: `Places API error: ${data.status}` });
    }

    const suggestions = (data.predictions || []).map(p => ({
      main: p.structured_formatting?.main_text || p.description,
      secondary: p.structured_formatting?.secondary_text || "",
      full: p.description,
      place_id: p.place_id
    }));

    return res.status(200).json({ suggestions });

  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch autocomplete suggestions" });
  }
}
