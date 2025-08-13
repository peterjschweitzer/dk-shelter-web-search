import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { start, nights } = req.query;

  if (!start) {
    res.status(400).json({ error: "start date required" });
    return;
  }

  // TODO: Replace with your shelter availability logic
  const dummyResults = [
    { title: "Example Shelter", url: "https://book.naturstyrelsen.dk/sted/example", region: "Sjælland" }
  ];

  res.status(200).json({ results: dummyResults });
}
