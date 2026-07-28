import { FormEvent, ReactNode, useEffect, useState } from "react";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { api, getSessionUser } from "../lib/api";

type Settings = {
  utilityName: string;
  utilityCode: string;
  emailAddress: string;
  phoneNumber: string;
  secondaryPhoneNumber: string;
  postalAddress: string;
  postalCode: string;
  physicalAddress: string;
  currencyCode: string;
  timezone: string;
  locale: string;
  dateFormat: string;
  billingDueDays: number;
  defaultBillingRate: number | null;
  subprojectDiscountRate: number | null;
  reconnectionFee: number | null;
  defaultConnectionFee: number | null;
  readingVariancePercent: number;
  minimumReadingValue: number;
  billingMessageLine1: string;
  billingMessageLine2: string;
  billingMessageLine3: string;
  demandMessageLine1: string;
  demandMessageLine2: string;
  demandMessageLine3: string;
  demandMessageLine4: string;
  demandMessageLine5: string;
  receiptMessage: string;
  sessionTimeoutMinutes: number;
  passwordMinimumLength: number;
  requireTwoFactor: boolean;
  maintenanceMode: boolean;
  updatedAt?: string;
};

const initialSettings: Settings = {
  utilityName: "AquaFlow",
  utilityCode: "AQUAFLOW",
  emailAddress: "",
  phoneNumber: "",
  secondaryPhoneNumber: "",
  postalAddress: "",
  postalCode: "",
  physicalAddress: "",
  currencyCode: "KES",
  timezone: "Africa/Nairobi",
  locale: "en-KE",
  dateFormat: "DD/MM/YYYY",
  billingDueDays: 14,
  defaultBillingRate: null,
  subprojectDiscountRate: null,
  reconnectionFee: null,
  defaultConnectionFee: null,
  readingVariancePercent: 30,
  minimumReadingValue: 0,
  billingMessageLine1: "",
  billingMessageLine2: "",
  billingMessageLine3: "",
  demandMessageLine1: "",
  demandMessageLine2: "",
  demandMessageLine3: "",
  demandMessageLine4: "",
  demandMessageLine5: "",
  receiptMessage: "",
  sessionTimeoutMinutes: 30,
  passwordMinimumLength: 8,
  requireTwoFactor: false,
  maintenanceMode: false,
};

const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 disabled:bg-slate-50";

