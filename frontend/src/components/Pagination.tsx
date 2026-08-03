type PaginationProps = {
  page: number;
  totalPages: number;
  total?: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
};

function visiblePages(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("ellipsis");
  for (let value = start; value <= end; value += 1) pages.push(value);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

export function Pagination({ page, totalPages, total, pageSize = 25, onPageChange, disabled = false, label = "records" }: PaginationProps) {
  const pages = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), pages);
  const start = total ? (current - 1) * pageSize + 1 : 0;
  const end = total ? Math.min(current * pageSize, total) : 0;
  return <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">{typeof total === "number" ? `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} ${label}` : `Page ${current} of ${pages}`}</p><nav className="flex flex-wrap items-center gap-1" aria-label={`${label} pagination`}><button type="button" disabled={disabled || current <= 1} onClick={() => onPageChange(current - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-aqua-300 hover:bg-aqua-50 hover:text-aqua-800 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>{visiblePages(current, pages).map((item, index) => item === "ellipsis" ? <span key={`ellipsis-${index}`} className="px-2 text-slate-400">…</span> : <button key={item} type="button" disabled={disabled} aria-current={item === current ? "page" : undefined} onClick={() => onPageChange(item)} className={`grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold transition ${item === current ? "bg-aqua-700 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-aqua-300 hover:bg-aqua-50 hover:text-aqua-800"}`}>{item}</button>)}<button type="button" disabled={disabled || current >= pages} onClick={() => onPageChange(current + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-aqua-300 hover:bg-aqua-50 hover:text-aqua-800 disabled:cursor-not-allowed disabled:opacity-40">Next</button></nav></div>;
}
