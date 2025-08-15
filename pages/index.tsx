// pages/index.tsx
import { useEffect, useMemo, useState } from "react";
import RegionSelect, { REGION_KEYS, type RegionKey } from "../components/RegionSelect";

type ApiItem = {
  name: string;
  region: string;
  lat: number | null;
  lng: number | null;
  url: string;
  place_id: number | null;
};

type ApiResponse = {
  count: number;
  items: ApiItem[];
  debug?: any;
};

export default function Home() {
  // Form state
  const [start, setStart] = useState<string>("");
  const [nights, setNights] = useState<number>(1);
  const [maxPlaces, setMaxPlaces] = useState<number | "">("");
  const [regions, setRegions] = useState<RegionKey[]>([]); // empty = All

  // Results state
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ApiItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<any>(null);
  const showDebug = false; // set to true locally if you want to see internals


  const [selectedRegions, setSelectedRegions] = useState<RegionKey[]>([]);

  // Default date = today + 2 days (to avoid past-date timezone weirdness)
  useEffect(() => {
    if (!start) {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      const iso = d.toISOString().slice(0, 10);
      setStart(iso);
    }
  }, [start]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (nights) params.set("nights", String(nights));
    if (maxPlaces !== "" && Number(maxPlaces) > 0) {
      params.set("maxPlaces", String(maxPlaces));
    }
    // Add each region as its own param (?region=sjælland&region=fyn...)
    for (const r of regions) params.append("region", r);
    // add debug flag so we can see counters if needed
    params.set("debug", "1");
    return params.toString();
  }, [start, nights, maxPlaces, regions]);

  async function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    setResults([]);
    setDebug(null);

    try {
      const res = await fetch(`/api/search?${queryString}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }
      const data: ApiResponse = await res.json();
      setResults(data.items || []);
      setDebug((data as any).debug ?? null);
    } catch (err: any) {
      setError(err?.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 24 }}>DK Shelter Finder</h1>

      {/* Form */}
      <form
        onSubmit={onSearch}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 32,
          alignItems: "end",
          marginBottom: 20,
        }}
      >
        {/* Start date */}
        <div>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Start date</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Nights */}
        <div>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Nights</label>
          <input
            type="number"
            min={1}
            value={nights}
            onChange={(e) => setNights(Math.max(1, Number(e.target.value || 1)))}
            style={inputStyle}
          />
        </div>

        {/* Max places */}
        <div>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
            Max places <span style={{ color: "#6b7280" }}>(optional)</span>
          </label>
          <input
            type="number"
            placeholder="e.g. 100"
            value={maxPlaces === "" ? "" : maxPlaces}
            onChange={(e) =>
              setMaxPlaces(e.target.value === "" ? "" : Number(e.target.value))
            }
            style={inputStyle}
          />
        </div>

        {/* Regions */}
        <div>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
            Region(s) <span style={{ color: "#6b7280" }}>(optional)</span>
          </label>
          <RegionSelect
            value={regions}           // <-- use the state you serialize into the query
            onChange={setRegions}     // <-- keep a single source of truth
          />
        </div>

        {/* Button spans full row on small screens */}
        <div style={{ gridColumn: "1 / -1" }}>
          <button
            type="submit"
            disabled={loading}
            style={btnStyle}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {/* Status */}
      {error && (
        <div style={{ color: "#b91c1c", marginBottom: 12 }}>
          {error}
        </div>
      )}
      {!error && !loading && (
        <div style={{ marginBottom: 12 }}>
          Found <strong>{results.length}</strong> available shelters.
        </div>
      )}

      {/* Results table */}
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thTdStyle}>Name</th>
              <th style={thTdStyle}>Region</th>
              <th style={thTdStyle}>Lat</th>
              <th style={thTdStyle}>Lng</th>
              <th style={thTdStyle}>Link</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.url}>
                <td style={thTdStyle}>{r.name}</td>
                <td style={thTdStyle}>{r.region || ""}</td>
                <td style={thTdStyle}>{r.lat ?? ""}</td>
                <td style={thTdStyle}>{r.lng ?? ""}</td>
                <td style={thTdStyle}>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    open
                  </a>
                </td>
              </tr>
            ))}
            {!loading && results.length === 0 && (
              <tr>
                <td style={thTdStyle} colSpan={5}>
                  No results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Debug (toggle-able if you like; for now show if present) */}
      {showDebug && debug && (
        <pre className="mx-auto max-w-6xl mt-6 rounded-xl border bg-gray-50 p-4 text-sm overflow-auto">
          {JSON.stringify(debug, null, 2)}
        </pre>
      )}

    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const btnStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  fontSize: 16,
  cursor: "pointer",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  overflow: "hidden",
};

const thTdStyle: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  padding: "10px 12px",
  textAlign: "left",
};
