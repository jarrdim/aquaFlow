import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DateInput } from "../components/DateInput";
import { SearchableSelect } from "../components/SearchableSelect";
import { api } from "../lib/api";

type Row = Record<string, any>;
type InvoiceItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10";
const money = (value: unknown) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString("en-KE") : "—";
const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};
const addDays = (value: string, days: number) => {
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  return new Date(next.getTime() - next.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};
const customerName = (account?: Row) =>
  account?.customer?.organizationName ||
  [
    account?.customer?.firstName,
    account?.customer?.middleName,
    account?.customer?.lastName,
  ]
    .filter(Boolean)
    .join(" ") ||
  "Customer";
const statusTone: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  APPROVED: "bg-violet-100 text-violet-700",
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800",
  PAID: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

function Badge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${statusTone[value] ?? "bg-slate-100 text-slate-700"}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
function Button({
  tone = "blue",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "blue" | "green" | "slate" | "red";
}) {
  const tones = {
    blue: "bg-cyan-700 hover:bg-cyan-800",
    green: "bg-emerald-600 hover:bg-emerald-700",
    slate: "bg-slate-700 hover:bg-slate-800",
    red: "bg-rose-600 hover:bg-rose-700",
  };
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${props.className ?? ""}`}
    />
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
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
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
      <div className="page-screen-header mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
function Notice({
  children,
  good = false,
}: {
  children: ReactNode;
  good?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${good ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}
    >
      {children}
    </div>
  );
}

const emptyItem = (): InvoiceItem => ({
  description: "",
  quantity: "1",
  unitPrice: "",
  taxRate: "0",
});

export function ManualInvoices() {
  const navigate = useNavigate();
  const start = today();
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    accountId: "",
    invoiceDate: start,
    dueDate: addDays(start, 14),
    customerReference: "",
    discountAmount: "0",
    notes: "",
    terms: "Payment is due by the date shown above.",
  });
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);

  const load = async () => {
    setLoading(true);
    try {
      const [invoiceRows, accountRows] = await Promise.all([
        api.listManualInvoices(),
        api.listPaymentAccounts("", true),
      ]);
      setInvoices(invoiceRows);
      setAccounts(accountRows);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const calculated = useMemo(() => {
    const lines = items.map((item) => {
      const subtotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
      const tax = (subtotal * Number(item.taxRate || 0)) / 100;
      return { subtotal, tax, total: subtotal + tax };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const tax = lines.reduce((sum, line) => sum + line.tax, 0);
    return {
      lines,
      subtotal,
      tax,
      total: Math.max(0, subtotal + tax - Number(form.discountAmount || 0)),
    };
  }, [items, form.discountAmount]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter(
      (invoice) =>
        (!status || invoice.status === status) &&
        (!query ||
          [
            invoice.invoiceNumber,
            invoice.account?.accountNumber,
            customerName(invoice.account),
            invoice.customerReference,
          ].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(query),
          )),
    );
  }, [invoices, search, status]);
  const outstanding = visible.reduce(
    (sum, invoice) => sum + Number(invoice.balanceAmount ?? 0),
    0,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !items.every(
        (item) =>
          item.description.trim() &&
          Number(item.quantity) > 0 &&
          Number(item.unitPrice) >= 0,
      )
    )
      return setError("Complete every invoice item before saving.");
    setSaving(true);
    setError("");
    try {
      const created = await api.createManualInvoice({
        ...form,
        discountAmount: Number(form.discountAmount || 0),
        items: items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxRate: Number(item.taxRate || 0),
        })),
      });
      navigate(`/payments/invoices/${created.invoiceId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="Invoices"
      subtitle="Create, issue, collect and print customer invoices"
      actions={
        <Button onClick={() => setShowCreate(true)}>+ New invoice</Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-bold uppercase text-slate-400">
            Invoices
          </div>
          <div className="mt-1 text-2xl font-black text-slate-900">
            {visible.length}
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-bold uppercase text-amber-700">
            Outstanding
          </div>
          <div className="mt-1 text-2xl font-black text-amber-900">
            {money(outstanding)}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-bold uppercase text-emerald-700">
            Paid
          </div>
          <div className="mt-1 text-2xl font-black text-emerald-900">
            {invoices.filter((invoice) => invoice.status === "PAID").length}
          </div>
        </div>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_220px]">
          <input
            className={INPUT}
            placeholder="Search invoice, customer, account or reference"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SearchableSelect
            className={INPUT}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {["DRAFT", "APPROVED", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </SearchableSelect>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Customer / account</th>
                <th className="px-4 py-3">Invoice date</th>
                <th className="px-4 py-3">Due date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((invoice) => (
                <tr
                  key={invoice.invoiceId}
                  className="border-t border-slate-100 text-sm hover:bg-cyan-50/30"
                >
                  <td className="px-4 py-4 font-bold text-slate-900">
                    {invoice.invoiceNumber}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-700">
                      {customerName(invoice.account)}
                    </div>
                    <div className="text-xs text-slate-400">
                      {invoice.account?.accountNumber}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {date(invoice.invoiceDate)}
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {date(invoice.dueDate)}
                  </td>
                  <td className="px-4 py-4">
                    <Badge value={invoice.status} />
                  </td>
                  <td className="px-4 py-4 text-right font-semibold">
                    {money(invoice.totalAmount)}
                  </td>
                  <td className="px-4 py-4 text-right font-bold text-slate-900">
                    {money(invoice.balanceAmount)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      className="font-bold text-cyan-700 hover:underline"
                      to={`/payments/invoices/${invoice.invoiceId}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    {loading
                      ? "Loading invoices…"
                      : "No invoices match the selected filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/55 p-4">
          <form
            onSubmit={submit}
            className="mx-auto my-4 max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  Create invoice
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Add the customer, dates and charge lines. The invoice number
                  is automatic.
                </p>
              </div>
              <button
                type="button"
                className="text-2xl text-slate-400"
                onClick={() => setShowCreate(false)}
              >
                ×
              </button>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
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
                      {accounts.map((account) => (
                        <option
                          key={account.accountId}
                          value={account.accountId}
                        >
                          {account.accountNumber} —{" "}
                          {account.customerName || customerName(account)}
                        </option>
                      ))}
                    </SearchableSelect>
                  </Field>
                </div>
                <Field label="Invoice date" required>
                  <DateInput
                    required
                    className={INPUT}
                    value={form.invoiceDate}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        invoiceDate: e.target.value,
                        dueDate:
                          form.dueDate < e.target.value
                            ? e.target.value
                            : form.dueDate,
                      })
                    }
                  />
                </Field>
                <Field label="Due date" required>
                  <DateInput
                    required
                    min={form.invoiceDate}
                    className={INPUT}
                    value={form.dueDate}
                    onChange={(e) =>
                      setForm({ ...form, dueDate: e.target.value })
                    }
                  />
                </Field>
                <div className="lg:col-span-2">
                  <Field label="Customer reference">
                    <input
                      className={INPUT}
                      value={form.customerReference}
                      onChange={(e) =>
                        setForm({ ...form, customerReference: e.target.value })
                      }
                      placeholder="PO, request or job reference"
                    />
                  </Field>
                </div>
                <Field label="Invoice discount">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={INPUT}
                    value={form.discountAmount}
                    onChange={(e) =>
                      setForm({ ...form, discountAmount: e.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                  <h3 className="font-bold text-slate-800">Invoice items</h3>
                  <button
                    type="button"
                    className="text-sm font-bold text-cyan-700"
                    onClick={() => setItems([...items, emptyItem()])}
                  >
                    + Add line
                  </button>
                </div>
                <div className="space-y-3 p-4">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 md:grid-cols-[minmax(220px,1fr)_100px_140px_100px_130px_auto]"
                    >
                      <input
                        required
                        className={INPUT}
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) =>
                          setItems(
                            items.map((row, i) =>
                              i === index
                                ? { ...row, description: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                      <input
                        required
                        aria-label="Quantity"
                        type="number"
                        min="0.001"
                        step="0.001"
                        className={INPUT}
                        value={item.quantity}
                        onChange={(e) =>
                          setItems(
                            items.map((row, i) =>
                              i === index
                                ? { ...row, quantity: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                      <input
                        required
                        aria-label="Unit price"
                        type="number"
                        min="0"
                        step="0.01"
                        className={INPUT}
                        placeholder="Unit price"
                        value={item.unitPrice}
                        onChange={(e) =>
                          setItems(
                            items.map((row, i) =>
                              i === index
                                ? { ...row, unitPrice: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label="Tax rate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className={INPUT}
                        value={item.taxRate}
                        onChange={(e) =>
                          setItems(
                            items.map((row, i) =>
                              i === index
                                ? { ...row, taxRate: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                      <div className="self-center text-right font-bold text-slate-800">
                        {money(calculated.lines[index]?.total)}
                      </div>
                      <button
                        type="button"
                        disabled={items.length === 1}
                        className="self-center px-2 text-lg text-rose-500 disabled:opacity-25"
                        onClick={() =>
                          setItems(items.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_330px]">
                <div className="space-y-3">
                  <Field label="Notes">
                    <textarea
                      rows={3}
                      className={INPUT}
                      value={form.notes}
                      onChange={(e) =>
                        setForm({ ...form, notes: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Terms">
                    <textarea
                      rows={2}
                      className={INPUT}
                      value={form.terms}
                      onChange={(e) =>
                        setForm({ ...form, terms: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="rounded-xl bg-slate-900 p-4 text-sm text-white">
                  <div className="flex justify-between py-1">
                    <span>Subtotal</span>
                    <strong>{money(calculated.subtotal)}</strong>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Tax</span>
                    <strong>{money(calculated.tax)}</strong>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Discount</span>
                    <strong>- {money(form.discountAmount)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-slate-600 pt-3 text-lg">
                    <span className="font-black">Total</span>
                    <strong>{money(calculated.total)}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-4">
              <Button
                type="button"
                tone="slate"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={saving || !form.accountId || calculated.total <= 0}
              >
                {saving ? "Creating…" : "Create draft invoice"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Page>
  );
}

export function ManualInvoiceDetail() {
  const { id = "" } = useParams();
  const [invoice, setInvoice] = useState<Row>();
  const [channels, setChannels] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const paymentDay = today();
  const [payment, setPayment] = useState({
    channelId: "",
    amount: "",
    transactionReference: "",
    paymentDate: paymentDay,
  });
  const load = async () => {
    try {
      const [row, channelRows] = await Promise.all([
        api.getManualInvoice(id),
        api.listPaymentChannels(),
      ]);
      setInvoice(row);
      setChannels(
        channelRows.filter((channel: Row) => channel.status === "ACTIVE"),
      );
      setPayment((current) => ({
        ...current,
        amount: String(row.balanceAmount),
      }));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);
  const action = async (fn: () => Promise<any>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
      setMessage(success);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const approve = () =>
    action(() => api.approveManualInvoice(id), "Invoice approved successfully.");
  const issue = () =>
    action(() => api.issueManualInvoice(id), "Invoice issued successfully.");
  const cancel = () => {
    const reason = window.prompt("Reason for cancelling this invoice:");
    if (reason?.trim())
      void action(
        () => api.cancelManualInvoice(id, reason.trim()),
        "Invoice cancelled.",
      );
  };
  const pay = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => {
      const result = await api.payManualInvoice(id, {
        ...payment,
        amount: Number(payment.amount),
      });
      setShowPayment(false);
      if (result.receipt?.receiptId)
        setMessage(
          `Payment posted. Receipt ${result.receipt.receiptNumber} is ready.`,
        );
      return result;
    }, "Payment posted successfully.");
  };
  const print = () => {
    document.body.classList.add("printing-invoice");
    window.addEventListener(
      "afterprint",
      () => document.body.classList.remove("printing-invoice"),
      { once: true },
    );
    window.print();
  };
  if (!invoice)
    return (
      <Page title="Invoice" subtitle="Loading invoice details">
        {error && <Notice>{error}</Notice>}
      </Page>
    );
  return (
    <Page
      className="invoice-print-page"
      title={invoice.invoiceNumber}
      subtitle={`${customerName(invoice.account)} · ${invoice.account?.accountNumber}`}
      actions={
        <>
          <Link
            to="/payments/invoices"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
          >
            Back to invoices
          </Link>
          {invoice.status === "DRAFT" && (
            <Button disabled={busy} onClick={approve}>
              Approve invoice
            </Button>
          )}
          {invoice.status === "APPROVED" && (
            <Button disabled={busy} onClick={issue}>
              Issue invoice
            </Button>
          )}
          {["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) && (
            <Button
              tone="green"
              disabled={busy}
              onClick={() => setShowPayment(true)}
            >
              Record payment
            </Button>
          )}
          {["DRAFT", "APPROVED", "ISSUED"].includes(invoice.status) &&
            Number(invoice.paidAmount) === 0 && (
              <Button tone="red" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
            )}
          <Button tone="slate" onClick={print}>
            Print / Save PDF
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice good>{message}</Notice>}
      <section className="invoice-print-document mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="p-6 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-5 border-b-2 border-cyan-700 pb-5">
            <img
              src="/samdamte-water-logo-print.png"
              alt="Samdamte Water Utility Management"
              className="invoice-brand-logo h-auto w-[280px] max-w-[55%] object-contain"
            />
            <div className="text-right">
              <h2 className="text-3xl font-black uppercase tracking-wide text-slate-900">
                Invoice
              </h2>
              <p className="mt-1 font-mono font-bold text-cyan-800">
                {invoice.invoiceNumber}
              </p>
              <div className="mt-2">
                <Badge value={invoice.status} />
              </div>
            </div>
          </header>
          <div className="grid gap-5 py-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Bill to
              </div>
              <div className="mt-2 text-lg font-bold text-slate-900">
                {customerName(invoice.account)}
              </div>
              <div className="text-sm text-slate-600">
                Account {invoice.account?.accountNumber}
              </div>
              <div className="text-sm text-slate-600">
                {invoice.account?.customer?.phoneNumber}
              </div>
              <div className="text-sm text-slate-600">
                {invoice.account?.customer?.emailAddress}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:ml-auto sm:w-80">
              <dt className="text-slate-500">Invoice date</dt>
              <dd className="text-right font-bold">
                {date(invoice.invoiceDate)}
              </dd>
              <dt className="text-slate-500">Due date</dt>
              <dd className="text-right font-bold">{date(invoice.dueDate)}</dd>
              <dt className="text-slate-500">Reference</dt>
              <dd className="text-right font-bold">
                {invoice.customerReference || "—"}
              </dd>
            </dl>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-900 text-left text-white">
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right">Unit price</th>
                  <th className="px-3 py-2.5 text-right">Tax</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item: Row) => (
                  <tr
                    key={item.invoiceItemId}
                    className="border-b border-slate-200"
                  >
                    <td className="px-3 py-3 font-medium">
                      {item.description}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(item.quantity).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {money(item.unitPrice)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(item.taxRate)}%
                    </td>
                    <td className="px-3 py-3 text-right font-bold">
                      {money(item.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_330px]">
            <div className="text-sm text-slate-600">
              {invoice.notes && (
                <div>
                  <div className="font-bold text-slate-800">Notes</div>
                  <p className="mt-1 whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              {invoice.terms && (
                <div className="mt-4">
                  <div className="font-bold text-slate-800">Terms</div>
                  <p className="mt-1 whitespace-pre-wrap">{invoice.terms}</p>
                </div>
              )}
            </div>
            <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="font-bold">{money(invoice.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Tax</dt>
                <dd className="font-bold">{money(invoice.taxAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Discount</dt>
                <dd className="font-bold">- {money(invoice.discountAmount)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-3 text-lg">
                <dt className="font-black">Total</dt>
                <dd className="font-black">{money(invoice.totalAmount)}</dd>
              </div>
              <div className="flex justify-between text-emerald-700">
                <dt>Paid</dt>
                <dd className="font-bold">{money(invoice.paidAmount)}</dd>
              </div>
              <div className="flex justify-between text-lg text-rose-700">
                <dt className="font-black">Balance due</dt>
                <dd className="font-black">{money(invoice.balanceAmount)}</dd>
              </div>
            </dl>
          </div>
          {invoice.payments?.length > 0 && (
            <div className="mt-6 border-t pt-5">
              <h3 className="font-bold text-slate-900">Payments</h3>
              <div className="mt-2 space-y-2">
                {invoice.payments.map((entry: Row) => (
                  <div
                    key={entry.invoicePaymentId}
                    className="flex flex-wrap justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm"
                  >
                    <span>
                      {date(entry.createdAt)} ·{" "}
                      {entry.payment.channel?.channelName} ·{" "}
                      {entry.payment.transactionReference}
                    </span>
                    <span className="font-bold">
                      {money(entry.amount)}{" "}
                      {entry.payment.receipt && (
                        <Link
                          className="ml-3 text-cyan-700 underline"
                          to={`/payments/receipts/${entry.payment.receipt.receiptId}`}
                        >
                          {entry.payment.receipt.receiptNumber}
                        </Link>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <footer className="mt-8 border-t pt-4 text-center text-xs text-slate-400">
            This system-generated invoice is valid without a signature.
          </footer>
        </div>
      </section>
      {showPayment && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4">
          <form
            onSubmit={pay}
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
          >
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-extrabold">Record invoice payment</h2>
              <p className="mt-1 text-sm text-slate-500">
                Balance due: {money(invoice.balanceAmount)}
              </p>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Payment channel" required>
                <SearchableSelect
                  required
                  className={INPUT}
                  value={payment.channelId}
                  onChange={(e) =>
                    setPayment({ ...payment, channelId: e.target.value })
                  }
                >
                  <option value="">Select channel</option>
                  {channels.map((channel) => (
                    <option key={channel.channelId} value={channel.channelId}>
                      {channel.channelName}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
              <Field label="Amount" required>
                <input
                  required
                  type="number"
                  min="0.01"
                  max={Number(invoice.balanceAmount)}
                  step="0.01"
                  className={INPUT}
                  value={payment.amount}
                  onChange={(e) =>
                    setPayment({ ...payment, amount: e.target.value })
                  }
                />
              </Field>
              <Field label="Transaction reference" required>
                <input
                  required
                  className={INPUT}
                  value={payment.transactionReference}
                  onChange={(e) =>
                    setPayment({
                      ...payment,
                      transactionReference: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Payment date" required>
                <DateInput
                  required
                  className={INPUT}
                  value={payment.paymentDate}
                  onChange={(e) =>
                    setPayment({ ...payment, paymentDate: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-4">
              <Button
                type="button"
                tone="slate"
                onClick={() => setShowPayment(false)}
              >
                Cancel
              </Button>
              <Button tone="green" disabled={busy}>
                {busy ? "Posting…" : "Post payment & receipt"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Page>
  );
}
