import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { exportExcel } from "../lib/meterFiles";

type Row = Record<string, any>;
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] text-slate-700 outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";
const isoToday = () => new Date().toISOString().slice(0, 10);
const money = (value: any) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const date = (value: any) =>
  value ? new Date(value).toLocaleDateString("en-KE") : "—";
const dateTime = (value: any) =>
  value ? new Date(value).toLocaleString("en-KE") : "—";
const pretty = (value: any) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
const customerName = (customer: any) =>
  customer?.organizationName ||
  [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ");

function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
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
        <div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">
          {title}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
function Button({
  tone = "blue",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string }) {
  const tones: Row = {
    blue: "bg-aqua-700 hover:bg-aqua-800",
    green: "bg-emerald-600 hover:bg-emerald-700",
    red: "bg-red-600 hover:bg-red-700",
    orange: "bg-orange-500 hover:bg-orange-600",
    slate: "bg-slate-600 hover:bg-slate-700",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${props.className ?? ""}`}
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
  const tones = {
    blue: "bg-aqua-700",
    green: "bg-emerald-600",
    slate: "bg-slate-600",
    orange: "bg-orange-500",
  };
  return (
    <Link
      to={to}
      className={`rounded-lg px-4 py-2 font-semibold text-white ${tones[tone]}`}
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
function Alert({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`mb-4 whitespace-pre-line rounded-xl border p-3 text-sm ${
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {children}
    </div>
  );
}
function Badge({ value }: { value: any }) {
  const normalized = String(value ?? "");
  const green = [
    "ACTIVE",
    "APPROVED",
    "SENT",
    "DELIVERED",
    "KEPT",
    "PAID",
    "COMPLETED",
  ].includes(normalized);
  const amber = [
    "OPEN",
    "PROPOSED",
    "PENDING",
    "PENDING_APPROVAL",
    "PARTIALLY_PAID",
    "RETURNED",
  ].includes(normalized);
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        green
          ? "bg-emerald-50 text-emerald-700"
          : amber
            ? "bg-amber-50 text-amber-700"
            : normalized === "BROKEN" ||
                normalized === "REJECTED" ||
                normalized === "DEFAULTED"
              ? "bg-red-50 text-red-700"
              : "bg-slate-100 text-slate-600"
      }`}
    >
      {pretty(normalized)}
    </span>
  );
}
function Kpi({
  label,
  value,
  color = "text-slate-900",
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
function AccountSelect({
  rows,
  value,
  onChange,
}: {
  rows: Row[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select className={INPUT} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select customer account</option>
      {rows.map((row) => (
        <option key={row.accountId} value={row.accountId}>
          {row.accountNumber} · {row.customerName} · {money(row.currentBalance)}
        </option>
      ))}
    </select>
  );
}

export function ArrearsDashboard() {
  const [data, setData] = useState<Row>();
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Row>({ asOf: isoToday(), zoneId: "", categoryId: "" });
  const [zones, setZones] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const load = () =>
    api
      .arrearsDashboard(filters)
      .then(setData)
      .catch((value) => setError(value.message));
  useEffect(() => {
    Promise.all([api.listZones(), api.listCategories()])
      .then(([zoneRows, categoryRows]) => {
        setZones(zoneRows);
        setCategories(categoryRows);
      })
      .catch((value) => setError(value.message));
  }, []);
  useEffect(() => {
    load();
  }, [filters.asOf, filters.zoneId, filters.categoryId]);
  const buckets = [
    ["0–30 days", data?.buckets?.["0_30"] ?? 0, "bg-sky-500"],
    ["31–60 days", data?.buckets?.["31_60"] ?? 0, "bg-amber-400"],
    ["61–90 days", data?.buckets?.["61_90"] ?? 0, "bg-orange-500"],
    ["91–120 days", data?.buckets?.["91_120"] ?? 0, "bg-red-500"],
    ["120+ days", data?.buckets?.["120_PLUS"] ?? 0, "bg-red-700"],
  ] as const;
  const max = Math.max(1, ...buckets.map(([, value]) => Number(value)));
  return (
    <Page
      title="Arrears and debt management"
      subtitle="Aged debt, recovery activity, notices and controlled escalation"
      actions={
        <>
          <LinkButton to="/arrears/reminders">Send reminders</LinkButton>
          <LinkButton to="/arrears/disconnections" tone="orange">
            Disconnection lists
          </LinkButton>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Report date">
            <input
              type="date"
              className={INPUT}
              value={filters.asOf}
              onChange={(event) => setFilters({ ...filters, asOf: event.target.value })}
            />
          </Field>
          <Field label="Zone">
            <select
              className={INPUT}
              value={filters.zoneId}
              onChange={(event) => setFilters({ ...filters, zoneId: event.target.value })}
            >
              <option value="">All zones</option>
              {zones.map((zone) => (
                <option key={zone.zoneId} value={zone.zoneId}>
                  {zone.zoneName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Customer category">
            <select
              className={INPUT}
              value={filters.categoryId}
              onChange={(event) =>
                setFilters({ ...filters, categoryId: event.target.value })
              }
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.categoryName}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total arrears" value={money(data?.totalArrears)} color="text-red-700" />
        <Kpi label="Customers in arrears" value={data?.customersInArrears ?? 0} />
        <Kpi label="Demand notices" value={data?.demandNotices ?? 0} color="text-orange-600" />
        <Kpi
          label="Disconnection eligible"
          value={data?.disconnectionEligible ?? 0}
          color="text-red-600"
        />
        <Kpi label="Active payment plans" value={data?.activePlans ?? 0} color="text-emerald-700" />
        <Kpi label="Open promises" value={data?.openPromises ?? 0} color="text-aqua-700" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <Card title="Arrears ageing summary">
          <div className="space-y-4">
            {buckets.map(([label, value, color]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-slate-600">{label}</span>
                  <span className="font-semibold text-slate-800">{money(value)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${Math.max(Number(value) ? 3 : 0, (Number(value) / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <LinkButton to="/arrears/aging">Open ageing report</LinkButton>
            <LinkButton to="/arrears/recovery" tone="green">
              Debt recovery report
            </LinkButton>
          </div>
        </Card>
        <Card title="Recent recovery activity">
          <div className="space-y-2">
            {(data?.recent ?? []).map((event: Row) => (
              <div key={event.arrearsActionId} className="rounded-xl border p-3">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-slate-800">
                    {pretty(event.actionType)}
                  </span>
                  <span className="text-xs text-slate-400">{dateTime(event.createdAt)}</span>
                </div>
                <div className="mt-1 text-sm text-slate-600">{event.details}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {event.account?.accountNumber ?? "System"} ·{" "}
                  {event.performer
                    ? `${event.performer.firstName} ${event.performer.lastName}`
                    : "System"}
                </div>
              </div>
            ))}
            {!data?.recent?.length && (
              <div className="py-8 text-center text-slate-400">
                Recovery activity will appear here.
              </div>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function ArrearsAgingReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [zones, setZones] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Row>({
    asOf: isoToday(),
    zoneId: "",
    categoryId: "",
    ageBucket: "",
    minimumBalance: "",
    search: "",
  });
  const load = () => api.listArrearsAccounts(filters).then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    Promise.all([api.listZones(), api.listCategories()])
      .then(([a, b]) => {
        setZones(a);
        setCategories(b);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [
    filters.asOf,
    filters.zoneId,
    filters.categoryId,
    filters.ageBucket,
    filters.minimumBalance,
    filters.search,
  ]);
  const exportRows = rows.map((row) => ({
    Account: row.accountNumber,
    Customer: row.customerName,
    Zone: row.zone?.zoneName ?? "",
    Category: row.category?.categoryName ?? "",
    "Arrears balance": row.arrearsBalance,
    "Age days": row.ageDays,
    Status: row.accountStatus,
  }));
  return (
    <Page
      title="Arrears ageing report"
      subtitle="Classify overdue balances by age, zone, category and amount"
      actions={
        <>
          <Button
            tone="green"
            disabled={!rows.length}
            onClick={() => exportExcel("arrears-aging-report", "Arrears ageing", exportRows)}
          >
            Export Excel
          </Button>
          <Button tone="slate" onClick={() => window.print()}>
            Print / Save PDF
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Report date">
            <input
              type="date"
              className={INPUT}
              value={filters.asOf}
              onChange={(e) => setFilters({ ...filters, asOf: e.target.value })}
            />
          </Field>
          <Field label="Zone">
            <select className={INPUT} value={filters.zoneId} onChange={(e) => setFilters({ ...filters, zoneId: e.target.value })}>
              <option value="">All zones</option>
              {zones.map((row) => <option key={row.zoneId} value={row.zoneId}>{row.zoneName}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className={INPUT} value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((row) => <option key={row.categoryId} value={row.categoryId}>{row.categoryName}</option>)}
            </select>
          </Field>
          <Field label="Arrears age">
            <select className={INPUT} value={filters.ageBucket} onChange={(e) => setFilters({ ...filters, ageBucket: e.target.value })}>
              <option value="">All ages</option>
              <option value="0_30">0–30 days</option>
              <option value="31_60">31–60 days</option>
              <option value="61_90">61–90 days</option>
              <option value="91_120">91–120 days</option>
              <option value="120_PLUS">120+ days</option>
            </select>
          </Field>
          <Field label="Minimum balance">
            <input type="number" min="0" className={INPUT} value={filters.minimumBalance} onChange={(e) => setFilters({ ...filters, minimumBalance: e.target.value })} />
          </Field>
          <Field label="Search">
            <input className={INPUT} placeholder="Account, name or phone" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card title={`${rows.length} account(s) in arrears`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                <th className={TH}>Account / Customer</th>
                <th className={TH}>Zone</th>
                <th className={TH}>Category</th>
                <th className={TH}>Balance</th>
                <th className={TH}>Age</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.accountId} className="border-t">
                  <td className={TD}>
                    <div className="font-semibold text-slate-700">{row.accountNumber}</div>
                    <div className="text-xs">{row.customerName}</div>
                  </td>
                  <td className={TD}>{row.zone?.zoneName ?? "—"}</td>
                  <td className={TD}>{row.category?.categoryName ?? "—"}</td>
                  <td className={`${TD} font-semibold text-red-700`}>{money(row.arrearsBalance)}</td>
                  <td className={TD}>
                    {row.ageDays} days
                    <div className="text-xs">{pretty(row.ageBucket)}</div>
                  </td>
                  <td className={TD}><Badge value={row.accountStatus} /></td>
                  <td className={TD}>
                    <Link className="font-semibold text-aqua-700" to={`/arrears/accounts/${row.accountId}`}>
                      View debt profile
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="p-10 text-center text-slate-400">No overdue accounts match these filters. A positive balance only becomes arrears after its bill due date.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function CustomerDebtProfile() {
  const { id } = useParams();
  const [data, setData] = useState<Row>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (id) api.getDebtProfile(id).then(setData).catch((e) => setError(e.message));
  }, [id]);
  const account = data?.account;
  const summary = data?.summary;
  return (
    <Page
      title="Customer debt profile"
      subtitle="Complete balance, recovery history and customer arrangements"
      actions={
        account && (
          <>
            <LinkButton to={`/billing/statements?accountId=${account.accountId}`} tone="slate">View statement</LinkButton>
            <LinkButton to={`/arrears/notices?accountId=${account.accountId}`}>Demand notice</LinkButton>
            <LinkButton to={`/arrears/plans?accountId=${account.accountId}`} tone="green">Payment plan</LinkButton>
          </>
        )
      }
    >
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <Card><div className="py-10 text-center text-slate-400">Loading debt profile…</div></Card>
      ) : (
        <>
          <Card>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div><div className="text-sm text-slate-500">Customer</div><div className="font-semibold">{data.customerName}</div></div>
              <div><div className="text-sm text-slate-500">Account</div><div className="font-semibold">{account.accountNumber}</div></div>
              <div><div className="text-sm text-slate-500">Zone</div><div className="font-semibold">{account.property?.zone?.zoneName ?? "—"}</div></div>
              <div><div className="text-sm text-slate-500">Phone</div><div className="font-semibold">{account.customer?.phoneNumber}</div></div>
              <div><div className="text-sm text-slate-500">Status</div><Badge value={account.accountStatus} /></div>
            </div>
          </Card>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Total account balance" value={money(account.currentBalance)} />
            <Kpi label="Overdue arrears" value={money(summary.arrearsBalance)} color="text-red-700" />
            <Kpi label="Current bill balance" value={money(summary.currentBillBalance)} />
            <Kpi label="Oldest debt" value={`${summary.ageDays ?? 0} days`} color="text-orange-600" />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card title="Payment arrangements">
              <div className="space-y-3">
                <div className="flex justify-between"><span>Payment plan</span><Badge value={account.paymentPlans?.[0]?.status ?? "NONE"} /></div>
                <div className="flex justify-between"><span>Promise to pay</span><Badge value={account.promisesToPay?.[0]?.status ?? "NONE"} /></div>
                <div className="flex justify-between"><span>Last payment</span><strong>{money(summary.lastPayment?.amount)}</strong></div>
                <div className="text-sm text-slate-500">{date(summary.lastPayment?.paymentDate)}</div>
              </div>
            </Card>
            <Card title="Recovery notices">
              <div className="space-y-2">
                {(account.debtNotices ?? []).slice(0, 5).map((notice: Row) => (
                  <div key={notice.noticeId} className="flex items-center justify-between rounded-lg border p-2">
                    <div><div className="font-medium">{notice.noticeNumber}</div><div className="text-xs text-slate-400">{date(notice.noticeDate)}</div></div>
                    <Badge value={notice.noticeStatus} />
                  </div>
                ))}
                {!account.debtNotices?.length && <div className="py-6 text-center text-slate-400">No notices issued.</div>}
              </div>
            </Card>
            <Card title="Recovery action history">
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {(account.arrearsActions ?? []).map((event: Row) => (
                  <div key={event.arrearsActionId} className="border-l-2 border-aqua-600 pl-3">
                    <div className="font-medium">{pretty(event.actionType)}</div>
                    <div className="text-sm text-slate-500">{event.details}</div>
                    <div className="text-xs text-slate-400">{dateTime(event.createdAt)}</div>
                  </div>
                ))}
                {!account.arrearsActions?.length && <div className="py-6 text-center text-slate-400">No recovery action yet.</div>}
              </div>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

export function PaymentReminders() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Row>({
    asOf: isoToday(),
    minimumAgeDays: "60",
    minimumBalance: "1000",
    sms: true,
    email: false,
    push: true,
    body: "Dear {{customerName}}, your water account {{accountNumber}} has an outstanding balance of KSh {{balance}}. Please arrange payment to avoid further recovery action.",
  });
  const load = () =>
    api
      .listArrearsAccounts({
        asOf: form.asOf,
        minimumAgeDays: form.minimumAgeDays,
        minimumBalance: form.minimumBalance,
      })
      .then((values) => {
        setRows(values);
        setSelected(values.map((row: Row) => String(row.accountId)));
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [form.asOf, form.minimumAgeDays, form.minimumBalance]);
  async function send(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const channels = [
        ...(form.sms ? ["SMS"] : []),
        ...(form.email ? ["EMAIL"] : []),
        ...(form.push ? ["PUSH"] : []),
      ];
      const result = await api.sendArrearsReminders({
        accountIds: selected,
        channels,
        message: form.body,
      });
      setMessage(`${result.queued} notification(s) queued for ${result.accounts} account(s). Open the notification queue to process delivery.`);
    } catch (e: any) {
      setError(e.message);
    }
  }
  const toggle = (value: string) =>
    setSelected((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  return (
    <Page
      title="Send payment reminders"
      subtitle="Target overdue customers and queue controlled multi-channel reminders"
      actions={<LinkButton to="/notifications/queue" tone="green">Open delivery queue</LinkButton>}
    >
      {error && <Alert>{error}</Alert>}
      {message && <Alert success>{message}</Alert>}
      <form onSubmit={send} className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
        <Card title="Reminder setup">
          <div className="space-y-3">
            <Field label="Arrears as at">
              <input type="date" className={INPUT} value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum age (days)">
                <input type="number" min="1" className={INPUT} value={form.minimumAgeDays} onChange={(e) => setForm({ ...form, minimumAgeDays: e.target.value })} />
              </Field>
              <Field label="Minimum balance">
                <input type="number" min="0" className={INPUT} value={form.minimumBalance} onChange={(e) => setForm({ ...form, minimumBalance: e.target.value })} />
              </Field>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-slate-600">Delivery channels</div>
              <div className="flex flex-wrap gap-4">
                {(["sms", "email", "push"] as const).map((channel) => (
                  <label key={channel} className="flex items-center gap-2">
                    <input type="checkbox" checked={form[channel]} onChange={(e) => setForm({ ...form, [channel]: e.target.checked })} />
                    {channel.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Reminder message">
              <textarea className={`${INPUT} min-h-36`} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">
              Available fields: {"{{customerName}}"}, {"{{accountNumber}}"} and {"{{balance}}"}.
            </div>
            <Button type="submit" tone="green" className="w-full" disabled={!selected.length}>
              Queue {selected.length} customer reminder(s)
            </Button>
          </div>
        </Card>
        <Card title={`${selected.length} of ${rows.length} customers selected`}>
          <div className="max-h-[590px] overflow-auto">
            <table className="w-full min-w-[700px]">
              <thead><tr><th className={TH}><input type="checkbox" checked={rows.length > 0 && selected.length === rows.length} onChange={(e) => setSelected(e.target.checked ? rows.map((row) => String(row.accountId)) : [])} /></th><th className={TH}>Account / Customer</th><th className={TH}>Age</th><th className={TH}>Balance</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="border-t" key={row.accountId}>
                    <td className={TD}><input type="checkbox" checked={selected.includes(String(row.accountId))} onChange={() => toggle(String(row.accountId))} /></td>
                    <td className={TD}><strong>{row.accountNumber}</strong><div className="text-xs">{row.customerName}</div></td>
                    <td className={TD}>{row.ageDays} days</td>
                    <td className={`${TD} font-semibold text-red-700`}>{money(row.arrearsBalance)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="p-10 text-center text-slate-400">No overdue customers match this reminder rule.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </form>
    </Page>
  );
}

export function DemandNotices() {
  const queryAccount = new URLSearchParams(window.location.search).get("accountId") ?? "";
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row>();
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Row>({
    accountId: queryAccount,
    noticeType: "DEMAND",
    paymentDeadline: "",
    deliveryChannel: "SMS",
    messageBody: "",
  });
  const load = () =>
    Promise.all([api.listDebtNotices(), api.listArrearsAccounts()])
      .then(([noticeRows, accountRows]) => {
        setRows(noticeRows);
        setAccounts(accountRows);
        if (!selected && noticeRows.length) setSelected(noticeRows[0]);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const current = accounts.find((row) => String(row.accountId) === form.accountId);
  useEffect(() => {
    if (current && !form.messageBody)
      setForm((value) => ({
        ...value,
        messageBody: `Dear ${current.customerName}, your water account ${current.accountNumber} has an outstanding balance of ${money(current.currentBalance)}. Kindly pay by the stated deadline to avoid further recovery action.`,
      }));
  }, [form.accountId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.createDebtNotice(form);
      setMessage("Demand notice submitted for independent approval.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected) return;
    try {
      await api.decideDebtNotice(selected.noticeId, decision, comments);
      setMessage(`Notice ${decision.toLowerCase()}d.`);
      setComments("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page title="Demand notices" subtitle="Generate, approve and track formal recovery notices">
      {error && <Alert>{error}</Alert>}
      {message && <Alert success>{message}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[.85fr_1.15fr]">
        <Card title="Generate demand notice">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Customer account *"><AccountSelect rows={accounts} value={form.accountId} onChange={(value) => setForm({ ...form, accountId: value, messageBody: "" })} /></Field>
            {current && <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">Outstanding balance: <strong>{money(current.currentBalance)}</strong> · Arrears age: <strong>{current.ageDays} days</strong></div>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Notice type *"><select className={INPUT} value={form.noticeType} onChange={(e) => setForm({ ...form, noticeType: e.target.value })}><option value="DEMAND">Demand</option><option value="FINAL_DEMAND">Final demand</option><option value="DISCONNECTION_NOTICE">Disconnection notice</option></select></Field>
              <Field label="Payment deadline *"><input type="date" className={INPUT} value={form.paymentDeadline} onChange={(e) => setForm({ ...form, paymentDeadline: e.target.value })} /></Field>
            </div>
            <Field label="Delivery channel"><select className={INPUT} value={form.deliveryChannel} onChange={(e) => setForm({ ...form, deliveryChannel: e.target.value })}><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="PUSH">App push</option><option value="PRINT">Print</option><option value="SMS_PDF">SMS + PDF</option></select></Field>
            <Field label="Notice message *"><textarea className={`${INPUT} min-h-36`} value={form.messageBody} onChange={(e) => setForm({ ...form, messageBody: e.target.value })} /></Field>
            <Button type="submit" className="w-full" disabled={!form.accountId || !form.paymentDeadline}>Submit for approval</Button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title={`${rows.length} notice(s) in register`}>
            <div className="max-h-80 overflow-auto">
              <table className="w-full min-w-[750px]">
                <thead><tr><th className={TH}>Notice</th><th className={TH}>Account</th><th className={TH}>Amount</th><th className={TH}>Deadline</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.noticeId} className="border-t">
                      <td className={TD}><strong>{row.noticeNumber}</strong><div className="text-xs">{pretty(row.noticeType)}</div></td>
                      <td className={TD}>{row.account?.accountNumber}<div className="text-xs">{customerName(row.account?.customer)}</div></td>
                      <td className={TD}>{money(row.outstandingAmount)}</td>
                      <td className={TD}>{date(row.paymentDeadline)}</td>
                      <td className={TD}><Badge value={row.noticeStatus} /></td>
                      <td className={TD}><button className="font-semibold text-aqua-700" onClick={() => setSelected(row)}>Review</button></td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No debt notices have been generated.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          {selected && (
            <Card title={`Approval decision · ${selected.noticeNumber}`}>
              <div className="mb-3 rounded-xl bg-slate-50 p-3">
                <div className="font-semibold">{pretty(selected.noticeType)} · {money(selected.outstandingAmount)}</div>
                <div className="mt-1 text-sm text-slate-600">{selected.messageBody}</div>
              </div>
              <Field label="Decision comments *"><textarea className={`${INPUT} min-h-20`} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
              <div className="mt-3 flex justify-end gap-2">
                <Button tone="red" disabled={comments.length < 3 || selected.noticeStatus !== "PENDING_APPROVAL"} onClick={() => decide("REJECT")}>Reject</Button>
                <Button tone="orange" disabled={comments.length < 3 || selected.noticeStatus !== "PENDING_APPROVAL"} onClick={() => decide("RETURN")}>Return</Button>
                <Button tone="green" disabled={comments.length < 3 || selected.noticeStatus !== "PENDING_APPROVAL"} onClick={() => decide("APPROVE")}>Approve notice</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

export function PaymentPlans() {
  const queryAccount = new URLSearchParams(window.location.search).get("accountId") ?? "";
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row>();
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Row>({
    accountId: queryAccount,
    depositAmount: 0,
    numberOfInstallments: 3,
    startDate: isoToday(),
    frequency: "MONTHLY",
    remarks: "",
  });
  const load = () => Promise.all([api.listPaymentPlans(), api.listArrearsAccounts()]).then(([a, b]) => {
    setRows(a); setAccounts(b); if (!selected && a.length) setSelected(a[0]);
  }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const account = accounts.find((row) => String(row.accountId) === form.accountId);
  const remaining = Math.max(0, Number(account?.currentBalance ?? 0) - Number(form.depositAmount || 0));
  const installment = form.numberOfInstallments ? remaining / Number(form.numberOfInstallments) : 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api.createPaymentPlan(form); setMessage("Payment plan proposed for approval."); await load(); }
    catch (value: any) { setError(value.message); }
  }
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (!selected) return;
    try { await api.decidePaymentPlan(selected.paymentPlanId, decision, comments); setMessage(`Payment plan ${decision.toLowerCase()}d.`); setComments(""); await load(); }
    catch (value: any) { setError(value.message); }
  }
  return (
    <Page title="Payment plan management" subtitle="Create structured instalment arrangements and monitor compliance">
      {error && <Alert>{error}</Alert>}{message && <Alert success>{message}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
        <Card title="Create payment plan">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Customer account *"><AccountSelect rows={accounts} value={form.accountId} onChange={(value) => setForm({ ...form, accountId: value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-sm text-slate-500">Outstanding debt</div><div className="text-xl font-bold">{money(account?.currentBalance)}</div></div>
              <div className="rounded-xl bg-blue-50 p-3"><div className="text-sm text-blue-600">Remaining balance</div><div className="text-xl font-bold text-blue-800">{money(remaining)}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Initial payment"><input type="number" min="0" className={INPUT} value={form.depositAmount} onChange={(e) => setForm({ ...form, depositAmount: e.target.value })} /></Field>
              <Field label="Number of instalments"><input type="number" min="1" max="60" className={INPUT} value={form.numberOfInstallments} onChange={(e) => setForm({ ...form, numberOfInstallments: e.target.value })} /></Field>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800">Estimated instalment: <strong>{money(installment)}</strong></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date"><input type="date" className={INPUT} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="Frequency"><select className={INPUT} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></Field>
            </div>
            <Field label="Remarks"><textarea className={`${INPUT} min-h-20`} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
            <Button type="submit" className="w-full" disabled={!form.accountId}>Generate and submit plan</Button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title={`${rows.length} payment plan(s)`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead><tr><th className={TH}>Plan / Customer</th><th className={TH}>Debt</th><th className={TH}>Instalments</th><th className={TH}>Period</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead>
                <tbody>
                  {rows.map((row) => <tr key={row.paymentPlanId} className="border-t"><td className={TD}><strong>{row.planReference}</strong><div className="text-xs">{row.account?.accountNumber} · {customerName(row.account?.customer)}</div></td><td className={TD}>{money(row.totalDebt)}</td><td className={TD}>{row.numberOfInstallments} × {money(row.installmentAmount)}</td><td className={TD}>{date(row.startDate)} – {date(row.endDate)}</td><td className={TD}><Badge value={row.status} /></td><td className={TD}><button className="font-semibold text-aqua-700" onClick={() => setSelected(row)}>Track / Review</button></td></tr>)}
                  {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No payment plans created.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          {selected && <Card title={`Plan tracking · ${selected.planReference}`}>
            <div className="mb-3 grid gap-3 sm:grid-cols-3"><Kpi label="Original debt" value={money(selected.totalDebt)} /><Kpi label="Deposit" value={money(selected.depositAmount)} /><Kpi label="Scheduled balance" value={money(Number(selected.totalDebt) - Number(selected.depositAmount))} /></div>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Instalment</th><th className={TH}>Due date</th><th className={TH}>Amount</th><th className={TH}>Paid</th><th className={TH}>Status</th></tr></thead><tbody>{(selected.installments ?? []).map((item: Row) => <tr key={item.installmentId} className="border-t"><td className={TD}>{item.installmentNumber}</td><td className={TD}>{date(item.dueDate)}</td><td className={TD}>{money(item.amountDue)}</td><td className={TD}>{money(item.amountPaid)}</td><td className={TD}><Badge value={item.status} /></td></tr>)}</tbody></table></div>
            {selected.status === "PROPOSED" && <><Field label="Approval comments *"><textarea className={`${INPUT} mt-3 min-h-20`} value={comments} onChange={(e) => setComments(e.target.value)} /></Field><div className="mt-3 flex justify-end gap-2"><Button tone="red" disabled={comments.length < 3} onClick={() => decide("REJECT")}>Reject</Button><Button tone="orange" disabled={comments.length < 3} onClick={() => decide("RETURN")}>Return</Button><Button tone="green" disabled={comments.length < 3} onClick={() => decide("APPROVE")}>Approve plan</Button></div></>}
          </Card>}
        </div>
      </div>
    </Page>
  );
}

export function PromisesToPay() {
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Row>({ accountId: "", promisedAmount: "", expectedPaymentDate: "", followUpDate: "", contactMethod: "PHONE", notes: "" });
  const load = () => Promise.all([api.listPromisesToPay(status), api.listArrearsAccounts()]).then(([a, b]) => { setRows(a); setAccounts(b); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [status]);
  async function submit(e: FormEvent) { e.preventDefault(); try { await api.createPromiseToPay(form); setMessage("Promise to pay recorded."); setForm({ accountId: "", promisedAmount: "", expectedPaymentDate: "", followUpDate: "", contactMethod: "PHONE", notes: "" }); await load(); } catch (value: any) { setError(value.message); } }
  async function update(id: string, value: "KEPT" | "BROKEN" | "CANCELLED") { try { await api.updatePromiseStatus(id, value); setMessage(`Promise marked ${value.toLowerCase()}.`); await load(); } catch (e: any) { setError(e.message); } }
  return (
    <Page title="Promises to pay" subtitle="Record customer commitments and follow up honoured or broken promises">
      {error && <Alert>{error}</Alert>}{message && <Alert success>{message}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[.7fr_1.3fr]">
        <Card title="Record promise to pay"><form onSubmit={submit} className="space-y-3">
          <Field label="Customer account *"><AccountSelect rows={accounts} value={form.accountId} onChange={(value) => setForm({ ...form, accountId: value })} /></Field>
          <Field label="Promise amount *"><input type="number" min="1" className={INPUT} value={form.promisedAmount} onChange={(e) => setForm({ ...form, promisedAmount: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Promised payment date *"><input type="date" className={INPUT} value={form.expectedPaymentDate} onChange={(e) => setForm({ ...form, expectedPaymentDate: e.target.value })} /></Field><Field label="Follow-up date"><input type="date" className={INPUT} value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} /></Field></div>
          <Field label="Contact method"><select className={INPUT} value={form.contactMethod} onChange={(e) => setForm({ ...form, contactMethod: e.target.value })}><option value="PHONE">Phone call</option><option value="WALK_IN">Walk-in</option><option value="EMAIL">Email</option><option value="SMS">SMS</option></select></Field>
          <Field label="Customer remarks *"><textarea className={`${INPUT} min-h-24`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <Button type="submit" tone="green" className="w-full">Save promise</Button>
        </form></Card>
        <Card title="Promise tracking">
          <div className="mb-3 max-w-xs"><select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="OPEN">Open</option><option value="KEPT">Kept</option><option value="BROKEN">Broken</option><option value="CANCELLED">Cancelled</option></select></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[850px]"><thead><tr><th className={TH}>Reference / Customer</th><th className={TH}>Amount</th><th className={TH}>Due date</th><th className={TH}>Contact</th><th className={TH}>Status</th><th className={TH}>Actions</th></tr></thead><tbody>
            {rows.map((row) => <tr className="border-t" key={row.promiseId}><td className={TD}><strong>{row.promiseReference}</strong><div className="text-xs">{row.account?.accountNumber} · {customerName(row.account?.customer)}</div></td><td className={TD}>{money(row.promisedAmount)}</td><td className={TD}>{date(row.expectedPaymentDate)}</td><td className={TD}>{pretty(row.contactMethod)}</td><td className={TD}><Badge value={row.status} /></td><td className={TD}>{row.status === "OPEN" ? <div className="flex gap-2"><button className="font-semibold text-emerald-700" onClick={() => update(row.promiseId, "KEPT")}>Kept</button><button className="font-semibold text-red-700" onClick={() => update(row.promiseId, "BROKEN")}>Broken</button><button className="font-semibold text-slate-500" onClick={() => update(row.promiseId, "CANCELLED")}>Cancel</button></div> : "—"}</td></tr>)}
            {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No promises match this status.</td></tr>}
          </tbody></table></div>
        </Card>
      </div>
    </Page>
  );
}

export function DisconnectionLists() {
  const [eligible, setEligible] = useState<Row[]>([]);
  const [lists, setLists] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Row>();
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState<Row>({ minimumAgeDays: "90", minimumBalance: "2000" });
  const load = () => Promise.all([api.disconnectionEligible(filters), api.listDisconnectionLists()]).then(([a, b]) => { setEligible(a); setLists(b); if (!review && b.length) setReview(b[0]); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [filters.minimumAgeDays, filters.minimumBalance]);
  async function create() { try { await api.createDisconnectionList({ accountIds: selected, minimumAgeDays: filters.minimumAgeDays, minimumBalance: filters.minimumBalance, remarks: "Generated from approved final demand notices" }); setMessage("Disconnection list submitted for Finance Manager approval."); setSelected([]); await load(); } catch (e: any) { setError(e.message); } }
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") { if (!review) return; try { await api.decideDisconnectionList(review.disconnectionListId, decision, comments); setMessage(`Disconnection list ${decision.toLowerCase()}d.`); setComments(""); await load(); } catch (e: any) { setError(e.message); } }
  return (
    <Page title="Disconnection lists" subtitle="Escalate eligible accounts only after formal recovery notices" actions={<LinkButton to="/arrears/notices">Demand notices</LinkButton>}>
      {error && <Alert>{error}</Alert>}{message && <Alert success>{message}</Alert>}
      <Card title="Create disconnection list">
        <div className="mb-3 grid gap-3 md:grid-cols-3"><Field label="Minimum arrears age (days)"><input type="number" min="1" className={INPUT} value={filters.minimumAgeDays} onChange={(e) => setFilters({ ...filters, minimumAgeDays: e.target.value })} /></Field><Field label="Minimum balance"><input type="number" min="0" className={INPUT} value={filters.minimumBalance} onChange={(e) => setFilters({ ...filters, minimumBalance: e.target.value })} /></Field><div className="flex items-end"><Button className="w-full" tone="orange" disabled={!selected.length} onClick={create}>Submit {selected.length} selected account(s)</Button></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px]"><thead><tr><th className={TH}><input type="checkbox" checked={eligible.length > 0 && selected.length === eligible.length} onChange={(e) => setSelected(e.target.checked ? eligible.map((row) => String(row.accountId)) : [])} /></th><th className={TH}>Account / Customer</th><th className={TH}>Zone</th><th className={TH}>Balance</th><th className={TH}>Age</th><th className={TH}>Last notice</th></tr></thead><tbody>{eligible.map((row) => <tr className="border-t" key={row.accountId}><td className={TD}><input type="checkbox" checked={selected.includes(String(row.accountId))} onChange={() => setSelected((values) => values.includes(String(row.accountId)) ? values.filter((value) => value !== String(row.accountId)) : [...values, String(row.accountId)])} /></td><td className={TD}><strong>{row.accountNumber}</strong><div className="text-xs">{row.customerName}</div></td><td className={TD}>{row.zone?.zoneName ?? "—"}</td><td className={`${TD} font-semibold text-red-700`}>{money(row.arrearsBalance)}</td><td className={TD}>{row.ageDays} days</td><td className={TD}>{row.lastNotice?.noticeNumber}<div className="text-xs">{date(row.lastNotice?.paymentDeadline)}</div></td></tr>)}{!eligible.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No account meets the rule with an approved final demand or disconnection notice.</td></tr>}</tbody></table></div>
      </Card>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <Card title={`${lists.length} disconnection list(s)`}><div className="space-y-2">{lists.map((row) => <button key={row.disconnectionListId} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${review?.disconnectionListId === row.disconnectionListId ? "border-aqua-500 bg-blue-50" : ""}`} onClick={() => setReview(row)}><div><strong>{row.listReference}</strong><div className="text-xs text-slate-500">{row.items?.length ?? 0} account(s) · {date(row.createdAt)}</div></div><Badge value={row.status} /></button>)}{!lists.length && <div className="p-8 text-center text-slate-400">No lists created.</div>}</div></Card>
        <Card title="Approval decision">
          {!review ? <div className="p-8 text-center text-slate-400">Select a list to review.</div> : <><div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-bold">{review.listReference}</div><div className="mt-1 text-sm">{review.items?.length} account(s) · Minimum {review.minimumAgeDays} days · {money(review.minimumBalance)}</div></div><div className="my-3 max-h-44 overflow-y-auto">{(review.items ?? []).map((item: Row) => <div key={item.disconnectionItemId} className="flex justify-between border-b py-2 text-sm"><span>{item.account?.accountNumber} · {customerName(item.account?.customer)}</span><strong>{money(item.outstandingAmount)}</strong></div>)}</div><Field label="Decision comments *"><textarea className={`${INPUT} min-h-20`} value={comments} onChange={(e) => setComments(e.target.value)} /></Field><div className="mt-3 flex justify-end gap-2"><Button tone="red" disabled={comments.length < 3 || review.status !== "PENDING_APPROVAL"} onClick={() => decide("REJECT")}>Reject</Button><Button tone="orange" disabled={comments.length < 3 || review.status !== "PENDING_APPROVAL"} onClick={() => decide("RETURN")}>Return</Button><Button tone="green" disabled={comments.length < 3 || review.status !== "PENDING_APPROVAL"} onClick={() => decide("APPROVE")}>Approve list</Button></div></>}
        </Card>
      </div>
    </Page>
  );
}

