import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { exportExcel } from "../lib/meterFiles";

type Row = Record<string, any>;
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
          <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>
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
      className={`rounded-lg px-4 py-2 font-semibold text-white ${colors[tone]}`}
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
  return (
    <div
      className={`mb-4 rounded-xl border p-3 text-sm ${green ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}
    >
      {children}
    </div>
  );
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
      subtitle="Collections, allocations, receipts, reversals and reconciliation"
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
        <Kpi label="Pending reversals" value={data?.pendingReversals ?? 0} />
        {Object.entries(data?.channels ?? {}).map(([channel, total]) => (
          <Kpi key={channel} label={channel} value={money(total)} />
        ))}
        <Kpi label="Receipts issued" value={data?.receipts ?? 0} />
      </div>
      <Card title="Recent payments" className="mt-4">
        <PaymentTable rows={data?.recent ?? []} />
      </Card>
    </Page>
  );
}
function PaymentTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px]">
        <thead>
          <tr>
            <th className={TH}>Reference</th>
            <th className={TH}>Customer</th>
            <th className={TH}>Channel</th>
            <th className={TH}>Date</th>
            <th className={TH}>Amount</th>
            <th className={TH}>Allocation</th>
            <th className={TH}>Status</th>
            <th className={TH}>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.paymentId} className="border-t">
              <td className={`${TD} font-semibold`}>
                {p.transactionReference}
              </td>
              <td className={TD}>
                {p.customerName ||
                  p.payerName ||
                  (p.account ? "Linked account" : "Unmatched")}
                <div className="text-xs">
                  {p.account?.accountNumber || p.customerReference}
                </div>
              </td>
              <td className={TD}>{p.channel?.channelName}</td>
              <td className={TD}>{dateTime(p.paymentDate)}</td>
              <td className={`${TD} font-semibold`}>{money(p.amount)}</td>
              <td className={TD}>
                <Badge
                  value={
                    p.paymentStatus === "REVERSED"
                      ? "REVERSED"
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
                    className="font-semibold text-aqua-700"
                    to={`/payments/receipts/${p.receipt.receiptId}`}
                  >
                    View
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={8} className="p-8 text-center text-slate-400">
                No payment records found.
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
    }
  }
  return (
    <Page
      title="Payment channels"
      subtitle="Configure active collection channels, settlement accounts and allocation rules"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card title="New payment channel">
          <form className="space-y-3" onSubmit={submit}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Channel code">
                <input
                  required
                  className={INPUT}
                  value={form.channelCode}
                  onChange={(e) =>
                    setForm({ ...form, channelCode: e.target.value })
                  }
                />
              </Field>
              <Field label="Channel name">
                <input
                  required
                  className={INPUT}
                  value={form.channelName}
                  onChange={(e) =>
                    setForm({ ...form, channelName: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Till / paybill / account identifier">
              <input
                className={INPUT}
                value={form.accountIdentifier ?? ""}
                onChange={(e) =>
                  setForm({ ...form, accountIdentifier: e.target.value })
                }
              />
            </Field>
            <div className="space-y-2 text-sm">
              {[
                ["requiresReference", "Reference required"],
                ["autoAllocation", "Automatic allocation"],
                ["receiptRequired", "Receipt required"],
              ].map(([key, label]) => (
                <label key={key} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <Button className="w-full">Save channel</Button>
          </form>
        </Card>
        <Card title="Channel register">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Code</th>
                <th className={TH}>Channel</th>
                <th className={TH}>Identifier</th>
                <th className={TH}>Auto allocate</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr className="border-t" key={c.channelId}>
                  <td className={TD}>{c.channelCode}</td>
                  <td className={TD}>{c.channelName}</td>
                  <td className={TD}>{c.accountIdentifier || "—"}</td>
                  <td className={TD}>{c.autoAllocation ? "Yes" : "No"}</td>
                  <td className={TD}>
                    <Badge value={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await api.recordPayment({
        ...form,
        amount: Number(form.amount),
      });
      navigate(`/payments/receipts/${result.receiptId}`);
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Record customer payment"
      subtitle="Post cash, bank, card or mobile payments and allocate oldest bills first"
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mx-auto max-w-3xl">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <Field label="Customer account">
            <select
              required
              className={INPUT}
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            >
              <option value="">Select customer account</option>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountNumber} · {a.customerName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment channel">
            <select
              required
              className={INPUT}
              value={form.channelId}
              onChange={(e) => setForm({ ...form, channelId: e.target.value })}
            >
              <option value="">Select channel</option>
              {channels.map((c) => (
                <option key={c.channelId} value={c.channelId}>
                  {c.channelName}
                </option>
              ))}
            </select>
          </Field>
          {account && (
            <div className="md:col-span-2 rounded-lg bg-blue-50 p-3 text-blue-700">
              Current balance: <strong>{money(account.currentBalance)}</strong>
            </div>
          )}
          <Field label="Payment reference">
            <input
              required
              className={INPUT}
              value={form.transactionReference}
              onChange={(e) =>
                setForm({ ...form, transactionReference: e.target.value })
              }
            />
          </Field>
          <Field label="Amount paid">
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
          <Field label="Payment date and time">
            <input
              required
              type="datetime-local"
              className={INPUT}
              value={form.paymentDate}
              onChange={(e) =>
                setForm({ ...form, paymentDate: e.target.value })
              }
            />
          </Field>
          <Field label="Payment type">
            <select
              className={INPUT}
              value={form.paymentType}
              onChange={(e) =>
                setForm({ ...form, paymentType: e.target.value })
              }
            >
              <option>BILL_PAYMENT</option>
              <option>ADVANCE_PAYMENT</option>
              <option>DEPOSIT</option>
            </select>
          </Field>
          <Field label="Remarks">
            <textarea
              className={INPUT}
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.autoAllocate}
              onChange={(e) =>
                setForm({ ...form, autoAllocate: e.target.checked })
              }
            />
            Allocate automatically
          </label>
          <Button className="md:col-span-2">
            Save payment and generate receipt
          </Button>
        </form>
      </Card>
    </Page>
  );
}

export function MpesaStkPush() {
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [config, setConfig] = useState<Row>();
  const [history, setHistory] = useState<Row[]>([]);
  const [active, setActive] = useState<Row>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
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
      subtitle="Send a secure STK Push prompt and post the payment only after Safaricom confirms it"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      {config && !config.configured && (
        <Notice>
          {config.error || "M-Pesa is not configured on the server."}
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-[460px_1fr]">
        <Card title="Send payment prompt">
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Customer account">
              <select
                required
                className={INPUT}
                value={form.accountId}
                onChange={(e) => selectAccount(e.target.value)}
              >
                <option value="">Select customer account</option>
                {accounts.map((a) => (
                  <option value={a.accountId} key={a.accountId}>
                    {a.accountNumber} · {a.customerName}
                  </option>
                ))}
              </select>
            </Field>
            {selectedAccount && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                <div>
                  Customer: <strong>{selectedAccount.customerName}</strong>
                </div>
                <div>
                  Outstanding account balance:{" "}
                  <strong>{money(selectedAccount.currentBalance)}</strong>
                </div>
              </div>
            )}
            <Field label="Safaricom phone number">
              <input
                required
                className={INPUT}
                placeholder="0712345678"
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
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
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
            <Button
              tone="green"
              className="w-full"
              disabled={sending || !config?.configured}
            >
              {sending ? "Sending prompt..." : "Send M-Pesa prompt"}
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
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-sm text-slate-500">Phone</div>
                    <strong>{active.phoneNumber}</strong>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Amount</div>
                    <strong>{money(active.amount)}</strong>
                  </div>
                  <div>
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
            ) : (
              <div className="py-8 text-center text-slate-400">
                Send a prompt to track it here.
              </div>
            )}
          </Card>
          <Card title="Recent STK requests">
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
                  {history.map((row) => (
                    <tr className="border-t" key={row.stkRequestId}>
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
                            className="font-semibold text-aqua-700"
                            to={`/payments/receipts/${row.payment.receipt.receiptId}`}
                          >
                            View
                          </Link>
                        ) : (
                          row.mpesaReceiptNumber || "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {!history.length && (
                    <tr>
                      <td
                        className="p-8 text-center text-slate-400"
                        colSpan={6}
                      >
                        No STK Push requests yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

export function PaymentRegister() {
  const [rows, setRows] = useState<Row[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const pageSize = 50;
  useEffect(() => {
    api
      .listPayments({
        search,
        status,
        page: String(page),
        pageSize: String(pageSize),
      })
      .then((result) => {
        setRows(result.items);
        setTotal(Number(result.total));
      });
  }, [search, status, page]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
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
      actions={
        <Button
          tone="green"
          onClick={() => exportExcel("payment-register.xlsx", "Payments", rows)}
        >
          Export register
        </Button>
      }
    >
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Status">
            <select
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
            </select>
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
        <PaymentTable rows={rows} />
        {pages > 1 && pagination}
      </Card>
    </Page>
  );
}

export function UnmatchedPayments() {
  const [rows, setRows] = useState<Row[]>([]),
    [accounts, setAccounts] = useState<Row[]>([]),
    [focus, setFocus] = useState<Row>(),
    [accountId, setAccountId] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = () =>
    Promise.all([api.listPayments(), api.listPaymentAccounts()]).then(
      ([p, a]) => {
        setRows(
          p.filter(
            (x: Row) =>
              x.paymentStatus === "RECEIVED" &&
              x.matchingStatus === "UNMATCHED" &&
              !x.accountId,
          ),
        );
        setAccounts(a);
      },
    );
  useEffect(() => {
    load();
  }, []);
  async function allocate() {
    if (!focus) return;
    try {
      await api.allocatePayment(String(focus.paymentId), accountId, reason);
      setMessage("Payment allocated and receipt generated.");
      setFocus(undefined);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Unmatched payment allocation"
      subtitle="Link unresolved mobile and bank transactions to valid customer accounts"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card title={`${rows.length} unmatched payment(s)`}>
          <PaymentTable rows={rows} />
          {rows.map((p) => (
            <button
              key={p.paymentId}
              onClick={() => setFocus(p)}
              className="mt-2 mr-2 rounded bg-aqua-700 px-3 py-2 text-white"
            >
              Allocate {p.transactionReference}
            </button>
          ))}
        </Card>
        <Card title="Manual allocation">
          {focus ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <strong>{focus.transactionReference}</strong>
                <div>
                  {money(focus.amount)} · {focus.payerPhone}
                </div>
              </div>
              <Field label="Customer account">
                <select
                  className={INPUT}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option value={a.accountId} key={a.accountId}>
                      {a.accountNumber} · {a.customerName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Allocation reason">
                <textarea
                  className={INPUT}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button
                className="w-full"
                disabled={!accountId || reason.length < 5}
                onClick={allocate}
              >
                Allocate payment
              </Button>
            </div>
          ) : (
            <div className="py-10 text-center text-slate-400">
              Select an unmatched payment.
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
          <div>
            <h2 className="text-2xl font-bold text-aqua-700">AquaFlow</h2>
            <div>Water Utility Management</div>
          </div>
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
              r.payment.matchingStatus === "MATCHED" &&
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
    try {
      await api.requestPaymentReversal(form);
      setMessage("Reversal submitted for independent approval.");
      setForm({
        paymentId: "",
        reversalReason: "DUPLICATE_PAYMENT",
        detailedExplanation: "",
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Payment reversal requests"
      subtitle="Request controlled reversal instead of deleting financial records"
      actions={
        <LinkButton to="/payments/reversals/approvals">
          Reversal approval
        </LinkButton>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card title="New reversal request">
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Posted payment">
              <select
                required
                className={INPUT}
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
              </select>
            </Field>
            <Field label="Reason">
              <select
                className={INPUT}
                value={form.reversalReason}
                onChange={(e) =>
                  setForm({ ...form, reversalReason: e.target.value })
                }
              >
                <option>DUPLICATE_PAYMENT</option>
                <option>WRONG_ACCOUNT</option>
                <option>CHARGEBACK</option>
                <option>INPUT_ERROR</option>
              </select>
            </Field>
            <Field label="Detailed explanation">
              <textarea
                required
                className={INPUT}
                value={form.detailedExplanation}
                onChange={(e) =>
                  setForm({ ...form, detailedExplanation: e.target.value })
                }
              />
            </Field>
            <Button className="w-full">Submit reversal request</Button>
          </form>
        </Card>
        <Card title="Reversal history">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Reference</th>
                <th className={TH}>Payment</th>
                <th className={TH}>Amount</th>
                <th className={TH}>Requester</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr className="border-t" key={x.reversalId}>
                  <td className={TD}>{x.reversalReference}</td>
                  <td className={TD}>{x.payment.transactionReference}</td>
                  <td className={TD}>{money(x.reversalAmount)}</td>
                  <td className={TD}>{person(x.requester)}</td>
                  <td className={TD}>
                    <Badge value={x.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    try {
      await api.decidePaymentReversal(
        String(focus.reversalId),
        decision,
        comments,
      );
      setMessage(`Reversal ${decision.toLowerCase()}d.`);
      setComments("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Payment reversal approval"
      subtitle="Finance maker-checker review before allocations and balances are rolled back"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_500px]">
        <Card title={`${rows.length} pending reversal(s)`}>
          {rows.map((x) => (
            <button
              key={x.reversalId}
              onClick={() => setFocus(x)}
              className="mb-2 flex w-full justify-between rounded-lg border p-3 text-left"
            >
              <span>
                <strong>{x.reversalReference}</strong>
                <br />
                {x.payment.transactionReference}
              </span>
              <strong>{money(x.reversalAmount)}</strong>
            </button>
          ))}
        </Card>
        <Card title="Approval decision">
          {focus ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-4">
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
                  className={INPUT}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button tone="red" onClick={() => decide("REJECT")}>
                  Reject
                </Button>
                <Button tone="green" onClick={() => decide("APPROVE")}>
                  Approve reversal
                </Button>
              </div>
            </div>
          ) : (
            "No request selected"
          )}
        </Card>
      </div>
    </Page>
  );
}

export function CollectionReport() {
  const [rows, setRows] = useState<Row[]>([]),
    [channels, setChannels] = useState<Row[]>([]),
    [channelId, setChannelId] = useState("");
  useEffect(() => {
    api.listPaymentChannels().then(setChannels);
  }, []);
  useEffect(() => {
    api
      .listPayments(channelId ? { channelId } : {})
      .then((p) => setRows(p.filter((x: Row) => x.paymentStatus === "POSTED")));
  }, [channelId]);
  const totals = useMemo(
    () => rows.reduce((s, p) => s + Number(p.amount), 0),
    [rows],
  );
  return (
    <Page
      title="Daily collection report"
      subtitle="Collections by channel, cashier, receipt and transaction"
      actions={
        <Button
          tone="green"
          onClick={() =>
            exportExcel("daily-collections.xlsx", "Collections", rows)
          }
        >
          Export Excel
        </Button>
      }
    >
      <Card className="mb-4">
        <Field label="Channel">
          <select
            className={INPUT}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c.channelId} value={c.channelId}>
                {c.channelName}
              </option>
            ))}
          </select>
        </Field>
      </Card>
      <Kpi label="Total collected" value={money(totals)} />
      <Card title={`${rows.length} transaction(s)`} className="mt-4">
        <PaymentTable rows={rows} />
      </Card>
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
  return (
    <Page
      title="Customer payment history"
      subtitle="Valid, partial, advance and reversed payments for a customer account"
    >
      <Card className="mb-4">
        <Field label="Customer account">
          <select
            className={INPUT}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.accountNumber} · {a.customerName}
              </option>
            ))}
          </select>
        </Field>
      </Card>
      <Card>
        <PaymentTable rows={rows} />
      </Card>
    </Page>
  );
}
export function PaymentAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    api.paymentAudit().then(setRows);
  }, []);
  return (
    <Page
      title="Payment audit trail"
      subtitle="Permanent payment, allocation, receipt and reversal events"
      actions={
        <Button
          tone="green"
          onClick={() => exportExcel("payment-audit.xlsx", "Audit", rows)}
        >
          Export audit
        </Button>
      }
    >
      <Card>
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Reference</th>
              <th className={TH}>Action</th>
              <th className={TH}>User</th>
              <th className={TH}>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr className="border-t" key={e.paymentEventId}>
                <td className={TD}>{dateTime(e.createdAt)}</td>
                <td className={TD}>
                  {e.payment?.transactionReference ||
                    e.reversal?.reversalReference}
                </td>
                <td className={TD}>{pretty(e.eventType)}</td>
                <td className={TD}>{person(e.performer)}</td>
                <td className={TD}>{e.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    }
  }
  return (
    <Page
      title="Payment reconciliation"
      subtitle="Compare system collections with mobile, bank, cash and card settlement totals"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice green>{message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card title="New reconciliation">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Channel">
              <select
                required
                className={INPUT}
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
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period start">
                <input
                  type="date"
                  className={INPUT}
                  value={form.periodStart}
                  onChange={(e) =>
                    setForm({ ...form, periodStart: e.target.value })
                  }
                />
              </Field>
              <Field label="Period end">
                <input
                  type="date"
                  className={INPUT}
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
                className={INPUT}
                value={form.statementTotal}
                onChange={(e) =>
                  setForm({ ...form, statementTotal: e.target.value })
                }
              />
            </Field>
            <Field label="Statement file">
              <input
                type="file"
                className={INPUT}
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
                className={INPUT}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>
            <Button className="w-full">Compare and reconcile</Button>
          </form>
        </Card>
        <Card title="Reconciliation history">
          <table className="w-full">
            <thead>
              <tr>
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
                <tr className="border-t" key={b.batchId}>
                  <td className={TD}>{b.batchReference}</td>
                  <td className={TD}>{b.channel.channelName}</td>
                  <td className={TD}>
                    {date(b.periodStart)} – {date(b.periodEnd)}
                  </td>
                  <td className={TD}>{money(b.systemTotal)}</td>
                  <td className={TD}>{money(b.statementTotal)}</td>
                  <td className={TD}>{money(b.variance)}</td>
                  <td className={TD}>
                    <Badge value={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </Page>
  );
}
