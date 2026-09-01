import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";
import { exportExcel } from "../lib/meterFiles";
import { SearchableSelect } from "../components/SearchableSelect";
import { Pagination } from "../components/Pagination";
import { CheckboxMultiSelect } from "../components/CheckboxMultiSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { maskAddress, maskEmail, maskIdentifier, maskName, maskPhone, usePrivacyMode } from "../lib/privacyMode";
import Swal from "sweetalert2";

type Row = Record<string, any>;
const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] leading-5 text-slate-700 outline-none transition duration-200 placeholder:text-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";

function Page({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5 ${className}`}>
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
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60 ${className}`}
    >
      {title && (
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-5 py-4">
          <h2 className="text-[17px] font-bold text-slate-900">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
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
  tone?: "blue" | "green" | "slate" | "orange";
}) {
  const colors = {
    blue: "bg-aqua-700",
    green: "bg-emerald-600",
    slate: "bg-slate-600",
    orange: "bg-orange-500",
  };
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-[15px] font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-md ${colors[tone]}`}
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
  if (tone !== "blue")
    return (
      <SweetAlertToast
        message={children}
        type={tone === "green" ? "success" : "error"}
      />
    );
  const colors = {
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div
      className={`mb-3 whitespace-pre-line rounded-lg border px-3 py-2 text-sm ${colors[tone]}`}
    >
      {children}
    </div>
  );
}
const badges: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  OPEN: "bg-emerald-50 text-emerald-700",
  POSTED: "bg-emerald-50 text-emerald-700",
  PAID: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-cyan-50 text-cyan-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700",
  PENDING: "bg-amber-50 text-amber-700",
  DRAFT: "bg-slate-100 text-slate-600",
  CLOSED: "bg-slate-100 text-slate-600",
  RETURNED: "bg-orange-50 text-orange-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-red-50 text-red-700",
  NONE: "bg-slate-100 text-slate-600",
};
function pretty(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function Badge({ value }: { value?: string | null }) {
  const key = value ?? "NONE";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badges[key] ?? "bg-violet-50 text-violet-700"}`}
    >
      {pretty(key)}
    </span>
  );
}
function money(value: any) {
  return `KSh ${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function date(value?: string) {
  return value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
}
function dateTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}
function person(value?: Row) {
  return value
    ? `${value.firstName ?? ""} ${value.lastName ?? ""}`.trim() ||
        value.username
    : "System";
}
function Spinner() {
  return (
    <div className="flex min-h-40 items-center justify-center text-slate-400">
      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
      Loading…
    </div>
  );
}
function Kpi({
  label,
  value,
  tone = "text-slate-900",
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function BillingStatusChart({
  generated,
  pending,
  approved,
  cancelled,
}: {
  generated: number;
  pending: number;
  approved: number;
  cancelled: number;
}) {
  const accounted = pending + approved + cancelled;
  const other = Math.max(0, generated - accounted);
  const segments = [
    { label: "Approved / posted", value: approved, color: "#10b981" },
    { label: "Pending approval", value: pending, color: "#f59e0b" },
    { label: "Cancelled", value: cancelled, color: "#ef4444" },
    { label: "Other", value: other, color: "#94a3b8" },
  ];
  const total = Math.max(0, generated);
  let cursor = 0;
  const gradient = total
    ? segments
        .filter((segment) => segment.value > 0)
        .map((segment) => {
          const start = cursor;
          cursor += (segment.value / total) * 100;
          return `${segment.color} ${start}% ${cursor}%`;
        })
        .join(", ")
    : "#e2e8f0 0 100%";
  return (
    <Card title="Bill status distribution" className="h-full">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
        <div
          role="img"
          aria-label={`Status distribution for ${total} bills`}
          className="relative h-44 w-44 shrink-0 rounded-full shadow-inner transition duration-300 hover:scale-[1.03]"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-[22px] grid place-items-center rounded-full bg-white shadow-sm">
            <div className="text-center">
              <div className="text-3xl font-extrabold text-slate-900">
                {total.toLocaleString()}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Total bills
              </div>
            </div>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-3">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 transition hover:bg-white hover:shadow-sm"
            >
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                {segment.label}
              </div>
              <div className="mt-1.5 flex items-end justify-between gap-2">
                <strong className="text-xl text-slate-900">
                  {segment.value.toLocaleString()}
                </strong>
                <span className="text-xs font-semibold text-slate-400">
                  {total ? Math.round((segment.value / total) * 100) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function BillingWorkflowChart({
  generated,
  approved,
  notified,
  totalBilling,
}: {
  generated: number;
  approved: number;
  notified: number;
  totalBilling: number;
}) {
  const stages = [
    {
      label: "Generated",
      value: generated,
      color: "from-sky-600 to-cyan-400",
      icon: "01",
    },
    {
      label: "Approved",
      value: approved,
      color: "from-emerald-600 to-teal-400",
      icon: "02",
    },
    {
      label: "Notified",
      value: notified,
      color: "from-violet-600 to-fuchsia-400",
      icon: "03",
    },
  ];
  const average = generated ? totalBilling / generated : 0;
  return (
    <Card title="Billing workflow" className="h-full">
      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-900 p-4 text-white">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Current billing
          </div>
          <div className="mt-1 text-2xl font-extrabold">
            {money(totalBilling)}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Average bill
          </div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">
            {money(average)}
          </div>
        </div>
      </div>
      <div className="space-y-5">
        {stages.map((stage) => {
          const pct = generated
            ? Math.min(100, Math.round((stage.value / generated) * 100))
            : 0;
          return (
            <div key={stage.label} className="group">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-[10px] font-extrabold text-slate-500 transition group-hover:bg-emerald-50 group-hover:text-emerald-700">
                    {stage.icon}
                  </span>
                  {stage.label}
                </span>
                <span className="text-sm">
                  <strong className="text-slate-900">
                    {stage.value.toLocaleString()}
                  </strong>
                  <span className="ml-2 text-xs font-semibold text-slate-400">
                    {pct}%
                  </span>
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${stage.color} shadow-sm transition-all duration-700`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CycleSelect({
  cycles,
  value,
  onChange,
  includeBlank = true,
  disabled = false,
}: {
  cycles: Row[];
  value: string;
  onChange: (value: string) => void;
  includeBlank?: boolean;
  disabled?: boolean;
}) {
  return (
    <SearchableSelect
      className={INPUT}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {includeBlank && <option value="">Select billing period</option>}
      {cycles.map((cycle) => (
        <option key={cycle.billingCycleId} value={cycle.billingCycleId}>
          {cycle.cycleName} · {pretty(cycle.status)}
        </option>
      ))}
    </SearchableSelect>
  );
}

export function BillingDashboard() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .listBillingCycles()
      .then((rows) => {
        setCycles(rows);
        if (rows[0]) setCycleId(String(rows[0].billingCycleId));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api
      .billingDashboard(cycleId)
      .then((row) => {
        setData(row);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [cycleId]);
  const generated = Number(data?.billsGenerated ?? 0);
  const approved = Number(data?.approved ?? 0);
  const readyToPost = Number(data?.readyToPost ?? 0);
  const notified = Number(data?.notified ?? 0);
  return (
    <Page
      title="Billing management dashboard"
      subtitle="Billing progress, approvals, posting, notifications and exceptions"
      actions={
        <>
          <LinkButton to="/billing/periods" tone="green">
            Create billing period
          </LinkButton>
          <LinkButton to="/billing/generate">Generate bills</LinkButton>
          <LinkButton to="/billing/approvals" tone="orange">
            Post approved batch ({readyToPost.toLocaleString()})
          </LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <Field label="Billing period">
          <CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} />
        </Field>
      </Card>
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Bills generated" value={generated} />
            <Kpi
              label="Pending approval"
              value={data.pending}
              tone="text-amber-600"
            />
            <Kpi
              label="Approved / posted"
              value={approved}
              tone="text-emerald-700"
            />
            <Kpi
              label="Total current billing"
              value={money(data.totalBilling)}
              tone="text-aqua-700"
            />
            <Kpi label="Notifications sent" value={notified} />
            <Kpi
              label="Pending adjustments"
              value={data.adjustments}
              tone="text-orange-600"
            />
            <Kpi
              label="Security alerts"
              value={data.alerts}
              tone="text-red-600"
            />
            <Kpi label="Cancelled bills" value={data.cancelled} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <BillingStatusChart
              generated={generated}
              pending={Number(data.pending ?? 0)}
              approved={approved}
              cancelled={Number(data.cancelled ?? 0)}
            />
            <BillingWorkflowChart
              generated={generated}
              approved={approved}
              notified={notified}
              totalBilling={Number(data.totalBilling ?? 0)}
            />
          </div>
          <Card title="Recent billing activity" className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Bill</th>
                    <th className={TH}>Customer</th>
                    <th className={TH}>Action</th>
                    <th className={TH}>User</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent ?? []).map((event: Row) => (
                    <tr key={event.billingEventId} className="border-t">
                      <td className={TD}>{dateTime(event.createdAt)}</td>
                      <td className={TD}>
                        {event.bill?.billNumber ?? "Period"}
                      </td>
                      <td className={TD}>{event.customerName ?? "—"}</td>
                      <td className={TD}>{pretty(event.eventType)}</td>
                      <td className={TD}>{person(event.performer)}</td>
                    </tr>
                  ))}
                  {!data.recent?.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-slate-400"
                      >
                        Billing activity will appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

export function IndividualBillingWorkspace() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
  const penaltyDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const cycleSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [savedSelection] = useState<{
    accountIds: string[];
    readingCycleId: string;
    billingCycleId: string;
  }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("aquaflow_individual_billing_selection") ?? "{}");
      return {
        accountIds: Array.isArray(stored.accountIds) ? stored.accountIds.map(String) : [],
        readingCycleId: String(stored.readingCycleId ?? ""),
        billingCycleId: String(stored.billingCycleId ?? ""),
      };
    } catch {
      return { accountIds: [], readingCycleId: "", billingCycleId: "" };
    }
  });
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [readingCycles, setReadingCycles] = useState<Row[]>([]);
  const [billingCycles, setBillingCycles] = useState<Row[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(savedSelection.accountIds);
  const [readingCycleId, setReadingCycleId] = useState(savedSelection.readingCycleId);
  const [billingCycleId, setBillingCycleId] = useState(savedSelection.billingCycleId);
  const restorePreviewPending = useRef(Boolean(
    savedSelection.accountIds.length && savedSelection.billingCycleId,
  ));
  const [worklist, setWorklist] = useState<Row[]>([]);
  const [readingValues, setReadingValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Row | null>(null);
  const [bills, setBills] = useState<Row[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMeters, setLoadingMeters] = useState(false);
  const [loadingBills, setLoadingBills] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [readingForm, setReadingForm] = useState<Row>({
    cycleCode: `RC-${cycleSuffix}`,
    cycleName: `Meter readings · ${now.toLocaleString(undefined, { month: "long", year: "numeric" })}`,
    startDate: iso(monthStart), endDate: iso(monthEnd), status: "OPEN", remarks: "Individual billing workspace",
  });
  const [billingForm, setBillingForm] = useState<Row>({
    cycleCode: `BC-${cycleSuffix}`,
    cycleName: now.toLocaleString(undefined, { month: "long", year: "numeric" }),
    periodStart: iso(monthStart), periodEnd: iso(monthEnd), dueDate: iso(dueDate), penaltyDate: iso(penaltyDate),
    frequency: "MONTHLY", status: "OPEN", defaultNotification: "SMS", remarks: "Individual billing workspace",
  });

  const actor = getSessionUser();
  const roles = actor?.roles ?? [];
  const hasRole = (...allowed: string[]) => roles.some((role) => allowed.includes(role));
  const canCapture = hasRole("SYSTEM_ADMIN", "METER_READER", "METER_SUPERVISOR", "SUPERVISOR");
  const canManageReadingCycles = hasRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR");
  const canManageBillingPeriods = hasRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR");
  const canApproveReadings = hasRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR", "BILLING_SUPERVISOR");
  const canGenerate = hasRole("SYSTEM_ADMIN", "BILLING_OFFICER");
  const canApproveBills = hasRole("SYSTEM_ADMIN", "BILLING_SUPERVISOR", "FINANCE_MANAGER");
  const canPost = hasRole("SYSTEM_ADMIN", "FINANCE_MANAGER");
  const canNotify = hasRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR");

  async function loadReferenceData(preferredReadingCycleId = readingCycleId, preferredBillingCycleId = billingCycleId) {
    const [accountRows, readingRows, billingRows] = await Promise.all([
      api.listAccounts("", 2_000), api.listReadingCycles(), api.listBillingCycles(),
    ]);
    setAccounts(accountRows);
    setReadingCycles(readingRows);
    setBillingCycles(billingRows);
    const validAccountIds = selectedAccountIds.filter((accountId) =>
      accountRows.some((account: Row) => String(account.accountId) === accountId),
    );
    setSelectedAccountIds(validAccountIds);
    const preferredReadingCycle = readingRows.find((cycle: Row) => String(cycle.readingCycleId) === preferredReadingCycleId);
    const linkedBillingCycleId = preferredReadingCycle?.billingCycleId
      ? String(preferredReadingCycle.billingCycleId)
      : "";
    const preferredPeriod = billingRows.find((cycle: Row) =>
      String(cycle.billingCycleId) === preferredBillingCycleId ||
      (linkedBillingCycleId && String(cycle.billingCycleId) === linkedBillingCycleId),
    );
    if (preferredPeriod) {
      setBillingCycleId(String(preferredPeriod.billingCycleId));
      const linkedReadingCycle = preferredPeriod.readingCycles?.[0];
      setReadingCycleId(linkedReadingCycle ? String(linkedReadingCycle.readingCycleId) : preferredReadingCycle ? String(preferredReadingCycle.readingCycleId) : "");
    } else {
      setBillingCycleId("");
      setReadingCycleId(preferredReadingCycle ? String(preferredReadingCycle.readingCycleId) : "");
    }
  }
  async function loadBills(cycleId = billingCycleId) {
    if (!cycleId) {
      setBills([]);
      setLoadingBills(false);
      return;
    }
    setLoadingBills(true);
    try {
      const rows = await api.listBills({ billingCycleId: cycleId, limit: "10000" });
      setBills(rows.filter((bill: Row) => selectedAccountIds.includes(String(bill.accountId))));
    } finally {
      setLoadingBills(false);
    }
  }
  useEffect(() => {
    loadReferenceData().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    localStorage.setItem("aquaflow_individual_billing_selection", JSON.stringify({
      accountIds: selectedAccountIds,
      readingCycleId,
      billingCycleId,
    }));
  }, [selectedAccountIds.join(","), readingCycleId, billingCycleId]);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setBills([]);
    if (!readingCycleId || !selectedAccountIds.length) {
      setWorklist([]);
      return () => { active = false; };
    }
    setLoadingMeters(true);
    api.readingWorklist({ cycleId: readingCycleId, accountIds: selectedAccountIds.join(",") })
      .then((rows) => {
        if (!active) return;
        setWorklist(rows);
        setReadingValues((current) => Object.fromEntries(rows.map((row: Row) => [
          String(row.meterId), row.cycleReading?.currentReading == null ? current[String(row.meterId)] ?? "" : String(row.cycleReading.currentReading),
        ])));
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoadingMeters(false));
    return () => { active = false; };
  }, [readingCycleId, selectedAccountIds.join(",")]);
  useEffect(() => {
    loadBills().catch((e) => setError(e.message));
  }, [billingCycleId, selectedAccountIds.join(",")]);
  useEffect(() => {
    if (loading || !restorePreviewPending.current) return;
    restorePreviewPending.current = false;
    if (!billingCycleId || !selectedAccountIds.length) return;
    api.previewBills({
      billingCycleId,
      accountIds: selectedAccountIds.join(","),
      includePreviousBalance: true,
    }).then(setPreview).catch((e) => setError(e.message));
  }, [loading, billingCycleId, selectedAccountIds.join(",")]);

  const selectedReadingCycle = readingCycles.find((cycle) => String(cycle.readingCycleId) === readingCycleId);
  const selectedBillingCycle = billingCycles.find((cycle) => String(cycle.billingCycleId) === billingCycleId);
  const accountOptions = accounts.filter((account) => account.accountStatus === "ACTIVE").map((account) => ({
    value: String(account.accountId), label: `${account.accountNumber} · ${accountCustomerName(account)}`,
  }));
  const selectedAccounts = accounts.filter((account) => selectedAccountIds.includes(String(account.accountId)));
  const worklistAccountIds = new Set(worklist.map((row) => String(row.accountId)));
  const missingMeterAccounts = selectedAccounts.filter((account) => !worklistAccountIds.has(String(account.accountId)));
  const previousReading = (row: Row) => Number(row.cycleReading?.previousReading ?? row.meter?.readings?.[0]?.currentReading ?? row.meter?.openingReading ?? 0);
  const invalidReadingRows = worklist.filter((row) => {
    if (row.cycleReading || readingValues[String(row.meterId)] === "") return false;
    const current = Number(readingValues[String(row.meterId)]);
    return !Number.isFinite(current) || current < previousReading(row);
  });
  const pendingReadingIds = worklist.filter((row) => row.cycleReading?.approvalStatus === "PENDING").map((row) => String(row.cycleReading.readingId));
  const approvedReadingCount = worklist.filter((row) => row.cycleReading?.approvalStatus === "APPROVED").length;
  const approvedReadingAccountIds = Array.from(new Set(worklist
    .filter((row) => row.cycleReading?.approvalStatus === "APPROVED")
    .map((row) => String(row.accountId))));
  const uncapturedReadingAccountIds = Array.from(new Set(worklist
    .filter((row) => !row.cycleReading)
    .map((row) => String(row.accountId))));
  const noOpenReadingCycle = !readingCycles.some((cycle) => cycle.status === "OPEN");
  const closedCycleHasUncapturedReadings = selectedReadingCycle?.status === "CLOSED" && worklist.some((row) => !row.cycleReading);
  const mixedReadingReadiness = selectedReadingCycle?.status === "CLOSED" && approvedReadingAccountIds.length > 0 && uncapturedReadingAccountIds.length > 0;
  const needsReadingCycle = selectedAccountIds.length > 0 && (
    (!readingCycleId && noOpenReadingCycle) || (closedCycleHasUncapturedReadings && !approvedReadingAccountIds.length)
  );
  const readingsReadyForBilling = worklist.length > 0 && worklist.every((row) => row.cycleReading?.approvalStatus === "APPROVED");
  const needsBillingPeriod = !needsReadingCycle && selectedReadingCycle?.status === "CLOSED" && readingsReadyForBilling && !billingCycleId && !selectedReadingCycle?.billingCycleId;
  const cyclesAwaitingBilling = readingCycles.filter((cycle) => {
    if (cycle.status !== "CLOSED") return false;
    if (!cycle.billingCycleId) return true;
    const linkedPeriod = billingCycles.find((period) => String(period.billingCycleId) === String(cycle.billingCycleId));
    return !linkedPeriod || linkedPeriod.status !== "POSTED";
  });
  const earlierCyclesAwaitingBilling = cyclesAwaitingBilling.filter((cycle) =>
    String(cycle.readingCycleId) !== readingCycleId &&
    (!selectedReadingCycle || new Date(cycle.endDate) < new Date(selectedReadingCycle.startDate)),
  );
  const previewByAccount = new Map((preview?.rows ?? []).map((row: Row) => [String(row.accountId), row]));
  const selectedBills = billingCycleId
    ? bills.filter((bill) => selectedAccountIds.includes(String(bill.accountId)))
    : [];
  const pendingBillIds = selectedBills.filter((bill) => bill.status === "PENDING_APPROVAL").map((bill) => String(bill.billId));
  const approvedBillIds = selectedBills.filter((bill) => bill.status === "APPROVED").map((bill) => String(bill.billId));
  const billHasExistingSms = (bill: Row) =>
    ["QUEUED", "SENT", "DELIVERED"].includes(String(bill.notificationStatus ?? "")) ||
    (bill.generalNotifications ?? []).some((notification: Row) =>
      ["QUEUED", "SENT", "DELIVERED"].includes(String(notification.deliveryStatus ?? "")),
    );
  const outstandingPostedBills = selectedBills.filter((bill) =>
    ["POSTED", "PARTIALLY_PAID"].includes(bill.status) &&
    Number(bill.totalAmountDue ?? 0) - Number(bill.paidAmount ?? 0) > 0,
  );
  const notifiableBillIds = outstandingPostedBills
    .filter((bill) => !billHasExistingSms(bill))
    .map((bill) => String(bill.billId));
  const smsAlreadyRequestedCount = outstandingPostedBills.filter(billHasExistingSms).length;
  const smsActionLabel = notifiableBillIds.length
    ? `Send ${notifiableBillIds.length} bill SMS`
    : smsAlreadyRequestedCount
      ? "Bill SMS already sent"
      : "No bill SMS due";

  async function operation(label: string, action: () => Promise<void>) {
    setBusy(label); setError(""); setMessage("");
    try { await action(); } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  async function createReadingCycle() {
    if (cyclesAwaitingBilling.length) {
      const confirmation = await Swal.fire({
        icon: "warning",
        title: `${cyclesAwaitingBilling.length} closed cycle(s) still await billing`,
        text: `${cyclesAwaitingBilling.slice(0, 4).map((cycle) => cycle.cycleCode).join(", ")}${cyclesAwaitingBilling.length > 4 ? " and others" : ""} must be billed before newer bills can be posted. You may create the next reading cycle and capture readings in parallel.`,
        showCancelButton: true,
        confirmButtonText: "Create next cycle",
        confirmButtonColor: "#0369a1",
      });
      if (!confirmation.isConfirmed) return;
    }
    await operation("creating-reading-cycle", async () => {
      const created = await api.createReadingCycle(readingForm);
      await loadReferenceData(String(created.readingCycleId), billingCycleId);
      setReadingCycleId(String(created.readingCycleId));
      setBillingCycleId("");
      setShowSetup(false);
      setMessage("Reading cycle created and selected. Enter the current meter readings to continue.");
    });
  }
  async function createBillingPeriod() {
    if (!readingCycleId) return;
    await operation("creating-billing-period", async () => {
      const created = await api.createBillingCycle({ ...billingForm, readingCycleId });
      await loadReferenceData(readingCycleId, String(created.billingCycleId));
      setBillingCycleId(String(created.billingCycleId));
      setShowSetup(false);
      setMessage("Billing period created, linked and selected. You can now preview the selected bills.");
    });
  }
  async function saveReadings() {
    const rows = worklist.filter((row) => !row.cycleReading && readingValues[String(row.meterId)] !== "");
    if (!rows.length) return setError("Enter at least one current reading that has not already been captured.");
    if (invalidReadingRows.length) {
      return setError("A current reading cannot be lower than its previous reading. Correct the highlighted meter reading before saving.");
    }
    await operation("saving-readings", async () => {
      const result = await api.syncReadings(rows.map((row) => ({
        meterId: String(row.meterId), readingCycleId, previousReading: previousReading(row),
        currentReading: Number(readingValues[String(row.meterId)]), readingType: "ACTUAL",
        readingDate: new Date().toISOString(), meterCondition: "GOOD", evidence: [],
        remarks: "Captured in individual billing workspace",
      })));
      if (result.failed) throw new Error(result.results?.find((item: Row) => !item.ok)?.error ?? `${result.failed} reading(s) failed.`);
      setMessage(`${result.succeeded} meter reading(s) captured.`);
      const rowsAfter = await api.readingWorklist({ cycleId: readingCycleId, accountIds: selectedAccountIds.join(",") }); setWorklist(rowsAfter);
    });
  }
  async function approveReadings() {
    await operation("approving-readings", async () => {
      const result = await api.bulkDecideReadings(pendingReadingIds, "APPROVED", "Approved in individual billing workspace");
      setMessage(`${result.updated} reading(s) approved.`);
      const rows = await api.readingWorklist({ cycleId: readingCycleId, accountIds: selectedAccountIds.join(",") }); setWorklist(rows);
    });
  }
  async function closeReadingCycle() {
    const confirmation = await Swal.fire({ icon: "warning", title: "Close the reading cycle?", text: "This closes the entire reading cycle, not only the selected accounts. No more readings can be captured in it.", showCancelButton: true, confirmButtonText: "Close cycle", confirmButtonColor: "#475569" });
    if (!confirmation.isConfirmed) return;
    await operation("closing-reading-cycle", async () => {
      await api.updateReadingCycleStatus(readingCycleId, "CLOSED");
      await loadReferenceData(readingCycleId, billingCycleId); setMessage("Reading cycle closed and ready for billing.");
    });
  }
  async function previewSelectedBills() {
    await operation("previewing", async () => {
      const result = await api.previewBills({ billingCycleId, accountIds: selectedAccountIds.join(","), includePreviousBalance: true });
      setPreview(result); setMessage(`${result.summary.eligible} of ${result.summary.accounts} selected account(s) are ready to bill.`);
    });
  }
  async function generateSelectedBills() {
    await operation("generating", async () => {
      const result = await api.generateBills({ billingCycleId, accountIds: selectedAccountIds, includePreviousBalance: true, includePenalties: true, sendForApproval: true });
      await loadBills(); setPreview(null); setMessage(`${result.generated} bill(s) generated and sent for approval.`);
    });
  }
  async function approveBills() {
    await operation("approving-bills", async () => {
      const result = await api.decideBills(pendingBillIds, "APPROVE", "Approved in individual billing workspace");
      await loadBills(); setMessage(`${result.updated} bill(s) approved.`);
    });
  }
  async function postBills() {
    const confirmation = await Swal.fire({ icon: "warning", title: `Post ${approvedBillIds.length} bill(s)?`, text: "Posting immediately updates the selected customer account balances.", showCancelButton: true, confirmButtonText: "Post approved bills", confirmButtonColor: "#ea580c" });
    if (!confirmation.isConfirmed) return;
    await operation("posting-bills", async () => {
      const result = await api.postBills(approvedBillIds, "Posted from individual billing workspace");
      await loadBills(); setMessage(`${result.posted} bill(s) posted to customer accounts.`);
    });
  }
  async function sendSms() {
    const confirmation = await Swal.fire({ icon: "question", title: `Send ${notifiableBillIds.length} bill SMS?`, text: "Messages will be queued and immediately processed through the active SMS provider.", showCancelButton: true, confirmButtonText: "Send bill SMS", confirmButtonColor: "#059669" });
    if (!confirmation.isConfirmed) return;
    await operation("sending-sms", async () => {
      const queued = await api.sendBillNotifications({ billingCycleId, billIds: notifiableBillIds, channels: ["SMS"] });
      const processed = queued.notificationIds?.length ? await api.processNotifications(queued.notificationIds) : null;
      const delivered = (processed?.processed ?? []).filter((item: Row) => ["SENT", "DELIVERED"].includes(item?.deliveryStatus)).length;
      await loadBills();
      setMessage(`${queued.notifications} SMS notification(s) queued${processed ? `; ${delivered} processed successfully` : ""}.`);
    });
  }

  const actionButton = (label: string, busyKey: string, disabled: boolean, onClick: () => void, tone: "blue" | "green" | "slate" | "orange" = "blue") => (
    <Button className="flex w-full items-center justify-center" tone={tone} disabled={disabled || Boolean(busy)} onClick={onClick}>
      {busy === busyKey ? <span className="inline-flex items-center"><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Working…</span> : label}
    </Button>
  );
  const meterStepDone = selectedReadingCycle?.status === "CLOSED" && readingsReadyForBilling;
  const billsStepDone = selectedBills.length > 0 && selectedBills.every((bill) => ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"].includes(bill.status));
  const postStepDone = selectedBills.length > 0 && selectedBills.every((bill) => ["POSTED", "PARTIALLY_PAID", "PAID"].includes(bill.status)) && notifiableBillIds.length === 0;
  const currentWorkflowStep = !meterStepDone ? 1 : !billsStepDone ? 2 : 3;
  const workflowStep = (number: number, title: string, done: boolean, content: ReactNode, last = false) => {
    const current = currentWorkflowStep === number && !done;
    return <div className={`relative pl-10 ${last ? "" : "pb-5"}`}>
      {!last && <div className={`absolute left-[15px] top-8 h-[calc(100%-1rem)] w-0.5 ${done ? "bg-emerald-300" : "bg-slate-200"}`} />}
      <div className={`absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-extrabold ${done ? "border-emerald-500 bg-emerald-500 text-white" : current ? "border-aqua-600 bg-white text-aqua-700 ring-4 ring-aqua-50" : "border-slate-300 bg-white text-slate-400"}`}>{done ? <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg> : number}</div>
      <div className="mb-2 flex items-center justify-between gap-2"><div className={`text-xs font-bold uppercase tracking-wide ${current ? "text-aqua-700" : done ? "text-emerald-700" : "text-slate-400"}`}>{title}</div>{current && <span className="rounded-full bg-aqua-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-aqua-700">Current</span>}{done && <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Complete</span>}</div>
      <div className="space-y-2">{content}</div>
    </div>;
  };

  return (
    <Page title="Individual billing workspace" subtitle="Capture readings, prepare selected bills, post and notify customers from one screen" className="[&_.page-screen-header]:mb-3">
      {error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}
      {selectedReadingCycle?.status === "OPEN" && earlierCyclesAwaitingBilling.length > 0 && <div className="mb-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 6v4m0 3h.01" /><circle cx="10" cy="10" r="8" /></svg></div>
        <div><div className="font-bold">Earlier closed cycle{earlierCyclesAwaitingBilling.length === 1 ? "" : "s"} awaiting billing</div><div className="mt-0.5">{earlierCyclesAwaitingBilling.map((cycle) => cycle.cycleCode).join(", ")} can remain open operationally while readings are captured here, but this cycle's bills cannot be posted until the same customers' older readings are billed.</div></div>
      </div>}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 p-4 lg:grid-cols-[minmax(280px,1.3fr)_minmax(220px,1fr)_minmax(220px,1fr)_auto]">
          <Field label="Accounts / customers" required><CheckboxMultiSelect className={INPUT} maxSelected={500} options={accountOptions} placeholder={loading ? "Loading accounts…" : "Select one or more accounts"} value={selectedAccountIds} onChange={setSelectedAccountIds} /></Field>
          <Field label="Reading cycle" required><SearchableSelect className={INPUT} value={readingCycleId} onChange={(event) => { const value = event.target.value; setReadingCycleId(value); const readingCycle = readingCycles.find((cycle) => String(cycle.readingCycleId) === value); const linked = readingCycle?.billingCycleId ? billingCycles.find((cycle) => String(cycle.billingCycleId) === String(readingCycle.billingCycleId)) : billingCycles.find((cycle) => cycle.readingCycles?.some((item: Row) => String(item.readingCycleId) === value)); setBillingCycleId(linked ? String(linked.billingCycleId) : ""); }}><option value="">Select reading cycle</option>{readingCycles.filter((cycle) => !["CANCELLED"].includes(cycle.status)).map((cycle) => <option key={cycle.readingCycleId} value={cycle.readingCycleId}>{cycle.cycleCode} · {pretty(cycle.status)}</option>)}</SearchableSelect></Field>
          <Field label="Billing period"><SearchableSelect className={INPUT} value={billingCycleId} onChange={(event) => { const value = event.target.value; setBillingCycleId(value); const cycle = billingCycles.find((item) => String(item.billingCycleId) === value); if (cycle?.readingCycles?.[0]) setReadingCycleId(String(cycle.readingCycles[0].readingCycleId)); }}><option value="">Select or create period</option>{billingCycles.filter((cycle) => cycle.status !== "CANCELLED").map((cycle) => <option key={cycle.billingCycleId} value={cycle.billingCycleId}>{cycle.cycleCode} · {pretty(cycle.status)}</option>)}</SearchableSelect></Field>
          <div className="flex items-end">{!mixedReadingReadiness && <button type="button" onClick={() => setShowSetup((value) => !value)} className="whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">{showSetup ? "Hide setup" : needsReadingCycle ? "Create reading cycle" : needsBillingPeriod ? "Create billing period" : "Create cycles"}</button>}</div>
        </div>
        {mixedReadingReadiness && !showSetup && <div className="border-t border-violet-200 bg-violet-50 px-4 py-3">
          <div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 5h4v4H5zM11 11h4v4h-4zM9 7h3a2 2 0 0 1 2 2v2M11 13H8a2 2 0 0 1-2-2V9" /></svg></div><div><div className="font-bold text-violet-900">The selected accounts are at different billing stages</div><div className="mt-0.5 text-sm text-violet-800">{approvedReadingAccountIds.length} account(s) have approved readings and are ready for a billing period. {uncapturedReadingAccountIds.length} account(s) have no reading in this closed cycle and need a new open reading cycle.</div></div></div>
          <div className="mt-3 flex flex-wrap gap-2 pl-11">
            <button type="button" onClick={() => { setSelectedAccountIds(approvedReadingAccountIds); setShowSetup(true); }} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-violet-800">Continue with {approvedReadingAccountIds.length} ready account(s)</button>
            <button type="button" onClick={() => { setSelectedAccountIds(uncapturedReadingAccountIds); setBillingCycleId(""); setShowSetup(true); }} className="rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-bold text-violet-800 hover:bg-violet-100">Move {uncapturedReadingAccountIds.length} account(s) to a new cycle</button>
          </div>
        </div>}
        {needsReadingCycle && !showSetup && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 5v10M5 10h10" /><circle cx="10" cy="10" r="8" /></svg></div><div><div className="font-bold text-blue-900">Create an open reading cycle to continue</div><div className="mt-0.5 text-sm text-blue-800">This customer has no reading in {selectedReadingCycle?.cycleCode ?? "an open cycle"}. A closed cycle cannot accept new readings.</div></div></div>
          <button type="button" onClick={() => setShowSetup(true)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-800">Create reading cycle</button>
        </div>}
        {needsBillingPeriod && !showSetup && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 6v4m0 3h.01" /><circle cx="10" cy="10" r="8" /></svg></div><div><div className="font-bold text-amber-900">Create a billing period to continue</div><div className="mt-0.5 text-sm text-amber-800">The readings in {selectedReadingCycle?.cycleCode} are approved and closed. Link a billing period before previewing or generating bills.</div></div></div>
          <button type="button" onClick={() => setShowSetup(true)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700">Create billing period</button>
        </div>}
        {showSetup && <div className={`grid gap-4 border-t border-slate-100 bg-slate-50/60 p-4 ${needsBillingPeriod || needsReadingCycle ? "" : "xl:grid-cols-2"}`}>
          {!needsBillingPeriod && <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-slate-900">New reading cycle</h3><p className="text-xs text-slate-500">Create it open so readings can be captured</p></div><Badge value={readingForm.status} /></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Cycle code" required><input className={INPUT} value={readingForm.cycleCode} onChange={(e) => setReadingForm({ ...readingForm, cycleCode: e.target.value })} /></Field><Field label="Cycle name" required><input className={INPUT} value={readingForm.cycleName} onChange={(e) => setReadingForm({ ...readingForm, cycleName: e.target.value })} /></Field><Field label="Start date" required><input type="date" className={INPUT} value={readingForm.startDate} onChange={(e) => setReadingForm({ ...readingForm, startDate: e.target.value })} /></Field><Field label="End date" required><input type="date" className={INPUT} value={readingForm.endDate} onChange={(e) => setReadingForm({ ...readingForm, endDate: e.target.value })} /></Field></div><div className="mt-3">{actionButton("Create and select reading cycle", "creating-reading-cycle", !canManageReadingCycles || !readingForm.cycleCode || !readingForm.cycleName, createReadingCycle, "slate")}</div></div>}
          {!needsReadingCycle && <div>
            <div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-slate-900">New billing period</h3><p className="text-xs text-slate-500">Links to the selected closed reading cycle</p></div><Badge value={billingForm.status} /></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Period code" required><input className={INPUT} value={billingForm.cycleCode} onChange={(e) => setBillingForm({ ...billingForm, cycleCode: e.target.value })} /></Field>
              <Field label="Period name" required><input className={INPUT} value={billingForm.cycleName} onChange={(e) => setBillingForm({ ...billingForm, cycleName: e.target.value })} /></Field>
              <Field label="Period start" required><input type="date" className={INPUT} value={billingForm.periodStart} onChange={(e) => setBillingForm({ ...billingForm, periodStart: e.target.value })} /></Field>
              <Field label="Period end" required><input type="date" min={billingForm.periodStart} className={INPUT} value={billingForm.periodEnd} onChange={(e) => setBillingForm({ ...billingForm, periodEnd: e.target.value })} /></Field>
              <Field label="Due date" required><input type="date" min={billingForm.periodEnd} className={INPUT} value={billingForm.dueDate} onChange={(e) => setBillingForm({ ...billingForm, dueDate: e.target.value })} /></Field>
              <Field label="Penalty date"><input type="date" min={billingForm.dueDate} className={INPUT} value={billingForm.penaltyDate} onChange={(e) => setBillingForm({ ...billingForm, penaltyDate: e.target.value })} /></Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">The due date must be on or after the period end. Penalties begin on the optional penalty date, which cannot be before the due date.</p>
            <div className="mt-3">{actionButton("Create and link billing period", "creating-billing-period", !canManageBillingPeriods || selectedReadingCycle?.status !== "CLOSED" || Boolean(selectedReadingCycle?.billingCycleId) || !billingForm.periodStart || !billingForm.periodEnd || !billingForm.dueDate || billingForm.periodEnd < billingForm.periodStart || billingForm.dueDate < billingForm.periodEnd || Boolean(billingForm.penaltyDate && billingForm.penaltyDate < billingForm.dueDate), createBillingPeriod, "slate")}</div>
          </div>}
        </div>}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div><div className="flex items-center gap-2"><h2 className="font-bold text-slate-900">Meter readings and bill preview</h2><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{selectedAccountIds.length}</span></div><p className="text-xs text-slate-500">Previous readings are pulled automatically from active meters</p></div><div className="flex gap-3 text-xs text-slate-500"><span>{approvedReadingCount} approved</span><span>{selectedBills.length} bills</span></div></div>
          {loadingMeters ? <Spinner /> : <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className={TH}>Account / Customer</th><th className={TH}>Meter</th><th className={TH}>Previous</th><th className={TH}>Current reading</th><th className={TH}>Usage</th><th className={TH}>Reading</th><th className={TH}>Bill / Amount</th></tr></thead><tbody>
            {worklist.map((row) => {
              const previous = previousReading(row);
              const rawCurrent = readingValues[String(row.meterId)] ?? "";
              const current = Number(rawCurrent);
              const invalid = rawCurrent !== "" && (!Number.isFinite(current) || current < previous);
              const usage = !invalid && rawCurrent !== "" ? current - previous : null;
              const billPreview = previewByAccount.get(String(row.accountId)) as Row | undefined;
              const bill = selectedBills.find((item) => String(item.accountId) === String(row.accountId));
              return <tr key={row.assignmentId} className={`border-t ${invalid ? "border-red-200 bg-red-50/40" : "border-slate-100"}`}>
                <td className={TD}><div className="font-semibold text-slate-800">{row.account.accountNumber}</div><div className="text-xs text-slate-400">{row.customerName}</div></td>
                <td className={TD}><div className="font-medium">{row.meter.meterNumber}</div><div className="text-xs text-slate-400">{pretty(row.meter.technology)}</div></td>
                <td className={`${TD} font-semibold text-slate-700`}>{previous.toLocaleString()}</td>
                <td className={TD}>
                  <input type="number" min={previous} step="0.001" disabled={Boolean(row.cycleReading) || selectedReadingCycle?.status !== "OPEN"} aria-invalid={invalid} className={`${INPUT} w-40 py-2 ${invalid ? "border-red-400 bg-red-50 text-red-700 focus:border-red-500 focus:ring-red-100" : ""}`} value={rawCurrent} onChange={(e) => setReadingValues({ ...readingValues, [String(row.meterId)]: e.target.value })} placeholder={`Minimum ${previous}`} />
                  {invalid && <div className="mt-1 text-xs font-semibold text-red-600">Must be {previous.toLocaleString()} or higher</div>}
                </td>
                <td className={`${TD} font-bold ${invalid ? "text-red-600" : "text-slate-800"}`}>{invalid ? "Invalid" : usage == null ? "—" : usage.toLocaleString()}</td>
                <td className={TD}>{row.cycleReading ? <Badge value={row.cycleReading.approvalStatus} /> : <span className="text-xs text-slate-400">Not captured</span>}</td>
                <td className={TD}>{loadingBills && billingCycleId ? <div className="space-y-2" aria-label="Loading bill amount"><div className="h-4 w-24 animate-pulse rounded bg-slate-200" /><div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" /></div> : bill ? <><div className="font-bold text-slate-800">{money(bill.totalAmountDue)}</div><Badge value={bill.status} /></> : billPreview ? <><div className="font-bold text-slate-800">{money(billPreview.totalAmountDue)}</div><span className={`text-xs font-semibold ${billPreview.eligible ? "text-emerald-600" : "text-red-600"}`}>{pretty(billPreview.issue)}</span></> : <span className="text-xs text-slate-400">Not prepared</span>}</td>
              </tr>;
            })}
            {missingMeterAccounts.map((account) => <tr key={`missing-${account.accountId}`} className="border-t border-slate-100 bg-red-50/30"><td className={TD}><div className="font-semibold text-slate-800">{account.accountNumber}</div><div className="text-xs text-slate-400">{accountCustomerName(account)}</div></td><td colSpan={6} className={`${TD} text-red-600`}>No active customer meter assignment was found.</td></tr>)}
            {!selectedAccountIds.length && <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400">Select one or more customer accounts to begin.</td></tr>}
          </tbody></table></div>}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Workflow actions</h2><p className="text-xs text-slate-500">Complete each available step in order</p></div>
          <div className="p-4">
            <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"><div className="flex justify-between"><span className="text-slate-500">Reading cycle</span><Badge value={selectedReadingCycle?.status} /></div><div className="mt-2 flex justify-between"><span className="text-slate-500">Billing period</span><Badge value={selectedBillingCycle?.status} /></div></div>
            {workflowStep(1, "Meter readings", meterStepDone, <>
              {actionButton("Save current readings", "saving-readings", !canCapture || selectedReadingCycle?.status !== "OPEN" || invalidReadingRows.length > 0 || !worklist.some((row) => !row.cycleReading && readingValues[String(row.meterId)] !== ""), saveReadings)}
              {actionButton(`Approve ${pendingReadingIds.length} reading(s)`, "approving-readings", !canApproveReadings || !pendingReadingIds.length, approveReadings, "green")}
              {actionButton("Close reading cycle", "closing-reading-cycle", !canApproveReadings || selectedReadingCycle?.status !== "OPEN" || !worklist.length || pendingReadingIds.length > 0 || approvedReadingCount < worklist.length, closeReadingCycle, "slate")}
            </>)}
            {workflowStep(2, "Prepare bills", billsStepDone, <>
              {needsBillingPeriod && <Button className="flex w-full items-center justify-center" onClick={() => setShowSetup(true)}>Create billing period</Button>}
              {actionButton("Preview selected bills", "previewing", !billingCycleId || selectedReadingCycle?.status !== "CLOSED" || !selectedAccountIds.length, previewSelectedBills, "slate")}
              {actionButton(`Generate ${preview?.summary?.eligible ?? 0} eligible bill(s)`, "generating", !canGenerate || !preview?.summary?.eligible, generateSelectedBills)}
              {actionButton(`Approve ${pendingBillIds.length} bill(s)`, "approving-bills", !canApproveBills || !pendingBillIds.length, approveBills, "green")}
            </>)}
            {workflowStep(3, "Post and notify", postStepDone, <>
              {actionButton(`Post ${approvedBillIds.length} approved bill(s)`, "posting-bills", !canPost || !approvedBillIds.length, postBills, "orange")}
              {actionButton(smsActionLabel, "sending-sms", !canNotify || !notifiableBillIds.length || selectedReadingCycle?.status !== "CLOSED", sendSms, "green")}
            </>, true)}
            <p className="text-xs leading-5 text-slate-400">Permissions and maker-checker rules still apply. A non-admin generator cannot approve their own bills.</p>
          </div>
        </section>
      </div>
    </Page>
  );
}

export function BillingPeriods() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const due = new Date(now.getFullYear(), now.getMonth() + 1, 10);
  const penalty = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  const [cycles, setCycles] = useState<Row[]>([]);
  const [readingCycles, setReadingCycles] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Row>({
    cycleCode: `BC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    cycleName: now.toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    }),
    readingCycleId: "",
    periodStart: iso(start),
    periodEnd: iso(end),
    dueDate: iso(due),
    penaltyDate: iso(penalty),
    frequency: "MONTHLY",
    status: "OPEN",
    defaultNotification: "SMS_APP",
    remarks: "",
  });
  const load = () =>
    Promise.all([api.listBillingCycles(), api.listReadingCycles()]).then(
      ([b, r]) => {
        setCycles(b);
        setReadingCycles(r);
        setError("");
      },
    );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createBillingCycle(form);
      setMessage("Billing period created and linked to the reading cycle.");
      await load();
      setForm({
        ...form,
        cycleCode: "",
        cycleName: "",
        readingCycleId: "",
        remarks: "",
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function status(cycle: Row, next: string) {
    const reason = window.prompt(
      `Reason for changing ${cycle.cycleCode} to ${next.toLowerCase()}:`,
    );
    if (!reason) return;
    try {
      await api.updateBillingCycleStatus(
        String(cycle.billingCycleId),
        next,
        reason,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Billing periods"
      subtitle="Create, link and control billing periods"
      actions={<LinkButton to="/billing/generate">Generate bills</LinkButton>}
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid gap-5 xl:grid-cols-[430px_1fr] xl:items-start">
        <Card
          title="Create billing period"
          className="shadow-md shadow-slate-200/50 xl:sticky xl:top-24"
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period code" required>
                <input
                  required
                  className={INPUT}
                  value={form.cycleCode}
                  onChange={(e) =>
                    setForm({ ...form, cycleCode: e.target.value })
                  }
                />
              </Field>
              <Field label="Frequency">
                <SearchableSelect
                  className={INPUT}
                  value={form.frequency}
                  onChange={(e) =>
                    setForm({ ...form, frequency: e.target.value })
                  }
                >
                  <option>MONTHLY</option>
                  <option>WEEKLY</option>
                  <option>CUSTOM</option>
                </SearchableSelect>
              </Field>
            </div>
            <Field label="Period name" required>
              <input
                required
                className={INPUT}
                value={form.cycleName}
                onChange={(e) =>
                  setForm({ ...form, cycleName: e.target.value })
                }
              />
            </Field>
            <Field label="Closed reading cycle" required>
              <SearchableSelect
                required
                className={INPUT}
                value={form.readingCycleId}
                onChange={(e) =>
                  setForm({ ...form, readingCycleId: e.target.value })
                }
              >
                <option value="">Select closed cycle</option>
                {readingCycles
                  .filter((r) => r.status === "CLOSED" && !r.billingCycleId)
                  .map((r) => (
                    <option key={r.readingCycleId} value={r.readingCycleId}>
                      {r.cycleName} · {r.cycleCode}
                    </option>
                  ))}
              </SearchableSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" required>
                <input
                  required
                  type="date"
                  className={INPUT}
                  value={form.periodStart}
                  onChange={(e) =>
                    setForm({ ...form, periodStart: e.target.value })
                  }
                />
              </Field>
              <Field label="End date" required>
                <input
                  required
                  type="date"
                  className={INPUT}
                  value={form.periodEnd}
                  onChange={(e) =>
                    setForm({ ...form, periodEnd: e.target.value })
                  }
                />
              </Field>
              <Field label="Due date" required>
                <input
                  required
                  type="date"
                  className={INPUT}
                  value={form.dueDate}
                  onChange={(e) =>
                    setForm({ ...form, dueDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Penalty date">
                <input
                  type="date"
                  className={INPUT}
                  value={form.penaltyDate}
                  onChange={(e) =>
                    setForm({ ...form, penaltyDate: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Initial status">
                <SearchableSelect
                  className={INPUT}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="OPEN">Open</option>
                </SearchableSelect>
              </Field>
              <Field label="Notifications">
                <SearchableSelect
                  className={INPUT}
                  value={form.defaultNotification}
                  onChange={(e) =>
                    setForm({ ...form, defaultNotification: e.target.value })
                  }
                >
                  <option value="SMS_APP">SMS + App</option>
                  <option value="SMS">SMS</option>
                  <option value="APP">App</option>
                  <option value="EMAIL">Email</option>
                </SearchableSelect>
              </Field>
            </div>
            <Field label="Remarks">
              <textarea
                rows={2}
                className={INPUT}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>
            <Button
              disabled={saving || !form.readingCycleId}
              className="w-full bg-emerald-600 py-3 hover:bg-emerald-700"
            >
              {saving ? "Creating…" : "Create period"}
            </Button>
          </form>
        </Card>
        <Card
          title="Billing period register"
          className="min-w-0 shadow-md shadow-slate-200/50"
        >
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-slate-50/90">
                  <th className={TH}>Period</th>
                  <th className={TH}>Dates</th>
                  <th className={TH}>Reading cycle</th>
                  <th className={TH}>Bills</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Action</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr
                    key={c.billingCycleId}
                    className="border-t border-slate-100 transition hover:bg-emerald-50/30"
                  >
                    <td className={TD}>
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16" /></svg>
                        </span>
                        <span><strong className="block text-slate-800">{c.cycleName}</strong><span className="mt-0.5 block font-mono text-[11px] font-semibold text-slate-400">{c.cycleCode}</span></span>
                      </div>
                    </td>
                    <td className={TD}>
                      {date(c.periodStart)} – {date(c.periodEnd)}
                      <div className="text-xs">Due {date(c.dueDate)}</div>
                    </td>
                    <td className={TD}>
                      {c.readingCycles?.[0]?.cycleCode ?? "—"}
                    </td>
                    <td className={TD}><span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">{c._count?.bills ?? 0}</span></td>
                    <td className={`${TD} font-bold text-slate-900`}>{money(c.totals?.amount)}</td>
                    <td className={TD}>
                      <Badge value={c.status} />
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-2">
                        {c.status === "DRAFT" && (
                          <button
                            className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                            onClick={() => status(c, "OPEN")}
                          >
                            Open
                          </button>
                        )}
                        {c.status === "POSTED" && (
                          <button
                            className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-700 hover:text-white"
                            onClick={() => status(c, "CLOSED")}
                          >
                            Close
                          </button>
                        )}
                        {["DRAFT", "OPEN"].includes(c.status) &&
                          !c._count?.bills && (
                            <button
                              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-sm font-bold text-red-600 transition hover:bg-red-600 hover:text-white"
                              onClick={() => status(c, "CANCELLED")}
                            >
                              Cancel
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!cycles.length && (
                  <tr>
                    <td colSpan={7} className="p-14 text-center text-slate-400">
                      <div className="font-semibold text-slate-600">No billing periods created</div><div className="mt-1 text-sm">New billing periods will appear here.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function BillGeneration() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [zones, setZones] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [preview, setPreview] = useState<Row | null>(null);
  const [previewForm, setPreviewForm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Row>({
    billingCycleId: "",
    zoneId: "",
    routeId: "",
    categoryId: "",
    includePreviousBalance: true,
    includePenalties: true,
    sendForApproval: true,
  });
  useEffect(() => {
    Promise.all([
      api.listBillingCycles(),
      api.listZones(),
      api.listRoutes(),
      api.listCategories(),
    ])
      .then(([c, z, r, cat]) => {
        setCycles(c);
        setZones(z);
        setRoutes(r);
        setCategories(cat);
        const open = c.find((x: Row) =>
          ["DRAFT", "OPEN", "PROCESSING", "RETURNED"].includes(x.status),
        );
        if (open)
          setForm((f: Row) => ({
            ...f,
            billingCycleId: String(open.billingCycleId),
          }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingOptions(false));
  }, []);
  async function runPreview() {
    if (!form.billingCycleId) return;
    setPreviewing(true);
    setError("");
    setPreview(null);
    setPreviewForm("");
    try {
      const result = await api.previewBills(form);
      setPreview(result);
      setPreviewForm(JSON.stringify(form));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPreviewing(false);
    }
  }
  async function generate() {
    setSaving(true);
    setError("");
    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(
          ([, value]) => value !== "" && value !== undefined && value !== null,
        ),
      );
      const result = await api.generateBills(payload);
      setMessage(
        `${result.generated} bill(s) generated; ${result.skipped} account(s) safely skipped.${result.issues ? ` ${result.issues} validation issue(s) require review.` : ""}`,
      );
      await runPreview();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const canGenerate =
    Boolean(preview?.summary.eligible) && previewForm === JSON.stringify(form);
  return (
    <Page
      title="Generate customer bills"
      subtitle="Validate approved readings and active tariffs before bill generation"
      actions={
        <>
          <Button
            tone="green"
            onClick={generate}
            disabled={!canGenerate || saving || previewing}
          >
            {saving ? "Generating…" : "Generate eligible bills"}
          </Button>
          <LinkButton to="/billing/approvals">Bill approval</LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <Card title="Generation filters" className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Billing period" required>
            <CycleSelect
              cycles={cycles.filter((c) =>
                ["DRAFT", "OPEN", "PROCESSING", "RETURNED"].includes(c.status),
              )}
              value={form.billingCycleId}
              onChange={(value) => setForm({ ...form, billingCycleId: value })}
            />
          </Field>
          <Field label="Zone">
            <SearchableSelect
              className={INPUT}
              value={form.zoneId}
              onChange={(e) =>
                setForm({ ...form, zoneId: e.target.value, routeId: "" })
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
          <Field label="Route">
            <SearchableSelect
              className={INPUT}
              value={form.routeId}
              onChange={(e) => setForm({ ...form, routeId: e.target.value })}
            >
              <option value="">All routes</option>
              {routes
                .filter((r) => !form.zoneId || String(r.zoneId) === form.zoneId)
                .map((r) => (
                  <option key={r.routeId} value={r.routeId}>
                    {r.routeName}
                  </option>
                ))}
            </SearchableSelect>
          </Field>
          <Field label="Customer category">
            <SearchableSelect
              className={INPUT}
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.categoryName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={runPreview}
              disabled={
                loadingOptions || previewing || saving || !form.billingCycleId
              }
            >
              {previewing ? (
                <span className="inline-flex items-center">
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                  Loading preview…
                </span>
              ) : (
                "Preview bills"
              )}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-sm text-slate-600">
          {[
            ["includePreviousBalance", "Include previous balance"],
            ["includePenalties", "Include configured penalties"],
            ["sendForApproval", "Send generated bills for approval"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </Card>
      {(loadingOptions || previewing) && (
        <Card className="mb-4">
          <Spinner />
        </Card>
      )}
      {preview && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi label="Accounts" value={preview.summary.accounts} />
            <Kpi
              label="Eligible"
              value={preview.summary.eligible}
              tone="text-emerald-700"
            />
            <Kpi
              label="Approved readings"
              value={preview.summary.approvedReadings}
            />
            <Kpi
              label="Missing readings"
              value={preview.summary.missingReadings}
              tone="text-orange-600"
            />
            <Kpi
              label="Missing tariffs"
              value={preview.summary.missingTariffs}
              tone="text-red-600"
            />
            <Kpi
              label="Preview total"
              value={money(preview.summary.totalAmount)}
              tone="text-aqua-700"
            />
          </div>
          <Card title="Bill preview">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr>
                    <th className={TH}>Account / Customer</th>
                    <th className={TH}>Meter</th>
                    <th className={TH}>Units</th>
                    <th className={TH}>Tariff</th>
                    <th className={TH}>Water</th>
                    <th className={TH}>Fixed charges</th>
                    <th className={TH}>Previous</th>
                    <th className={TH}>Total due</th>
                    <th className={TH}>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row: Row) => (
                    <tr key={row.accountId} className="border-t">
                      <td className={TD}>
                        <strong>{row.accountNumber}</strong>
                        <div className="text-xs">{row.customerName}</div>
                      </td>
                      <td className={TD}>{row.meterNumber ?? "—"}</td>
                      <td className={TD}>
                        {Number(row.consumption).toLocaleString()}
                      </td>
                      <td className={TD}>{row.tariffName ?? "—"}</td>
                      <td className={TD}>
                        {money(row.calculation?.consumptionCharge)}
                      </td>
                      <td className={TD}>
                        {money(row.calculation?.fixedCharges)}
                      </td>
                      <td className={TD}>{money(row.previousBalance)}</td>
                      <td className={`${TD} font-semibold text-slate-900`}>
                        {money(row.totalAmountDue)}
                      </td>
                      <td className={TD}>
                        <Badge
                          value={row.issue === "NONE" ? "PASSED" : row.issue}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                tone="slate"
                onClick={() =>
                  exportExcel("bill-preview.xlsx", "Bill Preview", preview.rows)
                }
              >
                Export preview
              </Button>
              <Button
                tone="green"
                disabled={saving || previewing || !canGenerate}
                onClick={generate}
              >
                {saving ? "Generating…" : "Generate eligible bills"}
              </Button>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

export function BillApprovals() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [search, setSearch] = useState("");
  const [bills, setBills] = useState<Row[]>([]);
  const [processed, setProcessed] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<Row | null>(null);
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<"APPROVE" | "REJECT" | "RETURN" | "">(
    "",
  );
  const [posting, setPosting] = useState(false);
  const refreshCycles = async (preferred = cycleId) => {
    const rows = await api.listBillingCycles();
    setCycles(rows);
    const target =
      rows.find((x: Row) => String(x.billingCycleId) === preferred) ??
      rows.find((x: Row) => x.status === "PENDING_APPROVAL") ??
      rows[0];
    if (target) setCycleId(String(target.billingCycleId));
  };
  const load = async (idValue = cycleId, searchValue = search) => {
    setLoading(true);
    try {
      const filters = { billingCycleId: idValue, search: searchValue };
      const [pendingRows, allRows] = await Promise.all([
        api.listBills({ ...filters, status: "PENDING_APPROVAL" }),
        api.listBills(filters),
      ]);
      setBills(pendingRows);
      setProcessed(
        allRows.filter((bill: Row) => bill.status !== "PENDING_APPROVAL"),
      );
      setFocus(pendingRows[0] ?? null);
      setSelected([]);
      setError("");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refreshCycles("").catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    if (cycleId) load().catch((e) => setError(e.message));
  }, [cycleId, search]);
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected.length || comments.trim().length < 3)
      return setError("Select at least one bill and enter approval comments.");
    setActing(decision);
    setError("");
    try {
      const result = await api.decideBills(selected, decision, comments);
      setMessage(
        `${result.updated} bill(s) changed to ${pretty(result.status)}.`,
      );
      setComments("");
      await Promise.all([load(), refreshCycles(cycleId)]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActing("");
    }
  }
  async function post() {
    const reason = window.prompt(
      "Posting reason:",
      "Approved billing batch verified and posted to customer accounts",
    );
    if (!reason) return;
    setPosting(true);
    setError("");
    try {
      const result = await api.postBillingCycle(cycleId, reason);
      setMessage(
        `${result.posted} approved bill(s) posted to customer accounts.`,
      );
      await Promise.all([load(), refreshCycles(cycleId)]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  }
  const approvedCount = processed.filter(
    (bill) => bill.status === "APPROVED",
  ).length;
  const selectedBills = bills.filter((bill) =>
    selected.includes(String(bill.billId)),
  );
  const decisionBill = selectedBills.length === 1 ? selectedBills[0] : focus;
  const selectedUnits = selectedBills.reduce(
    (sum, bill) => sum + Number(bill.consumptionUnits ?? 0),
    0,
  );
  const selectedAmount = selectedBills.reduce(
    (sum, bill) => sum + Number(bill.totalAmountDue ?? 0),
    0,
  );
  const decisionDisabled =
    Boolean(acting) || comments.trim().length < 3 || !selectedBills.length;
  const commentEditor = (
    <>
      <Field
        label={
          selectedBills.length > 1
            ? `Shared approval comment for ${selectedBills.length} bills`
            : "Approval comments"
        }
        required
      >
        <textarea
          rows={3}
          className={`${INPUT} mt-3`}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          disabled={Boolean(acting)}
        />
      </Field>
      {selectedBills.length > 1 && (
        <p className="mt-1 text-xs text-slate-500">
          This same comment and decision will be recorded against every selected
          bill.
        </p>
      )}
    </>
  );
  const decisionControls = (
    <div className="mt-3 flex flex-wrap justify-end gap-2">
      <Button
        tone="red"
        disabled={decisionDisabled}
        onClick={() => decide("REJECT")}
      >
        {acting === "REJECT" ? "Rejecting…" : "Reject"}
      </Button>
      <Button
        tone="orange"
        disabled={decisionDisabled}
        onClick={() => decide("RETURN")}
      >
        {acting === "RETURN" ? "Returning…" : "Return"}
      </Button>
      <Button
        tone="green"
        disabled={decisionDisabled}
        onClick={() => decide("APPROVE")}
      >
        {acting === "APPROVE"
          ? "Approving…"
          : `Approve selected${selectedBills.length > 1 ? ` (${selectedBills.length})` : ""}`}
      </Button>
    </div>
  );
  const decisionContent = loading ? (
    <Spinner />
  ) : selectedBills.length > 1 ? (
    <>
      <div className="rounded-xl bg-aqua-50 p-4">
        <h3 className="font-bold text-slate-900">
          {selectedBills.length} bills selected
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Review the batch below, then enter one comment for the whole
          selection.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Combined consumption</span>
            <strong className="block">
              {selectedUnits.toLocaleString()} units
            </strong>
          </div>
          <div>
            <span className="text-slate-500">Combined total due</span>
            <strong className="block">{money(selectedAmount)}</strong>
          </div>
        </div>
      </div>
      <div className="my-3 max-h-52 divide-y overflow-y-auto rounded-lg border">
        {selectedBills.map((bill) => (
          <button
            type="button"
            key={bill.billId}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
            onClick={() => setFocus(bill)}
          >
            <span>
              <strong className="block text-slate-800">
                {bill.billNumber}
              </strong>
              <span className="text-xs text-slate-500">
                {bill.customerName} · {bill.account.accountNumber}
              </span>
            </span>
            <strong className="whitespace-nowrap text-slate-700">
              {money(bill.totalAmountDue)}
            </strong>
          </button>
        ))}
      </div>
      {commentEditor}
      {decisionControls}
    </>
  ) : decisionBill ? (
    <>
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="flex justify-between">
          <div>
            <h3 className="font-bold text-slate-900">
              {decisionBill.billNumber}
            </h3>
            <p className="text-sm text-slate-500">
              {decisionBill.customerName} · {decisionBill.account.accountNumber}
            </p>
          </div>
          <Badge
            value={
              decisionBill.exceptionType === "NONE"
                ? "PASSED"
                : decisionBill.exceptionType
            }
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Consumption</span>
            <strong className="block">
              {decisionBill.consumptionUnits} units
            </strong>
          </div>
          <div>
            <span className="text-slate-500">Tariff</span>
            <strong className="block">{decisionBill.tariff.tariffName}</strong>
          </div>
          <div>
            <span className="text-slate-500">Current charges</span>
            <strong className="block">
              {money(decisionBill.totalCurrentCharges)}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">Total due</span>
            <strong className="block">
              {money(decisionBill.totalAmountDue)}
            </strong>
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {(decisionBill.items ?? []).map((item: Row) => (
          <div
            key={item.billItemId}
            className="flex justify-between rounded-lg border px-3 py-2 text-sm"
          >
            <span>{item.description}</span>
            <strong>{money(item.amount)}</strong>
          </div>
        ))}
      </div>
      {selectedBills.length === 1 ? (
        <>
          {commentEditor}
          {decisionControls}
        </>
      ) : (
        <Notice tone="blue">
          Select this bill using its checkbox before making an approval
          decision.
        </Notice>
      )}
    </>
  ) : (
    <div className="py-10 text-center text-slate-400">
      Select a bill to review.
    </div>
  );
  return (
    <Page
      title="Bill approval"
      subtitle="Maker-checker review of generated bills and exceptions"
      actions={
        <Button
          tone="green"
          onClick={post}
          disabled={!cycleId || approvedCount === 0 || posting || loading}
        >
          {posting
            ? `Posting ${approvedCount.toLocaleString()} bill(s)…`
            : `Post approved batch (${approvedCount.toLocaleString()})`}
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Billing period">
            <CycleSelect
              cycles={cycles}
              value={cycleId}
              onChange={setCycleId}
            />
          </Field>
          <Field label="Search bills">
            <input
              type="search"
              className={INPUT}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Bill number, account, or customer name"
              aria-label="Search bills"
            />
          </Field>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card title={`${bills.length} pending bill(s)`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>
                    <input
                      type="checkbox"
                      checked={
                        bills.length > 0 && selected.length === bills.length
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? bills.map((b) => String(b.billId))
                            : [],
                        )
                      }
                    />
                  </th>
                  <th className={TH}>Bill / Customer</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Exception</th>
                  <th className={TH}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="p-8">
                      <Spinner />
                    </td>
                  </tr>
                )}
                {!loading &&
                  bills.map((bill) => (
                    <tr key={bill.billId} className="border-t">
                      <td className={TD}>
                        <input
                          type="checkbox"
                          checked={selected.includes(String(bill.billId))}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, String(bill.billId)]
                                : selected.filter(
                                    (id) => id !== String(bill.billId),
                                  ),
                            )
                          }
                        />
                      </td>
                      <td className={TD}>
                        <strong>{bill.billNumber}</strong>
                        <div className="text-xs">{bill.customerName}</div>
                      </td>
                      <td className={TD}>
                        {Number(bill.consumptionUnits).toLocaleString()}
                      </td>
                      <td className={TD}>{money(bill.totalAmountDue)}</td>
                      <td className={TD}>
                        <Badge
                          value={
                            bill.exceptionType === "NONE"
                              ? "PASSED"
                              : bill.exceptionType
                          }
                        />
                      </td>
                      <td className={TD}>
                        <button
                          className="font-semibold text-aqua-700"
                          onClick={() => setFocus(bill)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                {!loading && !bills.length && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No bills await approval.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Approval decision">{decisionContent}</Card>
      </div>
      <Card title="Approved and processed bills" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className={TH}>Bill / Customer</th>
                <th className={TH}>Amount</th>
                <th className={TH}>Approved by</th>
                <th className={TH}>Posted by</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {processed.map((bill) => (
                <tr key={bill.billId} className="border-t">
                  <td className={TD}>
                    <strong>{bill.billNumber}</strong>
                    <div className="text-xs">
                      {bill.customerName} · {bill.account.accountNumber}
                    </div>
                  </td>
                  <td className={`${TD} font-semibold`}>
                    {money(bill.totalAmountDue)}
                  </td>
                  <td className={TD}>{person(bill.approver)}</td>
                  <td className={TD}>
                    {bill.poster ? person(bill.poster) : "—"}
                  </td>
                  <td className={TD}>
                    <Badge value={bill.status} />
                  </td>
                  <td className={TD}>
                    <Link
                      className="font-semibold text-aqua-700"
                      to={`/billing/invoices/${bill.billId}`}
                    >
                      View invoice
                    </Link>
                  </td>
                </tr>
              ))}
              {!processed.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    Approved, returned, rejected and posted bills will remain
                    visible here.
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

export function InvoiceRegister() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listBillingCycles().then(setCycles);
  }, []);
  useEffect(() => {
    api
      .listBills({ billingCycleId: cycleId, status, search })
      .then((value) => {
        setRows(value);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [cycleId, status, search]);
  return (
    <Page
      title="Invoice register"
      subtitle="Search, print and share customer water bills"
      actions={
        <Button
          tone="green"
          onClick={() =>
            exportExcel(
              "invoice-register.xlsx",
              "Invoices",
              rows.map((b) => ({
                Bill: b.billNumber,
                Account: b.account.accountNumber,
                Customer: b.customerName,
                Period: b.billingCycle.cycleName,
                Amount: Number(b.totalAmountDue),
                Status: b.status,
              })),
            )
          }
        >
          Export register
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Billing period">
            <CycleSelect
              cycles={cycles}
              value={cycleId}
              onChange={setCycleId}
            />
          </Field>
          <Field label="Status">
            <SearchableSelect
              className={INPUT}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {[
                "DRAFT",
                "PENDING_APPROVAL",
                "APPROVED",
                "POSTED",
                "PARTIALLY_PAID",
                "PAID",
                "CANCELLED",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Search">
            <input
              className={INPUT}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Bill, account or customer"
            />
          </Field>
        </div>
      </Card>
      <Card title={`${rows.length} invoice(s)`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Bill</th>
                <th className={TH}>Customer account</th>
                <th className={TH}>Period</th>
                <th className={TH}>Issue / Due</th>
                <th className={TH}>Amount due</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bill) => (
                <tr key={bill.billId} className="border-t">
                  <td className={`${TD} font-semibold`}>{bill.billNumber}</td>
                  <td className={TD}>
                    {bill.account.accountNumber}
                    <div className="text-xs">{bill.customerName}</div>
                  </td>
                  <td className={TD}>{bill.billingCycle.cycleName}</td>
                  <td className={TD}>
                    {date(bill.issueDate)}
                    <div className="text-xs">Due {date(bill.dueDate)}</div>
                  </td>
                  <td className={`${TD} font-semibold`}>
                    {money(bill.totalAmountDue)}
                  </td>
                  <td className={TD}>
                    <Badge value={bill.status} />
                  </td>
                  <td className={TD}>
                    <Link
                      className="font-semibold text-aqua-700"
                      to={`/billing/invoices/${bill.billId}`}
                    >
                      View invoice
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function BillInvoice() {
  const { enabled: privacyMode } = usePrivacyMode();
  const { id = "" } = useParams();
  const [bill, setBill] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api
      .getBill(id)
      .then(setBill)
      .catch((e) => setError(e.message));
  }, [id]);
  async function notify(channel: string) {
    if (!bill) return;
    try {
      await api.sendBillNotifications({
        billingCycleId: bill.billingCycleId,
        billIds: [bill.billId],
        channels: [channel],
      });
      setMessage(`${channel} notification recorded as sent.`);
    } catch (e: any) {
      setError(e.message);
    }
  }
  function printInvoice() {
    const cleanup = () => document.body.classList.remove("printing-invoice");
    document.body.classList.add("printing-invoice");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }
  if (!bill)
    return (
      <Page title="Customer water bill" subtitle="Invoice details">
        {error ? <Notice>{error}</Notice> : <Spinner />}
      </Page>
    );
  return (
    <Page
      className="invoice-print-page"
      title="Customer water bill / invoice"
      subtitle={`${bill.billNumber} · ${bill.account.accountNumber}`}
      actions={
        <>
          <Button tone="slate" onClick={printInvoice}>
            Print / Save PDF
          </Button>
          <Button onClick={() => notify("SMS")}>Send SMS</Button>
          <Button tone="green" onClick={() => notify("EMAIL")}>
            Send email
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <Card className="invoice-print-document mx-auto max-w-4xl">
        <div className="border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <img
              src={privacyMode ? "/zevra-demo-logo.png" : "/samdamte-water-logo-print.png"}
              alt={privacyMode ? "Zevra Holdings Ltd demo branding" : "Samdamte Water Utility Management"}
              className="invoice-brand-logo h-auto w-[280px] max-w-[55%] object-contain"
            />
            <div className="text-right">
              <div className="text-xl font-bold">WATER BILL</div>
              <div>{bill.billNumber}</div>
              <Badge value={bill.status} />
            </div>
          </div>
        </div>
        <div className="grid gap-4 border-b py-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Bill to</h3>
            <div>{privacyMode ? maskName(bill.customerName) : bill.customerName}</div>
            <div>{privacyMode ? maskIdentifier(bill.account.accountNumber) : bill.account.accountNumber}</div>
            <div>{privacyMode ? maskAddress(bill.account.property.physicalAddress) : bill.account.property.physicalAddress}</div>
            <div>{bill.account.property.zone.zoneName}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-slate-500">Period</span>
            <strong>{bill.billingCycle.cycleName}</strong>
            <span className="text-slate-500">Invoice date</span>
            <strong>{date(bill.issueDate)}</strong>
            <span className="text-slate-500">Due date</span>
            <strong>{date(bill.dueDate)}</strong>
            <span className="text-slate-500">Meter</span>
            <strong>
              {bill.reading?.meter?.meterNumber ?? "Flat billing"}
            </strong>
          </div>
        </div>
        {bill.reading && (
          <div className="grid grid-cols-3 gap-3 border-b py-4 text-center">
            <div>
              <span className="text-sm text-slate-500">Previous reading</span>
              <strong className="block text-xl">
                {bill.reading.previousReading}
              </strong>
            </div>
            <div>
              <span className="text-sm text-slate-500">Current reading</span>
              <strong className="block text-xl">
                {bill.reading.currentReading}
              </strong>
            </div>
            <div>
              <span className="text-sm text-slate-500">Consumption</span>
              <strong className="block text-xl text-aqua-700">
                {bill.consumptionUnits} units
              </strong>
            </div>
          </div>
        )}
        <div className="py-4">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Description</th>
                <th className={TH}>Quantity</th>
                <th className={TH}>Rate</th>
                <th className={`${TH} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item: Row) => (
                <tr key={item.billItemId} className="border-t">
                  <td className={TD}>{item.description}</td>
                  <td className={TD}>{item.quantity}</td>
                  <td className={TD}>{money(item.unitRate)}</td>
                  <td className={`${TD} text-right font-semibold`}>
                    {money(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto max-w-md space-y-2 border-t pt-4 text-sm">
          {[
            ["Previous balance", bill.previousBalance],
            ["Current water charges", bill.consumptionCharge],
            ["Fixed charges", bill.fixedCharges],
            ["Penalties", bill.penalties],
            ["Adjustments", bill.adjustmentAmount],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between">
              <span>{label}</span>
              <strong>{money(value)}</strong>
            </div>
          ))}
          <div className="flex justify-between border-t pt-3 text-xl">
            <strong>Total amount due</strong>
            <strong className="text-aqua-700">
              {money(bill.totalAmountDue)}
            </strong>
          </div>
        </div>
      </Card>
    </Page>
  );
}

function LegacyCustomerStatements() {
  const [bills, setBills] = useState<Row[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statement, setStatement] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listBills().then((rows) => {
      setBills(rows);
      if (rows[0]) setAccountId(String(rows[0].accountId));
    });
  }, []);
  const accounts = useMemo(
    () =>
      Array.from(new Map(bills.map((b) => [String(b.accountId), b])).values()),
    [bills],
  );
  async function load() {
    try {
      setStatement(await api.getCustomerStatement(accountId, from, to));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (accountId) load();
  }, [accountId]);
  return (
    <Page
      title="Customer statements"
      subtitle="Debits, payments and running account balances"
      actions={
        <>
          {statement && (
            <Button tone="slate" onClick={() => window.print()}>
              Print / Save PDF
            </Button>
          )}
          <Button
            tone="green"
            disabled={!statement}
            onClick={() =>
              statement &&
              exportExcel(
                "customer-statement.xlsx",
                "Statement",
                statement.entries,
              )
            }
          >
            Export Excel
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Customer account">
            <SearchableSelect
              className={INPUT}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select account</option>
              {accounts.map((b: Row) => (
                <option key={b.accountId} value={b.accountId}>
                  {b.account.accountNumber} · {b.customerName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="From">
            <input
              type="date"
              className={INPUT}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={INPUT}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={load} disabled={!accountId}>
              Load statement
            </Button>
          </div>
        </div>
      </Card>
      {statement && (
        <Card
          title={`${statement.account.customerName} · ${statement.account.accountNumber}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Date</th>
                  <th className={TH}>Description</th>
                  <th className={TH}>Debit</th>
                  <th className={TH}>Credit</th>
                  <th className={TH}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((entry: Row) => (
                  <tr key={entry.id} className="border-t">
                    <td className={TD}>{date(entry.date)}</td>
                    <td className={TD}>{entry.description}</td>
                    <td className={TD}>
                      {entry.debit ? money(entry.debit) : "—"}
                    </td>
                    <td className={TD}>
                      {entry.credit ? money(entry.credit) : "—"}
                    </td>
                    <td className={`${TD} font-semibold`}>
                      {money(entry.balance)}
                    </td>
                  </tr>
                ))}
                {!statement.entries.length && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      No posted transactions in this date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end text-lg">
            <span className="mr-5">Closing balance</span>
            <strong>{money(statement.closingBalance)}</strong>
          </div>
        </Card>
      )}
    </Page>
  );
}

function CustomerStatementsOld() {
  const now = new Date();
  const localDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const [bills, setBills] = useState<Row[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(
    localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [to, setTo] = useState(localDate(now));
  const [statement, setStatement] = useState<Row | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [error, setError] = useState("");
  const accounts = useMemo(
    () =>
      Array.from(
        new Map(bills.map((bill) => [String(bill.accountId), bill])).values(),
      ),
    [bills],
  );
  useEffect(() => {
    api
      .listBills()
      .then((rows) => {
        setBills(rows);
        if (rows[0]) setAccountId(String(rows[0].accountId));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingAccounts(false));
  }, []);

  async function load(selectedAccountId = accountId) {
    if (!selectedAccountId) return;
    setLoadingStatement(true);
    setError("");
    try {
      setStatement(await api.getCustomerStatement(selectedAccountId, from, to));
    } catch (e: any) {
      setError(e.message);
      setStatement(null);
    } finally {
      setLoadingStatement(false);
    }
  }

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);

  function printStatement() {
    const cleanup = () => document.body.classList.remove("printing-statement");
    document.body.classList.add("printing-statement");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  function exportStatement() {
    if (!statement) return;
    const rows = [
      {
        Date: from,
        Description: "Opening balance",
        Debit: 0,
        Credit: 0,
        Balance: statement.openingBalance,
      },
      ...statement.entries.map((entry: Row) => ({
        Date: entry.date,
        Description: entry.description,
        Debit: entry.debit,
        Credit: entry.credit,
        Balance: entry.balance,
      })),
      {
        Date: to,
        Description: "Period totals",
        Debit: statement.totalDebits,
        Credit: statement.totalCredits,
        Balance: "",
      },
      {
        Date: to,
        Description: "Closing balance",
        Debit: 0,
        Credit: 0,
        Balance: statement.closingBalance,
      },
    ];
    exportExcel(
      `statement-${statement.account.accountNumber}-${from}-to-${to}.xlsx`,
      "Statement",
      rows,
    );
  }

  return (
    <Page
      className="statement-print-page"
      title="Customer statements"
      subtitle="A reconciled record of opening balance, charges, payments and closing balance"
      actions={
        <>
          <Button
            tone="slate"
            disabled={!statement || loadingStatement}
            onClick={printStatement}
          >
            Print / Save PDF
          </Button>
          <Button
            tone="green"
            disabled={!statement || loadingStatement}
            onClick={exportStatement}
          >
            Export Excel
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="statement-screen-filters mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Customer account">
            <SearchableSelect
              className={INPUT}
              disabled={loadingAccounts}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">
                {loadingAccounts ? "Loading accounts..." : "Select account"}
              </option>
              {accounts.map((bill: Row) => (
                <option key={bill.accountId} value={bill.accountId}>
                  {bill.account.accountNumber} · {bill.customerName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="From">
            <input
              type="date"
              className={INPUT}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={INPUT}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={() => load()}
              disabled={!accountId || loadingStatement}
            >
              {loadingStatement ? "Loading statement..." : "Load statement"}
            </Button>
          </div>
        </div>
      </Card>
      {loadingStatement && !statement ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        statement && (
          <Card className="statement-print-document">
            <div className="border-b border-slate-200 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <img
                  src="/samdamte-water-logo-print.png"
                  alt="Samdamte Water Utility Management"
                  className="statement-brand-logo h-auto w-[260px] max-w-[55%] object-contain"
                />
                <div className="text-right">
                  <div className="text-xl font-bold text-slate-900">
                    CUSTOMER STATEMENT
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {date(`${from}T00:00:00.000Z`)} –{" "}
                    {date(`${to}T00:00:00.000Z`)}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Customer
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {statement.account.customerName}
                  </div>
                  <div>Account {statement.account.accountNumber}</div>
                  <div>{statement.account.property?.physicalAddress}</div>
                </div>
                <div className="md:text-right">
                  <div>
                    <span className="text-slate-500">Category:</span>{" "}
                    {statement.account.category?.categoryName ?? "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Zone:</span>{" "}
                    {statement.account.property?.zone?.zoneName ?? "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">Account status:</span>{" "}
                    {pretty(statement.account.accountStatus)}
                  </div>
                </div>
              </div>
            </div>
            <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label="Opening balance"
                value={money(statement.openingBalance)}
              />
              <Kpi
                label="Period debits"
                value={money(statement.totalDebits)}
                tone="text-red-700"
              />
              <Kpi
                label="Period credits"
                value={money(statement.totalCredits)}
                tone="text-emerald-700"
              />
              <Kpi
                label="Closing balance"
                value={money(statement.closingBalance)}
                tone="text-aqua-700"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Description / reference</th>
                    <th className={`${TH} text-right`}>Debit</th>
                    <th className={`${TH} text-right`}>Credit</th>
                    <th className={`${TH} text-right`}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t bg-slate-50">
                    <td className={TD}>{date(`${from}T00:00:00.000Z`)}</td>
                    <td className={`${TD} font-semibold text-slate-800`}>
                      Balance brought forward
                    </td>
                    <td className={`${TD} text-right`}>—</td>
                    <td className={`${TD} text-right`}>—</td>
                    <td className={`${TD} text-right font-bold`}>
                      {money(statement.openingBalance)}
                    </td>
                  </tr>
                  {statement.entries.map((entry: Row) => (
                    <tr key={entry.id} className="border-t">
                      <td className={TD}>{date(entry.date)}</td>
                      <td className={TD}>{entry.description}</td>
                      <td className={`${TD} text-right`}>
                        {entry.debit ? money(entry.debit) : "—"}
                      </td>
                      <td className={`${TD} text-right`}>
                        {entry.credit ? money(entry.credit) : "—"}
                      </td>
                      <td className={`${TD} text-right font-semibold`}>
                        {money(entry.balance)}
                      </td>
                    </tr>
                  ))}
                  {!statement.entries.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-slate-500"
                      >
                        No transactions occurred during this period. The closing
                        balance is the balance brought forward.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td
                      colSpan={2}
                      className={`${TD} font-bold text-slate-800`}
                    >
                      Period totals
                    </td>
                    <td className={`${TD} text-right font-bold`}>
                      {money(statement.totalDebits)}
                    </td>
                    <td className={`${TD} text-right font-bold`}>
                      {money(statement.totalCredits)}
                    </td>
                    <td className={`${TD} text-right font-bold text-aqua-700`}>
                      {money(statement.closingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
              <span className="text-slate-500">
                Opening balance + debits − credits = closing balance
              </span>
              <div className="text-lg">
                <span className="mr-4">Amount due / (credit)</span>
                <strong
                  className={
                    Number(statement.closingBalance) > 0
                      ? "text-red-700"
                      : "text-emerald-700"
                  }
                >
                  {money(statement.closingBalance)}
                </strong>
              </div>
            </div>
          </Card>
        )
      )}
    </Page>
  );
}

export function CustomerStatements() {
  const { enabled: privacyMode } = usePrivacyMode();
  const now = new Date();
  const localDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statement, setStatement] = useState<Row | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .listAccounts("", 20000)
      .then((rows) => {
        setAccounts(rows);
        if (rows[0]) setAccountId(String(rows[0].accountId));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingAccounts(false));
  }, []);

  async function load(selectedAccountId = accountId) {
    if (!selectedAccountId) return;
    setLoadingStatement(true);
    setError("");
    try {
      setStatement(await api.getCustomerStatement(selectedAccountId, from, to));
    } catch (e: any) {
      setError(e.message);
      setStatement(null);
    } finally {
      setLoadingStatement(false);
    }
  }

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);

  function printStatement() {
    const cleanup = () => document.body.classList.remove("printing-statement");
    document.body.classList.add("printing-statement");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  function exportStatement() {
    if (!statement) return;
    const rows = [
      {
        "#": "",
        Date: from,
        Particulars: "Opening balance",
        Reference: "",
        Period: "",
        Details: "",
        Credits: 0,
        Debits: 0,
        Balance: statement.openingBalance,
      },
      ...statement.entries.map((entry: Row, index: number) => ({
        "#": index + 1,
        Date: entry.date,
        Particulars: entry.particulars,
        Reference: entry.reference,
        Period: entry.period,
        Details: entry.details,
        Credits: entry.credit,
        Debits: entry.debit,
        Balance: entry.balance,
      })),
      {
        "#": "",
        Date: to,
        Particulars: "Total",
        Reference: "",
        Period: "",
        Details: "",
        Credits: statement.totalCredits,
        Debits: statement.totalDebits,
        Balance: statement.closingBalance,
      },
    ];
    exportExcel(
      privacyMode ? `statement-demo-${from}-to-${to}.xlsx` : `statement-${statement.account.accountNumber}-${from}-to-${to}.xlsx`,
      "Statement",
      rows,
    );
  }

  const printedAt = new Date();
  const utilityAddress = statement
    ? [
        statement.utility.physicalAddress,
        statement.utility.postalAddress,
        statement.utility.postalCode,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const balanceVariance = statement
    ? Number(statement.closingBalance) - Number(statement.currentBalance)
    : 0;
  const statementPeriodLabel = !from && !to
    ? "Complete account history"
    : `${from ? date(`${from}T00:00:00.000Z`) : "Account opening"} - ${to ? date(`${to}T00:00:00.000Z`) : "Present"}`;
  function useThisMonth() {
    setFrom(localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setTo(localDate(now));
  }
  function useLastThirtyDays() {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    setFrom(localDate(start));
    setTo(localDate(now));
  }

  return (
    <Page
      className="statement-print-page"
      title="Customer statements"
      subtitle="A reconciled record of opening balance, charges, payments and closing balance"
      actions={
        <>
          <Button
            tone="slate"
            disabled={!statement || loadingStatement}
            onClick={printStatement}
          >
            Print / Save PDF
          </Button>
          <Button
            tone="green"
            disabled={!statement || loadingStatement}
            onClick={exportStatement}
          >
            Export Excel
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="statement-screen-filters mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Customer account">
            <SearchableSelect
              className={INPUT}
              disabled={loadingAccounts || loadingStatement}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">
                {loadingAccounts ? "Loading accounts..." : "Select account"}
              </option>
              {accounts.map((account: Row) => (
                <option key={account.accountId} value={account.accountId}>
                  {privacyMode ? maskIdentifier(account.accountNumber) : account.accountNumber} - {privacyMode ? "Customer masked for demo" : account.customer.organizationName ||
                    [account.customer.firstName, account.customer.middleName, account.customer.lastName]
                      .filter(Boolean)
                      .join(" ")}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="From">
            <input
              type="date"
              className={INPUT}
              disabled={loadingStatement}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={INPUT}
              disabled={loadingStatement}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              className="flex w-full items-center justify-center gap-2"
              onClick={() => load()}
              disabled={!accountId || loadingStatement}
            >
              {loadingStatement && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden
                />
              )}
              {loadingStatement ? "Loading statement..." : "Load statement"}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
          <span className="mr-1 font-semibold text-slate-500">Quick range:</span>
          <button type="button" disabled={loadingStatement} onClick={() => { setFrom(""); setTo(""); }} className={`rounded-lg border px-3 py-1.5 font-semibold ${!from && !to ? "border-aqua-200 bg-aqua-50 text-aqua-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>Full history</button>
          <button type="button" disabled={loadingStatement} onClick={useThisMonth} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50">This month</button>
          <button type="button" disabled={loadingStatement} onClick={useLastThirtyDays} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50">Last 30 days</button>
          <span className="ml-auto text-slate-400">Leave either date blank for an open-ended range.</span>
        </div>
      </Card>

      {statement && Math.abs(balanceVariance) >= 0.01 && (
        <div className="statement-screen-filters mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          <svg className="mt-0.5 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3 2.5 20h19z" /><path d="M12 9v5m0 3h.01" /></svg>
          <div><div className="font-bold">Account balance reconciliation required</div><div className="mt-0.5">The statement ledger closes at {money(statement.closingBalance)}, while the stored account balance is {money(statement.currentBalance)}. Variance: {money(balanceVariance)}.</div></div>
        </div>
      )}

      {loadingStatement && !statement ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        statement && (
          <Card className="statement-print-document relative">
            {loadingStatement && (
              <div className="statement-loading-overlay absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-white/75 pt-24 backdrop-blur-[1px]">
                <div className="flex items-center gap-3 rounded-xl border bg-white px-5 py-3 font-semibold text-slate-700 shadow-lg">
                  <span
                    className="h-5 w-5 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700"
                    aria-hidden
                  />
                  Refreshing statement...
                </div>
              </div>
            )}

            <div className="statement-letterhead grid items-center gap-5 border-b-[3px] border-aqua-800 pb-4 md:grid-cols-[1fr_300px]">
              <img
                src={privacyMode ? "/zevra-demo-logo.png" : "/samdamte-water-logo-print.png"}
                alt={privacyMode ? "Zevra Holdings Ltd demo branding" : statement.utility.name}
                className="statement-brand-logo h-auto max-h-32 w-full max-w-[300px] object-contain object-left"
              />
              <div className="statement-utility-contact border-l border-slate-300 pl-5 text-sm leading-6">
                {statement.utility.phone && (
                  <div>
                    <strong>Tel:</strong> {statement.utility.phone}
                    {statement.utility.secondaryPhone
                      ? ` / ${statement.utility.secondaryPhone}`
                      : ""}
                  </div>
                )}
                {statement.utility.email && (
                  <div>
                    <strong>Email:</strong> {statement.utility.email}
                  </div>
                )}
                {utilityAddress && (
                  <div>
                    <strong>Address:</strong> {utilityAddress}
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-500">
                  <strong>Printed:</strong> {printedAt.toLocaleString()}
                </div>
              </div>
            </div>

            <h2 className="statement-title my-3 text-center text-2xl font-black uppercase tracking-wide text-slate-950">
              Account Statement
            </h2>

            <div className="statement-account-grid my-2 grid gap-x-12 gap-y-1 text-sm md:grid-cols-2 [&_strong]:whitespace-nowrap">
              <div className="grid grid-cols-[130px_1fr] gap-y-1">
                <strong>To:</strong>
                <span>{privacyMode ? maskName(statement.account.customerName) : statement.account.customerName}</span>
                <strong>Mobile:</strong>
                <span>{privacyMode ? maskPhone(statement.account.phone) : statement.account.phone || "-"}</span>
                <strong>Email:</strong>
                <span>{privacyMode ? maskEmail(statement.account.email) : statement.account.email || "-"}</span>
                <strong className="whitespace-nowrap">Acc status:</strong>
                <span>{pretty(statement.account.status)}</span>
                <strong>Meter No.:</strong>
                <span>{statement.account.meterNumber || "-"}</span>
              </div>
              <div className="grid grid-cols-[130px_1fr] gap-y-1">
                <strong>Account:</strong>
                <span>{privacyMode ? maskIdentifier(statement.account.accountNumber) : statement.account.accountNumber}</span>
                <strong>Zone:</strong>
                <span>{statement.account.zone || "-"}</span>
                <strong>Route:</strong>
                <span>{statement.account.route || "-"}</span>
                <strong>Tariff:</strong>
                <span>
                  {statement.account.tariff ||
                    statement.account.category ||
                    "-"}
                </span>
              </div>
            </div>

            <div className="statement-period mb-3 flex flex-wrap justify-between gap-2 border-y border-slate-200 py-2 text-xs">
              <span>
                <strong>Statement period:</strong>{" "}
                {statementPeriodLabel}
              </span>
              {statement.account.address && (
                <span>
                  <strong>Service address:</strong> {privacyMode ? maskAddress(statement.account.address) : statement.account.address}
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="statement-ledger w-full min-w-[980px]">
                <thead>
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Particulars</th>
                    <th className={TH}>Period</th>
                    <th className={TH}>Details</th>
                    <th className={`${TH} text-right`}>Credits</th>
                    <th className={`${TH} text-right`}>Debits</th>
                    <th className={`${TH} text-right`}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-300">
                    <td className={TD} />
                    <td className={TD} />
                    <td className={`${TD} font-bold`} colSpan={3}>
                      Opening balance
                    </td>
                    <td className={`${TD} text-right`}>-</td>
                    <td className={`${TD} text-right`}>-</td>
                    <td className={`${TD} text-right font-bold`}>
                      {money(statement.openingBalance)}
                    </td>
                  </tr>
                  {statement.entries.map((entry: Row, index: number) => (
                    <tr
                      key={entry.id}
                      className="border-b border-slate-200 align-top"
                    >
                      <td className={TD}>{index + 1}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {date(entry.date)}
                      </td>
                      <td className={TD}>
                        <div className="font-semibold">{entry.particulars}</div>
                        <div className="text-xs text-slate-500">
                          {entry.reference}
                        </div>
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {entry.period || "-"}
                      </td>
                      <td className={`${TD} max-w-[360px]`}>
                        {entry.details || "-"}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-right`}>
                        {entry.credit ? money(entry.credit) : "-"}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-right`}>
                        {entry.debit ? money(entry.debit) : "-"}
                      </td>
                      <td
                        className={`${TD} whitespace-nowrap text-right font-semibold`}
                      >
                        {money(entry.balance)}
                      </td>
                    </tr>
                  ))}
                  {!statement.entries.length && (
                    <tr>
                      <td
                        colSpan={8}
                        className="p-8 text-center text-slate-500"
                      >
                        No posted transactions in this date range. The closing
                        balance equals the opening balance.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900">
                    <td
                      colSpan={5}
                      className={`${TD} text-right text-base font-black`}
                    >
                      Total
                    </td>
                    <td
                      className={`${TD} whitespace-nowrap text-right font-black`}
                    >
                      {money(statement.totalCredits)}
                    </td>
                    <td
                      className={`${TD} whitespace-nowrap text-right font-black`}
                    >
                      {money(statement.totalDebits)}
                    </td>
                    <td
                      className={`${TD} whitespace-nowrap text-right font-black`}
                    >
                      {money(statement.closingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="statement-balance-forward mt-5 flex justify-end">
              <div className="min-w-[310px] border-t-2 border-slate-900 pt-2 text-right text-lg">
                <strong className="mr-10">Balance B/F</strong>
                <strong>{money(statement.closingBalance)}</strong>
              </div>
            </div>
            <div className="statement-footer mt-10 border-t border-slate-300 pt-3 text-center text-xs text-slate-500">
              {/* This statement is generated from posted bills and payments in the utility ledger. */}
              We make it safe because water is life
            </div>
          </Card>
        )
      )}
    </Page>
  );
}

export function BillNotifications() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [channels, setChannels] = useState<string[]>(["SMS", "APP"]);
  const [bills, setBills] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [billStatus, setBillStatus] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("NOT_SENT");
  const [batchSize, setBatchSize] = useState("2000");
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [loadingBills, setLoadingBills] = useState(false);
  const [queueing, setQueueing] = useState(false);
  useEffect(() => {
    let active = true;
    setLoadingCycles(true);
    api.listBillingCycles()
      .then((rows) => {
        if (!active) return;
        setCycles(rows);
        if (rows[0]) setCycleId(String(rows[0].billingCycleId));
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoadingCycles(false));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setSelectedBillIds([]);
    if (!cycleId) {
      setBills([]);
      setLoadingBills(false);
      return () => { active = false; };
    }
    setLoadingBills(true);
    setError("");
    api.listBills({ billingCycleId: cycleId, limit: "10000" })
      .then((rows) => active && setBills(rows))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoadingBills(false));
    return () => { active = false; };
  }, [cycleId]);
  async function send() {
    if (!selectedBillIds.length) return;
    const confirmation = await Swal.fire({
      icon: "question",
      title: "Queue bill notifications?",
      html: `
        <div style="margin-top:4px;text-align:left;color:#475569">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div style="border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:12px">
              <div style="font-size:12px;color:#64748b">SELECTED BILLS</div>
              <div style="margin-top:3px;font-size:21px;font-weight:700;color:#0f172a">${selectedBillIds.length.toLocaleString()}</div>
            </div>
            <div style="border:1px solid #bae6fd;border-radius:12px;background:#f0f9ff;padding:12px">
              <div style="font-size:12px;color:#0369a1">CHANNELS</div>
              <div style="margin-top:3px;font-size:16px;font-weight:700;color:#075985">${channels.join(" + ")}</div>
            </div>
          </div>
          <div style="border:1px solid #a7f3d0;border-radius:12px;background:#ecfdf5;padding:12px;color:#047857">
            <strong>Queue only:</strong> No SMS or app message will be sent now. Delivery starts only when you process the delivery queue.
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Queue notifications",
      cancelButtonText: "Go back",
      confirmButtonColor: "#0369a1",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
      width: 520,
    });
    if (!confirmation.isConfirmed) return;
    try {
      setError("");
      setMessage("");
      setQueueing(true);
      const result = await api.sendBillNotifications({
        billingCycleId: cycleId,
        billIds: selectedBillIds,
        channels,
      });
      setMessage(
        `${result.notifications} notification(s) queued for ${result.bills} bill(s). Open the delivery queue when you are ready to send them.`,
      );
      setSelectedBillIds([]);
      setLoadingBills(true);
      setBills(await api.listBills({ billingCycleId: cycleId, limit: "10000" }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setQueueing(false);
      setLoadingBills(false);
    }
  }
  const selected = bills.filter(
    (b) =>
      ["APPROVED", "POSTED", "PARTIALLY_PAID"].includes(b.status) &&
      Number(b.totalAmountDue) - Number(b.paidAmount ?? 0) > 0,
  );
  const filteredBills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return selected.filter((bill) => {
      const matchesSearch = !query || [
        bill.billNumber,
        bill.customerName,
        bill.account?.accountNumber,
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
      return matchesSearch &&
        (!billStatus || bill.status === billStatus) &&
        (!notificationStatus || bill.notificationStatus === notificationStatus);
    });
  }, [selected, search, billStatus, notificationStatus]);
  const selectableBills = filteredBills.filter(
    (bill) => !["QUEUED", "SENT"].includes(String(bill.notificationStatus)),
  );
  const selectedBillIdSet = new Set(selectedBillIds);
  function selectNextBatch() {
    setSelectedBillIds(
      selectableBills.slice(0, Number(batchSize)).map((bill) => String(bill.billId)),
    );
  }
  function toggleBill(billId: unknown, checked: boolean) {
    const value = String(billId);
    setSelectedBillIds((current) => checked
      ? [...new Set([...current, value])]
      : current.filter((id) => id !== value));
  }
  const selectedCycle = cycles.find((cycle) => String(cycle.billingCycleId) === cycleId);
  const readingCycle = selectedCycle?.readingCycles?.[0];
  const readingCycleClosed = readingCycle?.status === "CLOSED";
  return (
    <Page
      title="Bill notifications"
      subtitle="Send bill notices through configured customer channels"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card title="Notification setup">
          <div className="space-y-4">
            <Field label="Billing period">
              <CycleSelect
                cycles={cycles}
                value={cycleId}
                onChange={setCycleId}
                disabled={loadingCycles || loadingBills || queueing}
              />
            </Field>
            <Field label="Notification channels">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                {["SMS", "APP", "EMAIL", "WHATSAPP"].map((channel) => {
                  const disabled = channel === "EMAIL" || channel === "WHATSAPP" || queueing;
                  return <label key={channel} className={`flex gap-2 ${disabled ? "text-slate-400" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={channels.includes(channel)}
                      onChange={(e) =>
                        setChannels(
                          e.target.checked
                            ? [...channels, channel]
                            : channels.filter((x) => x !== channel),
                        )
                      }
                    />
                    {channel}{disabled ? " (disabled)" : ""}
                  </label>;
                })}
              </div>
            </Field>
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
              {loadingBills
                ? "Loading eligible bills…"
                : `${selectedBillIds.length} bill(s) selected from ${selectableBills.length} unsent matching bill(s). Queueing does not send SMS.`}
            </div>
            <Field label="Selection batch size">
              <div className="flex gap-2">
                <SearchableSelect className={INPUT} value={batchSize} disabled={loadingBills || queueing} onChange={(e) => setBatchSize(e.target.value)}>
                  <option value="100">100 bills</option>
                  <option value="500">500 bills</option>
                  <option value="1000">1,000 bills</option>
                  <option value="2000">2,000 bills</option>
                </SearchableSelect>
                <button type="button" disabled={loadingBills || queueing || !selectableBills.length} className="whitespace-nowrap rounded-xl border border-aqua-600 px-3 py-2 text-sm font-semibold text-aqua-700 hover:bg-aqua-50 disabled:cursor-not-allowed disabled:opacity-50" onClick={selectNextBatch}>
                  Select next batch
                </button>
              </div>
              {!!selectedBillIds.length && <button type="button" className="mt-2 text-sm font-semibold text-slate-600 hover:text-slate-900" onClick={() => setSelectedBillIds([])}>Clear selection</button>}
            </Field>
            <div className={`rounded-lg p-3 text-sm ${readingCycleClosed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
              {readingCycle
                ? `Reading cycle: ${readingCycle.cycleName} · ${readingCycle.status}`
                : "No reading cycle is linked to this billing period."}
            </div>
            <Button
              className="w-full"
              disabled={!cycleId || !channels.length || !selectedBillIds.length || !readingCycleClosed || loadingBills || queueing}
              onClick={send}
            >
              {queueing ? (
                <span className="inline-flex items-center justify-center">
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                  Queueing notifications…
                </span>
              ) : readingCycleClosed ? `Queue ${selectedBillIds.length} selected bill(s)` : "Close reading cycle first"}
            </Button>
            <Link
              to="/notifications/queue"
              className="flex w-full items-center justify-center rounded-xl border border-emerald-600 bg-white px-4 py-2.5 text-[15px] font-semibold text-emerald-700 transition hover:bg-emerald-50"
            >
              Open delivery queue
            </Link>
          </div>
        </Card>
        <Card title="Message preview">
          <div className="rounded-xl bg-slate-50 p-5 text-slate-700">
            Dear <strong>[Customer Name]</strong> A/C <strong>[Account Number without ACC-]</strong> your bill as at <strong>[Bill Date]</strong>. Prev Read <strong>[Previous Reading]</strong> Curr Read <strong>[Current Reading]</strong> Consumption <strong>[Units]</strong> Arrears <strong>[Arrears]</strong> Amount Paid <strong>[Amount Paid]</strong> Current Bill <strong>[Current Bill]</strong> Total Amount <strong>[Total Amount]</strong>. Due date is <strong>[Due Date]</strong>. Reconnection Fee is <strong>1155</strong>. Bills payable through PayBill No <strong>823496</strong> using <strong>[Account Number without ACC-]</strong> as the account number. WE MAKE IT SAFE BECAUSE WATER IS LIFE. THANK YOU.
            <div className="mt-3 font-semibold text-aqua-700">Pay now: [Secure Payment Link]</div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Field label="Search bill, customer or account">
              <input className={INPUT} disabled={loadingBills || queueing} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search records" />
            </Field>
            <Field label="Bill status">
              <SearchableSelect className={INPUT} disabled={loadingBills || queueing} value={billStatus} onChange={(e) => setBillStatus(e.target.value)}>
                <option value="">All eligible statuses</option>
                <option value="APPROVED">Approved</option>
                <option value="POSTED">Posted</option>
                <option value="PARTIALLY_PAID">Partially paid</option>
                <option value="PAID">Paid</option>
              </SearchableSelect>
            </Field>
            <Field label="Notification status">
              <SearchableSelect className={INPUT} disabled={loadingBills || queueing} value={notificationStatus} onChange={(e) => setNotificationStatus(e.target.value)}>
                <option value="">All notification statuses</option>
                <option value="NOT_SENT">Not sent</option>
                <option value="QUEUED">Queued</option>
                <option value="SENT">Sent</option>
                <option value="FAILED">Failed</option>
              </SearchableSelect>
            </Field>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
            <span>Showing {filteredBills.length} of {selected.length} eligible bills</span>
            {(search || billStatus || notificationStatus !== "NOT_SENT") && <button type="button" className="font-semibold text-aqua-700 hover:text-aqua-600" onClick={() => { setSearch(""); setBillStatus(""); setNotificationStatus("NOT_SENT"); }}>Reset filters</button>}
          </div>
          <div className="relative mt-4 min-h-[260px] overflow-x-auto">
            {loadingBills && (
              <div className="absolute inset-0 z-20 flex items-start justify-center rounded-xl bg-white/85 pt-20 backdrop-blur-[1px]">
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 shadow-lg">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700" aria-hidden />
                  Loading billing records…
                </div>
              </div>
            )}
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Select</th>
                  <th className={TH}>Bill</th>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredBills.map((bill) => (
                  <tr key={bill.billId} className="border-t">
                    <td className={TD}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${bill.billNumber}`}
                        disabled={["QUEUED", "SENT"].includes(String(bill.notificationStatus))}
                        checked={selectedBillIdSet.has(String(bill.billId))}
                        onChange={(event) => toggleBill(bill.billId, event.target.checked)}
                      />
                    </td>
                    <td className={TD}>{bill.billNumber}</td>
                    <td className={TD}>{bill.customerName}</td>
                    <td className={TD}>{money(bill.totalAmountDue)}</td>
                    <td className={TD}>
                      <Badge value={bill.notificationStatus} />
                    </td>
                  </tr>
                ))}
                {!filteredBills.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">No eligible bills match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}

async function fileData(file?: File) {
  if (!file) return {};
  if (file.size > 4 * 1024 * 1024)
    throw new Error("Supporting document must be 4 MB or smaller");
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("Could not read supporting document"));
    reader.readAsDataURL(file);
  });
  return { supportingFileName: file.name, supportingContent: content };
}

export function BillingAdjustments() {
  const [bills, setBills] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File>();
  const [form, setForm] = useState<Row>({
    billId: "",
    adjustmentType: "CREDIT_NOTE",
    amount: "",
    reason: "",
  });
  const load = () =>
    Promise.all([api.listBills(), api.listBillingAdjustments()]).then(
      ([b, a]) => {
        setBills(
          b.filter((x: Row) =>
            ["APPROVED", "POSTED", "PARTIALLY_PAID"].includes(x.status),
          ),
        );
        setItems(a);
      },
    );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const bill = bills.find((b) => String(b.billId) === form.billId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createBillingAdjustment({
        ...form,
        amount: Number(form.amount),
        ...(await fileData(file)),
      });
      setMessage("Adjustment request submitted for independent approval.");
      setForm({
        billId: "",
        adjustmentType: "CREDIT_NOTE",
        amount: "",
        reason: "",
      });
      setFile(undefined);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Bill adjustment requests"
      subtitle="Request controlled credit notes, debit notes and corrections"
      actions={
        <LinkButton to="/billing/adjustments/approvals">
          Adjustment approval
        </LinkButton>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[430px_1fr]">
        <Card title="New adjustment request">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Bill" required>
              <SearchableSelect
                required
                className={INPUT}
                value={form.billId}
                onChange={(e) => setForm({ ...form, billId: e.target.value })}
              >
                <option value="">Select approved / posted bill</option>
                {bills.map((b) => (
                  <option key={b.billId} value={b.billId}>
                    {b.billNumber} · {b.customerName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            {bill && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div>
                  {bill.account.accountNumber} · {bill.customerName}
                </div>
                <strong>
                  Current charges: {money(bill.totalCurrentCharges)}
                </strong>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Adjustment type" required>
                <SearchableSelect
                  className={INPUT}
                  value={form.adjustmentType}
                  onChange={(e) =>
                    setForm({ ...form, adjustmentType: e.target.value })
                  }
                >
                  <option>CREDIT_NOTE</option>
                  <option>DEBIT_NOTE</option>
                  <option>CORRECTION</option>
                  <option>CANCELLATION</option>
                </SearchableSelect>
              </Field>
              <Field label="Amount" required>
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  className={INPUT}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Reason" required>
              <textarea
                required
                rows={3}
                className={INPUT}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
            <Field label="Supporting document">
              <input
                type="file"
                className={INPUT}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </Field>
            <Button className="w-full" disabled={!form.billId}>
              Submit adjustment
            </Button>
          </form>
        </Card>
        <Card title="Adjustment history">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Reference</th>
                  <th className={TH}>Bill</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Requested by</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.adjustmentId} className="border-t">
                    <td className={TD}>{a.adjustmentNumber}</td>
                    <td className={TD}>{a.bill.billNumber}</td>
                    <td className={TD}>{pretty(a.adjustmentType)}</td>
                    <td className={TD}>{money(a.amount)}</td>
                    <td className={TD}>{person(a.requester)}</td>
                    <td className={TD}>
                      <Badge value={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function BillingAdjustmentApprovals() {
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<Row | null>(null);
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = () =>
    api.listBillingAdjustments("PENDING").then((rows) => {
      setItems(rows);
      setSelected([]);
      setFocus(rows[0] ?? null);
    });
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const actor = getSessionUser();
  const isAdmin = Boolean(actor?.roles.includes("SYSTEM_ADMIN"));
  const canDecide = Boolean(
    actor?.roles.some((role) =>
      ["BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"].includes(role),
    ),
  );
  const selectedIncludesOwn =
    !isAdmin &&
    selected.some((adjustmentId) => {
      const adjustment = items.find(
        (item) => String(item.adjustmentId) === adjustmentId,
      );
      return (
        adjustment && String(adjustment.requestedBy) === String(actor?.userId)
      );
    });
  const decisionDisabled =
    !selected.length || !canDecide || selectedIncludesOwn;
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected.length || comments.trim().length < 3)
      return setError(
        "Select at least one adjustment and enter decision comments.",
      );
    try {
      const result = await api.decideBillingAdjustments(
        selected,
        decision,
        comments,
      );
      setMessage(
        `${result.updated} adjustment(s) changed to ${pretty(result.status)}.`,
      );
      setComments("");
      setError("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Bill adjustment approval"
      subtitle="Independent maker-checker review before balances are changed"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
        Adjustments may be requested after posting. Credit notes and
        cancellations reduce the posted balance; debit notes and corrections
        increase it after independent approval.
      </div>
      {!canDecide && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Signed in as <strong>{actor?.username ?? "unknown user"}</strong>.
          Adjustment decisions require Billing Supervisor, Finance Manager or
          System Administrator.
        </div>
      )}
      {selectedIncludesOwn && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          The selection contains a request created by{" "}
          <strong>{actor?.username}</strong>. Remove it from the selection or
          sign in as an independent checker.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Card title={`${items.length} pending request(s)`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>
                    <input
                      aria-label="Select all adjustments"
                      type="checkbox"
                      checked={
                        items.length > 0 && selected.length === items.length
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? items.map((a) => String(a.adjustmentId))
                            : [],
                        )
                      }
                    />
                  </th>
                  <th className={TH}>Reference</th>
                  <th className={TH}>Bill / Customer</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.adjustmentId} className="border-t">
                    <td className={TD}>
                      <input
                        aria-label={`Select ${a.adjustmentNumber}`}
                        type="checkbox"
                        checked={selected.includes(String(a.adjustmentId))}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, String(a.adjustmentId)]
                              : selected.filter(
                                  (id) => id !== String(a.adjustmentId),
                                ),
                          )
                        }
                      />
                    </td>
                    <td className={TD}>{a.adjustmentNumber}</td>
                    <td className={TD}>
                      {a.bill.billNumber}
                      <div className="text-xs">
                        {a.bill.account.accountNumber}
                      </div>
                    </td>
                    <td className={TD}>{pretty(a.adjustmentType)}</td>
                    <td className={TD}>{money(a.amount)}</td>
                    <td className={TD}>
                      <button
                        className="font-semibold text-aqua-700"
                        onClick={() => setFocus(a)}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No adjustment requests await approval.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`Approval decision · ${selected.length} selected`}>
          {focus ? (
            <>
              <div className="rounded-xl bg-slate-50 p-4">
                <h3 className="font-bold">{focus.adjustmentNumber}</h3>
                <p className="text-sm">
                  {focus.bill.billNumber} · {focus.bill.account.accountNumber}
                </p>
                <div className="mt-3 text-2xl font-bold text-aqua-700">
                  {money(focus.amount)}
                </div>
                <div className="mt-3 text-sm">
                  <strong>Reason:</strong> {focus.reason}
                </div>
                <div className="mt-2 text-sm">
                  <strong>Requested by:</strong> {person(focus.requester)}
                </div>
              </div>
              <Field label="Decision comments" required>
                <textarea
                  rows={3}
                  className={`${INPUT} mt-3`}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                />
              </Field>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  disabled={decisionDisabled}
                  tone="red"
                  onClick={() => decide("REJECT")}
                >
                  Reject selected
                </Button>
                <Button
                  disabled={decisionDisabled}
                  tone="orange"
                  onClick={() => decide("RETURN")}
                >
                  Return selected
                </Button>
                <Button
                  disabled={decisionDisabled}
                  tone="green"
                  onClick={() => decide("APPROVE")}
                >
                  Approve selected
                </Button>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-slate-400">
              No request selected.
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}

function accountCustomerName(account?: Row) {
  const customer = account?.customer;
  return customer?.organizationName ||
    [customer?.firstName, customer?.middleName, customer?.lastName].filter(Boolean).join(" ") ||
    "Unknown customer";
}

export function AccountAdjustments() {
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [items, setItems] = useState<Row[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("ALL");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File>();
  const [form, setForm] = useState<Row>({
    accountId: "",
    adjustmentType: "DEBIT",
    amount: "",
    reason: "",
  });

  const loadHistory = () => api.listAccountAdjustments().then(setItems);
  useEffect(() => {
    Promise.all([api.listAccounts("", 50).then(setAccounts), loadHistory()])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.listAccounts(accountSearch, 50).then((rows) => {
        setAccounts((current) => {
          const chosen = current.find((account) => String(account.accountId) === form.accountId);
          return chosen && !rows.some((account: Row) => String(account.accountId) === form.accountId)
            ? [chosen, ...rows]
            : rows;
        });
      }).catch((e) => setError(e.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountSearch, form.accountId]);

  const account = accounts.find((row) => String(row.accountId) === form.accountId);
  const amount = Number(form.amount) || 0;
  const projectedBalance = account
    ? Number(account.currentBalance) + (form.adjustmentType === "DEBIT" ? amount : -amount)
    : 0;
  const visibleItems = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase();
    return items.filter((adjustment) => {
      const matchesStatus = historyStatus === "ALL" || adjustment.status === historyStatus;
      const matchesSearch = !query || [
        adjustment.adjustmentNumber,
        adjustment.account?.accountNumber,
        accountCustomerName(adjustment.account),
        person(adjustment.requester),
      ].some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [historySearch, historyStatus, items]);
  const historyTotalPages = Math.max(1, Math.ceil(visibleItems.length / historyPageSize));
  const pagedHistoryItems = visibleItems.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );
  useEffect(() => { setHistoryPage(1); }, [historySearch, historyStatus, historyPageSize]);
  useEffect(() => {
    if (historyPage > historyTotalPages) setHistoryPage(historyTotalPages);
  }, [historyPage, historyTotalPages]);
  const pendingCount = items.filter((item) => item.status === "PENDING").length;
  const actor = getSessionUser();
  const isAdmin = Boolean(actor?.roles.includes("SYSTEM_ADMIN"));
  const canApprove = Boolean(actor?.roles.some((role) =>
    ["BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"].includes(role),
  ));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.createAccountAdjustment({
        ...form,
        amount: Number(form.amount),
        ...(await fileData(file)),
      });
      setMessage("Account adjustment submitted for independent approval. The balance has not changed yet.");
      setForm({ accountId: "", adjustmentType: "DEBIT", amount: "", reason: "" });
      setFile(undefined);
      await loadHistory();
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function approveInline(adjustment: Row) {
    const isOwnRequest = String(adjustment.requestedBy) === String(actor?.userId);
    if (!canApprove || (isOwnRequest && !isAdmin)) return;
    const projected = Number(adjustment.account.currentBalance) +
      (adjustment.adjustmentType === "DEBIT" ? Number(adjustment.amount) : -Number(adjustment.amount));
    const confirmation = await Swal.fire({
      icon: "question",
      title: `Approve ${adjustment.adjustmentNumber}?`,
      text: `${adjustment.account.accountNumber} · ${accountCustomerName(adjustment.account)} — ${pretty(adjustment.adjustmentType)} ${money(adjustment.amount)}. Balance after approval: ${money(projected)}.`,
      input: "textarea",
      inputLabel: "Approval comments",
      inputPlaceholder: "Enter the reason for approving this adjustment",
      inputAttributes: { maxlength: "2000" },
      showCancelButton: true,
      confirmButtonText: "Approve adjustment",
      confirmButtonColor: "#059669",
      preConfirm: (value) => {
        if (String(value ?? "").trim().length < 3) {
          Swal.showValidationMessage("Enter at least 3 characters for the approval comments.");
          return false;
        }
        return String(value).trim();
      },
    });
    if (!confirmation.isConfirmed) return;
    setApprovingId(String(adjustment.accountAdjustmentId));
    setError("");
    try {
      await api.decideAccountAdjustments(
        [String(adjustment.accountAdjustmentId)],
        "APPROVE",
        String(confirmation.value),
      );
      setMessage(`${adjustment.adjustmentNumber} approved. The account balance has been updated.`);
      await loadHistory();
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApprovingId("");
    }
  }

  return (
    <Page
      title="Account adjustments"
      subtitle="Adjust a customer account without changing or linking to an individual bill"
      actions={<LinkButton to="/billing/account-adjustments/approvals">Approval queue{pendingCount ? ` (${pendingCount})` : ""}</LinkButton>}
      className="account-adjustments-page [&_.page-screen-header]:mb-3"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid items-start gap-4 lg:grid-cols-[410px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v18M16.5 7.5C16.5 5.6 14.5 4 12 4S7.5 5.3 7.5 7.5 9.5 11 12 11s4.5 1.6 4.5 3.5S14.5 18 12 18s-4.5-1.6-4.5-3.5" /></svg>
              </div>
              <div><h2 className="text-base font-bold text-slate-900">New adjustment</h2><p className="text-xs text-slate-500">Balance changes require independent approval</p></div>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-3 p-4">
            <Field label="Customer account" required>
              <SearchableSelect
                required
                className={INPUT}
                value={form.accountId}
                onSearchQuery={setAccountSearch}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              >
                <option value="">Search account number or customer</option>
                {accounts.map((row) => (
                  <option key={row.accountId} value={row.accountId}>
                    {row.accountNumber} · {accountCustomerName(row)}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            {account && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="font-semibold text-slate-900">{accountCustomerName(account)}</div><div className="mt-0.5 text-slate-500">{account.accountNumber}</div></div>
                  <Badge value={account.accountStatus} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 border-t border-slate-200 pt-2">
                  <div><div className="text-xs text-slate-500">Current balance</div><div className="mt-0.5 font-bold text-slate-900">{money(account.currentBalance)}</div></div>
                  <div><div className="text-xs text-slate-500">After approval</div><div className={`mt-0.5 font-bold ${form.adjustmentType === "DEBIT" ? "text-orange-600" : "text-emerald-600"}`}>{money(projectedBalance)}</div></div>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Adjustment type" required>
                <SearchableSelect
                  className={INPUT}
                  value={form.adjustmentType}
                  onChange={(e) => setForm({ ...form, adjustmentType: e.target.value })}
                >
                  <option value="DEBIT">Debit — increase balance</option>
                  <option value="CREDIT">Credit — reduce balance</option>
                </SearchableSelect>
              </Field>
              <Field label="Amount" required>
                <input
                  required min="0.01" step="0.01" type="number" className={INPUT}
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Reason" required>
              <textarea
                required minLength={5} rows={3} className={INPUT}
                placeholder="Explain why this account-level adjustment is required"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
            <Field label="Supporting document">
              <input type="file" className={`${INPUT} p-1.5 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200`} onChange={(e) => setFile(e.target.files?.[0])} />
            </Field>
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${form.adjustmentType === "DEBIT" ? "bg-orange-500" : "bg-emerald-500"}`} />
              <span><strong className="text-slate-700">{pretty(form.adjustmentType)}:</strong> {form.adjustmentType === "DEBIT" ? "increases the amount the customer owes." : "reduces the amount owed and may create a credit balance."}</span>
            </div>
            <Button className="flex w-full items-center justify-center gap-2" disabled={submitting || !form.accountId || !amount}>
              {submitting ? "Submitting…" : "Submit for approval"}
              {!submitting && <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>}
            </Button>
          </form>
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2"><h2 className="text-base font-bold text-slate-900">Adjustment history</h2><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{items.length}</span>{pendingCount > 0 && <span className="text-xs text-slate-500">{pendingCount} pending</span>}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_120px]">
              <div className="relative min-w-0">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
                <input className={`${INPUT} py-1.5 pl-9 pr-9`} value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search by reference, account, customer or requester" aria-label="Search adjustment history" />
                {historySearch && <button type="button" onClick={() => setHistorySearch("")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear history search"><svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>}
              </div>
              <select className={`${INPUT} py-1.5`} value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)} aria-label="Filter adjustment status">
                <option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="RETURNED">Returned</option><option value="REJECTED">Rejected</option>
              </select>
              <select className={`${INPUT} py-1.5`} value={historyPageSize} onChange={(event) => setHistoryPageSize(Number(event.target.value))} aria-label="Adjustments per page">
                <option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option>
              </select>
            </div>
          </div>
          {loading ? <Spinner /> : <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>
                  <th className={TH}>Reference</th><th className={TH}>Account / Customer</th>
                  <th className={TH}>Type</th><th className={TH}>Amount</th>
                  <th className={TH}>Requested by</th><th className={TH}>Status</th><th className={TH}>Action</th>
                </tr></thead>
                <tbody>
                  {pagedHistoryItems.map((adjustment) => (
                    <tr key={adjustment.accountAdjustmentId} className="border-t border-slate-100">
                      <td className={TD}><div className="font-semibold text-slate-800">{adjustment.adjustmentNumber}</div><div className="mt-0.5 text-xs text-slate-400">{date(adjustment.createdAt)}</div></td>
                      <td className={TD}><div className="font-medium text-slate-700">{adjustment.account.accountNumber}</div><div className="mt-0.5 max-w-52 truncate text-xs text-slate-400">{accountCustomerName(adjustment.account)}</div></td>
                      <td className={TD}><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${adjustment.adjustmentType === "DEBIT" ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${adjustment.adjustmentType === "DEBIT" ? "bg-orange-500" : "bg-emerald-500"}`} />{pretty(adjustment.adjustmentType)}</span></td>
                      <td className={`${TD} whitespace-nowrap font-bold text-slate-800`}>{money(adjustment.amount)}</td>
                      <td className={TD}>{person(adjustment.requester)}</td>
                      <td className={TD}><Badge value={adjustment.status} /></td>
                      <td className={TD}>
                        {adjustment.status === "PENDING" ? (() => {
                          const isOwnRequest = String(adjustment.requestedBy) === String(actor?.userId);
                          const blocked = !canApprove || (isOwnRequest && !isAdmin);
                          return blocked ? (
                            <Link to="/billing/account-adjustments/approvals" className="whitespace-nowrap text-xs font-semibold text-aqua-700 hover:text-aqua-800">Review queue</Link>
                          ) : (
                            <button type="button" disabled={Boolean(approvingId)} onClick={() => approveInline(adjustment)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60">
                              {approvingId === String(adjustment.accountAdjustmentId) && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                              {approvingId === String(adjustment.accountAdjustmentId) ? "Approving…" : "Review & approve"}
                            </button>
                          );
                        })() : <span className="text-xs text-slate-400">Completed</span>}
                      </td>
                    </tr>
                  ))}
                  {!visibleItems.length && <tr><td colSpan={7} className="px-6 py-12 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 3h9l3 3v15H6z" /><path d="M14 3v4h4M9 12h6M9 16h4" /></svg></div><div className="mt-2 font-semibold text-slate-700">{items.length ? "No matching adjustments" : "No adjustments yet"}</div><div className="mt-0.5 text-sm text-slate-400">{items.length ? "Try a different search or status filter." : "Submitted requests will appear here for tracking."}</div></td></tr>}
                </tbody>
              </table>
            </div>
            {visibleItems.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3">
                <Pagination page={historyPage} totalPages={historyTotalPages} total={visibleItems.length} pageSize={historyPageSize} onPageChange={setHistoryPage} label="adjustments" />
              </div>
            )}
          </>}
        </section>
      </div>
    </Page>
  );
}

export function AccountAdjustmentApprovals() {
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [requesterFilter, setRequesterFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [decisionAction, setDecisionAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load(initial = false) {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await api.listAccountAdjustments("PENDING");
      setItems(rows);
      setSelected([]);
      setFocus(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }
  useEffect(() => {
    load(true).catch((e) => setError(e.message));
  }, []);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const now = Date.now();
    return items.filter((adjustment) => {
      const matchesType = typeFilter === "ALL" || adjustment.adjustmentType === typeFilter;
      const matchesRequester = requesterFilter === "ALL" || String(adjustment.requestedBy) === requesterFilter;
      const ageInDays = (now - new Date(adjustment.createdAt).getTime()) / 86_400_000;
      const matchesDate = dateFilter === "ALL" || ageInDays <= Number(dateFilter);
      const matchesSearch = !query || [
        adjustment.adjustmentNumber,
        adjustment.account?.accountNumber,
        accountCustomerName(adjustment.account),
        person(adjustment.requester),
        adjustment.reason,
      ].some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
      return matchesType && matchesRequester && matchesDate && matchesSearch;
    });
  }, [dateFilter, items, requesterFilter, search, typeFilter]);
  const requesters = useMemo(() => Array.from(new Map(
    items.map((item) => [String(item.requestedBy), person(item.requester)]),
  ).entries()).sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pagedItems = visibleItems.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [dateFilter, requesterFilter, search, typeFilter, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const actor = getSessionUser();
  const isAdmin = Boolean(actor?.roles.includes("SYSTEM_ADMIN"));
  const canDecide = Boolean(actor?.roles.some((role) => ["BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"].includes(role)));
  const selectedIncludesOwn = !isAdmin && selected.some((adjustmentId) => {
    const adjustment = items.find((item) => String(item.accountAdjustmentId) === adjustmentId);
    return adjustment && String(adjustment.requestedBy) === String(actor?.userId);
  });

  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected.length || comments.trim().length < 3) {
      return setError("Select at least one adjustment and enter decision comments.");
    }
    const approved = await Swal.fire({
      icon: decision === "APPROVE" ? "question" : "warning",
      title: `${pretty(decision)} ${selected.length} account adjustment(s)?`,
      text: decision === "APPROVE"
        ? "Approved debits and credits will immediately change the customer account balances."
        : `The selected requests will be marked ${pretty(decision)} without changing account balances.`,
      showCancelButton: true,
      confirmButtonText: `${pretty(decision)} selected`,
      confirmButtonColor: decision === "APPROVE" ? "#059669" : decision === "REJECT" ? "#dc2626" : "#f97316",
    });
    if (!approved.isConfirmed) return;
    setDecisionAction(decision); setError("");
    try {
      const result = await api.decideAccountAdjustments(selected, decision, comments);
      setMessage(`${result.updated} account adjustment(s) changed to ${pretty(result.status)}.`);
      setComments("");
      await load();
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDecisionAction("");
    }
  }

  const decisionDisabled = Boolean(decisionAction) || !selected.length || !canDecide || selectedIncludesOwn;
  const visibleIds = pagedItems.map((item) => String(item.accountAdjustmentId));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const focusedProjectedBalance = focus
    ? Number(focus.account.currentBalance) + (focus.adjustmentType === "DEBIT" ? Number(focus.amount) : -Number(focus.amount))
    : 0;
  return (
    <Page title="Account adjustment approval" subtitle="Review pending debit and credit requests before customer balances change" className="[&_.page-screen-header]:mb-3">
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      {!canDecide && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Decisions require Billing Supervisor, Finance Manager or System Administrator access.</div>}
      {selectedIncludesOwn && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Your selection contains your own request. Maker-checker control requires an independent approver.</div>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><h2 className="text-base font-bold text-slate-900">Pending requests</h2><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{items.length}</span>{selected.length > 0 && <span className="text-xs font-medium text-aqua-700">{selected.length} selected</span>}</div>
              <button type="button" onClick={() => load().catch((e) => setError(e.message))} disabled={loading || refreshing} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
                <svg className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M16 6V2m0 0h-4m4 0-3 3a6 6 0 1 0 1.5 6" /></svg>{refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_130px_170px_145px_120px]">
              <div className="relative min-w-0">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
                <input className={`${INPUT} py-1.5 pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, account, customer or requester" aria-label="Search pending adjustments" />
              </div>
              <select className={`${INPUT} py-1.5`} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by adjustment type"><option value="ALL">All types</option><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></select>
              <select className={`${INPUT} py-1.5`} value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)} aria-label="Filter by requester"><option value="ALL">All requesters</option>{requesters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
              <select className={`${INPUT} py-1.5`} value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter by request date"><option value="ALL">Any date</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
              <select className={`${INPUT} py-1.5`} value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Requests per page"><option value="10">10 per page</option><option value="25">25 per page</option><option value="50">50 per page</option></select>
            </div>
          </div>
          {loading ? <Spinner /> : <><div className="overflow-x-auto"><table className="w-full">
            <thead><tr>
              <th className={TH}><input aria-label="Select all visible account adjustments" type="checkbox" checked={allVisibleSelected} onChange={(e) => setSelected(e.target.checked ? Array.from(new Set([...selected, ...visibleIds])) : selected.filter((id) => !visibleIds.includes(id)))} /></th>
              <th className={TH}>Reference</th><th className={TH}>Account / Customer</th><th className={TH}>Type</th><th className={TH}>Amount</th><th className={TH}>Requested by</th><th className={TH}>Action</th>
            </tr></thead>
            <tbody>
              {pagedItems.map((adjustment) => (
                <tr key={adjustment.accountAdjustmentId} className={`border-t border-slate-100 ${focus?.accountAdjustmentId === adjustment.accountAdjustmentId ? "bg-aqua-50/60" : ""}`}>
                  <td className={TD}><input aria-label={`Select ${adjustment.adjustmentNumber}`} type="checkbox" checked={selected.includes(String(adjustment.accountAdjustmentId))} onChange={(e) => { const adjustmentId = String(adjustment.accountAdjustmentId); setSelected(e.target.checked ? Array.from(new Set([...selected, adjustmentId])) : selected.filter((id) => id !== adjustmentId)); if (e.target.checked) setFocus(adjustment); }} /></td>
                  <td className={TD}><div className="font-semibold text-slate-800">{adjustment.adjustmentNumber}</div><div className="mt-0.5 text-xs text-slate-400">{date(adjustment.createdAt)}</div></td>
                  <td className={TD}><div className="font-medium text-slate-700">{adjustment.account.accountNumber}</div><div className="mt-0.5 max-w-48 truncate text-xs text-slate-400">{accountCustomerName(adjustment.account)}</div></td>
                  <td className={TD}><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${adjustment.adjustmentType === "DEBIT" ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-700"}`}>{pretty(adjustment.adjustmentType)}</span></td>
                  <td className={`${TD} whitespace-nowrap font-bold text-slate-800`}>{money(adjustment.amount)}</td>
                  <td className={TD}>{person(adjustment.requester)}</td>
                  <td className={TD}><button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-aqua-300 hover:bg-aqua-50 hover:text-aqua-700" onClick={() => { const adjustmentId = String(adjustment.accountAdjustmentId); setFocus(adjustment); setSelected((current) => current.includes(adjustmentId) ? current : [...current, adjustmentId]); }}>Review</button></td>
                </tr>
              ))}
              {!visibleItems.length && <tr><td colSpan={7} className="px-6 py-12 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 12.5 9 16l10-10" /><circle cx="12" cy="12" r="9" /></svg></div><div className="mt-2 font-semibold text-slate-700">{items.length ? "No matching requests" : "Approval queue is clear"}</div><div className="mt-0.5 text-sm text-slate-400">{items.length ? "Try a different search or type filter." : "There are no account adjustments awaiting review."}</div></td></tr>}
            </tbody>
          </table></div>{visibleItems.length > 0 && <div className="px-4 pb-4"><Pagination page={page} totalPages={totalPages} total={visibleItems.length} pageSize={pageSize} onPageChange={setPage} disabled={refreshing} label="requests" /></div>}</>}
        </section>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 xl:sticky xl:top-4">
          <div className="border-b border-slate-100 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">Approval decision</h2><p className="text-xs text-slate-500">Review the selected request details</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{selected.length} selected</span></div></div>
          <div className="p-4">
          {focus ? <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{focus.adjustmentNumber}</h3><p className="mt-0.5 text-xs text-slate-500">Requested {date(focus.createdAt)}</p></div><Badge value="PENDING" /></div>
              <div className="mt-3 border-t border-slate-200 pt-3"><div className="font-semibold text-slate-800">{accountCustomerName(focus.account)}</div><div className="text-xs text-slate-500">{focus.account.accountNumber}</div></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5"><div className="text-xs text-slate-500">Current balance</div><div className="mt-0.5 font-bold text-slate-800">{money(focus.account.currentBalance)}</div></div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5"><div className="text-xs text-slate-500">After approval</div><div className={`mt-0.5 font-bold ${focus.adjustmentType === "DEBIT" ? "text-orange-600" : "text-emerald-600"}`}>{money(focusedProjectedBalance)}</div></div>
              </div>
              <div className="mt-3 flex items-center justify-between border-b border-slate-200 pb-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${focus.adjustmentType === "DEBIT" ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-700"}`}>{pretty(focus.adjustmentType)}</span><span className="text-lg font-bold text-slate-900">{money(focus.amount)}</span></div>
              <dl className="mt-3 space-y-2"><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Reason</dt><dd className="mt-0.5 leading-5 text-slate-700">{focus.reason}</dd></div><div className="grid grid-cols-2 gap-3"><div><dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Requested by</dt><dd className="mt-0.5 text-slate-700">{person(focus.requester)}</dd></div>{focus.supportingFileName && <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Document</dt><dd className="mt-0.5 truncate text-slate-700" title={focus.supportingFileName}>{focus.supportingFileName}</dd></div>}</div></dl>
            </div>
            <Field label="Decision comments" required><textarea rows={3} className={`${INPUT} mt-3`} placeholder="Add a clear reason for this decision" value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button disabled={decisionDisabled} tone="red" onClick={() => decide("REJECT")}>{decisionAction === "REJECT" ? <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Rejecting</span> : "Reject"}</Button>
              <Button disabled={decisionDisabled} tone="orange" onClick={() => decide("RETURN")}>{decisionAction === "RETURN" ? <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Returning</span> : "Return"}</Button>
              <Button disabled={decisionDisabled} tone="green" onClick={() => decide("APPROVE")}>{decisionAction === "APPROVE" ? <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Approving</span> : "Approve"}</Button>
            </div>
          </> : <div className="py-12 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 4h8M9 2h6v4H9zM6 4h12v17H6zM9 11h6M9 15h4" /></svg></div><div className="mt-2 font-semibold text-slate-700">No request selected</div><div className="mt-0.5 text-sm text-slate-400">Choose Review from the approval queue.</div></div>}
          </div>
        </section>
      </div>
    </Page>
  );
}

export function BillingSecurityAlerts() {
  const [status, setStatus] = useState("OPEN");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const load = () => api.listBillingAlerts(status).then(setRows);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [status]);
  return (
    <Page
      title="Unauthorized bill change alerts"
      subtitle="Blocked self-approval and protected billing actions"
      actions={
        <Button
          tone="slate"
          onClick={() =>
            exportExcel("billing-security-alerts.xlsx", "Alerts", rows)
          }
        >
          Export audit log
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <Field label="Alert status">
          <SearchableSelect
            className={INPUT}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option>OPEN</option>
            <option>RESOLVED</option>
            <option value="">All</option>
          </SearchableSelect>
        </Field>
      </Card>
      <Card title={`${rows.length} alert(s)`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Bill</th>
                <th className={TH}>Alert</th>
                <th className={TH}>User</th>
                <th className={TH}>Attempt</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.alertId} className="border-t">
                  <td className={TD}>{dateTime(a.createdAt)}</td>
                  <td className={TD}>{a.bill?.billNumber ?? "—"}</td>
                  <td className={TD}>
                    {pretty(a.alertType)}
                    <div className="text-xs">{a.details}</div>
                  </td>
                  <td className={TD}>{person(a.attempter)}</td>
                  <td className={TD}>{pretty(a.attemptedAction)}</td>
                  <td className={TD}>
                    <Badge value={a.status} />
                  </td>
                  <td className={TD}>
                    {a.status === "OPEN" && (
                      <button
                        className="font-semibold text-emerald-700"
                        onClick={async () => {
                          await api.resolveBillingAlert(String(a.alertId));
                          await load();
                        }}
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function BillingHistory() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listBillingCycles().then(setCycles);
  }, []);
  useEffect(() => {
    api
      .listBills({ billingCycleId: cycleId, search })
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [cycleId, search]);
  return (
    <Page
      title="Billing history"
      subtitle="Permanent customer billing records across all periods"
      actions={
        <Button
          tone="green"
          onClick={() =>
            exportExcel(
              "billing-history.xlsx",
              "Billing History",
              rows.map((b) => ({
                Period: b.billingCycle.cycleName,
                Bill: b.billNumber,
                Account: b.account.accountNumber,
                Customer: b.customerName,
                Charges: Number(b.totalCurrentCharges),
                AmountDue: Number(b.totalAmountDue),
                Status: b.status,
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Billing period">
            <CycleSelect
              cycles={cycles}
              value={cycleId}
              onChange={setCycleId}
            />
          </Field>
          <Field label="Account, bill or customer">
            <input
              className={INPUT}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
      </Card>
      <Card title={`${rows.length} historical bill(s)`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Period</th>
                <th className={TH}>Bill</th>
                <th className={TH}>Account / Customer</th>
                <th className={TH}>Consumption</th>
                <th className={TH}>Current charges</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.billId} className="border-t">
                  <td className={TD}>{b.billingCycle.cycleName}</td>
                  <td className={TD}>{b.billNumber}</td>
                  <td className={TD}>
                    {b.account.accountNumber}
                    <div className="text-xs">{b.customerName}</div>
                  </td>
                  <td className={TD}>{b.consumptionUnits} units</td>
                  <td className={TD}>{money(b.totalCurrentCharges)}</td>
                  <td className={TD}>
                    <Badge value={b.status} />
                  </td>
                  <td className={TD}>
                    <Link
                      className="font-semibold text-aqua-700"
                      to={`/billing/invoices/${b.billId}`}
                    >
                      Invoice
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function BillingAudit() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listBillingCycles().then(setCycles);
  }, []);
  useEffect(() => {
    api
      .billingAudit(cycleId)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [cycleId]);
  return (
    <Page
      title="Billing audit trail"
      subtitle="Creation, generation, approval, posting, notification and adjustment events"
      actions={
        <Button
          tone="green"
          onClick={() =>
            exportExcel(
              "billing-audit-trail.xlsx",
              "Billing Audit",
              rows.map((e) => ({
                Date: dateTime(e.createdAt),
                Period: e.billingCycle?.cycleName,
                Bill: e.bill?.billNumber,
                Action: e.eventType,
                PreviousStatus: e.previousStatus,
                NewStatus: e.newStatus,
                User: person(e.performer),
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
        <Field label="Billing period">
          <CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} />
        </Field>
      </Card>
      <Card title={`${rows.length} audit event(s)`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Date and time</th>
                <th className={TH}>Period / Bill</th>
                <th className={TH}>User</th>
                <th className={TH}>Action</th>
                <th className={TH}>Status change</th>
                <th className={TH}>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.billingEventId} className="border-t">
                  <td className={TD}>{dateTime(e.createdAt)}</td>
                  <td className={TD}>
                    {e.billingCycle?.cycleName ?? "—"}
                    <div className="text-xs">{e.bill?.billNumber}</div>
                  </td>
                  <td className={TD}>{person(e.performer)}</td>
                  <td className={`${TD} font-semibold`}>
                    {pretty(e.eventType)}
                  </td>
                  <td className={TD}>
                    {e.previousStatus || e.newStatus
                      ? `${pretty(e.previousStatus) || "—"} → ${pretty(e.newStatus) || "—"}`
                      : "—"}
                  </td>
                  <td className={TD}>{e.details ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
