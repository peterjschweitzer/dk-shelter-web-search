// pages/index.tsx
import { useState } from "react";

export default function Home() {
  const [start, setStart] = useState("");
  const [nights, setNights] = useState(1);
  const [region, setRegion] = useState("");
  const [maxPlaces, setMaxPlaces] = useState(120);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    try {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams({
        start,
        nights: String(nights),
        maxPlaces: String(maxPlaces),
      });
      if (region.trim()) {
        for (const r of region.split(",").map(s => s.trim()).filter(Boolean)) {
          qs.append("region", r);
        }
      }
      const res = await fetch(`/api/search?` + qs.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResults(data.items || data.results || []);
    } catch (e: any) {
      setError(e?.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1>DK Shelter Finder</h1>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end" }}>
        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Start date</div>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Nights</div>
          <input type="number" min={1} value={nights} onChange={e => setNights(Number(e.target.value))} />
        </label>
        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Region(s) (optional)</div>
          <input placeholder="e.g. sjaelland, fyn" value={region} onChange={e => setRegion(e.target.value)} />
        </label>
        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Max places (optional)</div>
          <input type="number" min={0} value={maxPlaces} onChange={e => setMaxPlaces(Number(e.target.value))} />
        </label>
        <button onClick={search} disabled={loading || !start} style={{ padding: 10, borderRadius: 8 }}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p style={{ color: "crimson", marginTop: 12 }}>Error: {error}</p>}

      <p style={{ marginTop: 16 }}>
        {results.length ? `Found ${results.length} available shelters.` : loading ? "Searching…" : ""}
      </p>

      {results.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Name</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Region</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Lat</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Lng</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Link</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 8 }}>{r.name || r.title}</td>
                <td style={{ padding: 8 }}>{r.region || ""}</td>
                <td style={{ padding: 8 }}>{r.lat ?? ""}</td>
                <td style={{ padding: 8 }}>{r.lng ?? ""}</td>
                <td style={{ padding: 8 }}>
                  <a href={r.url} target="_blank" rel="noreferrer">open</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
