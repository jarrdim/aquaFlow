import { Fragment, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";
import {
  exportExcel,
  exportMeterReadingZonePdf,
  exportMeterReadingZoneWorkbook,
  openEvidence,
  parseMeterWorkbook,
} from "../lib/meterFiles";
import { CheckboxMultiSelect } from "../components/CheckboxMultiSelect";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { GpsMap } from "../components/GpsMap";
import { DateInput, DateTimeInput, formatDmyDate } from "../components/DateInput";

type Row = Record<string, any>;

function evidenceImageSource(item?: Row) {
  const content = item?.contentData ?? item?.content;
  if (!content) return "";
  if (String(content).startsWith("data:")) return String(content);
  return `data:${item?.mimeType || "image/jpeg"};base64,${content}`;
}

function readingSource(reading: Row) {
  if ((reading.events ?? []).some((event: Row) => event.eventType === "CUSTOMER_SUBMITTED")) return "Customer submitted";
  if (reading.fieldOfficer) return "Field staff";
  return "System / imported";
}

function ReadingEvidenceModal({ reading, onClose }: { reading: Row; onClose: () => void }) {
  const photos = (reading.evidence ?? []).filter((item: Row) =>
    String(item.mimeType ?? "image/jpeg").startsWith("image/"),
  );
  const customerEvidence = (reading.events ?? []).find(
    (event: Row) => event.eventType === "CUSTOMER_EVIDENCE_SUBMITTED",
  );
  const customerProposedReading = customerEvidence?.metadata?.proposedReading;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reading-evidence-title"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 id="reading-evidence-title" className="text-xl font-extrabold text-slate-900">Reading evidence</h2>
            <p className="mt-1 text-sm text-slate-500">
              {reading.meter?.meterNumber ?? "Meter"} · {reading.account?.accountNumber ?? "Account"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evidence" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xl font-bold text-slate-600 transition hover:bg-slate-200">×</button>
        </header>
        <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Meter photo</h3>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{photos.length} attached</span>
            </div>
            {photos.length ? (
              <div className="space-y-3">
                {photos.map((photo: Row, index: number) => (
                  <figure key={photo.evidenceId ?? index} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    <img src={evidenceImageSource(photo)} alt={`Meter evidence ${index + 1}`} className="max-h-[460px] w-full object-contain" />
                    <figcaption className="border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">{photo.fileName || `Meter photo ${index + 1}`}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">No photo evidence is attached.</div>
            )}
          </div>
          <div className="space-y-4">
            {customerEvidence && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <div className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Customer supporting evidence</div>
                <div className="mt-2 text-sm text-violet-950">
                  Customer-proposed reading: <strong>{number(customerProposedReading)}</strong>
                </div>
                {customerEvidence.remarks && <p className="mt-1 text-sm text-violet-800">{customerEvidence.remarks}</p>}
              </div>
            )}
            <div>
              <h3 className="mb-3 font-bold text-slate-900">GPS location</h3>
              <GpsMap latitude={reading.gpsLatitude} longitude={reading.gpsLongitude} label="Meter reading location" empty />
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
              <div><dt className="text-slate-500">Previous</dt><dd className="mt-1 font-bold text-slate-900">{number(reading.previousReading)}</dd></div>
              <div><dt className="text-slate-500">Current</dt><dd className="mt-1 font-bold text-aqua-700">{number(reading.currentReading)}</dd></div>
              <div><dt className="text-slate-500">Consumption</dt><dd className="mt-1 font-bold text-emerald-700">{number(reading.consumption)} units</dd></div>
              <div><dt className="text-slate-500">Approval</dt><dd className="mt-1"><Badge value={reading.approvalStatus} /></dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Captured</dt><dd className="mt-1 font-semibold text-slate-800">{date(reading.capturedAt ?? reading.readingDate)}</dd></div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] leading-5 text-slate-700 outline-none transition focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 disabled:bg-slate-50 disabled:text-slate-400";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";

function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1680px] p-4 lg:px-5 lg:py-5">
      <div className="page-screen-header mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium leading-5 text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
function Button({
  tone = "blue",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "blue" | "green" | "red" | "slate" | "orange";
}) {
  const colors = {
    blue: "bg-aqua-700 hover:bg-aqua-600",
    green: "bg-emerald-600 hover:bg-emerald-500",
    red: "bg-red-600 hover:bg-red-500",
    slate: "bg-slate-600 hover:bg-slate-500",
    orange: "bg-orange-500 hover:bg-orange-400",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]} ${className}`}
    />
  );
}
function CycleActionButton({
  tone = "neutral",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "success" | "neutral" | "danger";
}) {
  const colors = {
    primary:
      "border-aqua-200 bg-aqua-50 text-aqua-800 hover:border-aqua-300 hover:bg-aqua-100",
    success:
      "border-emerald-600 bg-emerald-600 text-white hover:border-emerald-500 hover:bg-emerald-500",
    neutral:
      "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100",
    danger:
      "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100",
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-9 items-center justify-center rounded-lg border px-3 py-1.5 text-sm font-semibold shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-aqua-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]} ${className}`}
    />
  );
}
function LinkButton({
  to,
  children,
  tone = "blue",
}: {
  to: string;
  children: ReactNode;
  tone?: "blue" | "green";
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm ${tone === "green" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-aqua-700 hover:bg-aqua-600"}`}
    >
      {children}
    </Link>
  );
}
function Notice({
  children,
  tone = "red",
}: {
  children: ReactNode;
  tone?: "red" | "blue" | "green";
}) {
  if (tone !== "blue") {
    return <SweetAlertToast message={children} type={tone === "green" ? "success" : "error"} />;
  }
  const cls = {
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div
      className={`mb-3 whitespace-pre-line rounded-lg border px-3 py-2 text-sm ${cls[tone]}`}
    >
      {children}
    </div>
  );
}

function MultiCheckDropdown({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string; detail?: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;
  const allSelected =
    options.length > 0 && options.every((option) => selected.includes(option.value));
  return (
    <details className="group relative">
      <summary
        className={`${INPUT} flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}
      >
        <span className={`truncate ${selected.length ? "text-slate-700" : "text-slate-400"}`}>
          {summary}
        </span>
        <span className="text-xs text-slate-400 transition group-open:rotate-180">▼</span>
      </summary>
      <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[280px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border-b border-slate-100 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              onChange(allSelected ? [] : options.map((option) => option.value))
            }
          />
          Select all
          <span className="ml-auto text-xs font-medium text-slate-400">
            {options.length}
          </span>
        </label>
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition ${
                checked ? "bg-aqua-50 text-aqua-900" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <input
                className="mt-0.5"
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((value) => value !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{option.label}</span>
                {option.detail && (
                  <span className="block truncate text-xs text-slate-400">{option.detail}</span>
                )}
              </span>
            </label>
          );
        })}
        {!options.length && (
          <p className="px-3 py-6 text-center text-sm text-slate-400">No options available.</p>
        )}
      </div>
    </details>
  );
}
const tone: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  PLANNED: "bg-blue-50 text-blue-700",
  ASSIGNED: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-cyan-50 text-cyan-700",
  PENDING: "bg-amber-50 text-amber-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  CLOSED: "bg-slate-100 text-slate-600",
  NONE: "bg-slate-100 text-slate-600",
  ZERO: "bg-orange-50 text-orange-700",
  NEGATIVE: "bg-red-50 text-red-700",
  HIGH: "bg-red-50 text-red-700",
  LOW: "bg-amber-50 text-amber-700",
  TAMPERED: "bg-red-50 text-red-700",
};
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone[value] ?? "bg-slate-100 text-slate-600"}`}
    >
      {pretty(value)}
    </span>
  );
}
function pretty(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function date(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "—";
}
function number(value: any, digits = 3) {
  return Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}
function customerName(row: Row) {
  const c = row.account?.customer;
  return (
    c?.organizationName ||
    [c?.firstName, c?.middleName, c?.lastName].filter(Boolean).join(" ") ||
    "—"
  );
}

function CycleSelect({
  value,
  onChange,
  includeAll = false,
}: {
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
}) {
  const [cycles, setCycles] = useState<Row[]>([]);
  useEffect(() => {
    api
      .listReadingCycles()
      .then(setCycles)
      .catch(() => undefined);
  }, []);
  return (
    <SearchableSelect
      className={INPUT}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {includeAll ? "All reading cycles" : "Select reading cycle"}
      </option>
      {cycles.map((c) => (
        <option key={c.readingCycleId} value={c.readingCycleId}>
          {c.cycleName} · {pretty(c.status)}
        </option>
      ))}
    </SearchableSelect>
  );
}

export function ReadingDashboard() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [zones, setZones] = useState<Row[]>([]);
  const [filters, setFilters] = useState({ cycleId: "", zoneId: "" });
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([api.listReadingCycles(), api.listZones()])
      .then(([c, z]) => {
        setCycles(c);
        setZones(z);
        const open = c.find((x: Row) => x.status === "OPEN");
        if (open)
          setFilters((f) => ({ ...f, cycleId: String(open.readingCycleId) }));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .readingDashboard(filters)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters]);
  const stats = [
    {
      label: "Meters in scope",
      value: data?.totalMeters,
      detail: "Eligible active meters",
      color: "text-slate-900",
      icon: "▦",
      iconClass: "bg-slate-100 text-slate-600",
      accent: "border-t-slate-400",
    },
    {
      label: "Captured",
      value: data?.captured,
      detail: "Submitted this cycle",
      color: "text-blue-700",
      icon: "✓",
      iconClass: "bg-blue-50 text-blue-700",
      accent: "border-t-blue-500",
    },
    {
      label: "Approved",
      value: data?.approved,
      detail: "Ready for billing",
      color: "text-emerald-700",
      icon: "✓",
      iconClass: "bg-emerald-50 text-emerald-700",
      accent: "border-t-emerald-500",
    },
    {
      label: "Pending approval",
      value: data?.pending,
      detail: "Awaiting review",
      color: "text-amber-700",
      icon: "◷",
      iconClass: "bg-amber-50 text-amber-700",
      accent: "border-t-amber-500",
    },
    {
      label: "Unread",
      value: data?.unread,
      detail: "Still to be visited",
      color: "text-orange-700",
      icon: "○",
      iconClass: "bg-orange-50 text-orange-700",
      accent: "border-t-orange-500",
    },
    {
      label: "Exceptions",
      value: data?.exceptions,
      detail: "Require attention",
      color: "text-red-700",
      icon: "!",
      iconClass: "bg-red-50 text-red-700",
      accent: "border-t-red-500",
    },
  ];
  const selectedCycle =
    cycles.find((cycle) => String(cycle.readingCycleId) === filters.cycleId) ??
    data?.cycle;
  const selectedZone = zones.find(
    (zone) => String(zone.zoneId) === filters.zoneId,
  );
  const completionPercent = Number(data?.completionPercent ?? 0);
  return (
    <Page
      title="Meter Reading Management"
      subtitle="Plan routes, capture readings, resolve exceptions and approve consumption"
      actions={
        <>
          <LinkButton to="/readings/worklist">Open worklist</LinkButton>
          <LinkButton to="/readings/cycles" tone="green">
            Manage cycles
          </LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <section className="relative mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading && (
          <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-aqua-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-aqua-600" />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
          <div>
            <h2 className="font-semibold text-slate-900">Dashboard scope</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Focus the operational totals by reading cycle and service zone.
            </p>
          </div>
          <div
            className={`inline-flex min-w-36 items-center justify-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
              loading
                ? "bg-aqua-50 text-aqua-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
            role="status"
            aria-live="polite"
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700" />
                Updating results
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Results up to date
              </>
            )}
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <Field label="Reading cycle">
            <SearchableSelect
              className={INPUT}
              value={filters.cycleId}
              onChange={(e) => {
                setLoading(true);
                setFilters({ ...filters, cycleId: e.target.value });
              }}
            >
              <option value="">Current open cycle</option>
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Zone">
            <SearchableSelect
              className={INPUT}
              value={filters.zoneId}
              onChange={(e) => {
                setLoading(true);
                setFilters({ ...filters, zoneId: e.target.value });
              }}
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={z.zoneId}>
                  {z.zoneName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">
          <span>
            Cycle:{" "}
            <strong className="font-semibold text-slate-700">
              {selectedCycle?.cycleName ?? "Current open cycle"}
            </strong>
          </span>
          <span>
            Zone:{" "}
            <strong className="font-semibold text-slate-700">
              {selectedZone?.zoneName ?? "All zones"}
            </strong>
          </span>
          {selectedCycle?.status && (
            <span>
              Status:{" "}
              <strong className="font-semibold text-slate-700">
                {pretty(selectedCycle.status)}
              </strong>
            </span>
          )}
        </div>
      </section>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {stats.map((stat) => (
          <section
            key={stat.label}
            className={`rounded-2xl border border-slate-200 border-t-[3px] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${stat.accent}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold ${stat.iconClass}`}
                aria-hidden="true"
              >
                {stat.icon}
              </span>
              {loading && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-aqua-500" />
              )}
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-600">
              {stat.label}
            </div>
            {loading && !data ? (
              <div className="mt-2 h-8 w-20 animate-pulse rounded-md bg-slate-100" />
            ) : (
              <div className={`mt-1 text-3xl font-bold ${stat.color}`}>
                {number(stat.value ?? 0, 0)}
              </div>
            )}
            <p className="mt-1 text-xs leading-4 text-slate-400">
              {stat.detail}
            </p>
          </section>
        ))}
      </div>
      <div
        className="relative grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"
        aria-busy={loading}
      >
        {loading && data && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-2xl bg-white/60 pt-20 backdrop-blur-[1px]">
            <div className="flex items-center gap-3 rounded-full border border-aqua-100 bg-white px-4 py-2.5 text-sm font-semibold text-aqua-700 shadow-lg">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700" />
              Loading selected dashboard…
            </div>
          </div>
        )}
      <Card title="Recent readings">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50/80">
              <tr>
                <th className={TH}>Meter / customer</th>
                <th className={TH}>Current</th>
                <th className={TH}>Consumption</th>
                <th className={TH}>Exception</th>
                <th className={TH}>Approval</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent ?? []).map((r: Row) => (
                <tr
                  key={r.readingId}
                  className="border-t border-slate-100 transition hover:bg-slate-50/70"
                >
                  <td className={TD}>
                    <div className="font-semibold text-slate-800">
                      {r.meter?.meterNumber ?? "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {customerName(r)}
                    </div>
                  </td>
                  <td className={`${TD} font-semibold text-slate-800`}>
                    {number(r.currentReading)}
                  </td>
                  <td className={TD}>{number(r.consumption)}</td>
                  <td className={TD}>
                    <Badge value={r.exceptionType} />
                  </td>
                  <td className={TD}>
                    <Badge value={r.approvalStatus} />
                  </td>
                </tr>
              ))}
              {!loading && !data?.recent?.length && (
                <tr>
                  <td colSpan={5} className="p-10 text-center">
                    <div className="font-semibold text-slate-700">
                      No recent readings
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Captured readings for this scope will appear here.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-4 py-3">
          <Link
            to="/readings/register"
            className="text-sm font-semibold text-aqua-700 hover:text-aqua-600"
          >
            View complete reading register →
          </Link>
        </div>
      </Card>
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <h2 className="font-semibold text-slate-900">
                Collection progress
              </h2>
              <span className="rounded-full bg-aqua-50 px-2.5 py-1 text-sm font-bold text-aqua-700">
                {number(completionPercent, 1)}%
              </span>
            </div>
            <div className="p-4">
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-aqua-600 to-cyan-400 transition-all duration-500"
                  style={{ width: `${Math.min(completionPercent, 100)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-emerald-50 p-3">
                  <div className="text-xs font-medium text-emerald-700">
                    Captured
                  </div>
                  <div className="mt-1 text-xl font-bold text-emerald-800">
                    {number(data?.captured ?? 0, 0)}
                  </div>
                </div>
                <div className="rounded-xl bg-orange-50 p-3">
                  <div className="text-xs font-medium text-orange-700">
                    Remaining
                  </div>
                  <div className="mt-1 text-xl font-bold text-orange-800">
                    {number(data?.unread ?? 0, 0)}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Based on eligible active meters in the selected cycle and zone.
              </p>
            </div>
          </section>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3.5">
              <h2 className="font-semibold text-slate-900">Next actions</h2>
            </div>
            <div className="divide-y divide-slate-100">
              <Link
                to="/readings/approvals"
                className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-amber-50/60"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-700">
                    Review pending readings
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Supervisor approval queue
                  </div>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-sm font-bold text-amber-700">
                  {number(data?.pending ?? 0, 0)}
                </span>
              </Link>
              <Link
                to="/readings/exceptions"
                className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-red-50/60"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-700">
                    Resolve exceptions
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Abnormal or disputed readings
                  </div>
                </div>
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-sm font-bold text-red-700">
                  {number(data?.exceptions ?? 0, 0)}
                </span>
              </Link>
              <Link
                to="/readings/worklist"
                className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-aqua-50/60"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-700">
                    Continue field capture
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Open the route worklist
                  </div>
                </div>
                <span className="text-lg text-aqua-700">→</span>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}

export function ReadingCycles() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [cycleSearch, setCycleSearch] = useState("");
  const [cyclePage, setCyclePage] = useState(1);
  const [cyclePageSize, setCyclePageSize] = useState(10);
  const now = new Date();
  const [form, setForm] = useState({
    cycleCode: `RC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    cycleName: now.toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    }),
    startDate: new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10),
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10),
    status: "PLANNED",
    remarks: "",
  });
  const load = () =>
    api
      .listReadingCycles()
      .then(setCycles)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const filteredCycles = useMemo(() => {
    const query = cycleSearch.trim().toLowerCase();
    if (!query) return cycles;
    return cycles.filter((cycle) =>
      [
        cycle.cycleCode,
        cycle.cycleName,
        cycle.status,
        formatDmyDate(cycle.startDate),
        formatDmyDate(cycle.endDate),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [cycles, cycleSearch]);
  const cyclePages = Math.max(
    1,
    Math.ceil(filteredCycles.length / cyclePageSize),
  );
  const safeCyclePage = Math.min(cyclePage, cyclePages);
  const pagedCycles = filteredCycles.slice(
    (safeCyclePage - 1) * cyclePageSize,
    safeCyclePage * cyclePageSize,
  );
  const cycleStart = filteredCycles.length
    ? (safeCyclePage - 1) * cyclePageSize + 1
    : 0;
  const cycleEnd = Math.min(
    safeCyclePage * cyclePageSize,
    filteredCycles.length,
  );
  const openCycles = cycles.filter((cycle) => cycle.status === "OPEN").length;
  const plannedCycles = cycles.filter((cycle) => cycle.status === "PLANNED").length;
  const totalReadings = cycles.reduce((sum, cycle) => sum + Number(cycle._count?.readings ?? 0), 0);
  const totalAssignments = cycles.reduce((sum, cycle) => sum + Number(cycle._count?.routeAssignments ?? 0), 0);
  useEffect(() => {
    setCyclePage(1);
  }, [cycleSearch, cyclePageSize]);
  useEffect(() => {
    if (cyclePage > cyclePages) setCyclePage(cyclePages);
  }, [cyclePage, cyclePages]);
  const CyclePagination = ({ position }: { position: "top" | "bottom" }) => (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${
        position === "top"
          ? "border-b border-slate-100 pb-3"
          : "border-t border-slate-100 pt-3"
      }`}
    >
      <p className="text-sm text-slate-500">
        Showing <strong className="text-slate-700">{cycleStart}</strong>–
        <strong className="text-slate-700">{cycleEnd}</strong> of{" "}
        <strong className="text-slate-700">
          {filteredCycles.length.toLocaleString()}
        </strong>{" "}
        cycle{filteredCycles.length === 1 ? "" : "s"}
      </p>
      <div className="flex items-center gap-2">
        <CycleActionButton
          tone="neutral"
          disabled={safeCyclePage <= 1}
          aria-label="Show previous reading-cycle page"
          onClick={() => setCyclePage((page) => Math.max(1, page - 1))}
        >
          Previous
        </CycleActionButton>
        <span className="min-w-24 text-center text-sm font-medium text-slate-600">
          Page {safeCyclePage} of {cyclePages}
        </span>
        <CycleActionButton
          tone="neutral"
          disabled={safeCyclePage >= cyclePages}
          aria-label="Show next reading-cycle page"
          onClick={() =>
            setCyclePage((page) => Math.min(cyclePages, page + 1))
          }
        >
          Next
        </CycleActionButton>
      </div>
    </div>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editingId) {
        await api.updateReadingCycle(editingId, form);
        setMessage("Reading cycle details updated successfully.");
      } else {
        await api.createReadingCycle(form);
        setMessage("Reading cycle created successfully.");
      }
      await load();
      setEditingId("");
      setForm({ ...form, cycleCode: "", cycleName: "", remarks: "" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  function edit(c: Row) {
    setError("");
    setMessage("");
    setEditingId(String(c.readingCycleId));
    setForm({
      cycleCode: c.cycleCode,
      cycleName: c.cycleName,
      startDate: c.startDate.slice(0, 10),
      endDate: c.endDate.slice(0, 10),
      status: c.status,
      remarks: c.remarks ?? "",
    });
  }
  async function status(c: Row, next: string) {
    if (
      next === "CANCELLED" &&
      !window.confirm(
        `Cancel reading cycle ${c.cycleCode}? Its code will remain reserved for audit history.`,
      )
    )
      return;
    setError("");
    setMessage("");
    try {
      await api.updateReadingCycleStatus(String(c.readingCycleId), next);
      await load();
      setMessage(
        next === "PLANNED"
          ? `${c.cycleCode} was reopened as a planned cycle.`
          : `${c.cycleCode} is now ${next.toLowerCase()}.`,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Reading cycles"
      subtitle="Create and control the periods in which meter readings are collected"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Open cycles</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{openCycles}</div></div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-sky-700">Planned cycles</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{plannedCycles}</div></div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-violet-700">Route assignments</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{totalAssignments.toLocaleString()}</div></div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-amber-700">Captured readings</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{totalReadings.toLocaleString()}</div></div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[370px_minmax(0,1fr)] xl:items-start">
        <Card title={editingId ? "Edit reading cycle" : "Create reading cycle"} className="overflow-hidden shadow-md shadow-slate-200/50 xl:sticky xl:top-24">
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/70 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg></span><div><div className="font-bold text-slate-800">Define a collection period</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Planned cycles can be prepared first, then opened when field collection begins.</p></div></div>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Cycle code" required>
              <input
                required
                className={INPUT}
                value={form.cycleCode}
                onChange={(e) =>
                  setForm({ ...form, cycleCode: e.target.value })
                }
              />
            </Field>
            <Field label="Cycle name" required>
              <input
                required
                className={INPUT}
                value={form.cycleName}
                onChange={(e) =>
                  setForm({ ...form, cycleName: e.target.value })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" required>
                <DateInput
                  required
                  className={INPUT}
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </Field>
              <Field label="End date" required>
                <DateInput
                  required
                  className={INPUT}
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Initial status">
              <SearchableSelect
                className={INPUT}
                value={form.status}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="PLANNED">Planned</option>
                <option value="OPEN">Open immediately</option>
              </SearchableSelect>
            </Field>
            <Field label="Remarks">
              <textarea
                rows={2}
                className={INPUT}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>
            {editingId && (
              <Button
                type="button"
                tone="slate"
                className="mb-2 w-full"
                onClick={() => setEditingId("")}
              >
                Cancel edit
              </Button>
            )}
            <Button disabled={saving} className="w-full">
              {saving ? "Saving..." : editingId ? "Save changes" : "Create cycle"}
            </Button>
          </form>
        </Card>
        <Card title="Cycle register" className="min-w-0 overflow-hidden shadow-md shadow-slate-200/50">
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_150px]">
            <Field label="Search cycle register">
              <div className="relative"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input
                type="search"
                className={`${INPUT} pl-10`}
                value={cycleSearch}
                placeholder="Cycle code, name, status or date"
                onChange={(event) => setCycleSearch(event.target.value)}
              /></div>
            </Field>
            <Field label="Rows per page">
              <SearchableSelect
                className={INPUT}
                value={cyclePageSize}
                onChange={(event) =>
                  setCyclePageSize(Number(event.target.value))
                }
              >
                <option value={10}>10 rows</option>
                <option value={25}>25 rows</option>
                <option value={50}>50 rows</option>
              </SearchableSelect>
            </Field>
          </div>
          <CyclePagination position="top" />
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-slate-50/90">
                  <th className={TH}>Code</th>
                  <th className={TH}>Cycle</th>
                  <th className={TH}>Cycle date</th>
                  <th className={TH}>Routes</th>
                  <th className={TH}>Readings</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedCycles.map((c) => (
                  <tr
                    key={c.readingCycleId}
                    className="border-t border-slate-100 transition hover:bg-sky-50/40"
                  >
                    <td className={`${TD} font-medium text-slate-800`}>
                      <span className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold text-slate-700">{c.cycleCode}</span>
                    </td>
                    <td className={TD}><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16" /></svg></span><span className="font-bold text-slate-800">{c.cycleName}</span></div></td>
                    <td className={TD}>
                      {formatDmyDate(c.startDate)} – {formatDmyDate(c.endDate)}
                    </td>
                    <td className={TD}><span className="inline-flex min-w-9 justify-center rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{c._count?.routeAssignments ?? 0}</span></td>
                    <td className={TD}>
                      {Number(c._count?.readings ?? 0) > 0 ? (
                        <Link
                          to={`/readings/register?cycleId=${encodeURIComponent(String(c.readingCycleId))}`}
                          aria-label={`View ${Number(c._count.readings).toLocaleString()} readings in ${c.cycleName}`}
                          className="inline-flex min-w-9 items-center justify-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-600 hover:text-white hover:ring-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                          title="View readings in this cycle"
                        >
                          {Number(c._count.readings).toLocaleString()}
                        </Link>
                      ) : (
                        <span className="inline-flex min-w-9 justify-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">0</span>
                      )}
                    </td>
                    <td className={TD}>
                      <Badge value={c.status} />
                    </td>
                    <td className={TD}>
                      {c.status === "CLOSED" ? (
                        <span className="text-sm text-slate-400">No actions</span>
                      ) : (
                        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
                          {["PLANNED", "CANCELLED"].includes(c.status) &&
                            (c._count?.readings ?? 0) === 0 && (
                              <CycleActionButton
                                tone="primary"
                                aria-label={`Edit ${c.cycleCode}`}
                                onClick={() => edit(c)}
                              >
                                Edit
                              </CycleActionButton>
                            )}
                          {c.status === "PLANNED" && (
                            <CycleActionButton
                              tone="success"
                              aria-label={`Open ${c.cycleCode}`}
                              onClick={() => status(c, "OPEN")}
                            >
                              Open cycle
                            </CycleActionButton>
                          )}
                          {c.status === "OPEN" && (
                            <CycleActionButton
                              tone="neutral"
                              aria-label={`Close ${c.cycleCode}`}
                              onClick={() => status(c, "CLOSED")}
                            >
                              Close cycle
                            </CycleActionButton>
                          )}
                          {c.status === "CANCELLED" && (
                            <CycleActionButton
                              tone="primary"
                              aria-label={`Reopen ${c.cycleCode}`}
                              onClick={() => status(c, "PLANNED")}
                            >
                              Reopen
                            </CycleActionButton>
                          )}
                          {!["CLOSED", "CANCELLED"].includes(c.status) && (
                            <CycleActionButton
                              tone="danger"
                              aria-label={`Cancel ${c.cycleCode}`}
                              onClick={() => status(c, "CANCELLED")}
                            >
                              Cancel
                            </CycleActionButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!pagedCycles.length && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-16 text-center text-sm text-slate-400"
                    >
                      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><rect x="4" y="5" width="16" height="15" rx="2" /></svg></div><div className="mt-4 font-bold text-slate-700">{cycles.length ? "No cycles match your search" : "No reading cycles yet"}</div><div className="mt-1 text-slate-400">{cycles.length ? "Try a different code, name, status or date." : "Create the first collection period using the form."}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <CyclePagination position="bottom" />
          </div>
        </Card>
      </div>
    </Page>
  );
}

function ReadingRouteAssignmentsPlanner() {
  const today = new Date().toISOString().slice(0, 10);
  const [cycles, setCycles] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Row[]>([]);
  const [officers, setOfficers] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [zones, setZones] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [assignedDate, setAssignedDate] = useState(today);
  const [remarks, setRemarks] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [readerByRoute, setReaderByRoute] = useState<Record<string, string>>({});
  const [bulkReader, setBulkReader] = useState("");
  const [routeSearch, setRouteSearch] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [routePage, setRoutePage] = useState(1);
  const [registerSearch, setRegisterSearch] = useState("");
  const [registerPage, setRegisterPage] = useState(1);
  const [showOfficer, setShowOfficer] = useState(false);
  const [officerForm, setOfficerForm] = useState({
    userId: "",
    employeeNumber: "",
    phoneNumber: "",
    homeZoneId: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load(targetCycleId = cycleId) {
    setLoading(true);
    try {
      const [cycleRows, routeRows, officerRows, candidateRows, zoneRows] =
        await Promise.all([
          api.listReadingCycles(),
          api.listRoutes(),
          api.listReadingOfficers(),
          api.listReadingStaffCandidates(),
          api.listZones(),
        ]);
      const selectedCycleId =
        targetCycleId ||
        String(
          (cycleRows.find((row: Row) => row.status === "OPEN") ?? cycleRows[0])
            ?.readingCycleId ?? "",
        );
      const assignmentRows = await api.listRouteAssignments(selectedCycleId);
      setCycles(cycleRows);
      setRoutes(routeRows);
      setOfficers(officerRows);
      setCandidates(candidateRows);
      setZones(zoneRows);
      setAssignments(assignmentRows);
      if (!targetCycleId) setCycleId(selectedCycleId);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!cycleId) return;
    api
      .listRouteAssignments(cycleId)
      .then((rows) => {
        setAssignments(rows);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [cycleId]);

  const activeAssignments = useMemo(
    () =>
      assignments.filter((assignment) =>
        ["ASSIGNED", "ACCEPTED"].includes(assignment.status),
      ),
    [assignments],
  );
  const assignedCount = activeAssignments.length;
  const completedCount = assignments.filter(
    (assignment) => assignment.status === "COMPLETED",
  ).length;
  const assignedByRoute = useMemo(
    () =>
      new Map(
        activeAssignments.map((assignment) => [
          String(assignment.routeId),
          assignment,
        ]),
      ),
    [activeAssignments],
  );
  const filteredRoutes = useMemo(() => {
    const query = routeSearch.trim().toLowerCase();
    return routes.filter((route) => {
      const text = [
        route.routeName,
        route.routeCode,
        route.zone?.zoneName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        (!zoneId || String(route.zoneId) === zoneId) &&
        (!query || text.includes(query))
      );
    });
  }, [routes, routeSearch, zoneId]);
  const routePageSize = 8;
  const routePages = Math.max(1, Math.ceil(filteredRoutes.length / routePageSize));
  const visibleRoutes = filteredRoutes.slice(
    (routePage - 1) * routePageSize,
    routePage * routePageSize,
  );
  const visibleSelectable = visibleRoutes
    .map((route) => String(route.routeId))
    .filter((id) => !assignedByRoute.has(id));
  const allVisibleSelected =
    visibleSelectable.length > 0 &&
    visibleSelectable.every((id) => selected.includes(id));

  const filteredAssignments = useMemo(() => {
    const query = registerSearch.trim().toLowerCase();
    return assignments.filter((assignment) =>
      [
        assignment.cycle?.cycleCode,
        assignment.cycle?.cycleName,
        assignment.route?.routeName,
        assignment.route?.zone?.zoneName,
        assignment.officerName,
        assignment.fieldOfficer?.employeeNumber,
        assignment.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [assignments, registerSearch]);
  const registerPageSize = 10;
  const registerPages = Math.max(
    1,
    Math.ceil(filteredAssignments.length / registerPageSize),
  );
  const visibleAssignments = filteredAssignments.slice(
    (registerPage - 1) * registerPageSize,
    registerPage * registerPageSize,
  );

  useEffect(() => setRoutePage(1), [routeSearch, zoneId]);
  useEffect(() => setRegisterPage(1), [registerSearch, cycleId]);
  useEffect(() => {
    if (routePage > routePages) setRoutePage(routePages);
  }, [routePage, routePages]);
  useEffect(() => {
    if (registerPage > registerPages) setRegisterPage(registerPages);
  }, [registerPage, registerPages]);

  function toggleRoute(routeId: string) {
    setSelected((current) =>
      current.includes(routeId)
        ? current.filter((id) => id !== routeId)
        : [...current, routeId],
    );
  }
  function toggleVisible() {
    setSelected((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleSelectable.includes(id))
        : [...new Set([...current, ...visibleSelectable])],
    );
  }
  function applyReader() {
    if (!bulkReader || !selected.length) return;
    setReaderByRoute((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((routeId) => [routeId, bulkReader])),
    }));
  }
  async function submitAssignments(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!selected.length)
      return setError("Select at least one available route.");
    const missing = selected.filter((routeId) => !readerByRoute[routeId]);
    if (missing.length)
      return setError(
        `Select a meter reader for every route. ${missing.length} route(s) still need a reader.`,
      );
    setSaving(true);
    try {
      const result = await api.assignReadingRoutesBulk({
        readingCycleId: cycleId,
        assignedDate,
        remarks: remarks || undefined,
        assignments: selected.map((routeId) => ({
          routeId,
          fieldOfficerId: readerByRoute[routeId],
        })),
      });
      setSuccess(`${result.created} route assignment(s) created successfully.`);
      setSelected([]);
      setReaderByRoute({});
      setBulkReader("");
      setRemarks("");
      await load(cycleId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function createOfficer(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createReadingOfficer({
        ...officerForm,
        homeZoneId: officerForm.homeZoneId || undefined,
      });
      setShowOfficer(false);
      setOfficerForm({
        userId: "",
        employeeNumber: "",
        phoneNumber: "",
        homeZoneId: "",
      });
      await load(cycleId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  const Paging = ({
    page,
    pages,
    setPage,
  }: {
    page: number;
    pages: number;
    setPage: (page: number) => void;
  }) => (
    <div className="flex items-center gap-2">
      <CycleActionButton disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Previous
      </CycleActionButton>
      <span className="px-2 text-sm font-semibold text-slate-600">
        Page {page} of {pages}
      </span>
      <CycleActionButton
        disabled={page >= pages}
        onClick={() => setPage(page + 1)}
      >
        Next
      </CycleActionButton>
    </div>
  );

  return (
    <Page
      title="Route assignments"
      subtitle="Plan cycle workloads and allocate multiple routes to meter readers"
      actions={
        <Button onClick={() => setShowOfficer((value) => !value)}>
          {showOfficer ? "Close reader form" : "Add meter reader"}
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      {success && <Notice tone="green">{success}</Notice>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-slate-500">Reading routes</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{routes.length}</div></div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-sky-700">Active assignments</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{assignedCount}</div></div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-violet-700">Meter readers</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{officers.length}</div></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Completed</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{completedCount}</div></div>
      </div>
      {showOfficer && (
        <Card title="Create meter reader profile" className="mb-5 overflow-hidden shadow-md shadow-slate-200/50">
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="12" cy="8" r="3" /><path d="M6 20v-2a6 6 0 0 1 12 0v2" /></svg></span><div><div className="font-bold text-slate-800">Register a field officer</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Connect an active staff user to a meter-reader profile and optional home zone.</p></div></div>
          <form onSubmit={createOfficer} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Staff user" required>
              <SearchableSelect
                required
                className={INPUT}
                value={officerForm.userId}
                onChange={(e) => {
                  const user = candidates.find(
                    (candidate) => String(candidate.userId) === e.target.value,
                  );
                  setOfficerForm({
                    ...officerForm,
                    userId: e.target.value,
                    phoneNumber: user?.phoneNumber ?? officerForm.phoneNumber,
                  });
                }}
              >
                <option value="">Select active staff user</option>
                {candidates.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.firstName} {user.lastName} ({user.username})
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Employee number" required>
              <input
                required
                className={INPUT}
                value={officerForm.employeeNumber}
                onChange={(e) =>
                  setOfficerForm({
                    ...officerForm,
                    employeeNumber: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Phone number" required>
              <input
                required
                className={INPUT}
                value={officerForm.phoneNumber}
                onChange={(e) =>
                  setOfficerForm({
                    ...officerForm,
                    phoneNumber: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Home zone">
              <SearchableSelect
                className={INPUT}
                value={officerForm.homeZoneId}
                onChange={(e) =>
                  setOfficerForm({ ...officerForm, homeZoneId: e.target.value })
                }
              >
                <option value="">No home zone</option>
                {zones.map((zone) => (
                  <option key={zone.zoneId} value={zone.zoneId}>
                    {zone.zoneName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <div className="md:col-span-4 flex justify-end">
              <Button tone="green">Create reader profile</Button>
            </div>
          </form>
        </Card>
      )}

      <form onSubmit={submitAssignments}>
        <Card className="mb-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-aqua-700">
                Bulk assignment planner
              </p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">
                Build the route workload
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Apply one reader to several routes, or select a different reader
                on each route.
              </p>
            </div>
            <div className="flex gap-2">
              <div className="rounded-xl bg-aqua-50 px-4 py-2 text-center">
                <strong className="block text-lg text-aqua-800">
                  {selected.length}
                </strong>
                <span className="text-xs font-semibold text-aqua-700">
                  Selected
                </span>
              </div>
              <div className="rounded-xl bg-emerald-50 px-4 py-2 text-center">
                <strong className="block text-lg text-emerald-800">
                  {activeAssignments.length}
                </strong>
                <span className="text-xs font-semibold text-emerald-700">
                  Assigned
                </span>
              </div>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            <Field label="Reading cycle" required>
              <SearchableSelect
                required
                className={INPUT}
                value={cycleId}
                onChange={(e) => {
                  setCycleId(e.target.value);
                  setSelected([]);
                  setReaderByRoute({});
                  setSuccess("");
                }}
              >
                <option value="">Select cycle</option>
                {cycles
                  .filter((cycle) =>
                    ["PLANNED", "OPEN"].includes(cycle.status),
                  )
                  .map((cycle) => (
                    <option
                      key={cycle.readingCycleId}
                      value={cycle.readingCycleId}
                    >
                      {cycle.cycleCode} — {cycle.cycleName}
                    </option>
                  ))}
              </SearchableSelect>
            </Field>
            <Field label="Assigned date">
              <DateInput
                className={INPUT}
                value={assignedDate}
                onChange={(e) => setAssignedDate(e.target.value)}
              />
            </Field>
            <Field label="Reader for selected routes">
              <SearchableSelect
                className={INPUT}
                value={bulkReader}
                onChange={(e) => setBulkReader(e.target.value)}
              >
                <option value="">Choose meter reader</option>
                {officers.map((reader) => (
                  <option
                    key={reader.fieldOfficerId}
                    value={reader.fieldOfficerId}
                  >
                    {reader.officerName} — {reader.employeeNumber}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <div className="flex items-end">
              <CycleActionButton
                className="w-full"
                tone="primary"
                disabled={!bulkReader || !selected.length}
                onClick={applyReader}
              >
                Apply to {selected.length} selected
              </CycleActionButton>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/80 p-3 md:grid-cols-[1fr_240px]">
              <input
                className={INPUT}
                value={routeSearch}
                onChange={(e) => setRouteSearch(e.target.value)}
                placeholder="Search route name, code or zone"
              />
              <SearchableSelect
                className={INPUT}
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                <option value="">All zones</option>
                {zones.map((zone) => (
                  <option key={zone.zoneId} value={zone.zoneId}>
                    {zone.zoneName}
                  </option>
                ))}
              </SearchableSelect>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={`${TH} w-12`}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleVisible}
                        aria-label="Select all available routes on this page"
                      />
                    </th>
                    <th className={TH}>Zone / route</th>
                    <th className={TH}>Workload</th>
                    <th className={TH}>Status</th>
                    <th className={`${TH} min-w-[280px]`}>Meter reader</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRoutes.map((route) => {
                    const id = String(route.routeId);
                    const existing = assignedByRoute.get(id);
                    const isSelected = selected.includes(id);
                    const workload =
                      route.estimatedCustomers ??
                      Number(route._count?.accounts ?? 0) +
                        Number(route._count?.properties ?? 0);
                    return (
                      <tr
                        key={id}
                        className={`border-t border-slate-100 transition ${
                          isSelected ? "bg-aqua-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className={TD}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={Boolean(existing)}
                            onChange={() => toggleRoute(id)}
                            aria-label={`Select ${route.routeName}`}
                          />
                        </td>
                        <td className={TD}>
                          <p className="font-semibold text-slate-900">
                            {route.routeName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {route.zone?.zoneName ?? "No zone"} ·{" "}
                            {route.routeCode}
                          </p>
                        </td>
                        <td className={TD}>
                          <span className="font-semibold text-slate-800">
                            {workload || "—"}
                          </span>{" "}
                          <span className="text-xs text-slate-400">accounts</span>
                        </td>
                        <td className={TD}>
                          {existing ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              {existing.officerName}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                              Available
                            </span>
                          )}
                        </td>
                        <td className={TD}>
                          <SearchableSelect
                            className={INPUT}
                            value={readerByRoute[id] ?? ""}
                            disabled={Boolean(existing)}
                            onChange={(e) => {
                              const value = e.target.value;
                              setReaderByRoute((current) => ({
                                ...current,
                                [id]: value,
                              }));
                              if (value && !isSelected)
                                setSelected((current) => [...current, id]);
                            }}
                          >
                            <option value="">Select reader for this route</option>
                            {officers.map((reader) => (
                              <option
                                key={reader.fieldOfficerId}
                                value={reader.fieldOfficerId}
                              >
                                {reader.officerName} — {reader.employeeNumber}
                              </option>
                            ))}
                          </SearchableSelect>
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleRoutes.length && (
                    <tr>
                      <td className={`${TD} py-10 text-center`} colSpan={5}>
                        No routes match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <p className="text-xs font-medium text-slate-500">
                Showing{" "}
                {filteredRoutes.length
                  ? (routePage - 1) * routePageSize + 1
                  : 0}
                –{Math.min(routePage * routePageSize, filteredRoutes.length)} of{" "}
                {filteredRoutes.length} routes
              </p>
              <Paging
                page={routePage}
                pages={routePages}
                setPage={setRoutePage}
              />
            </div>
          </div>
          <div className="mt-4 grid items-end gap-3 lg:grid-cols-[1fr_auto]">
            <Field label="Assignment note (optional)">
              <input
                className={INPUT}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Instructions shared across this assignment batch"
              />
            </Field>
            <Button
              tone="green"
              className="min-w-56"
              disabled={saving || !selected.length}
            >
              {saving
                ? "Assigning routes…"
                : `Assign ${selected.length} route(s)`}
            </Button>
          </div>
        </Card>
      </form>

      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Assignment register
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {filteredAssignments.length} assignment(s) in the selected cycle
            </p>
          </div>
          <input
            className={`${INPUT} max-w-sm`}
            value={registerSearch}
            onChange={(e) => setRegisterSearch(e.target.value)}
            placeholder="Search route, zone, reader or status"
          />
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">
            Showing{" "}
            {filteredAssignments.length
              ? (registerPage - 1) * registerPageSize + 1
              : 0}
            –
            {Math.min(
              registerPage * registerPageSize,
              filteredAssignments.length,
            )}{" "}
            of {filteredAssignments.length}
          </p>
          <Paging
            page={registerPage}
            pages={registerPages}
            setPage={setRegisterPage}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Cycle</th>
                <th className={TH}>Zone / route</th>
                <th className={TH}>Meter reader</th>
                <th className={TH}>Assigned</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleAssignments.map((assignment) => (
                <tr
                  key={assignment.routeAssignmentId}
                  className="border-t border-slate-100 transition hover:bg-slate-50"
                >
                  <td className={TD}>
                    <p className="font-semibold text-slate-900">
                      {assignment.cycle?.cycleName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {assignment.cycle?.cycleCode}
                    </p>
                  </td>
                  <td className={TD}>
                    <p className="font-semibold text-slate-800">
                      {assignment.route?.routeName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {assignment.route?.zone?.zoneName ?? "No zone"}
                    </p>
                  </td>
                  <td className={TD}>
                    <p className="font-semibold text-slate-800">
                      {assignment.officerName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {assignment.fieldOfficer?.employeeNumber}
                    </p>
                  </td>
                  <td className={TD}>{date(assignment.assignedDate)}</td>
                  <td className={TD}>
                    <Badge value={assignment.status} />
                  </td>
                  <td className={TD}>
                    {assignment.status !== "COMPLETED" && (
                      <CycleActionButton
                        tone="success"
                        onClick={async () => {
                          try {
                            await api.updateRouteAssignmentStatus(
                              String(assignment.routeAssignmentId),
                              "COMPLETED",
                            );
                            await load(cycleId);
                          } catch (e: any) {
                            setError(e.message);
                          }
                        }}
                      >
                        Complete
                      </CycleActionButton>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && !visibleAssignments.length && (
                <tr>
                  <td className={`${TD} py-10 text-center`} colSpan={6}>
                    No route assignments match this view.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td className={`${TD} py-10 text-center`} colSpan={6}>
                    Loading assignments…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-500">
            Page {registerPage} of {registerPages}
          </p>
          <Paging
            page={registerPage}
            pages={registerPages}
            setPage={setRegisterPage}
          />
        </div>
      </Card>
    </Page>
  );
}

export function ReadingRouteAssignments() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Row[]>([]);
  const [officers, setOfficers] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [registerSearch, setRegisterSearch] = useState("");
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [selectedOfficerIds, setSelectedOfficerIds] = useState<string[]>([]);
  const [showOfficer, setShowOfficer] = useState(false);
  const [form, setForm] = useState({
    readingCycleId: "",
    assignedDate: new Date().toISOString().slice(0, 10),
    remarks: "",
  });
  const [officer, setOfficer] = useState({
    userId: "",
    employeeNumber: "",
    phoneNumber: "",
    homeZoneId: "",
  });
  const [zones, setZones] = useState<Row[]>([]);
  const load = async () => {
    try {
      const [c, r, o, a, s, z] = await Promise.all([
        api.listReadingCycles(),
        api.listRoutes(),
        api.listReadingOfficers(),
        api.listRouteAssignments(form.readingCycleId),
        api.listReadingStaffCandidates(),
        api.listZones(),
      ]);
      setCycles(c);
      setRoutes(r);
      setOfficers(o);
      setItems(a);
      setCandidates(s);
      setZones(z);
      if (!form.readingCycleId) {
        const active = c.find((x: Row) => x.status === "OPEN") ?? c[0];
        if (active)
          setForm((f) => ({
            ...f,
            readingCycleId: String(active.readingCycleId),
          }));
      }
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [form.readingCycleId]);
  async function assign(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!selectedRouteIds.length)
      return setError("Select at least one route.");
    if (!selectedOfficerIds.length)
      return setError("Select at least one meter reader.");
    setSaving(true);
    try {
      const result = await api.assignReadingRoutesBulk({
        readingCycleId: form.readingCycleId,
        assignedDate: form.assignedDate,
        remarks: form.remarks || undefined,
        assignments: selectedRouteIds.map((routeId, index) => ({
          routeId,
          fieldOfficerId:
            selectedOfficerIds[index % selectedOfficerIds.length],
        })),
      });
      setSuccess(`${result.created} route assignment(s) created successfully.`);
      setSelectedRouteIds([]);
      setSelectedOfficerIds([]);
      await load();
      setForm({ ...form, remarks: "" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function createOfficer(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createReadingOfficer({
        ...officer,
        homeZoneId: officer.homeZoneId || undefined,
      });
      setShowOfficer(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const assignedCount = items.filter((assignment) => ["ASSIGNED", "ACCEPTED"].includes(assignment.status)).length;
  const completedCount = items.filter((assignment) => assignment.status === "COMPLETED").length;
  const filteredAssignments = items.filter((assignment) => {
    const query = registerSearch.trim().toLowerCase();
    return !query || [assignment.cycle?.cycleName, assignment.route?.zone?.zoneName, assignment.route?.routeName, assignment.route?.routeCode, assignment.officerName, assignment.status]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  return (
    <Page
      title="Route assignments"
      subtitle="Allocate reading routes to field officers for each cycle"
      actions={
        <Button onClick={() => setShowOfficer(!showOfficer)}>
          {showOfficer ? "Close reader form" : "Add meter reader"}
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      {success && <Notice tone="green">{success}</Notice>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-slate-500">Reading routes</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{routes.length}</div></div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-sky-700">Active assignments</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{assignedCount}</div></div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-violet-700">Meter readers</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{officers.length}</div></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Completed</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{completedCount}</div></div>
      </div>
      {showOfficer && (
        <Card title="Create meter reader profile" className="mb-5 overflow-hidden shadow-md shadow-slate-200/50">
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="12" cy="8" r="3" /><path d="M6 20v-2a6 6 0 0 1 12 0v2" /></svg></span><div><div className="font-bold text-slate-800">Register a field officer</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Connect an active staff user to a meter-reader profile and optional home zone.</p></div></div>
          <form onSubmit={createOfficer} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Staff user" required>
              <SearchableSelect
                required
                className={INPUT}
                value={officer.userId}
                onChange={(e) => {
                  const user = candidates.find(
                    (x) => String(x.userId) === e.target.value,
                  );
                  setOfficer({
                    ...officer,
                    userId: e.target.value,
                    phoneNumber: user?.phoneNumber ?? officer.phoneNumber,
                  });
                }}
              >
                <option value="">Select active staff user</option>
                {candidates.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.firstName} {u.lastName} ({u.username})
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Employee number" required>
              <input
                required
                className={INPUT}
                value={officer.employeeNumber}
                onChange={(e) =>
                  setOfficer({ ...officer, employeeNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Phone number" required>
              <input
                required
                className={INPUT}
                value={officer.phoneNumber}
                onChange={(e) =>
                  setOfficer({ ...officer, phoneNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Home zone">
              <SearchableSelect
                className={INPUT}
                value={officer.homeZoneId}
                onChange={(e) =>
                  setOfficer({ ...officer, homeZoneId: e.target.value })
                }
              >
                <option value="">No home zone</option>
                {zones.map((z) => (
                  <option key={z.zoneId} value={z.zoneId}>
                    {z.zoneName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <div className="md:col-span-4 flex justify-end">
              <Button tone="green">Create reader profile</Button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Assign routes" className="relative z-20 mb-5 overflow-visible shadow-md shadow-slate-200/50">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/70 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M4 17l5-5 4 3 7-8" /><circle cx="4" cy="17" r="1" /><circle cx="20" cy="7" r="1" /></svg></span><div><div className="font-bold text-slate-800">Build the route workload</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Select routes and readers; multiple routes are distributed between readers in order.</p></div></div>
        <form
          onSubmit={assign}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
        >
          <Field label="Reading cycle" required>
            <SearchableSelect
              required
              className={INPUT}
              value={form.readingCycleId}
              onChange={(e) => {
                setForm({ ...form, readingCycleId: e.target.value });
                setSelectedRouteIds([]);
                setSelectedOfficerIds([]);
              }}
            >
              <option value="">Select cycle</option>
              {cycles
                .filter((c) => ["PLANNED", "OPEN"].includes(c.status))
                .map((c) => (
                  <option key={c.readingCycleId} value={c.readingCycleId}>
                    {c.cycleName}
                  </option>
                ))}
            </SearchableSelect>
          </Field>
          <Field label="Routes" required>
            <MultiCheckDropdown
              placeholder="Select one or more routes"
              selected={selectedRouteIds}
              onChange={setSelectedRouteIds}
              options={routes
                .filter(
                  (route) =>
                    !items.some(
                      (assignment) =>
                        String(assignment.routeId) === String(route.routeId) &&
                        ["ASSIGNED", "ACCEPTED"].includes(assignment.status),
                    ),
                )
                .map((route) => ({
                  value: String(route.routeId),
                  label: route.routeName,
                  detail: `${route.zone?.zoneName ?? "No zone"} · ${route.routeCode}`,
                }))}
            />
          </Field>
          <Field label="Meter readers" required>
            <MultiCheckDropdown
              placeholder="Select one or more readers"
              selected={selectedOfficerIds}
              onChange={setSelectedOfficerIds}
              options={officers.map((reader) => ({
                value: String(reader.fieldOfficerId),
                label: reader.officerName,
                detail: `${reader.employeeNumber}${reader.homeZone?.zoneName ? ` · ${reader.homeZone.zoneName}` : ""}`,
              }))}
            />
          </Field>
          <Field label="Assigned date">
            <DateInput
              className={INPUT}
              value={form.assignedDate}
              onChange={(e) =>
                setForm({ ...form, assignedDate: e.target.value })
              }
            />
          </Field>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={
                saving ||
                !form.readingCycleId ||
                !selectedRouteIds.length ||
                !selectedOfficerIds.length
              }
            >
              {saving
                ? "Assigning…"
                : `Assign ${selectedRouteIds.length || 0} route(s)`}
            </Button>
          </div>
          {(selectedRouteIds.length > 0 || selectedOfficerIds.length > 0) && (
            <div className="md:col-span-2 xl:col-span-5 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-600 font-bold text-white">{selectedRouteIds.length}</span><span>{selectedRouteIds.length} route(s) and {selectedOfficerIds.length} reader(s) selected.
              {selectedOfficerIds.length > 1 &&
                " Routes will be distributed between the selected readers in order."}</span>
            </div>
          )}
        </form>
      </Card>
      <Card title="Assignment register" className="overflow-hidden shadow-md shadow-slate-200/50">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-slate-800">Route workload register</div><div className="mt-0.5 text-xs text-slate-500">Track assigned routes, field officers and completion status.</div></div><div className="relative sm:w-80"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input className={`${INPUT} rounded-xl pl-10 focus:ring-4`} placeholder="Search route, cycle or reader" value={registerSearch} onChange={(event) => setRegisterSearch(event.target.value)} /></div></div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="bg-slate-50/90">
                <th className={TH}>Cycle</th>
                <th className={TH}>Zone / Route</th>
                <th className={TH}>Officer</th>
                <th className={TH}>Assigned</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.map((a) => (
                <tr
                  key={a.routeAssignmentId}
                  className="border-t border-slate-100 transition hover:bg-sky-50/40"
                >
                  <td className={TD}>{a.cycle?.cycleName}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 17l5-5 4 3 7-8" /></svg></span><span><span className="block font-bold text-slate-800">{a.route?.routeName}</span><span className="mt-0.5 block text-xs text-slate-400">{a.route?.zone?.zoneName} · {a.route?.routeCode}</span></span></div>
                  </td>
                  <td className={TD}><span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-violet-50 text-xs font-bold text-violet-700">{String(a.officerName ?? "R").split(/\s+/).slice(0,2).map((part) => part[0]).join("")}</span><span className="font-semibold text-slate-700">{a.officerName}</span></span></td>
                  <td className={TD}>{date(a.assignedDate)}</td>
                  <td className={TD}>
                    <Badge value={a.status} />
                  </td>
                  <td className={TD}>
                    {a.status !== "COMPLETED" && (
                      <button
                        className="inline-flex rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                        onClick={async () => {
                          await api.updateRouteAssignmentStatus(
                            String(a.routeAssignmentId),
                            "COMPLETED",
                          );
                          load();
                        }}
                      >
                        Complete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!filteredAssignments.length && <tr><td colSpan={6} className="px-4 py-16 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M4 17l5-5 4 3 7-8" /></svg></div><div className="mt-4 font-bold text-slate-700">{items.length ? "No assignments match your search" : "No route assignments yet"}</div><div className="mt-1 text-sm text-slate-400">{items.length ? "Try another route, cycle or reader." : "Create assignments using the form above."}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function ReadingWorklist() {
  const [params, setParams] = useSearchParams();
  const [cycles, setCycles] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Row[]>([]);
  const [routeAssignments, setRouteAssignments] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [capturedInCycle, setCapturedInCycle] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [evidenceReading, setEvidenceReading] = useState<Row | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkRows, setBulkRows] = useState<
    { row: number; payload: Record<string, unknown> }[]
  >([]);
  const [bulkErrors, setBulkErrors] = useState<Record<string, unknown>[]>([]);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkSkipped, setBulkSkipped] = useState(0);
  const [bulkMessage, setBulkMessage] = useState("");
  const [inlineReadings, setInlineReadings] = useState<Record<string, string>>({});
  const [inlineSavingId, setInlineSavingId] = useState("");
  const [inlineMessage, setInlineMessage] = useState("");
  const [floatingRoute, setFloatingRoute] = useState("");
  const worklistTableRef = useRef<HTMLDivElement>(null);
  const [operation, setOperation] = useState("");
  const [operationProgress, setOperationProgress] = useState(0);
  const cycleId = params.get("cycleId") ?? "";
  const routeIdsParam = params.get("routeIds") ?? params.get("routeId") ?? "";
  const routeIds = useMemo(
    () =>
      Array.from(
        new Set(
          routeIdsParam
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ),
    [routeIdsParam],
  );
  const search = params.get("search") ?? "";
  const readingStatus = params.get("status") ?? "";
  const missedCycleId = params.get("missedCycleId") ?? "";
  const quickSearch = params.get("quickSearch") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const requestedPageSize = Number(params.get("pageSize") ?? "50");
  const pageSize = [10, 50, 200].includes(requestedPageSize)
    ? requestedPageSize
    : 50;
  const selectedCycle = cycles.find(
    (cycle) => String(cycle.readingCycleId) === cycleId,
  );
  const canCaptureReadings = selectedCycle?.status === "OPEN";
  const selectedCycleIsLocked = Boolean(
    selectedCycle && !canCaptureReadings,
  );
  const closedSourceCycles = cycles
    .filter((cycle) => {
      if (cycle.status !== "CLOSED" || String(cycle.readingCycleId) === cycleId)
        return false;
      if (!selectedCycle?.startDate || !cycle.endDate) return true;
      return new Date(cycle.endDate) <= new Date(selectedCycle.startDate);
    })
    .sort((left, right) => {
      const byEndDate =
        new Date(right.endDate).getTime() - new Date(left.endDate).getTime();
      return byEndDate ||
        String(right.readingCycleId).localeCompare(
          String(left.readingCycleId),
          undefined,
          { numeric: true },
        );
    });
  const previousClosedCycle = closedSourceCycles[0];
  const effectiveMissedCycleId = String(
    previousClosedCycle?.readingCycleId ?? "",
  );
  const selectedMissedCycle = previousClosedCycle;
  useEffect(() => {
    Promise.all([api.listReadingCycles(), api.listRoutes()])
      .then(([c, r]) => {
        setError("");
        setCycles(c);
        setRoutes(r);
        if (!cycleId) {
          const open = c.find((x: Row) => x.status === "OPEN");
          if (open) setParams({ cycleId: String(open.readingCycleId) });
        }
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (readingStatus !== "MISSED_CLOSED" || !cycles.length) return;
    if (missedCycleId === effectiveMissedCycleId) return;
    const next = new URLSearchParams(params);
    effectiveMissedCycleId
      ? next.set("missedCycleId", effectiveMissedCycleId)
      : next.delete("missedCycleId");
    next.delete("page");
    setParams(next, { replace: true });
  }, [
    readingStatus,
    cycles.length,
    missedCycleId,
    effectiveMissedCycleId,
  ]);
  useEffect(() => {
    if (!cycleId) {
      setRouteAssignments([]);
      return;
    }
    api
      .listRouteAssignments(cycleId)
      .then(setRouteAssignments)
      .catch((e) => setError(e.message));
  }, [cycleId]);
  useEffect(() => {
    if (!cycleId) {
      setItems([]);
      setCapturedInCycle(0);
      setLoading(false);
      return;
    }
    if (readingStatus === "MISSED_CLOSED" && !effectiveMissedCycleId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const worklistFilters = {
          cycleId,
          routeIds: routeIds.join(","),
          search: search.trim(),
          missedCycleId:
            readingStatus === "MISSED_CLOSED" ? effectiveMissedCycleId : "",
        };
      Promise.all([
        api.readingWorklist(worklistFilters),
        api.readingWorklistCapturedCount(worklistFilters),
      ])
        .then(([nextItems, capturedSummary]) => {
          if (cancelled) return;
          setError("");
          setItems(nextItems);
          setCapturedInCycle(Number(capturedSummary.count ?? 0));
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, search ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cycleId, routeIdsParam, search, readingStatus, effectiveMissedCycleId]);
  const selectedRoutes = routes.filter((route) =>
    routeIds.includes(String(route.routeId)),
  );
  const selectedRouteSummary =
    selectedRoutes.length === 0
      ? "All routes"
      : selectedRoutes.length <= 2
        ? selectedRoutes.map((route) => route.routeName).join(", ")
        : `${selectedRoutes.length.toLocaleString()} routes`;
  const capturedEligible = items.filter((item) => item.cycleReading).length;
  const unread = items.length - capturedEligible;
  const filteredItems = useMemo(() => {
    const quickTerm = quickSearch.trim().toLowerCase();
    const matchingItems = items.filter((item) => {
        if (readingStatus === "UNREAD") return !item.cycleReading;
        if (readingStatus === "MISSED_CLOSED")
          return !item.cycleReading && item.missedCycleUnread;
        if (readingStatus === "CAPTURED") return Boolean(item.cycleReading);
        return true;
      }).filter((item) => {
        if (!quickTerm) return true;
        return [
          item.account?.accountNumber,
          item.account?.customer?.customerNumber,
          item.customerName,
          item.meter?.meterNumber,
          item.meter?.serialNumber,
          item.route?.routeName,
          item.account?.customer?.phoneNumber,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(quickTerm));
      });
    return matchingItems.sort((left, right) => {
      const byRoute = String(
        left.route?.routeName ?? "Unassigned route",
      ).localeCompare(
        String(right.route?.routeName ?? "Unassigned route"),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      const byAccount = String(
        left.account?.accountNumber ?? "",
      ).localeCompare(String(right.account?.accountNumber ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return byRoute || byAccount ||
        String(left.meter?.meterNumber ?? "").localeCompare(
          String(right.meter?.meterNumber ?? ""),
          undefined,
          { numeric: true, sensitivity: "base" },
        );
    });
  }, [items, readingStatus, quickSearch]);

  async function exportWorklist(format: "excel" | "pdf") {
    if (!filteredItems.length || operation) return;
    setError("");
    setOperation(`Preparing ${format === "pdf" ? "PDF" : "Excel"} reading sheets`);
    setOperationProgress(10);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const exportItems = [...filteredItems].sort((left, right) => {
        const byAccount = String(
          left.account?.accountNumber ?? "",
        ).localeCompare(String(right.account?.accountNumber ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return byAccount ||
          String(left.meter?.meterNumber ?? "").localeCompare(
            String(right.meter?.meterNumber ?? ""),
            undefined,
            { numeric: true, sensitivity: "base" },
          );
      });
      const rows = exportItems.map((item, index) => ({
        "Serial Number": index + 1,
        "Account Number": item.account?.accountNumber ?? "",
        "Customer Names": item.customerName ?? "",
        "Previous Reading": Number(
          item.cycleReading?.previousReading ??
            item.meter?.readings?.[0]?.currentReading ??
            item.meter?.openingReading ??
            0,
        ),
        "Meter Reading": item.cycleReading
          ? Number(item.cycleReading.currentReading)
          : "",
        Comment: "",
      }));
      const activeAssignmentByRoute = new Map<string, Row>(
        routeAssignments
          .filter((assignment: Row) =>
            ["ASSIGNED", "ACCEPTED", "COMPLETED"].includes(assignment.status),
          )
          .map((assignment: Row): [string, Row] => [
            String(assignment.routeId),
            assignment,
          ]),
      );
      const groupedByZone = new Map<string, Row[]>();
      exportItems.forEach((item) => {
        const zoneName = String(
          item.zone?.zoneName ?? item.route?.zone?.zoneName ?? "Unassigned zone",
        );
        groupedByZone.set(zoneName, [...(groupedByZone.get(zoneName) ?? []), item]);
      });
      const zoneSheets = Array.from(groupedByZone.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([zoneName, zoneItems]) => {
          const areaNames = Array.from(
            new Set(
              zoneItems
                .map((item) => item.account?.property?.serviceArea?.areaName)
                .filter(Boolean),
            ),
          ).map(String);
          const assignments = Array.from(
            new Map<string, Row>(
              zoneItems
                .map((item) => activeAssignmentByRoute.get(String(item.route?.routeId)))
                .filter((assignment): assignment is Row => Boolean(assignment))
                .map((assignment): [string, Row] => [
                  String(assignment.routeId),
                  assignment,
                ]),
            ).values(),
          );
          const readerNames = Array.from(
            new Set(assignments.map((assignment) => assignment.officerName).filter(Boolean)),
          ).map(String);
          const assignedDates = Array.from(
            new Set(
              assignments
                .map((assignment) => String(assignment.assignedDate ?? "").slice(0, 10))
                .filter(Boolean),
            ),
          );
          return {
            zoneName,
            areaNames,
            readingCycle: String(
              selectedCycle?.cycleName ?? selectedCycle?.cycleCode ?? "",
            ),
            readingDate:
              assignedDates.join(", ") ||
              String(selectedCycle?.endDate ?? new Date().toISOString()).slice(0, 10),
            readerNames,
            rows: zoneItems.map((item) => {
              return {
                "Account Number": item.account?.accountNumber ?? "",
                "Customer Names": item.customerName ?? "",
                "Previous Reading": Number(
                  item.cycleReading?.previousReading ??
                    item.meter?.readings?.[0]?.currentReading ??
                    item.meter?.openingReading ??
                    0,
                ),
                "Meter Reading": item.cycleReading
                  ? Number(item.cycleReading.currentReading)
                  : "",
                Comment: "",
              };
            }),
          };
        });
      setOperationProgress(55);
      const cycleCode = selectedCycle?.cycleCode ?? `cycle-${cycleId}`;
      if (format === "pdf") {
        const sessionUser = getSessionUser();
        const printedBy =
          [sessionUser?.firstName, sessionUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          sessionUser?.username ||
          "Signed-in user";
        await exportMeterReadingZonePdf(
          `meter-reading-sheets-${cycleCode}.pdf`,
          zoneSheets,
          "/samdamte-water-logo-print.png",
          printedBy,
        );
      } else {
        await exportMeterReadingZoneWorkbook(
          `meter-reading-sheets-${cycleCode}.xlsx`,
          rows,
          zoneSheets,
        );
      }
      setOperationProgress(100);
    } catch (e: any) {
      setError(`Could not export the worklist: ${e.message}`);
    } finally {
      setOperation("");
      setOperationProgress(0);
    }
  }

  async function chooseBulkFile(file?: File) {
    if (!file || !cycleId) return;
    if (!canCaptureReadings) {
      setError(
        "This reading cycle is closed and cannot accept new readings. Create or select an open reading cycle first.",
      );
      return;
    }
    setBulkFileName(file.name);
    setBulkMessage("");
    setBulkRows([]);
    setBulkErrors([]);
    setBulkTotal(0);
    setBulkSkipped(0);
    setError("");
    setOperation("Reading and validating spreadsheet");
    setOperationProgress(5);
    try {
      const [records, eligibleItems] = await Promise.all([
        parseMeterWorkbook(file),
        api.readingWorklist({ cycleId }),
      ]);
      setBulkTotal(records.length);
      setOperationProgress(45);
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]/g, "");
      const cell = (record: Record<string, unknown>, ...names: string[]) => {
        const wanted = new Set(names.map(normalize));
        const entry = Object.entries(record).find(([key]) =>
          wanted.has(normalize(key)),
        );
        return entry?.[1];
      };
      const eligibleRows = eligibleItems as Row[];
      const byId = new Map<string, Row>(
        eligibleRows.map((item: Row) => [String(item.meterId), item]),
      );
      const byNumber = new Map<string, Row>(
        eligibleRows.map((item: Row) => [
          String(item.meter?.meterNumber ?? "").trim().toLowerCase(),
          item,
        ]),
      );
      const byAccount = new Map<string, Row>(
        eligibleRows.map((item: Row) => [
          String(item.account?.accountNumber ?? "").trim().toLowerCase(),
          item,
        ]),
      );
      const seen = new Set<string>();
      const valid: { row: number; payload: Record<string, unknown> }[] = [];
      const invalid: Record<string, unknown>[] = [];
      let skipped = 0;

      records.forEach((record, index) => {
        const row = index + 2;
        const meterIdValue = String(cell(record, "Meter ID", "meterId") ?? "").trim();
        const meterNumber = String(
          cell(record, "Meter Number", "meterNumber") ?? "",
        ).trim();
        const accountNumber = String(
          cell(record, "Account Number", "accountNumber") ?? "",
        ).trim();
        const item =
          (meterIdValue ? byId.get(meterIdValue) : undefined) ??
          (meterNumber ? byNumber.get(meterNumber.toLowerCase()) : undefined) ??
          (accountNumber ? byAccount.get(accountNumber.toLowerCase()) : undefined);
        const currentValue = cell(
          record,
          "Meter Reading",
          "Current Reading",
          "currentReading",
        );
        const currentIsBlank =
          currentValue === "" ||
          currentValue === null ||
          currentValue === undefined ||
          (typeof currentValue === "string" && !currentValue.trim());
        if (currentIsBlank) {
          skipped++;
          return;
        }
        const currentReading = Number(currentValue);
        const previousValue = cell(record, "Previous Reading", "previousReading");
        const expectedPrevious = item
          ? Number(
              item.meter?.readings?.[0]?.currentReading ??
                item.meter?.openingReading ??
                0,
            )
          : 0;
        const readingType = String(
          cell(record, "Reading Type", "readingType") ?? "ACTUAL",
        )
          .trim()
          .toUpperCase();
        const estimationReason = String(
          cell(record, "Estimation Reason", "estimationReason") ?? "",
        ).trim();
        const readingDateValue = String(
          cell(record, "Reading Date", "readingDate") ?? "",
        ).trim();
        const parsedDate = readingDateValue ? new Date(readingDateValue) : new Date();
        const key = item
          ? String(item.meterId)
          : meterNumber.toLowerCase() || accountNumber.toLowerCase();
        const errors: string[] = [];

        if (!meterIdValue && !meterNumber && !accountNumber)
          errors.push("Account number or meter number is required");
        else if (!item)
          errors.push("Meter is not eligible for the selected reading cycle");
        if (key && seen.has(key)) errors.push("Duplicate meter in spreadsheet");
        if (key) seen.add(key);
        if (item?.cycleReading)
          errors.push("A reading already exists for this meter and cycle");
        if (
          !Number.isFinite(currentReading) ||
          currentReading < 0
        )
          errors.push("Current Reading must be a number of zero or greater");
        if (
          previousValue !== "" &&
          previousValue !== null &&
          previousValue !== undefined &&
          (!Number.isFinite(Number(previousValue)) ||
            Math.abs(Number(previousValue) - expectedPrevious) > 0.001)
        )
          errors.push(`Previous Reading has changed to ${expectedPrevious}`);
        if (!(["ACTUAL", "ESTIMATED", "SMART"] as string[]).includes(readingType))
          errors.push("Reading Type must be ACTUAL, ESTIMATED or SMART");
        if (readingType === "ESTIMATED" && estimationReason.length < 3)
          errors.push("Estimation Reason is required for estimated readings");
        if (Number.isNaN(parsedDate.getTime())) errors.push("Reading Date is invalid");

        if (errors.length || !item) {
          invalid.push({
            Row: row,
            "Meter Number": meterNumber || item?.meter?.meterNumber || "",
            Errors: errors.join("; "),
          });
          return;
        }
        valid.push({
          row,
          payload: {
            meterId: String(item.meterId),
            readingCycleId: cycleId,
            previousReading: expectedPrevious,
            currentReading,
            readingType,
            ...(estimationReason ? { estimationReason } : {}),
            readingDate: parsedDate.toISOString(),
            remarks: String(
              cell(record, "Comment", "Remarks", "remarks") ?? "",
            ).trim(),
            exceptionType: "NONE",
            syncId: `excel-${cycleId}-${String(item.meterId)}`,
            evidence: [],
          },
        });
      });
      setBulkRows(valid);
      setBulkErrors(invalid);
      setBulkSkipped(skipped);
      setOperationProgress(100);
      if (!records.length) setError("The spreadsheet contains no reading records.");
    } catch (e: any) {
      setError(`Could not process the spreadsheet: ${e.message}`);
    } finally {
      setOperation("");
      setOperationProgress(0);
    }
  }

  async function importBulkReadings() {
    if (!bulkRows.length || operation) return;
    if (!canCaptureReadings) {
      setError(
        "This reading cycle is closed and cannot accept new readings. Create or select an open reading cycle first.",
      );
      return;
    }
    setError("");
    setBulkMessage("");
    setOperation("Importing meter readings");
    setOperationProgress(0);
    const runtimeErrors: Record<string, unknown>[] = [];
    let succeeded = 0;
    try {
      for (let offset = 0; offset < bulkRows.length; offset += 100) {
        const chunk = bulkRows.slice(offset, offset + 100);
        const result = await api.syncReadings(chunk.map((item) => item.payload));
        result.results.forEach((rowResult: Row) => {
          if (rowResult.ok) succeeded++;
          else {
            const source = chunk[rowResult.index];
            runtimeErrors.push({
              Row: source?.row ?? "",
              "Meter Number": source?.payload?.meterId ?? "",
              Errors: rowResult.error ?? "Import failed",
            });
          }
        });
        setOperationProgress(
          Math.round((Math.min(offset + chunk.length, bulkRows.length) / bulkRows.length) * 100),
        );
      }
      setBulkErrors((current) => [...current, ...runtimeErrors]);
      setBulkRows([]);
      setBulkMessage(
        `${succeeded.toLocaleString()} reading${succeeded === 1 ? "" : "s"} imported and sent for approval${runtimeErrors.length ? `; ${runtimeErrors.length.toLocaleString()} failed` : ""}.`,
      );
      if (succeeded > 0) {
        window.dispatchEvent(new Event("sidebar-counts:refresh"));
      }
      const refreshed = await api.readingWorklist({
        cycleId,
        routeIds: routeIds.join(","),
        search: search.trim(),
      });
      setItems(refreshed);
    } catch (e: any) {
      setError(`Bulk import stopped: ${e.message}. Completed chunks were retained.`);
    } finally {
      setOperation("");
      setOperationProgress(0);
    }
  }

  function previousReadingFor(item: Row) {
    return Number(
      item.meter?.readings?.[0]?.currentReading ??
        item.meter?.openingReading ??
        0,
    );
  }

  function inlineReadingIsValid(item: Row) {
    const rawValue = inlineReadings[String(item.meterId)] ?? "";
    const currentReading = Number(rawValue);
    return Boolean(rawValue.trim()) &&
      Number.isFinite(currentReading) &&
      currentReading >= previousReadingFor(item);
  }

  async function saveInlineReading(item: Row) {
    if (!canCaptureReadings || inlineSavingId) return;
    const meterKey = String(item.meterId);
    const rawValue = inlineReadings[meterKey] ?? "";
    const currentReading = Number(rawValue);
    const previousReading = previousReadingFor(item);
    if (!rawValue.trim() || !Number.isFinite(currentReading)) {
      setError("Enter a valid current reading before saving.");
      return;
    }
    if (currentReading < previousReading) {
      setError(
        `Current reading cannot be below the previous reading of ${number(previousReading)}.`,
      );
      return;
    }
    setInlineSavingId(meterKey);
    setError("");
    setInlineMessage("");
    try {
      const result = await api.captureReading({
        meterId: meterKey,
        readingCycleId: cycleId,
        previousReading,
        currentReading,
        readingType: "ACTUAL",
        readingDate: new Date().toISOString(),
        exceptionType: "NONE",
        syncId: `inline-${cycleId}-${meterKey}-${Date.now()}`,
        evidence: [],
      });
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
      setItems((current) =>
        current.map((row) =>
          String(row.meterId) === meterKey
            ? { ...row, cycleReading: result.reading }
            : row,
        ),
      );
      setInlineReadings((current) => {
        const next = { ...current };
        delete next[meterKey];
        return next;
      });
      setInlineMessage(
        `Reading ${number(currentReading)} saved for meter ${item.meter?.meterNumber ?? meterKey} and sent for approval.`,
      );
    } catch (e: any) {
      setError(e.message || "The reading could not be saved.");
    } finally {
      setInlineSavingId("");
    }
  }

  async function saveAllInlineReadings() {
    if (!canCaptureReadings || inlineSavingId) return;
    const enteredItems = items.filter((item) =>
      Boolean((inlineReadings[String(item.meterId)] ?? "").trim()),
    );
    const invalidItems = enteredItems.filter(
      (item) => !inlineReadingIsValid(item),
    );
    if (!enteredItems.length) return;
    if (invalidItems.length) {
      setError(
        `Correct ${invalidItems.length.toLocaleString()} invalid reading${invalidItems.length === 1 ? "" : "s"} before saving all.`,
      );
      return;
    }

    const pendingRows = enteredItems.map((item) => {
      const meterKey = String(item.meterId);
      return {
        item,
        meterKey,
        payload: {
          meterId: meterKey,
          readingCycleId: cycleId,
          previousReading: previousReadingFor(item),
          currentReading: Number(inlineReadings[meterKey]),
          readingType: "ACTUAL",
          readingDate: new Date().toISOString(),
          exceptionType: "NONE",
          syncId: `inline-bulk-${cycleId}-${meterKey}-${Date.now()}`,
          evidence: [],
        },
      };
    });
    const savedReadings = new Map<string, Row>();
    const failures: string[] = [];
    setInlineSavingId("ALL");
    setError("");
    setInlineMessage("");
    try {
      for (let offset = 0; offset < pendingRows.length; offset += 100) {
        const chunk = pendingRows.slice(offset, offset + 100);
        const result = await api.syncReadings(
          chunk.map((row) => row.payload),
        );
        result.results.forEach((rowResult: Row) => {
          const source = chunk[Number(rowResult.index)];
          if (!source) return;
          if (rowResult.ok && rowResult.reading) {
            savedReadings.set(source.meterKey, rowResult.reading);
          } else {
            failures.push(
              `${source.item.meter?.meterNumber ?? source.meterKey}: ${rowResult.error ?? "Save failed"}`,
            );
          }
        });
      }
    } catch (e: any) {
      failures.push(e.message || "Batch saving stopped unexpectedly");
    } finally {
      if (savedReadings.size) {
        setItems((current) =>
          current.map((row) => {
            const reading = savedReadings.get(String(row.meterId));
            return reading ? { ...row, cycleReading: reading } : row;
          }),
        );
        setInlineReadings((current) => {
          const next = { ...current };
          savedReadings.forEach((_reading, meterKey) => delete next[meterKey]);
          return next;
        });
        setInlineMessage(
          `${savedReadings.size.toLocaleString()} reading${savedReadings.size === 1 ? "" : "s"} saved and sent for approval.`,
        );
        window.dispatchEvent(new Event("sidebar-counts:refresh"));
      }
      if (failures.length) {
        setError(
          `${failures.length.toLocaleString()} reading${failures.length === 1 ? "" : "s"} could not be saved. ${failures.slice(0, 3).join("; ")}`,
        );
      }
      setInlineSavingId("");
    }
  }

  const enteredInlineItems = items.filter((item) =>
    Boolean((inlineReadings[String(item.meterId)] ?? "").trim()),
  );
  const invalidInlineCount = enteredInlineItems.filter(
    (item) => !inlineReadingIsValid(item),
  ).length;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = filteredItems.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  useEffect(() => {
    const container = worklistTableRef.current;
    const scrollRoot = container?.closest(".app-content") as HTMLElement | null;
    if (!container || !scrollRoot) return;
    let frame = 0;
    const updateFloatingRoute = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rootTop = scrollRoot.getBoundingClientRect().top;
        const tableRect = container.getBoundingClientRect();
        if (tableRect.top >= rootTop || tableRect.bottom <= rootTop + 44) {
          setFloatingRoute("");
          return;
        }
        const headers = Array.from(
          container.querySelectorAll<HTMLElement>("[data-worklist-route]"),
        );
        let activeRoute = headers[0]?.dataset.worklistRoute ?? "";
        for (const header of headers) {
          if (header.getBoundingClientRect().top <= rootTop + 1) {
            activeRoute = header.dataset.worklistRoute ?? activeRoute;
          } else {
            break;
          }
        }
        setFloatingRoute((current) =>
          current === activeRoute ? current : activeRoute,
        );
      });
    };
    updateFloatingRoute();
    scrollRoot.addEventListener("scroll", updateFloatingRoute, { passive: true });
    window.addEventListener("resize", updateFloatingRoute);
    return () => {
      window.cancelAnimationFrame(frame);
      scrollRoot.removeEventListener("scroll", updateFloatingRoute);
      window.removeEventListener("resize", updateFloatingRoute);
    };
  }, [page, pageSize, quickSearch, readingStatus, routeIdsParam, filteredItems.length]);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [page, totalPages]);

  useEffect(() => {
    if (page <= totalPages) return;
    const next = new URLSearchParams(params);
    totalPages > 1 ? next.set("page", String(totalPages)) : next.delete("page");
    setParams(next, { replace: true });
  }, [page, totalPages]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next);
  };

  const updateReadingStatus = (value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set("status", value) : next.delete("status");
    if (value === "MISSED_CLOSED") {
      const sourceId = effectiveMissedCycleId;
      sourceId
        ? next.set("missedCycleId", sourceId)
        : next.delete("missedCycleId");
    } else {
      next.delete("missedCycleId");
    }
    next.delete("page");
    setParams(next);
  };

  const updateReadingCycle = (value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set("cycleId", value) : next.delete("cycleId");
    if (readingStatus === "MISSED_CLOSED") {
      const target = cycles.find(
        (cycle) => String(cycle.readingCycleId) === value,
      );
      const sources = cycles
        .filter(
          (cycle) =>
            cycle.status === "CLOSED" &&
            String(cycle.readingCycleId) !== value &&
            (!target?.startDate ||
              !cycle.endDate ||
              new Date(cycle.endDate) <= new Date(target.startDate)),
        )
        .sort(
          (left, right) =>
            new Date(right.endDate).getTime() -
              new Date(left.endDate).getTime() ||
            String(right.readingCycleId).localeCompare(
              String(left.readingCycleId),
              undefined,
              { numeric: true },
            ),
        );
      const previousSourceId = String(sources[0]?.readingCycleId ?? "");
      previousSourceId
        ? next.set("missedCycleId", previousSourceId)
        : next.delete("missedCycleId");
    }
    next.delete("page");
    setParams(next);
  };

  const updateQuickSearch = (value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set("quickSearch", value) : next.delete("quickSearch");
    next.delete("page");
    setParams(next, { replace: true });
  };

  const updatePageSize = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("pageSize", String(value));
    next.delete("page");
    setParams(next);
  };

  const updateRoutes = (values: string[]) => {
    const next = new URLSearchParams(params);
    next.delete("routeId");
    values.length
      ? next.set("routeIds", values.join(","))
      : next.delete("routeIds");
    next.delete("page");
    setParams(next);
  };

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(params);
    nextPage > 1 ? next.set("page", String(nextPage)) : next.delete("page");
    setParams(next);
  };

  useEffect(() => {
    if (!selectedCycleIsLocked) return;
    setShowBulkUpload(false);
    setBulkRows([]);
    setBulkErrors([]);
    setBulkFileName("");
    setBulkMessage("");
  }, [selectedCycleIsLocked, cycleId]);

  useEffect(() => {
    setInlineReadings({});
    setInlineMessage("");
  }, [cycleId]);

  const Pagination = ({ position }: { position: "top" | "bottom" }) => (
    <nav
      className="flex flex-wrap items-center justify-between gap-3"
      aria-label={`Worklist ${position} pagination`}
    >
      <p className="text-xs font-medium text-slate-500">
        {filteredItems.length
          ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(
              page * pageSize,
              filteredItems.length,
            )} of ${filteredItems.length.toLocaleString()} meters`
          : "No meters to display"}
      </p>
      <div className="flex items-center gap-1">
        <label className="mr-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="hidden sm:inline">Rows</span>
          <select
            value={pageSize}
            onChange={(event) => updatePageSize(Number(event.target.value))}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            aria-label="Rows per page"
          >
            <option value={10}>10</option>
            <option value={50}>50</option>
            <option value={200}>200</option>
          </select>
        </label>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">‹</span> Previous
        </button>
        <div className="hidden items-center gap-1 sm:flex">
          {pageNumbers.map((pageNumber) => (
            <button
              type="button"
              key={`${position}-${pageNumber}`}
              aria-current={pageNumber === page ? "page" : undefined}
              onClick={() => goToPage(pageNumber)}
              className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-bold transition ${
                pageNumber === page
                  ? "border-aqua-700 bg-aqua-700 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50"
              }`}
            >
              {pageNumber}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => goToPage(page + 1)}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <span aria-hidden="true">›</span>
        </button>
      </div>
    </nav>
  );
  return (
    <Page
      title="Meter reading worklist"
      subtitle="Review route workloads and capture customer meter readings"
      actions={
        <>
          <Button
            tone="slate"
            disabled={!cycleId || !filteredItems.length || Boolean(operation)}
            onClick={() => exportWorklist("excel")}
          >
            Export Excel
          </Button>
          <Button
            tone="blue"
            disabled={!cycleId || !filteredItems.length || Boolean(operation)}
            onClick={() => exportWorklist("pdf")}
          >
            Export PDF
          </Button>
          <Button
            tone="green"
            className="inline-flex items-center gap-2"
            disabled={!cycleId || !canCaptureReadings || Boolean(operation)}
            onClick={() => setShowBulkUpload((visible) => !visible)}
          >
            <span>{showBulkUpload ? "Close bulk upload" : "Bulk upload readings"}</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
              Current cycle
            </span>
          </Button>
          <LinkButton to="/readings/register">Reading register</LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {inlineMessage && <Notice tone="green">{inlineMessage}</Notice>}
      {canCaptureReadings && filteredItems.some((item) => !item.cycleReading) && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-[calc(100vw-3rem)] items-center gap-4 rounded-2xl border border-emerald-200 bg-white p-3 shadow-[0_20px_60px_-18px_rgba(15,118,110,0.55)]">
          <div className="min-w-0 pl-1">
            <div className="text-sm font-extrabold text-slate-900">
              {enteredInlineItems.length.toLocaleString()} reading
              {enteredInlineItems.length === 1 ? "" : "s"} entered
            </div>
            <div className={`text-xs font-semibold ${invalidInlineCount ? "text-red-600" : "text-emerald-700"}`}>
              {invalidInlineCount
                ? `${invalidInlineCount.toLocaleString()} need correction`
                : enteredInlineItems.length
                  ? "Ready to save and send for approval"
                  : "Enter readings in the rows above"}
            </div>
          </div>
          <button
            type="button"
            disabled={
              Boolean(inlineSavingId) ||
              invalidInlineCount > 0 ||
              enteredInlineItems.length === 0
            }
            onClick={() => void saveAllInlineReadings()}
            className="inline-flex min-w-32 flex-none items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {inlineSavingId === "ALL"
              ? "Saving all…"
              : enteredInlineItems.length
                ? `Save all ${enteredInlineItems.length.toLocaleString()}`
                : "Save all"}
          </button>
        </div>
      )}
      {selectedCycleIsLocked && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950 shadow-sm">
          <div>
            <div className="font-extrabold">Reading capture is locked for this cycle</div>
            <p className="mt-1 text-sm text-amber-800">
              {selectedCycle?.cycleName} is {String(selectedCycle?.status).toLowerCase()}.
              Its unread meters are retained for reference, but readings cannot be added after closure.
              Create or select an open reading cycle to continue capturing readings.
            </p>
          </div>
          <Link
            to="/readings/cycles"
            className="inline-flex flex-none items-center rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
          >
            Create reading cycle
          </Link>
        </section>
      )}
      {operation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]">
          <div
            className="w-full max-w-md rounded-2xl border border-white/50 bg-white p-6 shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-4">
              <span className="h-10 w-10 flex-none animate-spin rounded-full border-4 border-sky-100 border-t-aqua-700" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900">{operation}</div>
                <div className="mt-1 text-sm text-slate-500">
                  Please keep this page open while the operation completes.
                </div>
              </div>
              <span className="text-sm font-extrabold tabular-nums text-aqua-700">
                {operationProgress}%
              </span>
            </div>
            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-[width] duration-300"
                style={{ width: `${Math.max(operationProgress, 4)}%` }}
              />
            </div>
          </div>
        </div>
      )}
      {showBulkUpload && canCaptureReadings && (
        <section className="mb-4 overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]">
          <div className="border-b border-slate-100 bg-sky-50/60 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-slate-900">Bulk Excel reading upload</h2>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-800">
                Operational
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              For routine readings in the selected active cycle. Export the worklist, fill in Current Reading, then validate and import the completed file. Uploaded readings are sent for approval in safe batches of 100.
            </p>
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <Field label="Completed Excel or CSV file" required>
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className={INPUT}
                disabled={Boolean(operation)}
                onChange={(e) => chooseBulkFile(e.target.files?.[0])}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="green"
                disabled={!bulkRows.length || Boolean(operation)}
                onClick={importBulkReadings}
              >
                Import {bulkRows.length.toLocaleString()} valid reading
                {bulkRows.length === 1 ? "" : "s"}
              </Button>
              {bulkErrors.length > 0 && (
                <Button
                  tone="slate"
                  disabled={Boolean(operation)}
                  onClick={() =>
                    exportExcel(
                      "meter-reading-import-errors.xlsx",
                      "Import Errors",
                      bulkErrors,
                    )
                  }
                >
                  Export errors
                </Button>
              )}
            </div>
          </div>
          {(bulkFileName || bulkMessage) && (
            <div className="border-t border-slate-100 px-5 py-4">
              {bulkFileName && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-slate-400">File rows</div>
                    <div className="mt-1 text-xl font-extrabold text-slate-900">{bulkTotal.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-emerald-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-emerald-600">Ready to import</div>
                    <div className="mt-1 text-xl font-extrabold text-emerald-700">{bulkRows.length.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-amber-600">Not completed</div>
                    <div className="mt-1 text-xl font-extrabold text-amber-700">{bulkSkipped.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-red-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-red-500">Validation errors</div>
                    <div className="mt-1 text-xl font-extrabold text-red-700">{bulkErrors.length.toLocaleString()}</div>
                  </div>
                </div>
              )}
              {bulkErrors.length > 0 && (
                <div className="mt-3 max-h-28 overflow-y-auto rounded-xl border border-red-100 bg-red-50/60 px-4 py-3 text-sm text-red-700">
                  {bulkErrors.slice(0, 20).map((row, index) => (
                    <div key={`${String(row.Row)}-${index}`}>
                      Row {String(row.Row)}: {String(row.Errors)}
                    </div>
                  ))}
                  {bulkErrors.length > 20 && (
                    <div className="mt-1 font-semibold">Download the error report to see all errors.</div>
                  )}
                </div>
              )}
              {bulkMessage && (
                <div className="mt-3">
                  <Notice tone="green">{bulkMessage}</Notice>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      <section
        id="reading-worklist-filters"
        className="mb-4 scroll-mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]"
      >
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Reading cycle">
            <SearchableSelect
              className={INPUT}
              value={cycleId}
              onChange={(e) => updateReadingCycle(e.target.value)}
            >
              <option value="">Select cycle</option>
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName} ({pretty(c.status)})
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Status">
            <SearchableSelect
              className={INPUT}
              value={readingStatus}
              onChange={(e) => updateReadingStatus(e.target.value)}
            >
              <option value="">All meters</option>
              <option value="UNREAD">Unread</option>
              <option value="MISSED_CLOSED">Unread from a closed cycle</option>
              <option value="CAPTURED">Captured</option>
            </SearchableSelect>
          </Field>
          {readingStatus === "MISSED_CLOSED" && (
            <Field label="Previous closed cycle (automatic)">
              <SearchableSelect
                className={INPUT}
                value={effectiveMissedCycleId}
                disabled
              >
                <option value="">No previous closed cycle</option>
                {previousClosedCycle && (
                  <option value={previousClosedCycle.readingCycleId}>
                    {previousClosedCycle.cycleName}
                  </option>
                )}
              </SearchableSelect>
            </Field>
          )}
          <Field label="Route">
            <CheckboxMultiSelect
              className={INPUT}
              value={routeIds}
              onChange={updateRoutes}
              placeholder="All routes"
              options={routes.map((route) => ({
                value: String(route.routeId),
                label: route.routeName,
              }))}
            />
          </Field>
          <Field label="Search">
            <input
              className={INPUT}
              value={search}
              onChange={(e) => update("search", e.target.value)}
              placeholder="Exact meter/account, customer no., name or phone"
            />
          </Field>
        </div>
        <div className="grid border-t border-slate-100 bg-slate-50/70 sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
          <div className="px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Selected workload
            </div>
            <div className="mt-1 truncate text-sm font-bold text-slate-800">
              {selectedCycle?.cycleName ?? "Select a reading cycle"}
              {` · ${selectedRouteSummary}`}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Unread meters
            </div>
            <div className="mt-1 text-lg font-extrabold text-orange-600">
              {unread.toLocaleString()}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Captured in this cycle
            </div>
            <div className="mt-1 text-lg font-extrabold text-emerald-600">
              {capturedInCycle.toLocaleString()}
            </div>
          </div>
        </div>
      </section>

      {floatingRoute && (
        <div className="pointer-events-none sticky top-0 z-40 h-0 overflow-visible">
          <div className="flex h-11 items-center gap-2 border-y border-sky-200 bg-sky-50 px-5 shadow-[0_10px_24px_-16px_rgba(15,32,56,0.75)]">
            <span className="rounded-md bg-aqua-700 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
              Route
            </span>
            <span className="truncate text-sm font-extrabold text-aqua-900">
              {floatingRoute}
            </span>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Route worklist</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {filteredItems.length.toLocaleString()} {readingStatus === "MISSED_CLOSED"
                  ? `meter${filteredItems.length === 1 ? "" : "s"} unread in ${selectedMissedCycle?.cycleName ?? "the selected closed cycle"}`
                  : `eligible meter${filteredItems.length === 1 ? "" : "s"}`} · Page {page} of{" "}
                {totalPages}
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={quickSearch}
                onChange={(event) => updateQuickSearch(event.target.value)}
                placeholder="Quick search this worklist"
                aria-label="Quick search route worklist"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
              />
            </div>
          </div>
          <Pagination position="top" />
        </div>
        <div ref={worklistTableRef} className="overflow-x-auto xl:overflow-visible">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-slate-50/80">
              <tr>
                {[
                  "Account / Customer",
                  "Meter",
                  "Previous reading",
                  "Current reading",
                  "Status",
                  "Action",
                ].map((heading) => (
                  <th
                    key={heading}
                    className={`px-4 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 ${
                      heading === "Action" ? "text-right" : "text-left"
                    } ${heading === "Account / Customer" ? "pl-5" : ""}`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                      Loading route worklist…
                    </span>
                  </td>
                </tr>
              ) : pageItems.map((a, index) => (
                <Fragment key={a.assignmentId}>
                {(index === 0 ||
                  String(pageItems[index - 1]?.route?.routeName ?? "Unassigned route") !==
                    String(a.route?.routeName ?? "Unassigned route")) && (
                  <tr data-worklist-route={a.route?.routeName ?? "Unassigned route"}>
                    <td
                      colSpan={6}
                      className="border-y border-sky-200 bg-sky-50 px-5 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-aqua-700 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
                          Route
                        </span>
                        <span className="text-sm font-extrabold text-aqua-900">
                          {a.route?.routeName ?? "Unassigned route"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                <tr
                  className="group transition hover:bg-sky-50/40"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-50 to-violet-100 text-xs font-extrabold text-violet-700 ring-1 ring-violet-100">
                        {String(a.customerName || "Customer")
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                      <div>
                        <div className="font-bold text-slate-900">
                          {a.customerName || "Unnamed customer"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                          <span className="font-semibold text-aqua-700">
                            Customer: {a.account?.customer?.customerNumber ?? "—"}
                          </span>
                          <span className="text-slate-400">
                            Account: {a.account?.accountNumber ?? "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="font-bold text-slate-800">
                      {a.meter?.meterNumber}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                      <span>{a.meter?.meterType ?? "Customer meter"}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ring-1 ring-inset ${
                          a.meter?.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : a.meter?.status === "INACTIVE"
                              ? "bg-slate-100 text-slate-600 ring-slate-200"
                              : "bg-amber-50 text-amber-700 ring-amber-200"
                        }`}
                        title="Meter lifecycle status"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            a.meter?.status === "ACTIVE"
                              ? "bg-emerald-500"
                              : a.meter?.status === "INACTIVE"
                                ? "bg-slate-400"
                                : "bg-amber-500"
                          }`}
                        />
                        {pretty(a.meter?.status ?? "UNKNOWN")}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-bold tabular-nums text-slate-800">
                      {number(
                        a.cycleReading?.previousReading ??
                          a.meter?.readings?.[0]?.currentReading ??
                          a.meter?.openingReading,
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    {a.cycleReading ? (
                      <div>
                        <span
                          className={`font-extrabold tabular-nums ${
                            a.cycleReading.approvalStatus === "APPROVED"
                              ? "text-emerald-700"
                              : "text-amber-700"
                          }`}
                          title={
                            a.cycleReading.approvalStatus === "APPROVED"
                              ? "Approved current reading"
                              : `Captured current reading awaiting approval (${a.cycleReading.approvalStatus.toLowerCase()})`
                          }
                        >
                          {number(a.cycleReading.currentReading)}
                        </span>
                        <div className={`mt-0.5 text-[11px] font-semibold ${
                          a.cycleReading.approvalStatus === "APPROVED" ? "text-emerald-600" : "text-amber-600"
                        }`}>
                          {a.cycleReading.approvalStatus === "APPROVED" ? "Approved" : "Awaiting approval"}
                        </div>
                      </div>
                    ) : canCaptureReadings ? (
                      <div className="w-36">
                        <input
                          type="number"
                          min={previousReadingFor(a)}
                          step="0.001"
                          inputMode="decimal"
                          aria-label={`Current reading for meter ${a.meter?.meterNumber ?? a.meterId}`}
                          placeholder={`Min ${number(previousReadingFor(a))}`}
                          value={inlineReadings[String(a.meterId)] ?? ""}
                          disabled={Boolean(inlineSavingId)}
                          onChange={(event) => {
                            setError("");
                            setInlineMessage("");
                            setInlineReadings((current) => ({
                              ...current,
                              [String(a.meterId)]: event.target.value,
                            }));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && inlineReadingIsValid(a)) {
                              event.preventDefault();
                              void saveInlineReading(a);
                            }
                          }}
                          className={`h-10 w-full rounded-xl border bg-white px-3 text-sm font-bold tabular-nums text-slate-900 outline-none transition focus:ring-2 ${
                            Boolean(inlineReadings[String(a.meterId)] ?? "") &&
                            !inlineReadingIsValid(a)
                              ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                              : "border-slate-200 focus:border-sky-400 focus:ring-sky-100"
                          } disabled:cursor-wait disabled:bg-slate-50`}
                        />
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {a.cycleReading ? (
                      <Badge value={a.cycleReading.approvalStatus} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700 ring-1 ring-inset ring-orange-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                        Unread
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {a.cycleReading ? (
                      <div className="flex items-center justify-end gap-2">
                        {a.cycleReading.evidence?.length > 0 && (
                          <button
                            type="button"
                            className="inline-flex rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-aqua-700 transition hover:border-sky-300 hover:bg-sky-100"
                            onClick={() => setEvidenceReading({
                              ...a.cycleReading,
                              meter: a.meter,
                              account: a.account,
                            })}
                          >
                            View evidence
                          </button>
                        )}
                        <Link
                          className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-aqua-700 transition hover:border-sky-200 hover:bg-sky-50"
                          to={`/readings/register?search=${encodeURIComponent(a.meter.meterNumber)}`}
                        >
                          View reading
                        </Link>
                      </div>
                    ) : canCaptureReadings ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={Boolean(inlineSavingId) || !inlineReadingIsValid(a)}
                          onClick={() => void saveInlineReading(a)}
                          className="inline-flex min-w-20 items-center justify-center rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-200"
                        >
                          {inlineSavingId === String(a.meterId) ? "Saving…" : "Save"}
                        </button>
                        <Link
                          className="inline-flex rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-aqua-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50"
                          to={`/readings/capture?cycleId=${cycleId}&meterId=${a.meterId}`}
                        >
                          Full form
                        </Link>
                      </div>
                    ) : (
                      <span
                        className="inline-flex cursor-not-allowed rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-400 ring-1 ring-inset ring-slate-200"
                        title="Create or select an open reading cycle to capture this meter"
                      >
                        Capture locked
                      </span>
                    )}
                  </td>
                </tr>
                </Fragment>
              ))}
              {!loading && !filteredItems.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="font-semibold text-slate-700">
                      {quickSearch
                        ? `No meters match “${quickSearch}”`
                        : !cycleId
                        ? "Select a reading cycle"
                        : readingStatus === "UNREAD"
                        ? "No unread meters found"
                        : readingStatus === "MISSED_CLOSED"
                          ? `No unread meters found in ${selectedMissedCycle?.cycleName ?? "the selected closed cycle"}`
                        : readingStatus === "CAPTURED"
                          ? "No captured meters found"
                          : "No eligible meters found"}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {quickSearch
                        ? "Clear the quick search or try an account, meter, customer, phone or route."
                        : !cycleId
                        ? "Choose a cycle above to load its route worklist."
                        : "Change the status, cycle, route or search criteria and try again."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-4">
          <Pagination position="bottom" />
        </div>
      </section>
      {evidenceReading && (
        <ReadingEvidenceModal reading={evidenceReading} onClose={() => setEvidenceReading(null)} />
      )}
    </Page>
  );
}

async function fileEvidence(file?: File) {
  if (!file) return undefined;
  if (file.size > 4 * 1024 * 1024)
    throw new Error("Photo must be 4 MB or smaller");
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
  return {
    evidenceType: "METER_PHOTO",
    fileName: file.name,
    mimeType: file.type,
    content,
  };
}
export function CaptureReading() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cycleId = params.get("cycleId") ?? "";
  const meterId = params.get("meterId") ?? "";
  const [item, setItem] = useState<Row | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<Row | null>(null);
  const [officers, setOfficers] = useState<Row[]>([]);
  const [loadingItem, setLoadingItem] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    currentReading: "",
    readingType: "ACTUAL",
    estimationReason: "",
    readingDate: new Date().toISOString().slice(0, 16),
    gpsLatitude: "",
    gpsLongitude: "",
    exceptionType: "NONE",
    fieldOfficerId: "",
    remarks: "",
  });
  const [photo, setPhoto] = useState<any>();
  useEffect(() => {
    let cancelled = false;
    setLoadingItem(true);
    setError("");
    Promise.all([
      api.readingWorklist({ cycleId, meterId }),
      api.listReadingCycles(),
    ])
      .then(([items, cycles]) => {
        if (cancelled) return;
        setItem(items[0] ?? null);
        setSelectedCycle(
          cycles.find(
            (cycle: Row) => String(cycle.readingCycleId) === cycleId,
          ) ?? null,
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingItem(false);
      });
    api
      .listReadingOfficers()
      .then((nextOfficers) => {
        if (!cancelled) setOfficers(nextOfficers);
      })
      .catch(() => {
        // The authenticated reader can still capture without this optional list.
      });
    return () => {
      cancelled = true;
    };
  }, [cycleId, meterId]);
  const previous = Number(
    item?.meter?.readings?.[0]?.currentReading ??
      item?.meter?.openingReading ??
      0,
  );
  const consumption = form.currentReading
    ? Number(form.currentReading) - previous
    : 0;
  function locate() {
    if (!navigator.geolocation)
      return setError("Geolocation is not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setForm({
          ...form,
          gpsLatitude: String(p.coords.latitude),
          gpsLongitude: String(p.coords.longitude),
        }),
      (e) => setError(e.message),
      { enableHighAccuracy: true },
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (selectedCycle?.status !== "OPEN") {
      setError(
        "This reading cycle is closed and cannot accept new readings. Create or select an open reading cycle first.",
      );
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      meterId,
      readingCycleId: cycleId,
      previousReading: previous,
      currentReading: Number(form.currentReading),
      readingType: form.readingType,
      estimationReason: form.estimationReason || undefined,
      readingDate: new Date(form.readingDate).toISOString(),
      gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
      gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
      exceptionType: form.exceptionType,
      fieldOfficerId: form.fieldOfficerId || undefined,
      remarks: form.remarks || undefined,
      syncId: `web-${meterId}-${cycleId}-${Date.now()}`,
      evidence: photo ? [photo] : [],
    };
    try {
      await api.captureReading(payload);
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
      navigate(`/readings/worklist?cycleId=${cycleId}`);
    } catch (e: any) {
      if (/fetch|network|offline/i.test(e.message)) {
        const queue = JSON.parse(
          localStorage.getItem("aquaflow_reading_queue") ?? "[]",
        );
        queue.push(payload);
        localStorage.setItem("aquaflow_reading_queue", JSON.stringify(queue));
        setMessage(
          "Network unavailable. Reading saved to this device for later synchronization.",
        );
      } else setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  if (loadingItem)
    return (
      <Page title="Capture meter reading" subtitle="Preparing the selected meter">
        <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
          {[0, 1].map((card) => (
            <section
              key={card}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]"
            >
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
              </div>
              <div className="grid grid-cols-2 gap-4 p-5">
                {Array.from({ length: card ? 6 : 4 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                    <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          Loading meter and account details…
        </div>
      </Page>
    );
  if (!item)
    return (
      <Page title="Capture meter reading" subtitle="Selected meter unavailable">
        {error && <Notice>{error}</Notice>}
        <Card title="Unable to open this meter">
          <p className="text-sm text-slate-600">
            This meter is not eligible for the selected reading cycle. It may
            already have a reading, be inactive, or no longer have an active
            customer assignment.
          </p>
          <div className="mt-4">
            <Button type="button" tone="slate" onClick={() => navigate(-1)}>
              Return to worklist
            </Button>
          </div>
        </Card>
      </Page>
    );
  if (selectedCycle?.status !== "OPEN")
    return (
      <Page
        title="Capture meter reading"
        subtitle="Reading capture is unavailable for the selected cycle"
      >
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-lg font-extrabold text-amber-950">
            This reading cycle is {String(selectedCycle?.status ?? "unavailable").toLowerCase()}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-800">
            Readings cannot be entered or changed after a cycle is closed. Return to the worklist and select an open cycle, or create a new reading cycle first.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" tone="slate" onClick={() => navigate(-1)}>
              Return to worklist
            </Button>
            <Link
              to="/readings/cycles"
              className="inline-flex items-center rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
            >
              Create reading cycle
            </Link>
          </div>
        </section>
      </Page>
    );
  return (
    <Page
      title="Capture meter reading"
      subtitle={`${item.meter?.meterNumber} · ${item.account?.accountNumber} · ${item.customerName}`}
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <form onSubmit={submit}>
        <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
          <Card title="Meter and account">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Meter</dt>
                <dd className="font-semibold text-slate-800">
                  {item.meter?.meterNumber}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Account</dt>
                <dd className="font-semibold text-slate-800">
                  {item.account?.accountNumber}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Customer</dt>
                <dd className="font-semibold text-slate-800">
                  {item.customerName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Route</dt>
                <dd className="font-semibold text-slate-800">
                  {item.route?.routeName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Previous reading</dt>
                <dd className="text-2xl font-bold text-aqua-700">
                  {number(previous)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Calculated consumption</dt>
                <dd
                  className={`text-2xl font-bold ${consumption < 0 ? "text-red-600" : "text-emerald-600"}`}
                >
                  {number(consumption)}
                </dd>
              </div>
            </dl>
          </Card>
          <Card title="Reading details">
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Current reading" required>
                <input
                  required
                  autoFocus
                  min="0"
                  step="0.001"
                  type="number"
                  className={INPUT}
                  value={form.currentReading}
                  onChange={(e) =>
                    setForm({ ...form, currentReading: e.target.value })
                  }
                />
              </Field>
              <Field label="Reading type" required>
                <SearchableSelect
                  className={INPUT}
                  value={form.readingType}
                  onChange={(e) =>
                    setForm({ ...form, readingType: e.target.value })
                  }
                >
                  <option value="ACTUAL">Actual</option>
                  <option value="ESTIMATED">Estimated</option>
                  <option value="SMART">Smart meter</option>
                </SearchableSelect>
              </Field>
              <Field label="Reading date and time" required>
                <DateTimeInput
                  required
                  className={INPUT}
                  value={form.readingDate}
                  onChange={(e) =>
                    setForm({ ...form, readingDate: e.target.value })
                  }
                />
              </Field>
              {form.readingType === "ESTIMATED" && (
                <Field label="Estimation reason" required>
                  <input
                    required
                    className={INPUT}
                    value={form.estimationReason}
                    onChange={(e) =>
                      setForm({ ...form, estimationReason: e.target.value })
                    }
                  />
                </Field>
              )}
              <Field label="Field officer">
                <SearchableSelect
                  className={INPUT}
                  value={form.fieldOfficerId}
                  onChange={(e) =>
                    setForm({ ...form, fieldOfficerId: e.target.value })
                  }
                >
                  <option value="">Current authenticated user</option>
                  {officers.map((o) => (
                    <option key={o.fieldOfficerId} value={o.fieldOfficerId}>
                      {o.officerName}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
              <Field label="Observed exception">
                <SearchableSelect
                  className={INPUT}
                  value={form.exceptionType}
                  onChange={(e) =>
                    setForm({ ...form, exceptionType: e.target.value })
                  }
                >
                  <option value="NONE">Automatic detection</option>
                  <option value="TAMPERED">Tampering suspected</option>
                </SearchableSelect>
              </Field>
              <Field label="Meter photo">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className={INPUT}
                  onChange={async (e) => {
                    try {
                      setPhoto(await fileEvidence(e.target.files?.[0]));
                    } catch (x: any) {
                      setError(x.message);
                    }
                  }}
                />
              </Field>
              <Field label="GPS latitude">
                <input
                  type="number"
                  step="any"
                  className={INPUT}
                  value={form.gpsLatitude}
                  onChange={(e) =>
                    setForm({ ...form, gpsLatitude: e.target.value })
                  }
                />
              </Field>
              <Field label="GPS longitude">
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="any"
                    className={INPUT}
                    value={form.gpsLongitude}
                    onChange={(e) =>
                      setForm({ ...form, gpsLongitude: e.target.value })
                    }
                  />
                  <Button type="button" tone="slate" onClick={locate}>
                    Locate
                  </Button>
                </div>
              </Field>
              <GpsMap latitude={form.gpsLatitude} longitude={form.gpsLongitude} label="Reading location" className="md:col-span-2 xl:col-span-3" />
              <div className="md:col-span-2 xl:col-span-3">
                <Field label="Remarks">
                  <textarea
                    rows={2}
                    className={INPUT}
                    value={form.remarks}
                    onChange={(e) =>
                      setForm({ ...form, remarks: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" tone="slate" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button disabled={saving || !form.currentReading}>
            {saving ? "Submitting…" : "Submit for approval"}
          </Button>
        </div>
      </form>
    </Page>
  );
}

function ReadingTable({
  items,
  actions,
  loading = false,
  selectedIds,
  onToggle,
  onToggleAll,
  onRowClick,
}: {
  items: Row[];
  actions?: (row: Row) => ReactNode;
  loading?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (row: Row, checked: boolean) => void;
  onToggleAll?: (checked: boolean) => void;
  onRowClick?: (row: Row) => void;
}) {
  const selectable = Boolean(selectedIds && onToggle && onToggleAll);
  const allSelected =
    Boolean(items.length) &&
    items.every((item) => selectedIds?.has(String(item.readingId)));
  const columnCount = (actions ? 11 : 10) + (selectable ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1360px]">
        <thead className="bg-slate-50/90">
          <tr>
            {selectable && (
              <th className="w-12 px-4 py-3 text-center">
                <input
                  type="checkbox"
                  aria-label="Select all pending readings"
                  checked={allSelected}
                  onChange={(event) => onToggleAll?.(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-aqua-700 focus:ring-aqua-500"
                />
              </th>
            )}
            <th className={`${TH} pl-5`}>Reading date</th>
            <th className={TH}>Cycle</th>
            <th className={TH}>Customer / Account</th>
            <th className={TH}>Meter</th>
            <th className={`${TH} text-right`}>Previous</th>
            <th className={`${TH} text-right`}>Current</th>
            <th className={`${TH} text-right`}>Consumption</th>
            <th className={TH}>Reading type</th>
            <th className={TH}>Exception</th>
            <th className={TH}>Approval</th>
            {actions && <th className={`${TH} text-right`}>Action</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr>
              <td
                colSpan={columnCount}
                className="px-5 py-16 text-center text-slate-500"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                  Loading reading records…
                </span>
              </td>
            </tr>
          ) : items.map((r) => {
            const name = customerName(r);
            return (
            <tr
              key={r.readingId}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-selected={selectedIds?.has(String(r.readingId)) ?? false}
              onClick={() => onRowClick?.(r)}
              onKeyDown={(event) => {
                if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onRowClick(r);
                }
              }}
              className={`transition ${onRowClick ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-400" : ""} ${selectedIds?.has(String(r.readingId)) ? "bg-sky-50 ring-1 ring-inset ring-sky-200" : "odd:bg-white even:bg-slate-50/35 hover:bg-sky-50/60"}`}
            >
              {selectable && (
                <td className="w-12 px-4 py-3.5 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Select reading for meter ${r.meter?.meterNumber ?? ""}`}
                    checked={selectedIds?.has(String(r.readingId)) ?? false}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onToggle?.(r, event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-aqua-700 focus:ring-aqua-500"
                  />
                </td>
              )}
              <td className="px-5 py-3.5">
                <div className="font-semibold text-slate-800">
                  {formatDmyDate(r.readingDate)}
                </div>
              </td>
              <td className="px-4 py-3.5">
                <div className="font-semibold text-slate-700">
                  {r.cycle?.cycleName ?? "—"}
                </div>
                {r.cycle?.cycleCode && (
                  <div className="mt-0.5 text-xs text-slate-400">
                    {r.cycle.cycleCode}
                  </div>
                )}
              </td>
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-50 to-violet-100 text-[11px] font-extrabold text-violet-700 ring-1 ring-violet-100">
                    {name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part: string) => part[0])
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div>
                    <div className="font-bold text-slate-900">{name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                      <span className="font-semibold text-aqua-700">
                        {r.account?.customer?.customerNumber ?? "No customer number"}
                      </span>
                      <span className="text-slate-400">
                        Account: {r.account?.accountNumber ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3.5">
                <div className="font-bold text-slate-800">
                  {r.meter?.meterNumber ?? "—"}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {r.meter?.serialNumber || pretty(r.meter?.meterType) || "Customer meter"}
                </div>
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-slate-600">
                {number(r.previousReading)}
              </td>
              <td className="px-4 py-3.5 text-right font-extrabold tabular-nums text-aqua-800">
                {number(r.currentReading)}
              </td>
              <td className="px-4 py-3.5 text-right">
                <span
                  className={`inline-flex min-w-14 justify-end rounded-lg px-2 py-1 font-extrabold tabular-nums ${
                    Number(r.consumption) < 0
                      ? "bg-red-50 text-red-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {number(r.consumption)}
                </span>
              </td>
              <td className="px-4 py-3.5 text-sm font-medium text-slate-600">
                <div>{pretty(r.readingType)}</div>
                <div className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${readingSource(r) === "Customer submitted" ? "text-violet-700" : "text-sky-600"}`}>
                  {readingSource(r)}
                </div>
              </td>
              <td className="px-4 py-3.5">
                <Badge value={r.exceptionType} />
              </td>
              <td className="px-4 py-3.5">
                <Badge value={r.approvalStatus} />
              </td>
              {actions && (
                <td className="px-5 py-3.5 text-right">{actions(r)}</td>
              )}
            </tr>
          )})}
          {!loading && !items.length && (
            <tr>
              <td
                colSpan={columnCount}
                className="px-5 py-16 text-center"
              >
                <div className="font-semibold text-slate-700">
                  No reading records found
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Change the cycle, approval, type or search filters and try again.
                </p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ReadingRegister({
  exceptions = false,
}: {
  exceptions?: boolean;
}) {
  const [params] = useSearchParams();
  const [cycles, setCycles] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const pageSize = 25;
  const [error, setError] = useState("");
  const [evidenceReading, setEvidenceReading] = useState<Row | null>(null);
  const [filters, setFilters] = useState({
    cycleId: params.get("cycleId") ?? "",
    approvalStatus: "",
    readingType: "",
    readingValue: "",
    fromDate: "",
    toDate: "",
    search: params.get("search") ?? "",
  });
  useEffect(() => {
    api.listReadingCycles().then(setCycles);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .listReadings({
          ...filters,
          search: filters.search.trim(),
          exceptionOnly: exceptions ? "true" : "",
          page: String(page),
          pageSize: String(pageSize),
        })
        .then((result) => {
          if (cancelled) return;
          setError("");
          setItems(result.items);
          setTotal(Number(result.total));
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, filters.search ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filters, exceptions, page]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const shownStart = total ? (page - 1) * pageSize + 1 : 0;
  const shownEnd = Math.min(page * pageSize, total);
  const approvedOnPage = items.filter(
    (item) => item.approvalStatus === "APPROVED",
  ).length;
  const pendingOnPage = items.filter(
    (item) => item.approvalStatus === "PENDING",
  ).length;
  const exceptionsOnPage = items.filter(
    (item) => item.exceptionType && item.exceptionType !== "NONE",
  ).length;
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, pages - 4));
    const end = Math.min(pages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [page, pages]);
  const updateFilters = (next: typeof filters) => {
    setPage(1);
    setFilters(next);
  };
  const exportAllReadings = async () => {
    setExporting(true);
    setError("");
    try {
      const exportItems = await api.listReadings({
        ...filters,
        search: filters.search.trim(),
        exceptionOnly: exceptions ? "true" : "",
        export: "true",
      });
      exportExcel(
        exceptions ? "reading-exceptions.xlsx" : "meter-readings.xlsx",
        "Meter Readings",
        exportItems.map((r: Row) => ({
          Cycle: r.cycle?.cycleName,
          "Reading Date": formatDmyDate(r.readingDate),
          Meter: r.meter?.meterNumber,
          Account: r.account?.accountNumber,
          Customer: customerName(r),
          Previous: Number(r.previousReading),
          Current: Number(r.currentReading),
          Consumption: Number(r.consumption),
          Type: r.readingType,
          Exception: r.exceptionType,
          Approval: r.approvalStatus,
        })),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };
  const Pagination = ({ position }: { position: "top" | "bottom" }) => (
    <nav
      className="flex flex-wrap items-center justify-between gap-3"
      aria-label={`Reading register ${position} pagination`}
    >
      <span className="text-xs font-medium text-slate-500">
        {total
          ? `Showing ${shownStart.toLocaleString()}–${shownEnd.toLocaleString()} of ${total.toLocaleString()} readings`
          : "No readings to display"}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ Previous
        </button>
        <div className="hidden items-center gap-1 sm:flex">
          {pageNumbers.map((pageNumber) => (
            <button
              type="button"
              key={`${position}-${pageNumber}`}
              aria-current={pageNumber === page ? "page" : undefined}
              onClick={() => setPage(pageNumber)}
              className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-bold transition ${
                pageNumber === page
                  ? "border-aqua-700 bg-aqua-700 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50"
              }`}
            >
              {pageNumber}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => setPage((current) => Math.min(pages, current + 1))}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next ›
        </button>
      </div>
    </nav>
  );
  return (
    <Page
      title={exceptions ? "Reading exceptions" : "Meter reading register"}
      subtitle={
        exceptions
          ? "Investigate zero, negative, high, low and tampered readings"
          : "Search and export the complete reading history"
      }
      actions={
        <Button
          tone="slate"
          disabled={exporting || loading}
          onClick={() => void exportAllReadings()}
        >
          {exporting ? `Exporting ${total.toLocaleString()}…` : "Export Excel"}
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]">
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Cycle">
            <SearchableSelect
              className={INPUT}
              value={filters.cycleId}
              onChange={(e) =>
                updateFilters({ ...filters, cycleId: e.target.value })
              }
            >
              <option value="">All cycles</option>
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Approval">
            <SearchableSelect
              className={INPUT}
              value={filters.approvalStatus}
              onChange={(e) =>
                updateFilters({ ...filters, approvalStatus: e.target.value })
              }
            >
              <option value="">All decisions</option>
              <option>PENDING</option>
              <option>APPROVED</option>
              <option>REJECTED</option>
            </SearchableSelect>
          </Field>
          <Field label="Reading type">
            <SearchableSelect
              className={INPUT}
              value={filters.readingType}
              onChange={(e) =>
                updateFilters({ ...filters, readingType: e.target.value })
              }
            >
              <option value="">All types</option>
              <option>ACTUAL</option>
              <option>ESTIMATED</option>
              <option>SMART</option>
            </SearchableSelect>
          </Field>
          <Field label="Usage / reading">
            <SearchableSelect
              className={INPUT}
              value={filters.readingValue}
              onChange={(e) =>
                updateFilters({ ...filters, readingValue: e.target.value })
              }
            >
              <option value="">All readings</option>
              <option value="ZERO_CONSUMPTION">Zero consumption</option>
              <option value="ZERO_CURRENT">Current reading is 0</option>
              <option value="POSITIVE_CONSUMPTION">Positive consumption</option>
              <option value="NEGATIVE_CONSUMPTION">Negative consumption</option>
            </SearchableSelect>
          </Field>
          <Field label="Search">
            <input
              className={INPUT}
              value={filters.search}
              onChange={(e) =>
                updateFilters({ ...filters, search: e.target.value })
              }
              placeholder="Meter, account or customer"
            />
          </Field>
          <Field label="Reading date from">
            <DateInput
              className={INPUT}
              value={filters.fromDate}
              max={filters.toDate || undefined}
              onChange={(e) =>
                updateFilters({ ...filters, fromDate: e.target.value })
              }
            />
          </Field>
          <Field label="Reading date to">
            <DateInput
              className={INPUT}
              value={filters.toDate}
              min={filters.fromDate || undefined}
              onChange={(e) =>
                updateFilters({ ...filters, toDate: e.target.value })
              }
            />
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              disabled={!filters.fromDate && !filters.toDate}
              onClick={() =>
                updateFilters({ ...filters, fromDate: "", toDate: "" })
              }
              className="h-[42px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear dates
            </button>
          </div>
        </div>
        <div className="grid border-t border-slate-100 bg-slate-50/70 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-slate-200">
          {[
            ["Matching readings", total, "text-aqua-800"],
            ["Approved on page", approvedOnPage, "text-emerald-700"],
            ["Pending on page", pendingOnPage, "text-amber-700"],
            ["Exceptions on page", exceptionsOnPage, "text-red-700"],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {label}
              </div>
              <div className={`mt-1 text-xl font-extrabold ${color}`}>
                {Number(value).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {exceptions ? "Exception register" : "Reading register"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Page {page.toLocaleString()} of {pages.toLocaleString()} ·{" "}
              {total.toLocaleString()} record{total === 1 ? "" : "s"}
            </p>
          </div>
          <Pagination position="top" />
        </div>
        <ReadingTable
          items={items}
          loading={loading}
          actions={(r) =>
            r.evidence?.[0] ? (
              <button
                className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-aqua-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50"
                onClick={() => setEvidenceReading(r)}
              >
                View evidence
              </button>
            ) : (
              <span className="text-xs text-slate-400">No evidence</span>
            )
          }
        />
        <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-4">
          <Pagination position="bottom" />
        </div>
      </section>
      {evidenceReading && (
        <ReadingEvidenceModal reading={evidenceReading} onClose={() => setEvidenceReading(null)} />
      )}
    </Page>
  );
}

export function ReadingApprovals() {
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () => {
    setLoading(true);
    return api
      .listReadings({
        approvalStatus: "PENDING",
        page: String(page),
        pageSize: String(pageSize),
      })
      .then((result) => {
        const rows = result.items;
        setItems(rows);
        setTotal(Number(result.total));
        setSelected(
          (old) =>
            rows.find((r: Row) => r.readingId === old?.readingId) ??
            rows[0] ??
            null,
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void load();
  }, [page]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  async function decide(decision: "APPROVED" | "REJECTED") {
    const readingIds = selectedIds.size
      ? [...selectedIds]
      : selected
        ? [String(selected.readingId)]
        : [];
    if (!readingIds.length || comments.trim().length < 3)
      return setError("Enter approval comments before making a decision");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.bulkDecideReadings(readingIds, decision, comments);
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
      setMessage(
        `${readingIds.length} reading${readingIds.length === 1 ? "" : "s"} ${
          decision === "APPROVED" ? "approved" : "rejected"
        } successfully.`,
      );
      setComments("");
      setSelectedIds(new Set());
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title="Reading approvals"
      subtitle="Review captured and estimated readings before they become eligible for billing"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card
          className="min-w-0"
          title={`${total.toLocaleString()} pending reading(s)`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-sm font-bold text-slate-800">
                {selectedIds.size
                  ? `${selectedIds.size} reading${selectedIds.size === 1 ? "" : "s"} selected`
                  : "Select readings for a bulk decision"}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Use the header checkbox to select every pending reading shown.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => {
                  setSelectedIds(new Set());
                  setPage((current) => Math.max(1, current - 1));
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => {
                  setSelectedIds(new Set());
                  setPage((current) => Math.min(pages, current + 1));
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-100"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <ReadingTable
            items={items}
            loading={loading}
            selectedIds={selectedIds}
            onToggle={(row, checked) => {
              setSelectedIds((current) => {
                const next = new Set(current);
                checked
                  ? next.add(String(row.readingId))
                  : next.delete(String(row.readingId));
                return next;
              });
              if (checked) setSelected(row);
            }}
            onToggleAll={(checked) => {
              setSelectedIds(
                checked
                  ? new Set(items.map((item) => String(item.readingId)))
                  : new Set(),
              );
              if (checked && items[0]) setSelected(items[0]);
            }}
            onRowClick={(row) => {
              const id = String(row.readingId);
              setSelected(row);
              setSelectedIds((current) => {
                const next = new Set(current);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              });
            }}
            actions={(r) => (
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-aqua-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected(r);
                  setSelectedIds((current) =>
                    new Set(current).add(String(r.readingId)),
                  );
                }}
              >
                Review
              </button>
            )}
          />
        </Card>
        <Card
          className="min-w-0"
          title={
            selectedIds.size
              ? `Bulk approval decision · ${selectedIds.size} selected`
              : "Approval decision"
          }
        >
          {selected ? (
            <div className="space-y-4">
              {selectedIds.size > 1 && (
                <Notice tone="blue">
                  The comments and decision below will apply to all{" "}
                  {selectedIds.size} selected readings. The batch is validated
                  before any record is changed.
                </Notice>
              )}
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold text-slate-900">
                      {selected.meter?.meterNumber}
                    </div>
                    <div className="text-sm text-slate-500">
                      {selected.account?.accountNumber} ·{" "}
                      {customerName(selected)}
                    </div>
                  </div>
                  <Badge value={selected.exceptionType} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-xs text-slate-500">Previous</div>
                    <div className="font-bold">
                      {number(selected.previousReading)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Current</div>
                    <div className="font-bold">
                      {number(selected.currentReading)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Consumption</div>
                    <div className="font-bold text-aqua-700">
                      {number(selected.consumption)}
                    </div>
                  </div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Reading type</dt>
                  <dd className="font-medium">
                    {pretty(selected.readingType)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Captured by</dt>
                  <dd className="font-medium">
                    {selected.fieldOfficer
                      ? `${selected.fieldOfficer.user.firstName} ${selected.fieldOfficer.user.lastName}`
                      : "Authenticated user"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">GPS</dt>
                  <dd className="font-medium">
                    {selected.gpsLatitude ? (
                      <a
                        className="text-aqua-700"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://maps.google.com/?q=${selected.gpsLatitude},${selected.gpsLongitude}`}
                      >
                        Open map
                      </a>
                    ) : (
                      "Not captured"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Evidence</dt>
                  <dd className="font-medium">
                    {selected.evidence?.length ? (
                      <button
                        className="text-aqua-700"
                        onClick={() => openEvidence(selected.evidence[0])}
                      >
                        View photo
                      </button>
                    ) : (
                      "No photo"
                    )}
                  </dd>
                </div>
              </dl>
              <GpsMap latitude={selected.gpsLatitude} longitude={selected.gpsLongitude} label="Reading location" />
              {selected.readingType === "ESTIMATED" && (
                <Notice tone="blue">
                  Estimation reason: {selected.estimationReason}
                </Notice>
              )}
              <Field label="Approval comments" required>
                <textarea
                  rows={3}
                  className={INPUT}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Record the reason for this decision"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  tone="red"
                  disabled={saving}
                  onClick={() => decide("REJECTED")}
                >
                  {selectedIds.size ? "Reject selected" : "Reject"}
                </Button>
                <Button
                  tone="green"
                  disabled={saving}
                  onClick={() => decide("APPROVED")}
                >
                  {saving
                    ? "Processing…"
                    : selectedIds.size
                      ? "Approve selected"
                      : "Approve reading"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="py-12 text-center text-slate-400">
              No readings await approval.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}

export function ReadingProgress() {
  const [cycleId, setCycleId] = useState("");
  const [cycles, setCycles] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [routeSearch, setRouteSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [progressFilter, setProgressFilter] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listReadingCycles()
      .then((c) => {
        if (cancelled) return;
        setError("");
        setCycles(c);
        const active = c.find((x: Row) => x.status === "OPEN") ?? c[0];
        if (active) setCycleId(String(active.readingCycleId));
        else setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .readingProgress(cycleId)
      .then((nextRows) => {
        if (!cancelled) setRows(nextRows);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cycleId]);
  const zones = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => String(row.route?.zone?.zoneName ?? "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const query = routeSearch.trim().toLowerCase();

    return rows.filter((row) => {
      const zoneName = String(row.route?.zone?.zoneName ?? "");
      const routeName = String(row.route?.routeName ?? "");
      const assignedOfficer = String(row.assignedOfficer ?? "Unassigned");
      const captured = Number(row.captured ?? 0);
      const totalMeters = Number(row.totalMeters ?? 0);
      const exceptions = Number(row.exceptions ?? 0);

      const matchesSearch =
        !query ||
        [zoneName, routeName, assignedOfficer].some((value) =>
          value.toLowerCase().includes(query),
        );
      const matchesZone = !zoneFilter || zoneName === zoneFilter;
      const matchesProgress =
        !progressFilter ||
        (progressFilter === "NOT_STARTED" && captured === 0) ||
        (progressFilter === "IN_PROGRESS" &&
          captured > 0 &&
          captured < totalMeters) ||
        (progressFilter === "COMPLETE" &&
          totalMeters > 0 &&
          captured >= totalMeters);
      const matchesExceptions =
        !exceptionFilter ||
        (exceptionFilter === "WITH_EXCEPTIONS" && exceptions > 0) ||
        (exceptionFilter === "WITHOUT_EXCEPTIONS" && exceptions === 0);

      return (
        matchesSearch &&
        matchesZone &&
        matchesProgress &&
        matchesExceptions
      );
    });
  }, [exceptionFilter, progressFilter, routeSearch, rows, zoneFilter]);
  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (a, r) => ({
          total: a.total + r.totalMeters,
          captured: a.captured + r.captured,
          unread: a.unread + r.unread,
          exceptions: a.exceptions + r.exceptions,
        }),
        { total: 0, captured: 0, unread: 0, exceptions: 0 },
      ),
    [filteredRows],
  );
  const hasFilters = Boolean(
    routeSearch || zoneFilter || progressFilter || exceptionFilter,
  );
  return (
    <Page
      title="Route completion report"
      subtitle="Monitor assigned readers, unread meters and route-level progress"
      actions={
        <Button
          tone="slate"
          disabled={loading || !filteredRows.length}
          onClick={() =>
            exportExcel(
              "reading-route-progress.xlsx",
              "Route Progress",
              filteredRows.map((r) => ({
                Zone: r.route?.zone?.zoneName,
                Route: r.route?.routeName,
                Officer: r.assignedOfficer,
                Total: r.totalMeters,
                Captured: r.captured,
                Unread: r.unread,
                Approved: r.approved,
                Exceptions: r.exceptions,
                "Completion %": r.completionPercent,
              })),
            )
          }
        >
          Export Excel
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="relative mb-4">
        {loading && (
          <div className="absolute inset-x-0 top-0 h-1 overflow-hidden rounded-t-2xl bg-aqua-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-aqua-600" />
          </div>
        )}
        <div className="grid items-end gap-3 md:grid-cols-[1fr_repeat(4,160px)]">
          <Field label="Reading cycle">
            <SearchableSelect
              className={INPUT}
              value={cycleId}
              disabled={loading && !cycleId}
              onChange={(e) => setCycleId(e.target.value)}
            >
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          {[
            ["Meters", totals.total],
            ["Captured", totals.captured],
            ["Unread", totals.unread],
            ["Exceptions", totals.exceptions],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg bg-slate-50 px-3 py-2"
            >
              <div className="text-xs text-slate-500">{label}</div>
              {loading ? (
                <div className="mt-1 h-6 w-16 animate-pulse rounded bg-slate-200" />
              ) : (
                <div className="text-xl font-bold text-slate-800">{value}</div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 grid items-end gap-3 border-t border-slate-100 pt-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(190px,240px))_auto]">
          <Field label="Search routes">
            <input
              className={INPUT}
              value={routeSearch}
              onChange={(event) => setRouteSearch(event.target.value)}
              placeholder="Zone, route or assigned officer"
              aria-label="Search route progress"
            />
          </Field>
          <Field label="Zone">
            <SearchableSelect
              className={INPUT}
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
            >
              <option value="">All zones</option>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Progress status">
            <SearchableSelect
              className={INPUT}
              value={progressFilter}
              onChange={(event) => setProgressFilter(event.target.value)}
            >
              <option value="">All progress statuses</option>
              <option value="NOT_STARTED">Not started</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETE">Complete</option>
            </SearchableSelect>
          </Field>
          <Field label="Exceptions">
            <SearchableSelect
              className={INPUT}
              value={exceptionFilter}
              onChange={(event) => setExceptionFilter(event.target.value)}
            >
              <option value="">All routes</option>
              <option value="WITH_EXCEPTIONS">With exceptions</option>
              <option value="WITHOUT_EXCEPTIONS">Without exceptions</option>
            </SearchableSelect>
          </Field>
          <Button
            disabled={!hasFilters}
            onClick={() => {
              setRouteSearch("");
              setZoneFilter("");
              setProgressFilter("");
              setExceptionFilter("");
            }}
          >
            Clear filters
          </Button>
        </div>
      </Card>
      <Card
        title={`Progress by route · ${filteredRows.length} of ${rows.length} routes`}
        className="relative"
      >
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Zone / Route</th>
                <th className={TH}>Assigned officer</th>
                <th className={TH}>Meters</th>
                <th className={TH}>Captured</th>
                <th className={TH}>Unread</th>
                <th className={TH}>Approved</th>
                <th className={TH}>Exceptions</th>
                <th className={TH}>Completion</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-20 text-center">
                    <span className="inline-flex items-center gap-3 font-semibold text-slate-600">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700" />
                      Loading route progress…
                    </span>
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.route.routeId} className="border-t border-slate-100">
                    <td className={TD}>
                      {r.route.zone?.zoneName} /{" "}
                      <span className="font-medium text-slate-800">
                        {r.route.routeName}
                      </span>
                    </td>
                    <td className={TD}>{r.assignedOfficer}</td>
                    <td className={TD}>{r.totalMeters}</td>
                    <td className={TD}>{r.captured}</td>
                    <td className={TD}>{r.unread}</td>
                    <td className={TD}>{r.approved}</td>
                    <td className={TD}>{r.exceptions}</td>
                    <td className={TD}>
                      <div className="min-w-32">
                        <div className="mb-1 flex justify-between text-xs">
                          <span>{r.completionPercent}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-aqua-600"
                            style={{ width: `${r.completionPercent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {!loading && !filteredRows.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="font-semibold text-slate-700">
                      {rows.length
                        ? "No routes match these filters"
                        : "No route progress found"}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {rows.length
                        ? "Clear or adjust the filters and try again."
                        : "Select another reading cycle and try again."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function ReadingSyncQueue() {
  const [queue, setQueue] = useState<Row[]>(() =>
    JSON.parse(localStorage.getItem("aquaflow_reading_queue") ?? "[]"),
  );
  const [result, setResult] = useState("");
  async function sync() {
    if (!queue.length) return;
    try {
      const response = await api.syncReadings(queue);
      const failed = response.results
        .filter((r: Row) => !r.ok)
        .map((r: Row) => queue[r.index]);
      localStorage.setItem("aquaflow_reading_queue", JSON.stringify(failed));
      setQueue(failed);
      setResult(
        `${response.succeeded} reading(s) synchronized; ${response.failed} remain.`,
      );
    } catch (e: any) {
      setResult(e.message);
    }
  }
  return (
    <Page
      title="Offline reading queue"
      subtitle="Synchronize readings captured while the network was unavailable"
      actions={
        <Button disabled={!queue.length} onClick={sync}>
          Synchronize now
        </Button>
      }
    >
      {result && <Notice tone="blue">{result}</Notice>}
      <Card title={`${queue.length} pending reading(s)`}>
        {queue.length ? (
          <div className="space-y-2">
            {queue.map((r, i) => (
              <div
                key={r.syncId ?? i}
                className="flex justify-between rounded-lg border border-slate-200 p-3"
              >
                <span>
                  Meter {r.meterId} · Current {number(r.currentReading)}
                </span>
                <span className="text-sm text-slate-500">
                  {date(r.readingDate)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-slate-400">
            All locally captured readings are synchronized.
          </p>
        )}
      </Card>
    </Page>
  );
}

export function BulkCurrentReadingImport() {
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function choose(file?: File) {
    if (!file) return;
    setFileName(file.name);
    setMessage("");
    try {
      const rows = await parseMeterWorkbook(file, [
        "meterNumber",
        "accountNumber",
        "cycleCode",
        "currentReading",
      ]);
      const issues: string[] = [];
      const normalized = rows.map((row, index) => {
        const meterNumber = String(row.meterNumber ?? "").trim();
        const accountNumber = String(row.accountNumber ?? "").trim();
        const cycleCode = String(row.cycleCode ?? "").trim();
        const cycleStartDate = String(row.cycleStartDate ?? "").trim();
        const cycleEndDate = String(row.cycleEndDate ?? "").trim();
        const readingDate = String(row.readingDate ?? "").trim();
        const previousReading = Number(row.previousReading);
        const currentReading = Number(row.currentReading);
        if (!meterNumber) issues.push(`Row ${index + 2}: meterNumber is required.`);
        if (!accountNumber) issues.push(`Row ${index + 2}: accountNumber is required.`);
        if (!cycleCode) issues.push(`Row ${index + 2}: cycleCode is required.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleStartDate)) issues.push(`Row ${index + 2}: cycleStartDate must be YYYY-MM-DD.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleEndDate)) issues.push(`Row ${index + 2}: cycleEndDate must be YYYY-MM-DD.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate)) issues.push(`Row ${index + 2}: readingDate must be YYYY-MM-DD.`);
        if (!Number.isFinite(previousReading) || previousReading < 0) issues.push(`Row ${index + 2}: previousReading is invalid.`);
        if (!Number.isFinite(currentReading) || currentReading < 0) issues.push(`Row ${index + 2}: currentReading is invalid.`);
        return { meterNumber, accountNumber, cycleCode, cycleStartDate, cycleEndDate, previousReading, currentReading, readingDate };
      });
      if (!rows.length) issues.push("The selected file has no reading rows.");
      setRecords(normalized);
      setErrors(issues);
    } catch (error: any) {
      setRecords([]);
      setErrors([error.message || "The file could not be read."]);
    }
  }

  async function upload() {
    if (!records.length || errors.length) return;
    setUploading(true);
    setMessage("");
    try {
      let imported = 0;
      let repaired = 0;
      let verified = 0;
      // Keep migration requests small enough for shared production databases.
      // The endpoint is idempotent, so completed batches remain safe on retry.
      const batchSize = 250;
      for (let offset = 0; offset < records.length; offset += batchSize) {
        const result = await api.bulkImportCurrentReadings(
          records.slice(offset, offset + batchSize),
        );
        imported += Number(result.imported ?? 0);
        repaired += Number(result.repaired ?? result.skipped ?? 0);
        verified += Number(result.verified ?? result.imported ?? 0);
      }
      setMessage(
        `${verified} previous/current reading pairs verified in ${records[0]?.cycleCode}` +
          ` (${imported} created${repaired ? `, ${repaired} existing rows repaired` : ""}).`,
      );
    } catch (error: any) {
      setErrors([error.message || "Current readings could not be imported."]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Page title="Import current readings" subtitle="Migration/setup tool for loading an approved MajiWare reading baseline">
      <section className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-slate-900">Current-reading workbook</h2>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-amber-800">Migration only</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">Auto-approved baseline</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Meters, customer accounts and assignments must be imported first.</p>
          </div>
          <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" onClick={() => exportExcel("current-reading-import-template.xlsx", "Current Readings", [{ meterNumber: "MTR-2026-00001", accountNumber: "ACC-00001", cycleCode: "RC-2026-07", cycleStartDate: "2026-07-01", cycleEndDate: "2026-08-04", previousReading: 100, currentReading: 110, readingDate: "2026-07-31" }])}>Download template</button>
        </div>
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Do not use this page for routine monthly meter reading.</p>
          <p className="mt-1">This import creates or repairs historical baseline readings and marks them approved. For an active reading cycle, use <strong>Reading Worklist → Bulk upload readings</strong>.</p>
        </div>
        <label className="mt-5 block rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <span className="block font-bold text-slate-800">{fileName || "Choose current-reading Excel or CSV file"}</span>
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="mt-4 text-sm" onChange={(event) => void choose(event.target.files?.[0])} />
        </label>
        {records.length > 0 && !errors.length && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{records.length} reading rows validated and ready.</div>}
        {errors.length > 0 && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errors.slice(0, 20).map((error) => <div key={error}>{error}</div>)}</div>}
        {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
        <div className="mt-5 flex justify-end"><button type="button" disabled={!records.length || errors.length > 0 || uploading} onClick={upload} className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-40">{uploading ? "Importing..." : `Import ${records.length || ""} readings`}</button></div>
      </section>
    </Page>
  );
}
