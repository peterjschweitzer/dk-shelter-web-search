// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// Category/type ids (NOT real place ids)
const TYPE_IDS = new Set([3012, 3031, 3091]);

// Region presets (lat_min, lat_max, lon_min, lon_max)
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
  fyn: "fyn", funen: "fyn",
  jylland: "jylland", jutland: "jylland", jyland: "jylland",
  bornholm: "bornholm",
  lolland: "lolland-falster", falster: "lolland-falster", lollandfalster: "lolland-falster",
  moen: "møn", mon: "møn", "møn": "møn",
  amager: "amager",
};

function norm(s: string) {
  return s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").replace(/[\s_-]/g, "");
}
function resolveRegionName(q: string) {
  if (PRESETS[q.toLowerCase()]) return q.toLowerCase();
  const n = norm(q);
  return ALIAS[n] ?? null;
}

async function getJSON(url: string, params: Record<string, string>) {
  const u = url + "?" + new URLSearchParams(params).toString();
  const r = await fetch(u, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/javascript, */*;q=0.1",
      "Accept-Language": "da-DK,da;q=0.9,en-US;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/soeg/?s1=3012`,
    },
  });
  if (!r.ok) throw new Error(`${r.status} on ${u}`);
  const text = await r.text(); // sometimes served as text/html
  return JSON.parse(text);
}

async function fetchAllPlaces(): Promise<Place[]> {
  const out: Place[] = [];
  for (let p = 1; p <= 500; p++) {
    const data = await getJSON(LIST, { pid: "0", p: String(p), r: "50000", ps: "200", t: "1" });
    const rows = data?.BookingPlacesList ?? [];
    if (!rows.length) break;
    for (const c of rows) {
      const uri = String(c.Uri || "").trim().replace(/^\/|\/$/g, "");
      if (!uri) continue;
      let placeId = Number(c.PlaceID ?? NaN);
      if (!Number.isFinite(placeId) || TYPE_IDS.has(placeId)) placeId = NaN;
      const lat = Number(c.DoubleLat ?? c.Lat ?? NaN);
      const lng = Number(c.DoubleLng ?? c.Lng ?? NaN);
      out.push({
        title: c.Title || uri.replace(/-/g, " ").replace(/\b\w/g, (m: string) => m.toUpperCase()),
        url: `${BASE}/sted/${uri}/`,
        place_id: Number.isFinite(placeId) ? placeId : null,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        region: c.RegionName || "",
      });
    }
    if (rows.length < 200) break;
    await new Promise(r => setTimeout(r, 120)); // polite
  }
  return out;
}

/** Try multiple variants to get the real page markup. */
async function fetchDetailHTMLAll(url: string): Promise<string | null> {
  const base = url.endsWith("/") ? url : url + "/";
  const candidates = [
    base,
    base + "?noheadfoot=true",
  ];
  for (const u of candidates) {
    const r = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "da-DK,da;q=0.9,en-US;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    if (r.ok) {
      const html = await r.text();
      if (html && html.length > 500) return html;
    }
  }
  return null;
}

/** Broader patterns: covers multiple ways the ID may be embedded. */
function extractId(html: string): number | null {
  const patterns = [
    /inc_ajaxgetbookingsforsingleplace\.asp\?i=(\d+)/i,
    /data-place-id\s*=\s*"(\d+)"/i,
    /data-placeid\s*=\s*"(\d+)"/i,
    /["'\s]place[_\s-]*id["']?\s*[:=]\s*"?(\d+)"?/i,
    /\bplaceId\s*[:=]\s*(\d+)/i,
    /[?&]i=(\d+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const id = Number(m[1]);
      if (Number.isFinite(id) && !TYPE_IDS.has(id)) return id;
    }
  }
  return null;
}

function slugFromUrl(url: string) {
  const m = url.match(/\/sted\/([^/]+)\//i);
  return m ? m[1] : null;
}

/** Try numeric place_id first; if missing/fails, try slug fallback. */
async function fetchBookedDatesFlex(place: { place_id: number | null; url: string }, yyyymmdd: string): Promise<Set<string>> {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*;q=0.1",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${BASE}/soeg/?s1=3012`,
  };

  // 1) numeric id
  if (place.place_id) {
    const u = `${BOOK}?` + new URLSearchParams({ i: String(place.place_id), d: yyyymmdd }).toString();
    const r = await fetch(u, { headers });
    if (r.ok) {
      const text = await r.text();
      try {
        const data = JSON.parse(text);
        return new Set((data?.BookingDates ?? []).map((s: any) => String(s)));
      } catch {}
    }
  }

  // 2) slug fallback
  const slug = slugFromUrl(place.url);
  if (slug) {
    const u2 = `${BOOK}?` + new URLSearchParams({ u: slug, d: yyyymmdd }).toString();
    const r2 = await fetch(u2, { headers });
    if (r2.ok) {
      const text2 = await r2.text();
      try {
        const data2 = JSON.parse(text2);
        return new Set((data2?.BookingDates ?? []).map((s: any) => String(s)));
      } catch {}
    }
  }

  return new Set();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = String(req.query.start || "");
    const nights = Math.max(1, Number(req.query.nights || 1));
    const regions = ([] as string[]).concat(req.query.region || []).filter(Boolean) as string[];
    const maxPlaces = Math.max(0, Number(req.query.maxPlaces || 0));
    const debug = String(req.query.debug || "") === "1";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return res.status(400).json({ error: "start must be YYYY-MM-DD" });
    }

    // required-free dates
    const needs: string[] = [];
    const base = new Date(start + "T00:00:00Z");
    for (let i = 0; i < nights; i++) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() + i);
      needs.push(d.toISOString().slice(0, 10));
    }
    const yyyymmdd = start.replace(/-/g, "");

    // 1) list all places
    const allPlaces = await fetchAllPlaces();
    let places = allPlaces;

    // 2) region filter via bounding boxes
    const keys = regions.map(resolveRegionName).filter(Boolean) as string[];
    if (keys.length) {
      places = places.filter(p => {
        if (p.lat == null || p.lng == null) return false;
        return keys.some(k => {
          const [latMin, latMax, lonMin, lonMax] = PRESETS[k];
          const ok = p.lat! >= latMin && p.lat! <= latMax && p.lng! >= lonMin && p.lng! <= lonMax;
          if (ok && !p.region) p.region = k;
          return ok;
        });
      });
    }

    if (maxPlaces > 0) places = places.slice(0, maxPlaces);

    // 3) resolve missing per-place ids by scraping (more robust)
    let hadPid = places.filter(p => p.place_id).length;
    let resolved = 0;
    for (const p of places) {
      if (!p.place_id) {
        try {
          const html = await fetchDetailHTMLAll(p.url);
          const id = html ? extractId(html) : null;
          if (id) { p.place_id = id; resolved++; }
        } catch (err: any) {
          if (debug) console.error("detail-error", p.url, err?.message || err);
        }
        await new Promise(r => setTimeout(r, 60));
      }
    }
    const withPid = places.filter(p => p.place_id).length;

    // 4) availability using flexible fetch
    const available: any[] = [];
    let availChecked = 0, availErrors = 0;
    for (const p of places) {
      try {
        const booked = await fetchBookedDatesFlex(p, yyyymmdd);
        // If we got ANY data back, count it as checked (even if empty)
        availChecked++;
        const overlaps = needs.some(d => booked.has(d));
        if (!overlaps) {
          available.push({ lat: p.lat, lng: p.lng, region: p.region, name: p.title, url: p.url, place_id: p.place_id });
        }
      } catch (e: any) {
        availErrors++;
        if (debug) console.error("bookings-error", p.place_id, e?.message || e);
      }
      await new Promise(r => setTimeout(r, 80));
    }

    const payload: any = { count: available.length, items: available };
    if (debug) {
      payload.debug = {
        totalFetched: allPlaces.length,
        afterRegionFilter: places.length,
        hadPlaceIdInitially: hadPid,
        resolvedPlaceIds: resolved,
        finalWithPlaceId: withPid,
        availChecked,
        availErrors,
        sample: places.slice(0, 5).map(p => ({
          title: p.title, url: p.url, place_id: p.place_id, lat: p.lat, lng: p.lng, region: p.region
        })),
      };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
