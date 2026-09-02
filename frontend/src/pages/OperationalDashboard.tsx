import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { SweetAlertToast } from "../components/SweetAlertToast";

type Row = Record<string, any>;

type DashboardData = {
  arrears?: Row;
  billing?: Row;
  customers?: Row;
  meters?: Row;
  notifications?: Row;
  payments?: Row;
  readings?: Row;
};

type ChartItem = {
  color: string;
  label: string;
  value: number;
};

const palette = ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b", "#06b6d4"];

function number(value: unknown) {
  return Number(value ?? 0);
}

function compact(value: unknown) {
  return number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function money(value: unknown) {
  return `KSh ${number(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function pretty(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Card({ title, subtitle, action, children, className = "" }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Kpi({ label, value, detail, tone, icon }: {
  label: string;
  value: ReactNode;
  detail: string;
  tone: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 truncate text-2xl font-bold text-slate-900">{value}</div>
          <div className="mt-1 truncate text-xs text-slate-500">{detail}</div>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      </div>
    </div>
  );
}

function MiniIcon({ path }: { path: string }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DonutChart({ items, centerLabel, centerValue }: {
  items: ChartItem[];
  centerLabel: string;
  centerValue: string;
}) {
  const positive = items.filter((item) => item.value > 0);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const segments = positive.map((item) => {
    const start = offset;
    offset += total ? (item.value / total) * 100 : 0;
    return `${item.color} ${start}% ${offset}%`;
  });

  return (
    <div className="grid items-center gap-6 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto h-44 w-44 rounded-full" style={{ background: total ? `conic-gradient(${segments.join(",")})` : "#e2e8f0" }}>
        <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
          <strong className="text-2xl text-slate-900">{centerValue}</strong>
          <span className="mt-0.5 text-[11px] text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.label}</span>
            </span>
            <strong className="text-slate-800">{item.value.toLocaleString()}</strong>
          </div>
        ))}
        {!items.length && <p className="py-5 text-center text-sm text-slate-400">No distribution data available.</p>}
      </div>
    </div>
  );
}

function HorizontalBars({ items, format = compact }: {
  items: ChartItem[];
  format?: (value: number) => string;
}) {
  const maximum = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-slate-600">{item.label}</span>
            <strong className="whitespace-nowrap text-slate-800">{format(item.value)}</strong>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(item.value ? 2 : 0, (item.value / maximum) * 100)}%`, backgroundColor: item.color }} />
          </div>
        </div>
      ))}
      {!items.length && <p className="py-8 text-center text-sm text-slate-400">No chart data available.</p>}
    </div>
  );
}

function ColumnChart({ items }: { items: ChartItem[] }) {
  const maximum = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="flex h-56 items-end gap-3 border-b border-slate-200 px-2 pt-8">
      {items.map((item) => (
        <div key={item.label} className="group flex h-full min-w-0 flex-1 flex-col justify-end text-center">
          <span className="mb-2 text-xs font-semibold text-slate-700">{compact(item.value)}</span>
          <div
            className="mx-auto w-full max-w-16 rounded-t-lg transition-all duration-500 group-hover:opacity-80"
            style={{ height: `${Math.max(item.value ? 8 : 2, (item.value / maximum) * 145)}px`, backgroundColor: item.color }}
            title={`${item.label}: ${item.value.toLocaleString()}`}
          />
          <span className="mt-2 truncate text-[11px] text-slate-500" title={item.label}>{item.label}</span>
        </div>
      ))}
      {!items.length && <p className="m-auto text-sm text-slate-400">No collection channel data.</p>}
    </div>
  );
}

function ProgressRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = total ? Math.min(100, Math.round((value / total) * 1000) / 10) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <strong className="text-slate-800">{value.toLocaleString()} <span className="font-normal text-slate-400">({percent}%)</span></strong>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white p-4"><div className="h-4 w-28 rounded bg-slate-100" /><div className="mt-4 h-8 w-40 rounded bg-slate-100" /><div className="mt-4 h-3 w-full rounded bg-slate-100" /></div>;
}

