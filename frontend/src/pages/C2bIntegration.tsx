import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import { api, getSessionUser } from "../lib/api";
import { showToast } from "../components/SweetAlertToast";

type C2bConfig = {
  configured: boolean;
  environment: string;
  shortCode?: string;
  responseType?: string;
  callbackSecured?: boolean;
  validationUrl?: string;
  confirmationUrl?: string;
  registered?: boolean;
  registeredAt?: string | null;
  registrationResponseCode?: string | null;
  error?: string;
};

type RegistrationResult = {
  ResponseCode?: string;
  ResponseDescription?: string;
  OriginatorCoversationID?: string;
  [key: string]: unknown;
};

const Icon = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-50 text-aqua-700">
    {children}
  </div>
);

const Check = ({ ready }: { ready: boolean }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
      ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
    }`}
  >
    <span className={`h-2 w-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`} />
    {ready ? "Ready" : "Needs attention"}
  </span>
);

const Spinner = ({ light = false }: { light?: boolean }) => (
  <span
    aria-hidden="true"
    className={`inline-block h-4 w-4 animate-spin rounded-full border-2 ${
      light ? "border-white/40 border-t-white" : "border-sky-200 border-t-aqua-700"
    }`}
  />
);

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load C2B configuration.";
}

export default function C2bIntegration() {
  const [config, setConfig] = useState<C2bConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [registration, setRegistration] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState("");
  const roles = getSessionUser()?.roles ?? [];
  const canRegister = roles.some((role) => ["SYSTEM_ADMIN", "FINANCE_MANAGER"].includes(role));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setConfig((await api.getMpesaC2bConfig()) as C2bConfig);
    } catch (reason) {
      setError(safeMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    const confirmation = await Swal.fire({
      icon: "question",
      title: "Register production C2B URLs?",
      text: "This sends the configured validation and confirmation URLs to Safaricom for this PayBill.",
      showCancelButton: true,
      confirmButtonText: "Register URLs",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0369a1",
      reverseButtons: true,
    });
    if (!confirmation.isConfirmed) return;

    setRegistering(true);
    setRegistration(null);
    try {
      const result = (await api.registerMpesaC2bUrls()) as RegistrationResult;
      setRegistration(result);
      showToast(result.ResponseDescription || "C2B URLs registered successfully.", "success");
      await load();
    } catch (reason) {
      showToast(safeMessage(reason), "error");
    } finally {
      setRegistering(false);
    }
  };

  const production = config?.environment === "production";
  const ready = Boolean(config?.configured && production && config.callbackSecured);
  const registered = Boolean(config?.registered);

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:px-6 lg:py-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-aqua-700">Payments &amp; Revenue</div>
          <h1 className="text-2xl font-bold text-slate-900">M-Pesa C2B integration</h1>
          <p className="mt-1 text-[15px] text-slate-500">Confirm live PayBill readiness, register callbacks and monitor incoming payments.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading && <Spinner />}
          {loading ? "Checking…" : "Refresh status"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-900">Live connection status</h2>
            <p className="mt-0.5 text-sm text-slate-500">Sensitive keys and callback tokens are never displayed.</p>
          </div>
          {!loading && <Check ready={ready} />}
        </div>

        {loading ? (
          <div className="p-5" role="status" aria-live="polite">
            <div className="mb-4 flex items-center justify-center gap-2 text-sm font-semibold text-slate-600">
              <Spinner /> Checking C2B configuration…
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-5 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Environment</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <strong className="text-lg capitalize text-slate-900">{config?.environment || "Unknown"}</strong>
                <Check ready={production} />
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">PayBill number</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <strong className="text-lg text-slate-900">{config?.shortCode || "Not configured"}</strong>
                <Check ready={Boolean(config?.shortCode)} />
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Callback protection</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <strong className="text-lg text-slate-900">{config?.callbackSecured ? "Secured" : "Incomplete"}</strong>
                <Check ready={Boolean(config?.callbackSecured)} />
              </div>
            </div>
          </div>
        )}

        {config?.error && <div className="mx-5 mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{config.error}</div>}
        {!loading && config?.configured && (
          <div className="border-t border-slate-100 px-5 py-4">
            <div className="grid gap-3 lg:grid-cols-2">
              {[
                ["Validation callback", config.validationUrl],
                ["Confirmation callback", config.confirmationUrl],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-500">{label}</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-700">{value || "Not configured"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Icon>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6"><path d="M12 3v12m0-12 4 4m-4-4L8 7"/><path d="M5 13v6h14v-6"/></svg>
            </Icon>
            <div>
              <h2 className="font-bold text-slate-900">Register callback URLs</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">Send the configured URLs to Safaricom. Register after changing the domain, callback paths or tokens.</p>
            </div>
          </div>

          {registered && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="font-semibold text-emerald-800">Callback URLs registered</div>
              <div className="mt-1 text-xs text-emerald-700">
                Safaricom accepted this exact PayBill and callback configuration
                {config?.registeredAt ? ` on ${new Date(config.registeredAt).toLocaleString("en-KE")}` : ""}.
              </div>
            </div>
          )}

          {!production && config && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The backend is not in production mode. Registration is disabled.</div>
          )}
          {!canRegister && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">A System Administrator or Finance Manager must register the URLs.</div>
          )}
          {registration && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="font-semibold text-emerald-800">{registration.ResponseDescription || "Safaricom accepted the request."}</div>
              <div className="mt-1 text-xs text-emerald-700">Response code: {registration.ResponseCode ?? "Received"}</div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void register()}
            disabled={!ready || !canRegister || registering || registered}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-aqua-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-aqua-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {registering && <Spinner light />}
            {registering ? "Registering…" : registered ? "URLs already registered" : "Register URLs with Safaricom"}
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Test a live payment</h2>
          <ol className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-50 text-xs font-bold text-aqua-700">1</span><span>Pay a small amount to PayBill <strong className="text-slate-900">{config?.shortCode || "—"}</strong> using a real customer account number.</span></li>
            <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-50 text-xs font-bold text-aqua-700">2</span><span>Confirm the receipt appears in the payment register and the customer balance changes.</span></li>
            <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-50 text-xs font-bold text-aqua-700">3</span><span>If the account reference is invalid, review and allocate it from Unmatched Payments.</span></li>
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/payments/register" className="rounded-lg bg-aqua-700 px-4 py-2.5 text-sm font-bold text-white">Open payment register</Link>
            <Link to="/payments/unmatched" className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">View unmatched</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
