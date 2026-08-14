import { Link } from "react-router-dom";
import { getToken } from "../lib/api";
import { usePrivacyMode } from "../lib/privacyMode";

type IconProps = { className?: string };

const Droplet = ({ className = "h-6 w-6" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.4C9.2 6.2 5 11.2 5 15.3a7 7 0 0 0 14 0c0-4.1-4.2-9.1-7-12.9Zm0 16.4a3.6 3.6 0 0 1-3.6-3.6c0-.6.2-1.3.5-2 .3 2.2 1.8 3.6 4.3 4.2-.4.8-.7 1.2-1.2 1.4Z" />
  </svg>
);

const Arrow = ({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Check = ({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ModuleIcon = ({ type }: { type: "customer" | "meter" | "billing" | "revenue" }) => {
  const paths = {
    customer: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8 0a4 4 0 0 0 0-8m3 18v-2a4 4 0 0 0-3-3.87",
    meter: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4v2m-5.66.34 1.42 1.42M6 14H4m14 0h2m-2.34-5.66-1.42 1.42M12 14l3-3",
    billing: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8m-8 4h8",
    revenue: "M3 7h18v12H3zM3 11h18m-4 4h1M7 15h5",
  };
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={paths[type]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const modules = [
  {
    type: "customer" as const,
    title: "Customer operations",
    description: "Manage customers, properties, service accounts and complete interaction histories.",
    color: "bg-violet-50 text-violet-700 ring-violet-100",
  },
  {
    type: "meter" as const,
    title: "Meter intelligence",
    description: "Control inventory, assignments, field readings, exceptions and meter lifecycles.",
    color: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  },
  {
    type: "billing" as const,
    title: "Accurate billing",
    description: "Configure tariffs and turn approved readings into transparent, auditable bills.",
    color: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  {
    type: "revenue" as const,
    title: "Revenue assurance",
    description: "Collect, allocate and reconcile payments across M-Pesa and other channels.",
    color: "bg-amber-50 text-amber-700 ring-amber-100",
  },
];

export default function LandingPage() {
  const { enabled: privacyMode } = usePrivacyMode();
  const authenticated = Boolean(getToken());
  const primaryPath = authenticated ? "/customers" : "/login";
  const primaryLabel = authenticated ? "Open workspace" : "Sign in securely";

  return (
    <div className="landing-page h-screen overflow-y-auto bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
          <Link to="/" className={`flex items-center overflow-hidden rounded-xl ${privacyMode ? "bg-white ring-1 ring-amber-200" : ""}`} aria-label={privacyMode ? "Zevra Holdings demo home" : "Samdamte home"}>
            <img
              src={privacyMode ? "/zevra-demo-logo.png" : "/samdamte-water-logo-print.png"}
              alt={privacyMode ? "Zevra Holdings Ltd demo branding" : "Samdamte Water Utility Management"}
              className={`h-16 w-auto max-w-[270px] object-contain ${privacyMode ? "scale-[1.52]" : ""}`}
            />
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex" aria-label="Landing page">
            <a href="#platform" className="transition hover:text-aqua-700">Platform</a>
            <a href="#workflow" className="transition hover:text-aqua-700">Workflow</a>
            <a href="#assurance" className="transition hover:text-aqua-700">Assurance</a>
          </nav>

          <Link
            to={primaryPath}
            className="inline-flex items-center gap-2 rounded-xl bg-navy-900 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-navy-900/15 transition hover:-translate-y-0.5 hover:bg-aqua-700"
          >
            {primaryLabel}
            <Arrow />
          </Link>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden bg-[#f7fbfe]">
          <div className="absolute inset-0 -z-10 landing-grid opacity-60" />
          <div className="absolute -left-40 top-24 -z-10 h-96 w-96 rounded-full bg-sky-200/35 blur-3xl" />
          <div className="absolute -right-32 top-0 -z-10 h-[34rem] w-[34rem] rounded-full bg-emerald-100/45 blur-3xl" />

          <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-[0.88fr_1.12fr] lg:px-8 lg:py-28">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-aqua-700 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                One connected utility platform
              </div>
              <h1 className="mt-7 max-w-xl text-5xl font-black leading-[1.05] tracking-[-0.045em] text-navy-900 sm:text-6xl">
                Better water service starts with{" "}
                <span className="bg-gradient-to-r from-aqua-700 to-sky-400 bg-clip-text text-transparent">better visibility.</span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">
                AquaFlow connects customers, meters, readings, billing, payments and debt recovery in one secure operational workspace.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={primaryPath}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-aqua-700 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-sky-200 transition hover:-translate-y-0.5 hover:bg-aqua-600"
                >
                  {primaryLabel}
                  <Arrow />
                </Link>
                <a
                  href="#platform"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-aqua-700"
                >
                  Explore the platform
                </a>
              </div>

              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-slate-600">
                {["Role-based access", "Maker-checker controls", "Complete audit trail"].map((item) => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <Check className="h-3 w-3" />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-2xl">
              <div className="absolute -inset-5 -z-10 rounded-[2.5rem] bg-gradient-to-br from-sky-200/70 to-emerald-100/60 blur-2xl" />
              <div className="overflow-hidden rounded-[1.75rem] border border-white/80 bg-white p-3 shadow-[0_30px_80px_-30px_rgba(15,32,56,0.35)]">
                <div className="rounded-[1.3rem] border border-slate-200 bg-[#f7f9fc]">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-aqua-700 text-white"><Droplet className="h-5 w-5" /></span>
                      <div>
                        <p className="text-sm font-extrabold text-navy-900">Operations overview</p>
                        <p className="text-[11px] text-slate-500">Live utility performance</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-200" /><span className="h-2 w-2 rounded-full bg-slate-200" /><span className="landing-live-dot h-2 w-2 rounded-full bg-emerald-400" /></div>
                  </div>

                  <div className="grid gap-3 p-5 sm:grid-cols-3">
                    {[
                      ["Active accounts", "10,832", "+4.8%", "text-aqua-700"],
                      ["Collection rate", "94.2%", "+2.1%", "text-emerald-600"],
                      ["Open exceptions", "18", "Review", "text-amber-600"],
                    ].map(([label, value, change, color]) => (
                      <div key={label} className="landing-metric-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-[11px] font-semibold text-slate-500">{label}</p>
                        <div className="mt-2 flex items-end justify-between">
                          <p className={`text-2xl font-black ${color}`}>{value}</p>
                          <span className="text-[10px] font-bold text-slate-500">{change}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 px-5 pb-5 sm:grid-cols-[1.45fr_1fr]">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-700">Revenue performance</p>
                        <span className="text-[10px] font-semibold text-slate-400">Last 6 months</span>
                      </div>
                      <div className="mt-5 flex h-28 items-end gap-2">
                        {[43, 58, 52, 72, 67, 88, 76, 94, 83, 100, 89, 106].map((height, index) => (
                          <span
                            key={index}
                            className={`landing-chart-bar flex-1 rounded-t ${index > 8 ? "bg-aqua-600" : "bg-sky-100"}`}
                            style={{
                              height: `${height}px`,
                              animationDelay: `${index * 110}ms`,
                            }}
                          />
                        ))}
                      </div>
                      <div className="mt-3 flex justify-between text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                        <span>Jan</span><span>Mar</span><span>Jun</span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-navy-900 p-4 text-white shadow-lg">
                      <p className="text-xs font-bold text-sky-200">Today&apos;s workflow</p>
                      <div className="mt-4 space-y-3">
                        {[
                          ["Readings captured", "1,248"],
                          ["Bills approved", "864"],
                          ["Payments matched", "732"],
                        ].map(([label, value], index) => (
                          <div key={label} className="flex items-center justify-between border-b border-white/10 pb-3 last:border-0 last:pb-0">
                            <div className="flex items-center gap-2">
                              <span className={`landing-workflow-dot h-2 w-2 rounded-full ${index === 2 ? "bg-emerald-400" : "bg-sky-400"}`} style={{ animationDelay: `${index * 400}ms` }} />
                              <span className="text-[11px] text-slate-300">{label}</span>
                            </div>
                            <span className="text-xs font-extrabold">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="landing-payment-toast absolute -bottom-5 -left-5 hidden rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-xl sm:flex sm:items-center sm:gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Check /></span>
                <div><p className="text-xs font-extrabold text-slate-800">Payment reconciled</p><p className="text-[10px] text-slate-500">M-Pesa confirmation received</p></div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="scroll-mt-24 bg-white py-24">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-aqua-700">Built for utility operations</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight text-navy-900">One reliable view of the entire customer journey</h2>
              <p className="mt-5 text-base leading-7 text-slate-600">Replace disconnected spreadsheets and manual hand-offs with controlled workflows that every team can follow.</p>
            </div>
            <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {modules.map((module) => (
                <article key={module.title} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_36px_-24px_rgba(15,32,56,0.35)] transition hover:-translate-y-1 hover:border-sky-200 hover:shadow-xl">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ${module.color}`}>
                    <ModuleIcon type={module.type} />
                  </span>
                  <h3 className="mt-5 text-lg font-extrabold text-navy-900">{module.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{module.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 border-y border-slate-200 bg-slate-50 py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-aqua-700">A connected workflow</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight text-navy-900">From meter reading to collected revenue, without losing context.</h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">Every approval, exception and financial movement stays linked to the correct customer account and responsible user.</p>
            </div>
            <div className="grid gap-3">
              {[
                ["01", "Capture", "Field teams record readings with route and exception context."],
                ["02", "Validate", "Supervisors independently review readings and billing inputs."],
                ["03", "Bill", "Approved tariffs produce transparent, reconcilable customer bills."],
                ["04", "Collect", "Payments are matched, receipted and reflected on statements."],
              ].map(([number, title, description]) => (
                <div key={number} className="flex items-start gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-xs font-black text-sky-200">{number}</span>
                  <div><h3 className="font-extrabold text-navy-900">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{description}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="assurance" className="scroll-mt-24 bg-navy-900 py-20 text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 px-6 lg:flex-row lg:items-center lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-sky-300">Operational confidence</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight text-white">Controlled access. Independent approvals. Traceable decisions.</h2>
              <p className="mt-5 text-base leading-7 text-slate-300">AquaFlow helps teams protect revenue and customer trust through role-based permissions and full audit visibility.</p>
            </div>
            <Link
              to={primaryPath}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-extrabold text-navy-900 shadow-xl transition hover:-translate-y-0.5 hover:bg-sky-50"
            >
              {primaryLabel}
              <Arrow />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className={`overflow-hidden rounded-lg ${privacyMode ? "bg-white ring-1 ring-amber-200" : ""}`}>
            <img
              src={privacyMode ? "/zevra-demo-logo.png" : "/samdamte-water-logo-print.png"}
              alt={privacyMode ? "Zevra Holdings Ltd demo branding" : "Samdamte Water Utility Management"}
              className={`h-12 w-auto max-w-[220px] object-contain ${privacyMode ? "scale-[1.52]" : ""}`}
            />
          </div>
          <p>Professional water utility operations, connected end to end.</p>
          <p>© {new Date().getFullYear()} Samdamte Water</p>
        </div>
      </footer>
    </div>
  );
}
