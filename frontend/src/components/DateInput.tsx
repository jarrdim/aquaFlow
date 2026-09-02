import {
  InputHTMLAttributes,
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

function dmyToIso(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
    ? iso
    : "";
}

function typedDate(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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

  function validate(display: string) {
    const iso = dmyToIso(display);
    let message = "";
    if (display && !iso) message = "Enter a valid date in DD/MM/YYYY format.";
    else if (iso && min && iso < min.slice(0, 10)) message = `Date must be on or after ${formatDmyDate(min)}.`;
    else if (iso && max && iso > max.slice(0, 10)) message = `Date must be on or before ${formatDmyDate(max)}.`;
    visibleRef.current?.setCustomValidity(message);
    return { iso, valid: !message };
  }

  return (
    <span className="relative block">
      <input
        {...props}
        ref={visibleRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        className={`${className} pr-10`}
        value={displayValue}
        disabled={disabled}
        required={required}
        pattern="\d{2}/\d{2}/\d{4}"
        onChange={(event) => {
          const display = typedDate(event.target.value);
          setDisplayValue(display);
          visibleRef.current?.setCustomValidity("");
          if (!display) emit("");
          else {
            const iso = dmyToIso(display);
            if (iso) emit(iso);
          }
        }}
        onBlur={() => validate(displayValue)}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Choose date"
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 transition hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => pickerRef.current?.showPicker()}
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

function dmyTimeToIso(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, day, month, year, hour, minute] = match;
  const isoDate = dmyToIso(`${day}/${month}/${year}`);
  if (!isoDate || Number(hour) > 23 || Number(minute) > 59) return "";
  return `${isoDate}T${hour}:${minute}`;
}

function typedDateTime(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  let result = digits.slice(0, 2);
  if (digits.length > 2) result += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) result += `/${digits.slice(4, 8)}`;
  if (digits.length > 8) result += ` ${digits.slice(8, 10)}`;
  if (digits.length > 10) result += `:${digits.slice(10, 12)}`;
  return result;
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
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY HH:mm"
        className={`${className} pr-10`}
        value={displayValue}
        disabled={disabled}
        required={required}
        pattern="\d{2}/\d{2}/\d{4} \d{2}:\d{2}"
        onChange={(event) => {
          const display = typedDateTime(event.target.value);
          setDisplayValue(display);
          visibleRef.current?.setCustomValidity("");
          if (!display) emit("");
          else {
            const iso = dmyTimeToIso(display);
            if (iso) emit(iso);
          }
        }}
        onBlur={() => {
          const iso = dmyTimeToIso(displayValue);
          let message = "";
          if (displayValue && !iso) message = "Enter a valid date and time in DD/MM/YYYY HH:mm format.";
          else if (iso && min && iso < min.slice(0, 16)) message = `Date and time must be on or after ${isoToDmyTime(min)}.`;
          else if (iso && max && iso > max.slice(0, 16)) message = `Date and time must be on or before ${isoToDmyTime(max)}.`;
          visibleRef.current?.setCustomValidity(message);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Choose date and time"
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 transition hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => pickerRef.current?.showPicker()}
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