export function DebtWriteOffs() {
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row>();
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Row>({ accountId: "", amount: "", debtAgeDays: 120, recoveryActions: "", reason: "" });
  const load = () => Promise.all([api.listDebtWriteOffs(), api.listArrearsAccounts({ minimumAgeDays: "120" })]).then(([a, b]) => { setRows(a); setAccounts(b); if (!selected && a.length) setSelected(a[0]); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function submit(e: FormEvent) { e.preventDefault(); try { await api.createDebtWriteOff(form); setMessage("Write-off request submitted for Finance Manager decision."); await load(); } catch (e: any) { setError(e.message); } }
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") { if (!selected) return; try { await api.decideDebtWriteOff(selected.writeOffId, decision, comments); setMessage(`Write-off request ${decision.toLowerCase()}d.`); setComments(""); await load(); } catch (e: any) { setError(e.message); } }
  return (
    <Page title="Debt write-off control" subtitle="Request and independently approve debts considered unrecoverable">
      {error && <Alert>{error}</Alert>}{message && <Alert success>{message}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
        <Card title="Write-off request"><form onSubmit={submit} className="space-y-3"><Field label="Customer account (120+ days) *"><AccountSelect rows={accounts} value={form.accountId} onChange={(value) => { const row = accounts.find((item) => String(item.accountId) === value); setForm({ ...form, accountId: value, amount: row?.arrearsBalance ?? "", debtAgeDays: row?.ageDays ?? 120 }); }} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Amount *"><input type="number" min="1" className={INPUT} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Debt age days"><input type="number" min="120" className={INPUT} value={form.debtAgeDays} onChange={(e) => setForm({ ...form, debtAgeDays: e.target.value })} /></Field></div><Field label="Recovery actions taken *"><textarea className={`${INPUT} min-h-24`} placeholder="Reminders, demand notices, disconnection and follow-up actions" value={form.recoveryActions} onChange={(e) => setForm({ ...form, recoveryActions: e.target.value })} /></Field><Field label="Write-off reason *"><textarea className={`${INPUT} min-h-20`} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field><Button type="submit" className="w-full">Submit write-off request</Button></form></Card>
        <div className="space-y-4"><Card title={`${rows.length} write-off request(s)`}><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead><tr><th className={TH}>Reference / Customer</th><th className={TH}>Amount</th><th className={TH}>Age</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.writeOffId}><td className={TD}><strong>{row.writeOffReference}</strong><div className="text-xs">{row.account?.accountNumber} · {customerName(row.account?.customer)}</div></td><td className={TD}>{money(row.amount)}</td><td className={TD}>{row.debtAgeDays} days</td><td className={TD}><Badge value={row.status} /></td><td className={TD}><button className="font-semibold text-aqua-700" onClick={() => setSelected(row)}>Review</button></td></tr>)}{!rows.length && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No write-off requests.</td></tr>}</tbody></table></div></Card>
          {selected && <Card title={`Approval decision · ${selected.writeOffReference}`}><div className="rounded-xl bg-slate-50 p-3"><div className="text-2xl font-bold text-red-700">{money(selected.amount)}</div><div className="mt-2 text-sm"><strong>Reason:</strong> {selected.reason}</div><div className="mt-1 text-sm"><strong>Recovery history:</strong> {selected.recoveryActions}</div></div><Field label="Decision comments *"><textarea className={`${INPUT} mt-3 min-h-20`} value={comments} onChange={(e) => setComments(e.target.value)} /></Field><div className="mt-3 flex justify-end gap-2"><Button tone="red" disabled={comments.length < 3 || selected.status !== "PENDING"} onClick={() => decide("REJECT")}>Reject</Button><Button tone="orange" disabled={comments.length < 3 || selected.status !== "PENDING"} onClick={() => decide("RETURN")}>Return</Button><Button tone="green" disabled={comments.length < 3 || selected.status !== "PENDING"} onClick={() => decide("APPROVE")}>Approve write-off</Button></div></Card>}
        </div>
      </div>
    </Page>
  );
}

