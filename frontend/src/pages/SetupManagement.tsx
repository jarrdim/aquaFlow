import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

type SetupItem = { name: string; description: string; path: string };
type SetupGroup = {
  title: string;
  eyebrow: string;
  tone: string;
  icon: "building" | "map" | "billing" | "revenue" | "operations" | "security";
  items: SetupItem[];
};

const setupGroups: SetupGroup[] = [
  {
    title: "Organization", eyebrow: "Utility profile", tone: "bg-sky-50 text-sky-700 ring-sky-100", icon: "building",
    items: [{ name: "System settings", description: "Utility identity, contacts, regional defaults, fees, messages and security defaults.", path: "/settings" }],
  },
  {
    title: "Service territory & customers", eyebrow: "Master data", tone: "bg-indigo-50 text-indigo-700 ring-indigo-100", icon: "map",
    items: [
      { name: "Zones", description: "Operational zones used by properties, meters and field teams.", path: "/setups/zones" },
      { name: "Service areas", description: "Estates, villages, markets and other service areas within zones.", path: "/setups/service-areas" },
      { name: "Meter-reading routes", description: "Reading routes and their sequence within each zone.", path: "/setups/routes" },
      { name: "Customer categories", description: "Domestic, commercial and other account classifications.", path: "/setups/customer-categories" },
      { name: "Field officers", description: "Meter readers and operational officers assigned to zones and routes.", path: "/setups/field-officers" },
    ],
  },
  {
    title: "Meter reading & billing", eyebrow: "Revenue cycle", tone: "bg-cyan-50 text-cyan-700 ring-cyan-100", icon: "billing",
    items: [
      { name: "Period groups", description: "Shared periods that connect reading and billing cycles.", path: "/period-groups" },
      { name: "Reading cycles", description: "Meter-reading cycles for each billing period group.", path: "/readings/cycles" },
      { name: "Reader assignments", description: "Assign routes and field officers to reading cycles.", path: "/readings/assignments" },
      { name: "Billing periods", description: "Billing cycles, due dates and posting periods.", path: "/billing/periods" },
      { name: "Meter catalogue", description: "Standard meter types, technologies, brands, sizes and installation defaults.", path: "/setups/meter-catalogue" },
    ],
  },
  {
    title: "Tariffs & revenue", eyebrow: "Commercial rules", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100", icon: "revenue",
    items: [
      { name: "Tariffs and bands", description: "Consumption rates, fixed charges and tariff bands.", path: "/tariffs/register" },
      { name: "Category assignments", description: "Assign tariffs to customer categories with effective dates.", path: "/tariffs/assignments" },
      { name: "Payment channels", description: "Bank, M-Pesa, cash and other collection channels.", path: "/payments/channels" },
    ],
  },
  {
    title: "Operations & communication", eyebrow: "Service delivery", tone: "bg-amber-50 text-amber-700 ring-amber-100", icon: "operations",
    items: [
      { name: "Notification templates", description: "Reusable billing, payment and service messages.", path: "/notifications/templates" },
      { name: "Notification providers", description: "SMS and email delivery-provider configuration.", path: "/notifications/providers" },
      { name: "Service-request types", description: "Complaint, leak, reconnection and customer-service classifications.", path: "/setups/service-request-types" },
      { name: "Work-order types", description: "Field-work categories, priorities, evidence and completion rules.", path: "/setups/work-order-types" },
    ],
  },
  {
    title: "Users & security", eyebrow: "Access control", tone: "bg-rose-50 text-rose-700 ring-rose-100", icon: "security",
    items: [
      { name: "Users", description: "Staff accounts and access status.", path: "/admin/users" },
      { name: "Roles", description: "Job roles and their permission grants.", path: "/admin/roles" },
      { name: "Permissions", description: "System permission register by module.", path: "/admin/permissions" },
    ],
  },
];

function GroupIcon({ name }: { name: SetupGroup["icon"] }) {
  const paths = {
    building: <><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" /><path d="M9 21v-4h3v4M8 7h1m3 0h1M8 11h1m3 0h1M17 9h2a1 1 0 0 1 1 1v11M3 21h18" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15m6-12v15" /></>,
    billing: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6m-6 4h6m-6 4h3" /></>,
    revenue: <><circle cx="12" cy="12" r="9" /><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8m4-10v12" /></>,
    operations: <><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3Z" /><path d="m16 16 5 5" /></>,
    security: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function SetupManagement() {
  const [search, setSearch] = useState("");
  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return setupGroups;
    return setupGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => `${group.title} ${item.name} ${item.description}`.toLowerCase().includes(needle)) }))
      .filter((group) => group.items.length > 0);
  }, [search]);
  const totalItems = setupGroups.reduce((total, group) => total + group.items.length, 0);
  const visibleItems = filteredGroups.reduce((total, group) => total + group.items.length, 0);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 p-4 lg:px-6 lg:py-5">
      <header className="page-screen-header overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-navy-800 to-aqua-800 px-5 py-6 text-white shadow-lg sm:px-7 sm:py-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> System configuration</div>
            <h1 className="text-2xl font-extrabold text-white sm:text-3xl">Setups</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100/80">Configure the master data, operational rules and access controls used across your utility.</p>
          </div>
          <div className="flex gap-3">
            <div className="min-w-24 rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-sm"><div className="text-2xl font-extrabold text-white">{totalItems}</div><div className="text-xs font-medium text-blue-100/70">Setup areas</div></div>
            <div className="min-w-24 rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-sm"><div className="text-2xl font-extrabold text-white">{setupGroups.length}</div><div className="text-xs font-medium text-blue-100/70">Categories</div></div>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-base font-bold text-slate-900">Configuration directory</h2><p className="mt-1 text-xs text-slate-500">Select a setup area to review or update its configuration.</p></div>
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">Search setup areas</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search setups..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-14 text-sm text-slate-800 outline-none transition focus:border-aqua-500 focus:bg-white focus:ring-2 focus:ring-aqua-500/15" />
            {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-bold text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Clear search">Clear</button>}
          </label>
        </div>
      </section>

      {filteredGroups.length ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {filteredGroups.map((group) => (
            <section key={group.title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${group.tone}`}><GroupIcon name={group.icon} /></div>
                <div className="min-w-0 flex-1"><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{group.eyebrow}</p><h2 className="mt-0.5 truncate text-base font-bold text-slate-900">{group.title}</h2></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{group.items.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {group.items.map((item) => (
                  <Link key={item.name} to={{ pathname: item.path, search: "?setup=1" }} className="group flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-sky-50/60 focus:outline-none focus-visible:bg-sky-50">
                    <span className="min-w-0"><span className="block text-sm font-bold text-slate-800 transition group-hover:text-aqua-800">{item.name}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span></span>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm transition group-hover:translate-x-0.5 group-hover:border-aqua-200 group-hover:text-aqua-700" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg></div>
          <h2 className="mt-4 font-bold text-slate-900">No setup areas found</h2>
          <p className="mt-1 text-sm text-slate-500">No results match “{search}”. Try a different search term.</p>
          <button type="button" onClick={() => setSearch("")} className="mt-4 text-sm font-bold text-aqua-700 hover:text-aqua-600">Clear search</button>
        </section>
      )}
      {search && filteredGroups.length > 0 && <p className="text-center text-xs font-medium text-slate-500">Showing {visibleItems} of {totalItems} setup areas</p>}
    </main>
  );
}
