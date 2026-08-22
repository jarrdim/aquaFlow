import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "../lib/api";
import { decodeId, encodeId } from "../lib/hashids";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { GpsMap } from "../components/GpsMap";
import { Pagination } from "../components/Pagination";
import {
  exportExcel,
  fileToEvidence,
  MeterEvidenceInput,
  openEvidence,
  parseMeterWorkbook,
} from "../lib/meterFiles";

type AnyRecord = Record<string, any>;

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
    <div className="mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5">
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

const tones: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  IN_STOCK: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
  FAULTY: "bg-orange-50 text-orange-700 ring-orange-600/20",
  TAMPERED: "bg-red-50 text-red-700 ring-red-600/20",
  REPLACED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  DISCONNECTED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  REMOVED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tones[value] ?? tones.DISCONNECTED}`}
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
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "—";
}
function displaySize(value: any) {
  return `${Number(value ?? 0).toLocaleString()} mm`;
}
function meterUrl(meter: AnyRecord) {
  return `/meters/${encodeId(meter.meterId)}`;
}

function Button({
  children,
  tone = "blue",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "blue" | "green" | "orange" | "teal" | "red" | "slate";
}) {
  const colors = {
    blue: "bg-aqua-700 hover:bg-aqua-600",
    green: "bg-emerald-600 hover:bg-emerald-500",
    orange: "bg-orange-500 hover:bg-orange-400",
    teal: "bg-teal-500 hover:bg-teal-400",
    red: "bg-red-600 hover:bg-red-500",
    slate: "bg-slate-600 hover:bg-slate-500",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

function LinkButton({
  to,
  children,
  tone = "blue",
}: {
  to: string;
  children: ReactNode;
  tone?: "blue" | "green" | "orange" | "teal" | "red";
}) {
  const colors = {
    blue: "bg-aqua-700 hover:bg-aqua-600",
    green: "bg-emerald-600 hover:bg-emerald-500",
    orange: "bg-orange-500 hover:bg-orange-400",
    teal: "bg-teal-500 hover:bg-teal-400",
    red: "bg-red-600 hover:bg-red-500",
  };
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition ${colors[tone]}`}
    >
      {children}
    </Link>
  );
}

