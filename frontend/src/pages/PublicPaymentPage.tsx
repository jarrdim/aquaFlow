import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";

type PaymentDetails = {
  accountNumber: string;
  customerName: string;
  phoneNumber: string;
  outstandingBalance: number;
  noticeNumber: string;
  paymentDeadline?: string;
};

const money = (value: unknown) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function PublicPaymentPage() {
  const { token = "" } = useParams();
  const [details, setDetails] = useState<PaymentDetails>();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [requestId, setRequestId] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api
      .getPublicPaymentLink(token)
      .then((row) => {
        setDetails(row);
        setPhoneNumber(String(row.phoneNumber ?? ""));
        setAmount(String(Math.max(0, Math.ceil(Number(row.outstandingBalance ?? 0)))));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!requestId || !["PENDING"].includes(status)) return;
    const timer = window.setInterval(() => {
      api
        .getPublicPaymentStatus(token, requestId)
        .then((row) => {
          setStatus(row.status);
          if (row.status === "COMPLETED")
            setMessage(
              `Payment confirmed${row.mpesaReceiptNumber ? ` · M-Pesa receipt ${row.mpesaReceiptNumber}` : ""}. Thank you.`,
            );
          else if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(row.status))
            setError(row.resultDescription || "The M-Pesa payment was not completed.");
        })
        .catch((reason) => setError(reason.message));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [requestId, status, token]);

  async function pay(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSending(true);
    try {
      const row = await api.initiatePublicPayment(token, {
        phoneNumber,
        amount: Number(amount),
      });
      setRequestId(String(row.stkRequestId));
      setStatus(row.status);
      setMessage(row.customerMessage || "Check your phone and enter your M-Pesa PIN.");
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:py-12">
      <main className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-300/30">
        <header className="border-b border-slate-100 bg-gradient-to-r from-white to-cyan-50 px-6 py-5 sm:px-8">
          <Link to="/" aria-label="Samdamte home">
            <img src="/samdamte-water-logo-print.png" alt="Samdamte Water Utility Management" className="h-16 w-auto" />
          </Link>
        </header>
        <section className="px-6 py-7 sm:px-8">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-aqua-700">Secure M-Pesa payment</p>
            <h1 className="mt-2 text-2xl font-extrabold">Pay your water account</h1>
            <p className="mt-1 text-sm text-slate-500">Confirm the details below, then approve the prompt sent to your phone.</p>
          </div>

          {loading && <div className="rounded-2xl bg-slate-50 p-8 text-center text-slate-500">Loading secure payment details…</div>}
          {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
          {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}

          {details && (
            <>
              <div className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex justify-between gap-4"><span className="text-slate-500">Customer</span><strong className="text-right">{details.customerName}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-slate-500">Account number</span><strong>{details.accountNumber}</strong></div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-3"><span className="text-slate-500">Outstanding balance</span><strong className="text-lg text-rose-600">{money(details.outstandingBalance)}</strong></div>
              </div>

              <form onSubmit={pay} className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-slate-700">Amount (whole KSh)</span>
                  <input required type="number" min="1" max={Math.max(1, Math.ceil(details.outstandingBalance))} step="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg font-bold outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20" />
                  <span className="mt-1 block text-xs text-slate-500">You may make a full or partial payment.</span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-slate-700">Safaricom phone number</span>
                  <input required inputMode="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="07XXXXXXXX" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20" />
                </label>
                <button disabled={sending || status === "PENDING" || status === "COMPLETED"} className="w-full rounded-xl bg-emerald-600 px-5 py-3.5 text-base font-extrabold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                  {sending ? "Sending M-Pesa prompt…" : status === "PENDING" ? "Waiting for M-Pesa confirmation…" : status === "COMPLETED" ? "Payment confirmed" : "Pay Now"}
                </button>
              </form>
              <p className="mt-5 text-center text-xs leading-5 text-slate-400">Samdamte will never ask you to enter your M-Pesa PIN on this website. Enter it only in the secure prompt on your phone.</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
