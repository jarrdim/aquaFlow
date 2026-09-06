import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SearchableSelect } from "../components/SearchableSelect";
import { showToast } from "../components/SweetAlertToast";
import { api } from "../lib/api";
import { isKenyanPhone, normalizeKenyanPhone } from "../lib/phone";
import { DateTimeInput } from "../components/DateInput";

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 disabled:bg-slate-50";
const primary =
  "rounded-lg bg-aqua-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-aqua-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";

type Lookups = {
  zones: { zoneId: string; zoneCode: string; zoneName: string }[];
  officers: { userId: string; name: string; username: string }[];
  defaultConnectionFee: number | string | null;
  statuses: string[];
};

type Application = {
  connectionApplicationId: string;
  applicationNumber: string;
  applicantName: string;
  phoneNumber: string;
  emailAddress?: string;
  identificationNumber?: string;
  physicalAddress?: string;
  plotNumber?: string;
  connectionType: string;
  status: string;
  zoneId?: string;
  zoneName?: string;
  connectionFee: number | string;
  connectionFeeOverridden?: boolean;
  feeOverrideReason?: string;
  inspectionScheduledAt?: string;
  inspectionOutcome?: string;
  inspectionNotes?: string;
  materialsCost?: number | string;
  labourCost?: number | string;
  quotationTotal: number | string;
  amountPaid: number | string;
  paymentReference?: string;
  customerId?: string;
  accountId?: string;
  accountNumber?: string;
  latestStkRequest?: ConnectionStkRequest | null;
  activities?: {
    connectionActivityId: string;
    activityType: string;
    notes?: string;
    performedAt: string;
    performedByName: string;
  }[];
};

type ConnectionStkRequest = {
  stkRequestId: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  customerMessage?: string;
  resultDescription?: string;
  mpesaReceiptNumber?: string;
  createdAt?: string;
};

type ConnectionC2bPayment = {
  paymentId: string;
  transactionReference: string;
  customerReference?: string;
  amount: number | string;
  paymentDate: string;
  paymentStatus: string;
  matchingStatus: string;
  paymentType: string;
  suspenseStatus?: string;
  receiptNumber?: string;
  canApply: boolean;
  applicationNumber: string;
  account?: { accountId: string; accountNumber: string } | null;
};

const STK_PENDING_TIMEOUT_MS = 5 * 60 * 1000;

function stkRequestIsStale(request: ConnectionStkRequest | null) {
  return Boolean(
    request?.status === "PENDING" &&
    request.createdAt &&
    Date.now() - new Date(request.createdAt).getTime() >= STK_PENDING_TIMEOUT_MS,
  );
}

type ExistingCustomer = {
  customerId: string;
  customerNumber: string;
  customerType: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  organizationName?: string;
  phoneNumber?: string;
  emailAddress?: string;
  status: string;
  accountCount?: number;
  activeMeters?: Array<{ meterId: string; meterNumber: string }>;
};

function customerName(customer: ExistingCustomer) {
  if (customer.organizationName) return customer.organizationName;
  return (
    [customer.firstName, customer.middleName, customer.lastName]
      .filter(Boolean)
      .join(" ") || "Unnamed customer"
  );
}

type ConnectionActivity = NonNullable<Application["activities"]>[number];

type AttachmentPreview = {
  fileName: string;
  mimeType: string;
  data: string;
};

type GpsPoint = { latitude: number; longitude: number; label: string };

function applicationGpsPoints(application: Application): GpsPoint[] {
  const points: GpsPoint[] = [];
  const add = (latitude: unknown, longitude: unknown, pointLabel: string) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    if (points.some((point) => point.latitude === lat && point.longitude === lng)) return;
    points.push({ latitude: lat, longitude: lng, label: pointLabel });
  };
  const inspect = (value: unknown, pointLabel: string) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    add(
      record.latitude ?? record.lat ?? record.gpsLatitude ?? record.gps_latitude,
      record.longitude ?? record.lng ?? record.lon ?? record.gpsLongitude ?? record.gps_longitude,
      pointLabel,
    );
    Object.values(record).forEach((child) => {
      if (child && typeof child === "object") inspect(child, pointLabel);
    });
  };

  inspect(application, "Application location");
  application.activities?.forEach((activity) => {
    if (!activity.notes) return;
    try {
      inspect(JSON.parse(activity.notes), label(activity.activityType));
    } catch {
      const match = activity.notes.match(
        /(?:lat(?:itude)?)[\s:=]+(-?\d+(?:\.\d+)?)[\s,;]+(?:l(?:on|ng|ongitude)?)[\s:=]+(-?\d+(?:\.\d+)?)/i,
      );
      if (match) add(match[1], match[2], label(activity.activityType));
    }
  });
  return points;
}

function activityAttachment(activity: ConnectionActivity) {
  if (!activity.activityType.includes("DOCUMENT") || !activity.notes)
    return null;
  try {
    const parsed = JSON.parse(activity.notes);
    if (!parsed || typeof parsed !== "object") return null;
    const name =
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : "Attached document";
    const mimeType =
      typeof parsed.mimeType === "string"
        ? parsed.mimeType
        : "application/octet-stream";
    const data = typeof parsed.data === "string" ? parsed.data : "";
    const safeData =
      /^data:(image\/(?:png|jpe?g|webp|gif)|application\/pdf);base64,/i.test(
        data,
      )
        ? data
        : "";
    const extension =
      mimeType === "application/pdf"
        ? "pdf"
        : mimeType.split("/")[1]?.replace("jpeg", "jpg") || "file";
    const fileName = name.includes(".") ? name : `${name}.${extension}`;
    const encoded = data.includes(",") ? data.slice(data.indexOf(",") + 1) : "";
    const size = encoded
      ? Math.max(0, Math.floor((encoded.length * 3) / 4))
      : 0;
    return { fileName, mimeType, data: safeData, size };
  } catch {
    return null;
  }
}