function Card({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  tone = "aqua",
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tone?: "aqua" | "red";
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={`mt-1 h-5 w-5 shrink-0 rounded border-slate-300 ${tone === "red" ? "text-red-600 focus:ring-red-500" : "text-aqua-700 focus:ring-aqua-500"}`}
      />
    </label>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

export default function SettingsManagement() {
  const isAdmin = Boolean(getSessionUser()?.roles.includes("SYSTEM_ADMIN"));
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(isAdmin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    api
      .getSystemSettings()
      .then((data: any) =>
        setSettings({
          ...initialSettings,
          ...data,
          readingVariancePercent: Number(data.readingVariancePercent),
          minimumReadingValue: Number(data.minimumReadingValue),
          defaultBillingRate: data.defaultBillingRate == null ? null : Number(data.defaultBillingRate),
          subprojectDiscountRate: data.subprojectDiscountRate == null ? null : Number(data.subprojectDiscountRate),
          reconnectionFee: data.reconnectionFee == null ? null : Number(data.reconnectionFee),
          defaultConnectionFee: data.defaultConnectionFee == null ? null : Number(data.defaultConnectionFee),
        }),
      )
      .catch((requestError: unknown) => setError(errorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const updated = await api.updateSystemSettings(settings);
      setSettings((current) => ({ ...current, ...(updated as Settings) }));
      setSuccess("System settings saved successfully.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />
      <div className="page-screen-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System settings</h1>
          <p className="mt-1 text-sm text-slate-500">Configure utility-wide operational and security defaults</p>
        </div>
      </div>

      {!isAdmin ? (
        <Card title="Access restricted" description="Settings affect every user and operational module.">
          <p className="text-sm text-slate-600">Only a System Administrator can view or change system settings.</p>
        </Card>
      ) : loading ? (
        <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="text-center text-sm text-slate-500">
            <span className="mx-auto mb-3 block h-8 w-8 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
            Loading system settings…
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Utility profile" description="Identity and contact details shown across AquaFlow records.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Utility name">
                  <input className={input} value={settings.utilityName} onChange={(event) => set("utilityName", event.target.value)} required />
                </Field>
                <Field label="Utility code">
                  <input className={input} value={settings.utilityCode} onChange={(event) => set("utilityCode", event.target.value.toUpperCase())} required />
                </Field>
                <Field label="Email address">
                  <input type="email" className={input} value={settings.emailAddress} onChange={(event) => set("emailAddress", event.target.value)} />
                </Field>
                <Field label="Phone number">
                  <input className={input} value={settings.phoneNumber} onChange={(event) => set("phoneNumber", event.target.value)} />
                </Field>
                <Field label="Secondary phone number">
                  <input className={input} value={settings.secondaryPhoneNumber} onChange={(event) => set("secondaryPhoneNumber", event.target.value)} />
                </Field>
                <Field label="Postal address">
                  <input className={input} value={settings.postalAddress} onChange={(event) => set("postalAddress", event.target.value)} />
                </Field>
                <Field label="Postal code">
                  <input className={input} value={settings.postalCode} onChange={(event) => set("postalCode", event.target.value)} />
                </Field>
                <Field label="Physical address">
                  <input className={input} value={settings.physicalAddress} onChange={(event) => set("physicalAddress", event.target.value)} />
                </Field>
              </div>
            </Card>

            <Card title="Regional defaults" description="Formatting used for money, dates and local system time.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Currency">
                  <SearchableSelect className={input} value={settings.currencyCode} onChange={(event) => set("currencyCode", event.target.value)}>
                    <option value="KES">KES — Kenyan Shilling</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="GBP">GBP — Pound Sterling</option>
                    <option value="TZS">TZS — Tanzanian Shilling</option>
                    <option value="UGX">UGX — Ugandan Shilling</option>
                  </SearchableSelect>
                </Field>
                <Field label="Time zone">
                  <SearchableSelect className={input} value={settings.timezone} onChange={(event) => set("timezone", event.target.value)}>
                    <option value="Africa/Nairobi">Africa/Nairobi</option>
                    <option value="Africa/Kampala">Africa/Kampala</option>
                    <option value="Africa/Dar_es_Salaam">Africa/Dar es Salaam</option>
                    <option value="UTC">UTC</option>
                  </SearchableSelect>
                </Field>
                <Field label="Locale">
                  <SearchableSelect className={input} value={settings.locale} onChange={(event) => set("locale", event.target.value)}>
                    <option value="en-KE">English (Kenya)</option>
                    <option value="sw-KE">Kiswahili (Kenya)</option>
                    <option value="en-UG">English (Uganda)</option>
                    <option value="en-TZ">English (Tanzania)</option>
                  </SearchableSelect>
                </Field>
                <Field label="Date format">
                  <SearchableSelect className={input} value={settings.dateFormat} onChange={(event) => set("dateFormat", event.target.value)}>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </SearchableSelect>
                </Field>
              </div>
            </Card>

            <Card title="Operational defaults" description="Baseline rules for billing and meter-reading validation.">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="Bill due in (days)" hint="Default deadline after a bill is issued.">
                  <input type="number" min={0} max={365} className={input} value={settings.billingDueDays} onChange={(event) => set("billingDueDays", Number(event.target.value))} required />
                </Field>
                <Field label="Legacy billing rate (KSh)" hint="Reference from MajiWare only; active tariffs determine customer bills.">
                  <input type="number" min={0} step="0.01" className={input} value={settings.defaultBillingRate ?? ""} onChange={(event) => set("defaultBillingRate", event.target.value === "" ? null : Number(event.target.value))} />
                </Field>
                <Field label="Subproject discount (%)" hint="Legacy default discount percentage.">
                  <input type="number" min={0} max={100} step="0.01" className={input} value={settings.subprojectDiscountRate ?? ""} onChange={(event) => set("subprojectDiscountRate", event.target.value === "" ? null : Number(event.target.value))} />
                </Field>
                <Field label="Reconnection fee (KSh)" hint="Default fee recorded in the legacy setup.">
                  <input type="number" min={0} step="0.01" className={input} value={settings.reconnectionFee ?? ""} onChange={(event) => set("reconnectionFee", event.target.value === "" ? null : Number(event.target.value))} />
                </Field>
                <Field label="New connection fee (KSh)" hint="Auto-applied to new applications; authorized staff can override it with a reason.">
                  <input type="number" min={0} step="0.01" className={input} value={settings.defaultConnectionFee ?? ""} onChange={(event) => set("defaultConnectionFee", event.target.value === "" ? null : Number(event.target.value))} />
                </Field>
                <Field label="Variance alert (%)" hint="Flag an unusual change for review.">
                  <input type="number" min={0} max={999.99} step="0.01" className={input} value={settings.readingVariancePercent} onChange={(event) => set("readingVariancePercent", Number(event.target.value))} required />
                </Field>
                <Field label="Minimum reading" hint="Lowest accepted meter value.">
                  <input type="number" min={0} step="0.001" className={input} value={settings.minimumReadingValue} onChange={(event) => set("minimumReadingValue", Number(event.target.value))} required />
                </Field>
              </div>
            </Card>

            <Card title="Billing and receipt messages" description="Text imported from the MajiWare setup and available for document templates.">
              <div className="space-y-4">
                {(["billingMessageLine1", "billingMessageLine2", "billingMessageLine3"] as const).map((key, index) => (
                  <Field key={key} label={`Billing message line ${index + 1}`}>
                    <textarea rows={2} className={input} value={settings[key]} onChange={(event) => set(key, event.target.value)} />
                  </Field>
                ))}
                <Field label="Receipt message">
                  <textarea rows={2} className={input} value={settings.receiptMessage} onChange={(event) => set("receiptMessage", event.target.value)} />
                </Field>
              </div>
            </Card>

            <Card title="Demand notice messages" description="Optional staged recovery messages retained from the legacy setup.">
              <div className="space-y-4">
                {(["demandMessageLine1", "demandMessageLine2", "demandMessageLine3", "demandMessageLine4", "demandMessageLine5"] as const).map((key, index) => (
                  <Field key={key} label={`Demand message ${index + 1}`}>
                    <textarea rows={2} className={input} value={settings[key]} onChange={(event) => set(key, event.target.value)} />
                  </Field>
                ))}
              </div>
            </Card>

            <Card title="Security and availability" description="Defaults governing access and system availability.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Session timeout (minutes)">
                  <input type="number" min={5} max={1440} className={input} value={settings.sessionTimeoutMinutes} onChange={(event) => set("sessionTimeoutMinutes", Number(event.target.value))} required />
                </Field>
                <Field label="Minimum password length">
                  <input type="number" min={8} max={128} className={input} value={settings.passwordMinimumLength} onChange={(event) => set("passwordMinimumLength", Number(event.target.value))} required />
                </Field>
                <Toggle label="Require two-factor authentication" description="Make 2FA mandatory for staff accounts when authentication support is enabled." checked={settings.requireTwoFactor} onChange={(value) => set("requireTwoFactor", value)} />
                <Toggle label="Maintenance mode" description="Marks the system unavailable to non-administrators during planned maintenance." checked={settings.maintenanceMode} onChange={(value) => set("maintenanceMode", value)} tone="red" />
              </div>
            </Card>
          </div>

          <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-lg backdrop-blur">
            <p className="text-xs text-slate-500">
              {settings.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : "Review all values before saving."}
            </p>
            <button type="submit" disabled={saving} className="inline-flex min-w-36 items-center justify-center gap-2 rounded-lg bg-aqua-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-aqua-800 disabled:cursor-wait disabled:opacity-60">
              {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
