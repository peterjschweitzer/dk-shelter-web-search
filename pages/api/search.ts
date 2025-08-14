// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";

// Let Next run this on the server (Node), not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Types
type Place = {
  title: string;
  url: string;
  slug: string;
  place_id: number | null;
  lat: number | null;
  lng: number | null;
  region: string; // will be set if matched by bbox
};

// ---- Constants
const BASE = "https://book.naturstyrelsen.dk";
const LIST = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp`;
const BOOK = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxgetbookingsforsingleplace.asp`;

// These are *category/type ids* that sometimes appear where a PlaceID should be.
// We must never treat these as real place ids.
const TYPE_IDS = new Set([3012, 3031, 3091]);

// Region bounding boxes (latMin, latMax, lonMin, lonMax)
const PRESETS: Record<string, [number, number, number, number]> = {
  "sjælland": [54.60, 55.95, 11.00, 12.80],
  fyn: [55.0, 55.6, 9.6, 10.8],
  jylland: [54.55, 57.8, 8.0, 10.6],
  bornholm: [55.0, 55.4, 14.6, 15.3],
  "lolland-falster": [54.5, 54.95, 11.05, 12.3],
  "møn": [54.85, 55.08, 12.15, 12.6],
  amager: [55.55, 55.75, 12.45, 12.75],
};

// Aliases / diacritic-insensitive lookups
const ALIAS: Record<string, string> = {
  sjaelland: "sjælland",
  zealand: "sjælland",
  sjalland: "sjælland",
  fyn: "fyn",
  funen: "fyn",
  jylland: "jylland",
  jutland: "jylland",
  jyland: "jylland",
  bornholm: "bornholm",
  lolland: "lolland-falster",
  falster: "lolland-falster",
  lollandfalster: "lolland-falster",
  moen: "møn",
  mon: "møn",
  "møn": "møn",
  amager: "amager",
};

function normKey(s: string) {
  return s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[\s_-]/g, "");
}
function resolveRegionName(q: string | null | undefined) {
  if (!q) return null;
  const ql = q.toLowerCase();
  if (PRESETS[ql]) return ql;
  const n = normKey(q);
  return ALIAS[n] ?? null;
}

// ---- Load prebuilt slug → PlaceID map
// Ensure tsconfig has: "resolveJsonModule": true
import slugToIdRaw from "../../data/place_ids.json";
const SLUG_TO_ID: Record<string, number> = slugToIdRaw as Record<string, number>;

// ---- Helpers
async function tolerantJSON<T = any>(resp: Response): Promise<T> {
  const txt = await resp.text();
  try {
    return JSON.parse(txt);
  } catch {
    const m = txt.match(/\{[\s\S]*\}\s*$/);
    if (!m) throw new Error("Bad JSON from endpoint");
    return JSON.parse(m[0]);
  }
}

async function fetchListPage(pageNum: number) {
  const url = LIST + "?" + new URLSearchParams({
    pid: "0",
    p: String(pageNum),
    r: "50000",
    ps: "200",
    t: "1",
  }).toString();

  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/javascript, */*;q=0.1",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/soeg/?s1=3012`,
    },
    // no-cache to keep things fresh
    cache: "no-store",
  });

  if (!r.ok) throw new Error(`LIST ${r.status}`);
  return tolerantJSON<any>(r);
}

async function fetchAllPlaces(): Promise<Place[]> {
  const out: Place[] = [];
  for (let p = 1; p <= 999; p++) {
    const data = await fetchListPage(p);
    const rows = data?.BookingPlacesList ?? [];
    if (!rows.length) break;

    for (const c of rows) {
      const uri: string = String(c.Uri || "").trim().replace(/^\/|\/$/g, "");
      if (!uri) continue;
      const lat = Number(c.DoubleLat ?? c.Lat ?? NaN);
      const lng = Number(c.DoubleLng ?? c.Lng ?? NaN);
      const title: string =
        c.Title ||
        uri.replace(/-/g, " ").replace(/\b\w/g, (m: string) => m.toUpperCase());

      // Use prebuilt ID map (critical!)
      const placeId = SLUG_TO_ID[uri];
      const place_id =
        Number.isFinite(placeId) && !TYPE_IDS.has(placeId) ? placeId : null;

      out.push({
        title,
        url: `${BASE}/sted/${uri}/`,
        slug: uri,
        place_id,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        region: "",
      });
    }

    if (rows.length < 200) break;
    await new Promise((r) => setTimeout(r, 110)); // polite pacing
  }
  return out;
}

async function fetchBookedDatesById(
  id: number,
  yyyymmdd: string
): Promise<Set<string>> {
  const params = new URLSearchParams({ i: String(id), d: yyyymmdd });
  const r = await fetch(`${BOOK}?${params.toString()}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/javascript, */*;q=0.1",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/soeg/?s1=3012`,
    },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`BOOK ${r.status}`);
  const data = await tolerantJSON<any>(r);
  const arr = (data?.BookingDates ?? []) as any[];
  return new Set(arr.map((s: any) => String(s)));
}