export default function OperationalDashboard() {
  const [data, setData] = useState<DashboardData>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date>();

  const load = useCallback(async () => {
    setRefreshing(true);
    setError("");
    const keys: (keyof DashboardData)[] = ["customers", "meters", "readings", "billing", "payments", "arrears", "notifications"];
    const requests = [
      api.listCustomers("", 1),
      api.meterDashboard(),
      api.readingDashboard(),
      api.billingDashboard(),
      api.paymentDashboard(),
      api.arrearsDashboard(),
      api.notificationDashboard(),
    ].map((request, index) => request.then((value: Row) => {
      // Render each dashboard source as soon as it arrives. A slow debt or
      // revenue query must not hold back customer, meter and billing cards.
      setData((current) => ({ ...current, [keys[index]]: value }));
      setLoading(false);
      return value;
    }));
    const results = await Promise.allSettled(requests);
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) setError(`${failed} dashboard data source${failed === 1 ? " is" : "s are"} temporarily unavailable. Available charts are still shown.`);
    setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const meterItems = useMemo(() => Object.entries(data.meters?.status ?? {}).map(([label, value], index) => ({
    label: pretty(label), value: number(value), color: palette[index % palette.length],
  })), [data.meters]);

  const arrearsItems = useMemo(() => {
    const labels: Record<string, string> = { "0_30": "0–30 days", "31_60": "31–60 days", "61_90": "61–90 days", "91_120": "91–120 days", "120_PLUS": "Over 120 days" };
    return Object.entries(data.arrears?.buckets ?? {}).map(([label, value], index) => ({
      label: labels[label] ?? pretty(label), value: number(value), color: palette[[1, 0, 2, 3, 4][index] ?? index],
    }));
  }, [data.arrears]);

  const channelItems = useMemo(() => Object.entries(data.payments?.channels ?? {}).map(([label, value], index) => ({
    label, value: number(value), color: palette[index % palette.length],
  })), [data.payments]);

  const notificationItems = useMemo(() => [
    { label: "Delivered", value: number(data.notifications?.delivered), color: "#10b981" },
    { label: "Sent", value: number(data.notifications?.sent), color: "#0284c7" },
    { label: "Queued", value: number(data.notifications?.queued), color: "#f59e0b" },
    { label: "Failed", value: number(data.notifications?.failed), color: "#ef4444" },
  ], [data.notifications]);

  const financialItems = [
    { label: "Current cycle billing", value: number(data.billing?.totalBilling), color: "#0284c7" },
    { label: "Collections this month", value: number(data.payments?.total), color: "#10b981" },
    { label: "Outstanding arrears", value: number(data.arrears?.totalArrears), color: "#ef4444" },
  ];
  const generated = number(data.billing?.billsGenerated);

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">Operations dashboard</h1>
          <p className="mt-1 text-[15px] text-slate-500">A live visual overview of customers, field operations, billing, revenue and debt</p>
          {updatedAt && <p className="mt-1 text-xs text-slate-400">Updated {updatedAt.toLocaleString()}</p>}
        </div>
        <button type="button" disabled={refreshing} onClick={load} className="inline-flex items-center rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
          {refreshing && <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          Refresh dashboard
        </button>
      </div>

      <SweetAlertToast message={error} type="warning" />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} />)}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Kpi label="Customers" value={compact(data.customers?.total)} detail="Registered customer records" tone="bg-violet-50 text-violet-700" icon={<MiniIcon path="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6m3-3h-6" />} />
            <Kpi label="Meters" value={compact(data.meters?.total)} detail={`${compact(data.meters?.status?.ACTIVE)} active installations`} tone="bg-cyan-50 text-cyan-700" icon={<MiniIcon path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4v2m-5.7.3 1.5 1.5M5 14H3m18 0h-2m-1.3-5.7-1.5 1.5M12 14l3-3" />} />
            <Kpi label="Reading completion" value={`${number(data.readings?.completionPercent).toLocaleString()}%`} detail={`${compact(data.readings?.captured)} of ${compact(data.readings?.totalMeters)} meters captured`} tone="bg-sky-50 text-sky-700" icon={<MiniIcon path="M5 3h14v18H5zM8 7h8m-8 4h8m-8 4h5" />} />
            <Kpi label="Current billing" value={money(data.billing?.totalBilling)} detail={`${compact(generated)} bills generated`} tone="bg-emerald-50 text-emerald-700" icon={<MiniIcon path="M6 2h9l4 4v16H6zM14 2v5h5M9 12h7m-7 4h7" />} />
            <Kpi label="Collections" value={money(data.payments?.total)} detail={`${compact(data.payments?.payments)} posted payments this month`} tone="bg-amber-50 text-amber-700" icon={<MiniIcon path="M3 6h18v13H3zM3 10h18m-5 5h2" />} />
            <Kpi label="Total arrears" value={money(data.arrears?.totalArrears)} detail={`${compact(data.arrears?.customersInArrears)} customer accounts`} tone="bg-red-50 text-red-700" icon={<MiniIcon path="M12 8v5m0 4h.01M10.3 3.7 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card title="Meter status distribution" subtitle="Installed inventory by current lifecycle state" action={<Link to="/meters" className="text-xs font-semibold text-aqua-700">Open meters →</Link>}>
              <DonutChart items={meterItems} centerLabel="Total meters" centerValue={compact(data.meters?.total)} />
            </Card>
            <Card title="Financial position" subtitle="Relative scale of billing, collections and outstanding debt" action={<Link to="/payments" className="text-xs font-semibold text-aqua-700">Revenue details →</Link>}>
              <HorizontalBars items={financialItems} format={money} />
              <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <div><span className="block text-xs text-slate-500">Unmatched payments</span><strong className="text-amber-700">{compact(data.payments?.unmatched)}</strong></div>
                <div><span className="block text-xs text-slate-500">Receipts issued</span><strong className="text-emerald-700">{compact(data.payments?.receipts)}</strong></div>
              </div>
            </Card>

            <Card title="Reading and billing workflow" subtitle="Progress through the current operational cycles" action={<Link to="/readings" className="text-xs font-semibold text-aqua-700">Reading details →</Link>}>
              <div className="space-y-5">
                <ProgressRow label="Readings captured" value={number(data.readings?.captured)} total={number(data.readings?.totalMeters)} color="#0284c7" />
                <ProgressRow label="Readings approved" value={number(data.readings?.approved)} total={number(data.readings?.captured)} color="#10b981" />
                <ProgressRow label="Bills approved / posted" value={number(data.billing?.approved)} total={generated} color="#8b5cf6" />
                <ProgressRow label="Bill notifications sent" value={number(data.billing?.notified)} total={generated} color="#f59e0b" />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                {[["Unread", data.readings?.unread, "text-orange-600"], ["Exceptions", data.readings?.exceptions, "text-red-600"], ["Pending approval", data.readings?.pending, "text-amber-600"]].map(([label, value, color]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><strong className={`block text-xl ${color}`}>{compact(value)}</strong><span className="text-[11px] text-slate-500">{label}</span></div>
                ))}
              </div>
            </Card>

            <Card title="Arrears ageing" subtitle="Outstanding balance by age bucket" action={<Link to="/arrears/aging" className="text-xs font-semibold text-aqua-700">Ageing report →</Link>}>
              <HorizontalBars items={arrearsItems} format={money} />
            </Card>

            <Card title="Collections by channel" subtitle="Posted revenue for the current month" action={<Link to="/payments/reports/daily" className="text-xs font-semibold text-aqua-700">Collection report →</Link>}>
              <ColumnChart items={channelItems} />
            </Card>

            <Card title="Notification delivery" subtitle="Message delivery status across all customer communications" action={<Link to="/notifications" className="text-xs font-semibold text-aqua-700">Notification details →</Link>}>
              <DonutChart items={notificationItems} centerLabel="Notifications" centerValue={compact(data.notifications?.total)} />
            </Card>
          </div>

          <Card title="Operational flow" subtitle="Shortcuts follow the customer-to-cash process" className="mt-4">
            <div className="grid gap-2 md:grid-cols-5">
              {[
                ["1", "Customers", "/customers", "Customer and account setup"],
                ["2", "Meter readings", "/readings/worklist", "Capture and approve usage"],
                ["3", "Billing", "/billing/generate", "Generate and post bills"],
                ["4", "Collections", "/payments", "Receive and reconcile revenue"],
                ["5", "Debt recovery", "/arrears", "Manage outstanding balances"],
              ].map(([step, label, path, detail], index) => (
                <Link key={path} to={path} className="relative rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-sky-300 hover:bg-sky-50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-aqua-700 text-sm font-bold text-white">{step}</span>
                  <strong className="mt-3 block text-sm text-slate-800">{label}</strong>
                  <span className="mt-1 block text-xs text-slate-500">{detail}</span>
                  {index < 4 && <span className="absolute -right-2 top-7 z-10 hidden text-slate-300 md:block">→</span>}
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
