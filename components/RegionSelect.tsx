// components/RegionSelect.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

export type RegionKey =
  | "sjælland"
  | "fyn"
  | "jylland"
  | "bornholm"
  | "lolland-falster"
  | "møn"
  | "amager";

export const REGION_KEYS: RegionKey[] = [
  "sjælland",
  "fyn",
  "jylland",
  "bornholm",
  "lolland-falster",
  "møn",
  "amager",
];

const REGION_OPTIONS: { key: RegionKey; label: string }[] = [
  { key: "sjælland", label: "Sjælland" },
  { key: "fyn", label: "Fyn" },
  { key: "jylland", label: "Jylland" },
  { key: "bornholm", label: "Bornholm" },
  { key: "lolland-falster", label: "Lolland-Falster" },
  { key: "møn", label: "Møn" },
  { key: "amager", label: "Amager" },
];

export type RegionSelectProps = {
  value: RegionKey[];
  onChange: (next: RegionKey[]) => void;
  className?: string;
  disabled?: boolean;
};

const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 14,
  cursor: "pointer",
};
const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  width: 260,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
  padding: 8,
  zIndex: 1000,
};
const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px",
  borderRadius: 8,
  cursor: "pointer",
  userSelect: "none",
};
const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  margin: "4px 0",
};

export default function RegionSelect({
  value,
  onChange,
  className,
  disabled,
}: RegionSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const allSelected = value.length === REGION_OPTIONS.length;
  const noneSelected = value.length === 0;

  const buttonLabel = useMemo(() => {
    if (noneSelected || allSelected) return "All regions";
    if (value.length === 1) {
      const one = REGION_OPTIONS.find((o) => o.key === value[0]);
      return one?.label ?? "1 region selected";
    }
    return `${value.length} regions selected`;
  }, [value, allSelected, noneSelected]);

  function toggleAll() {
    if (allSelected) onChange([]);
    else onChange(REGION_OPTIONS.map((o) => o.key));
  }

  function toggleOne(k: RegionKey) {
    const set = new Set(value);
    set.has(k) ? set.delete(k) : set.add(k);
    onChange(Array.from(set));
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={btnStyle}
      >
        {buttonLabel} ▾
      </button>

      {open && (
        <div role="listbox" aria-multiselectable="true" style={panelStyle}>
          <label style={itemStyle}>
            <input
              type="checkbox"
              checked={allSelected || noneSelected}
              aria-checked={allSelected ? "true" : noneSelected ? "mixed" : "false"}
              onChange={toggleAll}
            />
            <span>All regions</span>
          </label>
          <div style={dividerStyle} />
          {REGION_OPTIONS.map((opt) => {
            const checked = value.includes(opt.key);
            return (
              <label key={opt.key} style={itemStyle}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOne(opt.key)}
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