function attachmentSize(bytes: number) {
  if (!bytes) return "Stored attachment";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ConnectionActivityItem({
  activity,
  onPreview,
}: {
  activity: ConnectionActivity;
  onPreview: (attachment: AttachmentPreview) => void;
}) {
  const attachment = activityAttachment(activity);
  const isDocument = activity.activityType.includes("DOCUMENT");
  return (
    <div className="flex gap-3 border-b border-slate-100 pb-3 last:border-0">
      <span
        className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${isDocument ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}`}
      >
        {isDocument ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <path d="M7 3h7l4 4v14H7z" />
            <path d="M14 3v5h5" />
          </svg>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-current" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-800">
          {label(activity.activityType)}
        </div>
        {attachment ? (
          <div className="mt-2 flex flex-col gap-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-800">
                {attachment.fileName}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {attachment.mimeType} · {attachmentSize(attachment.size)}
              </div>
            </div>
            {attachment.data && (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onPreview(attachment)}
                  className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-600 hover:text-white"
                >
                  Preview
                </button>
                <a
                  href={attachment.data}
                  download={attachment.fileName}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-violet-700"
                >
                  Download
                </a>
              </div>
            )}
          </div>
        ) : isDocument ? (
          <div className="mt-1 text-sm text-slate-500">
            Attachment recorded. The original preview is unavailable.
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            {activity.notes || "No additional notes"}
          </div>
        )}
        <div className="mt-1 text-xs text-slate-400">
          {activity.performedByName} ·{" "}
          {new Date(activity.performedAt).toLocaleString("en-KE")}
        </div>
      </div>
    </div>
  );
}

function Loader({
  label = "Loading new connection data…",
}: {
  label?: string;
}) {
  return (
    <div className="flex min-h-60 items-center justify-center rounded-2xl border border-slate-200 bg-white">
      <div className="text-center text-sm text-slate-500">
        <span className="mx-auto mb-3 block h-8 w-8 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
        {label}
      </div>
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
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b border-slate-200 px-5 py-3.5 font-semibold text-slate-900">
          {title}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>
      )}
    </label>
  );
}

const money = (value: unknown) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (character: string) => character.toUpperCase());

const statusTone: Record<string, string> = {
  SUBMITTED: "bg-sky-50 text-sky-700",
  INSPECTION_SCHEDULED: "bg-indigo-50 text-indigo-700",
  INSPECTED: "bg-cyan-50 text-cyan-700",
  QUOTED: "bg-violet-50 text-violet-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-green-50 text-green-700",
  CUSTOMER_CREATED: "bg-teal-50 text-teal-700",
  INSTALLATION_ORDERED: "bg-orange-50 text-orange-700",
  INSTALLATION_COMPLETED: "bg-lime-50 text-lime-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-50 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[status] || "bg-slate-100 text-slate-700"}`}
    >
      {label(status)}
    </span>
  );
}

function InspectionOutcomeNotice({ selected }: { selected?: string }) {
  const rules = [
    {
      value: "FEASIBLE",
      title: "Feasible",
      text: "Unlocks quotation.",
      tone: "bg-emerald-500",
    },
    {
      value: "REVISIT",
      title: "Revisit",
      text: "Returns the application to inspection scheduling.",
      tone: "bg-amber-500",
    },
    {
      value: "NOT_FEASIBLE",
      title: "Not feasible",
      text: "Requires a reason and closes the application.",
      tone: "bg-red-500",
    },
  ];

  return (
    <aside
      className="rounded-xl border border-sky-200 bg-sky-50/70 p-3"
      aria-label="Inspection outcome rules"
    >
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-sky-900">
        Outcome rules
      </div>
      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.value}
            className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
              selected === rule.value
                ? "bg-white shadow-sm ring-1 ring-sky-200"
                : "text-slate-600"
            }`}
          >
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${rule.tone}`}
            />
            <span>
              <strong className="text-slate-800">{rule.title}:</strong>{" "}
              {rule.text}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

const actionRules: Record<string, { title: string; rules: string[] }> = {
  SUBMITTED: {
    title: "Inspection scheduling rules",
    rules: [
      "Confirm the inspection date, assigned officer and applicant notification before scheduling.",
      "The scheduling decision is recorded in the application activity history.",
    ],
  },
  INSPECTED: {
    title: "Quotation rules",
    rules: [
      "The Settings connection fee is copied into the application and included in this quotation.",
      "A fee override requires both an authorized user and a reason; the original and revised values remain auditable.",
      "Materials and labour must reflect the completed inspection.",
    ],
  },
  QUOTED: {
    title: "Payment rules",
    rules: [
      "Record the actual payment reference and amount received.",
      "A partial payment keeps the application awaiting payment; full payment unlocks the approval decision.",
    ],
  },
  PARTIALLY_PAID: {
    title: "Payment rules",
    rules: [
      "Record each additional receipt separately using its actual payment reference.",
      "Approval remains locked until the quotation balance is fully paid.",
    ],
  },
  PAID: {
    title: "Approval rules",
    rules: [
      "Approval or rejection is available only after full payment.",
      "Decision comments are mandatory and become part of the permanent audit trail.",
    ],
  },
  APPROVED: {
    title: "Customer conversion rules",
    rules: [
      "Customer registration starts only after the connection application is approved.",
      "Use the existing Create Customer workflow so identity, contact and validation rules remain in one place.",
      "The resulting customer is linked back to this application automatically.",
    ],
  },
  CUSTOMER_CREATED: {
    title: "Installation handoff rules",
    rules: [
      "Create and dispatch the installation through the existing Work Orders module.",
      "Confirm the work order reference or dispatch in the notes before advancing this application.",
    ],
  },
  INSTALLATION_ORDERED: {
    title: "Installation completion rules",
    rules: [
      "Confirm the physical work before marking installation complete.",
      "Meter serial, initial reading and completion evidence belong in the work-order completion record.",
      "Activation remains a separate controlled action.",
    ],
  },
  INSTALLATION_COMPLETED: {
    title: "Activation rules",
    rules: [
      "Activate only after final verification and meter commissioning are complete.",
      "Activation closes the operational workflow and preserves the full activity history.",
    ],
  },
};

