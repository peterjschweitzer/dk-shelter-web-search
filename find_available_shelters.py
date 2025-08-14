#!/usr/bin/env python3
"""
Find Naturstyrelsen shelters that actually have availability.

- Pulls all shelters via the list API
- Uses ONLY the real per-shelter PlaceID (ignores FTypeID 3012/3031/3091)
- Caches resolved place IDs to avoid re-scraping detail pages
- Region filters via presets (Sjælland, Fyn, Jylland, Bornholm, Lolland-Falster, Møn, Amager)
- Probe mode, max-places limiter, quiet mode
- CSV ordered for mapping (lat,lng first) and includes `region` column
"""

import argparse
import csv
import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Set, Tuple

import requests

BASE = "https://book.naturstyrelsen.dk"
API_PLACES = f"{BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp"
API_BOOKINGS = f"{BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxgetbookingsforsingleplace.asp"

# Type/category ids we must NOT treat as place ids
TYPE_IDS: Set[int] = {3012, 3031, 3091}

# --------------------------------------------------------------------
# Region presets (bounding boxes): lat_min, lat_max, lon_min, lon_max
# ASCII aliases handled below (e.g., sjaelland -> sjælland).
REGION_PRESETS: Dict[str, Tuple[float, float, float, float]] = {
    "sjælland":        (54.60, 55.95, 11.00, 12.80),
    "fyn":             (55.00, 55.60,  9.60, 10.80),
    "jylland":         (54.55, 57.80,  8.00, 10.60),
    "bornholm":        (55.00, 55.40, 14.60, 15.30),
    "lolland-falster": (54.50, 54.95, 11.05, 12.30),
    "møn":             (54.85, 55.08, 12.15, 12.60),
    "amager":          (55.55, 55.75, 12.45, 12.75),
}

# Aliases (normalized ASCII -> canonical key)
REGION_ALIASES: Dict[str, str] = {
    "sjaelland": "sjælland", "zealand": "sjælland", "sjalland": "sjælland",
    "fyn": "fyn", "funen": "fyn",
    "jylland": "jylland", "jutland": "jylland", "jyland": "jylland",
    "bornholm": "bornholm",
    "lolland": "lolland-falster", "falster": "lolland-falster", "lolland-falster": "lolland-falster",
    "moen": "møn", "mon": "møn", "møn": "møn",
    "amager": "amager",
}

def normalize_ascii(s: str) -> str:
    s = s.strip().lower()
    # normalize Danish letters to ascii-friendly forms
    s = (s
         .replace("æ", "ae")
         .replace("ø", "oe")
         .replace("å", "aa"))
    # also strip spaces and hyphens for alias lookup convenience
    return s.replace(" ", "").replace("_", "").replace("-", "")

def resolve_region_name(user_input: str) -> Optional[str]:
    """Map user-provided string to a canonical preset key, if possible."""
    raw = user_input.strip().lower()
    if raw in REGION_PRESETS:
        return raw
    # try ascii alias lookup
    norm = normalize_ascii(raw)
    if norm in REGION_ALIASES:
        return REGION_ALIASES[norm]
    # loose contains matching on canonical keys
    for key in REGION_PRESETS.keys():
        if raw in key or key in raw:
            return key
    # loose contains matching on aliases
    for alias, key in REGION_ALIASES.items():
        if norm in alias or alias in norm:
            return key
    return None
# --------------------------------------------------------------------

# ---------------------- HTTP helpers ----------------------
def make_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.1",
        "Accept-Language": "da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": f"{BASE}/soeg/?s1=3012",
    })
    # Warm cookies (site sometimes expects a session)
    try:
        s.get(BASE + "/", timeout=15)
        s.get(f"{BASE}/soeg/?s1=3012", timeout=15)
    except Exception:
        pass
    return s

def get_json(session: requests.Session, url: str, params: Dict[str, Any]) -> Any:
    headers = {"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/soeg/?s1=3012"}
    r = session.get(url, params=params, headers=headers, timeout=30)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        text = r.text.strip()
        if text.startswith("{") and text.endswith("}"):
            return json.loads(text)
        raise