export function DebtRecoveryReport() {
  const [data, setData] = useState<Row>();
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Row>({ from: "", to: isoToday() });
  const load = () => api.debtRecoveryReport(filters).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [filters.from, filters.to]);
  const exportRows = (data?.rows ?? []).map((row: Row) => ({ Account: row.accountNumber, Customer: row.customerName, Zone: row.zone?.zoneName ?? "", Balance: row.arrearsBalance, "Age days": row.ageDays }));
  return (
    <Page title="Debt recovery report" subtitle="Opening debt, new arrears, recoveries, write-offs and closing position" actions={<><Button tone="green" disabled={!exportRows.length} onClick={() => exportExcel("debt-recovery-report", "Debt recovery", exportRows)}>Export Excel</Button><Button tone="slate" onClick={() => window.print()}>Print / Save PDF</Button></>}>
      {error && <Alert>{error}</Alert>}
      <Card className="mb-4"><div className="grid gap-3 md:grid-cols-3"><Field label="From"><input type="date" className={INPUT} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field><Field label="To"><input type="date" className={INPUT} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field><div className="flex items-end"><Button className="w-full" onClick={load}>Generate report</Button></div></div></Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Kpi label="Opening arrears" value={money(data?.openingArrears)} /><Kpi label="New arrears" value={money(data?.newArrears)} color="text-orange-600" /><Kpi label="Amount recovered" value={money(data?.amountRecovered)} color="text-emerald-700" /><Kpi label="Written off" value={money(data?.writtenOff)} color="text-red-600" /><Kpi label="Closing arrears" value={money(data?.closingArrears)} color="text-red-700" /><Kpi label="Recovery rate" value={`${Number(data?.recoveryRate ?? 0).toFixed(2)}%`} color="text-aqua-700" /></div>
      <Card title="Closing arrears detail" className="mt-4"><div className="overflow-x-auto"><table className="w-full min-w-[750px]"><thead><tr><th className={TH}>Account / Customer</th><th className={TH}>Zone</th><th className={TH}>Age</th><th className={TH}>Balance</th></tr></thead><tbody>{(data?.rows ?? []).map((row: Row) => <tr className="border-t" key={row.accountId}><td className={TD}><strong>{row.accountNumber}</strong><div className="text-xs">{row.customerName}</div></td><td className={TD}>{row.zone?.zoneName ?? "—"}</td><td className={TD}>{row.ageDays} days</td><td className={`${TD} font-semibold text-red-700`}>{money(row.arrearsBalance)}</td></tr>)}{!data?.rows?.length && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No closing arrears for this report date.</td></tr>}</tbody></table></div></Card>
    </Page>
  );
}

