import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "../lib/api";
import { SearchableSelect } from "../components/SearchableSelect";
import { CreateLinkedWorkOrderModal } from "../components/CreateLinkedWorkOrderModal";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { hasPermission, isRestrictedStaff } from "../lib/access";

type Target = {
  accountId: string;
  accountNumber: string;
  currentBalance: string;
  customer: {
    customerId: string;
    customerNumber: string;
    firstName?: string;
    lastName?: string;
    organizationName?: string;
  };
  category: { categoryName: string };
  route?: { routeName: string; zone: { zoneName: string } };
};
type Officer = {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
  emailAddress?: string;
};
type Item = {
  serviceRequestId: string;
  requestNumber: string;
  requestType: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  dueAt?: string;
  createdAt: string;
  resolution?: string;
  locationDetails?: string;
  photoEvidence?: string;
  customer?: Target["customer"];
  account?: {
    accountId: string;
    accountNumber: string;
    currentBalance: string;
  };
  assignee?: Officer;
  creator: Officer;
  events?: {
    serviceRequestEventId: string;
    eventType: string;
    oldStatus?: string;
    newStatus?: string;
    comments?: string;
    createdAt: string;
    performer?: Officer;
  }[];
  linkedWorkOrders?: {
    workOrderId: string;
    workOrderNumber: string;
    workOrderTypeId: string;
    typeName: string;
    status: string;
    priority: string;
    description: string;
    scheduledDate?: string;
    dueDate?: string;
    createdAt: string;
    fieldOfficerIds?: string[];
    officerNames?: string;
  }[];
};
const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";
const statuses = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
];
const categories = [
  "BILLING",
  "WATER_SUPPLY",
  "METER",
  "LEAKAGE",
  "WATER_QUALITY",
  "CONNECTION",
  "PAYMENT",
  "STAFF_CONDUCT",
  "OTHER",
];
const activeRequestStatuses = new Set(["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"]);
const pretty = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusTone = (status: string) => ({
  OPEN: "bg-sky-50 text-sky-700 ring-sky-100",
  ASSIGNED: "bg-violet-50 text-violet-700 ring-violet-100",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-100",
  PENDING_CUSTOMER: "bg-orange-50 text-orange-700 ring-orange-100",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-100",
}[status] ?? "bg-slate-100 text-slate-600 ring-slate-200");
const priorityTone = (priority: string) => ({
  URGENT: "bg-red-50 text-red-700",
  HIGH: "bg-orange-50 text-orange-700",
  MEDIUM: "bg-blue-50 text-blue-700",
  LOW: "bg-slate-100 text-slate-600",
}[priority] ?? "bg-slate-100 text-slate-600");
function name(c?: Target["customer"]) {
  return (
    c?.organizationName ||
    [c?.firstName, c?.lastName].filter(Boolean).join(" ") ||
    "Customer"
  );
}
function Loader({ label = "Loading service requests…" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-500">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
      {label}
    </div>
  );
}
function Card({
  title,
  children,
  className = "",
  compact = false,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className={`border-b border-slate-200 font-semibold text-slate-800 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        {title}
      </div>
      <div className={compact ? "p-4" : "p-5"}>{children}</div>
    </section>
  );
}

export function ServiceRequestDashboard() {
  const scopedAccess = isRestrictedStaff();
  const mayCreate = !scopedAccess || hasPermission("SERVICE_REQUEST_CREATE");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const defaultType = location.pathname.endsWith("/complaints")
    ? "COMPLAINT"
    : "";
  const defaultCategory = location.pathname.endsWith("/leaks")
    ? "LEAKAGE"
    : "";
  const [summary, setSummary] = useState<any>();
  const [result, setResult] = useState<any>();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(
    searchParams.get("created") === "1"
      ? defaultType === "COMPLAINT"
        ? "Complaint registered and ready for assignment."
        : "Service request registered successfully."
      : "",
  );
  const filters = {
    q: searchParams.get("q") || "",
    requestType: searchParams.get("requestType") || defaultType,
    status: searchParams.get("status") || "",
    priority: searchParams.get("priority") || "",
    category: searchParams.get("category") || defaultCategory,
    assignedTo: searchParams.get("assignedTo") || "",
    scope: searchParams.get("scope") || "",
    customerId: searchParams.get("customerId") || "",
    page: searchParams.get("page") || "1",
    take: "25",
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, r, o] = await Promise.all([
        api.serviceRequestDashboard(),
        api.listServiceRequests(filters),
        api.listServiceOfficers(),
      ]);
      setSummary(s);
      setResult(r);
      setOfficers(o);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [searchParams.toString(), defaultType, defaultCategory]);
  useEffect(() => {
    load();
  }, [load]);
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setSearchParams(next);
  };
  const applyQuickFilter = (values: Record<string, string>) => {
    const next = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => value && next.set(key, value));
    setSearchParams(next);
  };
  const filtersActive = Boolean(
    filters.q || filters.status || filters.priority || filters.category ||
    filters.assignedTo || filters.scope || searchParams.get("requestType"),
  );
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-white via-sky-50/70 to-cyan-50/80 px-5 py-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
            {defaultCategory === "LEAKAGE"
              ? "Leak Reports"
              : defaultType === "COMPLAINT"
                ? "Complaint register & assignment"
                : "Service requests and complaints"}
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            {defaultType === "COMPLAINT"
              ? "Review every registered complaint, assign responsible staff and track resolution"
              : "Register, assign, track and resolve customer issues within their service deadlines"}
          </p>
        </div>
        {mayCreate && <Link
          to="/service-requests/new"
          className="rounded-xl bg-aqua-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-aqua-600"
        >
          + Register request
        </Link>}
      </div>
      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: "All requests", value: summary.total, filter: {}, tone: "border-slate-200 from-slate-50 text-slate-800" },
            { label: "Open workload", value: summary.open, filter: { scope: "OPEN" }, tone: "border-sky-200 from-sky-50 text-sky-800" },
            { label: "Overdue", value: summary.overdue, filter: { scope: "OVERDUE" }, tone: "border-red-200 from-red-50 text-red-700" },
            { label: "Complaints", value: summary.complaints, filter: { requestType: "COMPLAINT" }, tone: "border-violet-200 from-violet-50 text-violet-700" },
            { label: "Unassigned complaints", value: summary.unassignedComplaints, filter: { requestType: "COMPLAINT", assignedTo: "UNASSIGNED", scope: "OPEN" }, tone: "border-amber-200 from-amber-50 text-amber-700" },
            { label: "Resolved", value: summary.resolved, filter: { scope: "RESOLVED" }, tone: "border-emerald-200 from-emerald-50 text-emerald-700" },
          ].map((item) => (
            <button
              type="button"
              key={item.label}
              onClick={() => applyQuickFilter(item.filter as Record<string, string>)}
              className={`group rounded-xl border bg-gradient-to-br to-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${item.tone}`}
            >
              <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">{item.label}</div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="text-2xl font-black">{Number(item.value || 0).toLocaleString()}</span>
                <span className="text-sm opacity-0 transition group-hover:opacity-70">View →</span>
              </div>
            </button>
          ))}
        </div>
      )}
      <Card title={
        <div className="flex items-center justify-between gap-3">
          <span>Search and filters</span>
          {filtersActive && (
            <button type="button" onClick={() => applyQuickFilter({})} className="text-xs font-bold text-aqua-700 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      }>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className={input}
            placeholder="Request no., account or subject"
            value={filters.q}
            onChange={(e) => updateFilter("q", e.target.value)}
          />
          {[
            ["requestType", "All types", ["SERVICE_REQUEST", "COMPLAINT"]],
            ["status", "All statuses", statuses],
            ["priority", "All priorities", ["LOW", "MEDIUM", "HIGH", "URGENT"]],
            ["category", "All categories", categories],
          ].map(([key, label, options]: any) => (
            <SearchableSelect
              key={key}
              className={input}
              value={(filters as any)[key]}
              onChange={(e) => updateFilter(key, e.target.value)}
            >
              <option value="">{label}</option>
              {options.map((x: string) => (
                <option key={x}>{x}</option>
              ))}
            </SearchableSelect>
          ))}
          <SearchableSelect
            className={input}
            value={filters.assignedTo}
            onChange={(e) => updateFilter("assignedTo", e.target.value)}
          >
            <option value="">All assignees</option>
            <option value="UNASSIGNED">Unassigned only</option>
            {officers.map((officer) => (
              <option key={officer.userId} value={officer.userId}>
                {officer.firstName} {officer.lastName}
              </option>
            ))}
          </SearchableSelect>
        </div>
      </Card>
      <div>
        <Card title={
          <div className="flex items-center justify-between gap-3">
            <span>{defaultType === "COMPLAINT" ? "Complaint queue" : "Request queue"}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              {Number(result?.total || 0).toLocaleString()} record{Number(result?.total || 0) === 1 ? "" : "s"}
            </span>
          </div>
        }>
          {loading ? (
            <Loader />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      {[
                        "#",
                        "Request",
                        "Customer / account",
                        "Issue",
                        "Priority",
                        "Due",
                        "Status",
                        "Assigned to",
                        "Action",
                      ].map((h) => (
                        <th className="px-3 py-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result?.data.map((item: Item, index: number) => (
                      <tr
                        key={item.serviceRequestId}
                        onClick={() => navigate(`/service-requests/${item.serviceRequestId}`)}
                        className="cursor-pointer transition hover:bg-sky-50/70"
                      >
                        <td className="px-3 py-3 text-xs font-bold tabular-nums text-slate-400">
                          {(Number(result?.page || 1) - 1) * Number(result?.take || 25) + index + 1}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold">
                            {item.requestNumber}
                          </div>
                          <div className="text-xs text-slate-500">
                            {pretty(item.requestType)}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div>{name(item.customer)}</div>
                          <div className="text-xs text-slate-500">
                            {item.account?.accountNumber}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-xs truncate font-medium">
                            {item.subject}
                          </div>
                          <div className="text-xs text-slate-500">
                            {pretty(item.category)}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${priorityTone(item.priority)}`}>
                            {pretty(item.priority)}
                          </span>
                        </td>
                        <td className={`px-3 py-3 text-xs font-medium ${item.dueAt && new Date(item.dueAt) < new Date() && activeRequestStatuses.has(item.status) ? "text-red-600" : "text-slate-500"}`}>
                          {item.dueAt ? new Date(item.dueAt).toLocaleDateString("en-KE") : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${statusTone(item.status)}`}>
                            {pretty(item.status)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {item.assignee ? (
                            <div>
                              <div className="font-medium text-slate-700">
                                {item.assignee.firstName} {item.assignee.lastName}
                              </div>
                              <div className="text-xs text-slate-400">Assigned</div>
                            </div>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-aqua-700 shadow-sm hover:border-sky-200 hover:bg-sky-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/service-requests/${item.serviceRequestId}`);
                            }}
                          >
                            Review →
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!result?.data?.length && (
                      <tr>
                        <td colSpan={9} className="px-5 py-16 text-center">
                          <div className="font-semibold text-slate-700">No matching requests found</div>
                          <p className="mt-1 text-sm text-slate-500">Adjust the search or filters to broaden the register.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-between text-sm">
                <span>
                  Page {result?.page || 1} of {result?.pages || 1}
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-3 py-1.5 disabled:opacity-40"
                    disabled={(result?.page || 1) <= 1}
                    onClick={() =>
                      updateFilter("page", String(Number(filters.page) - 1))
                    }
                  >
                    Previous
                  </button>
                  <button
                    className="rounded border px-3 py-1.5 disabled:opacity-40"
                    disabled={(result?.page || 1) >= (result?.pages || 1)}
                    onClick={() =>
                      updateFilter("page", String(Number(filters.page) + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function ComplaintReviewModal({
  requestId,
  onClose,
  onUpdated,
}: {
  requestId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const scopedAccess = isRestrictedStaff();
  const mayAssign = !scopedAccess || hasPermission("SERVICE_REQUEST_ASSIGN");
  const mayResolve = !scopedAccess || hasPermission("SERVICE_REQUEST_RESOLVE");
  const mayCreateWorkOrder = !scopedAccess || hasPermission("WORK_ORDER_CREATE");
  const [request, setRequest] = useState<Item | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [assignee, setAssignee] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [nextStatus, setNextStatus] = useState("IN_PROGRESS");
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState("");
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [workOrderCopy, setWorkOrderCopy] = useState<NonNullable<Item["linkedWorkOrders"]>[number] | undefined>();

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [detail, staff] = await Promise.all([
        api.getServiceRequest(requestId),
        mayAssign ? api.listServiceOfficers() : Promise.resolve([]),
      ]);
      setRequest(detail);
      setOfficers(staff);
      setAssignee(detail.assignee?.userId || "");
      setNextStatus(detail.status === "OPEN" ? "IN_PROGRESS" : detail.status);
      setResolution(detail.resolution || "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [requestId, mayAssign]);

  useEffect(() => {
    void loadDetail();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [loadDetail, onClose]);

  const saveAssignment = async () => {
    if (!request) return;
    setSaving(true);
    setError("");
    try {
      await api.assignServiceRequest(request.serviceRequestId, {
        assigneeId: assignee || null,
        comments: assignmentNote || "Complaint assignment updated",
      });
      setAssignmentNote("");
      setSuccess("Assignment updated successfully.");
      await loadDetail();
      onUpdated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedOfficer = officers.find((officer) => officer.userId === assignee);

  const saveStatus = async () => {
    if (!request) return;
    setSaving(true);
    setError("");
    try {
      await api.updateServiceRequestStatus(request.serviceRequestId, {
        status: nextStatus,
        comments: comment,
        resolution: resolution || undefined,
      });
      setComment("");
      setSuccess("Complaint status updated successfully.");
      await loadDetail();
      onUpdated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complaint-review-title"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-aqua-700">Complaint review</div>
            <h2 id="complaint-review-title" className="truncate text-xl font-bold text-slate-900">
              {request?.requestNumber || "Loading complaint…"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-xl text-slate-500 hover:bg-slate-50" aria-label="Close complaint review">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <SweetAlertToast message={error} type="error" />
          <SweetAlertToast message={success} type="success" />
          {loading ? <Loader label="Loading complaint details…" /> : request ? (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <section className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{request.subject}</h3>
                      <p className="mt-1 text-sm text-slate-500">{name(request.customer)} · {request.account?.accountNumber}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusTone(request.status)}`}>{pretty(request.status)}</span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ["Category", pretty(request.category)],
                      ["Priority", pretty(request.priority)],
                      ["Due", request.dueAt ? new Date(request.dueAt).toLocaleDateString("en-KE") : "Not set"],
                      ["Assigned", request.assignee ? `${request.assignee.firstName} ${request.assignee.lastName}` : "Unassigned"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-sky-100">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">{value}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 whitespace-pre-wrap rounded-xl bg-white p-4 text-sm leading-6 text-slate-700 ring-1 ring-sky-100">{request.description}</p>
                  {request.locationDetails && <p className="mt-3 text-sm text-slate-600"><span className="font-bold">Location:</span> {request.locationDetails}</p>}
                  {request.photoEvidence && (
                    <a href={request.photoEvidence} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-aqua-300">
                      <img src={request.photoEvidence} alt={`Evidence for ${request.requestNumber}`} className="h-16 w-20 rounded-lg object-cover" />
                      <div><div className="text-sm font-bold text-slate-800">Customer photo evidence</div><div className="text-xs text-aqua-700">Open full-size image →</div></div>
                    </a>
                  )}
                </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h3 className="font-bold text-slate-800">Activity history <span className="ml-1 text-xs text-slate-400">({request.events?.length || 0})</span></h3>
                  <div className="mt-4 space-y-4">
                    {request.events?.map((event) => (
                      <div key={event.serviceRequestEventId} className="border-l-2 border-sky-200 pl-4">
                        <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-bold text-slate-700">{pretty(event.eventType)}</span><span className="text-xs text-slate-400">{new Date(event.createdAt).toLocaleString("en-KE")}</span></div>
                        <div className="text-xs text-slate-500">{event.performer ? `${event.performer.firstName} ${event.performer.lastName}` : "Customer"}</div>
                        {event.comments && <p className="mt-1 text-sm text-slate-600">{event.comments}</p>}
                      </div>
                    ))}
                    {!request.events?.length && <p className="py-5 text-center text-sm text-slate-400">No activity recorded yet.</p>}
                  </div>
                </section>
              </div>

              <div className="space-y-4">
                {mayAssign && (
                  <section className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-violet-950">Assign task</h3>
                        <p className="mt-1 text-xs leading-5 text-violet-700">Search an active staff user, confirm the selection, then assign this complaint.</p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700 ring-1 ring-violet-100">Staff</span>
                    </div>
                    <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Find staff user</label>
                    <SearchableSelect className={`${input} mt-1`} menuMinWidth={360} wrapOptions value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                      <option value="">Unassigned</option>
                      {officers.map((officer) => (
                        <option key={officer.userId} value={officer.userId}>
                          {officer.firstName} {officer.lastName} · @{officer.username}{officer.emailAddress ? ` · ${officer.emailAddress}` : ""}
                        </option>
                      ))}
                    </SearchableSelect>
                    {selectedOfficer ? (
                      <div className="mt-3 flex items-center gap-3 rounded-xl border border-violet-100 bg-white p-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-black text-violet-700">
                          {selectedOfficer.firstName.charAt(0)}{selectedOfficer.lastName.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-800">{selectedOfficer.firstName} {selectedOfficer.lastName}</div>
                          <div className="truncate text-xs text-slate-500">@{selectedOfficer.username}{selectedOfficer.emailAddress ? ` · ${selectedOfficer.emailAddress}` : ""}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-dashed border-violet-200 bg-white/70 px-3 py-3 text-center text-xs text-slate-500">No staff user selected</div>
                    )}
                    <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Assignment note <span className="font-normal normal-case text-slate-400">(optional)</span></label>
                    <textarea className={`${input} mt-1`} rows={2} value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} placeholder="Instructions or context for the assignee" />
                    <button type="button" disabled={saving || (!assignee && !request.assignee)} onClick={saveAssignment} className="mt-3 w-full rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40">
                      {saving ? "Saving assignment…" : selectedOfficer ? `Assign to ${selectedOfficer.firstName}` : request.assignee ? "Remove assignment" : "Select a staff user"}
                    </button>
                    {request.assignee && (
                      <button type="button" disabled={saving} onClick={() => { setAssignee(""); setAssignmentNote("Assignment removed"); }} className="mt-2 w-full text-xs font-semibold text-slate-500 hover:text-red-600">
                        Prepare to remove current assignment
                      </button>
                    )}
                  </section>
                )}
                {mayCreateWorkOrder && !["RESOLVED", "CLOSED", "CANCELLED"].includes(request.status) && (
                  <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
                    {request.linkedWorkOrders?.length ? (() => {
                      const latest = request.linkedWorkOrders[0];
                      return <>
                        <div className="flex items-start justify-between gap-2">
                          <div><h3 className="font-bold text-slate-800">Linked field work</h3><p className="mt-0.5 text-xs text-slate-500">{request.linkedWorkOrders.length} work order{request.linkedWorkOrders.length === 1 ? "" : "s"} linked</p></div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusTone(latest.status)}`}>{pretty(latest.status)}</span>
                        </div>
                        <div className="mt-3 rounded-xl border border-sky-100 bg-white p-3 text-sm">
                          <div className="font-bold text-slate-900">{latest.workOrderNumber}</div>
                          <div className="mt-1 text-xs text-slate-500">{latest.typeName} · {latest.officerNames || "Unassigned"}</div>
                        </div>
                        <Link to={`/work-orders?workOrderId=${latest.workOrderId}`} className="mt-3 block w-full rounded-lg bg-aqua-700 px-4 py-2.5 text-center text-sm font-bold text-white">View work order</Link>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => { setWorkOrderCopy(undefined); setWorkOrderOpen(true); }} className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-xs font-bold text-aqua-700">Create another</button>
                          <button type="button" onClick={() => { setWorkOrderCopy(latest); setWorkOrderOpen(true); }} className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-xs font-bold text-aqua-700">Copy previous</button>
                        </div>
                      </>;
                    })() : <>
                      <h3 className="font-bold text-slate-800">Requires field work?</h3>
                      <p className="mt-1 text-sm text-slate-500">Create a work order linked to this complaint.</p>
                      <button type="button" onClick={() => { setWorkOrderCopy(undefined); setWorkOrderOpen(true); }} className="mt-3 block w-full rounded-lg bg-aqua-700 px-4 py-2.5 text-center text-sm font-bold text-white">Create work order</button>
                    </>}
                  </section>
                )}
                {mayResolve && (
                  <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <h3 className="font-bold text-emerald-950">Update progress</h3>
                    <label className="mt-3 block text-sm font-medium">Status<SearchableSelect className={`${input} mt-1`} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</SearchableSelect></label>
                    <label className="mt-3 block text-sm font-medium">Resolution<input className={`${input} mt-1`} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Required when resolving" /></label>
                    <label className="mt-3 block text-sm font-medium">Action comments *<textarea className={`${input} mt-1`} rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Record the action taken" /></label>
                    <button type="button" disabled={saving || !comment.trim()} onClick={saveStatus} className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Update complaint</button>
                  </section>
                )}
              </div>
            </div>
          ) : <div className="py-16 text-center text-sm text-slate-500">Complaint details are unavailable.</div>}
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
        </div>
      </div>
      {workOrderOpen && request && (
        <CreateLinkedWorkOrderModal
          request={request}
          copyFrom={workOrderCopy}
          onClose={() => { setWorkOrderOpen(false); setWorkOrderCopy(undefined); }}
          onCreated={(message) => {
            setWorkOrderOpen(false);
            setWorkOrderCopy(undefined);
            setSuccess(message);
            void loadDetail();
            onUpdated();
          }}
        />
      )}
      </div>,
      document.body,
    );
}

function BulkAssignModal({
  requestIds,
  officers,
  onClose,
  onAssigned,
}: {
  requestIds: string[];
  officers: Officer[];
  onClose: () => void;
  onAssigned: (message: string) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedOfficer = officers.find((officer) => officer.userId === assignee);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const assign = async () => {
    if (!assignee) return;
    setSaving(true);
    setError("");
    try {
      const response = await api.bulkAssignServiceRequests({
        requestIds,
        assigneeId: assignee,
        comments: note || undefined,
      });
      onAssigned(`${Number(response.assigned || requestIds.length).toLocaleString()} tasks assigned to ${selectedOfficer?.firstName || "the selected staff user"}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="bulk-assign-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Bulk allocation</div>
            <h2 id="bulk-assign-title" className="text-xl font-bold text-slate-900">Assign {requestIds.length.toLocaleString()} selected tasks</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-xl text-slate-500 hover:bg-slate-50" aria-label="Close bulk assignment">×</button>
        </div>
        <div className="space-y-4 p-5">
          <SweetAlertToast message={error} type="error" />
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-900">
            Every selected complaint will be allocated to the same staff member and recorded separately in each complaint’s activity history.
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Search and select staff *</span>
            <SearchableSelect className={input} menuMinWidth={420} wrapOptions value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">Search staff by name, username or email</option>
              {officers.map((officer) => (
                <option key={officer.userId} value={officer.userId}>
                  {officer.firstName} {officer.lastName} · @{officer.username}{officer.emailAddress ? ` · ${officer.emailAddress}` : ""}
                </option>
              ))}
            </SearchableSelect>
          </label>
          {selectedOfficer && (
            <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-white p-3 shadow-sm">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-100 font-black text-violet-700">{selectedOfficer.firstName.charAt(0)}{selectedOfficer.lastName.charAt(0)}</div>
              <div className="min-w-0"><div className="truncate font-bold text-slate-800">{selectedOfficer.firstName} {selectedOfficer.lastName}</div><div className="truncate text-xs text-slate-500">@{selectedOfficer.username}{selectedOfficer.emailAddress ? ` · ${selectedOfficer.emailAddress}` : ""}</div></div>
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Instructions <span className="font-normal text-slate-400">(optional)</span></span>
            <textarea className={input} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add instructions that will be recorded on every selected task" />
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="button" disabled={!assignee || saving} onClick={assign} className="rounded-lg bg-violet-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-violet-600 disabled:opacity-40">{saving ? "Assigning tasks…" : `Assign ${requestIds.length} tasks`}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ComplaintManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedAccess = isRestrictedStaff();
  const mayCreate = !scopedAccess || hasPermission("SERVICE_REQUEST_CREATE");
  const mayAssign = !scopedAccess || hasPermission("SERVICE_REQUEST_ASSIGN");
  const [result, setResult] = useState<any>();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("review"));
  const [success, setSuccess] = useState(searchParams.get("created") === "1" ? "Complaint registered successfully." : "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const filters = {
    q: searchParams.get("q") || "",
    requestType: "COMPLAINT",
    status: searchParams.get("status") || "",
    priority: searchParams.get("priority") || "",
    category: searchParams.get("category") || "",
    assignedTo: searchParams.get("assignedTo") || "",
    page: searchParams.get("page") || "1",
    take: searchParams.get("take") || "50",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, staff] = await Promise.all([
        api.listServiceRequests(filters),
        api.listServiceOfficers(),
      ]);
      setResult(list);
      setOfficers(staff);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [searchParams.toString()]);

  useEffect(() => { void load(); }, [load]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setSearchParams(next);
  };
  const closeModal = useCallback(() => {
    setSelectedId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("review");
    next.delete("created");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const assignablePageIds = (result?.data || [])
    .filter((item: Item) => activeRequestStatuses.has(item.status))
    .map((item: Item) => item.serviceRequestId);
  const allPageSelected = assignablePageIds.length > 0 && assignablePageIds.every((requestId: string) => selectedIds.has(requestId));
  const toggleSelection = (requestId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId); else next.add(requestId);
      return next;
    });
  };
  const toggleCurrentPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) assignablePageIds.forEach((requestId: string) => next.delete(requestId));
      else assignablePageIds.forEach((requestId: string) => next.add(requestId));
      return next;
    });
  };
  const completeBulkAssignment = async (message: string) => {
    setBulkAssignOpen(false);
    setSelectedIds(new Set());
    setSuccess(message);
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">Complaints register</h1>
          <p className="mt-1 text-[15px] text-slate-500">View every customer complaint, assign ownership and track it through resolution</p>
        </div>
        {mayCreate && <Link to="/service-requests/new?type=COMPLAINT" className="rounded-xl bg-aqua-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-aqua-600">+ Register complaint</Link>}
      </div>
      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />

      <Card title={<div className="flex items-center justify-between"><span>Find complaints</span><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">Complaints only</span></div>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input className={input} value={filters.q} onChange={(e) => updateFilter("q", e.target.value)} placeholder="Complaint no., customer, account or issue" />
          <SearchableSelect className={input} value={filters.status} onChange={(e) => updateFilter("status", e.target.value)}><option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</SearchableSelect>
          <SearchableSelect className={input} value={filters.priority} onChange={(e) => updateFilter("priority", e.target.value)}><option value="">All priorities</option>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => <option key={priority}>{priority}</option>)}</SearchableSelect>
          <SearchableSelect className={input} value={filters.category} onChange={(e) => updateFilter("category", e.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</SearchableSelect>
          <SearchableSelect className={input} value={filters.assignedTo} onChange={(e) => updateFilter("assignedTo", e.target.value)}><option value="">All assignees</option><option value="UNASSIGNED">Unassigned only</option>{officers.map((officer) => <option key={officer.userId} value={officer.userId}>{officer.firstName} {officer.lastName}</option>)}</SearchableSelect>
        </div>
      </Card>

      <Card title={<div className="flex items-center justify-between gap-3"><span>All complaints</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{Number(result?.total || 0).toLocaleString()} records</span></div>}>
        {loading ? <Loader label="Loading complaints…" /> : (
          <>
            {mayAssign && selectedIds.size > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <div><div className="font-bold text-violet-950">{selectedIds.size.toLocaleString()} task{selectedIds.size === 1 ? "" : "s"} selected</div><div className="text-xs text-violet-700">You can keep selecting across pages before assigning.</div></div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700">Clear</button>
                  <button type="button" onClick={() => setBulkAssignOpen(true)} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-violet-600">Assign selected tasks</button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {mayAssign && <th className="w-12 px-3 py-3"><input type="checkbox" checked={allPageSelected} onChange={toggleCurrentPage} aria-label="Select all assignable complaints on this page" className="h-4 w-4 rounded border-slate-300 text-violet-600" /></th>}
                  {["#", "Complaint", "Customer / account", "Issue", "Priority", "Due", "Status", "Assigned to", "Action"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {result?.data?.map((item: Item, index: number) => (
                    <tr key={item.serviceRequestId} className={`transition hover:bg-violet-50/40 ${selectedIds.has(item.serviceRequestId) ? "bg-violet-50/60" : ""}`}>
                      {mayAssign && <td className="px-3 py-3"><input type="checkbox" checked={selectedIds.has(item.serviceRequestId)} disabled={!activeRequestStatuses.has(item.status)} onChange={() => toggleSelection(item.serviceRequestId)} aria-label={`Select ${item.requestNumber}`} className="h-4 w-4 rounded border-slate-300 text-violet-600 disabled:opacity-30" /></td>}
                      <td className="px-3 py-3 text-xs font-bold text-slate-400">{(Number(result.page || 1) - 1) * Number(result.take || 50) + index + 1}</td>
                      <td className="px-3 py-3"><div className="font-bold text-slate-800">{item.requestNumber}</div><div className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleDateString("en-KE")}</div></td>
                      <td className="px-3 py-3"><div className="font-medium">{name(item.customer)}</div><div className="text-xs text-slate-500">{item.account?.accountNumber}</div></td>
                      <td className="px-3 py-3"><div className="max-w-xs truncate font-medium">{item.subject}</div><div className="text-xs text-slate-500">{pretty(item.category)}</div></td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${priorityTone(item.priority)}`}>{pretty(item.priority)}</span></td>
                      <td className={`px-3 py-3 text-xs ${item.dueAt && new Date(item.dueAt) < new Date() && activeRequestStatuses.has(item.status) ? "font-bold text-red-600" : "text-slate-500"}`}>{item.dueAt ? new Date(item.dueAt).toLocaleDateString("en-KE") : "—"}</td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${statusTone(item.status)}`}>{pretty(item.status)}</span></td>
                      <td className="px-3 py-3">{item.assignee ? <><div className="font-medium">{item.assignee.firstName} {item.assignee.lastName}</div><div className="text-xs text-slate-400">Assigned</div></> : <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Unassigned</span>}</td>
                      <td className="px-3 py-3"><button type="button" onClick={() => setSelectedId(item.serviceRequestId)} className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 shadow-sm hover:bg-violet-50">Review</button></td>
                    </tr>
                  ))}
                  {!result?.data?.length && <tr><td colSpan={mayAssign ? 10 : 9} className="px-5 py-16 text-center"><div className="font-semibold text-slate-700">No complaints found</div><p className="mt-1 text-sm text-slate-500">Adjust the filters or register the first complaint.</p></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-500"><span>Rows</span><select className="rounded-lg border border-slate-200 px-2 py-1.5" value={filters.take} onChange={(e) => updateFilter("take", e.target.value)}>{[25, 50, 100, 500].map((size) => <option key={size}>{size}</option>)}</select><span>Page {result?.page || 1} of {result?.pages || 1}</span></div>
              <div className="flex gap-2"><button className="rounded-lg border px-3 py-1.5 disabled:opacity-40" disabled={(result?.page || 1) <= 1} onClick={() => updateFilter("page", String(Number(filters.page) - 1))}>Previous</button><button className="rounded-lg border px-3 py-1.5 disabled:opacity-40" disabled={(result?.page || 1) >= (result?.pages || 1)} onClick={() => updateFilter("page", String(Number(filters.page) + 1))}>Next</button></div>
            </div>
          </>
        )}
      </Card>
      {selectedId && <ComplaintReviewModal requestId={selectedId} onClose={closeModal} onUpdated={load} />}
      {bulkAssignOpen && <BulkAssignModal requestIds={[...selectedIds]} officers={officers} onClose={() => setBulkAssignOpen(false)} onAssigned={(message) => void completeBulkAssignment(message)} />}
    </div>
  );
}

export function ServiceRequestReview() {
  const { requestId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const scopedAccess = isRestrictedStaff();
  const mayAssign = !scopedAccess || hasPermission("SERVICE_REQUEST_ASSIGN");
  const mayResolve = !scopedAccess || hasPermission("SERVICE_REQUEST_RESOLVE");
  const mayCreateWorkOrder = !scopedAccess || hasPermission("WORK_ORDER_CREATE");
  const [request, setRequest] = useState<Item | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(
    searchParams.get("created") === "1" ? "Service request registered successfully." : "",
  );
  const [assignee, setAssignee] = useState("");
  const [nextStatus, setNextStatus] = useState("IN_PROGRESS");
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [workOrderCopy, setWorkOrderCopy] = useState<NonNullable<Item["linkedWorkOrders"]>[number] | undefined>();

  const loadRequest = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [detail, staff] = await Promise.all([
        api.getServiceRequest(requestId),
        mayAssign ? api.listServiceOfficers() : Promise.resolve([]),
      ]);
      setRequest(detail);
      setOfficers(staff);
      setAssignee(detail.assignee?.userId || "");
      setNextStatus(detail.status === "OPEN" ? "IN_PROGRESS" : detail.status);
      setResolution(detail.resolution || "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [requestId, mayAssign]);

  useEffect(() => {
    void loadRequest();
  }, [loadRequest]);

  const saveAssignment = async () => {
    if (!request) return;
    setSaving(true);
    setError("");
    try {
      await api.assignServiceRequest(request.serviceRequestId, {
        assigneeId: assignee || null,
        comments: comment || "Assignment updated",
      });
      setComment("");
      setSuccess("Assignment updated successfully.");
      await loadRequest();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveStatus = async () => {
    if (!request) return;
    setSaving(true);
    setError("");
    try {
      await api.updateServiceRequestStatus(request.serviceRequestId, {
        status: nextStatus,
        comments: comment,
        resolution: resolution || undefined,
      });
      setComment("");
      setSuccess("Request status updated successfully.");
      await loadRequest();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const returnTo = request?.requestType === "COMPLAINT"
    ? "/service-requests/complaints"
    : "/service-requests";

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 lg:px-6 lg:py-5">
      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />
      <div className="page-screen-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to={returnTo} className="text-sm font-semibold text-aqua-700 hover:underline">
            ← Back to request queue
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
            Request review
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            Review the customer issue, ownership, progress and complete history in one workspace
          </p>
        </div>
        {request && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Request number</div>
              <div className="font-bold text-slate-900">{request.requestNumber}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${statusTone(request.status)}`}>
              {pretty(request.status)}
            </span>
          </div>
        )}
      </div>

      {loading ? <Card title="Loading request"><Loader label="Loading request workspace…" /></Card> : request ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4">
            <Card title="Customer request">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${priorityTone(request.priority)}`}>
                      {pretty(request.priority)} priority
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                      {pretty(request.requestType)}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{request.subject}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {name(request.customer)} · {request.account?.accountNumber || "No account"}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Registered {new Date(request.createdAt).toLocaleString("en-KE")}</div>
                  <div className="mt-1 font-semibold text-slate-700">
                    Due {request.dueAt ? new Date(request.dueAt).toLocaleString("en-KE") : "not set"}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  ["Category", pretty(request.category)],
                  ["Assigned to", request.assignee ? `${request.assignee.firstName} ${request.assignee.lastName}` : "Unassigned"],
                  ["Registered by", `${request.creator.firstName} ${request.creator.lastName}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                    <div className="mt-1 font-semibold text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-sky-700">Description</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.description}</p>
              </div>
              {request.locationDetails && (
                <div className="mt-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                  <span className="font-bold text-slate-800">Location: </span>{request.locationDetails}
                </div>
              )}
            </Card>

            {request.photoEvidence && (
              <Card title="Customer evidence">
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="group grid w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-aqua-400 hover:shadow-md md:grid-cols-[240px_1fr]"
                >
                  <img src={request.photoEvidence} alt={`Evidence for ${request.requestNumber}`} className="h-44 w-full object-cover" />
                  <div className="flex flex-col justify-center p-5">
                    <div className="font-bold text-slate-800">Photo supplied with this request</div>
                    <p className="mt-1 text-sm text-slate-500">Open the original image to inspect or download it.</p>
                    <span className="mt-3 text-sm font-bold text-aqua-700">View full size →</span>
                  </div>
                </button>
              </Card>
            )}

            <Card title={`Activity history · ${request.events?.length || 0}`}>
              <div className="space-y-4">
                {request.events?.map((event) => (
                  <div key={event.serviceRequestEventId} className="relative border-l-2 border-sky-200 pb-1 pl-5">
                    <span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-white bg-aqua-600 ring-1 ring-sky-200" />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="font-semibold text-slate-800">{pretty(event.eventType)}</div>
                      <div className="text-xs text-slate-400">{new Date(event.createdAt).toLocaleString("en-KE")}</div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {event.performer ? `${event.performer.firstName} ${event.performer.lastName}` : "Customer"}
                      {event.oldStatus && event.newStatus ? ` · ${pretty(event.oldStatus)} → ${pretty(event.newStatus)}` : ""}
                    </div>
                    {event.comments && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{event.comments}</p>}
                  </div>
                ))}
                {!request.events?.length && <p className="py-8 text-center text-sm text-slate-400">No activity recorded yet.</p>}
              </div>
            </Card>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24">
            {mayCreateWorkOrder && !["RESOLVED", "CLOSED", "CANCELLED"].includes(request.status) && (
              <Card title="Field work">
                {request.linkedWorkOrders?.length ? (() => {
                  const latest = request.linkedWorkOrders[0];
                  return <div className="space-y-3">
                    <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
                      <div className="flex items-center justify-between gap-2"><strong>{latest.workOrderNumber}</strong><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusTone(latest.status)}`}>{pretty(latest.status)}</span></div>
                      <div className="mt-1 text-xs text-slate-500">{latest.typeName} · {latest.officerNames || "Unassigned"}</div>
                    </div>
                    <Link to={`/work-orders?workOrderId=${latest.workOrderId}`} className="block w-full rounded-lg bg-aqua-700 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-aqua-600">View work order</Link>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => { setWorkOrderCopy(undefined); setWorkOrderOpen(true); }} className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-bold text-aqua-700">Create another</button>
                      <button type="button" onClick={() => { setWorkOrderCopy(latest); setWorkOrderOpen(true); }} className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-bold text-aqua-700">Copy previous</button>
                    </div>
                  </div>;
                })() : <>
                  <p className="mb-4 text-sm text-slate-500">Create a linked work order when this request requires an on-site visit.</p>
                  <button type="button" onClick={() => { setWorkOrderCopy(undefined); setWorkOrderOpen(true); }} className="block w-full rounded-lg bg-aqua-700 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-aqua-600">Create linked work order</button>
                </>}
              </Card>
            )}
            {mayAssign && (
              <Card title="Ownership">
                <label className="block text-sm font-medium text-slate-700">Responsible staff</label>
                <SearchableSelect className={`${input} mt-1`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Leave unassigned</option>
                  {officers.map((officer) => <option key={officer.userId} value={officer.userId}>{officer.firstName} {officer.lastName}</option>)}
                </SearchableSelect>
                <button type="button" disabled={saving} onClick={saveAssignment} className="mt-3 w-full rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                  {saving ? "Saving…" : "Save assignment"}
                </button>
              </Card>
            )}
            {mayResolve && (
              <Card title="Progress and resolution">
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">
                    Next status
                    <SearchableSelect className={`${input} mt-1`} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                      {statuses.map((status) => <option key={status}>{status}</option>)}
                    </SearchableSelect>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Resolution
                    <input className={`${input} mt-1`} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Required to resolve or close" />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Action comments *
                    <textarea className={`${input} mt-1`} rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Record the action taken" />
                  </label>
                  <button type="button" disabled={saving || !comment.trim()} onClick={saveStatus} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                    {saving ? "Updating…" : "Update request"}
                  </button>
                </div>
              </Card>
            )}
          </aside>
        </div>
      ) : (
        <Card title="Request unavailable">
          <div className="py-14 text-center">
            <div className="font-semibold text-slate-700">This request could not be loaded.</div>
            <Link to="/service-requests" className="mt-3 inline-block text-sm font-bold text-aqua-700 hover:underline">Return to request queue</Link>
          </div>
        </Card>
      )}

      {photoOpen && request?.photoEvidence && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setPhotoOpen(false)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div><div className="font-bold">Customer photo evidence</div><div className="text-xs text-slate-500">{request.requestNumber}</div></div>
              <button type="button" onClick={() => setPhotoOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold">Close</button>
            </div>
            <div className="flex max-h-[75vh] items-center justify-center bg-slate-950 p-2">
              <img src={request.photoEvidence} alt={`Evidence for ${request.requestNumber}`} className="max-h-[73vh] max-w-full object-contain" />
            </div>
            <div className="flex justify-end px-4 py-3">
              <a href={request.photoEvidence} download={`evidence-${request.requestNumber}.jpg`} className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white">Download photo</a>
            </div>
          </div>
        </div>
      )}
      {workOrderOpen && request && (
        <CreateLinkedWorkOrderModal
          request={request}
          copyFrom={workOrderCopy}
          onClose={() => { setWorkOrderOpen(false); setWorkOrderCopy(undefined); }}
          onCreated={(message) => {
            setWorkOrderOpen(false);
            setWorkOrderCopy(undefined);
            setSuccess(message);
            void loadRequest();
          }}
        />
      )}
    </div>
  );
}

export function RegisterServiceRequest() {
  const mayAssignOnCreate = !isRestrictedStaff() || hasPermission("SERVICE_REQUEST_ASSIGN");
  const navigate = useNavigate();
  const [registerParams] = useSearchParams();
  const registeringComplaint = registerParams.get("type") === "COMPLAINT";
  const [targets, setTargets] = useState<Target[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    accountId: "",
    requestType: registeringComplaint ? "COMPLAINT" : "SERVICE_REQUEST",
    category: "WATER_SUPPLY",
    subject: "",
    description: "",
    contactChannel: "PHONE",
    priority: "MEDIUM",
    assignedTo: "",
  });
  useEffect(() => {
    Promise.all([api.listServiceRequestTargets(), api.listServiceOfficers()])
      .then(([t, o]) => {
        setTargets(t);
        setOfficers(o);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const selected = useMemo(
    () => targets.find((t) => t.accountId === form.accountId),
    [targets, form.accountId],
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.accountId) return setError("Select a customer account before registering the request.");
    if (!form.subject.trim()) return setError("Enter a short subject for the request.");
    if (!form.description.trim()) return setError("Describe the customer issue or requested service.");
    setSaving(true);
    setError("");
    try {
      const created = await api.createServiceRequest({
        ...form,
        assignedTo: form.assignedTo || null,
      });
      const createdId = encodeURIComponent(String(created.serviceRequestId));
      navigate(
        form.requestType === "COMPLAINT"
          ? `/service-requests/complaints?review=${createdId}&created=1`
          : `/service-requests/${createdId}?created=1`,
        { replace: true },
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-3 p-3 lg:px-5 lg:py-3">
      <div className="page-screen-header relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-white via-sky-50/80 to-cyan-50/70 px-5 py-3 shadow-sm">
        <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-sky-200/25" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-aqua-700 text-white shadow-sm shadow-sky-200">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M9 5h6M9 3h6v4H9z" /><path d="M7 5H5v16h14V5h-2M8 12h8M8 16h5" /></svg>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-aqua-700">Service desk</div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">{registeringComplaint ? "Register complaint" : "Register service request"}</h1>
            <p className="text-xs text-slate-500">{registeringComplaint ? "Capture the complaint, set its urgency and route it to the right staff member." : "Capture the customer request, set its urgency and route it to the right staff member."}</p>
          </div>
        </div>
      </div>
      <SweetAlertToast message={error} type="error" />
      {loading ? (
        <Loader label="Loading customer accounts…" />
      ) : (
        <form
          onSubmit={submit}
          className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]"
        >
          <Card compact title="Request details" className="shadow-md shadow-slate-200/40">
            <div className="mb-3 flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-sm font-bold text-aqua-700 shadow-sm">1</span>
              <div><div className="text-sm font-bold text-slate-800">Select the customer first</div><p className="text-xs text-slate-500">The account connects this request to the correct customer, property and service area.</p></div>
            </div>
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Customer account *
                </span>
                <SearchableSelect
                  className={input}
                  value={form.accountId}
                  onChange={(e) =>
                    setForm({ ...form, accountId: e.target.value })
                  }
                >
                  <option value="">Search or select a customer account</option>
                  {targets.map((t) => (
                    <option key={t.accountId} value={t.accountId}>
                      {t.accountNumber} · {name(t.customer)}
                    </option>
                  ))}
                </SearchableSelect>
              </label>
              {[
                ["requestType", "Type", ["SERVICE_REQUEST", "COMPLAINT"]],
                ["category", "Category", categories],
                [
                  "contactChannel",
                  "Contact channel",
                  ["PHONE", "EMAIL", "SMS", "WALK_IN", "WEB", "OTHER"],
                ],
                ["priority", "Priority", ["LOW", "MEDIUM", "HIGH", "URGENT"]],
              ].map(([key, label, options]: any) => (
                <label key={key}>
                  <span className="mb-1 block text-sm font-medium">
                    {label}
                  </span>
                  <SearchableSelect
                    className={input}
                    value={(form as any)[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  >
                    {options.map((x: string) => (
                      <option key={x} value={x}>{pretty(x)}</option>
                    ))}
                  </SearchableSelect>
                </label>
              ))}
              <label className="md:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Subject *
                </span>
                <input
                  className={input}
                  value={form.subject}
                  placeholder={registeringComplaint ? "Briefly state the complaint" : "Briefly state what the customer needs"}
                  onChange={(e) =>
                    setForm({ ...form, subject: e.target.value })
                  }
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Description *
                </span>
                <textarea
                  className={input}
                  rows={3}
                  value={form.description}
                  placeholder="Include relevant details, location information and what the customer has already tried."
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              {mayAssignOnCreate && <label className="md:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Assign now (optional)
                </span>
                <SearchableSelect
                  className={input}
                  value={form.assignedTo}
                  onChange={(e) =>
                    setForm({ ...form, assignedTo: e.target.value })
                  }
                >
                  <option value="">Leave unassigned</option>
                  {officers.map((o) => (
                    <option key={o.userId} value={o.userId}>
                      {o.firstName} {o.lastName}
                    </option>
                  ))}
                </SearchableSelect>
                <span className="mt-1 block text-[11px] text-slate-500">Leave blank to place this request in the unassigned queue.</span>
              </label>}
            </div>
          </Card>
          <Card compact title="Customer summary" className="shadow-md shadow-slate-200/40 xl:sticky xl:top-3">
            {selected ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Selected customer</div>
                  <div className="mt-1 text-base font-bold text-slate-900">{name(selected.customer)}</div>
                  <div className="text-xs text-slate-500">
                    {selected.customer.customerNumber}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase text-slate-400">Account</div>
                  <div className="mt-1 font-bold text-slate-800">{selected.accountNumber}</div>
                  <div className="text-slate-500">
                    {selected.category.categoryName}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <div className="text-xs text-slate-500">Route / zone</div>
                  <div>
                    {selected.route
                      ? `${selected.route.routeName} · ${selected.route.zone.zoneName}`
                      : "Unassigned"}
                  </div>
                </div>
                <div className="flex items-end justify-between rounded-xl border border-slate-100 p-3">
                  <div className="text-xs text-slate-500">Current balance</div>
                  <div className="text-base font-bold text-slate-900">
                    KSh {Number(selected.currentBalance).toLocaleString()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-32 flex-col items-center justify-center px-4 py-5 text-center">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-400"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></div>
                <div className="mt-2 font-bold text-slate-700">No customer selected</div>
                <p className="mt-1 max-w-56 text-sm text-slate-400">Select an account to preview and confirm the customer details.</p>
              </div>
            )}
            <button
              disabled={saving || !form.accountId}
              className="mt-3 w-full rounded-xl bg-aqua-700 px-4 py-2.5 font-bold text-white shadow-sm transition hover:bg-aqua-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {saving ? "Registering…" : registeringComplaint ? "Register complaint" : "Register service request"}
            </button>
          </Card>
        </form>
      )}
    </div>
  );
}
