import { useState } from "react";
import RegionSelect, { RegionKey } from "../components/RegionSelect";

export default function Home() {
  const [query, setQuery] = useState("");
  const [start, setStart] = useState("");
  const [nights, setNights] = useState(1);
  const [results, setResults] = useState<RegionKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [regions, setRegions] = useState<Array<
    "sjælland" | "fyn" | "jylland" | "bornholm" | "lolland-falster" | "møn" | "amager"
  >>([]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (start) params.set("start", start);
    if (nights) params.set("nights", String(nights));
    if (regions.length) params.set("region", regions.join(","));

    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await res.json();
    setResults(data.items || []);
    setLoading(false);
  };

  return (
    <main className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">DK Shelter Finder</h1>
      <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <input
          type="text"
          placeholder="Search shelters..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border rounded p-2"
        />
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="border rounded p-2"
        />
        <input
          type="number"
          min={1}
          value={nights}
          onChange={(e) => setNights(Number(e.target.value))}
          className="border rounded p-2"
        />
        <RegionSelect value={regions} onChange={setRegions} />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white rounded p-2 col-span-1 md:col-span-4"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {results.length === 0 && !loading && (
        <p className="text-gray-500">No results found</p>
      )}
      <ul className="space-y-2">
        {results.map((item) => (
          <li key={item.url} className="border rounded p-2">
            <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold">
              {item.title}
            </a>
            <p className="text-sm text-gray-600">{item.region}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
