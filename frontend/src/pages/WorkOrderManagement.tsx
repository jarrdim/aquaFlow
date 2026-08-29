import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckboxMultiSelect } from "../components/CheckboxMultiSelect";
import { SearchableSelect } from "../components/SearchableSelect";
import { showToast } from "../components/SweetAlertToast";
import { api } from "../lib/api";

type Lookup = {
  types: any[];
  zones: any[];
  officers: any[];
  categories: any[];
  priorities: string[];
  statuses: string[];
  sourceTypes: string[];
};
type Result = {
  data: any[];
  total: number;
  page: number;
  pages: number;
  take: number;
};
type Dashboard = {
  total: number;
  open: number;
  unassigned: number;
  overdue: number;
  awaiting_verification: number;
  verified: number;
};

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";
const emptyDashboard: Dashboard = {
  total: 0,
  open: 0,
  unassigned: 0,
  overdue: 0,
  awaiting_verification: 0,
  verified: 0,
};

function Loader({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-slate-500">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-aqua-600" />
      {label}
    </div>
  );
}

function InlineLoader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
      {label}
    </span>
  );
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      <header className="border-b border-slate-100 px-4 py-3 font-bold text-slate-800">
        {title}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function label(value: unknown) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function date(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

function finalReadingAmount(context: any, currentReading: string) {
  if (!context?.tariffId || currentReading === "" || context.previousReading == null) return null;
  const consumption = Math.max(0, Number(currentReading) - Number(context.previousReading));
  let consumptionCharge = 0;
  if (context.billingMethod === "FLAT") consumptionCharge = Number(context.flatAmount);
  else if (context.billingMethod === "TIERED") {
    for (const band of context.bands ?? []) {
      const lower = Number(band.lowerLimit);
      const upper = band.upperLimit == null ? consumption : Number(band.upperLimit);
      consumptionCharge += Math.max(0, Math.min(consumption, upper) - lower) * Number(band.ratePerUnit);
    }
  } else consumptionCharge = consumption * Number(context.ratePerUnit);
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  consumptionCharge = round(consumptionCharge);
  return round(
    consumptionCharge + Math.max(0, Number(context.minimumCharge) - consumptionCharge) +
    Number(context.standingCharge) + Number(context.meterRent),
  );
}

function statusClass(status: string) {
  const palette: Record<string, string> = {
    CREATED: "border border-slate-200 bg-slate-100 text-slate-700",
    ASSIGNED: "border border-violet-200 bg-violet-50 text-violet-700",
    ACCEPTED: "border border-cyan-200 bg-cyan-50 text-cyan-700",
    IN_PROGRESS: "border border-blue-200 bg-blue-50 text-blue-700",
    COMPLETED: "border border-amber-200 bg-amber-50 text-amber-700",
    VERIFIED: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    CLOSED: "border border-teal-200 bg-teal-50 text-teal-700",
    REOPENED: "border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
    CANCELLED: "border border-red-200 bg-red-50 text-red-700",
  };
  return (
    palette[status] || "border border-slate-200 bg-slate-50 text-slate-600"
  );
}

export default function WorkOrderManagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const routeCreating = location.pathname.endsWith("/new");
  const [createOpen, setCreateOpen] = useState(routeCreating);
  const creating = routeCreating || createOpen;
  const sourceRequestId = params.get("serviceRequestId") || "";
  const connectionApplicationId = params.get("connectionId") || "";
  const [lookups, setLookups] = useState<Lookup>({
    types: [],
    zones: [],
    officers: [],
    categories: [],
    priorities: [],
    statuses: [],
    sourceTypes: [],
  });
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [result, setResult] = useState<Result>({
    data: [],
    total: 0,
    page: 1,
    pages: 1,
    take: 25,
  });
  const [selected, setSelected] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [assignment, setAssignment] = useState({
    fieldOfficerId: "",
    scheduledDate: "",
    dueDate: "",
  });
  const [material, setMaterial] = useState({
    materialName: "",
    quantity: "1",
    unit: "item",
    unitCost: "",
  });
  const [evidence, setEvidence] = useState({
    evidenceType: "AFTER_PHOTO",
    filePath: "",
    description: "",
  });
  const [disconnection, setDisconnection] = useState({
    previousReading: "",
    currentReading: "",
    disconnectionFee: "",
    feeOverrideReason: "",
    fineAmount: "0",
    fineReason: "",
  });
  const [completionSignatureUrl, setCompletionSignatureUrl] = useState("");
  const typeFieldRef = useRef<HTMLDivElement>(null);
  const targetFieldRef = useRef<HTMLDivElement>(null);
  const descriptionFieldRef = useRef<HTMLTextAreaElement>(null);
  const targetSearchTimerRef = useRef<number>();
  const [form, setForm] = useState({
    workOrderTypeId: "",
    accountId: "",
    customerId: "",
    categoryId: "",
    zoneId: "",
    fieldOfficerIds: [] as string[],
    sourceType: "MANUAL",
    priority: "NORMAL",
    description: "",
    scheduledDate: "",
    dueDate: "",
  });

  const filters = useMemo(
    () => ({
      q: params.get("q") || "",
      status: params.get("status") || "",
      priority: params.get("priority") || "",
      zoneId: params.get("zoneId") || "",
      typeId: params.get("typeId") || "",
      officerId: params.get("officerId") || "",
      page: params.get("page") || "1",
      take: params.get("take") || "25",
    }),
    [params],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lookupData, dashboardData, rows] = await Promise.all([
        api.workOrderLookups(),
        api.workOrderDashboard(),
        api.listWorkOrders(filters),
      ]);
      setLookups(lookupData);
      setDashboard(dashboardData);
      setResult(rows);
    } catch (error: any) {
      showToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // The register and creation routes share this mounted component. Reload when
  // the route mode changes so a newly created order appears immediately.
  useEffect(() => {
    void load();
  }, [creating, load]);

  useEffect(() => {
    if (!creating) return;
    let active = true;
    setTargetsLoading(true);
    Promise.all([
      api.listWorkOrderTargets(),
      sourceRequestId
        ? api.getServiceRequest(sourceRequestId)
        : Promise.resolve(null),
      connectionApplicationId
        ? api.getConnection(connectionApplicationId)
        : Promise.resolve(null),
    ])
      .then(([accountTargets, request, connection]) => {
        if (!active) return;
        setTargets(accountTargets);
        if (request) {
          setForm((current) => ({
            ...current,
            accountId: request.account?.accountId || "",
            customerId: request.customer?.customerId || "",
            sourceType:
              request.requestType === "COMPLAINT"
                ? "COMPLAINT"
                : "SERVICE_REQUEST",
            priority:
              request.priority === "URGENT"
                ? "EMERGENCY"
                : request.priority === "MEDIUM"
                  ? "NORMAL"
                  : request.priority,
            description: `${request.subject}: ${request.description}`.slice(
              0,
              5000,
            ),
          }));
        }
        if (connection) {
          const linkedAccounts = accountTargets.filter(
            (target: any) =>
              String(target.customerId) === String(connection.customerId),
          );
          const newConnectionType = lookups.types.find(
            (type) => type.typeCode === "NEW_CONNECTION",
          );
          setForm((current) => ({
            ...current,
            workOrderTypeId: newConnectionType
              ? String(newConnectionType.workOrderTypeId)
              : current.workOrderTypeId,
            accountId: connection.accountId
              ? String(connection.accountId)
              : linkedAccounts.length === 1
                ? String(linkedAccounts[0].accountId || "")
                : "",
            customerId: connection.customerId ? String(connection.customerId) : "",
            zoneId: connection.zoneId
              ? String(connection.zoneId)
              : current.zoneId,
            sourceType: "MANUAL",
            priority: "HIGH",
            description: `Install and commission new connection ${connection.applicationNumber} for ${connection.applicantName} at ${connection.physicalAddress}.`,
          }));
        }
      })
      .catch((error: any) => {
        if (active) showToast(error.message, "error");
      })
      .finally(() => {
        if (active) setTargetsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [creating, sourceRequestId, connectionApplicationId, lookups.types]);

  const searchTargets = (query: string) => {
    window.clearTimeout(targetSearchTimerRef.current);
    targetSearchTimerRef.current = window.setTimeout(async () => {
      setTargetsLoading(true);
      try {
        const rows = await api.listWorkOrderTargets(query.trim());
        setTargets((current) => {
          const selectedTarget = current.find(
            (target) => form.accountId
              ? String(target.accountId) === form.accountId
              : String(target.customerId) === form.customerId,
          );
          return selectedTarget &&
            !rows.some(
              (target: any) => form.accountId
                ? String(target.accountId) === form.accountId
                : String(target.customerId) === form.customerId,
            )
            ? [selectedTarget, ...rows]
            : rows;
        });
      } catch (error: any) {
        showToast(error.message, "error");
      } finally {
        setTargetsLoading(false);
      }
    }, 300);
  };

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setParams(next, { replace: true });
  };

  const open = async (item: any) => {
    setSelected(item);
    setDetailLoading(true);
    try {
      const detail = await api.getWorkOrder(item.workOrderId);
      setSelected(detail);
      const latest = detail.assignments?.[0];
      setAssignment({
        fieldOfficerId: latest?.field_officer_id || "",
        scheduledDate: detail.scheduled_date?.slice(0, 10) || "",
        dueDate: detail.due_date?.slice(0, 10) || "",
      });
      setNotes("");
      const context = detail.disconnectionContext;
      setDisconnection({
        previousReading: context?.previousReading == null ? "" : String(context.previousReading),
        currentReading: context?.currentReading == null ? "" : String(context.currentReading),
        disconnectionFee: context?.disconnectionFee == null
          ? ""
          : String(context.disconnectionFee),
        feeOverrideReason: context?.feeOverrideReason || "",
        fineAmount: context?.fineAmount == null ? "0" : String(context.fineAmount),
        fineReason: context?.fineReason || "",
      });
    } catch (error: any) {
      showToast(error.message, "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshSelected = async () => {
    if (!selected?.work_order_id && !selected?.workOrderId) return;
    const detail = await api.getWorkOrder(
      selected.work_order_id || selected.workOrderId,
    );
    setSelected(detail);
  };

  useEffect(() => {
    const path = selected?.completionEvidence?.signature?.contentUrl;
    if (!path) {
      setCompletionSignatureUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    api
      .getProtectedBlobUrl(path)
      .then((url: string) => {
        objectUrl = url;
        if (active) setCompletionSignatureUrl(url);
      })
      .catch((error: any) => {
        if (active) showToast(error.message, "error");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.completionEvidence?.signature?.contentUrl]);

  const perform = async (
    action: string,
    operation: () => Promise<any>,
    success: string,
  ) => {
    setBusyAction(action);
    try {
      await operation();
      showToast(success, "success");
      setNotes("");
      await Promise.all([load(), refreshSelected()]);
    } catch (error: any) {
      showToast(error.message, "error");
    } finally {
      setBusyAction("");
    }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.workOrderTypeId) {
      typeFieldRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return showToast("Select a work order type.", "warning");
    }
    if (!form.accountId && !form.customerId && !form.zoneId) {
      targetFieldRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return showToast(
        "Select a customer account or a zone for this work order.",
        "warning",
      );
    }
    if (form.customerId && !form.accountId && !form.categoryId) {
      targetFieldRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return showToast("Select a customer category so the account can be created.", "warning");
    }
    if (!form.description.trim()) {
      descriptionFieldRef.current?.focus();
      descriptionFieldRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return showToast("Enter the work description.", "warning");
    }
    setBusyAction("create");
    try {
      const created = await api.createWorkOrder({
        ...form,
        accountId: form.accountId || null,
        customerId: form.customerId || null,
        categoryId: form.categoryId || null,
        zoneId: form.zoneId || null,
        serviceRequestId: sourceRequestId || null,
        connectionApplicationId: connectionApplicationId || null,
        scheduledDate: form.scheduledDate || null,
        dueDate: form.dueDate || null,
      });
      showToast(`Work order ${created.work_order_number} created.`, "success");
      setCreateOpen(false);
      if (routeCreating) {
        navigate(
          connectionApplicationId
            ? `/connections/${connectionApplicationId}`
            : "/work-orders",
          { replace: true },
        );
      }
      setForm({
        workOrderTypeId: "",
        accountId: "",
        customerId: "",
        categoryId: "",
        zoneId: "",
        fieldOfficerIds: [],
        sourceType: "MANUAL",
        priority: "NORMAL",
        description: "",
        scheduledDate: "",
        dueDate: "",
      });
    } catch (error: any) {
      showToast(error.message, "error");
    } finally {
      setBusyAction("");
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    if (routeCreating) {
      navigate(
        connectionApplicationId
          ? `/connections/${connectionApplicationId}`
          : "/work-orders",
        { replace: true },
      );
    }
  };

  useEffect(() => {
    if (!creating) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCreate();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [creating, routeCreating]);

  const readEvidence = (file?: File) => {
    if (!file) return;
    if (file.size > 7_500_000)
      return showToast("Evidence file must be smaller than 7.5 MB.", "warning");
    const reader = new FileReader();
    reader.onload = () =>
      setEvidence((current) => ({
        ...current,
        filePath: String(reader.result),
      }));
    reader.readAsDataURL(file);
  };

  const createPanel = creating
    ? (() => {
        const selectedTarget = targets.find(
          (target) => form.accountId
            ? String(target.accountId) === form.accountId
            : String(target.customerId) === form.customerId,
        );
        const selectedOfficers = lookups.officers.filter((officer) =>
          form.fieldOfficerIds.includes(String(officer.fieldOfficerId)),
        );
        const creatingOrder = busyAction === "create";
        return (
          <div className="fixed inset-x-0 bottom-0 top-14 z-[90]">
            <button
              type="button"
              aria-label="Close create work order"
              onClick={closeCreate}
              className="absolute inset-0 cursor-default bg-slate-950/40 backdrop-blur-[1px]"
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-work-order-title"
              className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-slate-50 shadow-2xl"
            >
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
                <div>
                  <h2
                    id="create-work-order-title"
                    className="text-lg font-bold text-slate-900"
                  >
                    Create work order
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Create, schedule and optionally assign field work.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreate}
                  aria-label="Close"
                  className="rounded-lg p-2 text-2xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  ×
                </button>
              </header>
              <form
                onSubmit={submitCreate}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                  <Card title="Work order details">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label>
                        <span className="mb-1 block text-sm font-medium">
                          Work order type *
                        </span>
                        <div ref={typeFieldRef}>
                          <SearchableSelect
                            className={input}
                            value={form.workOrderTypeId}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                workOrderTypeId: e.target.value,
                              })
                            }
                          >
                            <option value="">Select type</option>
                            {lookups.types.map((item) => (
                              <option
                                key={item.workOrderTypeId}
                                value={item.workOrderTypeId}
                              >
                                {item.typeName}
                              </option>
                            ))}
                          </SearchableSelect>
                        </div>
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium">
                          Priority *
                        </span>
                        <SearchableSelect
                          className={input}
                          value={form.priority}
                          onChange={(e) =>
                            setForm({ ...form, priority: e.target.value })
                          }
                        >
                          {lookups.priorities.map((item) => (
                            <option key={item} value={item}>
                              {label(item)}
                            </option>
                          ))}
                        </SearchableSelect>
                      </label>
                      <label className={form.accountId || form.customerId ? "md:col-span-2" : ""}>
                        <span className="mb-1 block text-sm font-medium">
                          Customer / account
                        </span>
                        <div ref={targetFieldRef}>
                          <SearchableSelect
                            className={input}
                            value={form.accountId ? `account:${form.accountId}` : form.customerId ? `customer:${form.customerId}` : ""}
                            onSearchQuery={searchTargets}
                            onChange={(e) => {
                              const [kind, selectedId = ""] = e.target.value.split(":");
                              const target = targets.find((item) =>
                                kind === "account"
                                  ? String(item.accountId) === selectedId
                                  : String(item.customerId) === selectedId,
                              );
                              setForm({
                                ...form,
                                accountId: kind === "account" ? selectedId : "",
                                customerId: target?.customerId ? String(target.customerId) : "",
                                categoryId: target?.accountId ? "" : form.categoryId,
                                zoneId: target?.zoneId ? String(target.zoneId) : form.zoneId,
                              });
                            }}
                          >
                            <option value="">
                              {targetsLoading
                                ? "Loading latest customers…"
                                : "Select customer or use zone only"}
                            </option>
                            {targets.map((item) => (
                              <option
                                key={item.accountId ? `account:${item.accountId}` : `customer:${item.customerId}`}
                                value={item.accountId ? `account:${item.accountId}` : `customer:${item.customerId}`}
                              >
                                {item.customerName} · {item.customerNumber} ·
                                {item.accountNumber ? ` Account ${item.accountNumber}` : " Latest customer (no account)"} · {item.zoneName || "No zone"}
                              </option>
                            ))}
                          </SearchableSelect>
                        </div>
                        {targetsLoading && (
                          <span className="mt-2 block text-xs text-slate-500">
                            <InlineLoader label="Loading latest customers…" />
                          </span>
                        )}
                      </label>
                      {!form.accountId && !form.customerId && (
                        <label>
                          <span className="mb-1 block text-sm font-medium">
                            Zone *
                          </span>
                          <SearchableSelect
                            className={input}
                            value={form.zoneId}
                            onChange={(e) =>
                              setForm({ ...form, zoneId: e.target.value })
                            }
                          >
                            <option value="">Select zone</option>
                            {lookups.zones.map((item) => (
                              <option key={item.zoneId} value={item.zoneId}>
                                {item.zoneName}
                              </option>
                            ))}
                          </SearchableSelect>
                        </label>
                      )}
                      {form.customerId && !form.accountId && (
                        <label>
                          <span className="mb-1 block text-sm font-medium">
                            Customer category *
                          </span>
                          <SearchableSelect
                            className={input}
                            value={form.categoryId}
                            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                          >
                            <option value="">Select category</option>
                            {lookups.categories.map((category) => (
                              <option key={category.categoryId} value={category.categoryId}>
                                {category.categoryName}
                              </option>
                            ))}
                          </SearchableSelect>
                          <span className="mt-1 block text-[11px] text-slate-500">
                            An active account will be created automatically with this work order.
                          </span>
                        </label>
                      )}
                      <label className="md:col-span-2">
                        <span className="mb-1 block text-sm font-medium">
                          Assign field officers
                        </span>
                        <CheckboxMultiSelect
                          className={input}
                          disabled={loading}
                          emptyMessage="No active field officers are configured"
                          placeholder={loading ? "Loading field officers…" : lookups.officers.length ? "Leave unassigned" : "No active field officers"}
                          value={form.fieldOfficerIds}
                          onChange={(fieldOfficerIds) =>
                            setForm({ ...form, fieldOfficerIds })
                          }
                          options={lookups.officers.map((item) => ({
                            value: String(item.fieldOfficerId),
                            label: `${item.firstName} ${item.lastName}${item.employeeNumber ? ` · ${item.employeeNumber}` : ""}`,
                          }))}
                        />
                        {loading ? (
                          <span className="mt-1 block text-[11px] text-slate-500"><InlineLoader label="Loading field officers…" /></span>
                        ) : lookups.officers.length ? (
                          <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                            Optional — select one or several officers, or leave the work in the unassigned queue.
                          </span>
                        ) : (
                          <span className="mt-1 block rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800">
                            No active field-officer profiles are configured. This work order will remain in the unassigned queue.
                          </span>
                        )}
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium">
                          Scheduled date
                        </span>
                        <input
                          type="date"
                          className={input}
                          value={form.scheduledDate}
                          onChange={(e) =>
                            setForm({ ...form, scheduledDate: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium">
                          Due date
                        </span>
                        <input
                          type="date"
                          className={input}
                          value={form.dueDate}
                          onChange={(e) =>
                            setForm({ ...form, dueDate: e.target.value })
                          }
                        />
                      </label>
                      <label className="md:col-span-2">
                        <span className="mb-1 block text-sm font-medium">
                          Work description *
                        </span>
                        <textarea
                          ref={descriptionFieldRef}
                          rows={3}
                          className={`${input} min-h-[88px]`}
                          value={form.description}
                          onChange={(e) =>
                            setForm({ ...form, description: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </Card>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-slate-900">
                        Dispatch summary
                      </h3>
                      <div className="flex items-center gap-2">
                        {sourceRequestId && (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                            Request #{sourceRequestId}
                          </span>
                        )}
                        {connectionApplicationId && (
                          <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800">
                            Connection #{connectionApplicationId}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selectedOfficers.length ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
                        >
                          {selectedOfficers.length
                            ? `${selectedOfficers.length} officer${selectedOfficers.length === 1 ? "" : "s"} selected`
                            : "Unassigned queue"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <p>
                        <span className="text-slate-500">Account:</span>{" "}
                        <strong>
                          {selectedTarget?.accountNumber || "Zone-level"}
                        </strong>
                      </p>
                      <p>
                        <span className="text-slate-500">Customer:</span>{" "}
                        <strong>{selectedTarget?.customerName || "N/A"}</strong>
                      </p>
                      <p>
                        <span className="text-slate-500">Zone:</span>{" "}
                        <strong>
                          {selectedTarget?.zoneName ||
                            lookups.zones.find(
                              (z) => String(z.zoneId) === form.zoneId,
                            )?.zoneName ||
                            "Not selected"}
                        </strong>
                      </p>
                      <p>
                        <span className="text-slate-500">Assignee:</span>{" "}
                        <strong>
                          {selectedOfficers.length
                            ? selectedOfficers
                                .map(
                                  (officer) =>
                                    `${officer.firstName} ${officer.lastName}`,
                                )
                                .join(", ")
                            : "Unassigned"}
                        </strong>
                      </p>
                    </div>
                  </div>
                </div>
                <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-3">
                  <button
                    type="button"
                    onClick={closeCreate}
                    disabled={creatingOrder}
                    className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingOrder || loading || targetsLoading}
                    className="min-w-44 rounded-lg bg-aqua-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {creatingOrder ? (
                      <InlineLoader label="Creating work order…" />
                    ) : selectedOfficers.length ? (
                      "Create and assign"
                    ) : (
                      "Create work order"
                    )}
                  </button>
                </footer>
              </form>
            </aside>
          </div>
        );
      })()
    : null;

  const detailId = selected?.work_order_id || selected?.workOrderId;
  const saving = Boolean(busyAction);
  const currentStatus = selected?.status || "";
  const latestAssignment = selected?.assignments?.[0];
  const statusAction =
    currentStatus === "ASSIGNED"
      ? ["ACCEPTED", "Accept work"]
      : currentStatus === "ACCEPTED"
        ? ["IN_PROGRESS", "Start work"]
        : currentStatus === "IN_PROGRESS" || currentStatus === "REOPENED"
          ? ["COMPLETED", "Complete work"]
          : null;
  const completingDisconnection =
    statusAction?.[0] === "COMPLETED" && selected?.type_code === "DISCONNECTION";
  const defaultDisconnectionFee = finalReadingAmount(
    selected?.disconnectionContext,
    disconnection.currentReading,
  );
  const disconnectionFeeOverridden =
    defaultDisconnectionFee != null && disconnection.disconnectionFee !== "" &&
    Math.abs(Number(disconnection.disconnectionFee) - defaultDisconnectionFee) > 0.009;
  const disconnectionFormValid = !completingDisconnection || (
    Boolean(selected?.disconnectionContext?.tariffId) &&
    disconnection.previousReading !== "" && disconnection.currentReading !== "" &&
    Number(disconnection.currentReading) >= Number(disconnection.previousReading) &&
    disconnection.disconnectionFee !== "" && Number(disconnection.disconnectionFee) >= 0 &&
    (!disconnectionFeeOverridden || disconnection.feeOverrideReason.trim().length >= 3) &&
    (Number(disconnection.fineAmount || 0) === 0 || disconnection.fineReason.trim().length >= 3)
  );

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-8 lg:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Create, dispatch, execute and verify field work in one auditable
          register.
        </p>
        <div className="flex gap-2">
          <button
            disabled={loading}
            onClick={() => void load()}
            className="min-w-28 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {loading ? <InlineLoader label="Refreshing…" /> : "Refresh"}
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-bold text-white"
          >
            + Create work order
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["All orders", dashboard.total],
          ["Open", dashboard.open],
          ["Unassigned", dashboard.unassigned],
          ["Overdue", dashboard.overdue],
          ["Awaiting verification", dashboard.awaiting_verification],
          ["Verified / closed", dashboard.verified],
        ].map(([title, count]) => (
          <div
            key={String(title)}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="text-xs font-semibold uppercase text-slate-500">
              {title}
            </div>
            <div className="mt-1 text-2xl font-bold">
              {loading ? (
                <span
                  className="inline-block h-7 w-14 animate-pulse rounded bg-slate-100"
                  aria-label="Loading count"
                />
              ) : (
                Number(count).toLocaleString()
              )}
            </div>
          </div>
        ))}
      </div>
      <Card title="Search and filters">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.4fr)_repeat(2,minmax(180px,1fr))_auto]">
          <input
            className={input}
            value={filters.q}
            onChange={(e) => updateFilter("q", e.target.value)}
            placeholder="Work order, account, customer or description"
          />
          <CheckboxMultiSelect
            className={input}
            placeholder="All statuses"
            value={filters.status.split(",").filter(Boolean)}
            onChange={(value) => updateFilter("status", value.join(","))}
            options={lookups.statuses.map((item) => ({
              value: item,
              label: label(item),
            }))}
          />
          <CheckboxMultiSelect
            className={input}
            placeholder="All work types"
            value={filters.typeId.split(",").filter(Boolean)}
            onChange={(value) => updateFilter("typeId", value.join(","))}
            options={lookups.types.map((item) => ({
              value: String(item.workOrderTypeId),
              label: item.typeName,
            }))}
          />
          <button
            onClick={() => setFilterOpen((value) => !value)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold"
          >
            {filterOpen ? "Fewer filters" : "More filters"}
          </button>
        </div>
        {filterOpen && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <CheckboxMultiSelect
              className={input}
              placeholder="All zones"
              value={filters.zoneId.split(",").filter(Boolean)}
              onChange={(value) => updateFilter("zoneId", value.join(","))}
              options={lookups.zones.map((item) => ({
                value: String(item.zoneId),
                label: item.zoneName,
              }))}
            />
            <CheckboxMultiSelect
              className={input}
              placeholder="All officers"
              value={filters.officerId.split(",").filter(Boolean)}
              onChange={(value) => updateFilter("officerId", value.join(","))}
              options={lookups.officers.map((item) => ({
                value: String(item.fieldOfficerId),
                label: `${item.firstName} ${item.lastName}`,
              }))}
            />
            <CheckboxMultiSelect
              className={input}
              placeholder="All priorities"
              value={filters.priority.split(",").filter(Boolean)}
              onChange={(value) => updateFilter("priority", value.join(","))}
              options={lookups.priorities.map((item) => ({
                value: item,
                label: label(item),
              }))}
            />
          </div>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Card title={`${result.total.toLocaleString()} work order(s)`}>
          {loading ? (
            <Loader label="Loading work orders…" />
          ) : !result.data.length ? (
            <p className="py-16 text-center text-sm text-slate-400">
              No work orders match the selected filters.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-3">Work order</th>
                      <th className="px-3 py-3">Customer / zone</th>
                      <th className="px-3 py-3">Assignee</th>
                      <th className="px-3 py-3">Priority / due</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.data.map((item) => (
                      <tr
                        key={item.workOrderId}
                        className={
                          String(detailId) === String(item.workOrderId)
                            ? "bg-sky-50"
                            : ""
                        }
                      >
                        <td className="px-3 py-3">
                          <strong>{item.workOrderNumber}</strong>
                          <div className="text-xs text-slate-500">
                            {item.typeName}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {item.customerName || "Zone-level task"}
                          <div className="text-xs text-slate-500">
                            {item.accountNumber || item.zoneName}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {item.officerName || (
                            <span className="text-amber-600">Unassigned</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {label(item.priority)}
                          <div className="text-xs text-slate-500">
                            {date(item.dueDate)}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}
                          >
                            {label(item.status)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => void open(item)}
                            className="font-bold text-aqua-700"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-3 text-slate-600">
                  <span>
                    Showing {(result.page - 1) * result.take + 1}–
                    {Math.min(result.page * result.take, result.total)} of{" "}
                    {result.total}
                  </span>
                  <label className="flex items-center gap-2">
                    Rows
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                      value={String(result.take)}
                      onChange={(event) =>
                        updateFilter("take", event.target.value)
                      }
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <span className="mr-1 text-slate-600">
                    Page {result.page} of {result.pages}
                  </span>
                  <button
                    disabled={result.page <= 1}
                    onClick={() =>
                      updateFilter("page", String(result.page - 1))
                    }
                    className="rounded border px-3 py-1.5 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    disabled={result.page >= result.pages}
                    onClick={() =>
                      updateFilter("page", String(result.page + 1))
                    }
                    className="rounded border px-3 py-1.5 disabled:opacity-40"
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
            selected
              ? `${selected.work_order_number || selected.workOrderNumber}`
              : "Work order details"
          }
        >
          {!selected ? (
            <p className="py-16 text-center text-sm text-slate-400">
              Select a work order to dispatch, track or verify it.
            </p>
          ) : detailLoading ? (
            <Loader label="Loading work order history…" />
          ) : (
            <div className="space-y-2.5 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="font-bold">{selected.type_name}</h2>
                    <p className="text-sm text-slate-500">
                      {selected.customer_name || "Zone-level task"} ·{" "}
                      {selected.account_number || selected.zone_name}
                    </p>
                  </div>
                  <span
                    className={`h-fit rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(currentStatus)}`}
                  >
                    {label(currentStatus)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm">
                  {selected.description}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                  <span>
                    Source:{" "}
                    <strong className="text-slate-700">
                      {label(selected.source_type)}
                    </strong>
                  </span>
                  <span>
                    Due:{" "}
                    <strong className="text-slate-700">
                      {date(selected.due_date)}
                    </strong>
                  </span>
                  <span>
                    Assignee:{" "}
                    <strong className="text-slate-700">
                      {latestAssignment
                        ? `${latestAssignment.first_name} ${latestAssignment.last_name}`
                        : "Unassigned"}
                    </strong>
                  </span>
                </div>
              </div>
              {selected.service_request_number && (
                <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
                  Source request:{" "}
                  <strong>{selected.service_request_number}</strong> ·{" "}
                  {selected.service_request_subject}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
                <SearchableSelect
                  className={input}
                  value={assignment.fieldOfficerId}
                  onChange={(e) =>
                    setAssignment({
                      ...assignment,
                      fieldOfficerId: e.target.value,
                    })
                  }
                >
                  <option value="">Select field officer</option>
                  {lookups.officers.map((item) => (
                    <option
                      key={item.fieldOfficerId}
                      value={item.fieldOfficerId}
                    >
                      {item.firstName} {item.lastName}
                    </option>
                  ))}
                </SearchableSelect>
                <button
                  disabled={!assignment.fieldOfficerId || saving}
                  onClick={() =>
                    perform(
                      "assign",
                      () =>
                        api.assignWorkOrder(detailId, {
                          ...assignment,
                          scheduledDate: assignment.scheduledDate || null,
                          dueDate: assignment.dueDate || null,
                          notes: notes || "Dispatched from work order register",
                        }),
                      "Work order assigned.",
                    )
                  }
                  className="rounded-lg border border-aqua-600 px-3 py-2 text-sm font-bold text-aqua-700 disabled:opacity-40"
                >
                  {busyAction === "assign" ? (
                    <InlineLoader label="Assigning…" />
                  ) : (
                    "Assign"
                  )}
                </button>
              </div>
              {completingDisconnection && (
                <section className="rounded-xl border border-orange-200 bg-orange-50/60 p-3">
                  <div className="mb-3">
                    <h3 className="font-bold text-slate-800">Final meter reading and charges</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Meter {selected.disconnectionContext?.meterNumber || "not found"}. Completing posts the reading, fee and any fine to the customer statement.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-xs font-medium">Previous reading</span>
                      <input className={`${input} bg-slate-100`} value={disconnection.previousReading} readOnly />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-medium">Current reading *</span>
                      <input type="number" min={disconnection.previousReading || 0} step="0.001" className={input}
                        value={disconnection.currentReading}
                        onChange={(e) => {
                          const currentReading = e.target.value;
                          const amount = finalReadingAmount(selected.disconnectionContext, currentReading);
                          setDisconnection({
                            ...disconnection,
                            currentReading,
                            disconnectionFee: amount == null ? "" : String(amount),
                            feeOverrideReason: "",
                          });
                        }} />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-medium">Final reading amount (KSh) *</span>
                      <input type="number" min={0} step="0.01" className={input}
                        value={disconnection.disconnectionFee}
                        onChange={(e) => setDisconnection({ ...disconnection, disconnectionFee: e.target.value })} />
                      <span className="mt-1 block text-[11px] text-slate-500">
                        {defaultDisconnectionFee == null
                          ? "Enter the current reading to calculate the amount."
                          : `${selected.disconnectionContext?.tariffName || "Active tariff"}: ${Math.max(0, Number(disconnection.currentReading) - Number(disconnection.previousReading)).toLocaleString()} units = KSh ${defaultDisconnectionFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      </span>
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-medium">Amount override reason{disconnectionFeeOverridden ? " *" : ""}</span>
                      <input className={input} value={disconnection.feeOverrideReason}
                        disabled={!disconnectionFeeOverridden}
                        placeholder={disconnectionFeeOverridden ? "Why is the default fee changing?" : "Not required"}
                        onChange={(e) => setDisconnection({ ...disconnection, feeOverrideReason: e.target.value })} />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-medium">Fine amount (KSh)</span>
                      <input type="number" min={0} step="0.01" className={input}
                        value={disconnection.fineAmount}
                        onChange={(e) => setDisconnection({ ...disconnection, fineAmount: e.target.value })} />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-medium">Fine reason{Number(disconnection.fineAmount || 0) > 0 ? " *" : ""}</span>
                      <input className={input} value={disconnection.fineReason}
                        disabled={Number(disconnection.fineAmount || 0) <= 0}
                        placeholder={Number(disconnection.fineAmount || 0) > 0 ? "Reason for applying the fine" : "No fine"}
                        onChange={(e) => setDisconnection({ ...disconnection, fineReason: e.target.value })} />
                    </label>
                  </div>
                  {!selected.disconnectionContext?.tariffId && (
                    <p className="mt-2 text-xs font-semibold text-red-600">This account has no active tariff, so its final reading amount cannot be calculated.</p>
                  )}
                  {disconnection.currentReading !== "" && Number(disconnection.currentReading) < Number(disconnection.previousReading) && (
                    <p className="mt-2 text-xs font-semibold text-red-600">Current reading cannot be lower than the previous reading.</p>
                  )}
                </section>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium">
                  Action / decision notes *
                </span>
                <textarea
                  className={input}
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Record work performed or the reason for this decision"
                />
              </label>
              {statusAction && (
                <button
                  disabled={notes.trim().length < 2 || saving || !disconnectionFormValid}
                  onClick={() =>
                    perform(
                      "status",
                      () =>
                        api.updateWorkOrderStatus(detailId, {
                          status: statusAction[0],
                          notes,
                          ...(completingDisconnection ? {
                            disconnection: {
                              previousReading: Number(disconnection.previousReading),
                              currentReading: Number(disconnection.currentReading),
                              disconnectionFee: Number(disconnection.disconnectionFee),
                              feeOverrideReason: disconnectionFeeOverridden ? disconnection.feeOverrideReason : null,
                              fineAmount: Number(disconnection.fineAmount || 0),
                              fineReason: Number(disconnection.fineAmount || 0) > 0 ? disconnection.fineReason : null,
                            },
                          } : {}),
                        }),
                      `Work order moved to ${label(statusAction[0])}.`,
                    )
                  }
                  className="w-full rounded-lg bg-aqua-700 px-4 py-2 font-bold text-white disabled:opacity-40"
                >
                  {busyAction === "status" ? (
                    <InlineLoader label="Updating…" />
                  ) : (
                    statusAction[1]
                  )}
                </button>
              )}
              {currentStatus === "COMPLETED" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={notes.trim().length < 2 || saving}
                    onClick={() =>
                      perform(
                        "return",
                        () =>
                          api.verifyWorkOrder(detailId, {
                            decision: "RETURN",
                            notes,
                          }),
                        "Work order returned to the field.",
                      )
                    }
                    className="rounded-lg bg-orange-500 px-3 py-2.5 font-bold text-white disabled:opacity-40"
                  >
                    {busyAction === "return" ? (
                      <InlineLoader label="Returning…" />
                    ) : (
                      "Return"
                    )}
                  </button>
                  <button
                    disabled={notes.trim().length < 2 || saving}
                    onClick={() =>
                      perform(
                        "verify",
                        () =>
                          api.verifyWorkOrder(detailId, {
                            decision: "VERIFY",
                            notes,
                          }),
                        "Work order verified.",
                      )
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-2.5 font-bold text-white disabled:opacity-40"
                  >
                    {busyAction === "verify" ? (
                      <InlineLoader label="Verifying…" />
                    ) : (
                      "Verify"
                    )}
                  </button>
                </div>
              )}
              {currentStatus === "VERIFIED" && (
                <button
                  disabled={notes.trim().length < 2 || saving}
                  onClick={() =>
                    perform(
                      "close",
                      () => api.closeWorkOrder(detailId, notes),
                      "Work order closed.",
                    )
                  }
                  className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white disabled:opacity-40"
                >
                  {busyAction === "close" ? (
                    <InlineLoader label="Closing…" />
                  ) : (
                    "Close work order"
                  )}
                </button>
              )}
              {selected.disconnectionPosting && (
                <section className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
                  <h3 className="font-bold">Disconnection posting</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-slate-500">Meter</dt><dd>{selected.disconnectionPosting.meterNumber}</dd></div>
                    <div><dt className="text-slate-500">Reading</dt><dd>{Number(selected.disconnectionPosting.previousReading).toLocaleString()} → {Number(selected.disconnectionPosting.currentReading).toLocaleString()}</dd></div>
                    <div><dt className="text-slate-500">Final reading amount</dt><dd>KSh {Number(selected.disconnectionPosting.disconnectionFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div>
                    <div><dt className="text-slate-500">Fine</dt><dd>KSh {Number(selected.disconnectionPosting.fineAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div>
                  </dl>
                  {selected.disconnectionPosting.feeOverridden && <p className="mt-2 text-xs text-slate-600">Amount override: {selected.disconnectionPosting.feeOverrideReason}</p>}
                  {Number(selected.disconnectionPosting.fineAmount) > 0 && <p className="mt-1 text-xs text-slate-600">Fine reason: {selected.disconnectionPosting.fineReason}</p>}
                  <p className="mt-2 text-[11px] font-semibold text-emerald-700">Posted to the customer statement.</p>
                </section>
              )}
              {selected.disconnectionEvidence && (
                <section className="rounded-lg border border-slate-200 p-3">
                  <h3 className="font-bold">Disconnection evidence</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Officer</dt>
                      <dd>
                        {selected.disconnectionEvidence.officer_first_name}{" "}
                        {selected.disconnectionEvidence.officer_last_name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Status</dt>
                      <dd>{label(selected.disconnectionEvidence.status)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Disconnected at</dt>
                      <dd>
                        {date(
                          selected.disconnectionEvidence.disconnection_datetime,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Acknowledgement</dt>
                      <dd>
                        {label(
                          selected.disconnectionEvidence
                            .customer_acknowledgement,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">GPS</dt>
                      <dd>
                        {selected.disconnectionEvidence.gps_latitude},{" "}
                        {selected.disconnectionEvidence.gps_longitude}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">GPS captured</dt>
                      <dd>
                        {date(selected.disconnectionEvidence.gps_captured_at)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-slate-600">
                    {selected.disconnectionEvidence.remarks}
                  </p>
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {selected.evidence
                      ?.filter(
                        (item: any) => item.evidence_type === "AFTER_PHOTO",
                      )
                      .map((item: any) => (
                        <img
                          key={item.evidence_id}
                          src={item.file_path}
                          alt="Disconnection evidence"
                          className="h-24 w-24 rounded object-cover"
                        />
                      ))}
                  </div>
                </section>
              )}
              {selected.reconnectionEvidence && (
                <section className="rounded-lg border border-slate-200 p-3">
                  <h3 className="font-bold">Reconnection evidence</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Customer account</dt>
                      <dd>{selected.account_number}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Officer</dt>
                      <dd>
                        {selected.reconnectionEvidence.officer_first_name}{" "}
                        {selected.reconnectionEvidence.officer_last_name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Reconnection</dt>
                      <dd>
                        {selected.reconnectionEvidence.reconnection_reference}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Disconnection</dt>
                      <dd>
                        {selected.reconnectionEvidence
                          .disconnection_reference || "Not linked"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Payment</dt>
                      <dd>
                        {selected.reconnectionEvidence.fee_payment_status} /{" "}
                        {selected.reconnectionEvidence.payment_status}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Reconnected at</dt>
                      <dd>
                        {date(
                          selected.reconnectionEvidence.reconnection_datetime,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">GPS</dt>
                      <dd>
                        {selected.reconnectionEvidence.gps_latitude},{" "}
                        {selected.reconnectionEvidence.gps_longitude}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Status</dt>
                      <dd>{label(selected.reconnectionEvidence.status)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-slate-600">
                    {selected.reconnectionEvidence.remarks}
                  </p>
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {selected.evidence
                      ?.filter(
                        (item: any) => item.evidence_type === "AFTER_PHOTO",
                      )
                      .map((item: any) => (
                        <img
                          key={item.evidence_id}
                          src={item.file_path}
                          alt="Reconnection evidence"
                          className="h-24 w-24 rounded object-cover"
                        />
                      ))}
                  </div>
                </section>
              )}
              {selected.completionEvidence && (
                <section className="rounded-lg border border-slate-200 p-3">
                  <h3 className="font-bold">
                    Materials and customer signature
                  </h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Officer</dt>
                      <dd>
                        {selected.completionEvidence.officer_first_name}{" "}
                        {selected.completionEvidence.officer_last_name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Status</dt>
                      <dd>{label(selected.completionEvidence.status)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        Customer name confirmed
                      </dt>
                      <dd>
                        {selected.completionEvidence.customer_name_confirmed
                          ? "Yes"
                          : "No"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        Customer identity confirmed
                      </dt>
                      <dd>
                        {selected.completionEvidence.customer_identity_confirmed
                          ? "Yes"
                          : "No"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Submitted</dt>
                      <dd>{date(selected.completionEvidence.submitted_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Materials</dt>
                      <dd>
                        {selected.completionEvidence.no_materials_used
                          ? "No materials used"
                          : `${selected.completionEvidence.materials?.length || 0} item(s)`}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-slate-600">
                    {selected.completionEvidence.completion_notes}
                  </p>
                  {!!selected.completionEvidence.materials?.length && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-slate-500">
                            <th className="py-1">Item</th>
                            <th>Quantity</th>
                            <th>Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.completionEvidence.materials.map(
                            (item: any) => (
                              <tr key={item.usage_id} className="border-t">
                                <td className="py-1">
                                  {item.item_code} · {item.item_name}
                                </td>
                                <td>{item.quantity_used}</td>
                                <td>{item.unit_of_measure}</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {completionSignatureUrl && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-semibold text-slate-500">
                        Customer signature
                      </p>
                      <img
                        src={completionSignatureUrl}
                        alt="Customer job-completion signature"
                        className="max-h-36 rounded border bg-white object-contain"
                      />
                    </div>
                  )}
                </section>
              )}
              {["ACCEPTED", "IN_PROGRESS", "REOPENED"].includes(
                currentStatus,
              ) && (
                <details className="rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-bold">
                    Evidence and materials
                  </summary>
                  <div className="mt-3 space-y-3">
                    <SearchableSelect
                      className={input}
                      value={evidence.evidenceType}
                      onChange={(e) =>
                        setEvidence({
                          ...evidence,
                          evidenceType: e.target.value,
                        })
                      }
                    >
                      {[
                        "BEFORE_PHOTO",
                        "AFTER_PHOTO",
                        "METER_PHOTO",
                        "SIGNATURE",
                        "CHECKLIST",
                        "DOCUMENT",
                      ].map((item) => (
                        <option key={item} value={item}>
                          {label(item)}
                        </option>
                      ))}
                    </SearchableSelect>
                    <input
                      type="file"
                      className={input}
                      onChange={(e) => readEvidence(e.target.files?.[0])}
                    />
                    <button
                      disabled={!evidence.filePath || saving}
                      onClick={() =>
                        perform(
                          "evidence",
                          () => api.addWorkOrderEvidence(detailId, evidence),
                          "Evidence uploaded.",
                        )
                      }
                      className="w-full rounded-lg border border-aqua-600 py-2 text-sm font-bold text-aqua-700 disabled:opacity-40"
                    >
                      {busyAction === "evidence" ? (
                        <InlineLoader label="Uploading…" />
                      ) : (
                        "Add evidence"
                      )}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className={input}
                        placeholder="Material name"
                        value={material.materialName}
                        onChange={(e) =>
                          setMaterial({
                            ...material,
                            materialName: e.target.value,
                          })
                        }
                      />
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className={input}
                        placeholder="Quantity"
                        value={material.quantity}
                        onChange={(e) =>
                          setMaterial({ ...material, quantity: e.target.value })
                        }
                      />
                    </div>
                    <button
                      disabled={!material.materialName || saving}
                      onClick={() =>
                        perform(
                          "material",
                          () =>
                            api.addWorkOrderConsumable(detailId, {
                              ...material,
                              unitCost: material.unitCost || null,
                            }),
                          "Material recorded.",
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 py-2 text-sm font-bold disabled:opacity-40"
                    >
                      {busyAction === "material" ? (
                        <InlineLoader label="Recording…" />
                      ) : (
                        "Record material"
                      )}
                    </button>
                  </div>
                </details>
              )}
              <details className="rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-bold">
                  <span>Activity history</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {selected.updates?.length || 0}
                  </span>
                </summary>
                <div className="max-h-40 space-y-2 overflow-y-auto border-t border-slate-100 p-2">
                  {selected.updates?.map((item: any) => (
                    <div
                      key={item.update_id}
                      className="border-l-2 border-sky-200 pl-3 text-xs"
                    >
                      <strong>
                        {label(item.previous_status || "Created")} →{" "}
                        {label(item.new_status)}
                      </strong>
                      <div className="text-slate-500">
                        {new Date(item.updated_at).toLocaleString()} ·{" "}
                        {item.first_name
                          ? `${item.first_name} ${item.last_name}`
                          : "System"}
                      </div>
                      {item.reason_code && (
                        <p className="font-medium text-slate-700">
                          Reason: {label(item.reason_code)}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-slate-600">{item.notes}</p>
                      )}
                    </div>
                  ))}
                  {!selected.updates?.length && (
                    <p className="text-xs text-slate-400">
                      No activity recorded.
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}
        </Card>
      </div>
      {createPanel}
    </main>
  );
}
