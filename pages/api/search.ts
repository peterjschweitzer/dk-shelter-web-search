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
      Accept: "application/json, text/javascript, */*;q=0.1",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/soeg/?s1=3012`,
    },
  });
  if (!r.ok) throw new Error(`${r.status} on ${u}`);
  const text = await r.text();
  return JSON.parse(text); // endpoint sometimes returns text/html with JSON body
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
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function fetchDetailHTML(url: string) {
  const u = url.endsWith("/") ? url : url + "/";
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`Detail ${r.status}`);
  return r.text();
}
function extractId(html: string): number | null {
  const m = html.match(/inc_ajaxgetbookingsforsingleplace\.asp\?i=(\d+)/i)
        || html.match(/data-place-id\s*=\s*"(\d+)"/i)
        || html.match(/[?&]i=(\d+)/i);
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && !TYPE_IDS.has(id) ? id : null;
}

async function fetchBookedDates(id: number, yyyymmdd: string): Promise<Set<string>> {
  const data = await getJSON(BOOK, { i: String(id), d: yyyymmdd });
  const arr = data?.BookingDates ?? [];
  return new Set(arr.map((s: any) => String(s)));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = String(req.query.start || "");
    const nights = Math.max(1, Number(req.query.nights || 1));
    const regions = ([] as string[]).concat(req.query.region || []).filter(Boolean) as string[];
    const maxPlaces = Math.max(0, Number(req.query.maxPlaces || 0));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return res.status(400).json({ error: "start must be YYYY-MM-DD" });

    // list of dates we require free
    const needs: string[] = [];
    const base = new Date(start + "T00:00:00Z");
    for (let i = 0; i < nights; i++) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() + i);
      needs.push(d.toISOString().slice(0, 10));
    }
    const yyyymmdd = start.replace(/-/g, "");

    // 1) list all places
    let places = await fetchAllPlaces();

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

    // 3) resolve missing per-place ids by scraping
    for (const p of places) {
      if (!p.place_id) {
        try {
          const html = await fetchDetailHTML(p.url);
          const id = extractId(html);
          if (id) p.place_id = id;
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // 4) availability
    const available: any[] = [];
    for (const p of places) {
      if (!p.place_id) continue;
      try {
        const booked = await fetchBookedDates(p.place_id, yyyymmdd);
        const overlaps = needs.some(d => booked.has(d));
        if (!overlaps) {
          available.push({ lat: p.lat, lng: p.lng, region: p.region, name: p.title, url: p.url, place_id: p.place_id });
        }
      } catch {}
      await new Promise(r => setTimeout(r, 80));
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ count: available.length, items: available });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
