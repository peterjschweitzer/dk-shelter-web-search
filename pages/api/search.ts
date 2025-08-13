// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Shelter = {
  title: string;
  url: string;
  lat: number;
  lng: number;
  region?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { start, nights, region } = req.query;

  if (!start || !nights) {
    res.status(400).json({ error: "Missing required query parameters: start, nights" });
    return;
  }

  try {
    // 1. Get shelter list from Naturstyrelsen API
    const listUrl = "https://book.naturstyrelsen.dk/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp?pid=0&p=1&r=50000&ps=500&t=1";
    const response = await fetch(listUrl);
    const data = await response.json();

    let places: Shelter[] = data.BookingPlacesList.map((p: any) => ({
      title: p.Title,
      url: `https://book.naturstyrelsen.dk/sted/${p.Uri}/`,
      lat: parseFloat(p.Lat),
      lng: parseFloat(p.Lng),
      region: p.Region || "Unknown"
    }));

    // 2. Region filter (if requested)
    if (region) {
      const regionLower = String(region).toLowerCase();
      places = places.filter(p => p.region?.toLowerCase().includes(regionLower));
    }

    // 3. Availability check (for each place)
    const startDate = String(start);
    const needsDates = Array.from({ length: Number(nights) }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return d.toISOString().split("T")[0];
    });

    const available: Shelter[] = [];

    for (const place of places) {
      try {
        const availUrl = `https://book.naturstyrelsen.dk/includes/branding_files/shelterbooking/includes/inc_ajaxbookingcal.asp?pid=${place.url.split("/sted/")[1]}&year=${startDate.split("-")[0]}&month=${startDate.split("-")[1]}`;
        const calRes = await fetch(availUrl);
        const calData = await calRes.json();

        // If none of the needsDates are booked, mark available
        const bookedDates = calData.BookingCalList.map((d: any) => d.Date);
        const isAvailable = needsDates.every(date => !bookedDates.includes(date));

        if (isAvailable) {
          available.push(place);
        }
      } catch (err) {
        console.error(`Error checking ${place.title}:`, err);
      }
    }

    res.status(200).json({ results: available });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
