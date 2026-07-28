import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { api } from "../lib/api";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";

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
    performer: Officer;
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-800">
        {title}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function ServiceRequestDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const defaultType = location.pathname.endsWith("/complaints")
    ? "COMPLAINT"
    : "";
  const [summary, setSummary] = useState<any>();
  const [result, setResult] = useState<any>();
  const [selected, setSelected] = useState<Item | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState("");
  const [nextStatus, setNextStatus] = useState("IN_PROGRESS");
  const [assignee, setAssignee] = useState("");
  const filters = {
    q: searchParams.get("q") || "",
    requestType: searchParams.get("requestType") || defaultType,
    status: searchParams.get("status") || "",
    priority: searchParams.get("priority") || "",
    category: searchParams.get("category") || "",
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
  }, [searchParams.toString(), defaultType]);
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
  const open = async (item: Item) => {
    setSelected(item);
    setDetailLoading(true);
    try {
      const d = await api.getServiceRequest(item.serviceRequestId);
      setSelected(d);
      setAssignee(d.assignee?.userId || "");
      setNextStatus(d.status === "OPEN" ? "IN_PROGRESS" : d.status);
      setResolution(d.resolution || "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };
  const saveAssignment = async () => {
    if (!selected) return;
    try {
      await api.assignServiceRequest(selected.serviceRequestId, {
        assigneeId: assignee || null,
        comments: comment || "Assignment updated",
      });
      setSuccess("Assignment updated.");
      setComment("");
      await open(selected);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const saveStatus = async () => {
    if (!selected) return;
    try {
      await api.updateServiceRequestStatus(selected.serviceRequestId, {
        status: nextStatus,
        comments: comment,
        resolution: resolution || undefined,
      });
      setSuccess("Request status updated.");
      setComment("");
      await open(selected);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
            {defaultType === "COMPLAINT"
              ? "Complaints"
              : "Service requests and complaints"}
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            Register, assign, track and resolve customer issues within their
            service deadlines
          </p>
        </div>
        <Link
          to="/service-requests/new"
          className="rounded-lg bg-aqua-700 px-4 py-2.5 text-sm font-semibold text-white"
        >
          + Register request
        </Link>
      </div>
      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["All requests", summary.total],
            ["Open workload", summary.open],
            ["Overdue", summary.overdue],
            ["Complaints", summary.complaints],
            ["Resolved", summary.resolved],
          ].map(([l, v]) => (
            <div
              key={String(l)}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="text-xs font-semibold uppercase text-slate-500">
                {l}
              </div>
              <div className="mt-1 text-2xl font-bold">
                {Number(v || 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
      <Card title="Search and filters">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.65fr)]">
        <Card title={`${result?.total || 0} request(s)`}>
          {loading ? (
            <Loader />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      {[
                        "Request",
                        "Customer / account",
                        "Issue",
                        "Priority",
                        "Due",
                        "Status",
                        "Action",
                      ].map((h) => (
                        <th className="px-3 py-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result?.data.map((item: Item) => (
                      <tr
                        key={item.serviceRequestId}
                        className={
                          selected?.serviceRequestId === item.serviceRequestId
                            ? "bg-sky-50"
                            : ""
                        }
                      >
                        <td className="px-3 py-3">
                          <div className="font-semibold">
                            {item.requestNumber}
                          </div>
                          <div className="text-xs text-slate-500">
                            {item.requestType.replace("_", " ")}
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
                            {item.category}
                          </div>
                        </td>
                        <td className="px-3 py-3">{item.priority}</td>
                        <td className="px-3 py-3 text-slate-500">
                          {item.dueAt
                            ? new Date(item.dueAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-aqua-700">
                            {item.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            className="font-semibold text-aqua-700"
                            onClick={() => open(item)}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
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
        <Card
          title={
            selected ? `Manage ${selected.requestNumber}` : "Request details"
          }
        >
          {!selected ? (
            <p className="py-16 text-center text-sm text-slate-400">
              Select a request to review its history and take action.
            </p>
          ) : detailLoading ? (
            <Loader label="Loading request history…" />
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex justify-between">
                  <div>
                    <h2 className="font-bold">{selected.subject}</h2>
                    <p className="text-sm text-slate-500">
                      {name(selected.customer)} ·{" "}
                      {selected.account?.accountNumber}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-aqua-700">
                    {selected.status}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-700">
                  {selected.description}
                </p>
              </div>
              {!["RESOLVED", "CLOSED", "CANCELLED"].includes(selected.status) && (
                <Link
                  to={`/work-orders/new?serviceRequestId=${selected.serviceRequestId}`}
                  className="block w-full rounded-lg bg-aqua-700 px-4 py-2.5 text-center text-sm font-bold text-white"
                >
                  Create linked work order
                </Link>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Assigned officer
                </span>
                <SearchableSelect
                  className={input}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {officers.map((o) => (
                    <option key={o.userId} value={o.userId}>
                      {o.firstName} {o.lastName}
                    </option>
                  ))}
                </SearchableSelect>
              </label>
              <button
                onClick={saveAssignment}
                className="w-full rounded-lg border border-aqua-600 px-4 py-2 text-sm font-semibold text-aqua-700"
              >
                Save assignment
              </button>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-sm font-medium">
                    Next status
                  </span>
                  <SearchableSelect
                    className={input}
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </SearchableSelect>
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium">
                    Resolution
                  </span>
                  <input
                    className={input}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="Required to resolve/close"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Action comments *
                </span>
                <textarea
                  className={input}
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Record what was done"
                />
              </label>
              <button
                disabled={!comment.trim()}
                onClick={saveStatus}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white disabled:opacity-40"
              >
                Update request
              </button>
              <div>
                <h3 className="mb-2 text-sm font-bold">Activity history</h3>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {selected.events?.map((event) => (
                    <div
                      key={event.serviceRequestEventId}
                      className="border-l-2 border-sky-200 pl-3 text-sm"
                    >
                      <div className="font-semibold">
                        {event.eventType.replace("_", " ")}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(event.createdAt).toLocaleString()} ·{" "}
                        {event.performer.firstName} {event.performer.lastName}
                      </div>
                      {event.comments && (
                        <p className="mt-1 text-slate-600">{event.comments}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function RegisterServiceRequest() {
  const navigate = useNavigate();
  const [targets, setTargets] = useState<Target[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    accountId: "",
    requestType: "SERVICE_REQUEST",
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
    setSaving(true);
    setError("");
    try {
      await api.createServiceRequest({
        ...form,
        assignedTo: form.assignedTo || null,
      });
      navigate("/service-requests", { replace: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
          Register service request
        </h1>
        <p className="mt-1 text-[15px] text-slate-500">
          Capture a customer request or complaint and assign its response
          priority
        </p>
      </div>
      <SweetAlertToast message={error} type="error" />
      {loading ? (
        <Loader label="Loading customer accounts…" />
      ) : (
        <form
          onSubmit={submit}
          className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]"
        >
          <Card title="Request details">
            <div className="grid gap-4 md:grid-cols-2">
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
                  <option value="">Select account</option>
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
                      <option key={x}>{x}</option>
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
                  required
                  value={form.subject}
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
                  required
                  rows={6}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <label className="md:col-span-2">
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
              </label>
            </div>
          </Card>
          <Card title="Customer summary">
            {selected ? (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Customer</div>
                  <div className="font-bold">{name(selected.customer)}</div>
                  <div className="text-slate-500">
                    {selected.customer.customerNumber}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Account</div>
                  <div className="font-bold">{selected.accountNumber}</div>
                  <div className="text-slate-500">
                    {selected.category.categoryName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Route / zone</div>
                  <div>
                    {selected.route
                      ? `${selected.route.routeName} · ${selected.route.zone.zoneName}`
                      : "Unassigned"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Current balance</div>
                  <div className="font-bold">
                    KSh {Number(selected.currentBalance).toLocaleString()}
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-400">
                Select an account to confirm the customer.
              </p>
            )}
            <button
              disabled={saving || !form.accountId}
              className="mt-5 w-full rounded-lg bg-aqua-700 px-4 py-2.5 font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Registering…" : "Register request"}
            </button>
          </Card>
        </form>
      )}
    </div>
  );
}