function WorkflowActionNotice({ status }: { status: string }) {
  if (status === "INSPECTION_SCHEDULED") return null;
  const guidance = actionRules[status];
  if (!guidance) return null;

  return (
    <aside
      className="mb-4 rounded-xl border border-sky-200 bg-sky-50/70 p-3"
      aria-label={guidance.title}
    >
      <div className="text-xs font-bold uppercase tracking-wide text-sky-900">
        {guidance.title}
      </div>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
        {guidance.rules.map((rule) => (
          <li key={rule} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function ConnectionDashboard() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [result, setResult] = useState<any>(null);
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    zoneId: "",
    page: "1",
    pageSize: "25",
  });
  const [loading, setLoading] = useState(true);

  async function load(next = filters) {
    setLoading(true);
    try {
      const [summary, options, rows] = await Promise.all([
        api.connectionDashboard(),
        api.connectionLookups(),
        api.listConnections(next),
      ]);
      setDashboard(summary);
      setLookups(options as Lookups);
      setResult(rows);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to load new connections.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function apply(event?: FormEvent) {
    event?.preventDefault();
    const next = { ...filters, page: "1" };
    setFilters(next);
    void load(next);
  }

  const metrics = [
    ["All applications", dashboard?.total ?? 0],
    ["Open workflow", dashboard?.open ?? 0],
    ["Awaiting inspection", dashboard?.awaiting_inspection ?? 0],
    ["Awaiting payment", dashboard?.awaiting_payment ?? 0],
    ["Awaiting approval", dashboard?.awaiting_approval ?? 0],
    ["Active connections", dashboard?.active ?? 0],
  ];

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            New connection management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Register, inspect, quote, approve and activate water connections
          </p>
        </div>
        <Link className={primary} to="/connections/new">
          + New application
        </Link>
      </div>
      {loading && !result ? (
        <Loader />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {metrics.map(([name, value]) => (
              <div
                key={String(name)}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {name}
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {Number(value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          <Card title="Search and filters">
            <form
              onSubmit={apply}
              className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr_auto]"
            >
              <input
                className={input}
                placeholder="Application, applicant, ID or phone"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
              />
              <SearchableSelect
                className={input}
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">All statuses</option>
                {lookups?.statuses.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </SearchableSelect>
              <SearchableSelect
                className={input}
                value={filters.zoneId}
                onChange={(e) =>
                  setFilters({ ...filters, zoneId: e.target.value })
                }
              >
                <option value="">All zones</option>
                {lookups?.zones.map((zone) => (
                  <option key={zone.zoneId} value={zone.zoneId}>
                    {zone.zoneName}
                  </option>
                ))}
              </SearchableSelect>
              <button className={primary} disabled={loading}>
                {loading ? "Loading…" : "Apply filters"}
              </button>
            </form>
          </Card>
          <Card
            title={`${Number(result?.total ?? 0).toLocaleString()} application(s)`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Application</th>
                    <th className="px-4 py-3">Applicant</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Zone / Type</th>
                    <th className="px-4 py-3">Financials</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className={loading ? "opacity-50" : ""}>
                  {result?.rows?.map((row: Application) => (
                    <tr
                      key={row.connectionApplicationId}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {row.applicationNumber}
                        <div className="text-xs font-normal text-slate-500">
                          {new Date((row as any).createdAt).toLocaleDateString(
                            "en-KE",
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.applicantName}
                        <div className="text-xs text-slate-500">
                          {row.phoneNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {row.accountNumber || "Not created"}
                      </td>
                      <td className="px-4 py-3">
                        {row.zoneName || "Unassigned"}
                        <div className="text-xs text-slate-500">
                          {label(row.connectionType)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {money(row.quotationTotal)}
                        <div className="text-xs text-emerald-600">
                          {money(row.amountPaid)} paid
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          className="font-semibold text-aqua-700"
                          to={`/connections/${row.connectionApplicationId}`}
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!result?.rows?.length && (
                    <tr>
                      <td
                        className="px-4 py-12 text-center text-slate-500"
                        colSpan={7}
                      >
                        No connection applications match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {result?.page ?? 1} of {result?.totalPages ?? 1}
              </span>
              <div className="flex gap-2">
                <button
                  className={secondary}
                  disabled={loading || Number(result?.page) <= 1}
                  onClick={() => {
                    const next = {
                      ...filters,
                      page: String(Number(result.page) - 1),
                    };
                    setFilters(next);
                    void load(next);
                  }}
                >
                  Previous
                </button>
                <button
                  className={secondary}
                  disabled={
                    loading ||
                    Number(result?.page) >= Number(result?.totalPages)
                  }
                  onClick={() => {
                    const next = {
                      ...filters,
                      page: String(Number(result.page) + 1),
                    };
                    setFilters(next);
                    void load(next);
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}

const emptyApplication = {
  applicantType: "INDIVIDUAL",
  applicantName: "",
  identificationNumber: "",
  phoneNumber: "",
  emailAddress: "",
  physicalAddress: "",
  plotNumber: "",
  zoneId: "",
  connectionType: "DOMESTIC",
  remarks: "",
  connectionFee: "",
  feeOverrideReason: "",
};

export function NewConnectionApplication() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [form, setForm] = useState(emptyApplication);
  const [overrideFee, setOverrideFee] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .connectionLookups()
      .then((data: any) => {
        setLookups(data);
        setForm((current) => ({
          ...current,
          connectionFee:
            data.defaultConnectionFee == null
              ? ""
              : String(data.defaultConnectionFee),
        }));
      })
      .catch((error: Error) => showToast(error.message, "error"));
  }, []);

  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const steps = ["Applicant", "Property", "Service & fee", "Review"];
  function next() {
    if (step === 1 && (!form.applicantName.trim() || !form.phoneNumber.trim()))
      return showToast("Enter the applicant name and phone number.", "warning");
    if (step === 1 && !isKenyanPhone(form.phoneNumber))
      return showToast("Phone number must use +254 followed by 9 digits.", "warning");
    if (step === 2 && !form.physicalAddress.trim())
      return showToast("Enter the proposed connection address.", "warning");
    if (step === 3 && !overrideFee && lookups?.defaultConnectionFee == null)
      return showToast(
        "Configure the default connection fee in System Settings, or enable an authorized override.",
        "warning",
      );
    if (step === 3 && overrideFee && form.connectionFee === "")
      return showToast(
        "Enter the connection fee for this application.",
        "warning",
      );
    if (overrideFee && !form.feeOverrideReason.trim())
      return showToast(
        "Enter a reason for overriding the default fee.",
        "warning",
      );
    setStep((current) => Math.min(4, current + 1));
  }
  async function submit() {
    if (!isKenyanPhone(form.phoneNumber)) {
      showToast("Phone number must use +254 followed by 9 digits.", "warning");
      setStep(1);
      return;
    }
    if (!overrideFee && lookups?.defaultConnectionFee == null) {
      showToast(
        "Configure the default connection fee in System Settings, or enable an authorized override.",
        "warning",
      );
      return;
    }
    if (
      overrideFee &&
      (form.connectionFee === "" || !form.feeOverrideReason.trim())
    ) {
      showToast("Enter both the override fee and its reason.", "warning");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        phoneNumber: normalizeKenyanPhone(form.phoneNumber),
        zoneId: form.zoneId || null,
      };
      if (!overrideFee) delete payload.connectionFee;
      const created: any = await api.createConnection(payload);
      showToast(
        `Application ${created.applicationNumber} submitted.`,
        "success",
      );
      navigate(`/connections/${created.connectionApplicationId}`);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to submit application.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!lookups)
    return (
      <main className="mx-auto max-w-[1400px] p-4 lg:p-6">
        <Loader label="Preparing application form…" />
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div>
        <p className="mt-1 text-sm text-slate-500">
          Complete the application in four short steps; it will then enter the
          inspection workflow.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {steps.map((name, index) => (
          <button
            key={name}
            type="button"
            onClick={() => index + 1 < step && setStep(index + 1)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${step === index + 1 ? "border-aqua-600 bg-aqua-50 text-aqua-800" : index + 1 < step ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}
          >
            <span className="mr-2">{index + 1}.</span>
            {name}
          </button>
        ))}
      </div>
      <Card title={`Step ${step}: ${steps[step - 1]}`}>
        {step === 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Applicant type" required>
              <select
                className={input}
                value={form.applicantType}
                onChange={(e) => set("applicantType", e.target.value)}
              >
                <option value="INDIVIDUAL">Individual</option>
                <option value="ORGANIZATION">Organization</option>
              </select>
            </Field>
            <Field
              label={
                form.applicantType === "ORGANIZATION"
                  ? "Organization name"
                  : "Applicant name"
              }
              required
            >
              <input
                className={input}
                value={form.applicantName}
                onChange={(e) => set("applicantName", e.target.value)}
              />
            </Field>
            <Field label="National ID / registration number">
              <input
                className={input}
                value={form.identificationNumber}
                onChange={(e) => set("identificationNumber", e.target.value)}
              />
            </Field>
            <Field label="Phone number" required>
              <input
                className={input}
                value={form.phoneNumber}
                onChange={(e) => set("phoneNumber", e.target.value)}
                onBlur={(e) => set("phoneNumber", normalizeKenyanPhone(e.target.value))}
                placeholder="+254 7XX XXX XXX"
              />
            </Field>
            <Field label="Email address">
              <input
                type="email"
                className={input}
                value={form.emailAddress}
                onChange={(e) => set("emailAddress", e.target.value)}
              />
            </Field>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Physical / connection address" required>
              <input
                className={input}
                value={form.physicalAddress}
                onChange={(e) => set("physicalAddress", e.target.value)}
              />
            </Field>
            <Field label="Plot number">
              <input
                className={input}
                value={form.plotNumber}
                onChange={(e) => set("plotNumber", e.target.value)}
              />
            </Field>
            <Field label="Zone">
              <SearchableSelect
                className={input}
                value={form.zoneId}
                onChange={(e) => set("zoneId", e.target.value)}
              >
                <option value="">Select zone</option>
                {lookups.zones.map((zone) => (
                  <option key={zone.zoneId} value={zone.zoneId}>
                    {zone.zoneName}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Application notes">
              <textarea
                className={`${input} min-h-24`}
                value={form.remarks}
                onChange={(e) => set("remarks", e.target.value)}
              />
            </Field>
          </div>
        )}
        {step === 3 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Connection type" required>
              <select
                className={input}
                value={form.connectionType}
                onChange={(e) => set("connectionType", e.target.value)}
              >
                <option value="DOMESTIC">Domestic</option>
                <option value="COMMERCIAL">Commercial</option>
                <option value="INSTITUTIONAL">Institutional</option>
                <option value="PUBLIC">Public</option>
              </select>
            </Field>
            <div className="rounded-xl border border-aqua-100 bg-aqua-50 p-4">
              <div className="text-xs font-semibold uppercase text-aqua-700">
                Configured connection fee
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {lookups.defaultConnectionFee == null
                  ? "Not configured"
                  : money(lookups.defaultConnectionFee)}
              </div>
              {lookups.defaultConnectionFee == null && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Set the standard fee in System Settings before submitting, or
                  use an authorized override below.
                </p>
              )}
              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={overrideFee}
                  onChange={(e) => setOverrideFee(e.target.checked)}
                />{" "}
                Override for this application
              </label>
            </div>
            {overrideFee && (
              <>
                <Field label="Override fee" required>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={input}
                    value={form.connectionFee}
                    onChange={(e) => set("connectionFee", e.target.value)}
                  />
                </Field>
                <Field label="Override reason" required>
                  <input
                    className={input}
                    value={form.feeOverrideReason}
                    onChange={(e) => set("feeOverrideReason", e.target.value)}
                  />
                </Field>
              </>
            )}
            <p className="md:col-span-2 text-sm text-slate-500">
              The default is managed once in System Settings. Materials and
              labour are added after the site inspection when the quotation is
              prepared.
            </p>
          </div>
        )}
        {step === 4 && (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-xs uppercase text-slate-500">Applicant</div>
              <div className="mt-1 font-semibold">{form.applicantName}</div>
              <div className="text-sm text-slate-500">{form.phoneNumber}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Property</div>
              <div className="mt-1 font-semibold">{form.physicalAddress}</div>
              <div className="text-sm text-slate-500">
                {lookups.zones.find((zone) => zone.zoneId === form.zoneId)
                  ?.zoneName || "Zone not selected"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">
                Service and fee
              </div>
              <div className="mt-1 font-semibold">
                {label(form.connectionType)}
              </div>
              <div className="text-sm text-slate-500">
                {overrideFee
                  ? `${money(form.connectionFee)} · overridden`
                  : lookups.defaultConnectionFee == null
                    ? "Default fee not configured"
                    : `${money(lookups.defaultConnectionFee)} · configured default`}
              </div>
            </div>
            <div className="md:col-span-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-800">
              Submitting creates an application—not a customer account. After
              payment and approval, the existing Create Customer interface opens
              with this connection linked automatically.
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-between border-t border-slate-100 pt-4">
          <button
            type="button"
            className={secondary}
            onClick={() =>
              step === 1 ? navigate("/connections") : setStep(step - 1)
            }
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 4 ? (
            <button type="button" className={primary} onClick={next}>
              Continue
            </button>
          ) : (
            <button
              type="button"
              className={primary}
              disabled={saving}
              onClick={submit}
            >
              {saving ? "Submitting…" : "Submit application"}
            </button>
          )}
        </div>
      </Card>
    </main>
  );
}

export function ConnectionProfile() {
  const { id = "" } = useParams();
  const [application, setApplication] = useState<Application | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingStk, setSendingStk] = useState(false);
  const [stkRequest, setStkRequest] = useState<ConnectionStkRequest | null>(null);
  const [stkStatusError, setStkStatusError] = useState("");
  const [c2bReference, setC2bReference] = useState("");
  const [c2bPayments, setC2bPayments] = useState<ConnectionC2bPayment[]>([]);
  const [checkingC2b, setCheckingC2b] = useState(false);
  const [checkedC2b, setCheckedC2b] = useState(false);
  const [applyingC2bId, setApplyingC2bId] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [linkCustomerOpen, setLinkCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<ExistingCustomer[]>(
    [],
  );
  const [selectedCustomer, setSelectedCustomer] =
    useState<ExistingCustomer | null>(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [linkingCustomer, setLinkingCustomer] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentPreview | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [record, options] = await Promise.all([
        api.getConnection(id),
        api.connectionLookups(),
      ]);
      const loadedApplication = record as Application;
      setApplication(loadedApplication);
      if (loadedApplication.latestStkRequest) {
        setStkRequest(loadedApplication.latestStkRequest);
      }
      setLookups(options as Lookups);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to load application.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    setC2bReference("");
    void checkC2bPayments("");
  }, [id]);

  useEffect(() => {
    if (!stkRequest?.stkRequestId || stkRequest.status !== "PENDING") return;
    if (stkRequestIsStale(stkRequest)) {
      setStkStatusError("No callback was received within five minutes. Check C2B or send a new prompt; this request will no longer be polled.");
      return;
    }
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const latest = await api.getMpesaStkRequest(stkRequest.stkRequestId) as ConnectionStkRequest;
        if (stopped) return;
        setStkRequest(latest);
        setStkStatusError("");
        if (latest.status === "COMPLETED") {
          showToast(
            latest.mpesaReceiptNumber
              ? `M-Pesa payment confirmed. Receipt ${latest.mpesaReceiptNumber}.`
              : "M-Pesa payment confirmed.",
            "success",
          );
          setForm({});
          await load();
          return;
        }
        if (latest.status === "FAILED" || latest.status === "CANCELLED") {
          showToast(latest.resultDescription || `M-Pesa prompt ${latest.status.toLowerCase()}.`, "error");
          return;
        }
        if (stkRequestIsStale(latest)) {
          setStkStatusError("No callback was received within five minutes. Check C2B or send a new prompt; this request will no longer be polled.");
          return;
        }
      } catch (error) {
        if (stopped) return;
        setStkStatusError(error instanceof Error ? error.message : "Unable to confirm the M-Pesa payment status.");
      }
      if (!stopped) timer = window.setTimeout(poll, 3000);
    };

    timer = window.setTimeout(poll, 2000);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [stkRequest?.stkRequestId, stkRequest?.status]);
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function searchExistingCustomers(query = customerSearch) {
    setSearchingCustomers(true);
    try {
      const response = (await api.listCustomers(query.trim(), 1)) as {
        items?: ExistingCustomer[];
      };
      setCustomerResults(response.items || []);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to search customers.",
        "error",
      );
    } finally {
      setSearchingCustomers(false);
    }
  }

  async function openExistingCustomerLink() {
    const initialSearch =
      application?.phoneNumber || application?.applicantName || "";
    setCustomerSearch(initialSearch);
    setSelectedCustomer(null);
    setLinkCustomerOpen(true);
    await searchExistingCustomers(initialSearch);
  }

  async function linkExistingCustomer() {
    if (!selectedCustomer) return;
    setLinkingCustomer(true);
    try {
      await api.linkConnectionCustomer(id, selectedCustomer.customerId);
      showToast(
        `${customerName(selectedCustomer)} linked to this application.`,
        "success",
      );
      setLinkCustomerOpen(false);
      await load();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to link customer.",
        "error",
      );
    } finally {
      setLinkingCustomer(false);
    }
  }

  async function action(payload: Record<string, unknown>, success: string) {
    setSaving(true);
    try {
      await api.updateConnection(id, payload);
      showToast(success, "success");
      setForm({});
      await load();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to update application.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendStkPrompt() {
    if (!application) return;
    const amount = Number(form.amount || balance);
    const phoneNumber = form.stkPhone || application.phoneNumber;
    setSendingStk(true);
    setStkStatusError("");
    try {
      const request = await api.sendConnectionStk(id, { amount, phoneNumber }) as ConnectionStkRequest;
      setStkRequest(request);
      showToast("STK prompt sent. Ask the applicant to enter their M-Pesa PIN.", "success");
      setForm((current) => ({ ...current, amount: String(amount), stkPhone: phoneNumber }));
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to send STK prompt.", "error");
    } finally {
      setSendingStk(false);
    }
  }

  async function checkC2bPayments(reference = c2bReference) {
    setCheckingC2b(true);
    try {
      const rows = await api.listConnectionC2bPayments(id, reference.trim()) as ConnectionC2bPayment[];
      setC2bPayments(rows);
      setCheckedC2b(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to check C2B payments.", "error");
    } finally {
      setCheckingC2b(false);
    }
  }

  async function applyC2bPayment(payment: ConnectionC2bPayment) {
    setApplyingC2bId(payment.paymentId);
    try {
      const result = await api.applyConnectionC2bPayment(id, payment.paymentId) as { receiptNumber?: string };
      showToast(
        result.receiptNumber
          ? `C2B payment applied. Receipt ${result.receiptNumber}.`
          : "C2B payment applied to this connection.",
        "success",
      );
      setC2bReference("");
      await load();
      await checkC2bPayments("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to apply C2B payment.", "error");
    } finally {
      setApplyingC2bId("");
    }
  }

  if (loading && !application)
    return (
      <main className="mx-auto max-w-[1500px] p-4 lg:p-6">
        <Loader label="Loading application profile…" />
      </main>
    );
  if (!application) return null;
  const balance =
    Number(application.quotationTotal) - Number(application.amountPaid);
  const status = application.status;
  const paymentMethod = form.paymentMethod || "MPESA_STK";
  const manualPaymentReference = String(form.reference ?? "").trim();
  const manualPaymentReferenceValid =
    manualPaymentReference.length >= 2 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9 ./_-]*[A-Za-z0-9])?$/.test(manualPaymentReference);
  const staleStkRequest = stkRequestIsStale(stkRequest);
  const gpsPoints = applicationGpsPoints(application);
  const primaryGps = gpsPoints[0];
  const mapUrl = primaryGps
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${primaryGps.longitude - 0.008}%2C${primaryGps.latitude - 0.006}%2C${primaryGps.longitude + 0.008}%2C${primaryGps.latitude + 0.006}&layer=mapnik&marker=${primaryGps.latitude}%2C${primaryGps.longitude}`
    : "";
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {application.applicationNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {application.applicantName} · {application.phoneNumber}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <button
            className={secondary}
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card title="Application summary">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Applicant", application.applicantName],
                ["Connection", label(application.connectionType)],
                ["Zone", application.zoneName || "Not assigned"],
                ["Address", application.physicalAddress || "—"],
                ["Connection fee", money(application.connectionFee)],
                ["Materials", money(application.materialsCost)],
                ["Labour", money(application.labourCost)],
                ["Quotation", money(application.quotationTotal)],
              ].map(([name, value]) => (
                <div key={name}>
                  <div className="text-xs uppercase text-slate-500">{name}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {application.connectionFeeOverridden && (
              <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Fee override: {application.feeOverrideReason}
              </div>
            )}
          </Card>
          <Card title="Progress">
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                "SUBMITTED",
                "INSPECTED",
                "PAID",
                "APPROVED",
                "CUSTOMER_CREATED",
                "INSTALLATION_ORDERED",
                "INSTALLATION_COMPLETED",
                "ACTIVE",
              ].map((item) => {
                const order = [
                  "SUBMITTED",
                  "INSPECTION_SCHEDULED",
                  "INSPECTED",
                  "QUOTED",
                  "PARTIALLY_PAID",
                  "PAID",
                  "APPROVED",
                  "CUSTOMER_CREATED",
                  "INSTALLATION_ORDERED",
                  "INSTALLATION_COMPLETED",
                  "ACTIVE",
                ];
                const done = order.indexOf(status) >= order.indexOf(item);
                return (
                  <div
                    key={item}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold ${done ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-400"}`}
                  >
                    {done ? "✓ " : ""}
                    {label(item)}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Activity history">
            <div className="space-y-3">
              {application.activities?.map((activity) => (
                <ConnectionActivityItem
                  key={activity.connectionActivityId}
                  activity={activity}
                  onPreview={setPreviewAttachment}
                />
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Site location">
            {primaryGps ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <iframe
                  title="Connection site map"
                  src={mapUrl}
                  className="h-48 w-full border-0"
                  loading="lazy"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2.5">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">
                      {primaryGps.label}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {primaryGps.latitude.toFixed(6)}, {primaryGps.longitude.toFixed(6)}
                    </div>
                  </div>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${primaryGps.latitude}&mlon=${primaryGps.longitude}#map=17/${primaryGps.latitude}/${primaryGps.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-aqua-700 transition hover:text-aqua-900"
                  >
                    Open map
                  </a>
                </div>
                {gpsPoints.length > 1 && (
                  <div className="border-t border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
                    {gpsPoints.length} captured GPS points found
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                  <span aria-hidden="true" className="text-xl">⌖</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-700">No GPS point captured</p>
                <p className="mt-1 text-xs text-slate-500">The site map will appear after coordinates are saved with the inspection.</p>
              </div>
            )}
          </Card>
          <Card title="Current action">
            <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
              <div>
                <span className="block text-xs text-slate-500">Quoted</span>
                {money(application.quotationTotal)}
              </div>
              <div>
                <span className="block text-xs text-slate-500">Paid</span>
                {money(application.amountPaid)}
              </div>
              <div>
                <span className="block text-xs text-slate-500">Balance</span>
                <strong
                  className={balance > 0 ? "text-red-600" : "text-emerald-600"}
                >
                  {money(balance)}
                </strong>
              </div>
            </div>
            <WorkflowActionNotice status={status} />
            {status === "SUBMITTED" && (
              <div className="space-y-3">
                <Field label="Inspection date" required>
                  <DateTimeInput
                    className={input}
                    value={form.scheduledAt || ""}
                    onChange={(e) => set("scheduledAt", e.target.value)}
                  />
                </Field>
                <Field label="Inspection officer">
                  <SearchableSelect
                    className={input}
                    value={form.officerId || ""}
                    onChange={(e) => set("officerId", e.target.value)}
                  >
                    <option value="">Assign later</option>
                    {lookups?.officers.map((officer) => (
                      <option key={officer.userId} value={officer.userId}>
                        {officer.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </Field>
                <Field label="Notes">
                  <textarea
                    className={input}
                    value={form.notes || ""}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
                <button
                  className={`${primary} w-full`}
                  disabled={saving || !form.scheduledAt}
                  onClick={() =>
                    void action(
                      { action: "SCHEDULE_INSPECTION", ...form },
                      "Inspection scheduled.",
                    )
                  }
                >
                  Schedule inspection
                </button>
              </div>
            )}
            {status === "INSPECTION_SCHEDULED" && (
              <div className="space-y-3">
                <InspectionOutcomeNotice selected={form.outcome} />
                <Field label="Inspection outcome" required>
                  <select
                    className={input}
                    value={form.outcome || ""}
                    onChange={(e) => set("outcome", e.target.value)}
                  >
                    <option value="">Select outcome</option>
                    <option value="FEASIBLE">Feasible</option>
                    <option value="REVISIT">Revisit required</option>
                    <option value="NOT_FEASIBLE">Not feasible</option>
                  </select>
                </Field>
                <Field
                  label={
                    form.outcome === "NOT_FEASIBLE"
                      ? "Inspection report and closure reason"
                      : "Inspection report"
                  }
                  required
                >
                  <textarea
                    className={`${input} min-h-28`}
                    value={form.notes || ""}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
                <button
                  className={`${primary} w-full`}
                  disabled={saving || !form.outcome || !form.notes}
                  onClick={() =>
                    void action(
                      { action: "RECORD_INSPECTION", ...form },
                      form.outcome === "REVISIT"
                        ? "Inspection revisit recorded. Reschedule the inspection."
                        : "Inspection report recorded.",
                    )
                  }
                >
                  {saving ? "Saving reportâ€¦" : "Save inspection report"}
                </button>
              </div>
            )}
            {status === "INSPECTED" && (
              <div className="space-y-3">
                <Field label="Materials cost">
                  <input
                    type="number"
                    min={0}
                    className={input}
                    value={form.materialsCost || ""}
                    onChange={(e) => set("materialsCost", e.target.value)}
                  />
                </Field>
                <Field label="Labour cost">
                  <input
                    type="number"
                    min={0}
                    className={input}
                    value={form.labourCost || ""}
                    onChange={(e) => set("labourCost", e.target.value)}
                  />
                </Field>
                <details className="rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Override connection fee
                  </summary>
                  <div className="mt-3 space-y-3">
                    <input
                      type="number"
                      min={0}
                      className={input}
                      placeholder={String(application.connectionFee)}
                      value={form.connectionFee || ""}
                      onChange={(e) => set("connectionFee", e.target.value)}
                    />
                    <input
                      className={input}
                      placeholder="Reason for override"
                      value={form.feeOverrideReason || ""}
                      onChange={(e) => set("feeOverrideReason", e.target.value)}
                    />
                  </div>
                </details>
                <button
                  className={`${primary} w-full`}
                  disabled={saving}
                  onClick={() =>
                    void action(
                      {
                        action: "ISSUE_QUOTATION",
                        materialsCost: form.materialsCost || 0,
                        labourCost: form.labourCost || 0,
                        ...(form.connectionFee
                          ? {
                              connectionFee: form.connectionFee,
                              feeOverrideReason: form.feeOverrideReason,
                            }
                          : {}),
                      },
                      "Quotation issued.",
                    )
                  }
                >
                  Issue quotation
                </button>
              </div>
            )}
            {(status === "QUOTED" || status === "PARTIALLY_PAID") && (
              <div className="space-y-3">
                <Field label="Payment method" required>
                  <select
                    className={input}
                    value={paymentMethod}
                    onChange={(event) => set("paymentMethod", event.target.value)}
                  >
                    <option value="MPESA_STK">M-Pesa STK prompt</option>
                    <option value="MPESA_C2B">M-Pesa PayBill / C2B</option>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank direct deposit</option>
                  </select>
                </Field>

                {paymentMethod === "MPESA_STK" && <div className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/40">
                  <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-sm font-black text-white">M</div>
                    <div>
                      <p className="text-sm font-bold text-emerald-950">M-Pesa STK payment</p>
                      <p className="text-xs text-emerald-700">Send a prompt and confirm payment automatically.</p>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    <Field label="Amount to request" required>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, balance)}
                        step={1}
                        className={input}
                        value={form.amount || ""}
                        placeholder={String(balance)}
                        onChange={(e) => set("amount", e.target.value)}
                      />
                    </Field>
                    <Field label="Customer M-Pesa phone" required>
                      <input
                        type="tel"
                        className={input}
                        value={form.stkPhone ?? application.phoneNumber ?? ""}
                        onChange={(e) => set("stkPhone", e.target.value)}
                        placeholder="+2547XXXXXXXX"
                      />
                    </Field>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={sendingStk || saving || (stkRequest?.status === "PENDING" && !staleStkRequest) || !(form.stkPhone ?? application.phoneNumber) || Number(form.amount || balance) <= 0}
                      onClick={() => void sendStkPrompt()}
                    >
                      {sendingStk
                        ? "Sending prompt..."
                        : stkRequest?.status === "PENDING" && !staleStkRequest
                          ? "Waiting for M-Pesa confirmation..."
                          : staleStkRequest
                            ? "Send a new M-Pesa prompt"
                          : `Send prompt for ${money(form.amount || balance)}`}
                    </button>
                    {stkRequest && (
                      <div className={`rounded-lg border px-3 py-2.5 text-xs ${
                        stkRequest.status === "COMPLETED"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : stkRequest.status === "PENDING"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-red-200 bg-red-50 text-red-700"
                      }`}>
                        <div className="flex items-center gap-2 font-bold">
                          {stkRequest.status === "PENDING" && !staleStkRequest && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />}
                          {stkRequest.status === "COMPLETED"
                            ? "Payment confirmed"
                            : stkRequest.status === "PENDING" && !staleStkRequest
                              ? "Prompt sent - checking automatically"
                              : staleStkRequest
                                ? "Prompt expired without confirmation"
                              : `Prompt ${stkRequest.status.toLowerCase()}`}
                        </div>
                        <p className="mt-1">
                          {stkRequest.mpesaReceiptNumber
                            ? `Receipt: ${stkRequest.mpesaReceiptNumber}`
                            : staleStkRequest
                              ? "The old request is no longer being checked. Search for a C2B receipt below or send a new prompt."
                              : stkRequest.resultDescription || stkRequest.customerMessage || "Ask the customer to complete the prompt on their phone."}
                        </p>
                      </div>
                    )}
                    {stkStatusError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        Payment-status check: {stkStatusError}
                      </div>
                    )}
                  </div>
                </div>}

                {paymentMethod === "MPESA_C2B" && <div className="overflow-hidden rounded-xl border border-sky-200 bg-sky-50/40">
                  <div className="border-b border-sky-100 bg-sky-50 px-4 py-3">
                    <p className="text-sm font-bold text-sky-950">Paid through PayBill / C2B?</p>
                    <p className="mt-1 text-xs text-sky-700">
                      Expected account reference: <span className="font-bold">{application.applicationNumber}</span>
                    </p>
                  </div>
                  <div className="space-y-3 p-4">
                    <p className="text-xs text-slate-600">
                      Payments using the application number are checked automatically. Enter the M-Pesa receipt to find a payment made with another reference.
                    </p>
                    <div className="flex gap-2">
                      <input
                        className={input}
                        value={c2bReference}
                        onChange={(event) => setC2bReference(event.target.value.toUpperCase())}
                        placeholder="M-Pesa receipt, e.g. UI3AB59S7S"
                      />
                      <button
                        type="button"
                        className={secondary}
                        disabled={checkingC2b}
                        onClick={() => void checkC2bPayments()}
                      >
                        {checkingC2b ? "Checking…" : "Check"}
                      </button>
                    </div>
                    {c2bPayments.map((payment) => {
                      const appliedHere = payment.paymentType === "NEW_CONNECTION_FEE" &&
                        payment.paymentStatus === "POSTED" &&
                        payment.customerReference?.toUpperCase() === payment.applicationNumber.toUpperCase();
                      const matchedElsewhere = payment.paymentStatus === "POSTED" && !appliedHere;
                      return (
                        <div key={payment.paymentId} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-900">{payment.transactionReference} · {money(payment.amount)}</div>
                              <div className="mt-1 text-slate-500">PayBill reference: {payment.customerReference || "Not supplied"}</div>
                            </div>
                            <span className={`rounded-full px-2 py-1 font-bold ${
                              appliedHere
                                ? "bg-emerald-100 text-emerald-700"
                                : matchedElsewhere
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-red-100 text-red-700"
                            }`}>
                              {appliedHere ? "Applied" : matchedElsewhere ? "Matched elsewhere" : "Unmatched"}
                            </span>
                          </div>
                          {matchedElsewhere && (
                            <p className="mt-2 font-semibold text-amber-700">
                              {payment.account?.accountNumber
                                ? `Already matched to account ${payment.account.accountNumber}; it cannot be moved automatically.`
                                : "Already applied to another purpose; it cannot be moved automatically."}
                            </p>
                          )}
                          {!appliedHere && !matchedElsewhere && payment.canApply && (
                            <button
                              type="button"
                              className="mt-3 w-full rounded-lg bg-sky-700 px-3 py-2 font-bold text-white hover:bg-sky-800 disabled:opacity-50"
                              disabled={Boolean(applyingC2bId)}
                              onClick={() => void applyC2bPayment(payment)}
                            >
                              {applyingC2bId === payment.paymentId ? "Applying…" : "Apply this payment to the connection"}
                            </button>
                          )}
                          {!appliedHere && !matchedElsewhere && !payment.canApply && (
                            <p className="mt-2 font-semibold text-red-700">
                              This payment needs finance review and cannot be applied automatically.
                            </p>
                          )}
                          {payment.receiptNumber && <p className="mt-2 text-emerald-700">Receipt: {payment.receiptNumber}</p>}
                        </div>
                      );
                    })}
                    {checkedC2b && !checkingC2b && !c2bPayments.length && (
                      <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
                        No C2B payment was found. Confirm the receipt number, then check the unmatched-payments register if a different PayBill reference was used.
                      </p>
                    )}
                  </div>
                </div>}

                {(paymentMethod === "CASH" || paymentMethod === "BANK") && <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{paymentMethod === "BANK" ? "Record bank direct payment" : "Record cash payment"}</p>
                      <p className="mt-1 text-xs text-slate-500">Only record funds already received and independently verified.</p>
                    </div>
                    <Field label="Amount received" required>
                      <input
                        type="number"
                        min={0.01}
                        max={Math.max(0.01, balance)}
                        step="0.01"
                        className={input}
                        value={form.amount || ""}
                        placeholder={String(balance)}
                        onChange={(event) => set("amount", event.target.value)}
                      />
                    </Field>
                    <Field label={paymentMethod === "BANK" ? "Bank transaction / deposit reference" : "Cash receipt / register reference"} required>
                      <input
                        className={input}
                        value={form.reference || ""}
                        maxLength={120}
                        onChange={(e) => set("reference", e.target.value)}
                        placeholder={paymentMethod === "BANK" ? "Bank transaction or deposit slip number" : "Cash receipt or register number"}
                      />
                      {manualPaymentReference && !manualPaymentReferenceValid && (
                        <p className="mt-1.5 text-xs font-semibold text-red-600">
                          Enter a valid reference beginning and ending with a letter or number.
                        </p>
                      )}
                    </Field>
                    <button
                      className={`${primary} w-full`}
                      disabled={saving || Number(form.amount || 0) <= 0 || !manualPaymentReferenceValid}
                      onClick={() =>
                        void action(
                          {
                            action: "RECORD_PAYMENT",
                            amount: form.amount,
                            reference: form.reference,
                            paymentMethod,
                          },
                          `${paymentMethod === "BANK" ? "Bank" : "Cash"} payment recorded.`,
                        )
                      }
                    >
                      {saving ? "Recording…" : `Record ${paymentMethod === "BANK" ? "bank" : "cash"} payment`}
                    </button>
                  </div>
                </div>}
              </div>
            )}
            {status === "PAID" && (
              <DecisionButtons
                saving={saving}
                form={form}
                set={set}
                approve={() =>
                  action(
                    { action: "APPROVE", notes: form.notes },
                    "Connection approved. The welcome SMS will be sent when the account number is created.",
                  )
                }
                reject={() =>
                  action(
                    { action: "REJECT", notes: form.notes },
                    "Application rejected.",
                  )
                }
              />
            )}
            {status === "APPROVED" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Link the approved applicant to an existing customer profile,
                  or open the current Create Customer workflow with this
                  application attached.
                </p>
                <button
                  className={`${secondary} w-full`}
                  onClick={() => void openExistingCustomerLink()}
                >
                  Link existing customer
                </button>
                <Link
                  className={`${primary} block text-center`}
                  to={`/customers/new?connectionId=${id}&returnTo=${encodeURIComponent(`/connections/${id}`)}`}
                >
                  Open Create Customer
                </Link>
                <p className="text-xs text-slate-500">
                  Only one customer can be linked to a connection application.
                </p>
              </div>
            )}
            {status === "CUSTOMER_CREATED" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Create the installation work order with this connection and
                  its linked customer already filled in.
                </p>
                <Link
                  className={`${primary} block text-center`}
                  to={`/work-orders/new?connectionId=${id}`}
                >
                  Create installation work order
                </Link>
                <p className="text-xs text-slate-500">
                  Creating it automatically records the installation as ordered
                  and returns you here.
                </p>
              </div>
            )}
            {status === "INSTALLATION_ORDERED" && (
              <NoteAction
                title="Confirm installation completion and attach operational evidence in the work-order module."
                button="Mark installation completed"
                saving={saving}
                form={form}
                set={set}
                run={() =>
                  action(
                    {
                      action: "MARK_INSTALLATION_COMPLETED",
                      notes: form.notes,
                    },
                    "Installation completed.",
                  )
                }
              />
            )}
            {status === "INSTALLATION_COMPLETED" && (
              <NoteAction
                title="Activate the connection after final verification and meter commissioning."
                button="Activate connection"
                saving={saving}
                form={form}
                set={set}
                run={() =>
                  action(
                    { action: "ACTIVATE", notes: form.notes },
                    "Connection activated.",
                  )
                }
              />
            )}
            {(status === "ACTIVE" || status === "REJECTED") && (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                This workflow is complete. Review the activity history for the
                full audit trail.
              </div>
            )}
          </Card>
        </div>
      </div>

      {previewAttachment && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${previewAttachment.fileName}`}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close document preview"
            onClick={() => setPreviewAttachment(null)}
          />
          <section className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-slate-900">{previewAttachment.fileName}</h2>
                <p className="text-xs text-slate-500">{previewAttachment.mimeType}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href={previewAttachment.data} download={previewAttachment.fileName} className={secondary}>Download</a>
                <button type="button" className="grid h-10 w-10 place-items-center rounded-lg text-2xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close preview" onClick={() => setPreviewAttachment(null)}>×</button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 sm:p-5">
              {previewAttachment.mimeType === "application/pdf" ? (
                <iframe title={previewAttachment.fileName} src={previewAttachment.data} className="h-[72vh] w-full rounded-xl border-0 bg-white" />
              ) : (
                <img src={previewAttachment.data} alt={previewAttachment.fileName} className="mx-auto max-h-[72vh] max-w-full rounded-xl bg-white object-contain shadow-sm" />
              )}
            </div>
          </section>
        </div>
      )}

      {linkCustomerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
          role="dialog"
          aria-modal="true"
          aria-label="Link existing customer"
        >
          <button
            className="absolute inset-0 cursor-default"
            aria-label="Close customer selection"
            onClick={() => setLinkCustomerOpen(false)}
          />
          <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Link existing customer
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Search existing customer profiles and select the correct
                  match.
                </p>
              </div>
              <button
                className="rounded-lg p-2 text-xl text-slate-500 hover:bg-slate-100"
                aria-label="Close"
                onClick={() => setLinkCustomerOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                Applicant: <strong>{application.applicantName}</strong> ·{" "}
                {application.phoneNumber}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchExistingCustomers();
                }}
              >
                <input
                  className={input}
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Customer number, name or phone"
                  autoFocus
                />
                <button
                  className={primary}
                  disabled={searchingCustomers}
                  type="submit"
                >
                  {searchingCustomers ? "Searching…" : "Search"}
                </button>
              </form>

              {searchingCustomers ? (
                <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">
                  <span className="mr-3 h-6 w-6 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
                  Searching customer records…
                </div>
              ) : customerResults.length ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Showing the first {customerResults.length} matching
                    customers. Refine the search if needed.
                  </p>
                  {customerResults.map((customer) => {
                    const selected =
                      selectedCustomer?.customerId === customer.customerId;
                    return (
                      <button
                        key={customer.customerId}
                        type="button"
                        className={`w-full rounded-xl border p-3 text-left transition ${selected ? "border-aqua-600 bg-sky-50 ring-2 ring-aqua-100" : "border-slate-200 hover:border-aqua-300 hover:bg-slate-50"}`}
                        onClick={() => setSelectedCustomer(customer)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">
                              {customerName(customer)}
                            </div>
                            <div className="mt-1 text-sm text-slate-600">
                              {customer.customerNumber} ·{" "}
                              {customer.phoneNumber || "No phone"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {customer.emailAddress || "No email"} ·{" "}
                              {customer.accountCount || 0} account(s) ·{" "}
                              {Array.isArray(customer.activeMeters)
                                ? customer.activeMeters.length
                                : 0}{" "}
                              active meter(s) · {customer.status}
                            </div>
                          </div>
                          <span
                            className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 ${selected ? "border-aqua-600 bg-aqua-600 shadow-[inset_0_0_0_4px_white]" : "border-slate-300"}`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                  No customer matched this search.
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 bg-white p-5">
              {selectedCustomer && (
                <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Selected: <strong>{customerName(selectedCustomer)}</strong> (
                  {selectedCustomer.customerNumber})
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button
                  className={secondary}
                  type="button"
                  disabled={linkingCustomer}
                  onClick={() => setLinkCustomerOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className={primary}
                  type="button"
                  disabled={!selectedCustomer || linkingCustomer}
                  onClick={() => void linkExistingCustomer()}
                >
                  {linkingCustomer ? "Linking…" : "Link selected customer"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function NoteAction({
  title,
  button,
  saving,
  form,
  set,
  run,
}: {
  title: string;
  button: string;
  saving: boolean;
  form: Record<string, string>;
  set: (key: string, value: string) => void;
  run: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{title}</p>
      <Field label="Action notes" required>
        <textarea
          className={`${input} min-h-24`}
          value={form.notes || ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <button
        className={`${primary} w-full`}
        disabled={saving || !form.notes}
        onClick={run}
      >
        {saving ? "Saving…" : button}
      </button>
    </div>
  );
}

function DecisionButtons({
  saving,
  form,
  set,
  approve,
  reject,
}: {
  saving: boolean;
  form: Record<string, string>;
  set: (key: string, value: string) => void;
  approve: () => void;
  reject: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Decision notes" required>
        <textarea
          className={`${input} min-h-28`}
          value={form.notes || ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <button
          className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={saving || !form.notes}
          onClick={reject}
        >
          Reject
        </button>
        <button
          className={primary}
          disabled={saving || !form.notes}
          onClick={approve}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
