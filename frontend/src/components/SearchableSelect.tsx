import {
  Children,
  isValidElement,
  KeyboardEvent,
  ReactNode,
  SelectHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type SearchableSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & {
  onSearchQuery?: (query: string) => void;
};

type SelectOption = {
  disabled: boolean;
  label: string;
  value: string;
};

type MenuPosition = {
  bottom?: number;
  left: number;
  top?: number;
  width: number;
};

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function collectOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; value?: string | number }>(child)) return;

    if (child.type === "option") {
      options.push({
        disabled: Boolean(child.props.disabled),
        label: nodeText(child.props.children).trim(),
        value: String(child.props.value ?? nodeText(child.props.children)),
      });
      return;
    }

    if (child.props.children) options.push(...collectOptions(child.props.children));
  });

  return options;
}

export function SearchableSelect({
  children,
  className = "",
  disabled,
  id,
  name,
  onBlur,
  onChange,
  onFocus,
  onSearchQuery,
  required,
  style,
  value,
  ...selectProps
}: SearchableSelectProps) {
  const generatedId = useId();
  const selectId = id ?? `searchable-select-${generatedId.replace(/:/g, "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const options = useMemo(() => collectOptions(children), [children]);
  const selectedValue = String(value ?? selectProps.defaultValue ?? "");
  const selected = options.find((option) => option.value === selectedValue);
  const placeholder = options.find((option) => option.value === "")?.label ?? "Select an option";
  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const positionMenu = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const margin = 8;
      const gap = 4;
      const width = Math.min(Math.max(rect.width, 224), window.innerWidth - margin * 2);
      const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
      const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
      const spaceAbove = rect.top - margin - gap;

      setMenuPosition(
        spaceBelow >= 220 || spaceBelow >= spaceAbove
          ? { left, top: rect.bottom + gap, width }
          : { bottom: window.innerHeight - rect.top + gap, left, width },
      );
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const choose = (nextValue: string) => {
    const target = { name: name ?? "", value: nextValue } as HTMLSelectElement;
    onChange?.({ target, currentTarget: target } as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    setQuery("");
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <select
        {...selectProps}
        id={selectId}
        name={name}
        value={selectedValue}
        required={required}
        disabled={disabled}
        onChange={() => undefined}
        className="pointer-events-none absolute h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      >
        {children}
      </select>
      <button
        ref={buttonRef}
        type="button"
        className={`${className} flex items-center justify-between gap-2 text-left`}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${selectId}-options`}
        onBlur={(event) => onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
        onFocus={(event) => onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedValue ? "" : "text-slate-400"}`}>
          {selected?.label || placeholder}
        </span>
        <svg className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && !disabled && menuPosition && createPortal(
        <div
          ref={menuRef}
          style={menuPosition}
          className="fixed z-[1000] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 focus-within:border-aqua-500 focus-within:ring-2 focus-within:ring-aqua-500/20">
              <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m12.5 12.5 4 4" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  onSearchQuery?.(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setOpen(false);
                    setQuery("");
                  } else if (event.key === "Enter" && filtered.length === 1 && !filtered[0].disabled) {
                    event.preventDefault();
                    choose(filtered[0].value);
                  }
                }}
                className="w-full border-0 bg-transparent py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Search options..."
                aria-label="Search dropdown options"
              />
            </div>
          </div>
          <div id={`${selectId}-options`} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === selectedValue}
                key={`${option.value}-${index}`}
                disabled={option.disabled}
                onClick={() => choose(option.value)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  option.value === selectedValue
                    ? "bg-aqua-50 font-semibold text-aqua-800"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {option.value === selectedValue && <span className="ml-3 text-aqua-700">✓</span>}
              </button>
            ))}
            {!filtered.length && <div className="px-3 py-6 text-center text-sm text-slate-400">No options found</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
