import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";
import { exportExcel } from "../lib/meterFiles";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";

type Row = Record<string, any>;
const INPUT = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] leading-5 text-slate-700 outline-none transition focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 disabled:bg-slate-50 disabled:text-slate-400";
const TH = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";

function Page({ title, subtitle, actions, children, className = "" }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5 ${className}`}><div className="page-screen-header mb-4 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">{title}</h1>{subtitle && <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>{children}</div>;
}
function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{title && <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-base font-semibold text-slate-800">{title}</h2></div>}<div className="p-4">{children}</div></section>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium leading-5 text-slate-600">{label}{required && <span className="text-red-500"> *</span>}</span>{children}</label>;
}
function Button({ tone = "blue", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "blue" | "green" | "red" | "slate" | "orange" }) {
  const colors = { blue: "bg-aqua-700 hover:bg-aqua-600", green: "bg-emerald-600 hover:bg-emerald-500", red: "bg-red-600 hover:bg-red-500", slate: "bg-slate-600 hover:bg-slate-500", orange: "bg-orange-500 hover:bg-orange-400" };
  return <button {...props} className={`rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]} ${className}`} />;
}
function LinkButton({ to, children, tone = "blue" }: { to: string; children: ReactNode; tone?: "blue" | "green" | "slate" | "orange" }) {
  const colors = { blue: "bg-aqua-700", green: "bg-emerald-600", slate: "bg-slate-600", orange: "bg-orange-500" };
  return <Link to={to} className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm ${colors[tone]}`}>{children}</Link>;
}
function Notice({ children, tone = "red" }: { children: ReactNode; tone?: "red" | "blue" | "green" }) {
  if (tone !== "blue") return <SweetAlertToast message={children} type={tone === "green" ? "success" : "error"} />;
  const colors = { red: "border-red-200 bg-red-50 text-red-700", blue: "border-blue-200 bg-blue-50 text-blue-700", green: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return <div className={`mb-3 whitespace-pre-line rounded-lg border px-3 py-2 text-sm ${colors[tone]}`}>{children}</div>;
}
const badges: Record<string, string> = { ACTIVE: "bg-emerald-50 text-emerald-700", OPEN: "bg-emerald-50 text-emerald-700", POSTED: "bg-emerald-50 text-emerald-700", PAID: "bg-emerald-50 text-emerald-700", APPROVED: "bg-cyan-50 text-cyan-700", PENDING_APPROVAL: "bg-amber-50 text-amber-700", PENDING: "bg-amber-50 text-amber-700", DRAFT: "bg-slate-100 text-slate-600", CLOSED: "bg-slate-100 text-slate-600", RETURNED: "bg-orange-50 text-orange-700", REJECTED: "bg-red-50 text-red-700", CANCELLED: "bg-red-50 text-red-700", NONE: "bg-slate-100 text-slate-600" };
function pretty(value?: string | null) { return String(value ?? "").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function Badge({ value }: { value?: string | null }) { const key = value ?? "NONE"; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badges[key] ?? "bg-violet-50 text-violet-700"}`}>{pretty(key)}</span>; }
function money(value: any) { return `KSh ${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value?: string) { return value ? new Date(value).toLocaleDateString() : "—"; }
function dateTime(value?: string) { return value ? new Date(value).toLocaleString() : "—"; }
function person(value?: Row) { return value ? `${value.firstName ?? ""} ${value.lastName ?? ""}`.trim() || value.username : "System"; }
function Spinner() { return <div className="flex min-h-40 items-center justify-center text-slate-400"><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />Loading…</div>; }
function Kpi({ label, value, tone = "text-slate-900" }: { label: string; value: ReactNode; tone?: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">{label}</div><div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div></div>; }

function CycleSelect({ cycles, value, onChange, includeBlank = true }: { cycles: Row[]; value: string; onChange: (value: string) => void; includeBlank?: boolean }) {
  return <SearchableSelect className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>{includeBlank && <option value="">Select billing period</option>}{cycles.map((cycle) => <option key={cycle.billingCycleId} value={cycle.billingCycleId}>{cycle.cycleName} · {pretty(cycle.status)}</option>)}</SearchableSelect>;
}

export function BillingDashboard() {
  const [cycles, setCycles] = useState<Row[]>([]); const [cycleId, setCycleId] = useState(""); const [data, setData] = useState<Row | null>(null); const [error, setError] = useState("");
  useEffect(() => { api.listBillingCycles().then((rows) => { setCycles(rows); if (rows[0]) setCycleId(String(rows[0].billingCycleId)); }).catch((e) => setError(e.message)); }, []);
  useEffect(() => { api.billingDashboard(cycleId).then((row) => { setData(row); setError(""); }).catch((e) => setError(e.message)); }, [cycleId]);
  const generated = Number(data?.billsGenerated ?? 0); const approved = Number(data?.approved ?? 0); const readyToPost = Number(data?.readyToPost ?? 0); const notified = Number(data?.notified ?? 0);
  return <Page title="Billing management dashboard" subtitle="Billing progress, approvals, posting, notifications and exceptions" actions={<><LinkButton to="/billing/periods" tone="green">Create billing period</LinkButton><LinkButton to="/billing/generate">Generate bills</LinkButton><LinkButton to="/billing/approvals" tone="orange">Post approved batch ({readyToPost.toLocaleString()})</LinkButton></>}>
    {error && <Notice>{error}</Notice>}<Card className="mb-4"><Field label="Billing period"><CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} /></Field></Card>
    {!data ? <Spinner /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Bills generated" value={generated} /><Kpi label="Pending approval" value={data.pending} tone="text-amber-600" /><Kpi label="Approved / posted" value={approved} tone="text-emerald-700" /><Kpi label="Total current billing" value={money(data.totalBilling)} tone="text-aqua-700" /><Kpi label="Notifications sent" value={notified} /><Kpi label="Pending adjustments" value={data.adjustments} tone="text-orange-600" /><Kpi label="Security alerts" value={data.alerts} tone="text-red-600" /><Kpi label="Cancelled bills" value={data.cancelled} /></div>
      <Card title="Billing progress" className="mt-4"><div className="grid gap-4 md:grid-cols-3">{[["Generated", generated, generated], ["Approved", approved, generated], ["Notifications", notified, generated]].map(([label, count, total]: any) => { const pct = total ? Math.round((count / total) * 100) : 0; return <div key={label}><div className="mb-1 flex justify-between text-sm"><span>{label}</span><strong>{pct}%</strong></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-aqua-600" style={{ width: `${pct}%` }} /></div></div>; })}</div></Card>
      <Card title="Recent billing activity" className="mt-4"><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Date</th><th className={TH}>Bill</th><th className={TH}>Customer</th><th className={TH}>Action</th><th className={TH}>User</th></tr></thead><tbody>{(data.recent ?? []).map((event: Row) => <tr key={event.billingEventId} className="border-t"><td className={TD}>{dateTime(event.createdAt)}</td><td className={TD}>{event.bill?.billNumber ?? "Period"}</td><td className={TD}>{event.customerName ?? "—"}</td><td className={TD}>{pretty(event.eventType)}</td><td className={TD}>{person(event.performer)}</td></tr>)}{!data.recent?.length && <tr><td colSpan={5} className="p-8 text-center text-slate-400">Billing activity will appear here.</td></tr>}</tbody></table></div></Card></>}
  </Page>;
}

export function BillingPeriods() {
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); const due = new Date(now.getFullYear(), now.getMonth() + 1, 10); const penalty = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  const [cycles, setCycles] = useState<Row[]>([]); const [readingCycles, setReadingCycles] = useState<Row[]>([]); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Row>({ cycleCode: `BC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, cycleName: now.toLocaleString(undefined, { month: "long", year: "numeric" }), readingCycleId: "", periodStart: iso(start), periodEnd: iso(end), dueDate: iso(due), penaltyDate: iso(penalty), frequency: "MONTHLY", status: "OPEN", defaultNotification: "SMS_APP", remarks: "" });
  const load = () => Promise.all([api.listBillingCycles(), api.listReadingCycles()]).then(([b, r]) => { setCycles(b); setReadingCycles(r); setError(""); });
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); setError(""); try { await api.createBillingCycle(form); setMessage("Billing period created and linked to the reading cycle."); await load(); setForm({ ...form, cycleCode: "", cycleName: "", readingCycleId: "", remarks: "" }); } catch (e: any) { setError(e.message); } finally { setSaving(false); } }
  async function status(cycle: Row, next: string) { const reason = window.prompt(`Reason for changing ${cycle.cycleCode} to ${next.toLowerCase()}:`); if (!reason) return; try { await api.updateBillingCycleStatus(String(cycle.billingCycleId), next, reason); await load(); } catch (e: any) { setError(e.message); } }
  return <Page title="Billing periods" subtitle="Create, link and control billing periods" actions={<LinkButton to="/billing/generate">Generate bills</LinkButton>}>
    {error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<div className="grid gap-4 xl:grid-cols-[430px_1fr]"><Card title="Create billing period"><form onSubmit={submit} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Period code" required><input required className={INPUT} value={form.cycleCode} onChange={(e) => setForm({ ...form, cycleCode: e.target.value })} /></Field><Field label="Frequency"><SearchableSelect className={INPUT} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option>MONTHLY</option><option>WEEKLY</option><option>CUSTOM</option></SearchableSelect></Field></div><Field label="Period name" required><input required className={INPUT} value={form.cycleName} onChange={(e) => setForm({ ...form, cycleName: e.target.value })} /></Field><Field label="Closed reading cycle" required><SearchableSelect required className={INPUT} value={form.readingCycleId} onChange={(e) => setForm({ ...form, readingCycleId: e.target.value })}><option value="">Select closed cycle</option>{readingCycles.filter((r) => r.status === "CLOSED" && !r.billingCycleId).map((r) => <option key={r.readingCycleId} value={r.readingCycleId}>{r.cycleName} · {r.cycleCode}</option>)}</SearchableSelect></Field><div className="grid grid-cols-2 gap-3"><Field label="Start date" required><input required type="date" className={INPUT} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></Field><Field label="End date" required><input required type="date" className={INPUT} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></Field><Field label="Due date" required><input required type="date" className={INPUT} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field><Field label="Penalty date"><input type="date" className={INPUT} value={form.penaltyDate} onChange={(e) => setForm({ ...form, penaltyDate: e.target.value })} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Initial status"><SearchableSelect className={INPUT} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="DRAFT">Draft</option><option value="OPEN">Open</option></SearchableSelect></Field><Field label="Notifications"><SearchableSelect className={INPUT} value={form.defaultNotification} onChange={(e) => setForm({ ...form, defaultNotification: e.target.value })}><option value="SMS_APP">SMS + App</option><option value="SMS">SMS</option><option value="APP">App</option><option value="EMAIL">Email</option></SearchableSelect></Field></div><Field label="Remarks"><textarea rows={2} className={INPUT} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field><Button disabled={saving || !form.readingCycleId} className="w-full">{saving ? "Creating…" : "Create period"}</Button></form></Card>
      <Card title="Billing period register"><div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr><th className={TH}>Period</th><th className={TH}>Dates</th><th className={TH}>Reading cycle</th><th className={TH}>Bills</th><th className={TH}>Amount</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead><tbody>{cycles.map((c) => <tr key={c.billingCycleId} className="border-t"><td className={TD}><strong className="text-slate-800">{c.cycleName}</strong><div className="text-xs text-slate-400">{c.cycleCode}</div></td><td className={TD}>{date(c.periodStart)} – {date(c.periodEnd)}<div className="text-xs">Due {date(c.dueDate)}</div></td><td className={TD}>{c.readingCycles?.[0]?.cycleCode ?? "—"}</td><td className={TD}>{c._count?.bills ?? 0}</td><td className={TD}>{money(c.totals?.amount)}</td><td className={TD}><Badge value={c.status} /></td><td className={TD}><div className="flex gap-2">{c.status === "DRAFT" && <button className="font-semibold text-emerald-700" onClick={() => status(c, "OPEN")}>Open</button>}{c.status === "POSTED" && <button className="font-semibold text-slate-700" onClick={() => status(c, "CLOSED")}>Close</button>}{["DRAFT", "OPEN"].includes(c.status) && !(c._count?.bills) && <button className="font-semibold text-red-600" onClick={() => status(c, "CANCELLED")}>Cancel</button>}</div></td></tr>)}{!cycles.length && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No billing periods created.</td></tr>}</tbody></table></div></Card></div>
  </Page>;
}

export function BillGeneration() {
  const [cycles, setCycles] = useState<Row[]>([]); const [zones, setZones] = useState<Row[]>([]); const [routes, setRoutes] = useState<Row[]>([]); const [categories, setCategories] = useState<Row[]>([]); const [preview, setPreview] = useState<Row | null>(null); const [previewForm, setPreviewForm] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loadingOptions, setLoadingOptions] = useState(true); const [previewing, setPreviewing] = useState(false); const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Row>({ billingCycleId: "", zoneId: "", routeId: "", categoryId: "", includePreviousBalance: true, includePenalties: true, sendForApproval: true });
  useEffect(() => { Promise.all([api.listBillingCycles(), api.listZones(), api.listRoutes(), api.listCategories()]).then(([c, z, r, cat]) => { setCycles(c); setZones(z); setRoutes(r); setCategories(cat); const open = c.find((x: Row) => ["DRAFT", "OPEN", "PROCESSING", "RETURNED"].includes(x.status)); if (open) setForm((f: Row) => ({ ...f, billingCycleId: String(open.billingCycleId) })); }).catch((e) => setError(e.message)).finally(() => setLoadingOptions(false)); }, []);
  async function runPreview() { if (!form.billingCycleId) return; setPreviewing(true); setError(""); setPreview(null); setPreviewForm(""); try { const result = await api.previewBills(form); setPreview(result); setPreviewForm(JSON.stringify(form)); } catch (e: any) { setError(e.message); } finally { setPreviewing(false); } }
  async function generate() { setSaving(true); setError(""); try { const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "" && value !== undefined && value !== null)); const result = await api.generateBills(payload); setMessage(`${result.generated} bill(s) generated; ${result.issues} account issue(s) require review.`); await runPreview(); } catch (e: any) { setError(e.message); } finally { setSaving(false); } }
  const canGenerate = Boolean(preview?.summary.eligible) && previewForm === JSON.stringify(form);
  return <Page title="Generate customer bills" subtitle="Validate approved readings and active tariffs before bill generation" actions={<><Button tone="green" onClick={generate} disabled={!canGenerate || saving || previewing}>{saving ? "Generating…" : "Generate eligible bills"}</Button><LinkButton to="/billing/approvals">Bill approval</LinkButton></>}>
    {error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<Card title="Generation filters" className="mb-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><Field label="Billing period" required><CycleSelect cycles={cycles.filter((c) => ["DRAFT", "OPEN", "PROCESSING", "RETURNED"].includes(c.status))} value={form.billingCycleId} onChange={(value) => setForm({ ...form, billingCycleId: value })} /></Field><Field label="Zone"><SearchableSelect className={INPUT} value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value, routeId: "" })}><option value="">All zones</option>{zones.map((z) => <option key={z.zoneId} value={z.zoneId}>{z.zoneName}</option>)}</SearchableSelect></Field><Field label="Route"><SearchableSelect className={INPUT} value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })}><option value="">All routes</option>{routes.filter((r) => !form.zoneId || String(r.zoneId) === form.zoneId).map((r) => <option key={r.routeId} value={r.routeId}>{r.routeName}</option>)}</SearchableSelect></Field><Field label="Customer category"><SearchableSelect className={INPUT} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">All categories</option>{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}</SearchableSelect></Field><div className="flex items-end"><Button className="w-full" onClick={runPreview} disabled={loadingOptions || previewing || saving || !form.billingCycleId}>{previewing ? <span className="inline-flex items-center"><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />Loading preview…</span> : "Preview bills"}</Button></div></div><div className="mt-3 flex flex-wrap gap-5 text-sm text-slate-600">{[["includePreviousBalance", "Include previous balance"], ["includePenalties", "Include configured penalties"], ["sendForApproval", "Send generated bills for approval"]].map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{label}</label>)}</div></Card>
    {(loadingOptions || previewing) && <Card className="mb-4"><Spinner /></Card>}{preview && <><div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Kpi label="Accounts" value={preview.summary.accounts} /><Kpi label="Eligible" value={preview.summary.eligible} tone="text-emerald-700" /><Kpi label="Approved readings" value={preview.summary.approvedReadings} /><Kpi label="Missing readings" value={preview.summary.missingReadings} tone="text-orange-600" /><Kpi label="Missing tariffs" value={preview.summary.missingTariffs} tone="text-red-600" /><Kpi label="Preview total" value={money(preview.summary.totalAmount)} tone="text-aqua-700" /></div><Card title="Bill preview"><div className="overflow-x-auto"><table className="w-full min-w-[980px]"><thead><tr><th className={TH}>Account / Customer</th><th className={TH}>Meter</th><th className={TH}>Units</th><th className={TH}>Tariff</th><th className={TH}>Water</th><th className={TH}>Fixed charges</th><th className={TH}>Previous</th><th className={TH}>Total due</th><th className={TH}>Validation</th></tr></thead><tbody>{preview.rows.map((row: Row) => <tr key={row.accountId} className="border-t"><td className={TD}><strong>{row.accountNumber}</strong><div className="text-xs">{row.customerName}</div></td><td className={TD}>{row.meterNumber ?? "—"}</td><td className={TD}>{Number(row.consumption).toLocaleString()}</td><td className={TD}>{row.tariffName ?? "—"}</td><td className={TD}>{money(row.calculation?.consumptionCharge)}</td><td className={TD}>{money(row.calculation?.fixedCharges)}</td><td className={TD}>{money(row.previousBalance)}</td><td className={`${TD} font-semibold text-slate-900`}>{money(row.totalAmountDue)}</td><td className={TD}><Badge value={row.issue === "NONE" ? "PASSED" : row.issue} /></td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap justify-end gap-2"><Button tone="slate" onClick={() => exportExcel("bill-preview.xlsx", "Bill Preview", preview.rows)}>Export preview</Button><Button tone="green" disabled={saving || previewing || !canGenerate} onClick={generate}>{saving ? "Generating…" : "Generate eligible bills"}</Button></div></Card></>}
  </Page>;
}

export function BillApprovals() {
  const [cycles, setCycles] = useState<Row[]>([]); const [cycleId, setCycleId] = useState(""); const [search, setSearch] = useState(""); const [bills, setBills] = useState<Row[]>([]); const [processed, setProcessed] = useState<Row[]>([]); const [selected, setSelected] = useState<string[]>([]); const [focus, setFocus] = useState<Row | null>(null); const [comments, setComments] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(true); const [acting, setActing] = useState<"APPROVE" | "REJECT" | "RETURN" | "">(""); const [posting, setPosting] = useState(false);
  const refreshCycles = async (preferred = cycleId) => { const rows = await api.listBillingCycles(); setCycles(rows); const target = rows.find((x: Row) => String(x.billingCycleId) === preferred) ?? rows.find((x: Row) => x.status === "PENDING_APPROVAL") ?? rows[0]; if (target) setCycleId(String(target.billingCycleId)); };
  const load = async (idValue = cycleId, searchValue = search) => { setLoading(true); try { const filters = { billingCycleId: idValue, search: searchValue }; const [pendingRows, allRows] = await Promise.all([api.listBills({ ...filters, status: "PENDING_APPROVAL" }), api.listBills(filters)]); setBills(pendingRows); setProcessed(allRows.filter((bill: Row) => bill.status !== "PENDING_APPROVAL")); setFocus(pendingRows[0] ?? null); setSelected([]); setError(""); } finally { setLoading(false); } };
  useEffect(() => { refreshCycles("").catch((e) => { setError(e.message); setLoading(false); }); }, []);
  useEffect(() => { if (cycleId) load().catch((e) => setError(e.message)); }, [cycleId, search]);
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") { if (!selected.length || comments.trim().length < 3) return setError("Select at least one bill and enter approval comments."); setActing(decision); setError(""); try { const result = await api.decideBills(selected, decision, comments); setMessage(`${result.updated} bill(s) changed to ${pretty(result.status)}.`); setComments(""); await Promise.all([load(), refreshCycles(cycleId)]); } catch (e: any) { setError(e.message); } finally { setActing(""); } }
  async function post() { const reason = window.prompt("Posting reason:", "Approved billing batch verified and posted to customer accounts"); if (!reason) return; setPosting(true); setError(""); try { const result = await api.postBillingCycle(cycleId, reason); setMessage(`${result.posted} approved bill(s) posted to customer accounts.`); await Promise.all([load(), refreshCycles(cycleId)]); } catch (e: any) { setError(e.message); } finally { setPosting(false); } }
  const approvedCount = processed.filter((bill) => bill.status === "APPROVED").length;
  const selectedBills = bills.filter((bill) => selected.includes(String(bill.billId)));
  const decisionBill = selectedBills.length === 1 ? selectedBills[0] : focus;
  const selectedUnits = selectedBills.reduce((sum, bill) => sum + Number(bill.consumptionUnits ?? 0), 0);
  const selectedAmount = selectedBills.reduce((sum, bill) => sum + Number(bill.totalAmountDue ?? 0), 0);
  const decisionDisabled = Boolean(acting) || comments.trim().length < 3 || !selectedBills.length;
  const commentEditor = <><Field label={selectedBills.length > 1 ? `Shared approval comment for ${selectedBills.length} bills` : "Approval comments"} required><textarea rows={3} className={`${INPUT} mt-3`} value={comments} onChange={(e) => setComments(e.target.value)} disabled={Boolean(acting)} /></Field>{selectedBills.length > 1 && <p className="mt-1 text-xs text-slate-500">This same comment and decision will be recorded against every selected bill.</p>}</>;
  const decisionControls = <div className="mt-3 flex flex-wrap justify-end gap-2"><Button tone="red" disabled={decisionDisabled} onClick={() => decide("REJECT")}>{acting === "REJECT" ? "Rejecting…" : "Reject"}</Button><Button tone="orange" disabled={decisionDisabled} onClick={() => decide("RETURN")}>{acting === "RETURN" ? "Returning…" : "Return"}</Button><Button tone="green" disabled={decisionDisabled} onClick={() => decide("APPROVE")}>{acting === "APPROVE" ? "Approving…" : `Approve selected${selectedBills.length > 1 ? ` (${selectedBills.length})` : ""}`}</Button></div>;
  const decisionContent = loading ? <Spinner /> : selectedBills.length > 1 ? <><div className="rounded-xl bg-aqua-50 p-4"><h3 className="font-bold text-slate-900">{selectedBills.length} bills selected</h3><p className="mt-1 text-sm text-slate-600">Review the batch below, then enter one comment for the whole selection.</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><span className="text-slate-500">Combined consumption</span><strong className="block">{selectedUnits.toLocaleString()} units</strong></div><div><span className="text-slate-500">Combined total due</span><strong className="block">{money(selectedAmount)}</strong></div></div></div><div className="my-3 max-h-52 divide-y overflow-y-auto rounded-lg border">{selectedBills.map((bill) => <button type="button" key={bill.billId} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setFocus(bill)}><span><strong className="block text-slate-800">{bill.billNumber}</strong><span className="text-xs text-slate-500">{bill.customerName} · {bill.account.accountNumber}</span></span><strong className="whitespace-nowrap text-slate-700">{money(bill.totalAmountDue)}</strong></button>)}</div>{commentEditor}{decisionControls}</> : decisionBill ? <><div className="rounded-xl bg-slate-50 p-4"><div className="flex justify-between"><div><h3 className="font-bold text-slate-900">{decisionBill.billNumber}</h3><p className="text-sm text-slate-500">{decisionBill.customerName} · {decisionBill.account.accountNumber}</p></div><Badge value={decisionBill.exceptionType === "NONE" ? "PASSED" : decisionBill.exceptionType} /></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><span className="text-slate-500">Consumption</span><strong className="block">{decisionBill.consumptionUnits} units</strong></div><div><span className="text-slate-500">Tariff</span><strong className="block">{decisionBill.tariff.tariffName}</strong></div><div><span className="text-slate-500">Current charges</span><strong className="block">{money(decisionBill.totalCurrentCharges)}</strong></div><div><span className="text-slate-500">Total due</span><strong className="block">{money(decisionBill.totalAmountDue)}</strong></div></div></div><div className="mt-3 space-y-2">{(decisionBill.items ?? []).map((item: Row) => <div key={item.billItemId} className="flex justify-between rounded-lg border px-3 py-2 text-sm"><span>{item.description}</span><strong>{money(item.amount)}</strong></div>)}</div>{selectedBills.length === 1 ? <>{commentEditor}{decisionControls}</> : <Notice tone="blue">Select this bill using its checkbox before making an approval decision.</Notice>}</> : <div className="py-10 text-center text-slate-400">Select a bill to review.</div>;
  return <Page title="Bill approval" subtitle="Maker-checker review of generated bills and exceptions" actions={<Button tone="green" onClick={post} disabled={!cycleId || approvedCount === 0 || posting || loading}>{posting ? `Posting ${approvedCount.toLocaleString()} bill(s)…` : `Post approved batch (${approvedCount.toLocaleString()})`}</Button>}>
    {error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<Card className="mb-4"><div className="grid gap-4 md:grid-cols-2"><Field label="Billing period"><CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} /></Field><Field label="Search bills"><input type="search" className={INPUT} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill number, account, or customer name" aria-label="Search bills" /></Field></div></Card><div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]"><Card title={`${bills.length} pending bill(s)`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}><input type="checkbox" checked={bills.length > 0 && selected.length === bills.length} onChange={(e) => setSelected(e.target.checked ? bills.map((b) => String(b.billId)) : [])} /></th><th className={TH}>Bill / Customer</th><th className={TH}>Units</th><th className={TH}>Amount</th><th className={TH}>Exception</th><th className={TH}>Action</th></tr></thead><tbody>{loading && <tr><td colSpan={6} className="p-8"><Spinner /></td></tr>}{!loading && bills.map((bill) => <tr key={bill.billId} className="border-t"><td className={TD}><input type="checkbox" checked={selected.includes(String(bill.billId))} onChange={(e) => setSelected(e.target.checked ? [...selected, String(bill.billId)] : selected.filter((id) => id !== String(bill.billId)))} /></td><td className={TD}><strong>{bill.billNumber}</strong><div className="text-xs">{bill.customerName}</div></td><td className={TD}>{Number(bill.consumptionUnits).toLocaleString()}</td><td className={TD}>{money(bill.totalAmountDue)}</td><td className={TD}><Badge value={bill.exceptionType === "NONE" ? "PASSED" : bill.exceptionType} /></td><td className={TD}><button className="font-semibold text-aqua-700" onClick={() => setFocus(bill)}>Review</button></td></tr>)}{!loading && !bills.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No bills await approval.</td></tr>}</tbody></table></div></Card><Card title="Approval decision">{decisionContent}</Card></div>
    <Card title="Approved and processed bills" className="mt-4"><div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr><th className={TH}>Bill / Customer</th><th className={TH}>Amount</th><th className={TH}>Approved by</th><th className={TH}>Posted by</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead><tbody>{processed.map((bill) => <tr key={bill.billId} className="border-t"><td className={TD}><strong>{bill.billNumber}</strong><div className="text-xs">{bill.customerName} · {bill.account.accountNumber}</div></td><td className={`${TD} font-semibold`}>{money(bill.totalAmountDue)}</td><td className={TD}>{person(bill.approver)}</td><td className={TD}>{bill.poster ? person(bill.poster) : "—"}</td><td className={TD}><Badge value={bill.status} /></td><td className={TD}><Link className="font-semibold text-aqua-700" to={`/billing/invoices/${bill.billId}`}>View invoice</Link></td></tr>)}{!processed.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">Approved, returned, rejected and posted bills will remain visible here.</td></tr>}</tbody></table></div></Card>
  </Page>;
}

export function InvoiceRegister() {
  const [cycles, setCycles] = useState<Row[]>([]); const [cycleId, setCycleId] = useState(""); const [status, setStatus] = useState(""); const [search, setSearch] = useState(""); const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState("");
  useEffect(() => { api.listBillingCycles().then(setCycles); }, []); useEffect(() => { api.listBills({ billingCycleId: cycleId, status, search }).then((value) => { setRows(value); setError(""); }).catch((e) => setError(e.message)); }, [cycleId, status, search]);
  return <Page title="Invoice register" subtitle="Search, print and share customer water bills" actions={<Button tone="green" onClick={() => exportExcel("invoice-register.xlsx", "Invoices", rows.map((b) => ({ Bill: b.billNumber, Account: b.account.accountNumber, Customer: b.customerName, Period: b.billingCycle.cycleName, Amount: Number(b.totalAmountDue), Status: b.status })))}>Export register</Button>}>
    {error && <Notice>{error}</Notice>}<Card className="mb-4"><div className="grid gap-3 md:grid-cols-3"><Field label="Billing period"><CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} /></Field><Field label="Status"><SearchableSelect className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED"].map((x) => <option key={x}>{x}</option>)}</SearchableSelect></Field><Field label="Search"><input className={INPUT} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill, account or customer" /></Field></div></Card><Card title={`${rows.length} invoice(s)`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Bill</th><th className={TH}>Customer account</th><th className={TH}>Period</th><th className={TH}>Issue / Due</th><th className={TH}>Amount due</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead><tbody>{rows.map((bill) => <tr key={bill.billId} className="border-t"><td className={`${TD} font-semibold`}>{bill.billNumber}</td><td className={TD}>{bill.account.accountNumber}<div className="text-xs">{bill.customerName}</div></td><td className={TD}>{bill.billingCycle.cycleName}</td><td className={TD}>{date(bill.issueDate)}<div className="text-xs">Due {date(bill.dueDate)}</div></td><td className={`${TD} font-semibold`}>{money(bill.totalAmountDue)}</td><td className={TD}><Badge value={bill.status} /></td><td className={TD}><Link className="font-semibold text-aqua-700" to={`/billing/invoices/${bill.billId}`}>View invoice</Link></td></tr>)}</tbody></table></div></Card>
  </Page>;
}

export function BillInvoice() {
  const { id = "" } = useParams(); const [bill, setBill] = useState<Row | null>(null); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { api.getBill(id).then(setBill).catch((e) => setError(e.message)); }, [id]);
  async function notify(channel: string) { if (!bill) return; try { await api.sendBillNotifications({ billingCycleId: bill.billingCycleId, billIds: [bill.billId], channels: [channel] }); setMessage(`${channel} notification recorded as sent.`); } catch (e: any) { setError(e.message); } }
  function printInvoice() {
    const cleanup = () => document.body.classList.remove("printing-invoice");
    document.body.classList.add("printing-invoice");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }
  if (!bill) return <Page title="Customer water bill" subtitle="Invoice details">{error ? <Notice>{error}</Notice> : <Spinner />}</Page>;
  return <Page className="invoice-print-page" title="Customer water bill / invoice" subtitle={`${bill.billNumber} · ${bill.account.accountNumber}`} actions={<><Button tone="slate" onClick={printInvoice}>Print / Save PDF</Button><Button onClick={() => notify("SMS")}>Send SMS</Button><Button tone="green" onClick={() => notify("EMAIL")}>Send email</Button></>}>
    {error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<Card className="invoice-print-document mx-auto max-w-4xl"><div className="border-b pb-4"><div className="flex flex-wrap items-start justify-between gap-4"><img src="/samdamte-water-logo-print.png" alt="Samdamte Water Utility Management" className="invoice-brand-logo h-auto w-[280px] max-w-[55%] object-contain" /><div className="text-right"><div className="text-xl font-bold">WATER BILL</div><div>{bill.billNumber}</div><Badge value={bill.status} /></div></div></div><div className="grid gap-4 border-b py-4 md:grid-cols-2"><div><h3 className="mb-2 font-semibold">Bill to</h3><div>{bill.customerName}</div><div>{bill.account.accountNumber}</div><div>{bill.account.property.physicalAddress}</div><div>{bill.account.property.zone.zoneName}</div></div><div className="grid grid-cols-2 gap-2 text-sm"><span className="text-slate-500">Period</span><strong>{bill.billingCycle.cycleName}</strong><span className="text-slate-500">Invoice date</span><strong>{date(bill.issueDate)}</strong><span className="text-slate-500">Due date</span><strong>{date(bill.dueDate)}</strong><span className="text-slate-500">Meter</span><strong>{bill.reading?.meter?.meterNumber ?? "Flat billing"}</strong></div></div>{bill.reading && <div className="grid grid-cols-3 gap-3 border-b py-4 text-center"><div><span className="text-sm text-slate-500">Previous reading</span><strong className="block text-xl">{bill.reading.previousReading}</strong></div><div><span className="text-sm text-slate-500">Current reading</span><strong className="block text-xl">{bill.reading.currentReading}</strong></div><div><span className="text-sm text-slate-500">Consumption</span><strong className="block text-xl text-aqua-700">{bill.consumptionUnits} units</strong></div></div>}<div className="py-4"><table className="w-full"><thead><tr><th className={TH}>Description</th><th className={TH}>Quantity</th><th className={TH}>Rate</th><th className={`${TH} text-right`}>Amount</th></tr></thead><tbody>{bill.items.map((item: Row) => <tr key={item.billItemId} className="border-t"><td className={TD}>{item.description}</td><td className={TD}>{item.quantity}</td><td className={TD}>{money(item.unitRate)}</td><td className={`${TD} text-right font-semibold`}>{money(item.amount)}</td></tr>)}</tbody></table></div><div className="ml-auto max-w-md space-y-2 border-t pt-4 text-sm">{[["Previous balance", bill.previousBalance], ["Current water charges", bill.consumptionCharge], ["Fixed charges", bill.fixedCharges], ["Penalties", bill.penalties], ["Adjustments", bill.adjustmentAmount]].map(([label, value]) => <div key={String(label)} className="flex justify-between"><span>{label}</span><strong>{money(value)}</strong></div>)}<div className="flex justify-between border-t pt-3 text-xl"><strong>Total amount due</strong><strong className="text-aqua-700">{money(bill.totalAmountDue)}</strong></div></div></Card>
  </Page>;
}

function LegacyCustomerStatements() {
  const [bills, setBills] = useState<Row[]>([]); const [accountId, setAccountId] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [statement, setStatement] = useState<Row | null>(null); const [error, setError] = useState("");
  useEffect(() => { api.listBills().then((rows) => { setBills(rows); if (rows[0]) setAccountId(String(rows[0].accountId)); }); }, []); const accounts = useMemo(() => Array.from(new Map(bills.map((b) => [String(b.accountId), b])).values()), [bills]);
  async function load() { try { setStatement(await api.getCustomerStatement(accountId, from, to)); setError(""); } catch (e: any) { setError(e.message); } } useEffect(() => { if (accountId) load(); }, [accountId]);
  return <Page title="Customer statements" subtitle="Debits, payments and running account balances" actions={<>{statement && <Button tone="slate" onClick={() => window.print()}>Print / Save PDF</Button>}<Button tone="green" disabled={!statement} onClick={() => statement && exportExcel("customer-statement.xlsx", "Statement", statement.entries)}>Export Excel</Button></>}>
    {error && <Notice>{error}</Notice>}<Card className="mb-4"><div className="grid gap-3 md:grid-cols-4"><Field label="Customer account"><SearchableSelect className={INPUT} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Select account</option>{accounts.map((b: Row) => <option key={b.accountId} value={b.accountId}>{b.account.accountNumber} · {b.customerName}</option>)}</SearchableSelect></Field><Field label="From"><input type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} /></Field><div className="flex items-end"><Button className="w-full" onClick={load} disabled={!accountId}>Load statement</Button></div></div></Card>{statement && <Card title={`${statement.account.customerName} · ${statement.account.accountNumber}`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Date</th><th className={TH}>Description</th><th className={TH}>Debit</th><th className={TH}>Credit</th><th className={TH}>Balance</th></tr></thead><tbody>{statement.entries.map((entry: Row) => <tr key={entry.id} className="border-t"><td className={TD}>{date(entry.date)}</td><td className={TD}>{entry.description}</td><td className={TD}>{entry.debit ? money(entry.debit) : "—"}</td><td className={TD}>{entry.credit ? money(entry.credit) : "—"}</td><td className={`${TD} font-semibold`}>{money(entry.balance)}</td></tr>)}{!statement.entries.length && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No posted transactions in this date range.</td></tr>}</tbody></table></div><div className="mt-4 flex justify-end text-lg"><span className="mr-5">Closing balance</span><strong>{money(statement.closingBalance)}</strong></div></Card>}
  </Page>;
}

function CustomerStatementsOld() {
  const now = new Date();
  const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const [bills, setBills] = useState<Row[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localDate(now));
  const [statement, setStatement] = useState<Row | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [error, setError] = useState("");
  const accounts = useMemo(
    () => Array.from(new Map(bills.map((bill) => [String(bill.accountId), bill])).values()),
    [bills],
  );

  useEffect(() => {
    api.listBills()
      .then((rows) => {
        setBills(rows);
        if (rows[0]) setAccountId(String(rows[0].accountId));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingAccounts(false));
  }, []);

  async function load(selectedAccountId = accountId) {
    if (!selectedAccountId) return;
    setLoadingStatement(true);
    setError("");
    try {
      setStatement(await api.getCustomerStatement(selectedAccountId, from, to));
    } catch (e: any) {
      setError(e.message);
      setStatement(null);
    } finally {
      setLoadingStatement(false);
    }
  }

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);

  function printStatement() {
    const cleanup = () => document.body.classList.remove("printing-statement");
    document.body.classList.add("printing-statement");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  function exportStatement() {
    if (!statement) return;
    const rows = [
      { Date: from, Description: "Opening balance", Debit: 0, Credit: 0, Balance: statement.openingBalance },
      ...statement.entries.map((entry: Row) => ({
        Date: entry.date,
        Description: entry.description,
        Debit: entry.debit,
        Credit: entry.credit,
        Balance: entry.balance,
      })),
      { Date: to, Description: "Period totals", Debit: statement.totalDebits, Credit: statement.totalCredits, Balance: "" },
      { Date: to, Description: "Closing balance", Debit: 0, Credit: 0, Balance: statement.closingBalance },
    ];
    exportExcel(`statement-${statement.account.accountNumber}-${from}-to-${to}.xlsx`, "Statement", rows);
  }

  return <Page className="statement-print-page" title="Customer statements" subtitle="A reconciled record of opening balance, charges, payments and closing balance" actions={<>
    <Button tone="slate" disabled={!statement || loadingStatement} onClick={printStatement}>Print / Save PDF</Button>
    <Button tone="green" disabled={!statement || loadingStatement} onClick={exportStatement}>Export Excel</Button>
  </>}>
    {error && <Notice>{error}</Notice>}
    <Card className="statement-screen-filters mb-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Customer account">
          <SearchableSelect className={INPUT} disabled={loadingAccounts} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{loadingAccounts ? "Loading accounts..." : "Select account"}</option>
            {accounts.map((bill: Row) => <option key={bill.accountId} value={bill.accountId}>{bill.account.accountNumber} · {bill.customerName}</option>)}
          </SearchableSelect>
        </Field>
        <Field label="From"><input type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex items-end"><Button className="w-full" onClick={() => load()} disabled={!accountId || loadingStatement}>{loadingStatement ? "Loading statement..." : "Load statement"}</Button></div>
      </div>
    </Card>
    {loadingStatement && !statement ? <Card><Spinner /></Card> : statement && <Card className="statement-print-document">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <img src="/samdamte-water-logo-print.png" alt="Samdamte Water Utility Management" className="statement-brand-logo h-auto w-[260px] max-w-[55%] object-contain" />
          <div className="text-right">
            <div className="text-xl font-bold text-slate-900">CUSTOMER STATEMENT</div>
            <div className="mt-1 text-sm text-slate-500">{date(`${from}T00:00:00.000Z`)} – {date(`${to}T00:00:00.000Z`)}</div>
          </div>
        </div>
        <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{statement.account.customerName}</div>
            <div>Account {statement.account.accountNumber}</div>
            <div>{statement.account.property?.physicalAddress}</div>
          </div>
          <div className="md:text-right">
            <div><span className="text-slate-500">Category:</span> {statement.account.category?.categoryName ?? "—"}</div>
            <div><span className="text-slate-500">Zone:</span> {statement.account.property?.zone?.zoneName ?? "—"}</div>
            <div><span className="text-slate-500">Account status:</span> {pretty(statement.account.accountStatus)}</div>
          </div>
        </div>
      </div>
      <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Opening balance" value={money(statement.openingBalance)} />
        <Kpi label="Period debits" value={money(statement.totalDebits)} tone="text-red-700" />
        <Kpi label="Period credits" value={money(statement.totalCredits)} tone="text-emerald-700" />
        <Kpi label="Closing balance" value={money(statement.closingBalance)} tone="text-aqua-700" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead><tr><th className={TH}>Date</th><th className={TH}>Description / reference</th><th className={`${TH} text-right`}>Debit</th><th className={`${TH} text-right`}>Credit</th><th className={`${TH} text-right`}>Balance</th></tr></thead>
          <tbody>
            <tr className="border-t bg-slate-50"><td className={TD}>{date(`${from}T00:00:00.000Z`)}</td><td className={`${TD} font-semibold text-slate-800`}>Balance brought forward</td><td className={`${TD} text-right`}>—</td><td className={`${TD} text-right`}>—</td><td className={`${TD} text-right font-bold`}>{money(statement.openingBalance)}</td></tr>
            {statement.entries.map((entry: Row) => <tr key={entry.id} className="border-t"><td className={TD}>{date(entry.date)}</td><td className={TD}>{entry.description}</td><td className={`${TD} text-right`}>{entry.debit ? money(entry.debit) : "—"}</td><td className={`${TD} text-right`}>{entry.credit ? money(entry.credit) : "—"}</td><td className={`${TD} text-right font-semibold`}>{money(entry.balance)}</td></tr>)}
            {!statement.entries.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No transactions occurred during this period. The closing balance is the balance brought forward.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50"><td colSpan={2} className={`${TD} font-bold text-slate-800`}>Period totals</td><td className={`${TD} text-right font-bold`}>{money(statement.totalDebits)}</td><td className={`${TD} text-right font-bold`}>{money(statement.totalCredits)}</td><td className={`${TD} text-right font-bold text-aqua-700`}>{money(statement.closingBalance)}</td></tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
        <span className="text-slate-500">Opening balance + debits − credits = closing balance</span>
        <div className="text-lg"><span className="mr-4">Amount due / (credit)</span><strong className={Number(statement.closingBalance) > 0 ? "text-red-700" : "text-emerald-700"}>{money(statement.closingBalance)}</strong></div>
      </div>
    </Card>}
  </Page>;
}

export function CustomerStatements() {
  const now = new Date();
  const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const [bills, setBills] = useState<Row[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localDate(now));
  const [statement, setStatement] = useState<Row | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [error, setError] = useState("");
  const accounts = useMemo(
    () => Array.from(new Map(bills.map((bill) => [String(bill.accountId), bill])).values()),
    [bills],
  );

  useEffect(() => {
    api.listBills()
      .then((rows) => {
        setBills(rows);
        if (rows[0]) setAccountId(String(rows[0].accountId));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingAccounts(false));
  }, []);

  async function load(selectedAccountId = accountId) {
    if (!selectedAccountId) return;
    setLoadingStatement(true);
    setError("");
    try {
      setStatement(await api.getCustomerStatement(selectedAccountId, from, to));
    } catch (e: any) {
      setError(e.message);
      setStatement(null);
    } finally {
      setLoadingStatement(false);
    }
  }

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);

  function printStatement() {
    const cleanup = () => document.body.classList.remove("printing-statement");
    document.body.classList.add("printing-statement");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  function exportStatement() {
    if (!statement) return;
    const rows = [
      { "#": "", Date: from, Particulars: "Opening balance", Reference: "", Period: "", Details: "", Credits: 0, Debits: 0, Balance: statement.openingBalance },
      ...statement.entries.map((entry: Row, index: number) => ({
        "#": index + 1,
        Date: entry.date,
        Particulars: entry.particulars,
        Reference: entry.reference,
        Period: entry.period,
        Details: entry.details,
        Credits: entry.credit,
        Debits: entry.debit,
        Balance: entry.balance,
      })),
      { "#": "", Date: to, Particulars: "Total", Reference: "", Period: "", Details: "", Credits: statement.totalCredits, Debits: statement.totalDebits, Balance: statement.closingBalance },
    ];
    exportExcel(`statement-${statement.account.accountNumber}-${from}-to-${to}.xlsx`, "Statement", rows);
  }

  const printedAt = new Date();
  const utilityAddress = statement
    ? [statement.utility.physicalAddress, statement.utility.postalAddress, statement.utility.postalCode].filter(Boolean).join(", ")
    : "";

  return <Page className="statement-print-page" title="Customer statements" subtitle="A reconciled record of opening balance, charges, payments and closing balance" actions={<>
    <Button tone="slate" disabled={!statement || loadingStatement} onClick={printStatement}>Print / Save PDF</Button>
    <Button tone="green" disabled={!statement || loadingStatement} onClick={exportStatement}>Export Excel</Button>
  </>}>
    {error && <Notice>{error}</Notice>}
    <Card className="statement-screen-filters mb-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Customer account">
          <SearchableSelect className={INPUT} disabled={loadingAccounts || loadingStatement} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{loadingAccounts ? "Loading accounts..." : "Select account"}</option>
            {accounts.map((bill: Row) => <option key={bill.accountId} value={bill.accountId}>{bill.account.accountNumber} - {bill.customerName}</option>)}
          </SearchableSelect>
        </Field>
        <Field label="From"><input type="date" className={INPUT} disabled={loadingStatement} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={INPUT} disabled={loadingStatement} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex items-end">
          <Button className="flex w-full items-center justify-center gap-2" onClick={() => load()} disabled={!accountId || loadingStatement}>
            {loadingStatement && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {loadingStatement ? "Loading statement..." : "Load statement"}
          </Button>
        </div>
      </div>
    </Card>

    {loadingStatement && !statement ? <Card><Spinner /></Card> : statement && <Card className="statement-print-document relative">
      {loadingStatement && <div className="statement-loading-overlay absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-white/75 pt-24 backdrop-blur-[1px]">
        <div className="flex items-center gap-3 rounded-xl border bg-white px-5 py-3 font-semibold text-slate-700 shadow-lg">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-aqua-200 border-t-aqua-700" aria-hidden />
          Refreshing statement...
        </div>
      </div>}

      <div className="statement-letterhead grid items-center gap-5 border-b-[3px] border-aqua-800 pb-4 md:grid-cols-[1fr_300px]">
        <img src="/samdamte-water-logo-print.png" alt={statement.utility.name} className="statement-brand-logo h-auto max-h-32 w-full max-w-[300px] object-contain object-left" />
        <div className="statement-utility-contact border-l border-slate-300 pl-5 text-sm leading-6">
          {statement.utility.phone && <div><strong>Tel:</strong> {statement.utility.phone}{statement.utility.secondaryPhone ? ` / ${statement.utility.secondaryPhone}` : ""}</div>}
          {statement.utility.email && <div><strong>Email:</strong> {statement.utility.email}</div>}
          {utilityAddress && <div><strong>Address:</strong> {utilityAddress}</div>}
          <div className="mt-1 text-xs text-slate-500"><strong>Printed:</strong> {printedAt.toLocaleString()}</div>
        </div>
      </div>

      <h2 className="statement-title my-5 text-center text-2xl font-black uppercase tracking-wide text-slate-950">Account Statement</h2>

      <div className="statement-account-grid mb-5 grid gap-x-12 gap-y-2 text-sm md:grid-cols-2">
        <div className="grid grid-cols-[130px_1fr] gap-y-2">
          <strong>To:</strong><span>{statement.account.customerName}</span>
          <strong>Mobile:</strong><span>{statement.account.phone || "-"}</span>
          <strong>Email:</strong><span>{statement.account.email || "-"}</span>
          <strong>Account status:</strong><span>{pretty(statement.account.status)}</span>
          <strong>Meter number:</strong><span>{statement.account.meterNumber || "-"}</span>
        </div>
        <div className="grid grid-cols-[130px_1fr] gap-y-2">
          <strong>Account:</strong><span>{statement.account.accountNumber}</span>
          <strong>Zone:</strong><span>{statement.account.zone || "-"}</span>
          <strong>Route:</strong><span>{statement.account.route || "-"}</span>
          <strong>Tariff:</strong><span>{statement.account.tariff || statement.account.category || "-"}</span>
        </div>
      </div>

      <div className="statement-period mb-3 flex flex-wrap justify-between gap-2 border-y border-slate-200 py-2 text-xs">
        <span><strong>Statement period:</strong> {date(`${from}T00:00:00.000Z`)} - {date(`${to}T00:00:00.000Z`)}</span>
        {statement.account.address && <span><strong>Service address:</strong> {statement.account.address}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="statement-ledger w-full min-w-[980px]">
          <thead><tr>
            <th className={TH}>#</th>
            <th className={TH}>Date</th>
            <th className={TH}>Particulars</th>
            <th className={TH}>Period</th>
            <th className={TH}>Details</th>
            <th className={`${TH} text-right`}>Credits</th>
            <th className={`${TH} text-right`}>Debits</th>
            <th className={`${TH} text-right`}>Balance</th>
          </tr></thead>
          <tbody>
            <tr className="border-b border-slate-300">
              <td className={TD} />
              <td className={TD} />
              <td className={`${TD} font-bold`} colSpan={3}>Opening balance</td>
              <td className={`${TD} text-right`}>-</td>
              <td className={`${TD} text-right`}>-</td>
              <td className={`${TD} text-right font-bold`}>{money(statement.openingBalance)}</td>
            </tr>
            {statement.entries.map((entry: Row, index: number) => <tr key={entry.id} className="border-b border-slate-200 align-top">
              <td className={TD}>{index + 1}</td>
              <td className={`${TD} whitespace-nowrap`}>{date(entry.date)}</td>
              <td className={TD}><div className="font-semibold">{entry.particulars}</div><div className="text-xs text-slate-500">{entry.reference}</div></td>
              <td className={`${TD} whitespace-nowrap`}>{entry.period || "-"}</td>
              <td className={`${TD} max-w-[360px]`}>{entry.details || "-"}</td>
              <td className={`${TD} whitespace-nowrap text-right`}>{entry.credit ? money(entry.credit) : "-"}</td>
              <td className={`${TD} whitespace-nowrap text-right`}>{entry.debit ? money(entry.debit) : "-"}</td>
              <td className={`${TD} whitespace-nowrap text-right font-semibold`}>{money(entry.balance)}</td>
            </tr>)}
            {!statement.entries.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No posted transactions in this date range. The closing balance equals the opening balance.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-900">
              <td colSpan={5} className={`${TD} text-right text-base font-black`}>Total</td>
              <td className={`${TD} whitespace-nowrap text-right font-black`}>{money(statement.totalCredits)}</td>
              <td className={`${TD} whitespace-nowrap text-right font-black`}>{money(statement.totalDebits)}</td>
              <td className={`${TD} whitespace-nowrap text-right font-black`}>{money(statement.closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="statement-balance-forward mt-5 flex justify-end">
        <div className="min-w-[310px] border-t-2 border-slate-900 pt-2 text-right text-lg">
          <strong className="mr-10">Balance B/F</strong>
          <strong>{money(statement.closingBalance)}</strong>
        </div>
      </div>
      <div className="statement-footer mt-10 border-t border-slate-300 pt-3 text-center text-xs text-slate-500">
        This statement is generated from posted bills and payments in the utility ledger.
      </div>
    </Card>}
  </Page>;
}

export function BillNotifications() {
  const [cycles, setCycles] = useState<Row[]>([]); const [cycleId, setCycleId] = useState(""); const [channels, setChannels] = useState<string[]>(["SMS", "APP"]); const [bills, setBills] = useState<Row[]>([]); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { api.listBillingCycles().then((rows) => { setCycles(rows); if (rows[0]) setCycleId(String(rows[0].billingCycleId)); }); }, []); useEffect(() => { if (cycleId) api.listBills({ billingCycleId: cycleId }).then(setBills); }, [cycleId]);
  async function send() { try { const result = await api.sendBillNotifications({ billingCycleId: cycleId, channels }); setMessage(`${result.notifications} notification(s) sent for ${result.bills} bill(s).`); } catch (e: any) { setError(e.message); } }
  const selected = bills.filter((b) => ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"].includes(b.status));
  return <Page title="Bill notifications" subtitle="Send bill notices through configured customer channels">{error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<div className="grid gap-4 lg:grid-cols-[420px_1fr]"><Card title="Notification setup"><div className="space-y-4"><Field label="Billing period"><CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} /></Field><Field label="Notification channels"><div className="grid grid-cols-2 gap-2 rounded-lg border p-3">{["SMS", "APP", "EMAIL", "WHATSAPP"].map((channel) => <label key={channel} className="flex gap-2"><input type="checkbox" checked={channels.includes(channel)} onChange={(e) => setChannels(e.target.checked ? [...channels, channel] : channels.filter((x) => x !== channel))} />{channel}</label>)}</div></Field><div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{selected.length} approved or posted customer bill(s) selected.</div><Button className="w-full" disabled={!cycleId || !channels.length || !selected.length} onClick={send}>Send notifications</Button></div></Card><Card title="Message preview"><div className="rounded-xl bg-slate-50 p-5 text-slate-700">Dear <strong>[Customer Name]</strong>, your water bill for <strong>[Billing Period]</strong> is <strong>KSh [Amount]</strong>. Please pay by <strong>[Due Date]</strong>. Account: <strong>[Account Number]</strong>.</div><div className="mt-4 overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Bill</th><th className={TH}>Customer</th><th className={TH}>Amount</th><th className={TH}>Status</th></tr></thead><tbody>{selected.map((bill) => <tr key={bill.billId} className="border-t"><td className={TD}>{bill.billNumber}</td><td className={TD}>{bill.customerName}</td><td className={TD}>{money(bill.totalAmountDue)}</td><td className={TD}><Badge value={bill.notificationStatus} /></td></tr>)}</tbody></table></div></Card></div></Page>;
}

async function fileData(file?: File) { if (!file) return {}; if (file.size > 4 * 1024 * 1024) throw new Error("Supporting document must be 4 MB or smaller"); const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read supporting document")); reader.readAsDataURL(file); }); return { supportingFileName: file.name, supportingContent: content }; }

export function BillingAdjustments() {
  const [bills, setBills] = useState<Row[]>([]); const [items, setItems] = useState<Row[]>([]); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [file, setFile] = useState<File>(); const [form, setForm] = useState<Row>({ billId: "", adjustmentType: "CREDIT_NOTE", amount: "", reason: "" });
  const load = () => Promise.all([api.listBills(), api.listBillingAdjustments()]).then(([b, a]) => { setBills(b.filter((x: Row) => ["APPROVED", "POSTED", "PARTIALLY_PAID"].includes(x.status))); setItems(a); }); useEffect(() => { load().catch((e) => setError(e.message)); }, []); const bill = bills.find((b) => String(b.billId) === form.billId);
  async function submit(e: FormEvent) { e.preventDefault(); try { await api.createBillingAdjustment({ ...form, amount: Number(form.amount), ...(await fileData(file)) }); setMessage("Adjustment request submitted for independent approval."); setForm({ billId: "", adjustmentType: "CREDIT_NOTE", amount: "", reason: "" }); setFile(undefined); await load(); } catch (e: any) { setError(e.message); } }
  return <Page title="Bill adjustment requests" subtitle="Request controlled credit notes, debit notes and corrections" actions={<LinkButton to="/billing/adjustments/approvals">Adjustment approval</LinkButton>}>
    {error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<div className="grid gap-4 lg:grid-cols-[430px_1fr]"><Card title="New adjustment request"><form onSubmit={submit} className="space-y-3"><Field label="Bill" required><SearchableSelect required className={INPUT} value={form.billId} onChange={(e) => setForm({ ...form, billId: e.target.value })}><option value="">Select approved / posted bill</option>{bills.map((b) => <option key={b.billId} value={b.billId}>{b.billNumber} · {b.customerName}</option>)}</SearchableSelect></Field>{bill && <div className="rounded-lg bg-slate-50 p-3 text-sm"><div>{bill.account.accountNumber} · {bill.customerName}</div><strong>Current charges: {money(bill.totalCurrentCharges)}</strong></div>}<div className="grid grid-cols-2 gap-3"><Field label="Adjustment type" required><SearchableSelect className={INPUT} value={form.adjustmentType} onChange={(e) => setForm({ ...form, adjustmentType: e.target.value })}><option>CREDIT_NOTE</option><option>DEBIT_NOTE</option><option>CORRECTION</option><option>CANCELLATION</option></SearchableSelect></Field><Field label="Amount" required><input required min="0.01" step="0.01" type="number" className={INPUT} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field></div><Field label="Reason" required><textarea required rows={3} className={INPUT} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field><Field label="Supporting document"><input type="file" className={INPUT} onChange={(e) => setFile(e.target.files?.[0])} /></Field><Button className="w-full" disabled={!form.billId}>Submit adjustment</Button></form></Card><Card title="Adjustment history"><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Reference</th><th className={TH}>Bill</th><th className={TH}>Type</th><th className={TH}>Amount</th><th className={TH}>Requested by</th><th className={TH}>Status</th></tr></thead><tbody>{items.map((a) => <tr key={a.adjustmentId} className="border-t"><td className={TD}>{a.adjustmentNumber}</td><td className={TD}>{a.bill.billNumber}</td><td className={TD}>{pretty(a.adjustmentType)}</td><td className={TD}>{money(a.amount)}</td><td className={TD}>{person(a.requester)}</td><td className={TD}><Badge value={a.status} /></td></tr>)}</tbody></table></div></Card></div>
  </Page>;
}

export function BillingAdjustmentApprovals() {
  const [items, setItems] = useState<Row[]>([]); const [selected, setSelected] = useState<string[]>([]); const [focus, setFocus] = useState<Row | null>(null); const [comments, setComments] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const load = () => api.listBillingAdjustments("PENDING").then((rows) => { setItems(rows); setSelected([]); setFocus(rows[0] ?? null); }); useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  const actor = getSessionUser(); const isAdmin = Boolean(actor?.roles.includes("SYSTEM_ADMIN")); const canDecide = Boolean(actor?.roles.some((role) => ["BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"].includes(role))); const selectedIncludesOwn = !isAdmin && selected.some((adjustmentId) => { const adjustment = items.find((item) => String(item.adjustmentId) === adjustmentId); return adjustment && String(adjustment.requestedBy) === String(actor?.userId); }); const decisionDisabled = !selected.length || !canDecide || selectedIncludesOwn;
  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") { if (!selected.length || comments.trim().length < 3) return setError("Select at least one adjustment and enter decision comments."); try { const result = await api.decideBillingAdjustments(selected, decision, comments); setMessage(`${result.updated} adjustment(s) changed to ${pretty(result.status)}.`); setComments(""); setError(""); await load(); } catch (e: any) { setError(e.message); } }
  return <Page title="Bill adjustment approval" subtitle="Independent maker-checker review before balances are changed">{error && <Notice>{error}</Notice>}{message && <Notice tone="green">{message}</Notice>}<div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">Adjustments may be requested after posting. Credit notes and cancellations reduce the posted balance; debit notes and corrections increase it after independent approval.</div>{!canDecide && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">Signed in as <strong>{actor?.username ?? "unknown user"}</strong>. Adjustment decisions require Billing Supervisor, Finance Manager or System Administrator.</div>}{selectedIncludesOwn && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">The selection contains a request created by <strong>{actor?.username}</strong>. Remove it from the selection or sign in as an independent checker.</div>}<div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]"><Card title={`${items.length} pending request(s)`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}><input aria-label="Select all adjustments" type="checkbox" checked={items.length > 0 && selected.length === items.length} onChange={(e) => setSelected(e.target.checked ? items.map((a) => String(a.adjustmentId)) : [])} /></th><th className={TH}>Reference</th><th className={TH}>Bill / Customer</th><th className={TH}>Type</th><th className={TH}>Amount</th><th className={TH}>Action</th></tr></thead><tbody>{items.map((a) => <tr key={a.adjustmentId} className="border-t"><td className={TD}><input aria-label={`Select ${a.adjustmentNumber}`} type="checkbox" checked={selected.includes(String(a.adjustmentId))} onChange={(e) => setSelected(e.target.checked ? [...selected, String(a.adjustmentId)] : selected.filter((id) => id !== String(a.adjustmentId)))} /></td><td className={TD}>{a.adjustmentNumber}</td><td className={TD}>{a.bill.billNumber}<div className="text-xs">{a.bill.account.accountNumber}</div></td><td className={TD}>{pretty(a.adjustmentType)}</td><td className={TD}>{money(a.amount)}</td><td className={TD}><button className="font-semibold text-aqua-700" onClick={() => setFocus(a)}>Review</button></td></tr>)}{!items.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No adjustment requests await approval.</td></tr>}</tbody></table></div></Card><Card title={`Approval decision · ${selected.length} selected`}>{focus ? <><div className="rounded-xl bg-slate-50 p-4"><h3 className="font-bold">{focus.adjustmentNumber}</h3><p className="text-sm">{focus.bill.billNumber} · {focus.bill.account.accountNumber}</p><div className="mt-3 text-2xl font-bold text-aqua-700">{money(focus.amount)}</div><div className="mt-3 text-sm"><strong>Reason:</strong> {focus.reason}</div><div className="mt-2 text-sm"><strong>Requested by:</strong> {person(focus.requester)}</div></div><Field label="Decision comments" required><textarea rows={3} className={`${INPUT} mt-3`} value={comments} onChange={(e) => setComments(e.target.value)} /></Field><div className="mt-3 flex justify-end gap-2"><Button disabled={decisionDisabled} tone="red" onClick={() => decide("REJECT")}>Reject selected</Button><Button disabled={decisionDisabled} tone="orange" onClick={() => decide("RETURN")}>Return selected</Button><Button disabled={decisionDisabled} tone="green" onClick={() => decide("APPROVE")}>Approve selected</Button></div></> : <div className="py-8 text-center text-slate-400">No request selected.</div>}</Card></div></Page>;
}

export function BillingSecurityAlerts() {
  const [status, setStatus] = useState("OPEN"); const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState(""); const load = () => api.listBillingAlerts(status).then(setRows); useEffect(() => { load().catch((e) => setError(e.message)); }, [status]);
  return <Page title="Unauthorized bill change alerts" subtitle="Blocked self-approval and protected billing actions" actions={<Button tone="slate" onClick={() => exportExcel("billing-security-alerts.xlsx", "Alerts", rows)}>Export audit log</Button>}>{error && <Notice>{error}</Notice>}<Card className="mb-4"><Field label="Alert status"><SearchableSelect className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}><option>OPEN</option><option>RESOLVED</option><option value="">All</option></SearchableSelect></Field></Card><Card title={`${rows.length} alert(s)`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Date</th><th className={TH}>Bill</th><th className={TH}>Alert</th><th className={TH}>User</th><th className={TH}>Attempt</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead><tbody>{rows.map((a) => <tr key={a.alertId} className="border-t"><td className={TD}>{dateTime(a.createdAt)}</td><td className={TD}>{a.bill?.billNumber ?? "—"}</td><td className={TD}>{pretty(a.alertType)}<div className="text-xs">{a.details}</div></td><td className={TD}>{person(a.attempter)}</td><td className={TD}>{pretty(a.attemptedAction)}</td><td className={TD}><Badge value={a.status} /></td><td className={TD}>{a.status === "OPEN" && <button className="font-semibold text-emerald-700" onClick={async () => { await api.resolveBillingAlert(String(a.alertId)); await load(); }}>Resolve</button>}</td></tr>)}</tbody></table></div></Card></Page>;
}

export function BillingHistory() {
  const [cycles, setCycles] = useState<Row[]>([]); const [cycleId, setCycleId] = useState(""); const [search, setSearch] = useState(""); const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState(""); useEffect(() => { api.listBillingCycles().then(setCycles); }, []); useEffect(() => { api.listBills({ billingCycleId: cycleId, search }).then(setRows).catch((e) => setError(e.message)); }, [cycleId, search]);
  return <Page title="Billing history" subtitle="Permanent customer billing records across all periods" actions={<Button tone="green" onClick={() => exportExcel("billing-history.xlsx", "Billing History", rows.map((b) => ({ Period: b.billingCycle.cycleName, Bill: b.billNumber, Account: b.account.accountNumber, Customer: b.customerName, Charges: Number(b.totalCurrentCharges), AmountDue: Number(b.totalAmountDue), Status: b.status })))}>Export history</Button>}>{error && <Notice>{error}</Notice>}<Card className="mb-4"><div className="grid gap-3 md:grid-cols-2"><Field label="Billing period"><CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} /></Field><Field label="Account, bill or customer"><input className={INPUT} value={search} onChange={(e) => setSearch(e.target.value)} /></Field></div></Card><Card title={`${rows.length} historical bill(s)`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Period</th><th className={TH}>Bill</th><th className={TH}>Account / Customer</th><th className={TH}>Consumption</th><th className={TH}>Current charges</th><th className={TH}>Status</th><th className={TH}>Action</th></tr></thead><tbody>{rows.map((b) => <tr key={b.billId} className="border-t"><td className={TD}>{b.billingCycle.cycleName}</td><td className={TD}>{b.billNumber}</td><td className={TD}>{b.account.accountNumber}<div className="text-xs">{b.customerName}</div></td><td className={TD}>{b.consumptionUnits} units</td><td className={TD}>{money(b.totalCurrentCharges)}</td><td className={TD}><Badge value={b.status} /></td><td className={TD}><Link className="font-semibold text-aqua-700" to={`/billing/invoices/${b.billId}`}>Invoice</Link></td></tr>)}</tbody></table></div></Card></Page>;
}

export function BillingAudit() {
  const [cycles, setCycles] = useState<Row[]>([]); const [cycleId, setCycleId] = useState(""); const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState(""); useEffect(() => { api.listBillingCycles().then(setCycles); }, []); useEffect(() => { api.billingAudit(cycleId).then(setRows).catch((e) => setError(e.message)); }, [cycleId]);
  return <Page title="Billing audit trail" subtitle="Creation, generation, approval, posting, notification and adjustment events" actions={<Button tone="green" onClick={() => exportExcel("billing-audit-trail.xlsx", "Billing Audit", rows.map((e) => ({ Date: dateTime(e.createdAt), Period: e.billingCycle?.cycleName, Bill: e.bill?.billNumber, Action: e.eventType, PreviousStatus: e.previousStatus, NewStatus: e.newStatus, User: person(e.performer), Details: e.details })))}>Export audit trail</Button>}>{error && <Notice>{error}</Notice>}<Card className="mb-4"><Field label="Billing period"><CycleSelect cycles={cycles} value={cycleId} onChange={setCycleId} /></Field></Card><Card title={`${rows.length} audit event(s)`}><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={TH}>Date and time</th><th className={TH}>Period / Bill</th><th className={TH}>User</th><th className={TH}>Action</th><th className={TH}>Status change</th><th className={TH}>Details</th></tr></thead><tbody>{rows.map((e) => <tr key={e.billingEventId} className="border-t"><td className={TD}>{dateTime(e.createdAt)}</td><td className={TD}>{e.billingCycle?.cycleName ?? "—"}<div className="text-xs">{e.bill?.billNumber}</div></td><td className={TD}>{person(e.performer)}</td><td className={`${TD} font-semibold`}>{pretty(e.eventType)}</td><td className={TD}>{e.previousStatus || e.newStatus ? `${pretty(e.previousStatus) || "—"} → ${pretty(e.newStatus) || "—"}` : "—"}</td><td className={TD}>{e.details ?? "—"}</td></tr>)}</tbody></table></div></Card></Page>;
}
