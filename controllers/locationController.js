//////////////////////////////////////
//LocationIQ API
//////////////////////////////////////
export const getLocationApi = async (req, res) => {
  try {
    const { q, lat, lon } = req.query;
    const apiKey = process.env.LOCATIONIQ_KEY;
    const baseUrl = process.env.LOCATIONIQ_URL;
    const limit = process.env.LOCATIONIQ_SEARCH_LIMIT || 5;

    let url = "";

    if (lat && lon) {
      url = `${baseUrl}/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json`;
    } else if (q) {
      url = `${baseUrl}/autocomplete?key=${apiKey}&q=${q}&limit=${limit}`;
    } else {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`LocationIQ responded with ${response.status}`);
    }

    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    console.error("Location Controller Error:", error.message);
    res.status(500).json({
      error: "Location fetching failed",
      success: false,
    });
  }
};
