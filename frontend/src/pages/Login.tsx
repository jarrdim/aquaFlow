import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { setSessionUser, setToken } from "../lib/api";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { usePrivacyMode } from "../lib/privacyMode";

export default function Login() {
  const { enabled: privacyMode } = usePrivacyMode();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("reason") === "expired";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login(username, password);
      setToken(token);
      setSessionUser({ ...user, userId: String(user.userId) });
      const requestedPath = searchParams.get("next");
      const next = requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
        ? requestedPath
        : "/dashboard";
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-white shadow-sm rounded-xl p-8 w-full max-w-sm border border-slate-200">
        <div className="mb-6 border-b border-slate-100 pb-5 text-center">
          <div className={privacyMode ? "mx-auto max-w-[250px] overflow-hidden rounded-xl bg-white ring-1 ring-amber-200" : ""}>
            <img
              src={privacyMode ? "/zevra-demo-logo.png" : "/samdamte-water-logo-print.png"}
              alt={privacyMode ? "Zevra Holdings Ltd demo branding" : "Samdamte Water Utility Management"}
              className={`mx-auto h-auto w-full object-contain ${privacyMode ? "scale-[1.42]" : "max-w-[250px]"}`}
            />
          </div>
          <p className="mt-3 text-sm text-slate-500">{privacyMode ? "Demo access to the management system" : "Sign in to the utility management system"}</p>
        </div>

        <SweetAlertToast
          message={sessionExpired && !error ? "Your session expired. Sign in again to continue." : ""}
          type="warning"
        />

        <label className="block text-sm font-medium mb-1">Username</label>
        <input
          className="w-full border border-slate-300 rounded-md px-3 py-2 mb-4 text-sm"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          type="password"
          className="w-full border border-slate-300 rounded-md px-3 py-2 mb-4 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <SweetAlertToast message={error} type="error" />

        <button
          disabled={loading}
          className="w-full bg-aqua-700 hover:bg-aqua-600 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