def http_get_page(session: requests.Session, url: str) -> str:
    # Ensure trailing slash for /sted/ pages (prevents 404s)
    if url.startswith(f"{BASE}/sted/") and not url.endswith("/"):
        url = url + "/"
    r = session.get(url, timeout=15, allow_redirects=True)
    if r.status_code == 404 and not url.endswith("/"):
        r = session.get(url + "/", timeout=15, allow_redirects=True)
    r.raise_for_status()
    return r.text

# ---------------------- ID extraction ----------------------
ID_REGEXES = [
    re.compile(r"inc_ajaxgetbookingsforsingleplace\.asp\?i=(\d+)", re.I),
    re.compile(r'data-place-id\s*=\s*"(\d+)"', re.I),
    re.compile(r'place[_\s-]*id\s*[:=]\s*"?(\d+)"?', re.I),
    re.compile(r'[?&]i=(\d+)', re.I),
]

def extract_place_id_from_row(row: dict) -> Optional[int]:
    """Only accept the real per-shelter PlaceID (ignore type/category ids)."""
    pid = row.get("PlaceID")
    try:
        if pid is None:
            return None
        pid = int(pid)
        return None if pid in TYPE_IDS else pid
    except Exception:
        return None

def extract_place_id_from_html(html: str) -> Optional[int]:
    for rgx in ID_REGEXES:
        m = rgx.search(html)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                pass
    return None

# ---------------------- Cache helpers ----------------------
def load_cache(path: str) -> Dict[str, int]:
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # keep only int values
            return {k: int(v) for k, v in data.items() if isinstance(v, (int, str)) and str(v).isdigit()}
    except Exception:
        return {}

def save_cache(path: str, cache: Dict[str, int]) -> None:
    if not path:
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

# ---------------------- API wrappers ----------------------
def fetch_all_places(session: requests.Session, page_size=200, max_pages=500) -> List[Dict[str, Any]]:
    """Pull all shelters from the list API (t=1)."""
    places = []
    for p in range(1, max_pages + 1):
        data = get_json(session, API_PLACES, {"pid": 0, "p": p, "r": 50000, "ps": page_size, "t": 1})
        rows = data.get("BookingPlacesList", [])
        if not rows:
            break
        for c in rows:
            uri = (c.get("Uri") or "").strip().strip("/")
            if not uri:
                continue
            pid = extract_place_id_from_row(c)  # strict
            # Coordinates can be in DoubleLat/DoubleLng or Lat/Lng
            lat = c.get("DoubleLat", c.get("Lat"))
            lng = c.get("DoubleLng", c.get("Lng"))
            try:
                lat = float(lat) if lat not in (None, "",) else None
                lng = float(lng) if lng not in (None, "",) else None
            except Exception:
                lat = lng = None
            region = c.get("RegionName") or ""  # often missing; keep empty string
            places.append({
                "title": c.get("Title") or uri.replace("-", " ").title(),
                "url": f"{BASE}/sted/{uri}/",
                "place_id": pid,
                "lat": lat,
                "lng": lng,
                "region": region,
            })
        if len(rows) < page_size:
            break
        time.sleep(0.15)
    return places

def ensure_place_ids(session: requests.Session,
                     places: List[Dict[str, Any]],
                     cache: Dict[str, int],
                     refresh_cache: bool = False) -> int:
    """
    For any place missing a valid place_id (or where the id matches a known type id),
    use cache if present; otherwise fetch detail page and extract id; update cache.
    Resolves ONLY for provided `places` subset (already limited by caller).
    """
    targets = [p for p in places if (p.get("place_id") is None) or (p.get("place_id") in TYPE_IDS)]
    fixed = 0
    for idx, p in enumerate(targets, 1):
        url = p["url"]
        # 1) cache hit?
        if not refresh_cache and url in cache and cache[url] not in TYPE_IDS:
            p["place_id"] = cache[url]
            fixed += 1
        else:
            # 2) scrape page
            try:
                html = http_get_page(session, url)
                pid = extract_place_id_from_html(html)
                if pid and pid not in TYPE_IDS:
                    p["place_id"] = pid
                    cache[url] = pid
                    fixed += 1
            except Exception:
                pass
        if idx % 20 == 0:
            print(f"  …resolved {fixed}/{idx} (of {len(targets)})")
        time.sleep(0.05)
    return fixed

