// pages/index.tsx
import { useEffect, useMemo, useState } from "react";
import RegionSelect, { RegionKey, REGION_KEYS } from "../components/RegionSelect";

type ResultItem = {
  name: string;
  title: string;
  url: string;
  region?: RegionKey;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [selectedRegions, setSelectedRegions] = useState<RegionKey[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);

  // Load from URL query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const regionParams = params.getAll("region");
    const initialRegions = regionParams
      .map((r) => r.toLowerCase())
      .filter((r): r is RegionKey => REGION_KEYS.includes(r as RegionKey));
    setSelectedRegions(initialRegions);
  }, []);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      const matchesQuery = query
        ? item.title.toLowerCase().includes(query.toLowerCase())
        : true;
      const matchesRegion =
        selectedRegions.length === 0 ||
        selectedRegions.includes(item.region as RegionKey);
      return matchesQuery && matchesRegion;
    });
  }, [results, query, selectedRegions]);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">DK Shelter Search</h1>

      {/* Search input */}
      <div>
        <input
          type="text"
          placeholder="Search shelters..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full p-2 border rounded"
        />
      </div>

      {/* Region filter */}
      <div>
        <span className="text-sm text-gray-600">Region(s)</span>
        <RegionSelect
          value={selectedRegions}
          onChange={setSelectedRegions}
        />
      </div>

      {/* Results */}
      <ul className="space-y-2">
        {filteredResults.map((item) => (
          <li key={item.url} className="border rounded p-2">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold"
            >
              {item.title}
            </a>
            {item.region && (
              <span className="ml-2 text-xs text-gray-500">
                {item.region}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
