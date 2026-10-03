import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { api, getSessionUser } from "../lib/api";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "checkbox";
  required?: boolean;
  options?: readonly string[];
  lookup?: "zones" | "users";
  table?: boolean;
  wide?: boolean;
  min?: number;
};
type Config = {
  title: string;
  singular: string;
  description: string;
  idKey: string;
  fields: Field[];
  initial: Record<string, unknown>;
};

const statusOptions = ["ACTIVE", "INACTIVE"] as const;
const configs: Record<string, Config> = {
  zones: {
    title: "Zones", singular: "zone", idKey: "zoneId",
    description: "Manage operational zones used by properties, routes, meters and field teams.",
    fields: [
      { key: "zoneCode", label: "Zone code", required: true, table: true },
      { key: "zoneName", label: "Zone name", required: true, table: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { zoneCode: "", zoneName: "", description: "", status: "ACTIVE" },
  },
  "service-areas": {
    title: "Service areas", singular: "service area", idKey: "serviceAreaId",
    description: "Maintain estates, villages, markets and other service areas within each zone.",
    fields: [
      { key: "areaCode", label: "Area code", required: true, table: true },
      { key: "areaName", label: "Area name", required: true, table: true },
      { key: "zoneId", label: "Zone", type: "select", lookup: "zones", required: true, table: true },
      { key: "areaType", label: "Area type", type: "select", options: ["ESTATE", "VILLAGE", "MARKET", "INDUSTRIAL", "OTHER"], required: true, table: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { areaCode: "", areaName: "", zoneId: "", areaType: "ESTATE", description: "", status: "ACTIVE" },
  },
  routes: {
    title: "Meter-reading routes", singular: "route", idKey: "routeId",
    description: "Configure reading routes, their zone and the order in which field teams visit them.",
    fields: [
      { key: "zoneId", label: "Zone", type: "select", lookup: "zones", required: true, table: true },
      { key: "routeCode", label: "Route code", required: true, table: true },
      { key: "routeName", label: "Route name", required: true, table: true },
      { key: "sequenceNumber", label: "Sequence", type: "number", min: 1, table: true },
      { key: "estimatedCustomers", label: "Estimated customers", type: "number", min: 0, table: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { routeCode: "", routeName: "", zoneId: "", sequenceNumber: "", estimatedCustomers: "", status: "ACTIVE" },
  },
  "customer-categories": {
    title: "Customer categories", singular: "customer category", idKey: "categoryId",
    description: "Maintain the classifications used for customer accounts and tariff assignments.",
    fields: [
      { key: "categoryCode", label: "Category code", required: true, table: true },
      { key: "categoryName", label: "Category name", required: true, table: true },
      { key: "description", label: "Description", type: "textarea", wide: true, table: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { categoryCode: "", categoryName: "", description: "", status: "ACTIVE" },
  },
  "field-officers": {
    title: "Field officers", singular: "field officer", idKey: "fieldOfficerId",
    description: "Link staff accounts to field profiles used for reading routes and work assignments.",
    fields: [
      { key: "userId", label: "Staff account", type: "select", lookup: "users", required: true, table: true },
      { key: "employeeNumber", label: "Employee number", required: true, table: true },
      { key: "officerType", label: "Officer type", type: "select", options: ["METER_READER", "FIELD_OFFICER", "SUPERVISOR"], required: true, table: true },
      { key: "phoneNumber", label: "Phone number", required: true, table: true },
      { key: "homeZoneId", label: "Home zone", type: "select", lookup: "zones", table: true },
      { key: "availabilityStatus", label: "Availability", type: "select", options: ["AVAILABLE", "BUSY", "ON_LEAVE", "UNAVAILABLE"], required: true, table: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { userId: "", employeeNumber: "", officerType: "METER_READER", phoneNumber: "", homeZoneId: "", availabilityStatus: "AVAILABLE", status: "ACTIVE" },
  },
  "meter-catalogue": {
    title: "Meter catalogue", singular: "catalogue item", idKey: "meterCatalogueItemId",
    description: "Define standard meter configurations for consistent stock registration and installation.",
    fields: [
      { key: "catalogueCode", label: "Catalogue code", required: true, table: true },
      { key: "catalogueName", label: "Catalogue name", required: true, table: true },
      { key: "meterType", label: "Meter type", type: "select", options: ["CUSTOMER", "BULK", "ZONE", "BOREHOLE"], required: true, table: true },
      { key: "technology", label: "Technology", type: "select", options: ["MANUAL", "PREPAID", "SMART"], required: true, table: true },
      { key: "brand", label: "Brand", table: true },
      { key: "model", label: "Model" },
      { key: "meterSizeMm", label: "Size (mm)", type: "number", min: 0, required: true, table: true },
      { key: "defaultInstallationStatus", label: "Installation default", type: "select", options: ["IN_STORE", "INSTALLED", "REMOVED"], required: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { catalogueCode: "", catalogueName: "", meterType: "CUSTOMER", technology: "MANUAL", brand: "", model: "", meterSizeMm: "15", defaultInstallationStatus: "IN_STORE", description: "", status: "ACTIVE" },
  },
  "service-request-types": {
    title: "Service-request types", singular: "service-request type", idKey: "serviceRequestTypeId",
    description: "Define customer-service classifications, their priority and expected response time.",
    fields: [
      { key: "typeCode", label: "Type code", required: true, table: true },
      { key: "typeName", label: "Type name", required: true, table: true },
      { key: "requestClass", label: "Request class", type: "select", options: ["SERVICE_REQUEST", "COMPLAINT"], required: true, table: true },
      { key: "defaultPriority", label: "Default priority", type: "select", options: ["LOW", "MEDIUM", "HIGH", "URGENT"], required: true, table: true },
      { key: "targetResolutionHours", label: "Target resolution (hours)", type: "number", min: 1, table: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { typeCode: "", typeName: "", requestClass: "SERVICE_REQUEST", defaultPriority: "MEDIUM", targetResolutionHours: "72", description: "", status: "ACTIVE" },
  },
  "work-order-types": {
    title: "Work-order types", singular: "work-order type", idKey: "workOrderTypeId",
    description: "Configure field-work categories and the evidence required before completion.",
    fields: [
      { key: "typeCode", label: "Type code", required: true, table: true },
      { key: "typeName", label: "Type name", required: true, table: true },
      { key: "description", label: "Description", type: "textarea", wide: true, table: true },
      { key: "defaultPriority", label: "Default priority", type: "select", options: ["LOW", "NORMAL", "HIGH", "EMERGENCY"], required: true, table: true },
      { key: "estimatedDurationMinutes", label: "Estimated duration (minutes)", type: "number", min: 1 },
      { key: "standardMaterials", label: "Standard materials", type: "textarea", wide: true },
      { key: "completionInstructions", label: "Completion instructions", type: "textarea", wide: true },
      { key: "requiresPhoto", label: "Require photo", type: "checkbox", table: true },
      { key: "requiresGps", label: "Require GPS", type: "checkbox", table: true },
      { key: "requiresSignature", label: "Require signature", type: "checkbox", table: true },
      { key: "status", label: "Status", type: "select", options: statusOptions, required: true, table: true },
    ],
    initial: { typeCode: "", typeName: "", description: "", defaultPriority: "NORMAL", estimatedDurationMinutes: "", standardMaterials: "", completionInstructions: "", requiresPhoto: false, requiresGps: false, requiresSignature: false, status: "ACTIVE" },
  },
};

const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/15";
const pretty = (value: unknown) => String(value ?? "—").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The operation could not be completed.";

export default function SetupResourceManagement() {
  const { resource = "" } = useParams();
  const config = configs[resource];
  const isAdmin = Boolean(getSessionUser()?.roles.includes("SYSTEM_ADMIN"));
  const [rows, setRows] = useState<any[]>([]);
  const [lookups, setLookups] = useState<{ zones: any[]; users: any[] }>({ zones: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async () => {
    if (!config || !isAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const [records, lookupData] = await Promise.all([api.listSetupRecords(resource), api.getSetupLookups()]);
      setRows(records as any[]);
      setLookups(lookupData as any);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [resource, isAdmin]);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesStatus = statusFilter === "ALL" || row.status === statusFilter;
    const needle = search.trim().toLowerCase();
    return matchesStatus && (!needle || Object.values(row).some((value) =>
      typeof value === "string" && value.toLowerCase().includes(needle),
    ));
  }), [rows, search, statusFilter]);

  if (!config) return <main className="p-6"><p className="text-slate-600">Unknown setup section.</p></main>;

  const optionsFor = (field: Field) => {
    if (field.lookup === "zones") return lookups.zones.map((zone) => ({ value: String(zone.zoneId), label: zone.zoneCode ? `${zone.zoneCode} · ${zone.zoneName}` : zone.zoneName }));
    if (field.lookup === "users") return lookups.users.map((user) => ({ value: String(user.userId), label: `${user.firstName} ${user.lastName} (${user.username})` }));
    return (field.options ?? []).map((value) => ({ value, label: pretty(value) }));
  };
  const display = (row: any, field: Field) => {
    if (field.key === "zoneId" || field.key === "homeZoneId") return row.zone?.zoneName ?? row.homeZone?.zoneName ?? optionsFor(field).find((option) => option.value === String(row[field.key]))?.label ?? "—";
    if (field.key === "userId") return row.user ? `${row.user.firstName} ${row.user.lastName}` : optionsFor(field).find((option) => option.value === String(row.userId))?.label ?? "—";
    if (field.type === "checkbox") return row[field.key] ? "Yes" : "No";
    if (field.type === "select") return pretty(row[field.key]);
    return row[field.key] === null || row[field.key] === "" || row[field.key] === undefined ? "—" : String(row[field.key]);
  };
  const nextRouteCode = (zoneId: string) => {
    const codes = rows
      .filter((row) => String(row.zoneId) === zoneId)
      .map((row) => String(row.routeCode ?? "").trim().toUpperCase())
      .filter(Boolean);
    const numbered = codes.flatMap((routeCode) => {
      const match = routeCode.match(/^(.*?)(\d+)$/);
      return match ? [{ prefix: match[1], number: Number(match[2]), width: match[2].length }] : [];
    });
    if (numbered.length) {
      const prefixFrequency = new Map<string, number>();
      numbered.forEach(({ prefix }) => prefixFrequency.set(prefix, (prefixFrequency.get(prefix) ?? 0) + 1));
      const prefix = Array.from(prefixFrequency.entries()).sort((left, right) => right[1] - left[1])[0][0];
      const matching = numbered.filter((item) => item.prefix === prefix);
      const nextNumber = Math.max(...matching.map((item) => item.number)) + 1;
      const width = Math.max(2, ...matching.map((item) => item.width));
      return `${prefix}${String(nextNumber).padStart(width, "0")}`;
    }
    const zone = lookups.zones.find((item) => String(item.zoneId) === zoneId);
    const zoneCode = String(zone?.zoneCode ?? "ZONE")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `RT-${zoneCode || "ZONE"}-01`;
  };
  const openCreate = () => {
    setEditing(null);
    setForm({ ...config.initial });
  };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm(Object.fromEntries(config.fields.map((field) => [field.key, row[field.key] ?? config.initial[field.key] ?? ""])));
  };
  const close = () => { if (!saving) { setEditing(null); setForm({}); } };
  const isOpen = Object.keys(form).length > 0;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setSuccess("");
    const payload = Object.fromEntries(config.fields.map((field) => {
      let value = form[field.key];
      if (field.type === "number") value = value === "" ? null : Number(value);
      if (field.lookup && value === "") value = null;
      return [field.key, value];
    }));
    try {
      if (editing) await api.updateSetupRecord(resource, String(editing[config.idKey]), payload);
      else await api.createSetupRecord(resource, payload);
      setSuccess(`${config.singular[0].toUpperCase()}${config.singular.slice(1)} ${editing ? "updated" : "created"} successfully.`);
      setEditing(null); setForm({});
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally { setSaving(false); }
  }

  async function deactivate(row: any) {
    if (!window.confirm(`Deactivate this ${config.singular}? Existing operational records will be preserved.`)) return;
    try {
      await api.deactivateSetupRecord(resource, String(row[config.idKey]));
      setSuccess(`${config.singular[0].toUpperCase()}${config.singular.slice(1)} deactivated.`);
      await load();
    } catch (requestError) { setError(errorMessage(requestError)); }
  }

  const tableFields = config.fields.filter((field) => field.table);
  const activeCount = rows.filter((row) => row.status === "ACTIVE").length;
  const inactiveCount = rows.filter((row) => row.status === "INACTIVE").length;
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 p-4 lg:px-6 lg:py-5">
      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />
      <header className="page-screen-header overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5 px-5 py-5 sm:px-6">
          <div className="max-w-3xl">
            <Link to="/setups" className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-aqua-700 transition hover:text-aqua-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Setup directory
            </Link>
            <h1 className="text-2xl font-extrabold text-slate-900">{config.title}</h1>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">{config.description}</p>
          </div>
          {isAdmin && <button type="button" onClick={openCreate} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-aqua-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-aqua-600 hover:shadow-md disabled:cursor-wait disabled:opacity-60"><span className="text-lg leading-none">+</span> Add {config.singular}</button>}
        </div>
        {isAdmin && <div className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/70 sm:flex sm:divide-x sm:divide-slate-200">
          <div className="px-5 py-3 sm:min-w-36"><div className="text-lg font-extrabold text-slate-900">{rows.length}</div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total records</div></div>
          <div className="px-5 py-3 sm:min-w-36"><div className="text-lg font-extrabold text-emerald-700">{activeCount}</div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Active</div></div>
          <div className="px-5 py-3 sm:min-w-36"><div className="text-lg font-extrabold text-slate-500">{inactiveCount}</div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Inactive</div></div>
        </div>}
      </header>

      {!isAdmin ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <div className="flex items-start gap-4"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-amber-700 shadow-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></div><div><h2 className="font-bold text-amber-950">Access restricted</h2><p className="mt-1 text-sm text-amber-800">Only a System Administrator can manage setup data.</p></div></div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1 sm:max-w-md"><span className="sr-only">Search {config.title}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input className={`${input} pl-10`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}...`} /></label>
            <SearchableSelect className={`${input} w-full sm:w-44`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
            </SearchableSelect>
          </div>
          {loading ? <div className="flex min-h-72 items-center justify-center text-sm font-semibold text-slate-500"><span className="mr-3 h-6 w-6 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700" />Loading setup data...</div> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-500"><tr>{tableFields.map((field) => <th key={field.key} className="whitespace-nowrap px-5 py-3.5 font-extrabold">{field.label}</th>)}<th className="px-5 py-3.5 text-right font-extrabold">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((row) => <tr key={String(row[config.idKey])} className="transition hover:bg-sky-50/40">{tableFields.map((field) => <td key={field.key} className={`max-w-xs px-5 py-4 ${field.key.toLowerCase().includes("name") || field.key.toLowerCase().includes("code") ? "font-semibold text-slate-800" : "text-slate-600"}`}>{field.key === "status" ? <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${row.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${row.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-400"}`} />{pretty(row.status)}</span> : display(row, field)}</td>)}<td className="whitespace-nowrap px-5 py-4 text-right"><button type="button" onClick={() => openEdit(row)} className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-aqua-700 transition hover:bg-aqua-50 hover:text-aqua-800">Edit</button>{row.status === "ACTIVE" && <button type="button" onClick={() => void deactivate(row)} className="ml-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 hover:text-red-700">Deactivate</button>}</td></tr>)}
                  {!filtered.length && <tr><td colSpan={tableFields.length + 1} className="px-4 py-16 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M4 6h16M4 12h16M4 18h10" /></svg></div><div className="mt-3 font-bold text-slate-800">No matching records</div><p className="mt-1 text-sm text-slate-500">Try changing your search or status filter.</p></td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {!loading && rows.length > 0 && <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs font-medium text-slate-500"><span>Showing {filtered.length} of {rows.length} records</span><span>Setup data</span></div>}
        </section>
      )}

      {isOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="setup-form-title" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <form onSubmit={save} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6"><div><div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-aqua-700">{editing ? "Update configuration" : "New configuration"}</div><h2 id="setup-form-title" className="mt-1 text-xl font-extrabold text-slate-900">{editing ? "Edit" : "Add"} {config.singular}</h2><p className="mt-1 text-xs text-slate-500">Complete the details below. Fields marked with <span className="text-red-500">*</span> are required.</p></div><button type="button" onClick={close} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-800" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg></button></div>
          <div className="grid overflow-y-auto gap-4 p-5 sm:grid-cols-2 sm:p-6">
            {config.fields.map((field) => <label key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
              {field.type === "checkbox" ? <span className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 transition hover:bg-slate-50"><input type="checkbox" checked={Boolean(form[field.key])} onChange={(event) => setForm({ ...form, [field.key]: event.target.checked })} className="h-5 w-5 rounded border-slate-300 text-aqua-700 focus:ring-aqua-500" /><span className="text-sm font-semibold text-slate-700">{field.label}</span></span> : <><span className="mb-1.5 block text-sm font-semibold text-slate-700">{field.label}{field.required ? <span className="text-red-500"> *</span> : ""}</span>{field.type === "select" ? <SearchableSelect className={input} value={form[field.key] ?? ""} required={field.required} onChange={(event) => {
                const next = { ...form, [field.key]: event.target.value };
                if (field.key === "userId") { const user = lookups.users.find((item) => String(item.userId) === event.target.value); if (user?.phoneNumber && !next.phoneNumber) next.phoneNumber = user.phoneNumber; }
                if (resource === "routes" && field.key === "zoneId" && !editing) next.routeCode = event.target.value ? nextRouteCode(event.target.value) : "";
                setForm(next);
              }}><option value="">Select {field.label.toLowerCase()}</option>{optionsFor(field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SearchableSelect> : field.type === "textarea" ? <textarea className={`${input} min-h-24 resize-y`} value={form[field.key] ?? ""} required={field.required} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} /> : <><input className={`${input} ${resource === "routes" && field.key === "routeCode" && !editing ? "bg-slate-50 font-semibold text-slate-700" : ""}`} type={field.type === "number" ? "number" : "text"} min={field.min} step={field.type === "number" ? "any" : undefined} value={form[field.key] ?? ""} placeholder={resource === "routes" && field.key === "routeCode" && !editing ? "Select a zone to generate" : undefined} required={field.required} readOnly={resource === "routes" && field.key === "routeCode" && !editing} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />{resource === "routes" && field.key === "routeCode" && !editing && <span className="mt-1.5 block text-xs text-slate-500">Generated automatically from the selected zone.</span>}</>}</>}
            </label>)}
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6"><button type="button" onClick={close} disabled={saving} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">Cancel</button><button type="submit" disabled={saving} className="min-w-32 rounded-xl bg-aqua-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-aqua-600 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving..." : editing ? "Save changes" : `Add ${config.singular}`}</button></div>
        </form>
      </div>}
    </main>
  );
}
