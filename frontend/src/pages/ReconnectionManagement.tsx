import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { showToast } from "../components/SweetAlertToast";

const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";
const button = "rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40";
const statuses = ["SUBMITTED", "APPROVED", "REJECTED", "WORK_ORDER_CREATED", "COMPLETED", "CANCELLED"];

export default function ReconnectionManagement() {
  const [filters, setFilters] = useState({ q: "", status: "", feePaymentStatus: "", page: "1", take: "25" });
  const [result, setResult] = useState<any>({ rows: [] });
  const [selected, setSelected] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const currentPage = Number(result.page || filters.page || 1);
  const pageSize = Number(result.take || filters.take || 25);
  const totalPages = Math.max(1, Number(result.pages || 1));
  const totalRows = Number(result.total || 0);
  const firstRow = totalRows ? (currentPage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(currentPage * pageSize, totalRows);
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => Math.max(1, Math.min(currentPage - 2, totalPages - 4)) + index,
  );
  const load = useCallback(async () => {
    setLoading(true);
    try { setResult(await api.listReconnections(filters)); }
    catch (error: any) { showToast(error.message, "error"); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => {
    try { setSelected(await api.getReconnection(id)); setNotes(""); }
    catch (error: any) { showToast(error.message, "error"); }
  };
  const decide = async (decision: "APPROVE" | "REJECT") => {
    if (!selected || notes.trim().length < 3) return;
    setBusy(decision);
    try {
      await api.decideReconnection(selected.reconnectionRequestId, { decision, notes });
      showToast(`Request ${decision === "APPROVE" ? "approved" : "rejected"}.`, "success");
      await Promise.all([load(), open(selected.reconnectionRequestId)]);
    } catch (error: any) { showToast(error.message, "error"); }
    finally { setBusy(""); }
  };
  const createWorkOrder = async () => {
    if (!selected) return;
    setBusy("WORK_ORDER");
    try {
      const created = await api.createReconnectionWorkOrder(selected.reconnectionRequestId, {
        priority: "HIGH",
        description: `Restore water supply for approved reconnection ${selected.requestNumber}. ${selected.reason}`,
      });
      showToast(`Work order ${created.workOrderNumber} created.`, "success");
      await Promise.all([load(), open(selected.reconnectionRequestId)]);
    } catch (error: any) { showToast(error.message, "error"); }
    finally { setBusy(""); }
  };
  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Reconnection Requests</h1>
        <p className="mt-1 text-sm text-slate-500">Review customer requests, apply the configured fee, and dispatch approved reconnections.</p>
      </header>
      <section className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_auto]">
        <input className={input} placeholder="Request, account or phone" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: "1" })} />
        <select className={input} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: "1" })}>
          <option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}
        </select>
        <select className={input} value={filters.feePaymentStatus} onChange={(e) => setFilters({ ...filters, feePaymentStatus: e.target.value, page: "1" })}>
          <option value="">All fee payments</option>
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PENDING">Pending</option>
        </select>
        <div className="flex min-w-24 items-center justify-end text-sm text-slate-500">{result.total ?? 0} request(s)</div>
      </section>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["#","Request","Customer / account","Fee","Fee payment","Status",""].map((h, index) => <th key={`${h}-${index}`} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {loading ? <tr><td colSpan={7} className="p-10 text-center text-slate-500">Loading reconnection requests…</td></tr> :
                  result.rows.map((row: any, index: number) => <tr key={row.reconnectionRequestId} className="transition hover:bg-sky-50/40">
                    <td className="w-14 px-4 py-3 font-semibold text-slate-400">{(currentPage - 1) * pageSize + index + 1}</td>
                    <td className="px-4 py-3"><strong>{row.requestNumber}</strong><div className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleDateString()}</div></td>
                    <td className="px-4 py-3">{row.customerName}<div className="text-xs text-slate-500">{row.accountNumber}</div></td>
                    <td className="px-4 py-3">KSh {Number(row.reconnectionFee).toLocaleString()}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.feePaymentStatus === "PAID" ? "bg-emerald-50 text-emerald-700" : row.feePaymentStatus === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{row.feePaymentStatus}</span></td>
                    <td className="px-4 py-3"><span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">{row.status}</span></td>
                    <td className="px-4 py-3"><button className="font-semibold text-aqua-700" onClick={() => void open(row.reconnectionRequestId)}>Review</button></td>
                  </tr>)}
                {!loading && !result.rows.length && <tr><td colSpan={7} className="p-12 text-center text-sm text-slate-400">No reconnection requests match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-3 text-slate-500">
              <span>Showing <strong className="text-slate-700">{firstRow}–{lastRow}</strong> of <strong className="text-slate-700">{totalRows}</strong></span>
              <label className="flex items-center gap-2">
                <span>Rows</span>
                <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-aqua-500" value={filters.take} onChange={(event) => setFilters({ ...filters, take: event.target.value, page: "1" })}>
                  {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="First page" disabled={currentPage <= 1 || loading} onClick={() => setFilters({ ...filters, page: "1" })} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 hover:border-sky-300 hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-40">«</button>
              <button type="button" aria-label="Previous page" disabled={currentPage <= 1 || loading} onClick={() => setFilters({ ...filters, page: String(currentPage - 1) })} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:border-sky-300 hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
              <div className="hidden items-center gap-1 sm:flex">
                {pageNumbers.map((page) => <button type="button" key={page} aria-label={`Page ${page}`} aria-current={page === currentPage ? "page" : undefined} onClick={() => setFilters({ ...filters, page: String(page) })} className={`min-w-9 rounded-lg border px-2.5 py-1.5 font-semibold ${page === currentPage ? "border-aqua-700 bg-aqua-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-aqua-700"}`}>{page}</button>)}
              </div>
              <span className="px-2 text-xs font-semibold text-slate-500 sm:hidden">{currentPage} / {totalPages}</span>
              <button type="button" aria-label="Next page" disabled={currentPage >= totalPages || loading} onClick={() => setFilters({ ...filters, page: String(currentPage + 1) })} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:border-sky-300 hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              <button type="button" aria-label="Last page" disabled={currentPage >= totalPages || loading} onClick={() => setFilters({ ...filters, page: String(totalPages) })} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 hover:border-sky-300 hover:text-aqua-700 disabled:cursor-not-allowed disabled:opacity-40">»</button>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          {!selected ? <p className="py-20 text-center text-sm text-slate-400">Select a request to review and act.</p> :
            <div className="space-y-4">
              <div><h2 className="font-bold">{selected.requestNumber}</h2><p className="text-sm text-slate-500">{selected.customerName} · {selected.accountNumber}</p></div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm"><p>{selected.reason}</p><dl className="mt-3 grid grid-cols-2 gap-2"><dt className="text-slate-500">Current balance</dt><dd>KSh {Number(selected.currentBalance).toLocaleString()}</dd><dt className="text-slate-500">Reconnection fee</dt><dd>KSh {Number(selected.reconnectionFee).toLocaleString()}</dd><dt className="text-slate-500">Fee payment</dt><dd className="font-semibold">{selected.feePaymentStatus}</dd>{selected.mpesaReceiptNumber && <><dt className="text-slate-500">M-Pesa receipt</dt><dd>{selected.mpesaReceiptNumber}</dd></>}</dl></div>
              {selected.status === "SUBMITTED" && <><textarea className={`${input} min-h-24`} placeholder="Decision notes *" value={notes} onChange={(e) => setNotes(e.target.value)} /><div className="grid grid-cols-2 gap-3"><button className={`${button} bg-red-600`} disabled={!!busy || notes.trim().length < 3} onClick={() => void decide("REJECT")}>Reject</button><button className={`${button} bg-emerald-600`} disabled={!!busy || notes.trim().length < 3} onClick={() => void decide("APPROVE")}>Approve</button></div></>}
              {selected.status === "APPROVED" && <button className={`${button} w-full bg-aqua-700`} disabled={!!busy} onClick={() => void createWorkOrder()}>Create RECONNECTION Work Order</button>}
              {selected.workOrderNumber && <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Linked work order: <strong>{selected.workOrderNumber}</strong></div>}
              {selected.decisionNotes && <div><h3 className="text-sm font-bold">Decision notes</h3><p className="mt-1 text-sm text-slate-600">{selected.decisionNotes}</p></div>}
            </div>}
        </section>
      </div>
    </div>
  );
}
