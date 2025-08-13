import type { NextApiRequest, NextApiResponse } from "next";
import fetch from "node-fetch";
import { CookieJar } from "tough-cookie";
import { fetchWithJar, fetchAllPlaces, fetchDetailHTMLAll, extractId, BOOK, BASE } from "../../lib/helpers";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = (req.query.start as string) || "";
    const nights = parseInt(req.query.nights as string) || 1;
    const region = (req.query.region as string) || "";

    // Make a cookie jar and warm it up
    const jar = new CookieJar();

    // ---------- TEMP INSPECT MODE (only when ?inspect=1) ----------
    if (String(req.query.inspect || "") === "1") {
      // Fetch one page of places so we can inspect a single detail page HTML
      const list = await fetchAllPlaces(jar);
      const pick =
        list.find(p => p.url.includes("aaby-skoven")) // try a stable slug first
        || list[0];

      if (!pick) {
        return res.status(200).json({
          debug: { note: "No places returned from list API – cannot inspect." }
        });
      }

      // Fetch detail HTML using cookie-aware helper and try to extract the ID
      const html = await fetchDetailHTMLAll(pick.url, jar);
      const snippet = html ? html.slice(0, 800) : "(no html or fetch failed)";
      const extracted = html ? extractId(html) : null;

      // Also try the bookings endpoint using the slug fallback, to see if it returns JSON
      const slugMatch = pick.url.match(/\/sted\/([^/]+)\//i);
      const slug = slugMatch ? slugMatch[1] : null;
      let slugProbe: any = null;
      if (slug) {
        try {
          const probeUrl = `${BOOK}?` + new URLSearchParams({ u: slug, d: "20250907" }).toString();
          const r = await fetchWithJar(probeUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Accept": "application/json, text/javascript, */*;q=0.1",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": `${BASE}/soeg/?s1=3012`,
            },
          }, jar);
          const text = await r.text();
          slugProbe = { ok: r.ok, status: r.status, textPreview: text.slice(0, 200) };
        } catch (e: any) {
          slugProbe = { error: e?.message || String(e) };
        }
      }

      // Return inspect payload
      return res.status(200).json({
        inspect: true,
        testing: pick.url,
        place_id_from_list: pick.place_id ?? null,
        extracted_from_html: extracted,
        html_snippet: snippet,
        slug,
        slug_probe: slugProbe,
        cookie_header: jar.toJSON(),
      });
    }
    // ---------- END TEMP INSPECT MODE ----------

    // Normal search flow
    const places = await fetchAllPlaces(jar, start, nights, region);

    return res.status(200).json({
      count: places.length,
      items: places,
    });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message || String(err) });
  }
}
