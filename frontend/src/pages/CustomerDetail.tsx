import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";
import { decodeId, encodeId } from "../lib/hashids";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { maskAddress, maskEmail, maskName, maskPhone, usePrivacyMode } from "../lib/privacyMode";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Customer {
  customerId: string;
  customerNumber: string;
  customerType: "INDIVIDUAL" | "ORGANIZATION";
  firstName?: string;
  middleName?: string;
  lastName?: string;
  organizationName?: string;
  nationalId?: string;
  registrationNumber?: string;
  phoneNumber: string;
  alternativePhone?: string;
  emailAddress?: string;
  preferredLanguage: string;
  status: string;
  registrationDate: string;
  accounts?: Account[];
  portalAccess?: {
    username: string;
    phoneNumber?: string;
    status: string;
    updatedAt: string;
  } | null;
}
interface Account {
  accountId: string;
  accountNumber: string;
  accountStatus: string;
  currentBalance: number;
  property?: { physicalAddress: string };
  category?: { categoryName: string };
}
interface Property {
  propertyId: string;
  propertyCode: string;
  physicalAddress: string;
  zone?: { zoneName: string };
  status: string;
}
interface Lookup { [key: string]: any; }
interface CustomerMeter {
  meterId: string;
  meterNumber: string;
  meterType: string;
  meterSizeMm: number;
  status: string;
  installationDate?: string;
  assignment?: { account?: { accountNumber?: string } };
}
interface CustomerBill {
  billId: string;
  billNumber: string;
  accountId: string;
  account?: { accountNumber?: string };
  billingCycle?: { cycleName?: string };
  issueDate: string;
  dueDate: string;
  totalAmountDue: number;
  paidAmount: number;
  status: string;
}
interface CustomerPayment {
  paymentId: string;
  transactionReference: string;
  accountId?: string;
  account?: { accountNumber?: string };
  channel?: { channelName?: string };
  receipt?: { receiptId: string; receiptNumber?: string };
  amount: number;
  unallocatedAmount: number;
  paymentDate: string;
  matchingStatus: string;
  paymentStatus: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  ACTIVE:       "bg-green-100 text-green-700",
  INACTIVE:     "bg-slate-100 text-slate-500",
  SUSPENDED:    "bg-orange-100 text-orange-700",
  CLOSED:       "bg-red-100 text-red-600",
  OPEN:         "bg-green-100 text-green-700",
  DISCONNECTED: "bg-red-100 text-red-600",
  APPROVED:     "bg-cyan-100 text-cyan-700",
  POSTED:       "bg-green-100 text-green-700",
  PAID:         "bg-emerald-100 text-emerald-700",
  PARTIALLY_PAID: "bg-violet-100 text-violet-700",
  MATCHED:      "bg-green-100 text-green-700",
  UNMATCHED:    "bg-amber-100 text-amber-700",
  REVERSED:     "bg-slate-200 text-slate-600",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700",
};
function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
const FIELD_CLS = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aqua-500 bg-white";
const LABEL_CLS = "block text-xs font-medium text-slate-600 mb-1";
const money = (value: unknown) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const initials = (value?: string) =>
  (value ?? "Customer").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