function Notice({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info";
  children: ReactNode;
}) {
  if (kind !== "info") {
    return (
      <SweetAlertToast
        message={children}
        type={kind === "success" ? "success" : "error"}
      />
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex min-h-48 items-center justify-center text-sm text-slate-400">
      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
      Loading…
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="py-14 text-center text-sm text-slate-400">{text}</div>;
}

function Table({
  headers,
  children,
}: {
  headers: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[760px]">
        <thead className="bg-slate-50">
          <tr>
            {headers.map((h, index) => (
              <th key={index} className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

function assignmentZone(meter: AnyRecord) {
  return (
    meter.assignment?.account?.property?.zone?.zoneName ??
    meter.assignment?.zone?.zoneName ??
    meter.assignment?.borehole?.zone?.zoneName ??
    "—"
  );
}

export function MeterDashboard() {
  const [data, setData] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  const [zones, setZones] = useState<AnyRecord[]>([]);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    zoneId: "",
  });
  function load() {
    setData(null);
    setError("");
    api
      .meterDashboard(filters)
      .then(setData)
      .catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    api
      .listZones()
      .then(setZones)
      .catch(() => undefined);
  }, []);
  const stats = data
    ? [
        ["Total meters", data.total, "text-aqua-700", "bg-blue-50"],
        [
          "Installed",
          data.status.ACTIVE ?? 0,
          "text-emerald-700",
          "bg-emerald-50",
        ],
        ["In store", data.status.IN_STOCK ?? 0, "text-teal-700", "bg-teal-50"],
        ["Faulty", data.status.FAULTY ?? 0, "text-orange-700", "bg-orange-50"],
        ["Tampered", data.status.TAMPERED ?? 0, "text-red-700", "bg-red-50"],
        [
          "Inactive",
          data.status.INACTIVE ?? 0,
          "text-slate-700",
          "bg-slate-100",
        ],
        [
          "Replaced",
          data.status.REPLACED ?? 0,
          "text-violet-700",
          "bg-violet-50",
        ],
      ]
    : [];
  return (
    <Page
      title="Meter Management"
      subtitle="Inventory, installations, assignments, replacements and exceptions"
      actions={
        <>
          <LinkButton to="/meters/register">Register meter</LinkButton>
          <LinkButton to="/meters/assign" tone="green">
            Assign meter
          </LinkButton>
        </>
      }
    >
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From date">
            <input
              type="date"
              className={INPUT}
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({ ...filters, dateFrom: e.target.value })
              }
            />
          </Field>
          <Field label="To date">
            <input
              type="date"
              className={INPUT}
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({ ...filters, dateTo: e.target.value })
              }
            />
          </Field>
          <Field label="Zone">
            <SearchableSelect
              className={INPUT}
              value={filters.zoneId}
              onChange={(e) =>
                setFilters({ ...filters, zoneId: e.target.value })
              }
            >
              <option value="">All zones</option>
              {zones.map((zone) => (
                <option key={zone.zoneId} value={zone.zoneId}>
                  {zone.zoneName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={load}>
              Apply filters
            </Button>
          </div>
        </div>
      </Card>
      {error ? (
        <Notice>{error}</Notice>
      ) : !data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {stats.map(([label, value, color, bg]) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div
                  className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${bg} ${color}`}
                >
                  <span className="text-lg">◉</span>
                </div>
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {Number(value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 mb-6">
            <LinkButton to="/meters/list">Meter register</LinkButton>
            <LinkButton to="/meters/replacements" tone="orange">
              Replacement approvals
            </LinkButton>
            <LinkButton to="/meters/reports/exceptions" tone="teal">
              Exception report
            </LinkButton>
            <LinkButton to="/meters/import" tone="green">
              Bulk import
            </LinkButton>
            <LinkButton to="/meters/alerts" tone="red">
              Exception alerts
            </LinkButton>
            <Button
              tone="slate"
              onClick={async () => {
                const meters = await api.listMeters();
                await exportExcel(
                  "meter-register.xlsx",
                  "Meters",
                  meters.map((m: AnyRecord) => ({
                    Meter: m.meterNumber,
                    Type: m.meterType,
                    SizeMM: m.meterSizeMm,
                    AssignedTo: m.assignedTo ?? "",
                    Status: m.status,
                  })),
                );
              }}
            >
              Export register
            </Button>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <Card title="Meter distribution by type">
              <div className="space-y-5 py-2">
                {Object.entries(data.types).map(([type, count]: any) => {
                  const pct = data.total
                    ? Math.max(3, (count / data.total) * 100)
                    : 0;
                  return (
                    <div key={type}>
                      <div className="mb-2 flex justify-between text-sm">
                        <span>{pretty(type)} meters</span>
                        <strong>{count}</strong>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-aqua-600"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {!Object.keys(data.types).length && (
                  <Empty text="No registered meters yet." />
                )}
              </div>
            </Card>
            <Card title="Recent meter activity">
              {data.recent.length ? (
                <Table
                  headers={[
                    "Meter",
                    "Assigned to",
                    "Activity",
                    "Status",
                    "Date",
                  ]}
                >
                  {data.recent.map((event: AnyRecord) => (
                    <tr key={event.eventId}>
                      <td className={`${TD} font-medium text-slate-800`}>
                        <Link
                          className="text-aqua-700 hover:underline"
                          to={meterUrl(event.meter)}
                        >
                          {event.meter.meterNumber}
                        </Link>
                      </td>
                      <td className={TD}>
                        {event.meter.assignedTo ?? "In store"}
                      </td>
                      <td className={TD}>{pretty(event.eventType)}</td>
                      <td className={TD}>
                        <Status value={event.newStatus ?? event.meter.status} />
                      </td>
                      <td className={TD}>{formatDate(event.eventDate)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty text="Recent activity will appear here." />
              )}
            </Card>
          </div>
          {/* <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <LinkButton to="/meters/list">Meter register</LinkButton>
            <LinkButton to="/meters/replacements" tone="orange">
              Replacement approvals
            </LinkButton>
            <LinkButton to="/meters/reports/exceptions" tone="teal">
              Exception report
            </LinkButton>
            <LinkButton to="/meters/import" tone="green">
              Bulk import
            </LinkButton>
            <LinkButton to="/meters/alerts" tone="red">
              Exception alerts
            </LinkButton>
            <Button
              tone="slate"
              onClick={async () => {
                const meters = await api.listMeters();
                await exportExcel(
                  "meter-register.xlsx",
                  "Meters",
                  meters.map((m: AnyRecord) => ({
                    Meter: m.meterNumber,
                    Type: m.meterType,
                    SizeMM: m.meterSizeMm,
                    AssignedTo: m.assignedTo ?? "",
                    Status: m.status,
                  })),
                );
              }}
            >
              Export register
            </Button>
          </div> */}
        </>
      )}
    </Page>
  );
}

const emptyMeter = {
  meterType: "CUSTOMER",
  technology: "MANUAL",
  brand: "",
  model: "",
  meterSizeMm: "15",
  serialNumber: "",
  openingReading: "0",
  purchaseDate: "",
  warrantyExpiryDate: "",
  storageLocation: "",
  installationStatus: "IN_STORE",
  installationDate: "",
  gpsLatitude: "",
  gpsLongitude: "",
  sealNumber: "",
  remarks: "",
  status: "IN_STOCK",
};

export function RegisterMeter() {
  const [form, setForm] = useState<AnyRecord>(emptyMeter);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const update = (key: string, value: string) =>
    setForm((old: AnyRecord) => ({ ...old, [key]: value }));
  async function submit(event: FormEvent, another = false) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const meter = await api.createMeter({
        ...form,
        meterSizeMm: Number(form.meterSizeMm),
        openingReading: Number(form.openingReading),
        gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
        gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
        installationDate: form.installationDate || undefined,
      });
      if (another) setForm(emptyMeter);
      else navigate(meterUrl(meter));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page title="Register water meter" subtitle="Add a new meter to inventory">
      <Card title="Meter information">
        <form onSubmit={(e) => submit(e)}>
          {error && <Notice>{error}</Notice>}
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            The meter number will be generated automatically when this meter is saved.
          </div>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Meter type" required>
              <SearchableSelect
                className={INPUT}
                value={form.meterType}
                onChange={(e) => update("meterType", e.target.value)}
              >
                {["CUSTOMER", "BULK", "ZONE", "BOREHOLE"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Technology" required>
              <SearchableSelect
                className={INPUT}
                value={form.technology}
                onChange={(e) => update("technology", e.target.value)}
              >
                {["MANUAL", "PREPAID", "SMART"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Brand">
              <input
                className={INPUT}
                value={form.brand}
                onChange={(e) => update("brand", e.target.value)}
                placeholder="Zenner"
              />
            </Field>
            <Field label="Model">
              <input
                className={INPUT}
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="ZR-15"
              />
            </Field>
            <Field label="Meter size (mm)" required>
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                className={INPUT}
                value={form.meterSizeMm}
                onChange={(e) => update("meterSizeMm", e.target.value)}
              />
            </Field>
            <Field label="Serial number">
              <input
                className={INPUT}
                value={form.serialNumber}
                onChange={(e) => update("serialNumber", e.target.value)}
              />
            </Field>
            <Field label="Opening reading" required>
              <input
                required
                min="0"
                step="0.001"
                type="number"
                className={INPUT}
                value={form.openingReading}
                onChange={(e) => update("openingReading", e.target.value)}
              />
            </Field>
            <Field label="Purchase date">
              <input
                type="date"
                className={INPUT}
                value={form.purchaseDate}
                onChange={(e) => update("purchaseDate", e.target.value)}
              />
            </Field>
            <Field label="Warranty expiry date">
              <input
                type="date"
                min={form.purchaseDate || undefined}
                className={INPUT}
                value={form.warrantyExpiryDate}
                onChange={(e) => update("warrantyExpiryDate", e.target.value)}
              />
            </Field>
            <Field label="Storage location">
              <input
                className={INPUT}
                value={form.storageLocation}
                onChange={(e) => update("storageLocation", e.target.value)}
                placeholder="Main Store"
              />
            </Field>
            <Field label="Installation status" required>
              <SearchableSelect
                className={INPUT}
                value={form.installationStatus}
                onChange={(e) => update("installationStatus", e.target.value)}
              >
                {["IN_STORE", "INSTALLED", "REMOVED"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Current status" required>
              <SearchableSelect
                className={INPUT}
                value={form.status}
                onChange={(e) => update("status", e.target.value)}
              >
                {[
                  "IN_STOCK",
                  "ACTIVE",
                  "FAULTY",
                  "TAMPERED",
                  "INACTIVE",
                  "REMOVED",
                  "REPLACED",
                  "DISCONNECTED",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Seal number">
              <input
                className={INPUT}
                value={form.sealNumber}
                onChange={(e) => update("sealNumber", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GPS latitude">
                <input
                  type="number"
                  step="any"
                  className={INPUT}
                  value={form.gpsLatitude}
                  onChange={(e) => update("gpsLatitude", e.target.value)}
                />
              </Field>
              <Field label="GPS longitude">
                <input
                  type="number"
                  step="any"
                  className={INPUT}
                  value={form.gpsLongitude}
                  onChange={(e) => update("gpsLongitude", e.target.value)}
                />
              </Field>
            </div>
            <GpsMap
              latitude={form.gpsLatitude}
              longitude={form.gpsLongitude}
              label="Meter location"
              className="md:col-span-2 xl:col-span-3"
            />
            <div className="md:col-span-2 xl:col-span-3">
              <Field label="Remarks">
                <textarea
                  rows={2}
                  className={`${INPUT} min-h-16 resize-y`}
                  value={form.remarks}
                  onChange={(e) => update("remarks", e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" tone="slate" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button disabled={saving}>
              {saving ? "Saving…" : "Save meter"}
            </Button>
            <Button
              type="button"
              tone="green"
              disabled={saving}
              onClick={(e) => submit(e as any, true)}
            >
              Save & add another
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}

export function MeterList() {
  const [meters, setMeters] = useState<AnyRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 25;
  const [zones, setZones] = useState<AnyRecord[]>([]);
  const [filters, setFilters] = useState({
    search: "",
    type: "",
    status: "",
    zoneId: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  function load(nextPage = page) {
    setLoading(true);
    Promise.all([
      api.listMeters({
        ...filters,
        page: String(nextPage),
        pageSize: String(pageSize),
      }),
      zones.length ? Promise.resolve(zones) : api.listZones(),
    ])
      .then(([result, z]) => {
        setMeters(result.items ?? []);
        setPage(Number(result.page ?? nextPage));
        setTotal(Number(result.total ?? 0));
        setTotalPages(Number(result.totalPages ?? 1));
        setZones(z);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load(1);
  }, []);
  return (
    <Page
      title="Meter register"
      subtitle={`${total.toLocaleString()} meters found`}
      actions={
        <>
          <LinkButton to="/meters/register">Register meter</LinkButton>
          <LinkButton to="/meters/assign" tone="green">
            Assign meter
          </LinkButton>
        </>
      }
    >
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Search">
            <input
              className={INPUT}
              placeholder="Meter, serial or customer"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && load(1)}
            />
          </Field>
          <Field label="Type">
            <SearchableSelect
              className={INPUT}
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="">All types</option>
              {["CUSTOMER", "BULK", "ZONE", "BOREHOLE"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Status">
            <SearchableSelect
              className={INPUT}
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              <option value="">All statuses</option>
              {[
                "IN_STOCK",
                "ACTIVE",
                "FAULTY",
                "TAMPERED",
                "INACTIVE",
                "REPLACED",
                "DISCONNECTED",
                "REMOVED",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Zone">
            <SearchableSelect
              className={INPUT}
              value={filters.zoneId}
              onChange={(e) =>
                setFilters({ ...filters, zoneId: e.target.value })
              }
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={z.zoneId}>
                  {z.zoneName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => load(1)}>
              Search
            </Button>
          </div>
        </div>
      </Card>
      {error && <Notice>{error}</Notice>}
      <Card>
        {loading ? (
          <Spinner />
        ) : meters.length ? (
          <Table
            headers={[
              "Meter no.",
              "Type",
              "Size",
              "Assigned to",
              "Zone",
              "Status",
              "Action",
            ]}
          >
            {meters.map((m) => (
              <tr key={m.meterId} className="hover:bg-slate-50">
                <td className={`${TD} font-semibold text-slate-800`}>
                  {m.meterNumber}
                </td>
                <td className={TD}>{pretty(m.meterType)}</td>
                <td className={TD}>{displaySize(m.meterSizeMm)}</td>
                <td className={TD}>{m.assignedTo ?? "—"}</td>
                <td className={TD}>{assignmentZone(m)}</td>
                <td className={TD}>
                  <Status value={m.status} />
                </td>
                <td className={TD}>
                  <Link
                    className="font-semibold text-aqua-700 hover:underline"
                    to={meterUrl(m)}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="No meters match these filters." />
        )}
        {total > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            disabled={loading}
            label="meters"
            onPageChange={load}
          />
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            tone="teal"
            onClick={() =>
              exportExcel(
                "meter-register.xlsx",
                "Meter Register",
                meters.map((m) => ({
                  MeterNumber: m.meterNumber,
                  Type: m.meterType,
                  SizeMM: m.meterSizeMm,
                  AssignedTo: m.assignedTo ?? "",
                  Zone: assignmentZone(m),
                  Status: m.status,
                })),
              )
            }
          >
            Export Excel
          </Button>
          <Button tone="slate" onClick={() => window.print()}>
            Print register
          </Button>
        </div>
      </Card>
    </Page>
  );
}

function useMeterParam() {
  const { id = "" } = useParams();
  return String(decodeId(id) || id);
}

export function AssignMeter({
  nonCustomer = false,
}: {
  nonCustomer?: boolean;
}) {
  const [meters, setMeters] = useState<AnyRecord[]>([]);
  const [accounts, setAccounts] = useState<AnyRecord[]>([]);
  const [zones, setZones] = useState<AnyRecord[]>([]);
  const [boreholes, setBoreholes] = useState<AnyRecord[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [evidence, setEvidence] = useState<MeterEvidenceInput[]>([]);
  const [boreholeOpen, setBoreholeOpen] = useState(false);
  const [savingBorehole, setSavingBorehole] = useState(false);
  const [boreholeForm, setBoreholeForm] = useState({
    boreholeCode: "",
    boreholeName: "",
    zoneId: "",
    gpsLatitude: "",
    gpsLongitude: "",
    depthMetres: "",
    ratedCapacity: "",
    commissioningDate: "",
  });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState<AnyRecord>({
    meterId: params.get("meterId") ?? "",
    targetType: nonCustomer ? "zone" : "account",
    accountId: "",
    zoneId: "",
    boreholeId: "",
    assignmentDate: new Date().toISOString().slice(0, 10),
    openingReading: "0",
    gpsLatitude: "",
    gpsLongitude: "",
    sealNumber: "",
    installationPoint: "",
    remarks: "",
  });
  useEffect(() => {
    Promise.all([
      api.listMeters({ status: "IN_STOCK" }),
      api.listMeterAccounts(),
      api.listZones(),
      api.listBoreholes(),
    ])
      .then(([m, a, z, b]) => {
        setMeters(m);
        setAccounts(a);
        setZones(z);
        setBoreholes(b);
      })
      .catch((e) => setError(e.message));
  }, []);
  const chosenMeter = meters.find((m) => String(m.meterId) === form.meterId);
  const account = accounts.find((a) => String(a.accountId) === form.accountId);
  async function createBorehole() {
    setSavingBorehole(true);
    setError("");
    try {
      const created = await api.createBorehole({
        ...boreholeForm,
        depthMetres: boreholeForm.depthMetres || undefined,
        ratedCapacity: boreholeForm.ratedCapacity || undefined,
        commissioningDate: boreholeForm.commissioningDate || undefined,
      });
      setBoreholes((items) =>
        [...items, created].sort((a, b) =>
          String(a.boreholeName).localeCompare(String(b.boreholeName)),
        ),
      );
      setForm((current: AnyRecord) => ({
        ...current,
        boreholeId: String(created.boreholeId),
      }));
      setBoreholeOpen(false);
      setBoreholeForm({
        boreholeCode: "",
        boreholeName: "",
        zoneId: "",
        gpsLatitude: "",
        gpsLongitude: "",
        depthMetres: "",
        ratedCapacity: "",
        commissioningDate: "",
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingBorehole(false);
    }
  }
  async function addFile(
    file: File | undefined,
    type: MeterEvidenceInput["evidenceType"],
  ) {
    if (!file) return;
    try {
      const item = await fileToEvidence(file, type);
      setEvidence((items) => [
        ...items.filter((old) => old.evidenceType !== type),
        item,
      ]);
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function submit(e: FormEvent, openInstallation = true) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.assignMeter({
        meterId: form.meterId,
        accountId: form.targetType === "account" ? form.accountId : undefined,
        zoneId: form.targetType === "zone" ? form.zoneId : undefined,
        boreholeId:
          form.targetType === "borehole" ? form.boreholeId : undefined,
        assignmentDate: form.assignmentDate,
        openingReading: Number(form.openingReading),
        gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
        gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
        sealNumber: form.sealNumber || undefined,
        installationPoint: form.installationPoint || undefined,
        remarks: form.remarks || undefined,
        evidence,
        materials: [],
      });
      navigate(
        openInstallation
          ? `/meters/${encodeId(form.meterId)}/installation`
          : `/meters/${encodeId(form.meterId)}`,
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title={
        nonCustomer
          ? "Bulk / zone / borehole meter assignment"
          : "Assign meter to customer"
      }
      subtitle="Install an in-store meter and create its active assignment"
      actions={
        <LinkButton
          to={nonCustomer ? "/meters/assign" : "/meters/assign/non-customer"}
          tone="teal"
        >
          {nonCustomer ? "Customer assignment" : "Non-customer assignment"}
        </LinkButton>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {error && <Notice>{error}</Notice>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-aqua-50/80 to-white px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-aqua-700 text-sm font-extrabold text-white shadow-sm">
              1
            </span>
            <div>
              <h2 className="font-bold text-slate-900">
                {nonCustomer ? "Assignment destination" : "Customer account"}
              </h2>
              <p className="text-xs text-slate-500">
                {nonCustomer
                  ? "Choose the operational location for this meter."
                  : "Find and confirm the account receiving this meter."}
              </p>
            </div>
          </div>
          <div className="grid gap-x-4 gap-y-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {!nonCustomer && (
              <div>
                <Field label="Search customer">
                  <div className="flex gap-2">
                    <input
                      className={INPUT}
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                      placeholder="Account, name or phone"
                    />
                    <Button
                      type="button"
                      onClick={() =>
                        api.listMeterAccounts(accountSearch).then(setAccounts)
                      }
                    >
                      Search
                    </Button>
                  </div>
                </Field>
              </div>
            )}
            {!nonCustomer && (
              <Field label="Customer account" required>
                <SearchableSelect
                  required
                  className={INPUT}
                  value={form.accountId}
                  onChange={(e) =>
                    setForm({ ...form, accountId: e.target.value })
                  }
                >
                  <option value="">Select customer account</option>
                  {accounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.accountNumber} · {a.customerName}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
            )}
            {nonCustomer && (
              <Field label="Assign to" required>
                <SearchableSelect
                  className={INPUT}
                  value={form.targetType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      targetType: e.target.value,
                      zoneId: "",
                      boreholeId: "",
                    })
                  }
                >
                  <option value="zone">Zone</option>
                  <option value="borehole">Borehole</option>
                </SearchableSelect>
              </Field>
            )}
            {!nonCustomer && (
              <Field label="Customer name">
                <input
                  disabled
                  className={INPUT}
                  value={account?.customerName ?? ""}
                />
              </Field>
            )}
            {!nonCustomer && (
              <Field label="Zone">
                <input
                  disabled
                  className={INPUT}
                  value={account?.property?.zone?.zoneName ?? ""}
                />
              </Field>
            )}
            {!nonCustomer && (
              <Field label="Route">
                <input
                  disabled
                  className={INPUT}
                  value={account?.property?.route?.routeName ?? ""}
                />
              </Field>
            )}
            {nonCustomer && form.targetType === "zone" && (
              <Field label="Zone" required>
                <SearchableSelect
                  required
                  className={INPUT}
                  value={form.zoneId}
                  onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
                >
                  <option value="">Select zone</option>
                  {zones.map((z) => (
                    <option key={z.zoneId} value={z.zoneId}>
                      {z.zoneName}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
            )}
            {nonCustomer && form.targetType === "borehole" && (
              <Field label="Borehole" required>
                <SearchableSelect
                  required
                  className={INPUT}
                  value={form.boreholeId}
                  onChange={(e) =>
                    setForm({ ...form, boreholeId: e.target.value })
                  }
                >
                  <option value="">Select borehole</option>
                  {boreholes.map((b) => (
                    <option key={b.boreholeId} value={b.boreholeId}>
                      {b.boreholeName}
                    </option>
                  ))}
                </SearchableSelect>
                <button
                  type="button"
                  onClick={() => setBoreholeOpen(true)}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-aqua-700 transition hover:text-aqua-900 hover:underline"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-aqua-50 text-sm">
                    +
                  </span>
                  Create borehole
                </button>
              </Field>
            )}
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-sky-50/80 to-white px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-700 text-sm font-extrabold text-white shadow-sm">
              2
            </span>
            <div>
              <h2 className="font-bold text-slate-900">
                Meter and installation
              </h2>
              <p className="text-xs text-slate-500">
                Select an available meter and record its opening installation
                details.
              </p>
            </div>
          </div>
          <div className="grid gap-x-4 gap-y-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Meter" required>
              <SearchableSelect
                required
                className={INPUT}
                value={form.meterId}
                onChange={(e) => setForm({ ...form, meterId: e.target.value })}
              >
                <option value="">Select in-store meter</option>
                {meters
                  .filter((m) =>
                    nonCustomer
                      ? m.meterType !== "CUSTOMER"
                      : m.meterType === "CUSTOMER",
                  )
                  .map((m) => (
                    <option key={m.meterId} value={m.meterId}>
                      {m.meterNumber} · {displaySize(m.meterSizeMm)}
                    </option>
                  ))}
              </SearchableSelect>
            </Field>
            <Field label="Meter type">
              <input
                disabled
                className={INPUT}
                value={chosenMeter ? pretty(chosenMeter.meterType) : ""}
              />
            </Field>
            <Field label="Meter size">
              <input
                disabled
                className={INPUT}
                value={chosenMeter ? displaySize(chosenMeter.meterSizeMm) : ""}
              />
            </Field>
            <Field label="Installation date" required>
              <input
                required
                type="date"
                className={INPUT}
                value={form.assignmentDate}
                onChange={(e) =>
                  setForm({ ...form, assignmentDate: e.target.value })
                }
              />
            </Field>
            <Field label="Opening reading" required>
              <input
                required
                min="0"
                step="0.001"
                type="number"
                className={INPUT}
                value={form.openingReading}
                onChange={(e) =>
                  setForm({ ...form, openingReading: e.target.value })
                }
              />
            </Field>
            <Field label="Installed by">
              <input
                disabled
                className={INPUT}
                value="Current authenticated user"
              />
            </Field>
            <Field label="Installation point">
              <input
                className={INPUT}
                value={form.installationPoint}
                onChange={(e) =>
                  setForm({ ...form, installationPoint: e.target.value })
                }
                placeholder={nonCustomer ? "Main inlet line" : "Meter location"}
              />
            </Field>
            <Field label="Seal number">
              <input
                className={INPUT}
                value={form.sealNumber}
                onChange={(e) =>
                  setForm({ ...form, sealNumber: e.target.value })
                }
              />
            </Field>
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-sm font-extrabold text-white shadow-sm">
              3
            </span>
            <div>
              <h2 className="font-bold text-slate-900">
                Location and evidence
              </h2>
              <p className="text-xs text-slate-500">
                Capture the site coordinates and supporting installation
                evidence.
              </p>
            </div>
          </div>
          <div className="grid items-start gap-x-4 gap-y-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid grid-cols-2 gap-3">
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
                <input
                  type="number"
                  step="any"
                  className={INPUT}
                  value={form.gpsLongitude}
                  onChange={(e) =>
                    setForm({ ...form, gpsLongitude: e.target.value })
                  }
                />
              </Field>
            </div>
            <GpsMap
              latitude={form.gpsLatitude}
              longitude={form.gpsLongitude}
              label="Installation location"
            />
            <Field label="Meter photo">
              <input
                type="file"
                accept="image/*"
                className={INPUT}
                onChange={(e) =>
                  addFile(e.target.files?.[0], "INSTALLATION_PHOTO")
                }
              />
              <span className="mt-1 block text-xs text-emerald-600">
                {
                  evidence.find(
                    (item) => item.evidenceType === "INSTALLATION_PHOTO",
                  )?.fileName
                }
              </span>
            </Field>
            {!nonCustomer && (
              <Field label="Customer signature">
                <input
                  type="file"
                  accept="image/*"
                  className={INPUT}
                  onChange={(e) =>
                    addFile(e.target.files?.[0], "CUSTOMER_SIGNATURE")
                  }
                />
                <span className="mt-1 block text-xs text-emerald-600">
                  {
                    evidence.find(
                      (item) => item.evidenceType === "CUSTOMER_SIGNATURE",
                    )?.fileName
                  }
                </span>
              </Field>
            )}
            <div className="md:col-span-2 xl:col-span-3">
              <Field label="Remarks">
                <textarea
                  rows={2}
                  className={`${INPUT} min-h-14 resize-y`}
                  value={form.remarks}
                  onChange={(e) =>
                    setForm({ ...form, remarks: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>
        </section>
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-sm text-slate-600">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 font-bold text-sky-700">
              i
            </span>
            <p>
              The selected meter is verified as in stock and without an active
              assignment before saving.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button type="button" tone="slate" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="button"
              tone="green"
              disabled={saving || !form.meterId}
              onClick={(e) => submit(e as any, false)}
            >
              Assign meter
            </Button>
            <Button disabled={saving || !form.meterId}>
              {saving ? "Assigning…" : "Create installation record"}
            </Button>
          </div>
        </div>
      </form>
      {boreholeOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Create borehole"
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setBoreholeOpen(false)}
          />
          <section className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 bg-gradient-to-r from-aqua-50 to-white px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-aqua-700">
                  New water source
                </div>
                <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                  Create borehole
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Register the source, operational zone and exact GPS position.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBoreholeOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-2xl text-slate-500 hover:bg-white"
              >
                ×
              </button>
            </header>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Borehole code" required>
                <input
                  className={INPUT}
                  value={boreholeForm.boreholeCode}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      boreholeCode: e.target.value,
                    })
                  }
                  placeholder="BH-001"
                />
              </Field>
              <Field label="Borehole name" required>
                <input
                  className={INPUT}
                  value={boreholeForm.boreholeName}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      boreholeName: e.target.value,
                    })
                  }
                  placeholder="Borehole name"
                />
              </Field>
              <Field label="Zone" required>
                <SearchableSelect
                  className={INPUT}
                  value={boreholeForm.zoneId}
                  onChange={(e) =>
                    setBoreholeForm({ ...boreholeForm, zoneId: e.target.value })
                  }
                >
                  <option value="">Select zone</option>
                  {zones.map((zone) => (
                    <option key={zone.zoneId} value={zone.zoneId}>
                      {zone.zoneName}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
              <Field label="Commissioning date">
                <input
                  type="date"
                  className={INPUT}
                  value={boreholeForm.commissioningDate}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      commissioningDate: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="GPS latitude" required>
                <input
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  className={INPUT}
                  value={boreholeForm.gpsLatitude}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      gpsLatitude: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="GPS longitude" required>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  className={INPUT}
                  value={boreholeForm.gpsLongitude}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      gpsLongitude: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Depth (metres)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={INPUT}
                  value={boreholeForm.depthMetres}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      depthMetres: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Capacity (m³/hour)">
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  className={INPUT}
                  value={boreholeForm.ratedCapacity}
                  onChange={(e) =>
                    setBoreholeForm({
                      ...boreholeForm,
                      ratedCapacity: e.target.value,
                    })
                  }
                />
              </Field>
              <GpsMap
                latitude={boreholeForm.gpsLatitude}
                longitude={boreholeForm.gpsLongitude}
                label="Borehole location"
                className="md:col-span-2"
                empty
              />
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <Button
                type="button"
                tone="slate"
                onClick={() => setBoreholeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                tone="green"
                disabled={
                  savingBorehole ||
                  !boreholeForm.boreholeCode ||
                  !boreholeForm.boreholeName ||
                  !boreholeForm.zoneId ||
                  !boreholeForm.gpsLatitude ||
                  !boreholeForm.gpsLongitude
                }
                onClick={() => void createBorehole()}
              >
                {savingBorehole ? "Creating…" : "Create and select"}
              </Button>
            </footer>
          </section>
        </div>
      )}
    </Page>
  );
}

function MeterSummary({ meter }: { meter: AnyRecord }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[
        ["Type", pretty(meter.meterType)],
        ["Size", displaySize(meter.meterSizeMm)],
        ["Brand", meter.brand || "—"],
        ["Model", meter.model || "—"],
        ["Serial no.", meter.serialNumber || "—"],
        ["Opening reading", Number(meter.openingReading).toLocaleString()],
      ].map(([label, value]) => (
        <div key={label} className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="mt-1 font-semibold text-slate-800">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function MeterProfile() {
  const id = useMeterParam();
  const [meter, setMeter] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AnyRecord>({});

  function load() {
    setError("");
    return api
      .getMeter(id)
      .then(setMeter)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, [id]);

  function beginEdit() {
    if (!meter) return;
    setError("");
    setMessage("");
    setForm({
      meterNumber: meter.meterNumber ?? "",
      meterType: meter.meterType ?? "CUSTOMER",
      technology: meter.technology ?? "MANUAL",
      brand: meter.brand ?? "",
      model: meter.model ?? "",
      meterSizeMm: String(meter.meterSizeMm ?? ""),
      serialNumber: meter.serialNumber ?? "",
      openingReading: String(meter.openingReading ?? 0),
      purchaseDate: meter.purchaseDate?.slice(0, 10) ?? "",
      warrantyExpiryDate: meter.warrantyExpiryDate?.slice(0, 10) ?? "",
      storageLocation: meter.storageLocation ?? "",
      gpsLatitude: meter.gpsLatitude ?? "",
      gpsLongitude: meter.gpsLongitude ?? "",
      sealNumber: meter.sealNumber ?? "",
      remarks: meter.remarks ?? "",
    });
    setEditing(true);
  }

  function update(key: string, value: string) {
    setForm((old: AnyRecord) => ({ ...old, [key]: value }));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await api.updateMeter(id, {
        ...form,
        meterSizeMm: Number(form.meterSizeMm),
        openingReading: Number(form.openingReading),
      });
      setMeter(updated);
      setEditing(false);
      setMessage("Meter details updated successfully.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="Meter profile"
      subtitle="Current inventory, assignment, readings and lifecycle information"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      {!meter ? (
        <Spinner />
      ) : (
        <Card>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900">
                {meter.meterNumber}
              </h2>
              <Status value={meter.status} />
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {pretty(meter.installationStatus)}
              </span>
            </div>
            {!editing && (
              <Button type="button" tone="blue" onClick={beginEdit}>
                Edit meter
              </Button>
            )}
          </div>

          {editing && (
            <form
              onSubmit={saveProfile}
              className="mb-6 rounded-xl border border-aqua-200 bg-slate-50 p-4"
            >
              <div className="mb-3">
                <h3 className="font-semibold text-slate-900">
                  Edit meter details
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Status, assignment and installation changes use their separate
                  lifecycle actions below.
                </p>
              </div>
              <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Meter number" required>
                  <input
                    required
                    className={INPUT}
                    value={form.meterNumber}
                    onChange={(e) => update("meterNumber", e.target.value)}
                  />
                </Field>
                <Field label="Meter type" required>
                  <SearchableSelect
                    className={INPUT}
                    value={form.meterType}
                    onChange={(e) => update("meterType", e.target.value)}
                  >
                    {["CUSTOMER", "BULK", "ZONE", "BOREHOLE"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </SearchableSelect>
                </Field>
                <Field label="Technology" required>
                  <SearchableSelect
                    className={INPUT}
                    value={form.technology}
                    onChange={(e) => update("technology", e.target.value)}
                  >
                    {["MANUAL", "PREPAID", "SMART"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </SearchableSelect>
                </Field>
                <Field label="Brand">
                  <input
                    className={INPUT}
                    value={form.brand}
                    onChange={(e) => update("brand", e.target.value)}
                  />
                </Field>
                <Field label="Model">
                  <input
                    className={INPUT}
                    value={form.model}
                    onChange={(e) => update("model", e.target.value)}
                  />
                </Field>
                <Field label="Meter size (mm)" required>
                  <input
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    className={INPUT}
                    value={form.meterSizeMm}
                    onChange={(e) => update("meterSizeMm", e.target.value)}
                  />
                </Field>
                <Field label="Serial number">
                  <input
                    className={INPUT}
                    value={form.serialNumber}
                    onChange={(e) => update("serialNumber", e.target.value)}
                  />
                </Field>
                <Field label="Opening reading" required>
                  <input
                    required
                    disabled={Boolean(meter.latestReading)}
                    min="0"
                    step="0.001"
                    type="number"
                    className={INPUT}
                    value={form.openingReading}
                    onChange={(e) => update("openingReading", e.target.value)}
                  />
                </Field>
                <Field label="Storage location">
                  <input
                    className={INPUT}
                    value={form.storageLocation}
                    onChange={(e) => update("storageLocation", e.target.value)}
                  />
                </Field>
                <Field label="Purchase date">
                  <input
                    type="date"
                    className={INPUT}
                    value={form.purchaseDate}
                    onChange={(e) => update("purchaseDate", e.target.value)}
                  />
                </Field>
                <Field label="Warranty expiry date">
                  <input
                    type="date"
                    min={form.purchaseDate || undefined}
                    className={INPUT}
                    value={form.warrantyExpiryDate}
                    onChange={(e) =>
                      update("warrantyExpiryDate", e.target.value)
                    }
                  />
                </Field>
                <Field label="Seal number">
                  <input
                    className={INPUT}
                    value={form.sealNumber}
                    onChange={(e) => update("sealNumber", e.target.value)}
                  />
                </Field>
                <Field label="GPS latitude">
                  <input
                    min="-90"
                    max="90"
                    step="any"
                    type="number"
                    className={INPUT}
                    value={form.gpsLatitude}
                    onChange={(e) => update("gpsLatitude", e.target.value)}
                  />
                </Field>
                <Field label="GPS longitude">
                  <input
                    min="-180"
                    max="180"
                    step="any"
                    type="number"
                    className={INPUT}
                    value={form.gpsLongitude}
                    onChange={(e) => update("gpsLongitude", e.target.value)}
                  />
                </Field>
                <GpsMap
                  latitude={form.gpsLatitude}
                  longitude={form.gpsLongitude}
                  label="Meter location"
                  className="md:col-span-2"
                />
                <Field label="Remarks">
                  <input
                    className={INPUT}
                    value={form.remarks}
                    onChange={(e) => update("remarks", e.target.value)}
                  />
                </Field>
              </div>
              {meter.latestReading && (
                <p className="mt-3 text-sm text-amber-700">
                  Opening reading is locked because this meter already has
                  reading history.
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  tone="slate"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" tone="green" disabled={saving}>
                  {saving ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </form>
          )}
          <MeterSummary meter={meter} />
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800">
                Current assignment
              </h3>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                <p>
                  Assigned to:{" "}
                  <strong>{meter.assignedTo ?? "Not assigned"}</strong>
                </p>
                <p>
                  Account: {meter.assignment?.account?.accountNumber ?? "—"}
                </p>
                <p>Zone: {assignmentZone(meter)}</p>
                <p>
                  Route:{" "}
                  {meter.assignment?.account?.property?.route?.routeName ?? "—"}
                </p>
                <p>Installed: {formatDate(meter.installationDate)}</p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800">Latest reading</h3>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                {meter.latestReading ? (
                  <>
                    <p>
                      Previous:{" "}
                      {Number(
                        meter.latestReading.previousReading,
                      ).toLocaleString()}
                    </p>
                    <p>
                      Current:{" "}
                      {Number(
                        meter.latestReading.currentReading,
                      ).toLocaleString()}
                    </p>
                    <p>
                      Consumption:{" "}
                      {Number(meter.latestReading.consumption).toLocaleString()}{" "}
                      units
                    </p>
                    <p>
                      Read on: {formatDate(meter.latestReading.readingDate)}
                    </p>
                  </>
                ) : (
                  <p>No readings have been recorded.</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800">
                Inventory details
              </h3>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                <p>Purchased: {formatDate(meter.purchaseDate)}</p>
                <p>Warranty expires: {formatDate(meter.warrantyExpiryDate)}</p>
                <p>Storage: {meter.storageLocation ?? "—"}</p>
                <p>Seal: {meter.sealNumber ?? "—"}</p>
                <p>Remarks: {meter.remarks ?? "—"}</p>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <LinkButton to={`/meters/${encodeId(id)}/history`}>
              View readings
            </LinkButton>
            <LinkButton
              to={`/meters/${encodeId(id)}/status?status=FAULTY`}
              tone="orange"
            >
              Report fault
            </LinkButton>
            <LinkButton to={`/meters/${encodeId(id)}/replace`} tone="red">
              Replace meter
            </LinkButton>
            <LinkButton to={`/meters/${encodeId(id)}/history`} tone="teal">
              View history
            </LinkButton>
            <LinkButton
              to={`/meters/${encodeId(id)}/status?status=INACTIVE`}
              tone="orange"
            >
              Deactivate
            </LinkButton>
            {meter.assignment ? (
              <LinkButton
                to={`/meters/${encodeId(id)}/installation`}
                tone="green"
              >
                Installation
              </LinkButton>
            ) : (
              <LinkButton
                to={`${meter.meterType === "CUSTOMER" ? "/meters/assign" : "/meters/assign/non-customer"}?meterId=${encodeURIComponent(String(meter.meterId))}`}
                tone="green"
              >
                Assign meter
              </LinkButton>
            )}
          </div>
        </Card>
      )}
    </Page>
  );
}

export function InstallationDetails() {
  const id = useMeterParam();
  const [meter, setMeter] = useState<AnyRecord | null>(null);
  const [form, setForm] = useState<AnyRecord>({
    installationDate: "",
    openingReading: "0",
    installationPoint: "",
    sealNumber: "",
    gpsLatitude: "",
    gpsLongitude: "",
    remarks: "",
  });
  const [materials, setMaterials] = useState<AnyRecord[]>([]);
  const [evidence, setEvidence] = useState<MeterEvidenceInput[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function load() {
    api
      .getMeter(id)
      .then((item) => {
        setMeter(item);
        setForm({
          installationDate: item.installationDate?.slice(0, 10) ?? "",
          openingReading: String(item.openingReading ?? 0),
          installationPoint: item.assignment?.installationPoint ?? "",
          sealNumber: item.sealNumber ?? "",
          gpsLatitude: item.gpsLatitude ?? "",
          gpsLongitude: item.gpsLongitude ?? "",
          remarks: item.assignment?.remarks ?? "",
        });
        setMaterials(item.materials ?? []);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, [id]);
  async function addFile(
    file: File | undefined,
    type: MeterEvidenceInput["evidenceType"],
  ) {
    if (!file) return;
    try {
      const item = await fileToEvidence(file, type);
      setEvidence((items) => [
        ...items.filter((old) => old.evidenceType !== type),
        item,
      ]);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function save() {
    setError("");
    setMessage("");
    try {
      await api.updateMeterInstallation(id, {
        ...form,
        openingReading: Number(form.openingReading),
        gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
        gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
        evidence,
        materials: materials
          .filter((item) => item.materialName)
          .map((item) => ({
            materialName: item.materialName,
            quantity: Number(item.quantity),
            unit: item.unit,
            remarks: item.remarks,
          })),
      });
      setEvidence([]);
      setMessage("Installation details, evidence and materials saved.");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const existingPhoto = meter?.evidence?.find(
    (item: AnyRecord) => item.evidenceType === "INSTALLATION_PHOTO",
  );
  const existingSignature = meter?.evidence?.find(
    (item: AnyRecord) => item.evidenceType === "CUSTOMER_SIGNATURE",
  );
  return (
    <Page
      title="Meter installation details"
      actions={
        <Button tone="slate" onClick={() => window.print()}>
          Print installation form
        </Button>
      }
    >
      {!meter ? (
        <Spinner />
      ) : (
        <Card title="Installation record">
          {error && <Notice>{error}</Notice>}
          {message && <Notice kind="success">{message}</Notice>}
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Installation reference">
              <input
                disabled
                className={INPUT}
                value={`INST-${String(meter.meterId).padStart(6, "0")}`}
              />
            </Field>
            <Field label="Customer account">
              <input
                disabled
                className={INPUT}
                value={meter.assignment?.account?.accountNumber ?? "—"}
              />
            </Field>
            <Field label="Customer name">
              <input
                disabled
                className={INPUT}
                value={meter.assignedTo ?? "—"}
              />
            </Field>
            <Field label="Meter number">
              <input disabled className={INPUT} value={meter.meterNumber} />
            </Field>
            <Field label="Installation date" required>
              <input
                type="date"
                className={INPUT}
                value={form.installationDate}
                onChange={(e) =>
                  setForm({ ...form, installationDate: e.target.value })
                }
              />
            </Field>
            <Field label="Opening reading" required>
              <input
                type="number"
                min="0"
                step="0.001"
                className={INPUT}
                value={form.openingReading}
                onChange={(e) =>
                  setForm({ ...form, openingReading: e.target.value })
                }
              />
            </Field>
            <Field label="Installed by">
              <input
                disabled
                className={INPUT}
                value="Authenticated field user"
              />
            </Field>
            <Field label="Installation point">
              <input
                className={INPUT}
                value={form.installationPoint}
                onChange={(e) =>
                  setForm({ ...form, installationPoint: e.target.value })
                }
              />
            </Field>
            <Field label="Meter seal number">
              <input
                className={INPUT}
                value={form.sealNumber}
                onChange={(e) =>
                  setForm({ ...form, sealNumber: e.target.value })
                }
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
              <input
                type="number"
                step="any"
                className={INPUT}
                value={form.gpsLongitude}
                onChange={(e) =>
                  setForm({ ...form, gpsLongitude: e.target.value })
                }
              />
            </Field>
            <GpsMap
              latitude={form.gpsLatitude}
              longitude={form.gpsLongitude}
              label="Installation location"
              className="md:col-span-2"
            />
            <Field label="Installation status">
              <input
                disabled
                className={INPUT}
                value={pretty(
                  meter.assignment?.installationStatus ??
                    meter.installationStatus,
                )}
              />
            </Field>
            <div className="md:col-span-2 lg:col-span-3">
              <Field label="Remarks">
                <textarea
                  className={`${INPUT} min-h-20`}
                  value={form.remarks}
                  onChange={(e) =>
                    setForm({ ...form, remarks: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold">Installation photo</h3>
              <input
                type="file"
                accept="image/*"
                className={`${INPUT} mt-3`}
                onChange={(e) =>
                  addFile(e.target.files?.[0], "INSTALLATION_PHOTO")
                }
              />
              {existingPhoto && (
                <button
                  className="mt-3 text-sm font-semibold text-aqua-700"
                  onClick={() => openEvidence(existingPhoto)}
                >
                  View uploaded photo
                </button>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Materials used</h3>
                <button
                  className="text-sm font-semibold text-aqua-700"
                  onClick={() =>
                    setMaterials([
                      ...materials,
                      {
                        materialName: "",
                        quantity: 1,
                        unit: "pc",
                        remarks: "",
                      },
                    ])
                  }
                >
                  + Add
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {materials.map((material, index) => (
                  <div
                    key={material.materialId ?? index}
                    className="grid grid-cols-[1fr_70px_70px_28px] gap-2"
                  >
                    <input
                      className={INPUT}
                      placeholder="Material"
                      value={material.materialName}
                      onChange={(e) =>
                        setMaterials(
                          materials.map((item, i) =>
                            i === index
                              ? { ...item, materialName: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <input
                      className={INPUT}
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={material.quantity}
                      onChange={(e) =>
                        setMaterials(
                          materials.map((item, i) =>
                            i === index
                              ? { ...item, quantity: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <input
                      className={INPUT}
                      value={material.unit}
                      onChange={(e) =>
                        setMaterials(
                          materials.map((item, i) =>
                            i === index
                              ? { ...item, unit: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <button
                      className="text-red-500"
                      onClick={() =>
                        setMaterials(materials.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                {!materials.length && (
                  <p className="text-sm text-slate-400">
                    No materials recorded.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold">Customer signature</h3>
              <input
                type="file"
                accept="image/*"
                className={`${INPUT} mt-3`}
                onChange={(e) =>
                  addFile(e.target.files?.[0], "CUSTOMER_SIGNATURE")
                }
              />
              {existingSignature && (
                <button
                  className="mt-3 text-sm font-semibold text-aqua-700"
                  onClick={() => openEvidence(existingSignature)}
                >
                  View signature
                </button>
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <LinkButton to={meterUrl(meter)} tone="teal">
              Close
            </LinkButton>
            <Button onClick={save}>Save installation</Button>
          </div>
        </Card>
      )}
    </Page>
  );
}

export function UpdateMeterStatus() {
  const id = useMeterParam();
  const [params] = useSearchParams();
  const [meter, setMeter] = useState<AnyRecord | null>(null);
  const [form, setForm] = useState<AnyRecord>({
    status: params.get("status") || "FAULTY",
    reason: "",
    remarks: "",
    gpsLatitude: "",
    gpsLongitude: "",
    createWorkOrder: false,
  });
  const [evidence, setEvidence] = useState<MeterEvidenceInput[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .getMeter(id)
      .then(setMeter)
      .catch((e) => setError(e.message));
  }, [id]);
  async function addFile(file?: File) {
    if (!file) return;
    try {
      setEvidence([await fileToEvidence(file, "STATUS_PHOTO")]);
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const saved = await api.updateMeterStatus(id, {
        ...form,
        gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
        gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
        evidence,
      });
      setMeter((old) => ({ ...old, ...saved }));
      setEvidence([]);
      setMessage(
        saved.workOrder
          ? `Status updated and work order ${saved.workOrder.work_order_number} created.`
          : "Meter status, reason and audit event saved.",
      );
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <Page title="Update meter status">
      {!meter ? (
        <Spinner />
      ) : (
        <Card title="Status change request">
          <form onSubmit={submit}>
            {error && <Notice>{error}</Notice>}
            {message && <Notice kind="success">{message}</Notice>}
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Meter number">
                <input disabled className={INPUT} value={meter.meterNumber} />
              </Field>
              <Field label="Current status">
                <input
                  disabled
                  className={INPUT}
                  value={pretty(meter.status)}
                />
              </Field>
              <Field label="New status" required>
                <SearchableSelect
                  className={INPUT}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {[
                    "ACTIVE",
                    "IN_STOCK",
                    "FAULTY",
                    "TAMPERED",
                    "INACTIVE",
                    "DISCONNECTED",
                    "REMOVED",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </SearchableSelect>
              </Field>
              <Field label="Status reason" required>
                <input
                  required
                  className={INPUT}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Stopped reading"
                />
              </Field>
              <Field label="Reported by">
                <input
                  disabled
                  className={INPUT}
                  value="Current authenticated user"
                />
              </Field>
              <Field label="Report date">
                <input
                  disabled
                  className={INPUT}
                  value={new Date().toLocaleDateString()}
                />
              </Field>
              <Field label="Evidence photo">
                <input
                  type="file"
                  accept="image/*"
                  className={INPUT}
                  onChange={(e) => addFile(e.target.files?.[0])}
                />
                <span className="mt-1 block text-xs text-emerald-600">
                  {evidence[0]?.fileName}
                </span>
              </Field>
              <div className="grid grid-cols-2 gap-3">
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
                  <input
                    type="number"
                    step="any"
                    className={INPUT}
                    value={form.gpsLongitude}
                    onChange={(e) =>
                      setForm({ ...form, gpsLongitude: e.target.value })
                    }
                  />
                </Field>
              </div>
              <GpsMap
                latitude={form.gpsLatitude}
                longitude={form.gpsLongitude}
                label="Removal location"
                className="md:col-span-2"
              />
              <div className="md:col-span-2">
                <Field label="Remarks">
                  <textarea
                    className={`${INPUT} min-h-24`}
                    value={form.remarks}
                    onChange={(e) =>
                      setForm({ ...form, remarks: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
            <label className="mt-5 flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
              <input
                type="checkbox"
                checked={form.createWorkOrder}
                onChange={(e) =>
                  setForm({ ...form, createWorkOrder: e.target.checked })
                }
              />
              Create an investigation work order with this status report
            </label>
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              <strong>Audit trail:</strong> previous status, new status, reason,
              user, evidence, GPS and timestamp will be retained.
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" tone="slate" onClick={() => history.back()}>
                Cancel
              </Button>
              <Button>
                {form.createWorkOrder
                  ? "Update & create work order"
                  : "Update status"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </Page>
  );
}

export function MeterReplacement() {
  const id = useMeterParam();
  const [meter, setMeter] = useState<AnyRecord | null>(null);
  const [available, setAvailable] = useState<AnyRecord[]>([]);
  const [form, setForm] = useState<AnyRecord>({
    newMeterId: "",
    oldFinalReading: "",
    newOpeningReading: "0",
    replacementDate: new Date().toISOString().slice(0, 10),
    replacementReason: "",
    gpsLatitude: "",
    gpsLongitude: "",
    remarks: "",
  });
  const [evidence, setEvidence] = useState<MeterEvidenceInput[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    Promise.all([api.getMeter(id), api.listMeters({ status: "IN_STOCK" })])
      .then(([m, list]) => {
        setMeter(m);
        setAvailable(list);
        setForm((f) => ({
          ...f,
          oldFinalReading: String(
            m.latestReading?.currentReading ?? m.openingReading ?? 0,
          ),
        }));
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function addFile(file?: File) {
    if (!file) return;
    try {
      setEvidence([await fileToEvidence(file, "REPLACEMENT_PHOTO")]);
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function submit(
    e: FormEvent,
    requestStatus: "DRAFT" | "PENDING" = "PENDING",
  ) {
    e.preventDefault();
    try {
      await api.createMeterReplacement({
        accountId: String(meter?.assignment?.accountId ?? ""),
        oldMeterId: id,
        newMeterId: form.newMeterId,
        replacementDate: form.replacementDate,
        oldFinalReading: Number(form.oldFinalReading),
        newOpeningReading: Number(form.newOpeningReading),
        replacementReason: form.replacementReason,
        requestStatus,
        gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
        gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
        remarks: form.remarks || undefined,
        evidence,
      });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <Page
      title="Meter replacement"
      subtitle="Submit a faulty or tampered meter replacement for approval"
    >
      {!meter ? (
        <Spinner />
      ) : (
        <Card title="Replace faulty or tampered meter">
          <form onSubmit={(e) => submit(e)}>
            {error && <Notice>{error}</Notice>}
            {saved && (
              <Notice kind="success">
                Replacement request saved. Pending requests now require a
                supervisor role to approve.
              </Notice>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Customer account">
                <input
                  disabled
                  className={INPUT}
                  value={
                    meter.assignment?.account?.accountNumber ??
                    "No active customer account"
                  }
                />
              </Field>
              <Field label="Customer name">
                <input
                  disabled
                  className={INPUT}
                  value={meter.assignedTo ?? "—"}
                />
              </Field>
              <Field label="Old meter number">
                <input disabled className={INPUT} value={meter.meterNumber} />
              </Field>
              <Field label="Old meter status">
                <input
                  disabled
                  className={INPUT}
                  value={pretty(meter.status)}
                />
              </Field>
              <Field label="Old final reading" required>
                <input
                  required
                  min="0"
                  step="0.001"
                  type="number"
                  className={INPUT}
                  value={form.oldFinalReading}
                  onChange={(e) =>
                    setForm({ ...form, oldFinalReading: e.target.value })
                  }
                />
              </Field>
              <Field label="Replacement reason" required>
                <input
                  required
                  className={INPUT}
                  value={form.replacementReason}
                  onChange={(e) =>
                    setForm({ ...form, replacementReason: e.target.value })
                  }
                  placeholder="Faulty meter"
                />
              </Field>
              <Field label="New meter number" required>
                <SearchableSelect
                  required
                  className={INPUT}
                  value={form.newMeterId}
                  onChange={(e) =>
                    setForm({ ...form, newMeterId: e.target.value })
                  }
                >
                  <option value="">Select in-store meter</option>
                  {available.map((m) => (
                    <option key={m.meterId} value={m.meterId}>
                      {m.meterNumber} · {displaySize(m.meterSizeMm)}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
              <Field label="New opening reading" required>
                <input
                  required
                  min="0"
                  step="0.001"
                  type="number"
                  className={INPUT}
                  value={form.newOpeningReading}
                  onChange={(e) =>
                    setForm({ ...form, newOpeningReading: e.target.value })
                  }
                />
              </Field>
              <Field label="Replacement date" required>
                <input
                  required
                  type="date"
                  className={INPUT}
                  value={form.replacementDate}
                  onChange={(e) =>
                    setForm({ ...form, replacementDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Replaced by">
                <input
                  disabled
                  className={INPUT}
                  value="Current authenticated user"
                />
              </Field>
              <Field label="Evidence photo">
                <input
                  type="file"
                  accept="image/*"
                  className={INPUT}
                  onChange={(e) => addFile(e.target.files?.[0])}
                />
                <span className="mt-1 block text-xs text-emerald-600">
                  {evidence[0]?.fileName}
                </span>
              </Field>
              <div className="grid grid-cols-2 gap-3">
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
                  <input
                    type="number"
                    step="any"
                    className={INPUT}
                    value={form.gpsLongitude}
                    onChange={(e) =>
                      setForm({ ...form, gpsLongitude: e.target.value })
                    }
                  />
                </Field>
              </div>
              <GpsMap
                latitude={form.gpsLatitude}
                longitude={form.gpsLongitude}
                label="Inspection location"
                className="md:col-span-2"
              />
              <div className="md:col-span-2">
                <Field label="Remarks">
                  <textarea
                    className={`${INPUT} min-h-20`}
                    value={form.remarks}
                    onChange={(e) =>
                      setForm({ ...form, remarks: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
              The old meter remains unchanged until approval. Approval
              atomically ends its assignment, marks it replaced and activates
              the new meter.
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button type="button" tone="slate" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button
                type="button"
                tone="teal"
                disabled={saved || !meter.assignment?.accountId}
                onClick={(e) => submit(e as any, "DRAFT")}
              >
                Save draft
              </Button>
              <Button disabled={saved || !meter.assignment?.accountId}>
                Submit replacement
              </Button>
            </div>
          </form>
        </Card>
      )}
    </Page>
  );
}

export function ReplacementApproval() {
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [selected, setSelected] = useState<AnyRecord | null>(null);
  const [comments, setComments] = useState("Meter replacement verified");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function load() {
    api
      .listMeterReplacements("PENDING")
      .then((rows) => {
        setItems(rows);
        setSelected(rows[0] ?? null);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected || !comments.trim())
      return setError("Approval comments are required.");
    try {
      await api.decideMeterReplacement(
        selected.replacementId,
        decision,
        comments,
      );
      setMessage(
        `Replacement ${decision === "APPROVE" ? "approved" : decision === "REJECT" ? "rejected" : "returned for correction"}.`,
      );
      setComments("");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Meter replacement approval"
      subtitle={`${items.length} pending requests`}
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card title="Pending replacement requests">
          {items.length ? (
            <Table
              headers={["Ref", "Customer", "Old meter", "New meter", "Reason"]}
            >
              {items.map((r) => (
                <tr
                  key={r.replacementId}
                  onClick={() => setSelected(r)}
                  className={`cursor-pointer hover:bg-slate-50 ${selected?.replacementId === r.replacementId ? "bg-blue-50" : ""}`}
                >
                  <td className={TD}>
                    REP-{String(r.replacementId).padStart(4, "0")}
                  </td>
                  <td className={TD}>{r.customerName}</td>
                  <td className={TD}>{r.oldMeter.meterNumber}</td>
                  <td className={TD}>{r.newMeter.meterNumber}</td>
                  <td className={TD}>{r.replacementReason}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty text="No pending replacement requests." />
          )}
        </Card>
        <Card
          title={
            selected
              ? `Selected request REP-${String(selected.replacementId).padStart(4, "0")}`
              : "Selected request"
          }
        >
          {selected ? (
            <div className="space-y-4">
              <Field label="Old final reading">
                <input
                  disabled
                  className={INPUT}
                  value={selected.oldFinalReading}
                />
              </Field>
              <Field label="New opening reading">
                <input
                  disabled
                  className={INPUT}
                  value={selected.newOpeningReading}
                />
              </Field>
              <Field label="GPS">
                <div className="flex gap-2">
                  <input
                    disabled
                    className={INPUT}
                    value={
                      selected.gpsLatitude
                        ? `${selected.gpsLatitude}, ${selected.gpsLongitude}`
                        : "Not captured"
                    }
                  />
                  {selected.gpsLatitude && (
                    <Button
                      tone="teal"
                      onClick={() =>
                        window.open(
                          `https://www.google.com/maps?q=${selected.gpsLatitude},${selected.gpsLongitude}`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      Map
                    </Button>
                  )}
                </div>
              </Field>
              <GpsMap
                latitude={selected.gpsLatitude}
                longitude={selected.gpsLongitude}
                label="Recorded event location"
              />
              <Field label="Evidence">
                {selected.evidence?.length ? (
                  <Button
                    tone="teal"
                    onClick={() => openEvidence(selected.evidence[0])}
                  >
                    View photo
                  </Button>
                ) : (
                  <input disabled className={INPUT} value="No evidence" />
                )}
              </Field>
              <Field label="Approval comments" required>
                <textarea
                  className={`${INPUT} min-h-20`}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button tone="green" onClick={() => decide("APPROVE")}>
                  Approve
                </Button>
                <Button tone="red" onClick={() => decide("REJECT")}>
                  Reject
                </Button>
                <Button tone="orange" onClick={() => decide("RETURN")}>
                  Return for correction
                </Button>
              </div>
            </div>
          ) : (
            <Empty text="Select a request." />
          )}
        </Card>
      </div>
    </Page>
  );
}

export function MeterHistory() {
  const id = useMeterParam();
  const [meter, setMeter] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .getMeterHistory(id)
      .then(setMeter)
      .catch((e) => setError(e.message));
  }, [id]);
  const events = useMemo(() => {
    if (!meter) return [];
    const customer = meter.assignments.find((a: AnyRecord) => a.account)
      ?.account?.customer;
    const target = customer
      ? customer.organizationName ||
        [customer.firstName, customer.lastName].filter(Boolean).join(" ")
      : meter.assignments[0]?.zone?.zoneName ||
        meter.assignments[0]?.borehole?.boreholeName ||
        "—";
    const rows = meter.events.map((event: AnyRecord) => ({
      date: event.eventDate,
      activity: pretty(event.eventType),
      customer: target,
      reading: event.reading ?? "",
      officer: event.performer
        ? `${event.performer.firstName} ${event.performer.lastName}`
        : event.performedBy
          ? `User ${event.performedBy}`
          : "System",
      notes: [
        event.reason,
        event.remarks,
        event.previousStatus && event.newStatus
          ? `${pretty(event.previousStatus)} → ${pretty(event.newStatus)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    meter.readings.forEach((reading: AnyRecord) => {
      if (
        !rows.some(
          (event: AnyRecord) =>
            event.activity === "Reading" &&
            +new Date(event.date) === +new Date(reading.readingDate),
        )
      )
        rows.push({
          date: reading.readingDate,
          activity: "Reading",
          customer: target,
          reading: reading.currentReading,
          officer: reading.fieldOfficerId
            ? `Officer ${reading.fieldOfficerId}`
            : "System",
          notes:
            reading.exceptionType === "NONE"
              ? pretty(reading.readingType)
              : pretty(reading.exceptionType),
        });
    });
    return rows.sort(
      (a: AnyRecord, b: AnyRecord) => +new Date(a.date) - +new Date(b.date),
    );
  }, [meter]);
  return (
    <Page
      title="Meter history"
      actions={
        <>
          <Button
            tone="teal"
            onClick={() =>
              exportExcel("meter-history.xlsx", "Meter History", events)
            }
          >
            Export history
          </Button>
          <Button tone="slate" onClick={() => window.print()}>
            Print
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {!meter ? (
        <Spinner />
      ) : (
        <Card>
          <div className="mb-5 flex items-center gap-3">
            <h2 className="text-xl font-bold">{meter.meterNumber}</h2>
            <span className="text-sm text-slate-500">
              {pretty(meter.meterType)}
            </span>
            <Status value={meter.status} />
          </div>
          {events.length ? (
            <Table
              headers={[
                "Date",
                "Activity",
                "Customer / target",
                "Reading",
                "Officer",
                "Notes",
              ]}
            >
              {events.map((event: AnyRecord, i: number) => (
                <tr key={`${event.activity}-${i}`}>
                  <td className={TD}>{formatDate(event.date)}</td>
                  <td className={`${TD} font-semibold`}>{event.activity}</td>
                  <td className={TD}>{event.customer}</td>
                  <td className={TD}>
                    {event.reading === ""
                      ? "—"
                      : Number(event.reading).toLocaleString()}
                  </td>
                  <td className={TD}>{event.officer}</td>
                  <td className={TD}>{event.notes || "—"}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty text="No lifecycle events recorded." />
          )}
          <div className="mt-8 flex items-center overflow-x-auto pb-2">
            {events.map((event: AnyRecord, i: number) => (
              <div
                key={i}
                className="flex min-w-36 flex-1 items-center last:flex-none"
              >
                <div className="text-center">
                  <div className="mx-auto h-4 w-4 rounded-full bg-aqua-600 ring-4 ring-blue-50" />
                  <div className="mt-2 text-xs font-medium">
                    {event.activity}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {formatDate(event.date)}
                  </div>
                </div>
                {i < events.length - 1 && (
                  <div className="mx-3 h-0.5 flex-1 bg-slate-200" />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
}

export function ExceptionReport({ alerts = false }: { alerts?: boolean }) {
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [zones, setZones] = useState<AnyRecord[]>([]);
  const [filters, setFilters] = useState({
    alertType: "",
    zoneId: "",
    status: "OPEN",
    search: "",
    dateFrom: "",
    dateTo: "",
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>([]);
  function load() {
    setLoading(true);
    setError("");
    Promise.all([
      api.listMeterAlerts({
        status: filters.status,
        alertType: filters.alertType,
        zoneId: filters.zoneId,
      }),
      zones.length ? Promise.resolve(zones) : api.listZones(),
    ])
      .then(([rows, z]) => {
        setItems(rows);
        setSelectedAlerts([]);
        setZones(z);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  const filtered = items.filter(
    (alert) =>
      (!filters.search ||
        alert.meter.meterNumber
          .toLowerCase()
          .includes(filters.search.toLowerCase())) &&
      (!filters.dateFrom ||
        new Date(alert.detectedAt) >=
          new Date(`${filters.dateFrom}T00:00:00`)) &&
      (!filters.dateTo ||
        new Date(alert.detectedAt) <= new Date(`${filters.dateTo}T23:59:59`)),
  );
  const visibleIds = filtered.map((alert) => String(alert.alertId));
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedAlerts.includes(id));
  const toggleAlert = (id: string) =>
    setSelectedAlerts((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const toggleAllVisible = () =>
    setSelectedAlerts((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds])),
    );
  async function workOrder(alert: AnyRecord) {
    try {
      const created = await api.createMeterWorkOrder({
        meterId: String(alert.meterId),
        alertId: String(alert.alertId),
        description: alert.reason,
        priority:
          alert.priority === "CRITICAL"
            ? "EMERGENCY"
            : alert.priority === "MEDIUM"
              ? "NORMAL"
              : alert.priority,
      });
      setMessage(`Work order ${created.work_order_number} created.`);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function createAll() {
    try {
      for (const alert of filtered.filter((item) =>
        selectedAlerts.includes(String(item.alertId)),
      ))
        await api.createMeterWorkOrder({
          meterId: String(alert.meterId),
          alertId: String(alert.alertId),
          description: alert.reason,
          priority:
            alert.priority === "CRITICAL"
              ? "EMERGENCY"
              : alert.priority === "MEDIUM"
                ? "NORMAL"
                : alert.priority,
        });
      setMessage("Investigation work orders created for the selected alerts.");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function dismiss(alert: AnyRecord) {
    try {
      await api.dismissMeterAlert(String(alert.alertId));
      setMessage("Alert dismissed with an audit event.");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function dismissSelected() {
    try {
      const selected = filtered.filter(
        (item) =>
          selectedAlerts.includes(String(item.alertId)) &&
          item.status === "OPEN",
      );
      await Promise.all(
        selected.map((item) => api.dismissMeterAlert(String(item.alertId))),
      );
      setMessage("Selected alerts dismissed with audit events.");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const exportRows = filtered.map((alert) => ({
    MeterNumber: alert.meter.meterNumber,
    CustomerOrTarget: alert.meter.assignedTo ?? "",
    Zone: assignmentZone(alert.meter),
    AlertType: pretty(alert.alertType),
    Priority: alert.priority,
    Status: alert.status,
    Reason: alert.reason,
    DetectedAt: formatDate(alert.detectedAt),
  }));
  return (
    <Page
      title={
        alerts
          ? "Meter exception alerts"
          : "Faulty / tampered / inactive meter report"
      }
      subtitle={
        alerts
          ? "Automatically generated operational exceptions requiring attention"
          : "Generate and export exception records"
      }
    >
      <Card>
        {error && <Notice>{error}</Notice>}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <Field label="From">
            <input
              type="date"
              className={INPUT}
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({ ...filters, dateFrom: e.target.value })
              }
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={INPUT}
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({ ...filters, dateTo: e.target.value })
              }
            />
          </Field>
          <Field label="Search meter">
            <input
              className={INPUT}
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              placeholder="All meters"
            />
          </Field>
          <Field label="Zone">
            <SearchableSelect
              className={INPUT}
              value={filters.zoneId}
              onChange={(e) =>
                setFilters({ ...filters, zoneId: e.target.value })
              }
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={z.zoneId}>
                  {z.zoneName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Alert type">
            <SearchableSelect
              className={INPUT}
              value={filters.alertType}
              onChange={(e) =>
                setFilters({ ...filters, alertType: e.target.value })
              }
            >
              <option value="">All types</option>
              {[
                "FAULTY",
                "TAMPER",
                "ZERO_READING",
                "NO_READING",
                "ABNORMAL_USE",
                "INACTIVE",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Status">
            <SearchableSelect
              className={INPUT}
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              <option value="OPEN">Open</option>
              <option value="WORK_ORDER_CREATED">Work order created</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="RESOLVED">Resolved</option>
              <option value="">All</option>
            </SearchableSelect>
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={load}>
              Generate
            </Button>
          </div>
        </div>
        {message && <Notice kind="success">{message}</Notice>}
        {selectedAlerts.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aqua-200 bg-aqua-50/70 px-4 py-3">
            <span className="text-sm font-semibold text-aqua-900">
              Selected alerts are ready for a bulk action.
            </span>
            <div className="flex gap-2">
              <Button tone="orange" onClick={createAll}>
                Create work orders
              </Button>
              {alerts && (
                <Button tone="slate" onClick={dismissSelected}>
                  Dismiss selected
                </Button>
              )}
            </div>
          </div>
        )}
        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          <Table
            headers={[
              <input
                key="select"
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="Select all visible alerts"
                className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-aqua-700"
              />,
              "Meter no.",
              "Customer / target",
              "Zone",
              "Alert type",
              "Priority",
              "Detected",
              "Actions",
            ]}
          >
            {filtered.map((alert) => (
              <tr
                key={alert.alertId}
                onClick={() => toggleAlert(String(alert.alertId))}
                className={`cursor-pointer transition hover:bg-sky-50/60 ${selectedAlerts.includes(String(alert.alertId)) ? "bg-sky-50" : ""}`}
              >
                <td className={TD} onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedAlerts.includes(String(alert.alertId))}
                    onChange={() => toggleAlert(String(alert.alertId))}
                    aria-label={`Select alert for meter ${alert.meter.meterNumber}`}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-aqua-700"
                  />
                </td>
                <td className={`${TD} font-semibold`}>
                  <Link
                    className="text-aqua-700 hover:underline"
                    to={meterUrl(alert.meter)}
                  >
                    {alert.meter.meterNumber}
                  </Link>
                </td>
                <td className={TD}>{alert.meter.assignedTo ?? "—"}</td>
                <td className={TD}>{assignmentZone(alert.meter)}</td>
                <td className={TD}>{pretty(alert.alertType)}</td>
                <td className={TD}>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${alert.priority === "CRITICAL" || alert.priority === "HIGH" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${alert.priority === "CRITICAL" || alert.priority === "HIGH" ? "bg-red-500" : "bg-amber-500"}`}
                    />
                    {pretty(alert.priority)}
                  </span>
                </td>
                <td className={TD}>{formatDate(alert.detectedAt)}</td>
                <td
                  className={`${TD} space-x-2`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {alert.status === "OPEN" && (
                    <>
                      <button
                        className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs font-bold text-orange-700 transition hover:bg-orange-100"
                        onClick={() => workOrder(alert)}
                      >
                        Work order
                      </button>
                      {alerts && (
                        <button
                          className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100"
                          onClick={() => dismiss(alert)}
                        >
                          Dismiss
                        </button>
                      )}
                    </>
                  )}
                  <Link
                    className="inline-block rounded-lg px-2.5 py-1.5 text-xs font-bold text-aqua-700 transition hover:bg-aqua-50"
                    to={`/meters/${encodeId(alert.meterId)}/status`}
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="No meter exceptions match these filters." />
        )}
        <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
          <strong>Recommended action</strong>
          <p className="mt-1">
            Create investigation work orders for high and critical alerts before
            billing approval.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {!alerts && (
            <Button
              tone="orange"
              disabled={!selectedAlerts.length || filters.status !== "OPEN"}
              onClick={createAll}
            >
              Create work orders
            </Button>
          )}
          <Button
            tone="teal"
            onClick={() =>
              exportExcel(
                alerts ? "meter-alerts.xlsx" : "meter-exception-report.xlsx",
                alerts ? "Meter Alerts" : "Exception Report",
                exportRows,
              )
            }
          >
            Export Excel
          </Button>
          <Button tone="slate" onClick={() => window.print()}>
            Print report
          </Button>
        </div>
      </Card>
    </Page>
  );
}

export function BulkMeterImport() {
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<AnyRecord[]>([]);
  const [validation, setValidation] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [defaults, setDefaults] = useState({
    meterType: "CUSTOMER",
    status: "IN_STOCK",
  });
  function template() {
    exportExcel("meter-import-template.xlsx", "Meter Import", [
      {
        meterNumber: "MTR-2027-0001",
        meterType: "CUSTOMER",
        technology: "MANUAL",
        brand: "Zenner",
        model: "ZR-15",
        meterSizeMm: 15,
        serialNumber: "SN-0001",
        openingReading: 0,
        purchaseDate: "2027-01-10",
        warrantyExpiryDate: "2029-01-10",
        storageLocation: "Main Store",
        installationStatus: "IN_STORE",
        status: "IN_STOCK",
        remarks: "",
      },
    ]);
  }
  async function choose(file?: File) {
    if (!file) return;
    setFileName(file.name);
    setMessage("");
    setError("");
    setValidation(null);
    try {
      const rows = await parseMeterWorkbook(file);
      setRecords(
        rows.map((row) => ({
          ...row,
          meterType: row.meterType || defaults.meterType,
          status: row.status || defaults.status,
          technology: row.technology || "MANUAL",
          installationStatus: row.installationStatus || "IN_STORE",
        })),
      );
      if (!rows.length) setError("The file contains no meter records.");
    } catch (e: any) {
      setError(`Could not read the spreadsheet: ${e.message}`);
    }
  }
  async function validate() {
    setError("");
    try {
      setValidation(await api.validateMeterImport(records));
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function upload() {
    if (!validation) return;
    try {
      const validRows = new Set(
        validation.results
          .filter((row: AnyRecord) => row.valid)
          .map((row: AnyRecord) => row.row - 2),
      );
      const valid = records
        .filter((_, index) => validRows.has(index))
        .map((row) => ({
          ...row,
          meterSizeMm: Number(row.meterSizeMm),
          openingReading: Number(row.openingReading || 0),
        }));
      let imported = 0;
      for (let offset = 0; offset < valid.length; offset += 1000) {
        const result = await api.bulkCreateMeters(valid.slice(offset, offset + 1000));
        imported += Number(result.imported ?? 0);
      }
      setMessage(
        `${imported} of ${valid.length} validated meter records imported.`,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  const errors =
    validation?.results?.filter((row: AnyRecord) => !row.valid) ?? [];
  return (
    <Page
      title="Bulk meter import"
      subtitle="Validate and import meter inventory from Excel or CSV"
    >
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-sky-50 to-white px-5 py-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-700 text-white shadow-sm">
              ↑
            </span>
            <div>
              <h2 className="font-bold text-slate-900">
                Upload meter register
              </h2>
              <p className="text-xs text-slate-500">
                Excel and CSV files are checked before anything is imported.
              </p>
            </div>
          </div>
          <div className="space-y-5 p-5">
            {error && <Notice>{error}</Notice>}
            <label
              className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center transition hover:border-sky-400 hover:bg-sky-50/60"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void choose(event.dataTransfer.files?.[0]);
              }}
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-2xl text-sky-700 shadow-sm ring-1 ring-slate-200 transition group-hover:-translate-y-1 group-hover:shadow-md">
                ⇧
              </span>
              <span className="mt-4 text-base font-bold text-slate-800">
                {fileName || "Choose a file or drag it here"}
              </span>
              <span className="mt-1 text-sm text-slate-500">
                Accepted formats: .xlsx and .csv
              </span>
              <span className="mt-4 rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white shadow-sm">
                Browse files
              </span>
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default meter type">
                <SearchableSelect
                  className={INPUT}
                  value={defaults.meterType}
                  onChange={(e) =>
                    setDefaults({ ...defaults, meterType: e.target.value })
                  }
                >
                  {["CUSTOMER", "BULK", "ZONE", "BOREHOLE"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </SearchableSelect>
              </Field>
              <Field label="Default status">
                <SearchableSelect
                  className={INPUT}
                  value={defaults.status}
                  onChange={(e) =>
                    setDefaults({ ...defaults, status: e.target.value })
                  }
                >
                  <option value="IN_STOCK">In store</option>
                  <option value="INACTIVE">Inactive</option>
                </SearchableSelect>
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-700">
                  Need the correct column layout?
                </div>
                <div className="text-xs text-slate-500">
                  Download the approved import template.
                </div>
              </div>
              <Button type="button" tone="teal" onClick={template}>
                Download template
              </Button>
            </div>
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 font-bold text-white shadow-sm">
              ✓
            </span>
            <div>
              <h2 className="font-bold text-slate-900">Validate and import</h2>
              <p className="text-xs text-slate-500">
                Review file quality before committing records.
              </p>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                ["File", fileName || "None"],
                ["Total records", validation?.total ?? records.length],
                ["Valid records", validation?.valid ?? "—"],
                ["Duplicates", validation?.duplicates ?? "—"],
                ["Error records", validation?.errors ?? "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className={`rounded-xl border p-4 ${label === "File" ? "col-span-2 border-sky-100 bg-sky-50/60" : "border-slate-100 bg-slate-50"}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </div>
                  <div
                    className={`${label === "File" ? "truncate text-base" : "text-xl"} mt-1 font-extrabold text-slate-800`}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {errors.length > 0 && (
              <div className="mt-4 max-h-40 overflow-auto rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {errors.slice(0, 20).map((row: AnyRecord) => (
                  <div key={row.row}>
                    Row {row.row}: {row.errors.join("; ")}
                  </div>
                ))}
              </div>
            )}
            {message && (
              <div className="mt-5">
                <Notice kind="success">{message}</Notice>
              </div>
            )}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button
                className="w-full"
                disabled={!records.length}
                onClick={validate}
              >
                Validate file
              </Button>
              <Button
                className="w-full"
                tone="green"
                disabled={!validation?.valid}
                onClick={upload}
              >
                Import valid records
              </Button>
              {errors.length > 0 && (
                <Button
                  tone="orange"
                  onClick={() =>
                    exportExcel(
                      "meter-import-errors.xlsx",
                      "Import Errors",
                      errors.map((row: AnyRecord) => ({
                        Row: row.row,
                        MeterNumber: row.meterNumber,
                        Duplicate: row.duplicate ? "Yes" : "No",
                        Errors: row.errors.join("; "),
                      })),
                    )
                  }
                >
                  Download error report
                </Button>
              )}
            </div>
            {!records.length && (
              <p className="mt-4 text-center text-xs text-slate-400">
                Upload a file to enable validation.
              </p>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
}

export function BulkMeterAssignmentImport() {
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<AnyRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function choose(file?: File) {
    if (!file) return;
    setFileName(file.name);
    setMessage("");
    try {
      const rows = await parseMeterWorkbook(file);
      const issues: string[] = [];
      const normalized = rows.map((row, index) => {
        const meterNumber = String(row.meterNumber ?? "").trim();
        const accountNumber = String(row.accountNumber ?? "").trim();
        const assignmentDate = String(row.assignmentDate ?? "").trim();
        if (!meterNumber) issues.push(`Row ${index + 2}: meterNumber is required.`);
        if (!accountNumber) issues.push(`Row ${index + 2}: accountNumber is required.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(assignmentDate)) issues.push(`Row ${index + 2}: assignmentDate must be YYYY-MM-DD.`);
        return {
          meterNumber,
          accountNumber,
          assignmentDate,
          installationPoint: String(row.installationPoint ?? "").trim(),
          installationStatus: String(row.installationStatus ?? "COMPLETED").trim().toUpperCase(),
          remarks: String(row.remarks ?? "").trim(),
        };
      });
      if (!rows.length) issues.push("The selected file has no assignment rows.");
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
      let skipped = 0;
      for (let offset = 0; offset < records.length; offset += 1000) {
        const result = await api.bulkAssignMeters(records.slice(offset, offset + 1000));
        imported += Number(result.imported ?? 0);
        skipped += Number(result.skipped ?? 0);
      }
      setMessage(`${imported} meter assignments imported${skipped ? `; ${skipped} existing assignments skipped` : ""}.`);
    } catch (error: any) {
      setErrors([error.message || "Meter assignments could not be imported."]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Page title="Bulk meter assignments" subtitle="Link imported customer meters to their service accounts">
      <section className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-bold text-slate-900">Assignment workbook</h2><p className="mt-1 text-sm text-slate-500">Import customers, properties, accounts and meters before running this step.</p></div>
          <Button tone="teal" onClick={() => exportExcel("meter-assignment-import-template.xlsx", "Assignments", [{ meterNumber: "MTR-2026-00001", accountNumber: "ACC-00001", assignmentDate: new Date().toISOString().slice(0, 10), installationPoint: "Plot 1", installationStatus: "COMPLETED", remarks: "" }])}>Download template</Button>
        </div>
        <label className="mt-5 block rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <span className="block font-bold text-slate-800">{fileName || "Choose assignment Excel or CSV file"}</span>
          <span className="mt-1 block text-sm text-slate-500">Accepted formats: .xlsx and .csv</span>
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="mt-4 text-sm" onChange={(event) => void choose(event.target.files?.[0])} />
        </label>
        {records.length > 0 && !errors.length && <Notice kind="success">{records.length} assignment rows validated and ready.</Notice>}
        {errors.length > 0 && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errors.slice(0, 20).map((error) => <div key={error}>{error}</div>)}</div>}
        {message && <div className="mt-4"><Notice kind="success">{message}</Notice></div>}
        <div className="mt-5 flex justify-end"><Button tone="green" disabled={!records.length || errors.length > 0 || uploading} onClick={upload}>{uploading ? "Importing..." : `Import ${records.length || ""} assignments`}</Button></div>
      </section>
    </Page>
  );
}
