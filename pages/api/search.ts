// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Place = {
  title: string;
  url: string;
  place_id: number | null; // resolved numeric id (from detail page)
  lat: number | null;
  lng: number | null;
  region: string;
};

const BASE = "https://book.naturstyrelsen.dk";
const LIST = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp`;
const BOOK = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxgetbookingsforsingleplace.asp`;

// Category/type ids (NOT real per-place ids)
const TYPE_IDS = new Set([3012, 3031, 3091]);

// ---------------- Region presets (lat_min, lat_max, lon_min, lon_max)
const PRESETS: Record<string, [number, number, number, number]> = {
  "sjælland": [54.60, 55.95, 11.00, 12.80],
  fyn: [55.0, 55.6, 9.6, 10.8],
  jylland: [54.55, 57.8, 8.0, 10.6],
  bornholm: [55.0, 55.4, 14.6, 15.3],
  "lolland-falster": [54.5, 54.95, 11.05, 12.3],
  "møn": [54.85, 55.08, 12.15, 12.6],
  amager: [55.55, 55.75, 12.45, 12.75],
};

// ASCII/english aliases -> canonical preset key
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

// ---------------- Simple cookie jar (no deps)
class CookieJar {
  private jar = new Map<string, string>();
  addFromSetCookieLine(line: string) {
    if (!line) return;
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) {
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }
  addFromResponse(res: Response) {
    const raw = res.headers.get("set-cookie");
    if (!raw) return;
    const parts = raw.split(/,(?=[^ ;]+=)/); // split multiple
    for (const p of parts) this.addFromSetCookieLine(p);
  }
  header(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function fetchWithJar(url: string, init: RequestInit, jar: CookieJar, collect = true) {
  const headers = new Headers(init.headers as any);
  const ck = jar.header();
  if (ck) headers.set("Cookie", ck);
  const res = await fetch(url, { ...init, headers, redirect: "follow" });
  if (collect) jar.addFromResponse(res);
  return res;
}

// ---------------- Helpers
function slugFromUrl(url: string) {
  const m = url.match(/\/sted\/([^/]+)\//i);
  return m ? m[1] : null;
}

function monthParamFromStart(start: string): string {
  const dt = new Date(start + "T00:00:00Z");
  const y = dt.getUTCFullYear().toString().padStart(4, "0");
  const m = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}${m}01`;
}

function toBookedSet(data: any): Set<string> {
  const full = Array.isArray(data?.BookingDates) ? data.BookingDates : [];
  const partial = Array.isArray(data?.PartialBookingDates) ? data.PartialBookingDates : [];
  const all = [...full, ...partial].map((s: any) => String(s));
  return new Set(all);
}

async function getJSON(url: string, params: Record<string, string>, jar: CookieJar) {
  const u = url + "?" + new URLSearchParams(params).toString();
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*;q=0.1",
    "Accept-Language": "da-DK,da;q=0.9,en-US;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${BASE}/soeg/?s1=3012`,
  } as Record<string, string>;
  const res = await fetchWithJar(u, { headers: baseHeaders }, jar);
  if (!res.ok) throw new Error(`${res.status} on ${u}`);
  const text = await res.text();
  return JSON.parse(text);
}

async function fetchAllPlaces(jar: CookieJar): Promise<Place[]> {
  const out: Place[] = [];
  for (let p = 1; p <= 500; p++) {
    const data = await getJSON(LIST, { pid: "0", p: String(p), r: "50000", ps: "200", t: "1" }, jar);
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
        title: c.Title || uri,
        url: `${BASE}/sted/${uri}/`,
        place_id: Number.isFinite(placeId) ? placeId : null,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        region: c.RegionName || "",
      });
    }
    if (rows.length < 200) break;
    await new Promise(r => setTimeout(r, 110)); // polite
  }
  return out;
}

async function fetchDetailHTML(url: string, jar: CookieJar) {
  const u = url.endsWith("/") ? url : url + "/";
  const res = await fetchWithJar(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" } }, jar);
  if (!res.ok) throw new Error(`Detail ${res.status}`);
  return res.text();
}

function extractId(html: string): number | null {
  const m =
    html.match(/inc_ajaxgetbookingsforsingleplace\.asp\?i=(\d+)/i) ||
    html.match(/data-place-id\s*=\s*"(\d+)"/i) ||
    html.match(/[?&]i=(\d+)/i);
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && !TYPE_IDS.has(id) ? id : null;
}

// Bookings by numeric id (primary)
async function fetchBookedById(id: number, yyyymm01: string, jar: CookieJar) {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*;q=0.1",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${BASE}/soeg/?s1=3012`,
  };
  const u = `${BOOK}?` + new URLSearchParams({ i: String(id), d: yyyymm01 }).toString();
  const r = await fetchWithJar(u, { headers }, jar);
  if (!r.ok) return { ok: false as const };
  const text = await r.text();
  try {
    const data = JSON.parse(text);
    return { ok: true as const, dates: toBookedSet(data), raw: data };
  } catch {
    return { ok: false as const };
  }
}

