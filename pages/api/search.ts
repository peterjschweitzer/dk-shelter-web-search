// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";
import placeIdMap from "../../data/place_ids.json";

// Server runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Region presets & helpers ----------
type PlaceRow = {
  Title: string;
  Uri: string;
  DoubleLat?: number | string;
  DoubleLng?: number | string;
  Lat?: number | string;
  Lng?: number | string;
};

type Place = {
  title: string;
  url: string;
  place_id: number | null;
  lat: number | null;
  lng: number | null;
  region: string;
};

const BASE = "https://book.naturstyrelsen.dk";
const LIST = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp`;
const BOOK = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxgetbookingsforsingleplace.asp`;

// bounding boxes
const PRESETS: Record<string, [number, number, number, number]> = {
  "sjælland": [54.60, 55.95, 11.00, 12.80],
  fyn: [55.0, 55.6, 9.6, 10.8],
  jylland: [54.55, 57.8, 8.0, 10.6],
  bornholm: [55.0, 55.4, 14.6, 15.3],
  "lolland-falster": [54.5, 54.95, 11.05, 12.3],
  "møn": [54.85, 55.08, 12.15, 12.6],
  amager: [55.55, 55.75, 12.45, 12.75],
};

const ALIAS: Record<string, string> = {
  sjaelland: "sjælland", zealand: "sjælland", sjalland: "sjælland",
  funen: "fyn",
  jutland: "jylland", jyland: "jylland",
  lolland: "lolland-falster", falster: "lolland-falster", lollandfalster: "lolland-falster",
  moen: "møn", mon: "møn",
};

function norm(s: string) {
  return s.toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .replace(/[\s_-]/g, "");
}
function resolveRegionName(q: string) {
  if (!q) return null;
  const ql = q.toLowerCase();
  if (PRESETS[ql]) return ql;
  return ALIAS[norm(q)] ?? null;
}

// ---------- ISO-8859-1 JSON fetcher ----------
async function fetchJsonISO(url: string, params: Record<string, string>) {
  const u = url + "?" + new URLSearchParams(params).toString();
  const res = await fetch(u, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/javascript, */*;q=0.1",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/soeg/?s1=3012`,
    },
  });
  if (!res.ok) throw new Error(`${res.status} on ${u}`);

  // Decode as ISO-8859-1 (Latin-1) to keep æ/ø/å intact.
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("iso-8859-1").decode(buf);

  // Some responses are labelled text/html; still JSON body.
  try {
    return JSON.parse(text);
  } catch {
    // If there’s any stray padding, try to extract { ... } part.
    const m = text.match(/\{[\s\S]*\}\s*$/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Failed to parse JSON (ISO-8859-1)");
  }
}

// ---------- Data fetchers ----------
async function fetchAllPlaces(): Promise<Place[]> {
  const out: Place[] = [];
  for (let p = 1; p <= 500; p++) {
    const data = await fetchJsonISO(LIST, {
      pid: "0", p: String(p), r: "50000", ps: "200", t: "1",
    });
    const rows: PlaceRow[] = data?.BookingPlacesList ?? [];
    if (!rows.length) break;

    for (const c of rows) {
      const uri = String(c.Uri || "").trim().replace(/^\/|\/$/g, "");
      if (!uri) continue;

      const lat = Number((c as any).DoubleLat ?? c.Lat ?? NaN);
      const lng = Number((c as any).DoubleLng ?? c.Lng ?? NaN);
      out.push({
        title: String((c as any).Title || uri),
        url: `${BASE}/sted/${uri}/`,
        place_id: (placeIdMap as Record<string, number | null>)[uri] ?? null,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        region: "",
      });
    }
    if (rows.length < 200) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return out;
}

async function fetchBookedDatesById(placeId: number, monthYYYYMMDD: string): Promise<Set<string>> {
  const data = await fetchJsonISO(BOOK, { i: String(placeId), d: monthYYYYMMDD });
  const arr = data?.BookingDates ?? [];
  return new Set(arr.map((s: any) => String(s)));
}

async function fetchBookedDatesBySlug(slug: string, monthYYYYMMDD: string): Promise<Set<string>> {
  // some pages allow calling the endpoint without explicit id if Referer=place page
  const u = BOOK + "?" + new URLSearchParams({ d: monthYYYYMMDD }).toString();
  const res = await fetch(u, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/javascript, */*;q=0.1",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/sted/${slug}/`,
    },
  });
  if (!res.ok) throw new Error(`slug lookup ${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("iso-8859-1").decode(buf);
  const data = JSON.parse(text);
  const arr = data?.BookingDates ?? [];
  return new Set(arr.map((s: any) => String(s)));
}

// ---------- API handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = String(req.query.start || "");
    const nights = Math.max(1, Number(req.query.nights || 1));
    const regionsQ = ([]
      .concat(req.query.region as any || [])
      .filter(Boolean) as string[])
      .map(resolveRegionName)
      .filter(Boolean) as string[];

    const maxPlaces = Math.max(0, Number(req.query.maxPlaces || 0));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return res.status(400).json({ error: "start must be YYYY-MM-DD" });
    }

    // build required date list
    const needs: string[] = [];
    const base = new Date(start + "T00:00:00Z");
    for (let i = 0; i < nights; i++) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() + i);
      needs.push(d.toISOString().slice(0, 10));
    }
    const monthParam = start.slice(0, 7).replace("-", "") + "01"; // YYYYMM01

    // 1) places
    let places = await fetchAllPlaces();

    // 2) region filter
    if (regionsQ.length) {
      places = places.filter(p => {
        if (p.lat == null || p.lng == null) return false;
        const ok = regionsQ.some(k => {
          const [latMin, latMax, lonMin, lonMax] = PRESETS[k];
          const inside = p.lat! >= latMin && p.lat! <= latMax && p.lng! >= lonMin && p.lng! <= lonMax;
          if (inside) p.region = k;
          return inside;
        });
        return ok;
      });
    }

    if (maxPlaces > 0) places = places.slice(0, maxPlaces);

    // 3) availability
    const items: any[] = [];
    let usedId = 0, usedSlug = 0, availErrors = 0;
    for (const p of places) {
      try {
        let booked: Set<string>;
        if (p.place_id) {
          usedId++;
          booked = await fetchBookedDatesById(p.place_id, monthParam);
        } else {
          usedSlug++;
          const slug = p.url.replace(/^.+\/sted\/|\/$/g, "");
          booked = await fetchBookedDatesBySlug(slug, monthParam);
        }
        const overlaps = needs.some(d => booked.has(d));
        if (!overlaps) {
          items.push({
            name: p.title,
            url: p.url,
            lat: p.lat,
            lng: p.lng,
            region: p.region || "",
            place_id: p.place_id ?? null,
          });
        }
      } catch {
        availErrors++;
      }
      await new Promise(r => setTimeout(r, 60));
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      count: items.length,
      items,
      debug: {
        totalFetched: places.length,
        afterRegionFilter: places.length,
        monthParam,
        needs,
        availChecked: places.length,
        availErrors,
        usedId,
        usedSlug,
        placeIdCount: Object.keys(placeIdMap as Record<string, number>).length,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
