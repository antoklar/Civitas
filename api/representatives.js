export default async function handler(req, res) {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: "Address is required" });
  }

  const apiKey = process.env.GOOGLE_API_KEY;

  try {
    const encoded = encodeURIComponent(address);
    const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encoded}&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch representatives" });
  }
}
