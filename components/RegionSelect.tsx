import React, { useEffect, useMemo, useRef, useState } from "react";

type RegionKey =
  | "sjælland"
  | "fyn"
  | "jylland"
  | "bornholm"
  | "lolland-falster"
  | "møn"
  | "amager";

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
  /** Controlled selected regions (keys) */
  value: RegionKey[];
  /** Called with new selection whenever it changes */
  onChange: (next: RegionKey[]) => void;
  /** Optional: extra class name for the wrapper */
  className?: string;
  /** Optional: disable interaction */
  disabled?: boolean;
};

export default function RegionSelect({
  value,
  onChange,
  className,
  disabled,
}: RegionSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
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
      const one = REGION_OPTIONS.find(o => o.key === value[0]);
      return one?.label ?? "1 region selected";
    }
    return `${value.length} regions selected`;
  }, [value, allSelected, noneSelected]);

  function toggleAll() {
    if (allSelected) onChange([]);
    else onChange(REGION_OPTIONS.map(o => o.key));
  }

  function toggleOne(k: RegionKey) {
    const set = new Set(value);
    if (set.has(k)) set.delete(k);
    else set.add(k);
    onChange(Array.from(set));
  }

  return (
    <div ref={ref} className={className} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white hover:bg-gray-50"
      >
        {buttonLabel} ▾
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-50 mt-2 w-64 rounded-xl border border-gray-200 bg-white shadow-lg p-2"
        >
          <label className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected || noneSelected}
              aria-checked={allSelected ? "true" : noneSelected ? "mixed" : "false"}
              onChange={toggleAll}
            />
            <span>All regions</span>
          </label>
          <div className="my-1 h-px bg-gray-200" />
          {REGION_OPTIONS.map(opt => {
            const checked = value.includes(opt.key);
            return (
              <label
                key={opt.key}
                className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
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