export function ArrearsAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api.arrearsAudit().then(setRows).catch((e) => setError(e.message)); }, []);
  return (
    <Page title="Arrears audit trail" subtitle="Immutable history of reminders, notices, arrangements and approvals" actions={<Button tone="green" disabled={!rows.length} onClick={() => exportExcel("arrears-audit-trail", "Arrears audit", rows.map((row) => ({ Date: dateTime(row.createdAt), Account: row.account?.accountNumber ?? "", Customer: customerName(row.account?.customer), Action: pretty(row.actionType), Details: row.details, User: row.performer ? `${row.performer.firstName} ${row.performer.lastName}` : "System" })))}>Export Excel</Button>}>
      {error && <Alert>{error}</Alert>}
      <Card title={`${rows.length} audit event(s)`}><div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className={TH}>Date</th><th className={TH}>Account / Customer</th><th className={TH}>Action</th><th className={TH}>Details</th><th className={TH}>User</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.arrearsActionId}><td className={TD}>{dateTime(row.createdAt)}</td><td className={TD}>{row.account?.accountNumber ?? "—"}<div className="text-xs">{customerName(row.account?.customer)}</div></td><td className={TD}><Badge value={row.actionType} /></td><td className={TD}>{row.details}</td><td className={TD}>{row.performer ? `${row.performer.firstName} ${row.performer.lastName}` : "System"}</td></tr>)}{!rows.length && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No arrears actions recorded.</td></tr>}</tbody></table></div></Card>
    </Page>
  );
}
