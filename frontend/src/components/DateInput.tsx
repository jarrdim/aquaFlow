import {
  InputHTMLAttributes,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

type DateValueChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type DateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max"
> & {
  type?: "date";
  value?: string;
  min?: string;
  max?: string;
  onChange?: (event: DateValueChangeEvent) => void;
};

export function formatDmyDate(
  value: string | Date | null | undefined,
): string {
  if (!value) return "";
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : formatDmyDate(parsed);
}

function openNativePicker(ref: RefObject<HTMLInputElement>) {
  const picker = ref.current;
  if (!picker) return;
  try {
    picker.showPicker?.();
  } catch {
    picker.focus();
    picker.click();
  }
}

export function DateInput({
  value = "",
  min,
  max,
  onChange,
  className = "",
  disabled,
  required,
  ...props
}: DateInputProps) {
  const isoValue = String(value ?? "").slice(0, 10);
  const [displayValue, setDisplayValue] = useState(() => formatDmyDate(isoValue));
  const visibleRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayValue(formatDmyDate(isoValue));
  }, [isoValue]);

  function emit(nextValue: string) {
    onChange?.({
      target: { value: nextValue },
      currentTarget: { value: nextValue },
    });
  }

  return (
    <span className="relative block">
      <input
        {...props}
        ref={visibleRef}
        type="text"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        className={`${className} cursor-pointer pr-10`}
        value={displayValue}
        disabled={disabled}
        required={required}
        readOnly
        aria-haspopup="dialog"
        onClick={() => openNativePicker(pickerRef)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openNativePicker(pickerRef);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Choose date"
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 transition hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => openNativePicker(pickerRef)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px opacity-0"
        value={isoValue}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        onChange={(event) => {
          const iso = event.target.value;
          setDisplayValue(formatDmyDate(iso));
          visibleRef.current?.setCustomValidity("");
          emit(iso);
        }}
      />
    </span>
  );
}

type DateTimeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max"
> & {
  type?: "datetime-local";
  value?: string;
  min?: string;
  max?: string;
  onChange?: (event: DateValueChangeEvent) => void;
};

function isoToDmyTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : "";
}

export function DateTimeInput({
  value = "",
  min,
  max,
  onChange,
  className = "",
  disabled,
  required,
  ...props
}: DateTimeInputProps) {
  const isoValue = String(value ?? "").slice(0, 16);
  const [displayValue, setDisplayValue] = useState(() => isoToDmyTime(isoValue));
  const visibleRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDisplayValue(isoToDmyTime(isoValue)), [isoValue]);

  function emit(nextValue: string) {
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } });
  }

  return (
    <span className="relative block">
      <input
        {...props}
        ref={visibleRef}
        type="text"
        autoComplete="off"
        placeholder="DD/MM/YYYY HH:mm"
        className={`${className} cursor-pointer pr-10`}
        value={displayValue}
        disabled={disabled}
        required={required}
        readOnly
        aria-haspopup="dialog"
        onClick={() => openNativePicker(pickerRef)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openNativePicker(pickerRef);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Choose date and time"
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 transition hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => openNativePicker(pickerRef)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18M12 14v3l2 1" />
        </svg>
      </button>
      <input
        ref={pickerRef}
        type="datetime-local"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px opacity-0"
        value={isoValue}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        onChange={(event) => {
          const iso = event.target.value;
          setDisplayValue(isoToDmyTime(iso));
          visibleRef.current?.setCustomValidity("");
          emit(iso);
        }}
      />
    </span>
  );
}
