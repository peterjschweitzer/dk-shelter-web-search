# scripts/build_place_ids.py
import json, re, time
import requests

BASE = "https://book.naturstyrelsen.dk"
LIST = f"{BASE}/includes/branding_files/shelterbooking/includes/inc_ajaxbookingplaces.asp"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/javascript, */*;q=0.1",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{BASE}/soeg/?s1=3012",
}
# Category/type ids (not real place ids)
TYPE_IDS = {3012, 3031, 3091}

def get_json(url, params):
    r = requests.get(url, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    # Endpoint sometimes returns text/html content-type with JSON body
    return r.json() if "application/json" in r.headers.get("content-type","").lower() else json.loads(r.text)

def fetch_all_slugs():
    slugs = []
    for p in range(1, 500):
        data = get_json(LIST, {"pid":"0","p":str(p),"r":"50000","ps":"200","t":"1"})
        rows = data.get("BookingPlacesList", []) or []
        if not rows: break
        for c in rows:
            uri = (c.get("Uri") or "").strip().strip("/")
            if uri:
                slugs.append(uri)
        if len(rows) < 200: break
        time.sleep(0.12)  # polite
    return sorted(set(slugs))

ID_RE = re.compile(r'inc_ajaxgetbookingsforsingleplace\.asp\?i=(\d+)|data-place-id\s*=\s*"(\d+)"|[?&]i=(\d+)', re.I)

def extract_id_from_html(html: str) -> int | None:
    m = ID_RE.search(html or "")
    if not m: return None
    for g in m.groups():
        if g and g.isdigit():
            val = int(g)
            if val not in TYPE_IDS:
                return val
    return None

def fetch_html(url):
    r = requests.get(url, headers={"User-Agent":"Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    return r.text

def main():
    print("Collecting slugs…", flush=True)
    slugs = fetch_all_slugs()
    print(f"Found {len(slugs)} slugs")

    out = {}
    misses = 0
    for i, slug in enumerate(slugs, 1):
        url = f"{BASE}/sted/{slug}/"
        try:
            html = fetch_html(url)
            pid = extract_id_from_html(html)
            if pid:
                out[slug] = pid
            else:
                misses += 1
        except Exception:
            misses += 1
        if i % 25 == 0:
            print(f"  {i}/{len(slugs)} processed… ids so far: {len(out)}")
        time.sleep(0.07)  # polite

    print(f"Resolved IDs: {len(out)}; misses: {misses}")
    with open("data/place_ids.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("Wrote data/place_ids.json")

if __name__ == "__main__":
    main()