// ---------------- In-memory cache (per warm instance)
let ID_CACHE: Map<string, number> | null = null;
let CACHE_BUILT_AT = 0;

async function buildIdCache(jar: CookieJar, throttleMs = 70) {
  const places = await fetchAllPlaces(jar);
  const map = new Map<string, number>();
  let extracted = 0;

  for (const p of places) {
    const slug = slugFromUrl(p.url);
    if (!slug) continue;
    try {
      const html = await fetchDetailHTML(p.url, jar);
      const id = extractId(html);
      if (id) {
        map.set(slug, id);
        extracted++;
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, throttleMs));
  }
  ID_CACHE = map;
  CACHE_BUILT_AT = Date.now();
  return { count: places.length, extracted };
}

// ---------------- API Handler
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = String(req.query.start || "");
    const nights = Math.max(1, Number(req.query.nights || 1));
    const regions = ([] as string[]).concat(req.query.region || []).filter(Boolean) as string[];
    const maxPlaces = Math.max(0, Number(req.query.maxPlaces || 0));
    const debug = String(req.query.debug || "") === "1";
    const rebuildCache = String(req.query.rebuildCache || "") === "1";

    // Warm cookies/session
    const jar = new CookieJar();
    try {
      const warm = await fetchWithJar(`${BASE}/soeg/?s1=3012`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
        redirect: "follow",
      }, jar);
      jar.addFromResponse(warm);
      await new Promise(r => setTimeout(r, 80));
    } catch {}

    // Cache control endpoints
    if (String(req.query.inspect || "") === "1") {
      return res.status(200).json({
        cachePresent: !!ID_CACHE,
        cacheSize: ID_CACHE?.size ?? 0,
        cacheAgeSec: ID_CACHE ? Math.round((Date.now() - CACHE_BUILT_AT) / 1000) : null,
      });
    }
    if (rebuildCache) {
      const result = await buildIdCache(jar, 60);
      return res.status(200).json({
        cacheRebuilt: true,
        ...result,
        cacheSize: ID_CACHE?.size ?? 0,
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return res.status(400).json({ error: "start must be YYYY-MM-DD" });
    }

    // Required-free dates for the stay
    const needs: string[] = [];
    const base = new Date(start + "T00:00:00Z");
    for (let i = 0; i < nights; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i);
      needs.push(d.toISOString().slice(0, 10));
    }
    const monthParam = monthParamFromStart(start);

    // 1) all places
    const all = await fetchAllPlaces(jar);

    // 2) region filtering
    const keys = regions.map(resolveRegionName).filter(Boolean) as string[];
    let places = keys.length
      ? all.filter(p => {
          if (p.lat == null || p.lng == null) return false;
          return keys.some(k => {
            const [latMin, latMax, lonMin, lonMax] = PRESETS[k];
            const ok = p.lat! >= latMin && p.lat! <= latMax && p.lng! >= lonMin && p.lng! <= lonMax;
            if (ok && !p.region) p.region = k;
            return ok;
          });
        })
      : all;

    if (maxPlaces > 0) places = places.slice(0, maxPlaces);

    // 3) ensure ID cache exists
    if (!ID_CACHE) {
      await buildIdCache(jar, 60); // first search will build the map
    }

    // 4) availability by numeric id
    const available: any[] = [];
    let availChecked = 0, availErrors = 0, resolvedFromCache = 0, resolvedByScrape = 0;

    for (const p of places) {
      const slug = slugFromUrl(p.url);
      let id: number | null = null;

      if (slug && ID_CACHE?.has(slug)) {
        id = ID_CACHE.get(slug)!;
        resolvedFromCache++;
      } else if (slug) {
        // On-the-fly resolve & inject into cache
        try {
          const html = await fetchDetailHTML(p.url, jar);
          const got = extractId(html);
          if (got) {
            id = got;
            ID_CACHE?.set(slug, got);
            resolvedByScrape++;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }

      if (!id) continue;

      try {
        const r = await fetchBookedById(id, monthParam, jar);
        if (!r.ok) { availErrors++; continue; }
        availChecked++;
        const booked = r.dates!;
        const overlaps = needs.some(d => booked.has(d));
        if (!overlaps) {
          available.push({
            lat: p.lat, lng: p.lng, region: p.region,
            name: p.title, url: p.url, place_id: id,
          });
        }
      } catch {
        availErrors++;
      }
      await new Promise(r => setTimeout(r, 70)); // polite
    }

    const payload: any = { count: available.length, items: available };
    if (debug) {
      payload.debug = {
        totalFetched: all.length,
        afterRegionFilter: places.length,
        needs,
        monthParam,
        availChecked,
        availErrors,
        cacheSize: ID_CACHE?.size ?? 0,
        resolvedFromCache,
        resolvedByScrape,
        cacheAgeSec: Math.round((Date.now() - CACHE_BUILT_AT) / 1000),
        sample: places.slice(0, 5).map(p => ({
          title: p.title, url: p.url, lat: p.lat, lng: p.lng, region: p.region
        })),
      };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
