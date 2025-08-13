// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Place = {
  title: string;
  url: string;
  place_id: number | null; // we primarily use slug now
  lat: number | null;
  lng: number | null;
  region: string;
};

const BASE = "https://book.naturstyrelsen.dk";
const LIST = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp`;
const BOOK = `${BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxgetbookingsforsingleplace.asp`;

// Category/type ids (NOT real per-place ids)
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

/* ---------------- Cookie jar (no external deps) ---------------- */
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
    const all = res.headers.get("set-cookie");
    if (!all) return;
    // Split multiple Set-Cookie headers if coalesced
    const parts = all.split(/,(?=[^ ;]+=)/);
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

/* ---------------- Data fetchers ---------------- */

// JSON helper (handles the site returning text/html with JSON content)
async function getJSON(url: string, params: Record<string, string>, jar?: CookieJar) {
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
  const res = jar
    ? await fetchWithJar(u, { headers: baseHeaders }, jar)
    : await fetch(u, { headers: baseHeaders });
  if (!res.ok) throw new Error(`${res.status} on ${u}`);
  const text = await res.text();
  return JSON.parse(text);
}

// Fetch all places via public list API
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
        title: c.Title || uri.replace(/-/g, " ").replace(/\b\w/g, (m: string) => m.toUpperCase()),
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

function slugFromUrl(url: string) {
  const m = url.match(/\/sted\/([^/]+)\//i);
  return m ? m[1] : null;
}

// Build YYYYMM01 (first day of start month) for bookings endpoint
function monthParamFromStart(start: string): string {
  const dt = new Date(start + "T00:00:00Z");
  const y = dt.getUTCFullYear().toString().padStart(4, "0");
  const m = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}${m}01`;
}

// Make a Set of booked dates from payload (union of BookingDates & PartialBookingDates)
function toBookedSet(data: any): Set<string> {
  const full = Array.isArray(data?.BookingDates) ? data.BookingDates : [];
  const partial = Array.isArray(data?.PartialBookingDates) ? data.PartialBookingDates : [];
  const all = [...full, ...partial].map((s: any) => String(s));
  return new Set(all);
}

// Primary availability fetch: use slug (u=<slug>) with month param
async function fetchBookedDatesBySlug(slug: string, yyyymm01: string, jar: CookieJar)
: Promise<{ ok: boolean; dates?: Set<string>; raw?: any }> {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*;q=0.1",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${BASE}/soeg/?s1=3012`,
  };
  const u = `${BOOK}?` + new URLSearchParams({ u: slug, d: yyyymm01 }).toString();
  const r = await fetchWithJar(u, { headers }, jar);
  if (!r.ok) return { ok: false };
  const text = await r.text();
  try {
    const data = JSON.parse(text);
    return { ok: true, dates: toBookedSet(data), raw: data };
  } catch {
    return { ok: false };
  }
}

// Optional fallback: if a numeric place_id exists, try it second
async function fetchBookedDatesById(id: number, yyyymm01: string, jar: CookieJar)
: Promise<{ ok: boolean; dates?: Set<string>; raw?: any }> {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*;q=0.1",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${BASE}/soeg/?s1=3012`,
  };
  const u = `${BOOK}?` + new URLSearchParams({ i: String(id), d: yyyymm01 }).toString();
  const r = await fetchWithJar(u, { headers }, jar);
  if (!r.ok) return { ok: false };
  const text = await r.text();
  try {
    const data = JSON.parse(text);
    return { ok: true, dates: toBookedSet(data), raw: data };
  } catch {
    return { ok: false };
  }
}

