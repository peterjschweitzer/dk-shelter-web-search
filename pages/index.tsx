// pages/index.tsx
import { useMemo, useState } from "react";
import RegionSelect from "@/components/RegionSelect";

type ResultItem = {
  name: string;
  url: string;
  lat: number | null;
  lng: number | null;
  region: string;
  place_id: number | null;
};

export default function Home() {
  const [start, setStart] = useState<string>("");
  const [nights, setNights] = useState<number>(1);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]); // <-- regions live here
  const [results, setResults] = useState<ResultItem[]>([]);             // <-- results typed here
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const querySummary = useMemo(() => {
    const parts: string[] = [];
    if (start) parts.push(`Start: ${start}`);
    if (nights) parts.push(`Nights: ${nights}`);
    if (selectedRegions.length) parts.push(`Regions: ${selectedRegions.join(", ")}`);
    return parts.join(" • ");
  }, [start, nights, selectedRegions]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    setResults([]);

    try {
      const params = new URLSearchParams();
      params.set("start", start);
      params.set("nights", String(nights));
      // multiple region params (?region=a&region=b)
      for (const r of selectedRegions) params.append("region", r);

      const res = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setResults((data?.items || []) as ResultItem[]);
    } catch (e: any) {
      setErr(e?.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">DK Shelter Finder</h1>

      <form onSubmit={onSearch} className="space-y-4 p-4 border rounded-lg">
        <div className="flex gap-4 flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Start (YYYY-MM-DD)</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="border rounded px-3 py-2"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Nights</span>
            <input
              type="number"
              min={1}
              value={nights}
              onChange={(e) => setNights(parseInt(e.target.value || "1", 10))}
              className="border rounded px-3 py-2 w-24"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Region(s)</span>
            <RegionSelect
              value={selectedRegions}
              onChange={setSelectedRegions}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !start}
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
          <span className="text-sm text-gray-500">{querySummary}</span>
        </div>
      </form>

      {err && (
        <div className="text-red-600 border border-red-200 bg-red-50 p-3 rounded">
          {err}
        </div>
      )}

      {!loading && !err && results.length === 0 && (
        <p className="text-gray-600">No results yet. Try a search.</p>
      )}

      {!loading && results.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">
            {results.length} place{results.length === 1 ? "" : "s"} found
          </h2>
          <ul className="space-y-2">
            {results.map((item) => (
              <li key={item.url} className="border rounded p-3">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  {item.name}
                </a>
                <div className="text-sm text-gray-600">
                  {item.region ? `Region: ${item.region}` : "Region: —"}
                  {item.lat != null && item.lng != null
                    ? ` • ${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`
                    : ""}
                  {item.place_id != null ? ` • id: ${item.place_id}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
