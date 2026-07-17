import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { decodeId, encodeId } from "../lib/hashids";

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

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  ACTIVE:       "bg-green-100 text-green-700",
  INACTIVE:     "bg-slate-100 text-slate-500",
  SUSPENDED:    "bg-orange-100 text-orange-700",
  CLOSED:       "bg-red-100 text-red-600",
  OPEN:         "bg-green-100 text-green-700",
  DISCONNECTED: "bg-red-100 text-red-600",
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
  const { id: encodedId } = useParams<{ id: string }>();
  const rawId = encodedId ? String(decodeId(encodedId)) : "";
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [zones, setZones]         = useState<Lookup[]>([]);
  const [serviceAreas, setServiceAreas] = useState<Lookup[]>([]);
  const [routes, setRoutes]       = useState<Lookup[]>([]);
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [meters, setMeters]         = useState<CustomerMeter[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("billing");

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [propertyForm, setPropertyForm] = useState({
    zoneId: "", serviceAreaId: "", routeId: "",
    plotNumber: "", buildingName: "", physicalAddress: "",
  });

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ propertyId: "", categoryId: "" });

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
      setCustomer(updated);
      setEditing(false);
    } catch (err: any) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
      } else {
        setError(err.message);
      }
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

  return (
    <div className="p-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-slate-400 mb-1">
        <Link to="/customers" className="hover:text-aqua-700 transition-colors">Customers</Link>
        <span>›</span>
        <span className="text-slate-600 font-medium">Customer Details</span>
      </div>

      {/* Page title + action buttons */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold text-slate-800">Customer Profile</h1>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setEditing(true); setFieldErrors({}); setError(null); }}
              className="px-4 py-1.5 text-sm font-medium bg-aqua-700 hover:bg-aqua-600 text-white rounded-lg shadow-sm transition-colors"
            >
              Edit
            </button>
            <button className="px-4 py-1.5 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1 text-slate-600">
              More
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        )}
      </div>

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
              <select className={FIELD_CLS} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                {["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"].map((s) => <option key={s}>{s}</option>)}
              </select>
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
              <select className={FIELD_CLS} value={editForm.preferredLanguage} onChange={(e) => setEditForm((f) => ({ ...f, preferredLanguage: e.target.value }))}>
                <option value="EN">English</option>
                <option value="SW">Swahili</option>
              </select>
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
          {error && (
            <p className="text-sm text-red-600 mt-1">{error}</p>
          )}
        </form>
      )}

      {/* ── Two-card row (view mode) ── */}
      {!editing && (
        <div className="grid grid-cols-2 gap-4 mb-3">
          {/* Left card: Customer Information */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Customer Information</h2>
            <InfoRow label="Customer ID"    value={customer.customerNumber} />
            <InfoRow label="Account No."    value={primaryAccount?.accountNumber} />
            <InfoRow label="Name"           value={displayName} />
            <InfoRow label="Address"        value={primaryProperty?.physicalAddress} />
            <InfoRow label="Contact No."    value={customer.phoneNumber} />
            <InfoRow label="Email"          value={customer.emailAddress} />
            <InfoRow label="Customer Type"  value={customer.customerType === "INDIVIDUAL" ? "Individual" : "Organization"} />
            <InfoRow label="Status"         value={<StatusBadge status={customer.status} />} />
            <InfoRow label="Date Registered" value={
              customer.registrationDate
                ? new Date(customer.registrationDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                : undefined
            } />
          </div>

          {/* Right card: Account Summary */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Account Summary</h2>
            {primaryAccount ? (
              <>
                <InfoRow
                  label="Current Balance"
                  value={`${Number(primaryAccount.currentBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                  valueClass="text-red-500 font-bold"
                />
                <InfoRow
                  label="Total Due"
                  value={`${Number(primaryAccount.currentBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                  valueClass="text-red-500 font-bold"
                />
                <InfoRow label="Last Payment"    value={undefined} />
                <InfoRow label="Payment Method"  value={undefined} />
                <InfoRow label="Billing Cycle"   value={undefined} />
                <InfoRow label="Category"        value={primaryAccount.category?.categoryName} />
                <InfoRow label="Account Status"  value={<StatusBadge status={primaryAccount.accountStatus} />} />
                <InfoRow label="Connection No."  value={primaryAccount.accountNumber} />
              </>
            ) : (
              <p className="text-sm text-slate-400 py-3">No account linked yet. Add a property and account from the Properties &amp; Accounts tab.</p>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-3 flex">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === key
                ? "border-aqua-700 text-aqua-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Billing History */}
      {activeTab === "billing" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center text-sm text-slate-400">
          Billing history will be available in a future update.
        </div>
      )}

      {/* Tab: Payments */}
      {activeTab === "payments" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center text-sm text-slate-400">
          Payment records will be available in a future update.
        </div>
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
                  <select required className={FIELD_CLS} value={propertyForm.zoneId}
                    onChange={(e) => setPropertyForm((f) => ({ ...f, zoneId: e.target.value, serviceAreaId: "", routeId: "" }))}>
                    <option value="">Select zone</option>
                    {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>{z.zoneName}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Service Area">
                    <select className={FIELD_CLS} value={propertyForm.serviceAreaId} onChange={(e) => setPropertyForm((f) => ({ ...f, serviceAreaId: e.target.value }))}>
                      <option value="">None</option>
                      {serviceAreas.map((s) => <option key={s.serviceAreaId} value={s.serviceAreaId}>{s.areaName}</option>)}
                    </select>
                  </Field>
                  <Field label="Route">
                    <select className={FIELD_CLS} value={propertyForm.routeId} onChange={(e) => setPropertyForm((f) => ({ ...f, routeId: e.target.value }))}>
                      <option value="">None</option>
                      {routes.map((r) => <option key={r.routeId} value={r.routeId}>{r.routeName}</option>)}
                    </select>
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
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
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
                    <select required className={FIELD_CLS} value={accountForm.propertyId} onChange={(e) => setAccountForm((f) => ({ ...f, propertyId: e.target.value }))}>
                      <option value="">Select property</option>
                      {properties.map((p) => <option key={p.propertyId} value={p.propertyId}>{p.propertyCode} — {p.physicalAddress}</option>)}
                    </select>
                  </Field>
                  <Field label="Customer Category *">
                    <select required className={FIELD_CLS} value={accountForm.categoryId} onChange={(e) => setAccountForm((f) => ({ ...f, categoryId: e.target.value }))}>
                      <option value="">Select category</option>
                      {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
                    </select>
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
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            a.accountStatus === "ACTIVE" || a.accountStatus === "OPEN" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                          }`}>
                            {(a.accountStatus ?? "").charAt(0) + (a.accountStatus ?? "").slice(1).toLowerCase()}
                          </span>
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
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center text-sm text-slate-400">
          Service requests will be available in a future update.
        </div>
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
