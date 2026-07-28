import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { encodeId } from "../lib/hashids";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";

type CustomerType = "INDIVIDUAL" | "ORGANIZATION";
type IdType = "NATIONAL_ID" | "PASSPORT" | "OTHER";
interface Lookup { [key: string]: any; }

const FIELD_CLS = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-700 outline-none transition focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 placeholder:text-slate-400";
const LABEL_CLS = "mb-1.5 block text-[13px] font-semibold text-slate-600";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLS}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Stepper ────────────────────────────────────────────────────────────────────
const STEPS = [
  { n: 1, label: "Customer Info" },
  { n: 2, label: "Property & Account" },
  { n: 3, label: "Documents" },
  { n: 4, label: "Review & Save" },
];

function Stepper({ current }: { current: number }) {
  return (
    <div className="mb-5 flex items-center rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm select-none">
      {STEPS.map((step, idx) => (
        <div key={step.n} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
              step.n < current
                ? "bg-aqua-700 border-aqua-700 text-white"
                : step.n === current
                ? "bg-aqua-700 border-aqua-700 text-white"
                : "bg-white border-slate-300 text-slate-400"
            }`}>
              {step.n < current ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                step.n
              )}
            </div>
            <span className={`text-xs mt-1.5 font-medium whitespace-nowrap ${
              step.n <= current ? "text-aqua-700" : "text-slate-400"
            }`}>
              {step.label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-5 transition-colors ${step.n < current ? "bg-aqua-700" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Review row helper ──────────────────────────────────────────────────────────
function ReviewRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex py-2 border-b border-slate-100 last:border-0 text-sm">
      <span className="w-44 flex-shrink-0 text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium">{value}</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function NewCustomer() {
  const [step, setStep] = useState(1);
  const [customerType, setCustomerType] = useState<CustomerType>("INDIVIDUAL");
  const [idType, setIdType] = useState<IdType>("NATIONAL_ID");
  const [form, setForm] = useState({
    // Step 1
    firstName:        "",
    middleName:       "",
    lastName:         "",
    organizationName: "",
    nationalId:       "",
    registrationNumber: "",
    phoneNumber:      "",
    alternativePhone: "",
    emailAddress:     "",
    preferredLanguage: "EN",
    registrationDate: new Date().toISOString().split("T")[0],
    // Step 2
    zoneId:        "",
    serviceAreaId: "",
    routeId:       "",
    physicalAddress: "",
    plotNumber:    "",
    buildingName:  "",
  });
  const [stepError, setStepError] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);

  const [zones, setZones]             = useState<Lookup[]>([]);
  const [serviceAreas, setServiceAreas] = useState<Lookup[]>([]);
  const [routes, setRoutes]           = useState<Lookup[]>([]);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const connectionId = searchParams.get("connectionId");
  const returnTo = searchParams.get("returnTo");

  const upd = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  // Load zones when entering step 2
  useEffect(() => {
    if (step === 2 && zones.length === 0) {
      api.listZones().then(setZones).catch(() => {});
    }
  }, [step]);

  // Load service areas + routes when zone changes
  useEffect(() => {
    if (!form.zoneId) { setServiceAreas([]); setRoutes([]); return; }
    api.listServiceAreas(form.zoneId).then(setServiceAreas).catch(() => {});
    api.listRoutes(form.zoneId).then(setRoutes).catch(() => {});
  }, [form.zoneId]);

  // ── Per-step validation ──────────────────────────────────────────────────────
  function validateStep(n: number): string | null {
    if (n === 1) {
      if (!form.phoneNumber.trim()) return "Phone number is required.";
      if (customerType === "INDIVIDUAL") {
        if (!form.firstName.trim()) return "First name is required.";
        if (!form.lastName.trim())  return "Last name is required.";
      } else {
        if (!form.organizationName.trim()) return "Organization name is required.";
      }
    }
    if (n === 2) {
      if (form.physicalAddress.trim() && !form.zoneId) return "Please select a zone for the property.";
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) { setStepError(err); return; }
    setStepError(null);
    setStep((s) => s + 1);
  }

  function goBack() { setStepError(null); setStep((s) => s - 1); }

  // ── Final save ───────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = validateStep(1);
    if (err) { setStepError(err); setStep(1); return; }
    setStepError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        customerType,
        phoneNumber:      form.phoneNumber,
        alternativePhone: form.alternativePhone  || undefined,
        emailAddress:     form.emailAddress      || undefined,
        preferredLanguage: form.preferredLanguage,
        nationalId:       customerType === "INDIVIDUAL" && form.nationalId ? form.nationalId : undefined,
        registrationNumber: customerType === "ORGANIZATION" && form.registrationNumber ? form.registrationNumber : undefined,
      };
      if (customerType === "INDIVIDUAL") {
        payload.firstName  = form.firstName;
        payload.middleName = form.middleName || undefined;
        payload.lastName   = form.lastName;
      } else {
        payload.organizationName   = form.organizationName;
        payload.registrationNumber = form.registrationNumber || undefined;
      }

      const customer = await api.createCustomer(payload);

      // If property address provided on step 2, create it now
      if (form.physicalAddress.trim() && form.zoneId) {
        await api.createProperty({
          ownerCustomerId: String(customer.customerId),
          zoneId:          form.zoneId,
          serviceAreaId:   form.serviceAreaId || undefined,
          routeId:         form.routeId       || undefined,
          physicalAddress: form.physicalAddress,
          plotNumber:      form.plotNumber    || undefined,
          buildingName:    form.buildingName  || undefined,
        });
      }

      if (connectionId) {
        await api.linkConnectionCustomer(connectionId, String(customer.customerId));
        navigate(returnTo || `/connections/${connectionId}`);
      } else {
        navigate(`/customers/${encodeId(customer.customerId)}`);
      }
    } catch (err: any) {
      setStepError(err.message ?? "Failed to save customer");
    } finally {
      setSaving(false);
    }
  }

  // ── Derived display values for review ────────────────────────────────────────
  const displayName = customerType === "INDIVIDUAL"
    ? [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ")
    : form.organizationName;

  const idLabel = idType === "NATIONAL_ID" ? "National ID" : idType === "PASSPORT" ? "Passport" : "ID";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-5 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-aqua-700">
            Customer operations
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            {connectionId ? "Create customer for connection" : "Register New Customer"}
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            {connectionId
              ? "This is the existing customer wizard. Saving links the new customer to the approved connection."
              : "Create the customer identity, property and account-ready record."}
          </p>
        </div>
        <Link
          to="/customers"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Manage customers
        </Link>
      </div>

      {/* ── Stepper ── */}
      <Stepper current={step} />

      {/* ── Step card ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">

        {/* ════ STEP 1: Customer Info ════ */}
        {step === 1 && (
          <>
            <div className="mb-5 border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Personal Information</h2>
              <p className="mt-1 text-sm text-slate-500">
                Capture the customer identity and preferred contact details.
              </p>
            </div>

            {/* Customer Type */}
            <div className="mb-4">
              <Field label="Customer Type" required>
                <SearchableSelect
                  className={FIELD_CLS}
                  value={customerType}
                  onChange={(e) => setCustomerType(e.target.value as CustomerType)}
                >
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="ORGANIZATION">Organization</option>
                </SearchableSelect>
              </Field>
            </div>

            {customerType === "INDIVIDUAL" ? (
              <>
                {/* Name row */}
                <div className="mb-4 grid gap-3 md:grid-cols-3">
                  <Field label="First Name" required>
                    <input className={FIELD_CLS} value={form.firstName} onChange={(e) => upd("firstName", e.target.value)} placeholder="Mary" />
                  </Field>
                  <Field label="Middle Name">
                    <input className={FIELD_CLS} value={form.middleName} onChange={(e) => upd("middleName", e.target.value)} placeholder="Wanjiku" />
                  </Field>
                  <Field label="Last Name" required>
                    <input className={FIELD_CLS} value={form.lastName} onChange={(e) => upd("lastName", e.target.value)} placeholder="Kamau" />
                  </Field>
                </div>

                {/* ID + Phone row */}
                <div className="mb-4 grid gap-3 md:grid-cols-3">
                  <Field label="ID Type" required>
                    <SearchableSelect className={FIELD_CLS} value={idType} onChange={(e) => setIdType(e.target.value as IdType)}>
                      <option value="NATIONAL_ID">National ID</option>
                      <option value="PASSPORT">Passport</option>
                      <option value="OTHER">Other</option>
                    </SearchableSelect>
                  </Field>
                  <Field label="ID Number">
                    <input className={FIELD_CLS} value={form.nationalId} onChange={(e) => upd("nationalId", e.target.value)} placeholder="0712 345 678" />
                  </Field>
                  <Field label="Phone Number" required>
                    <input className={FIELD_CLS} value={form.phoneNumber} onChange={(e) => upd("phoneNumber", e.target.value)} placeholder="+254 7XX XXX XXX" />
                  </Field>
                </div>

                {/* Extra contact */}
                <div className="mb-4 grid gap-3 md:grid-cols-2">
                  <Field label="Alternative Phone">
                    <input className={FIELD_CLS} value={form.alternativePhone} onChange={(e) => upd("alternativePhone", e.target.value)} placeholder="Optional" />
                  </Field>
                  <Field label="Email Address">
                    <input type="email" className={FIELD_CLS} value={form.emailAddress} onChange={(e) => upd("emailAddress", e.target.value)} placeholder="mary.kamau@email.com" />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Preferred Language">
                    <SearchableSelect className={FIELD_CLS} value={form.preferredLanguage} onChange={(e) => upd("preferredLanguage", e.target.value)}>
                      <option value="EN">English</option>
                      <option value="SW">Swahili</option>
                    </SearchableSelect>
                  </Field>
                  <Field label="Registration Date" required>
                    <input type="date" className={FIELD_CLS} value={form.registrationDate} onChange={(e) => upd("registrationDate", e.target.value)} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4">
                  <Field label="Organization Name" required>
                    <input className={FIELD_CLS} value={form.organizationName} onChange={(e) => upd("organizationName", e.target.value)} placeholder="Acme Ltd." />
                  </Field>
                </div>
                <div className="mb-4 grid gap-3 md:grid-cols-2">
                  <Field label="Registration Number">
                    <input className={FIELD_CLS} value={form.registrationNumber} onChange={(e) => upd("registrationNumber", e.target.value)} placeholder="CPR/2024/001234" />
                  </Field>
                  <Field label="Phone Number" required>
                    <input className={FIELD_CLS} value={form.phoneNumber} onChange={(e) => upd("phoneNumber", e.target.value)} placeholder="+254 7XX XXX XXX" />
                  </Field>
                </div>
                <div className="mb-4 grid gap-3 md:grid-cols-2">
                  <Field label="Alternative Phone">
                    <input className={FIELD_CLS} value={form.alternativePhone} onChange={(e) => upd("alternativePhone", e.target.value)} placeholder="Optional" />
                  </Field>
                  <Field label="Email Address">
                    <input type="email" className={FIELD_CLS} value={form.emailAddress} onChange={(e) => upd("emailAddress", e.target.value)} placeholder="info@company.com" />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Preferred Language">
                    <SearchableSelect className={FIELD_CLS} value={form.preferredLanguage} onChange={(e) => upd("preferredLanguage", e.target.value)}>
                      <option value="EN">English</option>
                      <option value="SW">Swahili</option>
                    </SearchableSelect>
                  </Field>
                  <Field label="Registration Date" required>
                    <input type="date" className={FIELD_CLS} value={form.registrationDate} onChange={(e) => upd("registrationDate", e.target.value)} />
                  </Field>
                </div>
              </>
            )}
          </>
        )}

        {/* ════ STEP 2: Property & Account ════ */}
        {step === 2 && (
          <>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Property & Account</h2>
            <p className="text-xs text-slate-400 mb-4">Optional — you can also add properties from the customer profile after saving.</p>

            <div className="mb-3">
              <Field label="Zone">
                <SearchableSelect
                  className={FIELD_CLS}
                  value={form.zoneId}
                  onChange={(e) => { upd("zoneId", e.target.value); upd("serviceAreaId", ""); upd("routeId", ""); }}
                >
                  <option value="">Select zone (optional)</option>
                  {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>{z.zoneName}</option>)}
                </SearchableSelect>
              </Field>
            </div>

            <div className="mb-3 grid gap-3 md:grid-cols-2">
              <Field label="Service Area">
                <SearchableSelect className={FIELD_CLS} value={form.serviceAreaId} onChange={(e) => upd("serviceAreaId", e.target.value)} disabled={!form.zoneId}>
                  <option value="">None</option>
                  {serviceAreas.map((s) => <option key={s.serviceAreaId} value={s.serviceAreaId}>{s.areaName}</option>)}
                </SearchableSelect>
              </Field>
              <Field label="Route">
                <SearchableSelect className={FIELD_CLS} value={form.routeId} onChange={(e) => upd("routeId", e.target.value)} disabled={!form.zoneId}>
                  <option value="">None</option>
                  {routes.map((r) => <option key={r.routeId} value={r.routeId}>{r.routeName}</option>)}
                </SearchableSelect>
              </Field>
            </div>

            <div className="mb-3">
              <Field label="Physical Address">
                <input className={FIELD_CLS} value={form.physicalAddress} onChange={(e) => upd("physicalAddress", e.target.value)} placeholder="e.g. Plot 5, Mwangi Road, Westlands" />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Plot Number">
                <input className={FIELD_CLS} value={form.plotNumber} onChange={(e) => upd("plotNumber", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Building Name">
                <input className={FIELD_CLS} value={form.buildingName} onChange={(e) => upd("buildingName", e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </>
        )}

        {/* ════ STEP 3: Documents ════ */}
        {step === 3 && (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Documents</h2>
            <p className="text-sm text-slate-400 max-w-sm mx-auto">
              Document upload (ID copies, application forms) will be available in a future update.
              You can continue and upload documents from the customer profile later.
            </p>
          </div>
        )}

        {/* ════ STEP 4: Review & Save ════ */}
        {step === 4 && (
          <>
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Review & Save</h2>
            <p className="text-xs text-slate-400 mb-4">Please review the information below before saving.</p>

            <div className="mb-5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Customer Information</h3>
              <div className="bg-slate-50 rounded-lg px-4 py-1">
                <ReviewRow label="Customer Type"      value={customerType === "INDIVIDUAL" ? "Individual" : "Organization"} />
                {customerType === "INDIVIDUAL" ? (
                  <>
                    <ReviewRow label="Full Name"      value={displayName} />
                    <ReviewRow label={idLabel}        value={form.nationalId} />
                  </>
                ) : (
                  <>
                    <ReviewRow label="Organization"   value={form.organizationName} />
                    <ReviewRow label="Reg. Number"    value={form.registrationNumber} />
                  </>
                )}
                <ReviewRow label="Phone"              value={form.phoneNumber} />
                <ReviewRow label="Alternative Phone"  value={form.alternativePhone} />
                <ReviewRow label="Email"              value={form.emailAddress} />
                <ReviewRow label="Preferred Language" value={form.preferredLanguage === "EN" ? "English" : "Swahili"} />
                <ReviewRow label="Registration Date"  value={form.registrationDate ? new Date(form.registrationDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : undefined} />
              </div>
            </div>

            {form.physicalAddress && (
              <div className="mb-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Property</h3>
                <div className="bg-slate-50 rounded-lg px-4 py-1">
                  <ReviewRow label="Physical Address" value={form.physicalAddress} />
                  <ReviewRow label="Plot Number"      value={form.plotNumber} />
                  <ReviewRow label="Building Name"    value={form.buildingName} />
                </div>
              </div>
            )}
          </>
        )}

        <SweetAlertToast message={stepError} type="error" />
      </div>

      {/* ── Navigation buttons ── */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          {step === 1 ? (
            <Link to="/customers" className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </Link>
          ) : (
            <button
              type="button"
              onClick={goBack}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              ← Back
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step < 4 ? (
            <>
              {(step === 2 || step === 3) && (
                <button
                  type="button"
                  onClick={() => { setStepError(null); setStep((s) => s + 1); }}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Skip
                </button>
              )}
              <button
                type="button"
                onClick={goNext}
                className="px-5 py-2 text-sm font-medium bg-aqua-700 hover:bg-aqua-600 text-white rounded-lg shadow-sm transition-colors"
              >
                Next →
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 text-sm font-medium bg-aqua-700 hover:bg-aqua-600 text-white rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save Customer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