function InfoRow({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-start py-1.5 border-b border-slate-100 last:border-0">
      <span className="w-36 flex-shrink-0 text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-medium text-slate-800 flex-1 ${valueClass ?? ""}`}>{value ?? "\u2014"}</span>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

type Tab = "properties" | "billing" | "payments" | "service_requests" | "meters" | "notes";

// ── Component ──────────────────────────────────────────────────────────────────
export default function CustomerDetail() {
  const { enabled: privacyMode } = usePrivacyMode();
  const { id: encodedId } = useParams<{ id: string }>();
  const rawId = encodedId ? String(decodeId(encodedId)) : "";
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [zones, setZones]         = useState<Lookup[]>([]);
  const [serviceAreas, setServiceAreas] = useState<Lookup[]>([]);
  const [routes, setRoutes]       = useState<Lookup[]>([]);
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [meters, setMeters]         = useState<CustomerMeter[]>([]);
  const [bills, setBills]           = useState<CustomerBill[]>([]);
  const [payments, setPayments]     = useState<CustomerPayment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("billing");

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showPortalForm, setShowPortalForm] = useState(false);
  const [portalSaving, setPortalSaving] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [portalSuccess, setPortalSuccess] = useState<string | null>(null);
  const [portalResult, setPortalResult] = useState<{ username: string; password: string; phoneNumber: string } | null>(null);
  const [portalForm, setPortalForm] = useState({ phoneNumber: "", password: "", confirmation: "" });
  const sessionRoles = getSessionUser()?.roles ?? [];
  const canManagePortal = sessionRoles.includes("SYSTEM_ADMIN") || sessionRoles.includes("CUSTOMER_CARE_OFFICER");

  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [propertyForm, setPropertyForm] = useState({
    zoneId: "", serviceAreaId: "", routeId: "",
    plotNumber: "", buildingName: "", physicalAddress: "",
  });

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ propertyId: "", categoryId: "" });
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyForm.zoneId) { setServiceAreas([]); setRoutes([]); return; }
    api.listServiceAreas(propertyForm.zoneId).then(setServiceAreas);
    api.listRoutes(propertyForm.zoneId).then(setRoutes);
  }, [propertyForm.zoneId]);

  async function loadAll() {
    if (!rawId || rawId === "0") { setError("Invalid customer link."); return; }
    const [c, props, z, cats, customerMeters] = await Promise.all([
      api.getCustomer(rawId),
      api.listProperties(rawId),
      api.listZones(),
      api.listCategories(),
      api.listMeters({ customerId: rawId }),
    ]);
    setCustomer(c);
    setProperties(props);
    setZones(z);
    setCategories(cats);
    setMeters(customerMeters);
    const accountIds = (c.accounts ?? []).map((account: Account) => String(account.accountId));
    setHistoryLoading(true);
    try {
      const [billGroups, paymentGroups] = await Promise.all([
        Promise.all(accountIds.map((accountId: string) => api.listBills({ accountId }))),
        Promise.all(accountIds.map((accountId: string) => api.listPayments({ accountId }))),
      ]);
      setBills(
        billGroups
          .flat()
          .sort((a: CustomerBill, b: CustomerBill) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()),
      );
      setPayments(
        paymentGroups
          .flat()
          .sort((a: CustomerPayment, b: CustomerPayment) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()),
      );
    } finally {
      setHistoryLoading(false);
    }
    setEditForm({
      firstName:        c.firstName ?? "",
      middleName:       c.middleName ?? "",
      lastName:         c.lastName ?? "",
      organizationName: c.organizationName ?? "",
      nationalId:       c.nationalId ?? "",
      registrationNumber: c.registrationNumber ?? "",
      phoneNumber:      c.phoneNumber ?? "",
      alternativePhone: c.alternativePhone ?? "",
      emailAddress:     c.emailAddress ?? "",
      preferredLanguage: c.preferredLanguage ?? "EN",
      status:           c.status,
    });
  }

  useEffect(() => { loadAll().catch((e) => setError(e.message)); }, [rawId]);

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!rawId) return;
    setFieldErrors({});
    setError(null);
    try {
      if (!rawId || !customer) return;
      // Only send fields relevant to this customer's type — avoids sending
      // organizationName="" for INDIVIDUAL customers which trips min(1) validation
      const payload: Record<string, string> = {
        status:            editForm.status,
        preferredLanguage: editForm.preferredLanguage,
        phoneNumber:       editForm.phoneNumber,
      };
      if (editForm.alternativePhone) payload.alternativePhone = editForm.alternativePhone;
      if (editForm.emailAddress)     payload.emailAddress     = editForm.emailAddress;

      if (customer.customerType === "INDIVIDUAL") {
        if (editForm.firstName)  payload.firstName  = editForm.firstName;
        if (editForm.middleName) payload.middleName = editForm.middleName;
        if (editForm.lastName)   payload.lastName   = editForm.lastName;
        if (editForm.nationalId) payload.nationalId = editForm.nationalId;
      } else {
        if (editForm.organizationName)   payload.organizationName   = editForm.organizationName;
        if (editForm.registrationNumber) payload.registrationNumber = editForm.registrationNumber;
      }

      const updated = await api.updateCustomer(rawId, payload);
      setCustomer((current) => ({
        ...updated,
        portalAccess: current?.portalAccess ?? null,
      }));
      setEditing(false);
    } catch (err: any) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
      } else {
        setError(err.message);
      }
    }
  }

  function openPortalForm() {
    if (!customer) return;
    setPortalError(null);
    setPortalResult(null);
    setPortalForm({
      phoneNumber: customer.portalAccess?.phoneNumber || customer.phoneNumber || "",
      password: "",
      confirmation: "",
    });
    setShowPortalForm(true);
  }

  function generatePortalPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const random = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
    const password = `A${random.slice(0, 8)}!7a`;
    setPortalForm((current) => ({ ...current, password, confirmation: password }));
  }

  async function savePortalAccess(e: FormEvent) {
    e.preventDefault();
    if (!customer || !rawId) return;
    setPortalError(null);
    if (portalForm.password.length < 8) {
      setPortalError("Password must contain at least 8 characters.");
      return;
    }
    if (portalForm.password !== portalForm.confirmation) {
      setPortalError("Password confirmation does not match.");
      return;
    }
    setPortalSaving(true);
    try {
      const result = await api.createCustomerPortalAccess(rawId, {
        phoneNumber: portalForm.phoneNumber,
        password: portalForm.password,
      });
      setCustomer((current) => current ? {
        ...current,
        portalAccess: {
          username: result.username,
          phoneNumber: result.phoneNumber,
          status: result.status,
          updatedAt: new Date().toISOString(),
        },
      } : current);
      setPortalResult({
        username: result.username,
        phoneNumber: result.phoneNumber,
        password: portalForm.password,
      });
      setPortalSuccess(result.created ? "Customer portal access created." : "Customer portal password reset.");
    } catch (err: any) {
      setPortalError(err.message);
    } finally {
      setPortalSaving(false);
    }
  }

  async function submitProperty(e: FormEvent) {
    e.preventDefault();
    if (!rawId) return;
    try {
      await api.createProperty({ ownerCustomerId: rawId, ...propertyForm });
      setShowPropertyForm(false);
      setPropertyForm({ zoneId: "", serviceAreaId: "", routeId: "", plotNumber: "", buildingName: "", physicalAddress: "" });
      loadAll();
    } catch (err: any) { setError(err.message); }
  }

  async function submitAccount(e: FormEvent) {
    e.preventDefault();
    if (!rawId) return;
    try {
      await api.createAccount({ customerId: rawId, ...accountForm });
      setShowAccountForm(false);
      setAccountForm({ propertyId: "", categoryId: "" });
      loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function activateAccount(accountId: string) {
    setActivatingAccountId(accountId);
    setError(null);
    try {
      await api.activateAccount(accountId);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActivatingAccountId(null);
    }
  }

  if (error) return (
    <div className="p-6">
      <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
    </div>
  );
  if (!customer) return (
    <div className="p-6 flex items-center gap-2 text-slate-400 text-sm">
      <svg className="animate-spin w-4 h-4 text-aqua-600" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      Loading…
    </div>
  );

  const displayName =
    customer.customerType === "ORGANIZATION"
      ? customer.organizationName
      : [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
  const displayMoney = (value: unknown) => money(value);

  const TABS: { key: Tab; label: string }[] = [
    { key: "billing",          label: "Billing History" },
    { key: "payments",         label: "Payments" },
    { key: "service_requests", label: "Service Requests" },
    { key: "meters",           label: "Meters" },
    { key: "properties",       label: "Properties & Accounts" },
    { key: "notes",            label: "Notes" },
  ];

  const primaryAccount  = customer.accounts?.[0];
  const primaryProperty = properties[0];
  const latestPayment = payments.find((payment) => payment.paymentStatus !== "REVERSED");
  const validPayments = payments.filter((payment) => payment.paymentStatus !== "REVERSED");
  const totalPaid = validPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const totalBilled = bills.reduce((sum, bill) => sum + Number(bill.totalAmountDue), 0);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-5 lg:px-8">
      <SweetAlertToast message={portalSuccess} type="success" />
      {/* Customer identity and actions */}
      <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-aqua-600 to-blue-700 text-lg font-bold text-white shadow-md">
            {privacyMode ? "CU" : initials(displayName)}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{privacyMode ? maskName(displayName) : displayName}</h1>
              <StatusBadge status={customer.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{customer.customerNumber}</span>
              {primaryAccount && <><span className="text-slate-300">•</span><span>{primaryAccount.accountNumber}</span></>}
              <span className="text-slate-300">•</span>
              <span>{customer.customerType === "INDIVIDUAL" ? "Individual customer" : "Organization"}</span>
            </div>
          </div>
        </div>
        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            {canManagePortal && (
              <button
                type="button"
                onClick={openPortalForm}
                className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100"
              >
                {customer.portalAccess ? "Reset portal password" : "Create portal login"}
              </button>
            )}
            {primaryAccount && (
              <Link
                to={`/payments/mpesa?accountId=${primaryAccount.accountId}`}
                className="rounded-lg border border-aqua-200 bg-aqua-50 px-4 py-2 text-sm font-semibold text-aqua-800 transition-colors hover:bg-aqua-100"
              >
                Request payment
              </Link>
            )}
            <button
              onClick={() => { setEditing(true); setFieldErrors({}); setError(null); }}
              className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-aqua-600"
            >
              Edit customer
            </button>
          </div>
        )}
      </div>

      {showPortalForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {customer.portalAccess ? "Reset customer portal password" : "Create customer portal login"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{customer.customerNumber} · {privacyMode ? maskName(displayName) : displayName}</p>
              </div>
              <button type="button" onClick={() => { setShowPortalForm(false); setPortalResult(null); }} className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button>
            </div>

            {portalResult ? (
              <div className="space-y-5 px-6 py-6">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="font-semibold text-emerald-800">Portal credentials are ready</p>
                  <p className="mt-1 text-sm text-emerald-700">Share them securely. The password is shown only here.</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {[["Username", portalResult.username], ["Phone", portalResult.phoneNumber], ["Temporary password", portalResult.password]].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
                      <span className="text-sm text-slate-500">{label}</span>
                      <span className="break-all text-right font-mono text-sm font-semibold text-slate-900">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => void navigator.clipboard.writeText(`Username: ${portalResult.username}\nPhone: ${portalResult.phoneNumber}\nPassword: ${portalResult.password}`).then(() => setPortalSuccess("Credentials copied securely."))} className="flex-1 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-600">Copy credentials</button>
                  <button type="button" onClick={() => { setShowPortalForm(false); setPortalResult(null); setPortalForm({ phoneNumber: "", password: "", confirmation: "" }); }} className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={savePortalAccess} className="space-y-4 px-6 py-6">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                  Username: <strong>{customer.customerNumber}</strong>. All {customer.accounts?.length ?? 0} linked water account(s) will be available in the app.
                </div>
                <Field label="Portal phone number">
                  <input className={FIELD_CLS} value={portalForm.phoneNumber} onChange={(event) => setPortalForm((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="+254700000000" autoComplete="tel" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Temporary password">
                    <input type="password" className={FIELD_CLS} value={portalForm.password} onChange={(event) => setPortalForm((current) => ({ ...current, password: event.target.value }))} autoComplete="new-password" />
                  </Field>
                  <Field label="Confirm password">
                    <input type="password" className={FIELD_CLS} value={portalForm.confirmation} onChange={(event) => setPortalForm((current) => ({ ...current, confirmation: event.target.value }))} autoComplete="new-password" />
                  </Field>
                </div>
                <button type="button" onClick={generatePortalPassword} className="text-sm font-semibold text-violet-700 hover:text-violet-600">Generate a strong password</button>
                {portalError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{portalError}</div>}
                <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                  <button type="button" onClick={() => setShowPortalForm(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={portalSaving} className="rounded-lg bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-600 disabled:opacity-60">
                    {portalSaving ? "Saving…" : customer.portalAccess ? "Reset password" : "Create login"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Edit form (full width, shown instead of cards) ── */}
      {editing && (
        <form onSubmit={saveEdit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-3 space-y-3 text-sm">
          <h2 className="font-semibold text-slate-700 mb-1">Edit Customer</h2>
          {customer.customerType === "INDIVIDUAL" ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="First Name" error={fieldErrors.firstName?.[0]}>
                <input className={FIELD_CLS} value={editForm.firstName} onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))} />
              </Field>
              <Field label="Middle Name" error={fieldErrors.middleName?.[0]}>
                <input className={FIELD_CLS} value={editForm.middleName} onChange={(e) => setEditForm((f) => ({ ...f, middleName: e.target.value }))} />
              </Field>
              <Field label="Last Name" error={fieldErrors.lastName?.[0]}>
                <input className={FIELD_CLS} value={editForm.lastName} onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))} />
              </Field>
            </div>
          ) : (
            <Field label="Organization Name" error={fieldErrors.organizationName?.[0]}>
              <input className={FIELD_CLS} value={editForm.organizationName} onChange={(e) => setEditForm((f) => ({ ...f, organizationName: e.target.value }))} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={customer.customerType === "ORGANIZATION" ? "Reg. Number" : "National ID"} error={fieldErrors.nationalId?.[0] ?? fieldErrors.registrationNumber?.[0]}>
              <input className={FIELD_CLS}
                value={customer.customerType === "ORGANIZATION" ? editForm.registrationNumber : editForm.nationalId}
                onChange={(e) => setEditForm((f) => customer.customerType === "ORGANIZATION"
                  ? { ...f, registrationNumber: e.target.value }
                  : { ...f, nationalId: e.target.value })}
              />
            </Field>
            <Field label="Status" error={fieldErrors.status?.[0]}>
              <SearchableSelect className={FIELD_CLS} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                {["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"].map((s) => <option key={s}>{s}</option>)}
              </SearchableSelect>
            </Field>
            <Field label="Phone" error={fieldErrors.phoneNumber?.[0]}>
              <input className={FIELD_CLS} value={editForm.phoneNumber} onChange={(e) => setEditForm((f) => ({ ...f, phoneNumber: e.target.value }))} />
            </Field>
            <Field label="Alternative Phone" error={fieldErrors.alternativePhone?.[0]}>
              <input className={FIELD_CLS} value={editForm.alternativePhone} onChange={(e) => setEditForm((f) => ({ ...f, alternativePhone: e.target.value }))} />
            </Field>
            <Field label="Email" error={fieldErrors.emailAddress?.[0]}>
              <input type="email" className={FIELD_CLS} value={editForm.emailAddress} onChange={(e) => setEditForm((f) => ({ ...f, emailAddress: e.target.value }))} />
            </Field>
            <Field label="Preferred Language" error={fieldErrors.preferredLanguage?.[0]}>
              <SearchableSelect className={FIELD_CLS} value={editForm.preferredLanguage} onChange={(e) => setEditForm((f) => ({ ...f, preferredLanguage: e.target.value }))}>
                <option value="EN">English</option>
                <option value="SW">Swahili</option>
              </SearchableSelect>
            </Field>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" className="px-4 py-2 text-sm font-medium bg-aqua-700 hover:bg-aqua-600 text-white rounded-lg shadow-sm transition-colors">
              Save Changes
            </button>
            <button type="button" onClick={() => { setEditing(false); setFieldErrors({}); setError(null); }} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
          </div>
          <SweetAlertToast message={error} type="error" />
        </form>
      )}

      {/* ── Two-card row (view mode) ── */}
      {!editing && (
        <div className="mb-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Outstanding balance", value: displayMoney(primaryAccount?.currentBalance), accent: Number(primaryAccount?.currentBalance ?? 0) > 0 ? "text-rose-600" : "text-emerald-600", note: primaryAccount?.accountNumber ?? "No linked account" },
              { label: "Total billed", value: displayMoney(totalBilled), accent: "text-slate-900", note: `${bills.length} invoice${bills.length === 1 ? "" : "s"}` },
              { label: "Payment records", value: displayMoney(totalPaid), accent: "text-emerald-600", note: `${validPayments.length} valid payment${validPayments.length === 1 ? "" : "s"} · includes migrated receipts` },
              { label: "Last payment", value: latestPayment ? displayMoney(latestPayment.amount) : "No payments", accent: "text-aqua-700", note: latestPayment ? `${date(latestPayment.paymentDate)} · ${latestPayment.channel?.channelName ?? "Payment"}` : "Nothing received yet" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                <p className={`mt-2 text-xl font-bold ${item.accent}`}>{item.value}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{item.note}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Customer information</h2>
                <p className="mt-0.5 text-xs text-slate-500">Identity and contact details</p>
              </div>
              <div className="grid gap-x-8 px-5 py-3 sm:grid-cols-2">
                <InfoRow label="Customer ID" value={customer.customerNumber} />
                <InfoRow label="Customer type" value={customer.customerType === "INDIVIDUAL" ? "Individual" : "Organization"} />
                <InfoRow label="Phone" value={privacyMode ? maskPhone(customer.phoneNumber) : customer.phoneNumber} />
                <InfoRow label="Email" value={privacyMode ? maskEmail(customer.emailAddress) : customer.emailAddress} />
                <InfoRow label="Address" value={privacyMode ? maskAddress(primaryProperty?.physicalAddress) : primaryProperty?.physicalAddress} />
                <InfoRow label="Registered" value={date(customer.registrationDate)} />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Account overview</h2>
                <p className="mt-0.5 text-xs text-slate-500">Billing configuration and account state</p>
              </div>
              {primaryAccount ? (
                <div className="grid gap-x-8 px-5 py-3 sm:grid-cols-2">
                  <InfoRow label="Account number" value={primaryAccount.accountNumber} />
                  <InfoRow label="Category" value={primaryAccount.category?.categoryName} />
                  <InfoRow label="Status" value={<StatusBadge status={primaryAccount.accountStatus} />} />
                  <InfoRow label="Billing cycle" value={bills[0]?.billingCycle?.cycleName} />
                  <InfoRow label="Last payment" value={latestPayment ? date(latestPayment.paymentDate) : undefined} />
                  <InfoRow label="Payment method" value={latestPayment?.channel?.channelName} />
                </div>
              ) : (
                <p className="px-5 py-8 text-sm text-slate-500">No account linked yet. Add a property and account from the Properties &amp; Accounts tab.</p>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === key
                ? "bg-aqua-700 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Billing History */}
      {activeTab === "billing" && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Billing history</h2>
              <p className="mt-0.5 text-xs text-slate-500">Invoices raised across all linked customer accounts</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{bills.length} invoice{bills.length === 1 ? "" : "s"}</span>
          </div>
          {historyLoading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading billing records…</div>
          ) : bills.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-semibold text-slate-700">No invoices found</p>
              <p className="mt-1 text-sm text-slate-500">Bills will appear here after a billing batch is generated for this account.</p>
              <Link to="/billing/generate" className="mt-4 inline-flex rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aqua-600">Open bill generation</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left">Invoice</th>
                    <th className="px-5 py-3 text-left">Period</th>
                    <th className="px-5 py-3 text-left">Account</th>
                    <th className="px-5 py-3 text-left">Issue / due</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-right">Outstanding</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bills.map((bill) => {
                    const outstanding = Math.max(0, Number(bill.totalAmountDue) - Number(bill.paidAmount ?? 0));
                    return (
                      <tr key={bill.billId} className="transition-colors hover:bg-slate-50/80">
                        <td className="px-5 py-4 font-semibold text-slate-900">{bill.billNumber}</td>
                        <td className="px-5 py-4 text-slate-600">{bill.billingCycle?.cycleName ?? "—"}</td>
                        <td className="px-5 py-4 text-slate-600">{bill.account?.accountNumber ?? "—"}</td>
                        <td className="px-5 py-4 text-slate-600">{date(bill.issueDate)}<div className="mt-0.5 text-xs text-slate-400">Due {date(bill.dueDate)}</div></td>
                        <td className="px-5 py-4 text-right font-semibold text-slate-800">{displayMoney(bill.totalAmountDue)}</td>
                        <td className={`px-5 py-4 text-right font-semibold ${outstanding > 0 ? "text-rose-600" : "text-emerald-600"}`}>{displayMoney(outstanding)}</td>
                        <td className="px-5 py-4"><StatusBadge status={bill.status} /></td>
                        <td className="px-5 py-4 text-right"><Link to={`/billing/invoices/${bill.billId}`} className="font-semibold text-aqua-700 hover:text-aqua-600 hover:underline">View invoice</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab: Payments */}
      {activeTab === "payments" && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Payment history</h2>
              <p className="mt-0.5 text-xs text-slate-500">Receipts, channels, allocation and transaction status</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{displayMoney(totalPaid)} received</span>
              <Link to="/payments/register" className="rounded-lg bg-aqua-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-aqua-600">Payment register</Link>
            </div>
          </div>
          {historyLoading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading payment records…</div>
          ) : payments.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-semibold text-slate-700">No payments received</p>
              <p className="mt-1 text-sm text-slate-500">Cash, bank and M-Pesa transactions for this customer will appear here.</p>
              <Link to="/payments/record" className="mt-4 inline-flex rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aqua-600">Record payment</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left">Reference</th>
                    <th className="px-5 py-3 text-left">Date</th>
                    <th className="px-5 py-3 text-left">Account</th>
                    <th className="px-5 py-3 text-left">Channel</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-left">Allocation</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((payment) => (
                    <tr key={payment.paymentId} className="transition-colors hover:bg-slate-50/80">
                      <td className="px-5 py-4 font-semibold text-slate-900">{payment.transactionReference}</td>
                      <td className="px-5 py-4 text-slate-600">{date(payment.paymentDate)}</td>
                      <td className="px-5 py-4 text-slate-600">{payment.account?.accountNumber ?? "—"}</td>
                      <td className="px-5 py-4 text-slate-600">{payment.channel?.channelName ?? "—"}</td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-800">{displayMoney(payment.amount)}</td>
                      <td className="px-5 py-4"><StatusBadge status={payment.matchingStatus} /></td>
                      <td className="px-5 py-4"><StatusBadge status={payment.paymentStatus} /></td>
                      <td className="px-5 py-4 text-right">
                        {payment.receipt ? (
                          <Link to={`/payments/receipts/${payment.receipt.receiptId}`} className="font-semibold text-aqua-700 hover:text-aqua-600 hover:underline">
                            {payment.receipt.receiptNumber ?? "View receipt"}
                          </Link>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab: Meters */}
      {activeTab === "meters" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Assigned meters</h2>
            <Link to="/meters/assign" className="text-xs font-semibold text-aqua-700 hover:underline">Assign meter</Link>
          </div>
          {meters.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No active meters are assigned to this customer.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 text-left">Meter</th><th className="px-4 py-3 text-left">Account</th><th className="px-4 py-3 text-left">Type</th><th className="px-4 py-3 text-left">Size</th><th className="px-4 py-3 text-left">Installed</th><th className="px-4 py-3 text-left">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{meters.map((meter) => <tr key={meter.meterId}><td className="px-4 py-3 font-medium"><Link className="text-aqua-700 hover:underline" to={`/meters/${encodeId(meter.meterId)}`}>{meter.meterNumber}</Link></td><td className="px-4 py-3 text-slate-600">{meter.assignment?.account?.accountNumber ?? "—"}</td><td className="px-4 py-3 text-slate-600">{meter.meterType}</td><td className="px-4 py-3 text-slate-600">{Number(meter.meterSizeMm)} mm</td><td className="px-4 py-3 text-slate-600">{meter.installationDate ? new Date(meter.installationDate).toLocaleDateString() : "—"}</td><td className="px-4 py-3"><StatusBadge status={meter.status} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Properties & Accounts */}
      {activeTab === "properties" && (
        <div className="space-y-3">
          {/* Properties section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700">Properties</h2>
              <button onClick={() => setShowPropertyForm((v) => !v)} className="text-sm text-aqua-700 hover:text-aqua-600 font-medium">
                {showPropertyForm ? "Cancel" : "+ Add Property"}
              </button>
            </div>

            {showPropertyForm && (
              <form onSubmit={submitProperty} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-3 space-y-3 text-sm">
                <Field label="Zone *">
                  <SearchableSelect required className={FIELD_CLS} value={propertyForm.zoneId}
                    onChange={(e) => setPropertyForm((f) => ({ ...f, zoneId: e.target.value, serviceAreaId: "", routeId: "" }))}>
                    <option value="">Select zone</option>
                    {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>{z.zoneName}</option>)}
                  </SearchableSelect>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Service Area">
                    <SearchableSelect className={FIELD_CLS} value={propertyForm.serviceAreaId} onChange={(e) => setPropertyForm((f) => ({ ...f, serviceAreaId: e.target.value }))}>
                      <option value="">None</option>
                      {serviceAreas.map((s) => <option key={s.serviceAreaId} value={s.serviceAreaId}>{s.areaName}</option>)}
                    </SearchableSelect>
                  </Field>
                  <Field label="Route">
                    <SearchableSelect className={FIELD_CLS} value={propertyForm.routeId} onChange={(e) => setPropertyForm((f) => ({ ...f, routeId: e.target.value }))}>
                      <option value="">None</option>
                      {routes.map((r) => <option key={r.routeId} value={r.routeId}>{r.routeName}</option>)}
                    </SearchableSelect>
                  </Field>
                </div>
                <Field label="Physical Address *">
                  <input required className={FIELD_CLS} value={propertyForm.physicalAddress} onChange={(e) => setPropertyForm((f) => ({ ...f, physicalAddress: e.target.value }))} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Plot Number">
                    <input className={FIELD_CLS} value={propertyForm.plotNumber} onChange={(e) => setPropertyForm((f) => ({ ...f, plotNumber: e.target.value }))} />
                  </Field>
                  <Field label="Building Name">
                    <input className={FIELD_CLS} value={propertyForm.buildingName} onChange={(e) => setPropertyForm((f) => ({ ...f, buildingName: e.target.value }))} />
                  </Field>
                </div>
                <button className="px-4 py-2 text-sm font-medium bg-aqua-700 hover:bg-aqua-600 text-white rounded-lg shadow-sm transition-colors">
                  Create Property
                </button>
              </form>
            )}

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              {properties.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Property Code</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Address</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Zone</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status / Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {properties.map((p) => (
                      <tr key={p.propertyId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-medium text-aqua-700">{p.propertyCode}</td>
                        <td className="px-4 py-2 text-slate-600">{p.physicalAddress}</td>
                        <td className="px-4 py-2 text-slate-500">{p.zone?.zoneName ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${p.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                            {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-4 text-sm text-slate-400 text-center">No properties yet. Add one to open accounts.</p>
              )}
            </div>
          </div>

          {/* Accounts section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700">Accounts</h2>
              {properties.length > 0 && (
                <button onClick={() => setShowAccountForm((v) => !v)} className="text-sm text-aqua-700 hover:text-aqua-600 font-medium">
                  {showAccountForm ? "Cancel" : "+ Add Account"}
                </button>
              )}
            </div>

            {showAccountForm && (
              <form onSubmit={submitAccount} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-3 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Property *">
                    <SearchableSelect required className={FIELD_CLS} value={accountForm.propertyId} onChange={(e) => setAccountForm((f) => ({ ...f, propertyId: e.target.value }))}>
                      <option value="">Select property</option>
                      {properties.map((p) => <option key={p.propertyId} value={p.propertyId}>{p.propertyCode} — {p.physicalAddress}</option>)}
                    </SearchableSelect>
                  </Field>
                  <Field label="Customer Category *">
                    <SearchableSelect required className={FIELD_CLS} value={accountForm.categoryId} onChange={(e) => setAccountForm((f) => ({ ...f, categoryId: e.target.value }))}>
                      <option value="">Select category</option>
                      {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
                    </SearchableSelect>
                  </Field>
                </div>
                <button className="px-4 py-2 text-sm font-medium bg-aqua-700 hover:bg-aqua-600 text-white rounded-lg shadow-sm transition-colors">
                  Create Account
                </button>
              </form>
            )}

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              {customer.accounts?.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Account No.</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Property</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customer.accounts.map((a) => (
                      <tr key={a.accountId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-medium text-aqua-700">{a.accountNumber}</td>
                        <td className="px-4 py-2 text-slate-600">{a.property?.physicalAddress ?? "—"}</td>
                        <td className="px-4 py-2 text-slate-500">{a.category?.categoryName ?? "—"}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-700">
                          {Number(a.currentBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            a.accountStatus === "ACTIVE" || a.accountStatus === "OPEN" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                          }`}>
                            {(a.accountStatus ?? "").charAt(0) + (a.accountStatus ?? "").slice(1).toLowerCase()}
                          </span>
                          {a.accountStatus === "PENDING" && (
                            <button
                              type="button"
                              disabled={activatingAccountId === String(a.accountId)}
                              onClick={() => void activateAccount(String(a.accountId))}
                              className="rounded-lg bg-aqua-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-aqua-600 disabled:opacity-50"
                            >
                              {activatingAccountId === String(a.accountId) ? "Activating..." : "Activate"}
                            </button>
                          )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-4 text-sm text-slate-400 text-center">No accounts yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Service Requests */}
      {activeTab === "service_requests" && (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="font-semibold text-slate-900">Customer service history</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
            Review this customer&apos;s requests and complaints, or register a new issue against one of their accounts.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to={`/service-requests?customerId=${customer?.customerId ?? rawId}`}
              className="rounded-lg border border-aqua-600 px-4 py-2 text-sm font-semibold text-aqua-700 hover:bg-aqua-50"
            >
              View service history
            </Link>
            <Link
              to="/service-requests/new"
              className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aqua-600"
            >
              Register request
            </Link>
          </div>
        </section>
      )}

      {/* Tab: Notes */}
      {activeTab === "notes" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center text-sm text-slate-400">
          Customer notes will be available in a future update.
        </div>
      )}
    </div>
  );
}
