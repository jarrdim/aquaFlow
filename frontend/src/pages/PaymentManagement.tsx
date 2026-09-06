import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { exportDailyReceiptsWorkbook, exportExcel, parseMeterWorkbook } from "../lib/meterFiles";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { DateInput, DateTimeInput } from "../components/DateInput";

type Row = Record<string, any>;
const importCell = (row: Record<string, unknown>, key: string) => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = Object.entries(row).find(([column]) => column.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized);
  return String(match?.[1] ?? "").trim();
};
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] text-slate-700 outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";
const money = (v: any) =>
  `KSh ${Number(v ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (v: any) => (v ? new Date(v).toLocaleDateString("en-KE") : "—");
const dateTime = (v: any) => (v ? new Date(v).toLocaleString("en-KE") : "—");
const pretty = (v: any) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const person = (u: any) => (u ? `${u.firstName} ${u.lastName}` : "—");
const customerDisplayName = (customer: any) =>
  customer?.organizationName ||
  [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ");
const usablePhone = (value: any) => {
  const phone = String(value ?? "").trim();
  return /^[+\d][\d\s()-]{6,19}$/.test(phone) ? phone : "";
};
function Page({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5 ${className}`}>
      <div className="page-screen-header mb-4 flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex gap-2">{actions}</div>
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
      {title && <div className="border-b px-4 py-3 font-semibold">{title}</div>}
      <div className="p-4">{children}</div>
    </section>
  );
}
function Button({
  tone = "blue",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string }) {
  const colors: Row = {
    blue: "bg-aqua-700",
    green: "bg-emerald-600",
    red: "bg-red-600",
    orange: "bg-orange-500",
    slate: "bg-slate-600",
  };
  return (
    <button
      {...p}
      className={`rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-40 ${colors[tone]} ${p.className ?? ""}`}
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
  tone?: string;
}) {
  const colors: Row = {
    blue: "bg-aqua-700",
    green: "bg-emerald-600",
    orange: "bg-orange-500",
    slate: "bg-slate-600",
  };
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 font-semibold text-white ${colors[tone]}`}
    >
      {children}
    </Link>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}
function Notice({
  children,
  green = false,
}: {
  children: ReactNode;
  green?: boolean;
}) {
  return <SweetAlertToast message={children} type={green ? "success" : "error"} />;
}
function Badge({ value }: { value: any }) {
  const v = String(value ?? "");
  const good = [
    "POSTED",
    "PAID",
    "MATCHED",
    "VALID",
    "ACTIVE",
    "RESOLVED",
  ].includes(v);
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${good ? "bg-emerald-50 text-emerald-700" : v.includes("PENDING") || v === "RECEIVED" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
    >
      {pretty(v)}
    </span>
  );
}
function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function CollectionTrendChart({ rows }: { rows: Row[] }) {
  const points = rows;
  const width = Math.max(700, points.length * 90);
  const height = 210;
  const left = 16;
  const right = 16;
  const top = 20;
  const bottom = 38;
  const max = Math.max(1, ...points.map((row) => Number(row.amount ?? 0)));
  const coordinates: Array<Row & { x: number; y: number }> = points.map((row, index) => ({
    ...row,
    x: points.length === 1 ? width / 2 : left + (index / (points.length - 1)) * (width - left - right),
    y: top + (1 - Number(row.amount ?? 0) / max) * (height - top - bottom),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = coordinates.length
    ? `M ${coordinates[0].x} ${height - bottom} L ${coordinates.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${coordinates[coordinates.length - 1].x} ${height - bottom} Z`
    : "";
  return (
    <Card title="Collection trend">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">Daily posted revenue</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{money(points.reduce((sum, row) => sum + Number(row.amount ?? 0), 0))}</div>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Since first collection</span>
      </div>
      {coordinates.length ? (
        <div className="overflow-x-auto overflow-y-hidden rounded-xl bg-gradient-to-b from-emerald-50/70 to-white px-2 pt-2">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px]" style={{ minWidth: `${width}px`, width: "100%" }} role="img" aria-label="Daily collection trend">
            <defs>
              <linearGradient id="payment-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((ratio) => (
              <line key={ratio} x1={left} x2={width - right} y1={top + ratio * (height - top - bottom)} y2={top + ratio * (height - top - bottom)} stroke="#cbd5e1" strokeDasharray="4 6" opacity="0.65" />
            ))}
            <path d={area} fill="url(#payment-area)" />
            {coordinates.length > 1 && <polyline points={line} fill="none" stroke="#059669" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
            {coordinates.map((point, index) => (
              <g key={point.date} className="group">
                <circle cx={point.x} cy={point.y} r="5" fill="white" stroke="#059669" strokeWidth="3" />
                <text x={point.x} y={height - 13} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {String(point.date).slice(5).replace("-", "/")}
                </text>
                <text x={point.x} y={Math.max(13, point.y - 11)} textAnchor="middle" className="fill-slate-700 text-[11px] font-bold">
                  {Number(point.amount).toLocaleString("en-KE")}
                </text>
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">Collection activity will appear here.</div>
      )}
    </Card>
  );
}

function RevenueChannelChart({ channels, breakdowns }: { channels: Record<string, number>; breakdowns: Record<string, Record<string, number>> }) {
  const rows = Object.entries(channels).sort((a, b) => Number(b[1]) - Number(a[1]));
  const max = Math.max(1, ...rows.map(([, value]) => Number(value)));
  return (
    <Card title="Revenue by channel">
      <div className="mb-5">
        <div className="text-sm text-slate-500">Collection source comparison</div>
        <div className="mt-1 text-xl font-bold text-slate-900">{rows.length} active channel{rows.length === 1 ? "" : "s"}</div>
      </div>
      {rows.length ? (
        <div className="space-y-5">
          {rows.map(([channel, total], index) => (
            <div key={channel}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-semibold text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${index % 2 ? "bg-sky-500" : "bg-emerald-500"}`} />{channel}</span>
                <span className="font-bold text-slate-900">{money(total)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full transition-all duration-700 ${index % 2 ? "bg-gradient-to-r from-sky-600 to-cyan-400" : "bg-gradient-to-r from-emerald-600 to-teal-400"}`} style={{ width: `${Math.max(5, (Number(total) / max) * 100)}%` }} />
              </div>
              <div className="mt-1 text-right text-xs text-slate-400">{((Number(total) / Math.max(1, rows.reduce((sum, [, value]) => sum + Number(value), 0))) * 100).toFixed(1)}%</div>
              {breakdowns[channel] && (
                <div className="mt-2 space-y-1.5 border-l-2 border-emerald-100 pl-3">
                  {Object.entries(breakdowns[channel])
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .map(([source, amount]) => (
                      <div key={source} className="flex items-center justify-between gap-3 text-xs text-slate-500">
                        <span>{source}</span>
                        <span className="font-semibold text-slate-700">{money(amount)} · {((Number(amount) / Math.max(1, Number(total))) * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">Channel revenue will appear here.</div>
      )}
    </Card>
  );
}

export function RevenueDashboard() {
  const [data, setData] = useState<Row>();
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .paymentDashboard()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Page
      title="Payment and revenue dashboard"
      subtitle="Collections, allocations, receipt cancellations and reconciliation"
      actions={
        <>
          <LinkButton to="/payments/mpesa" tone="green">
            Send M-Pesa prompt
          </LinkButton>
          <LinkButton to="/payments/record">Record payment</LinkButton>
          <LinkButton to="/payments/unmatched">Unmatched payments</LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total collections" value={money(data?.total)} />
        <Kpi label="Payments" value={data?.payments ?? 0} />
        <Kpi label="Unmatched payments" value={data?.unmatched ?? 0} />
        <Kpi label="Pending receipt cancellations" value={data?.pendingReversals ?? 0} />
        {Object.entries(data?.channels ?? {}).map(([channel, total]) => (
          <Kpi key={channel} label={channel} value={money(total)} />
        ))}
        <Kpi label="Receipts issued" value={data?.receipts ?? 0} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <CollectionTrendChart rows={data?.dailyCollections ?? []} />
        <RevenueChannelChart channels={data?.channels ?? {}} breakdowns={data?.channelBreakdowns ?? {}} />
      </div>
      <Card title="Recent payments" className="mt-4">
        <PaymentTable rows={data?.recent ?? []} />
      </Card>
    </Page>
  );
}
function paymentSource(payment: Row) {
  const eventTypes = new Set<string>(
    (payment.events ?? []).map((event: Row): string => String(event.eventType ?? "")),
  );
  const remarks = String(payment.remarks ?? "").toUpperCase();
  const payloadSource = String(payment.externalPayload?.source ?? "").toUpperCase();

  if ([...eventTypes].some((type) => type.startsWith("MPESA_C2B_")) || remarks.includes("C2B"))
    return { label: "C2B", className: "bg-sky-50 text-sky-700" };
  if (eventTypes.has("MPESA_STK_PAYMENT_POSTED") || remarks.includes("STK PUSH"))
    return { label: "STK Push", className: "bg-violet-50 text-violet-700" };
  if (eventTypes.has("HISTORICAL_RECEIPT_IMPORTED") || payloadSource === "MAJIWARE")
    return { label: "Imported", className: "bg-amber-50 text-amber-700" };
  if ([...eventTypes].some((type) => type.startsWith("MPESA_PAYMENT_")))
    return { label: "M-Pesa entry", className: "bg-cyan-50 text-cyan-700" };
  if (eventTypes.has("PAYMENT_POSTED") || payment.receivedBy || payment.receiver)
    return { label: "Manual", className: "bg-slate-100 text-slate-700" };
  return { label: "Other", className: "bg-slate-50 text-slate-500" };
}

function PaymentTable({ rows, loading = false }: { rows: Row[]; loading?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[850px]">
        <thead>
          <tr className="bg-slate-50/80">
            <th className={TH}>Reference</th>
            <th className={TH}>Customer</th>
            <th className={TH}>Channel</th>
            <th className={TH}>Source</th>
            <th className={TH}>Date</th>
            <th className={TH}>Amount</th>
            <th className={TH}>Allocation</th>
            <th className={TH}>Status</th>
            <th className={TH}>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={9} className="p-14 text-center">
                <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-sky-100 border-t-aqua-700" />
                <div className="mt-3 text-sm font-semibold text-slate-600">Loading payment register…</div>
                <div className="mt-1 text-xs text-slate-400">Retrieving the latest transactions</div>
              </td>
            </tr>
          )}
          {!loading && rows.map((p) => {
            const suggested = p.suggestedAccount;
            const customer = p.account?.customer || suggested?.customer;
            const source = paymentSource(p);
            return <tr key={p.paymentId} className="border-t transition hover:bg-emerald-50/30">
              <td className={`${TD} font-semibold`}>
                {p.transactionReference}
              </td>
              <td className={TD}>
                <div className="font-semibold text-slate-800">{p.customerName ||
                  suggested?.customerName ||
                  p.payerName ||
                  (p.account ? "Linked account" : "Unmatched")}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {p.account?.accountNumber || suggested?.accountNumber || p.customerReference}
                </div>
                {suggested && !p.accountId && <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Suggested match</span>
                  <div>Customer: {customer?.customerNumber || "—"}</div>
                  <div>Phone: {customer?.phoneNumber || "—"}</div>
                </div>}
              </td>
              <td className={TD}>{p.channel?.channelName}</td>
              <td className={TD}>
                <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${source.className}`}>
                  {source.label}
                </span>
              </td>
              <td className={TD}>{dateTime(p.paymentDate)}</td>
              <td className={`${TD} font-semibold`}>{money(p.amount)}</td>
              <td className={TD}>
                <Badge
                  value={
                    p.paymentStatus === "REVERSED"
                      ? "REVERSED"
                      : p.matchingStatus === "PARTIALLY_MATCHED"
                        ? "MATCHED"
                        : p.matchingStatus
                  }
                />
              </td>
              <td className={TD}>
                <Badge value={p.paymentStatus} />
              </td>
              <td className={TD}>
                {p.receipt ? (
                  <Link
                    className="inline-flex rounded-lg bg-sky-50 px-2.5 py-1.5 text-sm font-bold text-sky-700 transition hover:bg-sky-600 hover:text-white"
                    to={`/payments/receipts/${p.receipt.receiptId}`}
                  >
                    View
                  </Link>
                ) : p.matchingStatus === "UNMATCHED" && p.paymentStatus === "RECEIVED" ? (
                  <Link
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm font-bold text-amber-700 transition hover:bg-amber-500 hover:text-white"
                    to={`/payments/unmatched?paymentId=${encodeURIComponent(String(p.paymentId))}`}
                  >
                    Match
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>;
          })}
          {!loading && !rows.length && (
            <tr>
              <td colSpan={9} className="p-14 text-center text-slate-400">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6"><rect x="3" y="5" width="18" height="14" rx="2" /></svg></div><div className="font-semibold text-slate-600">No payment records found</div><div className="mt-1 text-sm">Transactions will appear here when available.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentChannels() {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Row>({
    channelCode: "",
    channelName: "",
    requiresReference: true,
    autoAllocation: true,
    receiptRequired: true,
    status: "ACTIVE",
  });
  const load = () => api.listPaymentChannels().then(setRows);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const reference = String(form.transactionReference ?? "").trim();
    if (reference.length < 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9 ./_-]*[A-Za-z0-9])?$/.test(reference)) {
      setError("Payment reference must start and end with a letter or number.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.createPaymentChannel(form);
      setMessage("Payment channel saved.");
      setForm({
        channelCode: "",
        channelName: "",
        requiresReference: true,
        autoAllocation: true,
        receiptRequired: true,
        status: "ACTIVE",
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const channelInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition duration-200 placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  const activeCount = rows.filter((row) => row.status === "ACTIVE").length;
  const automaticCount = rows.filter((row) => row.autoAllocation).length;
  return (
    <Page
      title="Payment channels"
      subtitle="Configure active collection channels, settlement accounts and allocation rules"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)] lg:items-start">
        <Card title="Add payment channel" className="overflow-hidden shadow-md shadow-slate-200/50 lg:sticky lg:top-24">
          <form className="space-y-4" onSubmit={submit}>
            <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M12 15h6" /></svg></span>
              <div><div className="text-sm font-bold text-slate-800">Create a collection method</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Configure how customer payments are identified, allocated and receipted.</p></div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field label="Channel code">
                <input
                  required
                  className={channelInput}
                  placeholder="e.g. 006"
                  value={form.channelCode}
                  onChange={(e) =>
                    setForm({ ...form, channelCode: e.target.value })
                  }
                />
              </Field>
              <Field label="Channel name">
                <input
                  required
                  className={channelInput}
                  placeholder="e.g. Card"
                  value={form.channelName}
                  onChange={(e) =>
                    setForm({ ...form, channelName: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Till / paybill / account identifier">
              <input
                className={channelInput}
                placeholder="Optional settlement identifier"
                value={form.accountIdentifier ?? ""}
                onChange={(e) =>
                  setForm({ ...form, accountIdentifier: e.target.value })
                }
              />
            </Field>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-700">Channel rules</div>
              <div className="space-y-2">
              {[
                ["requiresReference", "Reference required", "Require a transaction or deposit reference"],
                ["autoAllocation", "Automatic allocation", "Apply funds to the oldest bills first"],
                ["receiptRequired", "Receipt required", "Generate a receipt after posting"],
              ].map(([key, label, description]) => (
                <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${form[key] ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 rounded-md border-slate-300 accent-emerald-600"
                    checked={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.checked })
                    }
                  />
                  <span><span className="block text-sm font-bold text-slate-700">{label}</span><span className="mt-0.5 block text-xs leading-4 text-slate-500">{description}</span></span>
                </label>
              ))}
              </div>
            </div>
            <Button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md disabled:hover:translate-y-0">
              {saving ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Saving…</> : <><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>Save payment channel</>}
            </Button>
          </form>
        </Card>
        <Card title="Channel register" className="overflow-hidden shadow-md shadow-slate-200/50">
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total channels</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{rows.length}</div></div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3.5"><div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Active</div><div className="mt-1 text-2xl font-extrabold text-emerald-700">{activeCount}</div></div>
            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3.5"><div className="text-xs font-semibold uppercase tracking-wide text-sky-700">Auto allocate</div><div className="mt-1 text-2xl font-extrabold text-sky-700">{automaticCount}</div></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-slate-50/80">
                <th className={TH}>Code</th>
                <th className={TH}>Channel</th>
                <th className={TH}>Identifier</th>
                <th className={TH}>Auto allocate</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr className="border-t transition hover:bg-emerald-50/30" key={c.channelId}>
                  <td className={TD}><span className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold text-slate-600">{c.channelCode}</span></td>
                  <td className={TD}><span className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg></span><span className="font-bold text-slate-800">{c.channelName}</span></span></td>
                  <td className={TD}>{c.accountIdentifier || "—"}</td>
                  <td className={TD}><span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${c.autoAllocation ? "text-emerald-700" : "text-slate-400"}`}><span className={`h-2 w-2 rounded-full ${c.autoAllocation ? "bg-emerald-500" : "bg-slate-300"}`} />{c.autoAllocation ? "Enabled" : "Disabled"}</span></td>
                  <td className={TD}>
                    <Badge value={c.status} />
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="px-4 py-16 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6"><rect x="3" y="5" width="18" height="14" rx="2" /></svg></div><div className="mt-3 font-semibold text-slate-600">No payment channels yet</div><div className="mt-1 text-sm text-slate-400">Create the first channel using the form.</div></td></tr>}
            </tbody>
          </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function RecordPayment() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Row[]>([]),
    [channels, setChannels] = useState<Row[]>([]),
    [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Row>({
    accountId: "",
    channelId: "",
    transactionReference: `PAY-${Date.now()}`,
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 16),
    paymentType: "BILL_PAYMENT",
    autoAllocate: true,
    remarks: "",
  });
  useEffect(() => {
    Promise.all([api.listPaymentAccounts(), api.listPaymentChannels()])
      .then(([a, c]) => {
        setAccounts(a);
        setChannels(c.filter((x: Row) => x.status === "ACTIVE"));
      })
      .catch((e) => setError(e.message));
  }, []);
  const account = accounts.find((a) => String(a.accountId) === form.accountId);
  const selectedChannel = channels.find((channel) => String(channel.channelId) === form.channelId);
  const amount = Number(form.amount || 0);
  const transactionReference = String(form.transactionReference ?? "").trim();
  const transactionReferenceValid =
    transactionReference.length >= 2 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9 ./_-]*[A-Za-z0-9])?$/.test(transactionReference);
  const projectedBalance = account ? Number(account.currentBalance ?? 0) - amount : 0;
  const paymentInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition duration-200 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api.recordPayment({
        ...form,
        amount: Number(form.amount),
      });
      navigate(`/payments/receipts/${result.receiptId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title="Record customer payment"
      subtitle=""
    >
      {error && <Notice>{error}</Notice>}
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)] lg:items-start">
      <form onSubmit={submit} className="space-y-5">
      <Card title="1. Account and channel" className="overflow-hidden shadow-md shadow-slate-200/50">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2" /></svg>
            </span>
            <div><div className="font-bold text-slate-800">Enter the received payment</div><p className="mt-0.5 text-sm leading-5 text-slate-500">The transaction will be posted and a receipt generated immediately.</p></div>
          </div>
          <Field label="Customer account">
            <SearchableSelect
              required
              className={paymentInput}
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            >
              <option value="">Select customer account</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountNumber} · {a.customerName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field label="Payment channel">
            <SearchableSelect
              required
              className={paymentInput}
              value={form.channelId}
              onChange={(e) => setForm({ ...form, channelId: e.target.value })}
            >
              <option value="">Select channel</option>
              {channels.map((c) => (
                <option key={c.channelId} value={c.channelId}>
                  {c.channelName}
                </option>
              ))}
            </SearchableSelect>
          </Field>
        </div>
      </Card>
      <Card title="2. Transaction details" className="overflow-hidden shadow-md shadow-slate-200/50">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Payment reference">
            <input
              required
              className={paymentInput}
              value={form.transactionReference}
              maxLength={100}
              onChange={(e) =>
                setForm({ ...form, transactionReference: e.target.value })
              }
            />
            {transactionReference && !transactionReferenceValid && (
              <p className="mt-1.5 text-xs font-semibold text-red-600">
                Enter a valid reference beginning and ending with a letter or number.
              </p>
            )}
          </Field>
          <Field label="Amount paid (KSh)">
            <div className="relative"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">KSh</span><input
              required
              min="0.01"
              step="0.01"
              type="number"
              className={`${paymentInput} pl-12`}
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            /></div>
          </Field>
          <Field label="Payment date and time">
            <DateTimeInput
              required
              className={paymentInput}
              value={form.paymentDate}
              onChange={(e) =>
                setForm({ ...form, paymentDate: e.target.value })
              }
            />
          </Field>
          <Field label="Payment type">
            <SearchableSelect
              className={paymentInput}
              value={form.paymentType}
              onChange={(e) =>
                setForm({ ...form, paymentType: e.target.value })
              }
            >
              <option>BILL_PAYMENT</option>
              <option>ADVANCE_PAYMENT</option>
              <option>DEPOSIT</option>
            </SearchableSelect>
          </Field>
          <div className="md:col-span-2">
          <Field label="Remarks (optional)">
            <textarea
              rows={3}
              className={`${paymentInput} resize-none`}
              placeholder="Add a note about this payment"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </Field>
          </div>
          <label className="md:col-span-2 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 transition hover:border-emerald-200 hover:bg-emerald-50/40">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 rounded-md border-slate-300 accent-emerald-600"
              checked={form.autoAllocate}
              onChange={(e) =>
                setForm({ ...form, autoAllocate: e.target.checked })
              }
            />
            <span><span className="block text-sm font-bold text-slate-700">Allocate automatically</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Apply this payment to the customer’s oldest outstanding bills first.</span></span>
          </label>
          <Button disabled={saving || !transactionReferenceValid} className="md:col-span-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md disabled:hover:translate-y-0">
            {saving ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Saving payment…</> : <><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M5 12l4 4L19 6" /></svg>Save payment and generate receipt</>}
          </Button>
        </div>
      </Card>
      </form>
      <div className="space-y-5 lg:sticky lg:top-24">
        <Card title="Payment summary" className="overflow-hidden shadow-md shadow-slate-200/50">
          <div className="rounded-xl bg-slate-900 p-4 text-white">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Amount received</div>
            <div className="mt-2 text-3xl font-extrabold">{money(amount)}</div>
            <div className="mt-2 text-xs text-slate-400">{selectedChannel?.channelName ?? "No channel selected"}</div>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><span className="text-slate-500">Account</span><span className="text-right font-semibold text-slate-800">{account?.accountNumber ?? "Not selected"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-slate-500">Customer</span><span className="text-right font-semibold text-slate-800">{account?.customerName ?? "—"}</span></div>
            <div className="border-t border-slate-100 pt-3"><div className="flex justify-between gap-4"><span className="text-slate-500">Current balance</span><span className="font-bold text-rose-600">{account ? money(account.currentBalance) : "—"}</span></div></div>
            <div className="flex justify-between gap-4"><span className="text-slate-500">Balance after payment</span><span className="font-bold text-emerald-700">{account ? money(projectedBalance) : "—"}</span></div>
          </div>
        </Card>
        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-sm text-sky-800 shadow-sm">
          <div className="flex gap-3"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 h-5 w-5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg><div><div className="font-bold">Receipt created automatically</div><p className="mt-1 text-xs leading-5 text-sky-700">After saving, you’ll be taken directly to the printable payment receipt.</p></div></div>
        </div>
      </div>
      </div>
    </Page>
  );
}

export function MpesaStkPush() {
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [config, setConfig] = useState<Row>();
  const [history, setHistory] = useState<Row[]>([]);
  const [active, setActive] = useState<Row>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 5;
  const [form, setForm] = useState<Row>({
    accountId: "",
    phoneNumber: "",
    amount: "",
  });

  const loadHistory = () => api.listMpesaStkRequests().then(setHistory);
  useEffect(() => {
    Promise.all([
      api.listPaymentAccounts(),
      api.getMpesaConfig(),
      api.listMpesaStkRequests(),
    ])
      .then(([accountRows, mpesaConfig, requests]) => {
        setAccounts(accountRows);
        setConfig(mpesaConfig);
        setHistory(requests);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const query = accountSearch.trim();
    if (!query) return;
    let activeRequest = true;
    const timer = window.setTimeout(() => {
      api
        .listPaymentAccounts(query)
        .then((rows) => {
          if (activeRequest) setAccounts(rows);
        })
        .catch((e) => {
          if (activeRequest) setError(e.message);
        });
    }, 250);
    return () => {
      activeRequest = false;
      window.clearTimeout(timer);
    };
  }, [accountSearch]);
  useEffect(() => {
    if (!active || active.status !== "PENDING") return;
    const timer = window.setInterval(() => {
      api
        .getMpesaStkRequest(String(active.stkRequestId))
        .then((row) => {
          setActive(row);
          if (row.status !== "PENDING") {
            setMessage(
              row.status === "COMPLETED"
                ? "Payment confirmed, allocated and receipted."
                : row.resultDescription ||
                    `M-Pesa request ${pretty(row.status)}.`,
            );
            loadHistory().catch(() => undefined);
          }
        })
        .catch((e) => setError(e.message));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [active?.stkRequestId, active?.status]);

  const selectedAccount = accounts.find(
    (row) => String(row.accountId) === String(form.accountId),
  );
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter((row) =>
      [
        row.account?.accountNumber,
        row.account?.customerName,
        row.phoneNumber,
        row.amount,
        row.status,
        row.mpesaReceiptNumber,
        row.payment?.receipt?.receiptNumber,
      ].some((value) => String(value ?? "").toLowerCase().includes(query)),
    );
  }, [history, historySearch]);
  const historyPages = Math.max(
    1,
    Math.ceil(filteredHistory.length / historyPageSize),
  );
  const pagedHistory = filteredHistory.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );
  const historySummary = useMemo(
    () => ({
      completed: history.filter((row) => row.status === "COMPLETED").length,
      pending: history.filter((row) => row.status === "PENDING").length,
      unsuccessful: history.filter((row) =>
        ["FAILED", "CANCELLED", "TIMED_OUT"].includes(row.status),
      ).length,
    }),
    [history],
  );
  useEffect(() => setHistoryPage(1), [historySearch]);
  useEffect(() => {
    if (historyPage > historyPages) setHistoryPage(historyPages);
  }, [historyPage, historyPages]);
  function selectAccount(accountId: string) {
    const account = accounts.find((row) => String(row.accountId) === accountId);
    const balance = Math.max(
      0,
      Math.ceil(Number(account?.currentBalance ?? 0)),
    );
    setForm({
      accountId,
      phoneNumber: account?.customer?.phoneNumber ?? "",
      amount: balance || "",
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSending(true);
    try {
      const row = await api.initiateMpesaStk({
        accountId: form.accountId,
        phoneNumber: form.phoneNumber,
        amount: Number(form.amount),
      });
      setActive(row);
      setMessage(
        "Prompt sent. Ask the customer to enter their M-Pesa PIN on the phone.",
      );
      await loadHistory();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <Page
      title="M-Pesa Express payment"
      subtitle=""
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      {config && !config.configured && (
        <Notice>
          {config.error || "M-Pesa is not configured on the server."}
        </Notice>
      )}
      <div className="relative mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-emerald-50/60 px-5 py-5 text-slate-800 shadow-sm sm:px-6">
        <div className="absolute -right-12 -top-20 h-52 w-52 rounded-full bg-emerald-100/40" />
        <div className="absolute -bottom-20 right-32 h-40 w-40 rounded-full bg-slate-100/50" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7">
                <rect x="6" y="2" width="12" height="20" rx="3" />
                <path d="M9 6h6M10 18h4" />
                <path d="m9.5 12 1.7 1.7 3.5-3.7" />
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold">Fast, secure M-Pesa collection</div>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
                Send a prompt, follow its live status, and issue a receipt automatically after confirmation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${config?.configured ? "bg-lime-300 shadow-[0_0_0_4px_rgba(190,242,100,0.18)]" : "bg-amber-300"}`} />
            {pretty(config?.environment ?? "Checking")} {config?.configured ? "connected" : "configuration"}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[460px_1fr]">
        <Card title="Send payment prompt">
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Customer account">
              <SearchableSelect
                required
                className={INPUT}
                value={form.accountId}
                onChange={(e) => selectAccount(e.target.value)}
                onSearchQuery={setAccountSearch}
              >
                <option value="">Select customer account</option>
                {accounts.map((a) => (
                  <option value={a.accountId} key={a.accountId}>
                    {a.accountNumber} · {a.customerName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            {selectedAccount && (
              <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-sky-50 p-3 text-sm text-blue-800 shadow-sm">
                <div>
                  Customer: <strong>{selectedAccount.customerName}</strong>
                </div>
                <div>
                  Outstanding account balance:{" "}
                  <strong>{money(selectedAccount.currentBalance)}</strong>
                </div>
              </div>
            )}
            <Field label="Safaricom phone number (uses customer phone)">
              <input
                className={INPUT}
                placeholder="Loaded automatically from the customer"
                value={form.phoneNumber}
                onChange={(e) =>
                  setForm({ ...form, phoneNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Amount (whole KSh)">
              <input
                required
                type="number"
                min="1"
                max="250000"
                step="1"
                className={INPUT}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
            <div className="flex gap-2.5 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 h-4 w-4 flex-none text-emerald-600">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <div>
              Environment:{" "}
              <strong>{pretty(config?.environment ?? "checking")}</strong>
              {config?.shortCode && (
                <>
                  {" "}
                  · Shortcode: <strong>{config.shortCode}</strong>
                </>
              )}
              <br />A payment is posted only after Daraja returns a successful
              callback matching the original checkout request. Do not collect or
              enter the customer's M-Pesa PIN here.
              </div>
            </div>
            <Button
              tone="green"
              className="w-full"
              disabled={sending || !config?.configured}
            >
              <span className="inline-flex items-center justify-center gap-2">
                {sending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" aria-hidden="true" />
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4Z" />
                  </svg>
                )}
                {sending ? "Sending prompt..." : "Send M-Pesa prompt"}
              </span>
            </Button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title="Current request">
            {active ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
                  <div>
                    <div className="text-sm text-slate-500">
                      Checkout request
                    </div>
                    <strong className="break-all">
                      {active.checkoutRequestId}
                    </strong>
                  </div>
                  <Badge value={active.status} />
                </div>
                {active.status === "PENDING" && (
                  <div
                    className="flex items-center gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800"
                    role="status"
                    aria-live="polite"
                  >
                    <span
                      className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-sky-200 border-t-sky-600"
                      aria-hidden="true"
                    />
                    <div>
                      <strong className="block">Waiting for M-Pesa confirmation</strong>
                      <span className="text-sky-700">
                        Ask the customer to complete the prompt on their phone.
                      </span>
                    </div>
                  </div>
                )}
                {active.status === "COMPLETED" && (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-emerald-600 text-white">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4"><path d="m5 12 4 4L19 6" /></svg>
                    </span>
                    <div><strong className="block">Payment confirmed</strong><span className="text-emerald-700">The transaction has been posted and receipted.</span></div>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="text-sm text-slate-500">Phone</div>
                    <strong>{active.phoneNumber}</strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="text-sm text-slate-500">Amount</div>
                    <strong>{money(active.amount)}</strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="text-sm text-slate-500">M-Pesa receipt</div>
                    <strong>{active.mpesaReceiptNumber || "Pending"}</strong>
                  </div>
                </div>
                {active.resultDescription && (
                  <div className="text-sm text-slate-600">
                    {active.resultDescription}
                  </div>
                )}
                {active.payment?.receipt && (
                  <LinkButton
                    to={`/payments/receipts/${active.payment.receipt.receiptId}`}
                    tone="green"
                  >
                    View payment receipt
                  </LinkButton>
                )}
              </div>
            ) : sending ? (
              <div
                className="flex min-h-28 items-center justify-center gap-3 text-slate-500"
                role="status"
                aria-live="polite"
              >
                <span
                  className="h-6 w-6 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700"
                  aria-hidden="true"
                />
                Sending M-Pesa prompt…
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400">
                Send a prompt to track it here.
              </div>
            )}
          </Card>
          <Card title="Recent STK requests">
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2"><div className="text-xs font-medium text-emerald-700">Completed</div><div className="text-lg font-bold text-emerald-900">{historySummary.completed}</div></div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2"><div className="text-xs font-medium text-amber-700">Pending</div><div className="text-lg font-bold text-amber-900">{historySummary.pending}</div></div>
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2"><div className="text-xs font-medium text-rose-700">Unsuccessful</div><div className="text-lg font-bold text-rose-900">{historySummary.unsuccessful}</div></div>
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <label className="relative min-w-[240px] flex-1 sm:max-w-md">
                <span className="sr-only">Search STK requests</span>
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
                  className={`${INPUT} pl-9`}
                  placeholder="Search account, phone, status or receipt"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
              </label>
              <div className="text-sm text-slate-500">
                {filteredHistory.length} request{filteredHistory.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Account</th>
                    <th className={TH}>Phone</th>
                    <th className={TH}>Amount</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedHistory.map((row) => (
                    <tr className="border-t transition-colors hover:bg-slate-50/80" key={row.stkRequestId}>
                      <td className={TD}>{dateTime(row.createdAt)}</td>
                      <td className={TD}>{row.account?.accountNumber}</td>
                      <td className={TD}>{row.phoneNumber}</td>
                      <td className={TD}>{money(row.amount)}</td>
                      <td className={TD}>
                        <Badge value={row.status} />
                      </td>
                      <td className={TD}>
                        {row.payment?.receipt ? (
                          <Link
                            className="inline-flex items-center gap-1.5 font-semibold text-aqua-700 hover:text-aqua-900"
                            to={`/payments/receipts/${row.payment.receipt.receiptId}`}
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-4 w-4"
                            >
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                            View
                          </Link>
                        ) : (
                          row.mpesaReceiptNumber || "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {!pagedHistory.length && (
                    <tr>
                      <td
                        className="p-8 text-center text-slate-400"
                        colSpan={6}
                      >
                        {historySearch
                          ? "No STK requests match your search."
                          : "No STK Push requests yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="text-sm text-slate-500">
                {filteredHistory.length
                  ? `Showing ${(historyPage - 1) * historyPageSize + 1}–${Math.min(historyPage * historyPageSize, filteredHistory.length)} of ${filteredHistory.length}`
                  : "Showing 0 results"}
              </div>
              <nav className="flex items-center gap-2" aria-label="STK request pagination">
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  Previous
                </button>
                <span className="min-w-20 text-center text-sm font-medium text-slate-600">
                  Page {historyPage} of {historyPages}
                </span>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={historyPage === historyPages}
                  onClick={() => setHistoryPage((page) => Math.min(historyPages, page + 1))}
                >
                  Next
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </nav>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

export function PaymentRegister() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(searchParams.get("status") ?? ""),
    [channelId, setChannelId] = useState(searchParams.get("channelId") ?? ""),
    [zoneId, setZoneId] = useState(searchParams.get("zoneId") ?? ""),
    [from, setFrom] = useState(searchParams.get("from") ?? ""),
    [to, setTo] = useState(searchParams.get("to") ?? ""),
    [channels, setChannels] = useState<Row[]>([]),
    [zones, setZones] = useState<Row[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [showImport, setShowImport] = useState(false),
    [importRows, setImportRows] = useState<Record<string, unknown>[]>([]),
    [importErrors, setImportErrors] = useState<string[]>([]),
    [importing, setImporting] = useState(false),
    [importMessage, setImportMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const pageSize = 50;
  useEffect(() => {
    setLoading(true);
    setLoadError("");
    api
      .listPayments({
        search,
        status,
        channelId,
        zoneId,
        from,
        to,
        page: String(page),
        pageSize: String(pageSize),
      })
      .then((result) => {
        setRows(result.items);
        setTotal(Number(result.total));
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Unable to load payments."))
      .finally(() => setLoading(false));
  }, [search, status, channelId, zoneId, from, to, page]);
  useEffect(() => {
    Promise.all([api.listPaymentChannels(), api.listZones()]).then(([paymentChannels, zoneItems]) => {
      setChannels(paymentChannels);
      setZones(zoneItems);
    });
  }, []);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  async function selectReceiptFile(file?: File) {
    if (!file) return;
    setImportMessage("");
    try {
      const source = await parseMeterWorkbook(file, [
        "accountNumber",
        "transactionReference",
        "amount",
        "paymentDate",
      ]);
      const errors: string[] = [];
      const references = new Set<string>();
      const normalized = source.map((row, index) => {
        const accountNumber = importCell(row, "accountNumber");
        const transactionReference = importCell(row, "transactionReference");
        const originalReference = importCell(row, "originalReference") || transactionReference;
        const amount = Number(importCell(row, "amount"));
        const paymentDate = importCell(row, "paymentDate");
        if (!accountNumber) errors.push(`Row ${index + 2}: accountNumber is required.`);
        if (!transactionReference) errors.push(`Row ${index + 2}: transactionReference is required.`);
        if (references.has(transactionReference)) errors.push(`Row ${index + 2}: reference ${transactionReference} is duplicated.`);
        references.add(transactionReference);
        if (!Number.isFinite(amount) || amount <= 0) errors.push(`Row ${index + 2}: amount must be greater than zero.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) errors.push(`Row ${index + 2}: paymentDate must use YYYY-MM-DD.`);
        return { accountNumber, transactionReference, originalReference, amount, paymentDate };
      });
      if (!normalized.length) errors.push("The selected workbook has no receipt rows.");
      setImportRows(normalized);
      setImportErrors(errors);
    } catch (error) {
      setImportRows([]);
      setImportErrors([error instanceof Error ? error.message : "The receipt workbook could not be read."]);
    }
  }
  async function importReceipts() {
    if (!importRows.length || importErrors.length) return;
    setImporting(true);
    setImportMessage("");
    try {
      const accounts = await api.listAccounts("", 20_000);
      const known = new Set(accounts.map((account: Row) => account.accountNumber));
      const missing = [...new Set(importRows.map((row) => String(row.accountNumber)).filter((number) => !known.has(number)))];
      if (missing.length) throw new Error(`${missing.length} account(s) were not found: ${missing.slice(0, 50).join(", ")}`);
      let imported = 0, skipped = 0;
      for (let offset = 0; offset < importRows.length; offset += 100) {
        const result = await api.importHistoricalReceipts(importRows.slice(offset, offset + 100));
        imported += Number(result.imported ?? 0);
        skipped += Number(result.skipped ?? 0);
      }
      setImportMessage(`${imported.toLocaleString()} historical receipts imported${skipped ? `; ${skipped.toLocaleString()} duplicates safely skipped` : ""}.`);
      setImportRows([]);
      setPage(1);
      setSearch("");
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Historical receipts could not be imported."]);
    } finally {
      setImporting(false);
    }
  }
  const pagination = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 bg-slate-50/70 px-4 py-3">
      <span className="text-sm text-slate-500">
        Page <strong className="text-slate-700">{page}</strong> of{" "}
        <strong className="text-slate-700">{pages}</strong> ·{" "}
        {total.toLocaleString()} record{total === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        <Button
          tone="slate"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Previous
        </Button>
        <Button
          tone="slate"
          disabled={page >= pages}
          onClick={() => setPage((current) => Math.min(pages, current + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
  return (
    <Page
      title="Payment register"
      subtitle="Search all valid, unmatched and reversed payment transactions"
      actions={<div className="flex gap-2"><Button tone="blue" onClick={() => setShowImport((value) => !value)}>{showImport ? "Close import" : "Import receipts"}</Button><Button tone="slate" onClick={() => exportExcel("payment-register.xlsx", "Payments", rows)}>Export register</Button></div>}
    >
      {loadError && <Notice>{loadError}</Notice>}
      {showImport && <Card title="Import historical receipts" className="mb-4">
        <p className="mb-3 text-sm text-slate-500">Imports posted MajiWare receipts against existing accounts. Duplicate references are safely skipped and each new receipt reduces the account balance once.</p>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><Field label="Receipt Excel or CSV file"><input type="file" accept=".xlsx,.csv" className={INPUT} onChange={(event) => void selectReceiptFile(event.target.files?.[0])} /></Field><Button tone="green" disabled={!importRows.length || importErrors.length > 0 || importing} onClick={() => void importReceipts()}>{importing ? "Importing..." : `Import ${importRows.length || ""} receipts`}</Button></div>
        {importRows.length > 0 && !importErrors.length && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{importRows.length.toLocaleString()} receipts ready. Total: {money(importRows.reduce((sum, row) => sum + Number(row.amount), 0))}</p>}
        {importErrors.length > 0 && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{importErrors.slice(0, 20).map((error) => <div key={error}>{error}</div>)}</div>}
        {importMessage && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{importMessage}</p>}
      </Card>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Status">
            <SearchableSelect
              className={INPUT}
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="">All statuses</option>
              <option>RECEIVED</option>
              <option>POSTED</option>
              <option>REVERSED</option>
            </SearchableSelect>
          </Field>
          <Field label="Payment channel">
            <SearchableSelect className={INPUT} value={channelId} onChange={(e) => { setPage(1); setChannelId(e.target.value); }}>
              <option value="">All channels</option>
              {channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>{channel.channelName}</option>)}
            </SearchableSelect>
          </Field>
          <Field label="Zone">
            <SearchableSelect className={INPUT} value={zoneId} onChange={(e) => { setPage(1); setZoneId(e.target.value); }}>
              <option value="">All zones</option>
              {zones.map((zone) => <option key={zone.zoneId} value={zone.zoneId}>{zone.zoneName}</option>)}
            </SearchableSelect>
          </Field>
          <Field label="From">
            <DateInput className={INPUT} value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} />
          </Field>
          <Field label="To">
            <DateInput className={INPUT} value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} />
          </Field>
          <Field label="Search">
            <input
              className={INPUT}
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Reference, customer or phone"
            />
          </Field>
        </div>
      </Card>
      <Card title={`${total.toLocaleString()} payment(s)`}>
        {pagination}
        <PaymentTable rows={rows} loading={loading} />
        {pages > 1 && pagination}
      </Card>
    </Page>
  );
}

export function UnmatchedPayments() {
  const [unmatchedSearchParams] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]),
    [accounts, setAccounts] = useState<Row[]>([]),
    [focus, setFocus] = useState<Row>(),
    [allocationRows, setAllocationRows] = useState<Array<{ accountId: string; amount: string }>>([]),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [availableAccountCount, setAvailableAccountCount] = useState(0);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const load = () => {
    setLoading(true);
    setPaymentsLoaded(false);
    setError("");
    return Promise.allSettled([
      api.listUnmatchedPayments(),
      api.paymentAccountCount(),
    ]).then(([paymentsResult, accountsResult]) => {
      const failures: string[] = [];
      if (paymentsResult.status === "fulfilled") {
        setRows(paymentsResult.value);
        setPaymentsLoaded(true);
      } else {
        failures.push(`Could not load unmatched payments: ${paymentsResult.reason?.message ?? "Request failed"}`);
      }
      if (accountsResult.status === "fulfilled") {
        setAvailableAccountCount(Number(accountsResult.value.count ?? 0));
      } else {
        failures.push(`Could not count active customer accounts: ${accountsResult.reason?.message ?? "Request failed"}`);
      }
      setError(failures.join(" "));
    }).finally(() => setLoading(false));
  };
  async function selectPayment(payment: Row) {
    setFocus(payment);
    setAllocationRows([{ accountId: payment.suggestedAccount?.accountId ? String(payment.suggestedAccount.accountId) : "", amount: Number(payment.amount).toFixed(2) }]);
    setReason("");
    if (accounts.length || accountsLoading) return;
    setAccountsLoading(true);
    try {
      setAccounts(await api.listPaymentAccounts());
    } catch (e: any) {
      setError(`Could not load customer accounts for allocation: ${e.message}`);
    } finally {
      setAccountsLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (loading || focus) return;
    const requestedPaymentId = unmatchedSearchParams.get("paymentId");
    if (!requestedPaymentId) return;
    const payment = rows.find((row) => String(row.paymentId) === requestedPaymentId);
    if (!payment) return;
    void selectPayment(payment);
  }, [focus, loading, rows, unmatchedSearchParams]);
  async function allocate() {
    if (!focus) return;
    setAllocating(true);
    setError("");
    setMessage("");
    try {
      await api.allocatePayment(String(focus.paymentId), allocationRows.map((row) => ({ accountId: row.accountId, amount: Number(row.amount) })), reason);
      setMessage(allocationRows.length > 1 ? `Payment split across ${allocationRows.length} accounts and receipts generated.` : "Payment allocated and receipt generated.");
      setFocus(undefined);
      setAllocationRows([]);
      setReason("");
      await load();
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAllocating(false);
    }
  }
  const filteredRows = rows.filter((payment) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const suggested = payment.suggestedAccount;
    return [payment.transactionReference, payment.payerName, payment.payerPhone, payment.customerReference, payment.channel?.channelName,
      suggested?.accountNumber, suggested?.customerName, suggested?.customer?.customerNumber, suggested?.customer?.phoneNumber]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const unmatchedTotal = rows.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const paymentCents = Math.round(Number(focus?.amount ?? 0) * 100);
  const allocatedCents = allocationRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.amount)) ? Math.round(Number(row.amount) * 100) : 0), 0);
  const remainingCents = paymentCents - allocatedCents;
  const selectedAccountIds = allocationRows.map((row) => row.accountId).filter(Boolean);
  const hasDuplicateAccounts = new Set(selectedAccountIds).size !== selectedAccountIds.length;
  const allocationIsValid = allocationRows.length > 0 && allocationRows.every((row) => row.accountId && Number(row.amount) > 0) && !hasDuplicateAccounts && remainingCents === 0;
  const allocationInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition duration-200 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  return (
    <Page
      title="Unmatched payment allocation"
      subtitle="Link unresolved mobile and bank transactions to valid customer accounts"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-amber-700">Unmatched payments</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{rows.length}</div></div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-rose-700">Value awaiting allocation</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{money(unmatchedTotal)}</div></div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-sky-700">Available accounts</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{availableAccountCount.toLocaleString()}</div></div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_480px] xl:items-start">
        <Card title="Payments awaiting reconciliation" className="overflow-hidden shadow-md shadow-slate-200/50">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-semibold text-slate-800">Select a transaction to allocate</div><div className="mt-0.5 text-xs text-slate-500">Match unresolved deposits to the correct customer account.</div></div>
            <div className="relative sm:w-72"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input className={`${allocationInput} pl-10`} placeholder="Search payments" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 [scrollbar-gutter:stable]">
            <table className="w-full min-w-[920px] table-fixed">
              <thead><tr className="bg-slate-50/80"><th className={`${TH} w-[14%]`}>Reference</th><th className={`${TH} w-[15%]`}>Safaricom payer</th><th className={`${TH} w-[29%]`}>Suggested customer</th><th className={`${TH} w-[19%]`}>Payment details</th><th className={`${TH} w-[12%]`}>Amount</th><th className={`${TH} w-[11%]`}>Action</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-4 py-16 text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-sky-100 border-t-aqua-700" /><div className="mt-3 text-sm font-semibold text-slate-600">Loading unmatched payments…</div><div className="mt-1 text-xs text-slate-400">Checking transactions and customer accounts</div></td></tr>}
                {!loading && filteredRows.map((payment) => {
                  const selected = String(focus?.paymentId) === String(payment.paymentId);
                  return <tr key={payment.paymentId} className={`border-t transition ${selected ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200" : "hover:bg-slate-50"}`}>
                    <td className={TD}><div className="font-bold text-slate-800">{payment.transactionReference}</div><div className="mt-0.5 text-xs text-slate-400">{payment.customerReference || "No customer reference"}</div></td>
                    <td className={TD}><div className="font-semibold text-slate-700">{payment.payerName || "Unknown payer"}</div><div className="mt-0.5 text-xs text-slate-400">{usablePhone(payment.payerPhone) || "Phone not supplied"}</div></td>
                    <td className={TD}>{payment.suggestedAccount ? <div className="min-w-[190px]"><div className="font-bold text-slate-800">{payment.suggestedAccount.customerName}</div><div className="mt-1 text-xs text-slate-500">Account: <strong>{payment.suggestedAccount.accountNumber}</strong></div><div className="text-xs text-slate-500">Customer: {payment.suggestedAccount.customer?.customerNumber || "—"}</div><div className="text-xs text-slate-500">Phone: {payment.suggestedAccount.customer?.phoneNumber || "—"}</div><span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Verify before allocating</span></div> : <span className="text-sm text-slate-400">No account suggestion</span>}</td>
                    <td className={TD}><span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />{payment.channel?.channelName || "Unknown"}</span><div className="mt-2 break-words text-xs leading-5 text-slate-500">{dateTime(payment.paymentDate)}</div></td>
                    <td className={`${TD} font-bold text-slate-900`}>{money(payment.amount)}</td>
                    <td className={TD}><button type="button" onClick={() => void selectPayment(payment)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-bold transition hover:-translate-y-0.5 ${selected ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-emerald-600 hover:text-white"}`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0"><path d="M5 12h14M13 6l6 6-6 6" /></svg>{selected ? "Selected" : "Allocate"}</button></td>
                  </tr>;
                })}
                {!loading && paymentsLoaded && !filteredRows.length && <tr><td colSpan={6} className="px-4 py-16 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M5 12l4 4L19 6" /></svg></div><div className="mt-4 font-bold text-slate-700">{rows.length ? "No payments match your search" : "All payments are reconciled"}</div><div className="mt-1 text-sm text-slate-400">{rows.length ? "Try a different reference, payer or phone number." : "There are no unmatched transactions requiring attention."}</div></td></tr>}
                {!loading && !paymentsLoaded && <tr><td colSpan={6} className="px-4 py-16 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-500"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg></div><div className="mt-4 font-bold text-slate-700">Unmatched payments could not be loaded</div><div className="mt-1 text-sm text-slate-400">Refresh the page or try again after the server is available.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Manual allocation" className="overflow-hidden shadow-md shadow-slate-200/50 xl:sticky xl:top-24">
          {focus ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-900 p-4 text-white shadow-sm">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">Selected transaction</div>
                <strong>{focus.transactionReference}</strong>
                <div className="mt-1 text-xl font-extrabold">
                  {money(focus.amount)}{usablePhone(focus.payerPhone) ? ` · ${usablePhone(focus.payerPhone)}` : ""}
                </div>
              </div>
              {focus.suggestedAccount && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Suggested customer match</div>
                <div className="mt-2 text-base font-extrabold text-slate-900">{focus.suggestedAccount.customerName}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-600">
                  <div><span className="block text-slate-400">Account number</span><strong>{focus.suggestedAccount.accountNumber}</strong></div>
                  <div><span className="block text-slate-400">Customer number</span><strong>{focus.suggestedAccount.customer?.customerNumber || "—"}</strong></div>
                  <div className="col-span-2"><span className="block text-slate-400">Registered phone</span><strong>{focus.suggestedAccount.customer?.phoneNumber || "—"}</strong></div>
                </div>
                <p className="mt-3 text-xs leading-5 text-amber-800">Suggested from the payment account reference. Confirm these details before allocating.</p>
              </div>}
              <div className="rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-3 text-xs leading-5 text-sky-700">Allocate the full transaction to one account, or add rows to split it across multiple accounts. Each account receives its own payment and receipt.</div>
              {accountsLoading && <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs font-semibold text-slate-600"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-aqua-700" />Loading active customer accounts...</div>}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div><div className="text-sm font-semibold text-slate-700">Account allocations</div><div className="text-xs text-slate-400">Each account can be selected once.</div></div>
                  <button type="button" onClick={() => setAllocationRows((current) => [...current, { accountId: "", amount: "" }])} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">+ Add account</button>
                </div>
                <div className="space-y-3">
                  {allocationRows.map((allocation, index) => (
                    <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Allocation {index + 1}</span>{allocationRows.length > 1 && <button type="button" onClick={() => setAllocationRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-bold text-rose-600 hover:text-rose-700">Remove</button>}</div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px]">
                        <SearchableSelect className={allocationInput} value={allocation.accountId} onChange={(event) => setAllocationRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, accountId: event.target.value } : row))}>
                          <option value="">Select account</option>
                          {accounts.map((account) => <option value={account.accountId} key={account.accountId}>{account.accountNumber} · {account.customerName} · {account.customer?.customerNumber} · {account.customer?.phoneNumber}</option>)}
                        </SearchableSelect>
                        <input type="number" min="0.01" step="0.01" className={allocationInput} aria-label={`Amount for allocation ${index + 1}`} placeholder="Amount" value={allocation.amount} onChange={(event) => setAllocationRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`mt-3 flex items-center justify-between rounded-xl border px-3.5 py-3 text-sm ${remainingCents === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                  <span className="font-semibold">{remainingCents >= 0 ? "Remaining to allocate" : "Over allocated"}</span><strong>{money(Math.abs(remainingCents) / 100)}</strong>
                </div>
                {hasDuplicateAccounts && <p className="mt-2 text-xs font-semibold text-rose-600">The same customer account cannot appear more than once.</p>}
              </div>
              <Field label="Allocation reason">
                <textarea
                  rows={4}
                  className={`${allocationInput} resize-none`}
                  placeholder="Explain why this payment belongs to the selected account"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md disabled:hover:translate-y-0"
                disabled={allocating || !allocationIsValid || reason.trim().length < 5}
                onClick={allocate}
              >
                {allocating ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Allocating…</> : <><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M5 12l4 4L19 6" /></svg>{allocationRows.length > 1 ? "Split and generate receipts" : "Allocate and generate receipt"}</>}
              </Button>
            </div>
          ) : (
            <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center">
              <div><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8"><path d="M8 7h10M8 12h8M8 17h6" /><circle cx="4" cy="7" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="17" r="1" /></svg></div><div className="mt-4 font-bold text-slate-700">Select an unmatched payment</div><p className="mx-auto mt-1 max-w-xs text-sm leading-5 text-slate-400">Choose Allocate beside a transaction to review it and link it to a customer account.</p></div>
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}

export function PaymentReceipt() {
  const { id = "" } = useParams();
  const [r, setR] = useState<Row>(),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .getReceipt(id)
      .then(setR)
      .catch((e) => setError(e.message));
  }, [id]);
  function print() {
    document.body.classList.add("printing-invoice");
    window.addEventListener(
      "afterprint",
      () => document.body.classList.remove("printing-invoice"),
      { once: true },
    );
    window.print();
  }
  if (!r)
    return (
      <Page title="Payment receipt" subtitle="Receipt details">
        {error && <Notice>{error}</Notice>}
      </Page>
    );
  return (
    <Page
      className="invoice-print-page"
      title="Payment receipt"
      subtitle={r.receiptNumber}
      actions={
        <Button tone="slate" onClick={print}>
          Print / Save PDF
        </Button>
      }
    >
      <Card className="invoice-print-document mx-auto max-w-3xl">
        <div className="flex justify-between border-b pb-4">
          <img
            src="/samdamte-water-logo-print.png"
            alt="Samdamte Water Utility Management"
            className="invoice-brand-logo h-auto w-[260px] max-w-[55%] object-contain"
          />
          <div className="text-right">
            <h2 className="text-xl font-bold">PAYMENT RECEIPT</h2>
            <div>{r.receiptNumber}</div>
            <Badge value={r.receiptStatus} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 py-5">
          {[
            ["Date", date(r.issueDate)],
            ["Customer", r.customerName],
            ["Account", r.account?.accountNumber],
            ["Payment channel", r.payment.channel.channelName],
            ["Payment reference", r.payment.transactionReference],
            ["Amount paid", money(r.amount)],
            ["Received by", person(r.issuer)],
            [
              "Allocation",
              ["MATCHED", "PARTIALLY_MATCHED"].includes(r.payment.matchingStatus) &&
              Number(r.payment.unallocatedAmount) > 0
                ? `Matched · ${money(r.payment.unallocatedAmount)} account credit`
                : pretty(r.payment.matchingStatus),
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-sm text-slate-500">{label}</div>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="border-t pt-4 text-center text-sm text-slate-500">
          Thank you for your payment. This system-generated receipt is valid
          without a signature.
        </div>
      </Card>
    </Page>
  );
}

export function PaymentReversals() {
  const [payments, setPayments] = useState<Row[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Row>({
    paymentId: "",
    reversalReason: "DUPLICATE_PAYMENT",
    detailedExplanation: "",
  });
  const load = () =>
    Promise.all([
      api.listPayments({ status: "POSTED" }),
      api.listPaymentReversals(),
    ]).then(([p, r]) => {
      setPayments(p);
      setRows(r);
    });
  useEffect(() => {
    load();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      await api.requestPaymentReversal(form);
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
      setMessage("Receipt cancellation submitted for independent approval.");
      setForm({
        paymentId: "",
        reversalReason: "DUPLICATE_PAYMENT",
        detailedExplanation: "",
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }
  const selectedPayment = payments.find((payment) => String(payment.paymentId) === form.paymentId);
  const filteredRows = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    return !query || [row.reversalReference, row.payment?.transactionReference, person(row.requester), row.status]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const pendingCount = rows.filter((row) => row.status === "PENDING").length;
  const approvedCount = rows.filter((row) => row.status === "APPROVED").length;
  const rejectedCount = rows.filter((row) => row.status === "REJECTED").length;
  const reversalInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition duration-200 hover:border-slate-300 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10`;
  return (
    <Page
      title="Cancel receipts"
      subtitle="Request controlled receipt cancellation without deleting financial records"
      actions={
        <LinkButton to="/payments/reversals/approvals">
          Cancellation approval
        </LinkButton>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-amber-700">Pending approval</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{pendingCount}</div></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Approved</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{approvedCount}</div></div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-rose-700">Rejected</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{rejectedCount}</div></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start">
        <Card title="New receipt cancellation" className="overflow-hidden shadow-md shadow-slate-200/50 lg:sticky lg:top-24">
          <form className="space-y-4" onSubmit={submit}>
            <div className="flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50/70 p-3.5 text-rose-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-600 text-white shadow-sm"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M9 7H5v4M5 11a7 7 0 1 0 2-5" /></svg></span>
              <div><div className="text-sm font-bold">Controlled financial action</div><p className="mt-0.5 text-xs leading-5 text-rose-700">This request requires independent approval and preserves the original audit record.</p></div>
            </div>
            <Field label="Posted payment">
              <SearchableSelect
                required
                className={reversalInput}
                value={form.paymentId}
                onChange={(e) =>
                  setForm({ ...form, paymentId: e.target.value })
                }
              >
                <option value="">Select payment</option>
                {payments.map((p) => (
                  <option key={p.paymentId} value={p.paymentId}>
                    {p.transactionReference} · {money(p.amount)}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            {selectedPayment && <div className="rounded-xl bg-slate-900 p-4 text-white"><div className="text-xs font-bold uppercase tracking-wider text-slate-400">Selected payment</div><div className="mt-2 flex items-end justify-between gap-3"><div><div className="font-bold">{selectedPayment.transactionReference}</div><div className="mt-0.5 text-xs text-slate-400">{selectedPayment.channel?.channelName || "Payment channel"}</div></div><div className="text-xl font-extrabold">{money(selectedPayment.amount)}</div></div></div>}
            <Field label="Reason">
              <SearchableSelect
                className={reversalInput}
                value={form.reversalReason}
                onChange={(e) =>
                  setForm({ ...form, reversalReason: e.target.value })
                }
              >
                <option value="DUPLICATE_PAYMENT">Duplicate payment</option>
                <option value="WRONG_ACCOUNT">Wrong account</option>
                <option value="CHARGEBACK">Chargeback</option>
                <option value="INPUT_ERROR">Input error</option>
              </SearchableSelect>
            </Field>
            <Field label="Detailed explanation">
              <textarea
                required
                rows={4}
                minLength={10}
                className={`${reversalInput} resize-none`}
                placeholder="Explain what happened and why this payment must be reversed"
                value={form.detailedExplanation}
                onChange={(e) =>
                  setForm({ ...form, detailedExplanation: e.target.value })
                }
              />
            </Field>
            <Button disabled={submitting || form.detailedExplanation.trim().length < 10} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-md disabled:hover:translate-y-0">
              {submitting ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Submitting…</> : <><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>Submit cancellation request</>}
            </Button>
          </form>
        </Card>
        <Card title="Cancellation history" className="overflow-hidden shadow-md shadow-slate-200/50">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-semibold text-slate-800">Audit trail</div><div className="mt-0.5 text-xs text-slate-500">Track every request through independent review.</div></div>
            <div className="relative sm:w-72"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input className={`${reversalInput} pl-10 focus:border-emerald-500 focus:ring-emerald-500/10`} placeholder="Search cancellation history" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="bg-slate-50/80">
                <th className={TH}>Reference</th>
                <th className={TH}>Payment</th>
                <th className={TH}>Amount</th>
                <th className={TH}>Requester</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((x) => (
                <tr className="border-t transition hover:bg-slate-50" key={x.reversalId}>
                  <td className={TD}><span className="font-mono text-xs font-bold text-slate-700">{x.reversalReference}</span></td>
                  <td className={TD}><div className="font-bold text-slate-800">{x.payment.transactionReference}</div><div className="mt-0.5 text-xs text-slate-400">{pretty(x.reversalReason)}</div></td>
                  <td className={`${TD} font-bold text-slate-900`}>{money(x.reversalAmount)}</td>
                  <td className={TD}>{person(x.requester)}</td>
                  <td className={TD}>
                    <Badge value={x.status} />
                  </td>
                </tr>
              ))}
              {!filteredRows.length && <tr><td colSpan={5} className="px-4 py-16 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M9 7H5v4M5 11a7 7 0 1 0 2-5" /></svg></div><div className="mt-4 font-bold text-slate-700">{rows.length ? "No matching cancellation requests" : "No cancellation requests yet"}</div><div className="mt-1 text-sm text-slate-400">{rows.length ? "Try a different reference, requester or status." : "Submitted requests will appear here for tracking."}</div></td></tr>}
            </tbody>
          </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function ReversalApprovals() {
  const [rows, setRows] = useState<Row[]>([]),
    [focus, setFocus] = useState<Row>(),
    [comments, setComments] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [deciding, setDeciding] = useState(false);
  const load = () =>
    api.listPaymentReversals("PENDING").then((r) => {
      setRows(r);
      setFocus(r[0]);
    });
  useEffect(() => {
    load();
  }, []);
  async function decide(decision: "APPROVE" | "REJECT") {
    if (!focus || comments.length < 3) return;
    setDeciding(true);
    setError("");
    try {
      await api.decidePaymentReversal(
        String(focus.reversalId),
        decision,
        comments,
      );
      window.dispatchEvent(new Event("sidebar-counts:refresh"));
      setMessage(`Receipt cancellation ${decision.toLowerCase()}d.`);
      setComments("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeciding(false);
    }
  }
  const approvalInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  return (
    <Page
      title="Receipt cancellation approval"
      subtitle="Finance maker-checker review before allocations and balances are rolled back"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50/80 p-4 shadow-sm"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500 text-white"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M12 8v5M12 17h.01" /><path d="M10 3h4l7 16H3z" /></svg></span><div><div className="font-bold text-slate-900">{rows.length} request{rows.length === 1 ? "" : "s"} awaiting independent review</div><div className="mt-0.5 text-sm text-slate-600">Review the original payment, reason and explanation before making an irreversible decision.</div></div></div></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-start">
        <Card title="Pending cancellation queue" className="overflow-hidden shadow-md shadow-slate-200/50">
          {rows.map((x) => (
            <button
              key={x.reversalId}
              onClick={() => setFocus(x)}
              className={`mb-3 flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${String(focus?.reversalId) === String(x.reversalId) ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 hover:border-slate-300"}`}
            >
              <span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-600"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M9 7H5v4M5 11a7 7 0 1 0 2-5" /></svg></span><span><strong className="block text-slate-800">{x.reversalReference}</strong><span className="mt-0.5 block text-xs text-slate-500">Payment {x.payment.transactionReference} · {pretty(x.reversalReason)}</span></span></span>
              <strong className="text-rose-700">{money(x.reversalAmount)}</strong>
            </button>
          ))}
          {!rows.length && <div className="grid min-h-[280px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M5 12l4 4L19 6" /></svg></div><div className="mt-4 font-bold text-slate-700">Approval queue is clear</div><div className="mt-1 text-sm text-slate-400">There are no pending receipt cancellations.</div></div></div>}
        </Card>
        <Card title="Approval decision" className="overflow-hidden shadow-md shadow-slate-200/50 lg:sticky lg:top-24">
          {focus ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-900 p-4 text-white">
                <strong>{focus.reversalReference}</strong>
                <div>
                  {focus.payment.customerName} · {money(focus.reversalAmount)}
                </div>
                <div className="mt-2">
                  {pretty(focus.reversalReason)}: {focus.detailedExplanation}
                </div>
                <div className="mt-2 text-sm">
                  Requested by {person(focus.requester)}
                </div>
              </div>
              <Field label="Decision comments">
                <textarea
                  rows={4}
                  className={`${approvalInput} resize-none`}
                  placeholder="Record the reason for your decision"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button disabled={deciding || comments.trim().length < 3} tone="red" className="flex-1 rounded-xl py-3 transition hover:-translate-y-0.5" onClick={() => decide("REJECT")}>
                  Reject
                </Button>
                <Button disabled={deciding || comments.trim().length < 3} tone="green" className="flex-1 rounded-xl py-3 transition hover:-translate-y-0.5" onClick={() => decide("APPROVE")}>
                  {deciding ? "Processing…" : "Approve cancellation"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[300px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-slate-400"><div>Select a pending request to review and decide.</div></div>
          )}
        </Card>
      </div>
    </Page>
  );
}

export function CollectionReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [channels, setChannels] = useState<Row[]>([]);
  const [channelId, setChannelId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api.listPaymentChannels().then((items) => {
      setChannels(items);
      const mpesa = items.find((channel: Row) =>
        String(channel.channelName ?? "").trim().toUpperCase() === "MPESA",
      );
      if (mpesa) setChannelId(String(mpesa.channelId));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (fromDate && toDate && fromDate > toDate) {
      setRows([]);
      setLoadError("From date cannot be after To date.");
      return () => { cancelled = true; };
    }
    setLoadError("");
    api.listPayments({
      ...(channelId ? { channelId } : {}),
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
    }).then((payments) => {
      if (!cancelled) setRows(payments.filter((payment: Row) => payment.paymentStatus === "POSTED"));
    }).catch((error) => {
      if (!cancelled) {
        setRows([]);
        setLoadError(error instanceof Error ? error.message : "Unable to load collections.");
      }
    });
    return () => { cancelled = true; };
  }, [channelId, fromDate, toDate]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((payment) => [
      payment.transactionReference,
      payment.account?.accountNumber,
      payment.customerName,
      payment.payerName,
      payment.receipt?.receiptNumber,
    ].some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [rows, search]);
  const total = visibleRows.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const reportInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;

  return <Page title="Daily collection report" subtitle="Collections by channel, cashier, receipt and transaction" actions={<Button tone="slate" onClick={() => exportExcel("daily-collections.xlsx", "Collections", visibleRows)}>Export Excel</Button>}>
    {loadError && <Notice>{loadError}</Notice>}
    <Card className="mb-5 overflow-hidden shadow-md shadow-slate-200/50">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Collection channel"><SearchableSelect className={reportInput} value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">All channels</option>{channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>{channel.channelName}</option>)}</SearchableSelect></Field>
        <Field label="Search customer, account or reference"><input className={reportInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search collections" /></Field>
        <Field label="From date"><DateInput className={reportInput} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field>
        <Field label="To date"><DateInput className={reportInput} value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field>
      </div>
    </Card>
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><Kpi label="Total collected" value={money(total)} /><Kpi label="Transactions" value={visibleRows.length} /><Kpi label="Average payment" value={money(visibleRows.length ? total / visibleRows.length : 0)} /></div>
    <Card title="Collection transactions" className="overflow-hidden shadow-md shadow-slate-200/50"><PaymentTable rows={visibleRows} /></Card>
  </Page>;
}

export function DailyReceiptsReport() {
  const localDay = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  };
  const initialDay = localDay();
  const [rows, setRows] = useState<Row[]>([]),
    [channels, setChannels] = useState<Row[]>([]),
    [channelId, setChannelId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [fromDate, setFromDate] = useState(initialDay);
  const [toDate, setToDate] = useState(initialDay);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [tablePaymentType, setTablePaymentType] = useState("");
  const [tablePayMode, setTablePayMode] = useState("");
  useEffect(() => {
    api.listPaymentChannels().then((items) => {
      setChannels(items);
    });
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (fromDate && toDate && fromDate > toDate) {
      setRows([]);
      setLoading(false);
      setLoadError("From date cannot be after To date.");
      return () => {
        cancelled = true;
      };
    }
    setLoadError("");
    setRows([]);
    setLoading(true);
    api
      .listDailyCollections({
        ...(channelId ? { channelId } : {}),
        ...(fromDate ? { from: fromDate } : {}),
        ...(toDate ? { to: toDate } : {}),
      })
      .then((payments) => {
        if (!cancelled) {
          setRows(
            payments.filter((payment: Row) => payment.paymentStatus === "POSTED"),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRows([]);
          setLoadError(error instanceof Error ? error.message : "Unable to load collections.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, fromDate, toDate]);
  const filteredRows = rows;
  const paymentHead = (payment: Row) => {
    if (payment.paymentType === "NEW_CONNECTION_FEE") return "New connection fee";
    if (payment.paymentType === "RECONNECTION_FEE") return "Reconnection / disconnection service fee";
    if (payment.paymentType === "ADVANCE_PAYMENT") return "Advance payment";
    if (payment.paymentType === "DEPOSIT") return "Deposit";
    const heads = new Set<string>();
    (payment.allocations ?? []).forEach((allocationRow: Row) => {
      (allocationRow.bill?.items ?? []).forEach((item: Row) => {
        if (Number(item.amount ?? 0) !== 0) heads.add(String(item.description || pretty(item.chargeType)));
      });
    });
    return heads.size ? [...heads].join(", ") : "Water bill / account credit";
  };
  const allReportRows = useMemo<Row[]>(() => filteredRows.map((payment): Row => ({
    ...payment,
    receiptNumber: payment.receipt?.receiptNumber ?? "—",
    accountName: payment.customerName || customerDisplayName(payment.account?.customer) || payment.payerName || "Unmatched payer",
    accountNumber: payment.account?.accountNumber || payment.customerReference || "—",
    payMode: payment.channel?.channelName || payment.channel?.channelCode || "—",
    transactionHead: paymentHead(payment),
  })), [filteredRows]);
  const reportRows = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    return allReportRows.filter((payment: Row) => {
      const searchable = [payment.receiptNumber, payment.transactionReference, payment.accountName, payment.accountNumber, payment.transactionHead, payment.payMode];
      return (
        (!query || searchable.some((value) => String(value ?? "").toLowerCase().includes(query))) &&
        (!tablePaymentType || payment.paymentType === tablePaymentType) &&
        (!tablePayMode || payment.payMode === tablePayMode)
      );
    });
  }, [allReportRows, tableSearch, tablePaymentType, tablePayMode]);
  const totals = useMemo(
    () => reportRows.reduce((s, p) => s + Number(p.amount), 0),
    [reportRows],
  );
  const reportInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  const channelTotals = useMemo(() => reportRows.reduce((result: Record<string, number>, payment: Row) => {
    result[payment.payMode] = (result[payment.payMode] ?? 0) + Number(payment.amount ?? 0);
    return result;
  }, {}), [reportRows]);
  const headTotals = useMemo(() => reportRows.reduce((result: Record<string, number>, payment: Row) => {
    const head = pretty(payment.paymentType || "BILL_PAYMENT");
    result[head] = (result[head] ?? 0) + Number(payment.amount ?? 0);
    return result;
  }, {}), [reportRows]);
  const payModes = useMemo(() => [...new Set(allReportRows.map((payment: Row) => String(payment.payMode)))].sort(), [allReportRows]);
  const paymentTypes = useMemo(() => [...new Set(allReportRows.map((payment: Row) => String(payment.paymentType)))].sort(), [allReportRows]);
  const reportPeriod = !fromDate && !toDate
    ? "All dates"
    : fromDate && toDate && fromDate === toDate
      ? date(`${fromDate}T12:00:00`)
      : `${fromDate ? date(`${fromDate}T12:00:00`) : "Beginning"} – ${toDate ? date(`${toDate}T12:00:00`) : "Today"}`;
  const printReport = () => {
    document.body.classList.add("printing-daily-report");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-daily-report"), { once: true });
    window.print();
  };
  const excelRows = reportRows.map((payment: Row) => ({
    "Receipt No.": payment.receiptNumber,
    "Transaction Reference": payment.transactionReference,
    "Account Name": payment.accountName,
    "Account No.": payment.accountNumber,
    Date: date(payment.valueDate ?? payment.paymentDate),
    "Transaction / Bill": payment.transactionHead,
    "Pay Mode": payment.payMode,
    Amount: Number(payment.amount ?? 0),
  }));
  const exportWorkbook = async () => {
    if (loading || !excelRows.length) return;
    setExporting(true);
    try {
      await exportDailyReceiptsWorkbook("daily-receipts-report.xlsx", reportPeriod, excelRows, channelTotals, totals);
    } finally {
      setExporting(false);
    }
  };
  return (
    <Page
      className="daily-report-page"
      title="Daily receipts report"
      subtitle="All receipts, transaction types and billed services collected during the selected day"
    >
      {loadError && <Notice>{loadError}</Notice>}
      <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_190px_190px_auto_auto]">
          <Field label="Collection channel"><SearchableSelect className={reportInput} value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">All channels</option>{channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>{channel.channelName}</option>)}</SearchableSelect></Field>
          <Field label="From date"><DateInput className={reportInput} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field>
          <Field label="To date"><DateInput className={reportInput} value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field>
          <button type="button" className="h-[42px] rounded-lg border border-emerald-200 bg-emerald-50 px-5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100" onClick={() => { setFromDate(initialDay); setToDate(initialDay); }}>Today</button>
          <div className="flex h-[42px] items-stretch gap-2 whitespace-nowrap"><Button className="px-3 text-sm" tone="blue" disabled={loading || !reportRows.length} onClick={() => setPreviewOpen(true)}>{loading ? "Loading..." : "Preview / PDF"}</Button><Button className="px-3 text-sm" tone="slate" disabled={loading || exporting || !reportRows.length} onClick={() => void exportWorkbook()}><span className="inline-flex items-center gap-2">{exporting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>}{exporting ? "Exporting..." : "Excel"}</span></Button></div>
        </div>
      </section>
      <div className="mb-3 flex flex-wrap gap-2"><div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Total collected</span><strong className="ml-3 text-base text-slate-900">{money(totals)}</strong></div><div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2"><span className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Transactions</span><strong className="ml-3 text-base text-slate-900">{reportRows.length}</strong></div></div>
      <Card title="Collection transactions" className="relative overflow-hidden shadow-sm">
        {loading && <div className="absolute inset-0 z-10 grid min-h-56 place-items-center bg-white/95"><div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" /><div className="mt-3 text-sm font-bold text-slate-700">Loading selected collections...</div><div className="mt-1 text-xs text-slate-400">Please wait before previewing or exporting</div></div></div>}
        <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(280px,1fr)_230px_190px_auto]">
          <div className="relative"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input className={`${INPUT} h-10 rounded-lg pl-9 text-sm`} value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Search receipt, customer, account or bill" /></div>
          <SearchableSelect aria-label="Filter transaction or bill type" className={`${INPUT} h-10 text-sm`} value={tablePaymentType} onChange={(event) => setTablePaymentType(event.target.value)}><option value="">All transaction / bill types</option>{paymentTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}</SearchableSelect>
          <SearchableSelect aria-label="Filter payment mode" className={`${INPUT} h-10 text-sm`} value={tablePayMode} onChange={(event) => setTablePayMode(event.target.value)}><option value="">All payment modes</option>{payModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</SearchableSelect>
          <button type="button" className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50" onClick={() => { setTableSearch(""); setTablePaymentType(""); setTablePayMode(""); }}>Clear</button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1050px]"><thead><tr className="bg-slate-50/80"><th className={TH}>Receipt No.</th><th className={TH}>Account name</th><th className={TH}>Date</th><th className={TH}>A/c No.</th><th className={TH}>Transaction / bill</th><th className={TH}>Pay mode</th><th className={`${TH} text-right`}>Amount</th></tr></thead><tbody>{reportRows.map((payment: Row) => <tr key={payment.paymentId} className="border-t hover:bg-emerald-50/30"><td className={`${TD} font-semibold`}>{payment.receiptNumber}</td><td className={TD}>{payment.accountName}</td><td className={TD}>{date(payment.valueDate ?? payment.paymentDate)}</td><td className={TD}>{payment.accountNumber}</td><td className={TD}><div className="max-w-xs font-medium text-slate-700">{payment.transactionHead}</div><div className="mt-0.5 text-xs text-slate-400">{pretty(payment.paymentType)}</div></td><td className={TD}>{payment.payMode}</td><td className={`${TD} text-right font-bold text-slate-800`}>{money(payment.amount)}</td></tr>)}{!reportRows.length && <tr><td colSpan={7} className="p-14 text-center text-slate-400">No posted collections were found for this report period.</td></tr>}</tbody></table></div>
      </Card>
      {previewOpen && <div className="daily-report-preview fixed inset-0 z-[100] overflow-y-auto bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Daily collection report preview"><div className="mx-auto mb-4 flex max-w-6xl flex-wrap justify-end gap-2"><Button tone="slate" onClick={() => setPreviewOpen(false)}>Close preview</Button><Button tone="green" onClick={printReport}>Print / Save PDF</Button></div><article className="daily-report-print-document mx-auto min-h-[297mm] max-w-6xl bg-white p-8 text-slate-900 shadow-2xl sm:p-12"><header className="border-b-2 border-slate-900 pb-4 text-center"><img src="/samdamte-water-logo-print.png" alt="Samdamte Water Utility Management" className="mx-auto mb-2 h-auto w-[250px] max-w-[55%] object-contain" /><h2 className="text-lg font-extrabold uppercase tracking-wide">Daily Collection Report</h2><p className="mt-1 text-sm font-semibold">Receipts report details for {reportPeriod}</p></header><div className="my-4 flex flex-wrap justify-between gap-2 text-xs"><span><strong>Period:</strong> {reportPeriod}</span><span><strong>Generated:</strong> {dateTime(new Date())}</span><span><strong>Transactions:</strong> {reportRows.length}</span></div><table className="daily-report-table w-full border-collapse text-[10px]"><thead><tr><th>Receipt No.</th><th>Account Name</th><th>Date</th><th>A/c No.</th><th>Transaction / Bill</th><th>Pay Mode</th><th className="text-right">Amount</th></tr></thead><tbody>{reportRows.map((payment: Row) => <tr key={payment.paymentId}><td>{payment.receiptNumber}</td><td>{payment.accountName}</td><td>{date(payment.valueDate ?? payment.paymentDate)}</td><td>{payment.accountNumber}</td><td>{payment.transactionHead}</td><td>{payment.payMode}</td><td className="whitespace-nowrap text-right">{Number(payment.amount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td></tr>)}{Object.entries(channelTotals).sort(([a], [b]) => a.localeCompare(b)).map(([label, amount]) => <tr className="daily-report-total" key={label}><td colSpan={5}></td><td>{label} total</td><td className="text-right">{Number(amount).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td></tr>)}<tr className="daily-report-grand-total"><td colSpan={5}></td><td>GRAND TOTAL</td><td className="text-right">{totals.toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td></tr></tbody></table><section className="mt-6 grid grid-cols-2 gap-8 text-xs"><div><h3 className="border-b pb-1 font-bold uppercase">Totals by transaction type</h3>{Object.entries(headTotals).sort(([a], [b]) => a.localeCompare(b)).map(([label, amount]) => <div key={label} className="flex justify-between border-b border-slate-200 py-1"><span>{label}</span><strong>{money(amount)}</strong></div>)}</div><div className="self-end pt-12 text-center"><div className="border-t border-slate-700 pt-2">Prepared / verified by</div></div></section></article></div>}
    </Page>
  );
}
export function PaymentHistory() {
  const [accounts, setAccounts] = useState<Row[]>([]),
    [accountId, setAccountId] = useState(""),
    [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    api.listPaymentAccounts().then((a) => {
      setAccounts(a);
      if (a[0]) setAccountId(String(a[0].accountId));
    });
  }, []);
  useEffect(() => {
    if (accountId) api.listPayments({ accountId }).then(setRows);
  }, [accountId]);
  const selectedAccount = accounts.find((account) => String(account.accountId) === accountId);
  const historyTotal = rows.filter((payment) => payment.paymentStatus === "POSTED").reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const historyInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  return (
    <Page
      title="Customer payment history"
      subtitle="Valid, partial, advance and reversed payments for a customer account"
    >
      <Card className="mb-5 overflow-hidden shadow-md shadow-slate-200/50">
        <Field label="Customer account">
          <SearchableSelect
            className={historyInput}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.accountNumber} · {a.customerName}
              </option>
            ))}
          </SearchableSelect>
        </Field>
      </Card>
      <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-slate-500">Customer</div><div className="mt-1 truncate text-lg font-extrabold text-slate-900">{selectedAccount?.customerName ?? "No account selected"}</div></div><div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Posted payments</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{rows.filter((payment) => payment.paymentStatus === "POSTED").length}</div></div><div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-sky-700">Total received</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{money(historyTotal)}</div></div></div>
      <Card title="Payment activity" className="overflow-hidden shadow-md shadow-slate-200/50">
        <PaymentTable rows={rows} />
      </Card>
    </Page>
  );
}
export function PaymentAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  useEffect(() => {
    api.paymentAudit().then(setRows);
  }, []);
  const auditRows = rows.filter((event) => {
    const query = search.trim().toLowerCase();
    return !query || [event.payment?.transactionReference, event.reversal?.reversalReference, event.eventType, person(event.performer), event.details].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  return (
    <Page
      title="Payment audit trail"
      subtitle="Permanent payment, allocation, receipt and cancellation events"
      actions={
        <Button
          tone="slate"
          onClick={() => exportExcel("payment-audit.xlsx", "Audit", rows)}
        >
          <span className="inline-flex items-center gap-2"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>Export audit</span>
        </Button>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-slate-500">Permanent events</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{rows.length}</div></div><div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Visible results</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{auditRows.length}</div></div></div>
      <Card title="Financial event register" className="overflow-hidden shadow-md shadow-slate-200/50">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm text-slate-500">Every payment lifecycle change is retained permanently.</div><div className="relative sm:w-80"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input className={`${INPUT} rounded-xl pl-10 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`} placeholder="Search reference, event or user" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-slate-50/80">
              <th className={TH}>Date</th>
              <th className={TH}>Reference</th>
              <th className={TH}>Action</th>
              <th className={TH}>User</th>
              <th className={TH}>Details</th>
            </tr>
          </thead>
          <tbody>
            {auditRows.map((e) => (
              <tr className="border-t transition hover:bg-slate-50" key={e.paymentEventId}>
                <td className={TD}>{dateTime(e.createdAt)}</td>
                <td className={TD}>
                  {e.payment?.transactionReference ||
                    e.reversal?.reversalReference}
                </td>
                <td className={TD}><span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">{pretty(e.eventType)}</span></td>
                <td className={TD}>{person(e.performer)}</td>
                <td className={TD}>{e.details}</td>
              </tr>
            ))}
            {!auditRows.length && <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-slate-400">{rows.length ? "No audit events match your search." : "No audit events have been recorded yet."}</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </Page>
  );
}

export function PaymentReconciliation() {
  const now = new Date().toISOString().slice(0, 10);
  const [channels, setChannels] = useState<Row[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [form, setForm] = useState<Row>({
    channelId: "",
    periodStart: now,
    periodEnd: now,
    statementTotal: "",
    statementFileName: "",
    remarks: "",
  });
  const load = () =>
    Promise.all([
      api.listPaymentChannels(),
      api.listReconciliationBatches(),
    ]).then(([c, r]) => {
      setChannels(c);
      setRows(r);
      if (!form.channelId && c[0])
        setForm((f: Row) => ({ ...f, channelId: String(c[0].channelId) }));
    });
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setReconciling(true);
    setError("");
    setMessage("");
    try {
      const result = await api.createReconciliationBatch({
        ...form,
        statementTotal: Number(form.statementTotal),
      });
      setMessage(
        `Reconciliation completed with variance ${money(result.variance)}.`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReconciling(false);
    }
  }
  const reconciliationInput = `${INPUT} rounded-xl border-slate-200 px-3.5 py-2.5 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10`;
  const balancedCount = rows.filter((batch) => Math.abs(Number(batch.variance ?? 0)) < 0.01).length;
  const varianceCount = rows.length - balancedCount;
  return (
    <Page
      title="Payment reconciliation"
      subtitle="Compare system collections with mobile, bank, cash and card settlement totals"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-slate-500">Reconciliation batches</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{rows.length}</div></div><div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Balanced</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{balancedCount}</div></div><div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-amber-700">With variance</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{varianceCount}</div></div></div>
      <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start">
        <Card title="New reconciliation" className="overflow-hidden shadow-md shadow-slate-200/50 lg:sticky lg:top-24">
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/70 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M4 7h16M4 12h16M4 17h10" /></svg></span><div><div className="text-sm font-bold text-slate-800">Compare settlement totals</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Match the provider or bank statement against posted system collections.</p></div></div>
            <Field label="Channel">
              <SearchableSelect
                required
                className={reconciliationInput}
                value={form.channelId}
                onChange={(e) =>
                  setForm({ ...form, channelId: e.target.value })
                }
              >
                {channels.map((c) => (
                  <option key={c.channelId} value={c.channelId}>
                    {c.channelName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period start">
                <DateInput
                  className={reconciliationInput}
                  value={form.periodStart}
                  onChange={(e) =>
                    setForm({ ...form, periodStart: e.target.value })
                  }
                />
              </Field>
              <Field label="Period end">
                <DateInput
                  className={reconciliationInput}
                  value={form.periodEnd}
                  onChange={(e) =>
                    setForm({ ...form, periodEnd: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Statement total">
              <input
                required
                type="number"
                min="0"
                step="0.01"
                className={reconciliationInput}
                placeholder="0.00"
                value={form.statementTotal}
                onChange={(e) =>
                  setForm({ ...form, statementTotal: e.target.value })
                }
              />
            </Field>
            <Field label="Statement file">
              <input
                type="file"
                className={`${reconciliationInput} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-slate-700`}
                onChange={(e) =>
                  setForm({
                    ...form,
                    statementFileName: e.target.files?.[0]?.name ?? "",
                  })
                }
              />
            </Field>
            <Field label="Remarks">
              <textarea
                rows={3}
                className={`${reconciliationInput} resize-none`}
                placeholder="Optional reconciliation notes"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>
            <Button disabled={reconciling || !form.statementTotal} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md disabled:hover:translate-y-0">{reconciling ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Reconciling…</> : "Compare and reconcile"}</Button>
          </form>
        </Card>
        <Card title="Reconciliation history" className="overflow-hidden shadow-md shadow-slate-200/50">
          <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[850px]">
            <thead>
              <tr className="bg-slate-50/80">
                <th className={TH}>Batch</th>
                <th className={TH}>Channel</th>
                <th className={TH}>Period</th>
                <th className={TH}>System</th>
                <th className={TH}>Statement</th>
                <th className={TH}>Variance</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr className="border-t transition hover:bg-slate-50" key={b.batchId}>
                  <td className={TD}><span className="font-mono text-xs font-bold text-slate-700">{b.batchReference}</span></td>
                  <td className={TD}>{b.channel.channelName}</td>
                  <td className={TD}>
                    {date(b.periodStart)} – {date(b.periodEnd)}
                  </td>
                  <td className={TD}>{money(b.systemTotal)}</td>
                  <td className={TD}>{money(b.statementTotal)}</td>
                  <td className={`${TD} font-bold ${Math.abs(Number(b.variance)) < 0.01 ? "text-emerald-700" : "text-rose-600"}`}>{money(b.variance)}</td>
                  <td className={TD}>
                    <Badge value={b.status} />
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="px-4 py-16 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7"><path d="M4 7h16M4 12h16M4 17h10" /></svg></div><div className="mt-4 font-bold text-slate-700">No reconciliation batches yet</div><div className="mt-1 text-sm text-slate-400">Completed comparisons will appear here.</div></td></tr>}
            </tbody>
          </table></div>
        </Card>
      </div>
    </Page>
  );
}
