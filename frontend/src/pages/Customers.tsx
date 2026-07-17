import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { encodeId } from "../lib/hashids";

interface Customer {
  customerId: string;
  customerNumber: string;
  customerType: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  organizationName?: string;
  phoneNumber: string;
  emailAddress?: string;
  status: string;
  registrationDate: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    "bg-green-100 text-green-700",
  INACTIVE:  "bg-slate-100 text-slate-500",
  SUSPENDED: "bg-orange-100 text-orange-700",
  CLOSED:    "bg-red-100 text-red-600",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

const PAGE_SIZE = 20;

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  async function load(q = search, st = statusFilter, pg = page) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCustomers(q, pg, st);
      setCustomers(data.items);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(search, statusFilter, page); }, [page]);

  function handleSearch() {
    setPage(1);
    load(search, statusFilter, 1);
  }

  function handleStatusChange(st: string) {
    setStatusFilter(st);
    setPage(1);
    load(search, st, 1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Customers</h1>
          <p className="text-sm text-slate-400 mt-0.5">{total} total customers</p>
        </div>
        <Link
          to="/customers/new"
          className="inline-flex items-center gap-2 bg-aqua-700 hover:bg-aqua-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          New Customer
        </Link>
      </div>

      {/* ── Filters bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4 px-4 py-3 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-aqua-500 bg-slate-50"
            placeholder="Search name, number, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>

        <select
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-aqua-500"
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CLOSED">Closed</option>
        </select>

        <button
          onClick={handleSearch}
          className="text-sm border border-slate-200 bg-white hover:bg-slate-50 rounded-lg px-4 py-1.5 font-medium transition-colors"
        >
          Search
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* ── Table ── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer No.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Registered</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4 text-aqua-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Loading…
                  </div>
                </td>
              </tr>
            )}
            {!loading && customers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No customers found.</td>
              </tr>
            )}
            {!loading && customers.map((c) => {
              const name = c.customerType === "ORGANIZATION"
                ? c.organizationName
                : [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ");
              return (
                <tr key={c.customerId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/customers/${encodeId(c.customerId)}`}
                      className="text-aqua-700 hover:text-aqua-600 hover:underline"
                    >
                      {c.customerNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                      {c.customerType === "ORGANIZATION" ? "Organization" : "Individual"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.phoneNumber}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {c.registrationDate ? new Date(c.registrationDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
            <span>
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ‹
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const pg = totalPages <= 7 ? i + 1 : i < 3 ? i + 1 : i >= 4 ? totalPages - (6 - i) : page;
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={`px-3 py-1 rounded-lg border transition-colors ${
                      pg === page
                        ? "bg-aqua-700 text-white border-aqua-700"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {pg}
                  </button>
                );
              })}
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

