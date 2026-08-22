import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CheckboxMultiSelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type Props = {
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  maxSelected?: number;
  options: CheckboxMultiSelectOption[];
  placement?: "auto" | "top" | "bottom";
  placeholder: string;
  value: string[];
  onChange: (value: string[]) => void;
};

type Position = { bottom?: number; left: number; top?: number; width: number };

export function CheckboxMultiSelect({
  className = "",
  disabled,
  emptyMessage = "No options found",
  maxSelected,
  options,
  placement = "auto",
  placeholder,
  value,
  onChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const selected = options.filter((option) => value.includes(option.value));
  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selectableFiltered = filtered.filter((option) => !option.disabled);
  const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every((option) => value.includes(option.value));
  const selectionLimitReached = maxSelected !== undefined && value.length >= maxSelected;
  const selectAllFits = maxSelected === undefined || new Set([...value, ...selectableFiltered.map((option) => option.value)]).size <= maxSelected;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useLayoutEffect(() => {
    if (!open) return setPosition(null);
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 4;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - margin * 2);
      const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
      const below = window.innerHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const openAbove = placement === "top" || (placement === "auto" && below < 260 && below < above);
      setPosition(openAbove
        ? { bottom: window.innerHeight - rect.top + gap, left, width }
        : { left, top: rect.bottom + gap, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const summary = !selected.length
    ? placeholder
    : selected.length === 1
      ? selected[0].label
      : `${selected.length} selected`;

  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) onChange(value.filter((item) => item !== optionValue));
    else if (!selectionLimitReached) onChange([...value, optionValue]);
  };

  const toggleAllFiltered = () => {
    const filteredValues = new Set(selectableFiltered.map((option) => option.value));
    if (allFilteredSelected) {
      onChange(value.filter((item) => !filteredValues.has(item)));
      return;
    }
    const merged = Array.from(new Set([...value, ...filteredValues]));
    onChange(maxSelected === undefined ? merged : merged.slice(0, maxSelected));
  };

  return (
    <div ref={rootRef} className="relative">
      <button ref={buttonRef} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={`${className} flex items-center justify-between gap-2 text-left`}>
        <span className={`min-w-0 flex-1 truncate ${selected.length ? "" : "text-slate-400"}`}>{summary}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" /></svg>
      </button>
      {open && !disabled && position && createPortal(
        <div ref={menuRef} style={position} className="fixed z-[1000] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20" placeholder="Search options..." />
            {selectableFiltered.length > 0 && (
              <button type="button" className="mt-2 flex w-full items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-aqua-700 hover:bg-sky-50" onClick={toggleAllFiltered}>
                <span>{allFilteredSelected ? "Deselect all results" : selectAllFits ? "Select all results" : `Select up to ${maxSelected?.toLocaleString()} total`}</span>
                <span className="text-xs font-normal text-slate-500">{selectableFiltered.length.toLocaleString()}</span>
              </button>
            )}
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1">
            {filtered.map((option) => (
              <label key={option.value} role="option" aria-selected={value.includes(option.value)} className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-50 ${option.disabled || (selectionLimitReached && !value.includes(option.value)) ? "cursor-not-allowed opacity-40" : ""}`}>
                <input className="h-5 w-5 shrink-0 cursor-pointer rounded-md border-slate-300 accent-emerald-600 outline-none transition duration-150 hover:ring-4 hover:ring-emerald-500/10 focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40" type="checkbox" disabled={option.disabled || (selectionLimitReached && !value.includes(option.value))} checked={value.includes(option.value)} onChange={() => toggle(option.value)} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </label>
            ))}
            {!filtered.length && <div className="px-3 py-6 text-center text-sm text-slate-400">{emptyMessage}</div>}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 p-2 text-sm">
            <button type="button" className="px-2 py-1 font-semibold text-slate-500" onClick={() => onChange([])}>Clear</button>
            <button type="button" className="rounded-md bg-aqua-700 px-3 py-1.5 font-semibold text-white" onClick={() => { setOpen(false); setQuery(""); }}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
