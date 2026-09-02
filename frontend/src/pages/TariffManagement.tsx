import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { exportExcel } from "../lib/meterFiles";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { DateInput } from "../components/DateInput";

type Row = Record<string, any>;
const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] leading-5 text-slate-700 outline-none transition duration-200 placeholder:text-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";
const METHODS = ["TIERED", "CONSUMPTION", "FLAT", "BULK"];

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
    <div className="tariff-module mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-6">
      <div className="page-screen-header mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-600/15">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M4 7h16M7 12h10M9 17h6" /><circle cx="6" cy="7" r="1" fill="currentColor" /><circle cx="18" cy="7" r="1" fill="currentColor" /></svg>
          </span>
          <div><div className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Tariff management</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 lg:text-[27px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 max-w-3xl text-[15px] leading-6 text-slate-500">{subtitle}</p>
          )}
          </div>
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
      className={`overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/60 transition-shadow duration-200 hover:shadow-md hover:shadow-slate-200/70 ${className}`}
    >
      {title && (
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-5 py-4">
          <h2 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h2>
        </div>
      )}
      <div className="tariff-card-content p-5 sm:p-6">{children}</div>
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
      <span className="mb-1.5 block text-sm font-semibold leading-5 text-slate-700">
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
      className={`rounded-xl px-4 py-2.5 text-[15px] font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${colors[tone]} ${className}`}
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
  tone?: "blue" | "green" | "slate";
}) {
  const color =
    tone === "green"
      ? "bg-emerald-600 hover:bg-emerald-500"
      : tone === "slate"
        ? "bg-slate-600 hover:bg-slate-500"
        : "bg-aqua-700 hover:bg-aqua-600";
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-[15px] font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-md active:translate-y-0 ${color}`}
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
const tones: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-cyan-50 text-cyan-700",
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700",
  EXPIRED: "bg-violet-50 text-violet-700",
  REJECTED: "bg-red-50 text-red-700",
  RETURNED: "bg-orange-50 text-orange-700",
};
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ring-current/10 ${tones[value] ?? "bg-slate-100 text-slate-600"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${value === "ACTIVE" || value === "APPROVED" ? "bg-emerald-500" : value === "REJECTED" ? "bg-rose-500" : value === "PENDING_APPROVAL" ? "bg-amber-500" : "bg-current opacity-50"}`} />
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
function money(value: any, digits = 2) {
  return `KSh ${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function person(user?: Row) {
  return user ? `${user.firstName} ${user.lastName}`.trim() : "System";
}
function tariffRate(t: Row) {
  if (t.billingMethod === "FLAT") return money(t.flatAmount);
  if (t.billingMethod === "TIERED") return `${t.bands?.length ?? 0} bands`;
  return `${money(t.ratePerUnit, 4)} / unit`;
}

function TariffTable({
  rows,
  action,
}: {
  rows: Row[];
  action?: (tariff: Row) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[880px]">
        <thead>
          <tr className="bg-slate-50/90">
            <th className={TH}>Tariff</th>
            <th className={TH}>Category</th>
            <th className={TH}>Method</th>
            <th className={TH}>Rate</th>
            <th className={TH}>Effective period</th>
            <th className={TH}>Simulation</th>
            <th className={TH}>Status</th>
            {action && <th className={TH}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.tariffId} className="border-t border-slate-100 transition duration-150 hover:bg-emerald-50/30">
              <td className={TD}>
                <div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M5 7h14M7 12h10M9 17h6" /></svg></span><span><div className="font-bold text-slate-800">{t.tariffName}</div><div className="mt-0.5 font-mono text-[11px] font-semibold text-slate-400">{t.tariffCode}</div></span></div>
              </td>
              <td className={TD}>{t.category?.categoryName}</td>
              <td className={TD}><span className="inline-flex rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">{pretty(t.billingMethod)}</span></td>
              <td className={`${TD} font-bold text-slate-800`}>{tariffRate(t)}</td>
              <td className={TD}>
                {date(t.effectiveFrom)} – {date(t.effectiveTo)}
              </td>
              <td className={TD}>
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                    t.simulationCompleted
                      ? "text-emerald-700"
                      : "text-orange-600"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${t.simulationCompleted ? "bg-emerald-500" : "bg-orange-400"}`} />
                  {t.simulationCompleted ? "Completed" : "Required"}
                </span>
              </td>
              <td className={TD}>
                <Badge value={t.status} />
              </td>
              {action && <td className={TD}>{action(t)}</td>}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td
                colSpan={action ? 8 : 7}
                className="p-14 text-center text-slate-400"
              >
                <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M5 7h14M7 12h10M9 17h6" /></svg></div><div className="font-bold text-slate-600">No tariffs match this view</div><div className="mt-1 text-sm">Adjust the filters or create a new tariff.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TariffDashboard() {
  const [categories, setCategories] = useState<Row[]>([]);
  const [filters, setFilters] = useState({
    year: String(new Date().getFullYear()),
    categoryId: "",
  });
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .listCategories()
      .then(setCategories)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api
      .tariffDashboard(filters)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [filters]);
  const stats = [
    ["Active tariffs", data?.active, "text-emerald-700"],
    ["Pending approval", data?.pending, "text-amber-700"],
    ["Expired tariffs", data?.expired, "text-violet-700"],
    ["Customer categories", data?.categories, "text-blue-700"],
    ["Tariff bands", data?.bands, "text-cyan-700"],
    ["Simulations", data?.simulations, "text-slate-800"],
  ];
  return (
    <Page
      title="Tariff Management"
      subtitle="Configure, simulate, approve and activate controlled water tariffs"
      actions={
        <>
          <LinkButton to="/tariffs/new">Create tariff</LinkButton>
          <LinkButton to="/tariffs/simulations" tone="green">
            Simulate tariff
          </LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-5">
        <div className="mb-4 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 6h16M7 12h10M10 18h4" /></svg></span><div><div className="font-bold text-slate-800">Dashboard view</div><div className="text-xs text-slate-500">Filter tariff performance by effective year and customer category.</div></div></div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Effective year">
            <SearchableSelect
              className={INPUT}
              value={filters.year}
              onChange={(e) => setFilters({ ...filters, year: e.target.value })}
            >
              {[-1, 0, 1, 2].map((offset) => {
                const year = new Date().getFullYear() + offset;
                return <option key={year}>{year}</option>;
              })}
            </SearchableSelect>
          </Field>
          <Field label="Customer category">
            <SearchableSelect
              className={INPUT}
              value={filters.categoryId}
              onChange={(e) =>
                setFilters({ ...filters, categoryId: e.target.value })
              }
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.categoryName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
        </div>
      </Card>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {stats.map(([label, value, color], index) => (
          <Card key={String(label)} className={index === 0 ? "border-emerald-100 bg-emerald-50/40" : index === 1 ? "border-amber-100 bg-amber-50/40" : ""}>
            <div className="flex items-center justify-between"><div className="text-sm font-semibold text-slate-500">{label}</div><span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-emerald-500" : index === 1 ? "bg-amber-500" : "bg-slate-300"}`} /></div>
            <div className={`mt-2 text-3xl font-extrabold ${color}`}>
              {value ?? 0}
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <Card title="Active tariffs">
          <TariffTable
            rows={data?.activeTariffs ?? []}
            action={(t) => (
              <Link
                className="inline-flex rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                to={`/tariffs/${t.tariffId}/audit`}
              >
                Audit
              </Link>
            )}
          />
        </Card>
        <Card title="Recent tariff activity" className="tariff-sidebar-card">
          <div className="space-y-2">
            {(data?.recentEvents ?? []).map((e: Row) => (
              <div
                key={e.eventId}
                className="rounded-xl border border-slate-100 p-3.5 transition hover:-translate-y-0.5 hover:border-emerald-100 hover:bg-emerald-50/30 hover:shadow-sm"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-slate-800">
                    {e.tariff?.tariffName}
                  </span>
                  <span className="text-xs text-slate-400">
                    {date(e.createdAt)}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {pretty(e.eventType)} · {person(e.performer)}
                </div>
                <div className="mt-1 text-xs text-slate-400">{e.details}</div>
              </div>
            ))}
            {!data?.recentEvents?.length && (
              <p className="py-8 text-center text-slate-400">
                No tariff activity yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function TariffRegister() {
  const [categories, setCategories] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    method: "",
    categoryId: "",
  });
  const [error, setError] = useState("");
  const load = () =>
    api
      .listTariffs(filters)
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    api.listCategories().then(setCategories);
  }, []);
  useEffect(() => {
    void load();
  }, [filters]);
  async function submit(t: Row) {
    try {
      await api.submitTariff(String(t.tariffId));
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Tariff register"
      subtitle="Search tariff versions and move prepared tariffs through their workflow"
      actions={
        <>
          <Button
            tone="slate"
            onClick={() =>
              exportExcel(
                "tariff-register.xlsx",
                "Tariffs",
                rows.map((t) => ({
                  Code: t.tariffCode,
                  Name: t.tariffName,
                  Category: t.category?.categoryName,
                  Method: t.billingMethod,
                  EffectiveFrom: date(t.effectiveFrom),
                  EffectiveTo: date(t.effectiveTo),
                  Status: t.status,
                })),
              )
            }
          >
            Export Excel
          </Button>
          <LinkButton to="/tariffs/new">Create tariff</LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Search">
            <input
              className={INPUT}
              placeholder="Tariff name, code or category"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
            />
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
                "DRAFT",
                "PENDING_APPROVAL",
                "APPROVED",
                "ACTIVE",
                "EXPIRED",
                "RETURNED",
                "REJECTED",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Method">
            <SearchableSelect
              className={INPUT}
              value={filters.method}
              onChange={(e) =>
                setFilters({ ...filters, method: e.target.value })
              }
            >
              <option value="">All methods</option>
              {METHODS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Category">
            <SearchableSelect
              className={INPUT}
              value={filters.categoryId}
              onChange={(e) =>
                setFilters({ ...filters, categoryId: e.target.value })
              }
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.categoryName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
        </div>
      </Card>
      <Card title={`${rows.length} tariff(s)`}>
        <TariffTable
          rows={rows}
          action={(t) => (
            <div className="flex flex-wrap gap-2">
              {["DRAFT", "RETURNED", "REJECTED"].includes(t.status) && (
                <Link
                  className="font-semibold text-aqua-700"
                  to={`/tariffs/${t.tariffId}/edit`}
                >
                  Edit
                </Link>
              )}
              {t.billingMethod === "TIERED" &&
                ["DRAFT", "RETURNED", "REJECTED"].includes(t.status) && (
                  <Link
                    className="font-semibold text-cyan-700"
                    to={`/tariffs/${t.tariffId}/bands`}
                  >
                    Bands
                  </Link>
                )}
              {["DRAFT", "RETURNED", "REJECTED"].includes(t.status) && (
                <Link
                  className="font-semibold text-emerald-700"
                  to={`/tariffs/${t.tariffId}/simulate`}
                >
                  Simulate
                </Link>
              )}
              {t.simulationCompleted &&
                ["DRAFT", "RETURNED", "REJECTED"].includes(t.status) && (
                  <button
                    className="font-semibold text-orange-600"
                    onClick={() => submit(t)}
                  >
                    Submit
                  </button>
                )}
              {t.status === "APPROVED" && (
                <Link
                  className="font-semibold text-emerald-700"
                  to="/tariffs/activation"
                >
                  Activate
                </Link>
              )}
              <Link
                className="font-semibold text-slate-600"
                to={`/tariffs/${t.tariffId}/audit`}
              >
                Audit
              </Link>
            </div>
          )}
        />
      </Card>
    </Page>
  );
}

const emptyTariff = {
  tariffCode: "",
  tariffName: "",
  categoryId: "",
  billingMethod: "TIERED",
  minimumCharge: "0",
  standingCharge: "0",
  meterRent: "0",
  flatAmount: "0",
  ratePerUnit: "0",
  penaltyRule: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  remarks: "",
};
export function TariffEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Row[]>([]);
  const [form, setForm] = useState<Row>(emptyTariff);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.listCategories().then(setCategories);
    if (id)
      api
        .getTariff(id)
        .then((t) =>
          setForm({
            tariffCode: t.tariffCode,
            tariffName: t.tariffName,
            categoryId: String(t.categoryId),
            billingMethod: t.billingMethod,
            minimumCharge: String(t.minimumCharge),
            standingCharge: String(t.standingCharge),
            meterRent: String(t.meterRent),
            flatAmount: String(t.flatAmount),
            ratePerUnit: String(t.ratePerUnit),
            penaltyRule: t.penaltyRule ?? "",
            effectiveFrom: String(t.effectiveFrom).slice(0, 10),
            effectiveTo: t.effectiveTo
              ? String(t.effectiveTo).slice(0, 10)
              : "",
            remarks: t.remarks ?? "",
          }),
        )
        .catch((e) => setError(e.message));
  }, [id]);
  const set = (key: string, value: string) =>
    setForm((old: Row) => ({ ...old, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        minimumCharge: Number(form.minimumCharge),
        standingCharge: Number(form.standingCharge),
        meterRent: Number(form.meterRent),
        flatAmount: Number(form.flatAmount),
        ratePerUnit: Number(form.ratePerUnit),
        effectiveTo: form.effectiveTo || undefined,
        penaltyRule: form.penaltyRule || undefined,
        remarks: form.remarks || undefined,
      };
      const tariff = id
        ? await api.updateTariff(id, payload)
        : await api.createTariff(payload);
      navigate(
        form.billingMethod === "TIERED"
          ? `/tariffs/${tariff.tariffId}/bands`
          : `/tariffs/${tariff.tariffId}/simulate`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title={id ? "Update tariff" : "Create tariff"}
      subtitle="Define controlled rates, charges and effective dates"
    >
      <Card title="Tariff definition">
        {error && <Notice>{error}</Notice>}
        <form onSubmit={submit}>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Tariff code" required>
              <input
                required
                className={INPUT}
                value={form.tariffCode}
                onChange={(e) => set("tariffCode", e.target.value)}
                placeholder="DOM-2027"
              />
            </Field>
            <Field label="Tariff name" required>
              <input
                required
                className={INPUT}
                value={form.tariffName}
                onChange={(e) => set("tariffName", e.target.value)}
                placeholder="Domestic 2027"
              />
            </Field>
            <Field label="Customer category" required>
              <SearchableSelect
                required
                className={INPUT}
                value={form.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.categoryName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Billing method" required>
              <SearchableSelect
                className={INPUT}
                value={form.billingMethod}
                onChange={(e) => set("billingMethod", e.target.value)}
              >
                {METHODS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </SearchableSelect>
            </Field>
            {form.billingMethod === "FLAT" && (
              <Field label="Flat amount" required>
                <input
                  min="0.01"
                  step="0.01"
                  required
                  type="number"
                  className={INPUT}
                  value={form.flatAmount}
                  onChange={(e) => set("flatAmount", e.target.value)}
                />
              </Field>
            )}
            {["CONSUMPTION", "BULK"].includes(form.billingMethod) && (
              <Field label="Rate per unit" required>
                <input
                  min="0.0001"
                  step="0.0001"
                  required
                  type="number"
                  className={INPUT}
                  value={form.ratePerUnit}
                  onChange={(e) => set("ratePerUnit", e.target.value)}
                />
              </Field>
            )}
            <Field label="Minimum charge">
              <input
                min="0"
                step="0.01"
                type="number"
                className={INPUT}
                value={form.minimumCharge}
                onChange={(e) => set("minimumCharge", e.target.value)}
              />
            </Field>
            <Field label="Standing charge">
              <input
                min="0"
                step="0.01"
                type="number"
                className={INPUT}
                value={form.standingCharge}
                onChange={(e) => set("standingCharge", e.target.value)}
              />
            </Field>
            <Field label="Meter rent">
              <input
                min="0"
                step="0.01"
                type="number"
                className={INPUT}
                value={form.meterRent}
                onChange={(e) => set("meterRent", e.target.value)}
              />
            </Field>
            <Field label="Effective from" required>
              <DateInput
                required
                className={INPUT}
                value={form.effectiveFrom}
                onChange={(e) => set("effectiveFrom", e.target.value)}
              />
            </Field>
            <Field label="Effective to">
              <DateInput
                min={form.effectiveFrom}
                className={INPUT}
                value={form.effectiveTo}
                onChange={(e) => set("effectiveTo", e.target.value)}
              />
            </Field>
            <Field label="Penalty rule">
              <input
                className={INPUT}
                value={form.penaltyRule}
                onChange={(e) => set("penaltyRule", e.target.value)}
                placeholder="5% after due date"
              />
            </Field>
            <div className="md:col-span-2 xl:col-span-3">
              <Field label="Remarks">
                <textarea
                  rows={2}
                  className={INPUT}
                  value={form.remarks}
                  onChange={(e) => set("remarks", e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" tone="slate" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button disabled={saving}>
              {saving
                ? "Saving…"
                : form.billingMethod === "TIERED"
                  ? "Save and configure bands"
                  : "Save and simulate"}
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}

export function TariffBands() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [tariff, setTariff] = useState<Row | null>(null);
  const [bands, setBands] = useState<Row[]>([
    { lowerLimit: "0", upperLimit: "10", ratePerUnit: "" },
    { lowerLimit: "10", upperLimit: "", ratePerUnit: "" },
  ]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api
      .getTariff(id)
      .then((t) => {
        setTariff(t);
        if (t.bands?.length)
          setBands(
            t.bands.map((b: Row) => ({
              lowerLimit: String(b.lowerLimit),
              upperLimit: b.upperLimit == null ? "" : String(b.upperLimit),
              ratePerUnit: String(b.ratePerUnit),
            })),
          );
      })
      .catch((e) => setError(e.message));
  }, [id]);
  function update(index: number, key: string, value: string) {
    setBands((old) =>
      old.map((b, i) => (i === index ? { ...b, [key]: value } : b)),
    );
  }
  function add() {
    const previous = bands[bands.length - 1];
    if (!previous.upperLimit) {
      setError(
        "Enter an upper limit for the current final band before adding another band.",
      );
      return;
    }
    setError("");
    setBands([
      ...bands,
      { lowerLimit: previous.upperLimit, upperLimit: "", ratePerUnit: "" },
    ]);
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.saveTariffBands(
        id,
        bands.map((b) => ({
          lowerLimit: Number(b.lowerLimit),
          upperLimit: b.upperLimit === "" ? null : Number(b.upperLimit),
          ratePerUnit: Number(b.ratePerUnit),
        })),
      );
      navigate(`/tariffs/${id}/simulate`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title="Tariff band setup"
      subtitle={`${tariff?.tariffName ?? "Tiered tariff"} · bands must be continuous and non-overlapping`}
      actions={
        <Button tone="green" onClick={add}>
          Add band
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card title="Progressive consumption bands">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Band</th>
                <th className={TH}>From units</th>
                <th className={TH}>To units</th>
                <th className={TH}>Rate per unit</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className={`${TD} font-semibold`}>{i + 1}</td>
                  <td className={TD}>
                    <input
                      min="0"
                      step="0.001"
                      type="number"
                      className={INPUT}
                      value={b.lowerLimit}
                      onChange={(e) => update(i, "lowerLimit", e.target.value)}
                    />
                  </td>
                  <td className={TD}>
                    <input
                      min="0"
                      step="0.001"
                      type="number"
                      className={INPUT}
                      value={b.upperLimit}
                      onChange={(e) => update(i, "upperLimit", e.target.value)}
                      placeholder={
                        i === bands.length - 1 ? "Above / no limit" : "Required"
                      }
                    />
                  </td>
                  <td className={TD}>
                    <input
                      min="0.0001"
                      step="0.0001"
                      type="number"
                      className={INPUT}
                      value={b.ratePerUnit}
                      onChange={(e) => update(i, "ratePerUnit", e.target.value)}
                    />
                  </td>
                  <td className={TD}>
                    {bands.length > 1 && (
                      <button
                        className="font-semibold text-red-600"
                        onClick={() =>
                          setBands(bands.filter((_, index) => index !== i))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice tone="blue">
          Use continuous boundaries such as 0–10, 10–30 and 30–above. Only the
          final band may have no upper limit.
        </Notice>
        <div className="flex justify-end gap-2">
          <Button tone="slate" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save bands and simulate"}
          </Button>
        </div>
      </Card>
    </Page>
  );
}

export function TariffSimulation() {
  const params = useParams();
  const [tariffs, setTariffs] = useState<Row[]>([]);
  const [tariffId, setTariffId] = useState(params.id ?? "");
  const [mode, setMode] = useState<"SINGLE" | "BULK">("SINGLE");
  const [consumption, setConsumption] = useState("25");
  const [includeStanding, setIncludeStanding] = useState(true);
  const [includeMinimum, setIncludeMinimum] = useState(true);
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.listTariffs().then((rows) => {
      const eligible = rows.filter((t: Row) =>
        ["DRAFT", "RETURNED", "REJECTED", "APPROVED"].includes(t.status),
      );
      setTariffs(eligible);
      if (!tariffId && eligible[0]) setTariffId(String(eligible[0].tariffId));
    });
  }, []);
  async function run(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      setResult(
        mode === "SINGLE"
          ? await api.simulateTariff(tariffId, {
              consumption: Number(consumption),
              includeStanding,
              includeMinimum,
            })
          : await api.simulateTariffBulk(tariffId, Number(consumption)),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function submit() {
    try {
      await api.submitTariff(tariffId);
      setResult(null);
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title={mode === "SINGLE" ? "Tariff simulation" : "Bulk tariff simulation"}
      subtitle="Measure customer and portfolio impact before approval"
      actions={
        <div className="rounded-lg bg-slate-100 p-1">
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "SINGLE" ? "bg-white text-aqua-700 shadow-sm" : "text-slate-500"}`}
            onClick={() => {
              setMode("SINGLE");
              setResult(null);
            }}
          >
            Single bill
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "BULK" ? "bg-white text-aqua-700 shadow-sm" : "text-slate-500"}`}
            onClick={() => {
              setMode("BULK");
              setResult(null);
            }}
          >
            Customer portfolio
          </button>
        </div>
      }
    >
      {error && <Notice>{error}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card title="Simulation inputs">
          <form onSubmit={run} className="space-y-3">
            <Field label="Proposed tariff" required>
              <SearchableSelect
                required
                className={INPUT}
                value={tariffId}
                onChange={(e) => {
                  setTariffId(e.target.value);
                  setResult(null);
                }}
              >
                <option value="">Select tariff</option>
                {tariffs.map((t) => (
                  <option key={t.tariffId} value={t.tariffId}>
                    {t.tariffName} · {t.category?.categoryName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field
              label={
                mode === "SINGLE"
                  ? "Sample consumption"
                  : "Fallback consumption for accounts without readings"
              }
              required
            >
              <input
                required
                min="0"
                step="0.001"
                type="number"
                className={INPUT}
                value={consumption}
                onChange={(e) => setConsumption(e.target.value)}
              />
            </Field>
            {mode === "SINGLE" && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeStanding}
                    onChange={(e) => setIncludeStanding(e.target.checked)}
                  />{" "}
                  Include standing charge and meter rent
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeMinimum}
                    onChange={(e) => setIncludeMinimum(e.target.checked)}
                  />{" "}
                  Apply minimum charge
                </label>
              </>
            )}
            <Button disabled={saving || !tariffId} className="w-full">
              {saving
                ? "Calculating…"
                : mode === "SINGLE"
                  ? "Run simulation"
                  : "Run bulk simulation"}
            </Button>
          </form>
        </Card>
        <Card title="Simulation result">
          {result ? (
            <div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  [
                    mode === "SINGLE" ? "Current bill" : "Current billing",
                    mode === "SINGLE"
                      ? result.current?.total
                      : result.currentTotal,
                  ],
                  [
                    mode === "SINGLE" ? "Proposed bill" : "Proposed billing",
                    mode === "SINGLE"
                      ? result.proposed?.total
                      : result.proposedTotal,
                  ],
                  ["Difference", result.difference],
                  [
                    "Percentage change",
                    result.currentTariff
                      ? `${Number(result.percentageChange).toFixed(2)}%`
                      : "N/A — first tariff",
                  ],
                ].map(([label, value], index) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="text-sm text-slate-500">{label}</div>
                    <div
                      className={`mt-1 text-2xl font-bold ${index === 2 && Number(result.difference) > 0 ? "text-orange-600" : "text-slate-900"}`}
                    >
                      {index === 3 ? value : money(value)}
                    </div>
                  </div>
                ))}
              </div>
              {mode === "SINGLE" && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Breakdown
                    title="Current tariff calculation"
                    result={result.current}
                  />
                  <Breakdown
                    title="Proposed tariff calculation"
                    result={result.proposed}
                  />
                </div>
              )}
              {mode === "BULK" && (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {Object.entries(result.groups ?? {}).map(
                    ([group, value]: [string, any]) => (
                      <div key={group} className="rounded-xl bg-slate-50 p-4">
                        <div className="font-semibold text-slate-800">
                          {pretty(group)} consumption
                        </div>
                        <div className="mt-2 text-sm text-slate-500">
                          {value.customers} customers
                        </div>
                        <div className="font-semibold text-slate-800">
                          Impact: {money(value.difference)}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  tone="slate"
                  onClick={() =>
                    exportExcel("tariff-simulation.xlsx", "Simulation", [
                      {
                        Tariff: tariffs.find(
                          (t) => String(t.tariffId) === tariffId,
                        )?.tariffName,
                        Mode: mode,
                        Consumption: consumption,
                        Current:
                          mode === "SINGLE"
                            ? result.current?.total
                            : result.currentTotal,
                        Proposed:
                          mode === "SINGLE"
                            ? result.proposed?.total
                            : result.proposedTotal,
                        Difference: result.difference,
                        PercentageChange: result.currentTariff
                          ? result.percentageChange
                          : "N/A — first tariff",
                      },
                    ])
                  }
                >
                  Export result
                </Button>
                <Button onClick={submit}>Submit for approval</Button>
              </div>
            </div>
          ) : (
            <p className="py-20 text-center text-slate-400">
              Select a tariff and run a simulation to view its impact.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}
function Breakdown({ title, result }: { title: string; result?: Row }) {
  const rows = result?.breakdown ?? [];
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="mb-3 font-semibold text-slate-800">{title}</h3>
      <div className="space-y-2">
        {!rows.length && (
          <div className="text-sm text-slate-400">
            No current active tariff baseline
          </div>
        )}
        {rows.map((r: Row, i: number) => (
          <div key={i} className="flex justify-between gap-3 text-sm">
            <span className="text-slate-500">
              {r.description} ({r.units} × {money(r.rate, 4)})
            </span>
            <span className="font-medium text-slate-800">
              {money(r.amount)}
            </span>
          </div>
        ))}
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-slate-500">Minimum charge adjustment</span>
          <span className="font-medium text-slate-800">
            {money(result?.minimumAdjustment)}
          </span>
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-slate-500">Standing charge</span>
          <span className="font-medium text-slate-800">
            {money(result?.standingCharge)}
          </span>
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-slate-500">Meter rent</span>
          <span className="font-medium text-slate-800">
            {money(result?.meterRent)}
          </span>
        </div>
        <div className="mt-2 flex justify-between gap-3 border-t border-slate-200 pt-2 text-sm">
          <span className="font-semibold text-slate-700">Total bill</span>
          <span className="font-bold text-slate-900">
            {money(result?.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TariffApprovals() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () =>
    api
      .listTariffApprovals()
      .then((items) => {
        setRows(items);
        setSelected(
          (old) =>
            items.find((t: Row) => t.tariffId === old?.tariffId) ??
            items[0] ??
            null,
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected || comments.trim().length < 3)
      return setError("Enter approval comments before making a decision");
    setSaving(true);
    setError("");
    try {
      await api.decideTariff(String(selected.tariffId), decision, comments);
      setComments("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title="Tariff approval"
      subtitle="Maker-checker review of pricing, bands and simulation evidence"
    >
      {error && <Notice>{error}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <Card title={`${rows.length} pending tariff(s)`}>
          <TariffTable
            rows={rows}
            action={(t) => (
              <button
                className="font-semibold text-aqua-700"
                onClick={() => setSelected(t)}
              >
                Review
              </button>
            )}
          />
        </Card>
        <Card title="Approval decision" className="tariff-sidebar-card xl:sticky xl:top-24">
          {selected ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold text-slate-900">
                      {selected.tariffName}
                    </div>
                    <div className="text-sm text-slate-500">
                      {selected.category?.categoryName} ·{" "}
                      {pretty(selected.billingMethod)}
                    </div>
                  </div>
                  <Badge value={selected.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Effective from</dt>
                    <dd className="font-semibold">
                      {date(selected.effectiveFrom)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Created by</dt>
                    <dd className="font-semibold">
                      {person(selected.creator)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Minimum charge</dt>
                    <dd className="font-semibold">
                      {money(selected.minimumCharge)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Standing charge</dt>
                    <dd className="font-semibold">
                      {money(selected.standingCharge)}
                    </dd>
                  </div>
                </dl>
              </div>
              {selected.billingMethod === "TIERED" && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    Proposed bands
                  </h3>
                  <div className="space-y-1">
                    {selected.bands.map((b: Row) => (
                      <div
                        key={b.tariffBandId}
                        className="flex justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                      >
                        <span>
                          {b.lowerLimit} – {b.upperLimit ?? "above"} units
                        </span>
                        <span className="font-semibold">
                          {money(b.ratePerUnit, 4)} / unit
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Notice tone="blue">
                Simulation completed:{" "}
                {selected.simulationCompleted ? "Yes" : "No"}. Latest projected
                change:{" "}
                {selected.simulations?.[0]?.resultData?.currentTariffId
                  ? `${Number(selected.simulations[0].percentageChange).toFixed(2)}%`
                  : selected.simulations?.[0]
                    ? "N/A — first tariff"
                    : "No result"}
                .
              </Notice>
              <Field label="Approval comments" required>
                <textarea
                  rows={3}
                  className={INPUT}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  tone="red"
                  disabled={saving}
                  onClick={() => decide("REJECT")}
                >
                  Reject
                </Button>
                <Button
                  tone="orange"
                  disabled={saving}
                  onClick={() => decide("RETURN")}
                >
                  Return for review
                </Button>
                <Button
                  tone="green"
                  disabled={saving}
                  onClick={() => decide("APPROVE")}
                >
                  Approve tariff
                </Button>
              </div>
            </div>
          ) : (
            <p className="py-16 text-center text-slate-400">
              No tariffs await approval.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}

export function TariffActivation() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [mode, setMode] = useState<"NOW" | "AUTO_ON_DATE">("AUTO_ON_DATE");
  const [reason, setReason] = useState("Approved tariff activation");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () =>
    api
      .listTariffs({ status: "APPROVED" })
      .then((items) => {
        setRows(items);
        setSelected(
          (old) =>
            items.find((t: Row) => t.tariffId === old?.tariffId) ??
            items[0] ??
            null,
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function activate() {
    if (!selected || reason.trim().length < 3) return;
    setSaving(true);
    setError("");
    try {
      await api.activateTariff(String(selected.tariffId), mode, reason);
      setMessage(
        mode === "NOW"
          ? "Tariff activated and the previous category tariff expired."
          : `Activation scheduled for ${date(selected.effectiveFrom)}.`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title="Tariff activation"
      subtitle="Activate approved tariffs now or automatically on their effective date"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <Card title={`${rows.length} approved tariff(s)`}>
          <TariffTable
            rows={rows}
            action={(t) => (
              <button
                className="font-semibold text-aqua-700"
                onClick={() => setSelected(t)}
              >
                Select
              </button>
            )}
          />
        </Card>
        <Card title="Activation control" className="tariff-sidebar-card xl:sticky xl:top-24">
          {selected ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xl font-bold text-slate-900">
                  {selected.tariffName}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {selected.category?.categoryName} · effective{" "}
                  {date(selected.effectiveFrom)}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Approval status</dt>
                    <dd>
                      <Badge value={selected.status} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Approved by</dt>
                    <dd className="font-semibold">
                      {person(selected.approver)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Simulation</dt>
                    <dd className="font-semibold text-emerald-700">
                      Completed
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Previous action</dt>
                    <dd className="font-semibold">Expire previous</dd>
                  </div>
                </dl>
              </div>
              <Field label="Activation mode">
                <SearchableSelect
                  className={INPUT}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                >
                  <option value="AUTO_ON_DATE">Auto on effective date</option>
                  <option value="NOW">Activate now</option>
                </SearchableSelect>
              </Field>
              <Field label="Activation reason" required>
                <textarea
                  rows={2}
                  className={INPUT}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button
                tone="green"
                className="w-full"
                disabled={saving}
                onClick={activate}
              >
                {saving
                  ? "Activating…"
                  : mode === "NOW"
                    ? "Activate now"
                    : "Schedule activation"}
              </Button>
            </div>
          ) : (
            <p className="py-16 text-center text-slate-400">
              No approved tariffs are ready for activation.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}

export function TariffAssignments() {
  const [categories, setCategories] = useState<Row[]>([]);
  const [tariffs, setTariffs] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [newTariffId, setNewTariffId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api.listCategories(),
      api.listTariffs(),
      api.listTariffAssignments(),
    ])
      .then(([c, t, a]) => {
        setCategories(c);
        setTariffs(t);
        setAssignments(a);
        if (c[0]) setCategoryId(String(c[0].categoryId));
      })
      .catch((e) => setError(e.message));
  }, []);
  const current = tariffs.find(
    (t) => String(t.categoryId) === categoryId && t.status === "ACTIVE",
  );
  const candidates = tariffs.filter(
    (t) =>
      String(t.categoryId) === categoryId &&
      ["DRAFT", "RETURNED", "REJECTED", "APPROVED"].includes(t.status),
  );
  const proposed = tariffs.find((t) => String(t.tariffId) === newTariffId);
  return (
    <Page
      title="Customer category tariff assignment"
      subtitle="Review the current category tariff and prepare its approved replacement"
    >
      {error && <Notice>{error}</Notice>}
      <Card title="Category assignment workspace" className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Customer category">
            <SearchableSelect
              className={INPUT}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setNewTariffId("");
              }}
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.categoryName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Current active tariff">
            <input
              disabled
              className={INPUT}
              value={current?.tariffName ?? "No active tariff"}
            />
          </Field>
          <Field label="New tariff">
            <SearchableSelect
              className={INPUT}
              value={newTariffId}
              onChange={(e) => setNewTariffId(e.target.value)}
            >
              <option value="">Select proposed tariff</option>
              {candidates.map((t) => (
                <option key={t.tariffId} value={t.tariffId}>
                  {t.tariffName} · {pretty(t.status)}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Effective from">
            <input
              disabled
              className={INPUT}
              value={proposed ? date(proposed.effectiveFrom) : ""}
            />
          </Field>
        </div>
        {proposed && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
            <div>
              <div className="font-semibold text-slate-800">
                {proposed.tariffName}
              </div>
              <div className="text-sm text-slate-500">
                {pretty(proposed.billingMethod)} · minimum{" "}
                {money(proposed.minimumCharge)} · standing{" "}
                {money(proposed.standingCharge)}
              </div>
            </div>
            <div className="flex gap-2">
              <LinkButton
                to={`/tariffs/${proposed.tariffId}/simulate`}
                tone="slate"
              >
                Run simulation
              </LinkButton>
              {proposed.status === "APPROVED" && (
                <LinkButton to="/tariffs/activation" tone="green">
                  Assign through activation
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </Card>
      <Card title="Category assignment history">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Category</th>
                <th className={TH}>Tariff</th>
                <th className={TH}>Effective period</th>
                <th className={TH}>Assigned by</th>
                <th className={TH}>Reason</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.assignmentId} className="border-t border-slate-100">
                  <td className={TD}>{a.category?.categoryName}</td>
                  <td className={`${TD} font-semibold text-slate-800`}>
                    {a.tariff?.tariffName}
                  </td>
                  <td className={TD}>
                    {date(a.effectiveFrom)} – {date(a.effectiveTo)}
                  </td>
                  <td className={TD}>{person(a.assigner)}</td>
                  <td className={TD}>{a.reason}</td>
                  <td className={TD}>
                    <Badge value={a.status} />
                  </td>
                </tr>
              ))}
              {!assignments.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    Assignments are recorded automatically when an approved
                    tariff is activated.
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

export function TariffHistory() {
  const [categories, setCategories] = useState<Row[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listCategories().then((c) => {
      setCategories(c);
      if (c[0]) setCategoryId(String(c[0].categoryId));
    });
  }, []);
  useEffect(() => {
    api
      .listTariffs(categoryId ? { categoryId } : {})
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [categoryId]);
  return (
    <Page
      title="Tariff history"
      subtitle="Review every tariff version retained for a customer category"
      actions={
        <Button
          tone="slate"
          onClick={() =>
            exportExcel(
              "tariff-history.xlsx",
              "Tariff History",
              rows.map((t) => ({
                Category: t.category?.categoryName,
                Tariff: t.tariffName,
                Method: t.billingMethod,
                From: date(t.effectiveFrom),
                To: date(t.effectiveTo),
                Status: t.status,
              })),
            )
          }
        >
          Export history
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <Field label="Customer category">
          <SearchableSelect
            className={INPUT}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.categoryName}
              </option>
            ))}
          </SearchableSelect>
        </Field>
      </Card>
      <Card title={`${rows.length} historical version(s)`}>
        <TariffTable
          rows={rows}
          action={(t) => (
            <div className="flex gap-2">
              <Link
                className="font-semibold text-aqua-700"
                to={`/tariffs/${t.tariffId}/audit`}
              >
                Details
              </Link>
              <Link
                className="font-semibold text-emerald-700"
                to={`/tariffs/compare?left=${t.tariffId}`}
              >
                Compare
              </Link>
            </div>
          )}
        />
      </Card>
    </Page>
  );
}

export function TariffComparison() {
  const [tariffs, setTariffs] = useState<Row[]>([]);
  const query = new URLSearchParams(location.search);
  const [leftId, setLeftId] = useState(query.get("left") ?? "");
  const [rightId, setRightId] = useState("");
  useEffect(() => {
    api.listTariffs().then((rows) => {
      setTariffs(rows);
      if (!leftId && rows[1]) setLeftId(String(rows[1].tariffId));
      if (rows[0]) setRightId(String(rows[0].tariffId));
    });
  }, []);
  const left = tariffs.find((t) => String(t.tariffId) === leftId);
  const right = tariffs.find((t) => String(t.tariffId) === rightId);
  const comparisons = useMemo(() => {
    if (!left || !right) return [];
    if (left.billingMethod === "TIERED" && right.billingMethod === "TIERED") {
      const max = Math.max(left.bands.length, right.bands.length);
      return Array.from({ length: max }, (_, i) => {
        const a = left.bands[i];
        const b = right.bands[i];
        const oldRate = Number(a?.ratePerUnit ?? 0);
        const newRate = Number(b?.ratePerUnit ?? 0);
        return {
          band: b
            ? `${b.lowerLimit}–${b.upperLimit ?? "above"}`
            : a
              ? `${a.lowerLimit}–${a.upperLimit ?? "above"}`
              : "—",
          oldRate,
          newRate,
          difference: newRate - oldRate,
          percentage: oldRate ? ((newRate - oldRate) / oldRate) * 100 : 0,
        };
      });
    }
    const oldRate = Number(
      left.billingMethod === "FLAT" ? left.flatAmount : left.ratePerUnit,
    );
    const newRate = Number(
      right.billingMethod === "FLAT" ? right.flatAmount : right.ratePerUnit,
    );
    return [
      {
        band: "Base rate",
        oldRate,
        newRate,
        difference: newRate - oldRate,
        percentage: oldRate ? ((newRate - oldRate) / oldRate) * 100 : 0,
      },
    ];
  }, [left, right]);
  return (
    <Page
      title="Tariff comparison"
      subtitle="Compare rates and percentage changes across tariff versions"
      actions={
        <Button
          tone="slate"
          disabled={!comparisons.length}
          onClick={() =>
            exportExcel("tariff-comparison.xlsx", "Comparison", comparisons)
          }
        >
          Export comparison
        </Button>
      }
    >
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Old tariff">
            <SearchableSelect
              className={INPUT}
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
            >
              <option value="">Select tariff</option>
              {tariffs.map((t) => (
                <option key={t.tariffId} value={t.tariffId}>
                  {t.tariffName} · {t.category?.categoryName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="New tariff">
            <SearchableSelect
              className={INPUT}
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
            >
              <option value="">Select tariff</option>
              {tariffs.map((t) => (
                <option key={t.tariffId} value={t.tariffId}>
                  {t.tariffName} · {t.category?.categoryName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
        </div>
      </Card>
      <Card
        title={`${left?.tariffName ?? "Old tariff"} compared with ${right?.tariffName ?? "new tariff"}`}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Band / charge</th>
                <th className={TH}>Old rate</th>
                <th className={TH}>New rate</th>
                <th className={TH}>Difference</th>
                <th className={TH}>Change</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className={TD}>{r.band}</td>
                  <td className={TD}>{money(r.oldRate, 4)}</td>
                  <td className={TD}>{money(r.newRate, 4)}</td>
                  <td
                    className={`${TD} font-semibold ${r.difference > 0 ? "text-orange-600" : "text-emerald-700"}`}
                  >
                    {money(r.difference, 4)}
                  </td>
                  <td className={TD}>{r.percentage.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {right && (
          <div className="mt-4 flex justify-end">
            <LinkButton to={`/tariffs/${right.tariffId}/simulate`}>
              Run simulation
            </LinkButton>
          </div>
        )}
      </Card>
    </Page>
  );
}

export function TariffAudit() {
  const { id } = useParams();
  const [tariffs, setTariffs] = useState<Row[]>([]);
  const [tariffId, setTariffId] = useState(id ?? "");
  const [tariff, setTariff] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .listTariffs()
      .then((rows) => {
        setError("");
        setTariffs(rows);
        if (!tariffId && rows[0]) setTariffId(String(rows[0].tariffId));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (tariffId) {
      setTariff(null);
      api
        .getTariff(tariffId)
        .then((row) => {
          setError("");
          setTariff(row);
        })
        .catch((e) => setError(e.message));
    }
  }, [tariffId]);
  return (
    <Page
      title="Tariff change audit trail"
      subtitle="Permanent record of creation, simulation, approval and activation"
      actions={
        <Button
          tone="slate"
          disabled={!tariff?.events?.length}
          onClick={() =>
            exportExcel(
              "tariff-audit-trail.xlsx",
              "Audit Trail",
              (tariff?.events ?? []).map((e: Row) => ({
                Date: new Date(e.createdAt).toLocaleString(),
                Tariff: tariff?.tariffName,
                User: person(e.performer),
                Action: e.eventType,
                PreviousStatus: e.previousStatus,
                NewStatus: e.newStatus,
                Details: e.details,
              })),
            )
          }
        >
          Export audit trail
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <Field label="Tariff">
          <SearchableSelect
            className={INPUT}
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
          >
            <option value="">Select tariff</option>
            {tariffs.map((t) => (
              <option key={t.tariffId} value={t.tariffId}>
                {t.tariffName} · {t.category?.categoryName}
              </option>
            ))}
          </SearchableSelect>
        </Field>
      </Card>
      <Card title={tariff?.tariffName ?? "Audit events"}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Date and time</th>
                <th className={TH}>User</th>
                <th className={TH}>Action</th>
                <th className={TH}>Status change</th>
                <th className={TH}>Details</th>
              </tr>
            </thead>
            <tbody>
              {(tariff?.events ?? []).map((e: Row) => (
                <tr key={e.eventId} className="border-t border-slate-100">
                  <td className={TD}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className={TD}>{person(e.performer)}</td>
                  <td className={`${TD} font-semibold text-slate-800`}>
                    {pretty(e.eventType)}
                  </td>
                  <td className={TD}>
                    {e.previousStatus || e.newStatus ? (
                      <>
                        {pretty(e.previousStatus) || "—"} → {pretty(e.newStatus) || "—"}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={TD}>{e.details}</td>
                </tr>
              ))}
              {!tariff?.events?.length && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    Select a tariff to view its audit trail.
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