/* ---------------- Handler ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const start = String(req.query.start || "");
    const nights = Math.max(1, Number(req.query.nights || 1));
    const regions = ([] as string[]).concat(req.query.region || []).filter(Boolean) as string[];
    const maxPlaces = Math.max(0, Number(req.query.maxPlaces || 0));
    const debug = String(req.query.debug || "") === "1";

    // Make a cookie jar and warm it up (establish ASP session cookies)
    const jar = new CookieJar();
    try {
      const warm = await fetchWithJar(`${BASE}/soeg/?s1=3012`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
        redirect: "follow",
      }, jar);
      jar.addFromResponse(warm);
      await new Promise(r => setTimeout(r, 80));
    } catch {}

    /* ---------- Inspect mode: /api/search?inspect=1 ---------- */
    if (String(req.query.inspect || "") === "1") {
      const list = await fetchAllPlaces(jar);
      const pick =
        list.find(p => p.url.includes("aaby-skoven")) || // stable example
        list[0];

      if (!pick) {
        return res.status(200).json({
          inspect: true,
          debug: { note: "No places returned from list API – cannot inspect." }
        });
      }

      const slug = slugFromUrl(pick.url);
      let slugProbe: any = null;
      if (slug) {
        try {
          const probe = await fetchBookedDatesBySlug(slug, "20250901", jar);
          slugProbe = probe.ok
            ? { ok: true, datesCount: probe.dates!.size, sample: Array.from(probe.dates!).slice(0, 5), rawKeys: Object.keys(probe.raw || {}) }
            : { ok: false };
        } catch (e: any) {
          slugProbe = { error: e?.message || String(e) };
        }
      }

      return res.status(200).json({
        inspect: true,
        testing: pick.url,
        slug,
        cookie_header: jar.header(),
        slug_probe: slugProbe,
      });
    }
    /* ---------- End inspect mode ---------- */

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return res.status(400).json({ error: "start must be YYYY-MM-DD" });
    }

    // Build required-free dates for the specific stay
    const needs: string[] = [];
    const base = new Date(start + "T00:00:00Z");
    for (let i = 0; i < nights; i++) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() + i);
      needs.push(d.toISOString().slice(0, 10));
    }

    // IMPORTANT: the bookings endpoint wants the *month* (YYYYMM01)
    const monthParam = monthParamFromStart(start);

    // 1) list all places
    const allPlaces = await fetchAllPlaces(jar);
    let places = allPlaces;

    // 2) region filters (bounding boxes; supports multiple & aliases)
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

    // 3) availability by slug (primary), with optional id fallback
    const available: any[] = [];
    let availChecked = 0, availErrors = 0, usedSlug = 0, usedId = 0;

    for (const p of places) {
      const slug = slugFromUrl(p.url);
      let got = { ok: false, dates: undefined as Set<string> | undefined };

      try {
        if (slug) {
          const r1 = await fetchBookedDatesBySlug(slug, monthParam, jar);
          if (r1.ok) { got = { ok: true, dates: r1.dates! }; usedSlug++; }
        }
        if (!got.ok && p.place_id) {
          const r2 = await fetchBookedDatesById(p.place_id, monthParam, jar);
          if (r2.ok) { got = { ok: true, dates: r2.dates! }; usedId++; }
        }
      } catch {
        // ignore; counted below
      }

      if (!got.ok) {
        availErrors++;
      } else {
        availChecked++;
        const booked = got.dates!;
        const overlaps = needs.some(d => booked.has(d));
        if (!overlaps) {
          available.push({
            lat: p.lat, lng: p.lng, region: p.region,
            name: p.title, url: p.url, place_id: p.place_id ?? null,
          });
        }
      }

      // polite delay to avoid hammering the site
      await new Promise(r => setTimeout(r, 70));
    }

    const payload: any = { count: available.length, items: available };
    if (debug) {
      payload.debug = {
        totalFetched: allPlaces.length,
        afterRegionFilter: places.length,
        monthParam,
        needs,
        availChecked,
        availErrors,
        usedSlug,
        usedId,
        sample: places.slice(0, 5).map(p => ({
          title: p.title, url: p.url, place_id: p.place_id,
          lat: p.lat, lng: p.lng, region: p.region
        })),
        cookieHeader: jar.header(),
      };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "server error" });
  }
}