// ---- API handler
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = String(req.query.start || "");
    const nights = Math.max(1, Number(req.query.nights || 1));
    const maxPlaces = Math.max(0, Number(req.query.maxPlaces || 0));

    // region may be single or multi
    const regionsInput = ([] as string[]).concat(req.query.region || []).filter(Boolean) as string[];
    const regionKeys = regionsInput
      .map((r) => resolveRegionName(r))
      .filter(Boolean) as string[];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return res.status(400).json({ error: "start must be YYYY-MM-DD" });
    }

    // Dates to require free (exact night-by-night)
    const needs: string[] = [];
    {
      const base = new Date(start + "T00:00:00Z");
      for (let i = 0; i < nights; i++) {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + i);
        needs.push(d.toISOString().slice(0, 10));
      }
    }
    const yyyymmdd = start.replace(/-/g, ""); // any day in the target month works

    // 1) List all places
    let places = await fetchAllPlaces();

    // 2) Optional region filter (via bounding boxes)
    if (regionKeys.length) {
      places = places.filter((p) => {
        if (p.lat == null || p.lng == null) return false;
        let hit = false;
        for (const k of regionKeys) {
          const [latMin, latMax, lonMin, lonMax] = PRESETS[k];
          const ok = p.lat >= latMin && p.lat <= latMax && p.lng >= lonMin && p.lng <= lonMax;
          if (ok) {
            p.region = k;
            hit = true;
            break;
          }
        }
        return hit;
      });
    }

    if (maxPlaces > 0) places = places.slice(0, maxPlaces);

    // 3) Availability using *prebuilt IDs only*
    let availChecked = 0;
    let availErrors = 0;
    const available: any[] = [];

    for (const p of places) {
      if (!p.place_id) continue; // skip if no id in the map
      try {
        const booked = await fetchBookedDatesById(p.place_id, yyyymmdd);
        const overlaps = needs.some((d) => booked.has(d));
        if (!overlaps) {
          available.push({
            lat: p.lat,
            lng: p.lng,
            region: p.region,
            name: p.title,
            url: p.url,
            place_id: p.place_id,
          });
        }
        availChecked++;
      } catch {
        availErrors++;
      }
      // light pacing against their backend
      await new Promise((r) => setTimeout(r, 75));
    }

    // Debug payload to help you inspect behavior in prod
    const debug = {
      totalFetched: places.length + (maxPlaces > 0 ? 0 : 0),
      afterRegionFilter: places.length,
      needs,
      yyyymmdd,
      usedIdCount: places.filter((p) => p.place_id != null).length,
      availChecked,
      availErrors,
      sample: places.slice(0, 5).map((p) => ({
        title: p.title,
        url: p.url,
        place_id: p.place_id,
        lat: p.lat,
        lng: p.lng,
        region: p.region,
      })),
    };

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ count: available.length, items: available, debug });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