def fetch_booked_dates(session: requests.Session, place_id: int, on_date: datetime):
    data = get_json(session, API_BOOKINGS, {"i": place_id, "d": on_date.strftime("%Y%m%d")})
    return set(str(x) for x in data.get("BookingDates", []) if x)

def is_available(session: requests.Session, place_id: int, start_date: datetime, nights: int, quiet=False) -> bool:
    needed = [(start_date + timedelta(days=i)).date().isoformat() for i in range(nights)]
    booked = fetch_booked_dates(session, place_id, start_date)
    hits = [d for d in needed if d in booked]
    if not quiet:
        print(f"  place_id={place_id} needs={needed} booked_hits={hits} booked_count={len(booked)}")
    return len(hits) == 0

# ---------------------- CLI & main ----------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find Naturstyrelsen (Denmark) shelters that actually have availability.",
        epilog=f"""
Examples:
  Search all shelters for 1 night:
    python find_available_shelters.py --start 2025-09-07 --nights 1

  Filter titles (case-insensitive):
    python find_available_shelters.py --start 2025-09-07 --nights 1 --filter fjord

  Limit to first 40 shelters (faster test run):
    python find_available_shelters.py --start 2025-09-07 --nights 1 --max-places 40

  List region presets:
    python find_available_shelters.py --list-regions

  Filter to specific region(s) via presets (ASCII allowed):
    python find_available_shelters.py --start 2025-09-07 --nights 1 --region Sjælland
    python find_available_shelters.py --start 2025-09-07 --nights 1 --region sjaelland --region fyn

  Probe the first 5 shelters (quick debug of BookingDates):
    python find_available_shelters.py --start 2025-09-07 --nights 1 --probe 5

Cache options:
  --cache-file FILE   Path to persistent ID cache (default: ids_cache.json)
  --no-cache          Do not load or save cache
  --refresh-cache     Force re-fetch IDs for current subset even if cached

Caching explained:
  The script sometimes needs to visit each shelter's detail page to extract the
  real booking PlaceID (the one used by the availability endpoint). Since this
  ID rarely changes, we store it in a JSON cache so future runs can skip that
  step. Use --no-cache to disable caching entirely, or --refresh-cache to
  re-check the IDs for your current subset. You can relocate the cache file
  with --cache-file.

Region presets available:
  {", ".join(sorted(REGION_PRESETS.keys()))}
""",
        formatter_class=argparse.RawTextHelpFormatter
    )
    # NOTE: --start is optional now so --list-regions works alone
    parser.add_argument("--start", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--nights", type=int, default=1, help="Number of nights (default: 1)")
    parser.add_argument("--filter", default="", help="Substring to match in the title (case-insensitive)")
    parser.add_argument("--region", action="append", default=[], help="Filter by region preset (can be used multiple times).")
    parser.add_argument("--list-regions", action="store_true", help="List region presets and exit")
    parser.add_argument("--max-places", type=int, default=0, help="Only check first N places (for testing)")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-place booked_hits prints")
    parser.add_argument("--probe", type=int, default=0, help="Print raw BookingDates for first N places and exit")
    parser.add_argument("--out", default="available_shelters.csv", help="CSV output file (default: available_shelters.csv)")
    # cache controls
    parser.add_argument("--cache-file", default="ids_cache.json", help="Path to ID cache file (default: ids_cache.json)")
    parser.add_argument("--no-cache", action="store_true", help="Do not load or save cache")
    parser.add_argument("--refresh-cache", action="store_true", help="Re-resolve IDs even if they exist in cache (for current subset)")
    return parser

def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.list_regions:
        print("Region presets:")
        for name in sorted(REGION_PRESETS.keys()):
            print(f"  {name}")
        print("\nASCII aliases accepted (e.g., sjaelland -> sjælland, moen -> møn, jutland -> jylland).")
        return

    if not args.start:
        print("Error: --start is required (unless using --list-regions).")
        return

    start_dt = datetime.strptime(args.start, "%Y-%m-%d")
    nights = max(1, int(args.nights))
    title_sub = args.filter.strip().lower()

    # Resolve region preset names (allow multiple; OR filter)
    requested_regions: List[str] = []
    for r in args.region:
        canonical = resolve_region_name(r)
        if not canonical:
            print(f"Warning: unknown region '{r}'. Run --list-regions to see options.")
        else:
            requested_regions.append(canonical)
    # Deduplicate
    requested_regions = sorted(set(requested_regions))

    s = make_session()

    print("Collecting places from API…")
    places = fetch_all_places(s)
    print(f"Fetched {len(places)} places")

    # Title filter
    if title_sub:
        before = len(places)
        places = [p for p in places if title_sub in p["title"].lower()]
        print(f"Title filter '{args.filter}': {len(places)}/{before} remain.")

    # Region bbox filter (OR across requested regions)
    if requested_regions:
        before = len(places)
        kept = []
        for p in places:
            lat, lng = p["lat"], p["lng"]
            if lat is None or lng is None:
                continue
            for key in requested_regions:
                lat_min, lat_max, lon_min, lon_max = REGION_PRESETS[key]
                if lat_min <= lat <= lat_max and lon_min <= lng <= lon_max:
                    # If API region is empty, fill with preset name we matched
                    if not p["region"]:
                        p["region"] = key
                    kept.append(p)
                    break
        places = kept
        print(f"Region filter {requested_regions}: {len(places)}/{before} remain.")

    # Limit for faster test runs (apply BEFORE resolving IDs)
    if args.max_places > 0:
        places = places[:args.max_places]
        print(f"Limiting to first {len(places)} places for test run.")

    # Subset for ID resolution (probe only resolves as many as needed)
    subset = places[: args.probe or len(places) ]

    # Load cache
    cache: Dict[str, int] = {}
    if not args.no_cache:
        cache = load_cache(args.cache_file)

    # Ensure IDs for the subset
    need_fix = [p for p in subset if (p.get("place_id") is None) or (p.get("place_id") in TYPE_IDS)]
    if need_fix or args.refresh_cache:
        to_resolve = subset if args.refresh_cache else need_fix
        print(f"Resolving place IDs… ({len(to_resolve)} to resolve)")
        fixed = ensure_place_ids(s, to_resolve, cache, refresh_cache=args.refresh_cache)
        print(f"Resolved {fixed} place IDs.")
        if not args.no_cache:
            save_cache(args.cache_file, cache)
    else:
        print("All place IDs present and look valid for current subset.")

    # Probe mode (skip CSV, just show raw availability)
    if args.probe > 0:
        print(f"\nProbe first {min(args.probe, len(subset))} places on {start_dt.date()}:")
        for p in subset[:args.probe]:
            pid = p.get("place_id") or cache.get(p["url"])
            if not pid or pid in TYPE_IDS:
                print(f"- {p['title']} (id MISSING)")
                continue
            bd = fetch_booked_dates(s, pid, start_dt)
            print(f"- {p['title']} (id {pid}): booked_count={len(bd)}  has {start_dt.date()}? {start_dt.date().isoformat() in bd}")
        return

    # Availability checks
    results = []
    print(f"\nChecking availability for {len(places)} places on {start_dt.date()} for {nights} night(s)…")
    for idx, p in enumerate(places, 1):
        print(f"\n[{idx}/{len(places)}] {p['title']}  {p['url']}")
        pid = p.get("place_id") or cache.get(p["url"])
        if not pid or pid in TYPE_IDS:
            print("  Skipping (missing or invalid place_id)")
            continue
        try:
            time.sleep(0.25)  # be polite
            if is_available(s, pid, start_dt, nights, quiet=args.quiet):
                results.append({
                    "lat": p["lat"],
                    "lng": p["lng"],
                    "region": p["region"],
                    "name": p["title"],
                    "url": p["url"],
                    "place_id": pid,
                })
                print("  AVAILABLE ->", p["title"])
            else:
                print("  Not available for your range.")
        except Exception as e:
            print("  Error:", e)

    # Save CSV (lat,lng first; includes region)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["lat", "lng", "region", "name", "url", "place_id"])
        w.writeheader()
        for row in results:
            w.writerow(row)

    print(f"\nDone. {len(results)} shelters available for {start_dt.date()} for {nights} nights.")
    print(f"Saved: {args.out}")

if __name__ == "__main__":
    main()
