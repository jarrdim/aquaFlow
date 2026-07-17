import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { exportExcel, openEvidence } from "../lib/meterFiles";

type Row = Record<string, any>;
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] leading-5 text-slate-700 outline-none transition focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 disabled:bg-slate-50 disabled:text-slate-400";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";

function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium leading-5 text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
function Button({
  tone = "blue",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "blue" | "green" | "red" | "slate" | "orange";
}) {
  const colors = {
    blue: "bg-aqua-700 hover:bg-aqua-600",
    green: "bg-emerald-600 hover:bg-emerald-500",
    red: "bg-red-600 hover:bg-red-500",
    slate: "bg-slate-600 hover:bg-slate-500",
    orange: "bg-orange-500 hover:bg-orange-400",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[tone]} ${className}`}
    />
  );
}
function LinkButton({
  to,
  children,
  tone = "blue",
}: {
  to: string;
  children: ReactNode;
  tone?: "blue" | "green";
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center rounded-lg px-4 py-2 text-[15px] font-semibold text-white shadow-sm ${tone === "green" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-aqua-700 hover:bg-aqua-600"}`}
    >
      {children}
    </Link>
  );
}
function Notice({
  children,
  tone = "red",
}: {
  children: ReactNode;
  tone?: "red" | "blue" | "green";
}) {
  const cls = {
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div
      className={`mb-3 whitespace-pre-line rounded-lg border px-3 py-2 text-sm ${cls[tone]}`}
    >
      {children}
    </div>
  );
}
const tone: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  PLANNED: "bg-blue-50 text-blue-700",
  ASSIGNED: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-cyan-50 text-cyan-700",
  PENDING: "bg-amber-50 text-amber-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  CLOSED: "bg-slate-100 text-slate-600",
  NONE: "bg-slate-100 text-slate-600",
  ZERO: "bg-orange-50 text-orange-700",
  NEGATIVE: "bg-red-50 text-red-700",
  HIGH: "bg-red-50 text-red-700",
  LOW: "bg-amber-50 text-amber-700",
  TAMPERED: "bg-red-50 text-red-700",
};
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone[value] ?? "bg-slate-100 text-slate-600"}`}
    >
      {pretty(value)}
    </span>
  );
}
function pretty(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function date(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "—";
}
function number(value: any, digits = 3) {
  return Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}
function customerName(row: Row) {
  const c = row.account?.customer;
  return (
    c?.organizationName ||
    `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim() ||
    "—"
  );
}

function CycleSelect({
  value,
  onChange,
  includeAll = false,
}: {
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
}) {
  const [cycles, setCycles] = useState<Row[]>([]);
  useEffect(() => {
    api
      .listReadingCycles()
      .then(setCycles)
      .catch(() => undefined);
  }, []);
  return (
    <select
      className={INPUT}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {includeAll ? "All reading cycles" : "Select reading cycle"}
      </option>
      {cycles.map((c) => (
        <option key={c.readingCycleId} value={c.readingCycleId}>
          {c.cycleName} · {pretty(c.status)}
        </option>
      ))}
    </select>
  );
}

export function ReadingDashboard() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [zones, setZones] = useState<Row[]>([]);
  const [filters, setFilters] = useState({ cycleId: "", zoneId: "" });
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.listReadingCycles(), api.listZones()])
      .then(([c, z]) => {
        setCycles(c);
        setZones(z);
        const open = c.find((x: Row) => x.status === "OPEN");
        if (open)
          setFilters((f) => ({ ...f, cycleId: String(open.readingCycleId) }));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api
      .readingDashboard(filters)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [filters]);
  const stats = [
    ["Meters in scope", data?.totalMeters, "text-slate-800"],
    ["Captured", data?.captured, "text-blue-700"],
    ["Approved", data?.approved, "text-emerald-700"],
    ["Pending approval", data?.pending, "text-amber-700"],
    ["Unread", data?.unread, "text-orange-700"],
    ["Exceptions", data?.exceptions, "text-red-700"],
  ];
  return (
    <Page
      title="Meter Reading Management"
      subtitle="Plan routes, capture readings, resolve exceptions and approve consumption"
      actions={
        <>
          <LinkButton to="/readings/worklist">Open worklist</LinkButton>
          <LinkButton to="/readings/cycles" tone="green">
            Manage cycles
          </LinkButton>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Reading cycle">
            <select
              className={INPUT}
              value={filters.cycleId}
              onChange={(e) =>
                setFilters({ ...filters, cycleId: e.target.value })
              }
            >
              <option value="">Current open cycle</option>
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zone">
            <select
              className={INPUT}
              value={filters.zoneId}
              onChange={(e) =>
                setFilters({ ...filters, zoneId: e.target.value })
              }
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.zoneId} value={z.zoneId}>
                  {z.zoneName}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {stats.map(([label, value, color]) => (
          <Card key={String(label)}>
            <div className="text-sm font-medium text-slate-500">{label}</div>
            <div className={`mt-1 text-3xl font-bold ${color}`}>
              {value ?? 0}
            </div>
          </Card>
        ))}
      </div>
      <Card
        title={`Cycle completion · ${data?.completionPercent ?? 0}%`}
        className="mb-4"
      >
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-aqua-600 transition-all"
            style={{ width: `${Math.min(data?.completionPercent ?? 0, 100)}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-sm text-slate-500">
          <span>{data?.captured ?? 0} captured</span>
          <span>{data?.unread ?? 0} remaining</span>
        </div>
      </Card>
      <Card title="Recent readings">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Meter</th>
                <th className={TH}>Customer</th>
                <th className={TH}>Current</th>
                <th className={TH}>Consumption</th>
                <th className={TH}>Exception</th>
                <th className={TH}>Approval</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent ?? []).map((r: Row) => (
                <tr key={r.readingId} className="border-t border-slate-100">
                  <td className={TD}>{r.meter?.meterNumber}</td>
                  <td className={TD}>{customerName(r)}</td>
                  <td className={TD}>{number(r.currentReading)}</td>
                  <td className={TD}>{number(r.consumption)}</td>
                  <td className={TD}>
                    <Badge value={r.exceptionType} />
                  </td>
                  <td className={TD}>
                    <Badge value={r.approvalStatus} />
                  </td>
                </tr>
              ))}
              {!data?.recent?.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No readings captured for this cycle.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function ReadingCycles() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const now = new Date();
  const [form, setForm] = useState({
    cycleCode: `RC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    cycleName: now.toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    }),
    startDate: new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10),
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10),
    status: "PLANNED",
    remarks: "",
  });
  const load = () =>
    api
      .listReadingCycles()
      .then(setCycles)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editingId) {
        await api.updateReadingCycle(editingId, form);
        setMessage("Reading cycle details updated successfully.");
      } else {
        await api.createReadingCycle(form);
        setMessage("Reading cycle created successfully.");
      }
      await load();
      setEditingId("");
      setForm({ ...form, cycleCode: "", cycleName: "", remarks: "" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  function edit(c: Row) {
    setError("");
    setMessage("");
    setEditingId(String(c.readingCycleId));
    setForm({
      cycleCode: c.cycleCode,
      cycleName: c.cycleName,
      startDate: c.startDate.slice(0, 10),
      endDate: c.endDate.slice(0, 10),
      status: c.status,
      remarks: c.remarks ?? "",
    });
  }
  async function status(c: Row, next: string) {
    if (
      next === "CANCELLED" &&
      !window.confirm(
        `Cancel reading cycle ${c.cycleCode}? Its code will remain reserved for audit history.`,
      )
    )
      return;
    setError("");
    setMessage("");
    try {
      await api.updateReadingCycleStatus(String(c.readingCycleId), next);
      await load();
      setMessage(
        next === "PLANNED"
          ? `${c.cycleCode} was reopened as a planned cycle.`
          : `${c.cycleCode} is now ${next.toLowerCase()}.`,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Reading cycles"
      subtitle="Create and control the periods in which meter readings are collected"
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card title={editingId ? "Edit reading cycle" : "Create reading cycle"}>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Cycle code" required>
              <input
                required
                className={INPUT}
                value={form.cycleCode}
                onChange={(e) =>
                  setForm({ ...form, cycleCode: e.target.value })
                }
              />
            </Field>
            <Field label="Cycle name" required>
              <input
                required
                className={INPUT}
                value={form.cycleName}
                onChange={(e) =>
                  setForm({ ...form, cycleName: e.target.value })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" required>
                <input
                  required
                  type="date"
                  className={INPUT}
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </Field>
              <Field label="End date" required>
                <input
                  required
                  type="date"
                  className={INPUT}
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Initial status">
              <select
                className={INPUT}
                value={form.status}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="PLANNED">Planned</option>
                <option value="OPEN">Open immediately</option>
              </select>
            </Field>
            <Field label="Remarks">
              <textarea
                rows={2}
                className={INPUT}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>
            {editingId && (
              <Button
                type="button"
                tone="slate"
                className="mb-2 w-full"
                onClick={() => setEditingId("")}
              >
                Cancel edit
              </Button>
            )}
            <Button disabled={saving} className="w-full">
              {saving ? "Saving..." : editingId ? "Save changes" : "Create cycle"}
            </Button>
          </form>
        </Card>
        <Card title="Cycle register">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Code</th>
                  <th className={TH}>Cycle</th>
                  <th className={TH}>Period</th>
                  <th className={TH}>Routes</th>
                  <th className={TH}>Readings</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr
                    key={c.readingCycleId}
                    className="border-t border-slate-100"
                  >
                    <td className={`${TD} font-medium text-slate-800`}>
                      {c.cycleCode}
                    </td>
                    <td className={TD}>{c.cycleName}</td>
                    <td className={TD}>
                      {date(c.startDate)} – {date(c.endDate)}
                    </td>
                    <td className={TD}>{c._count?.routeAssignments ?? 0}</td>
                    <td className={TD}>{c._count?.readings ?? 0}</td>
                    <td className={TD}>
                      <Badge value={c.status} />
                    </td>
                    <td className={TD}>
                      <div className="flex gap-2">
                        {["PLANNED", "CANCELLED"].includes(c.status) &&
                          (c._count?.readings ?? 0) === 0 && (
                            <button
                              className="font-semibold text-aqua-700"
                              onClick={() => edit(c)}
                            >
                              Edit
                            </button>
                          )}
                        {c.status === "PLANNED" && (
                          <button
                            className="font-semibold text-emerald-700"
                            onClick={() => status(c, "OPEN")}
                          >
                            Open
                          </button>
                        )}
                        {c.status === "OPEN" && (
                          <button
                            className="font-semibold text-slate-700"
                            onClick={() => status(c, "CLOSED")}
                          >
                            Close
                          </button>
                        )}
                        {c.status === "CANCELLED" && (
                          <button
                            className="font-semibold text-aqua-700"
                            onClick={() => status(c, "PLANNED")}
                          >
                            Reopen
                          </button>
                        )}
                        {!["CLOSED", "CANCELLED"].includes(c.status) && (
                          <button
                            className="font-semibold text-red-600"
                            onClick={() => status(c, "CANCELLED")}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function ReadingRouteAssignments() {
  const [cycles, setCycles] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Row[]>([]);
  const [officers, setOfficers] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [showOfficer, setShowOfficer] = useState(false);
  const [form, setForm] = useState({
    readingCycleId: "",
    routeId: "",
    fieldOfficerId: "",
    assignedDate: new Date().toISOString().slice(0, 10),
    remarks: "",
  });
  const [officer, setOfficer] = useState({
    userId: "",
    employeeNumber: "",
    phoneNumber: "",
    homeZoneId: "",
  });
  const [zones, setZones] = useState<Row[]>([]);
  const load = async () => {
    try {
      const [c, r, o, a, s, z] = await Promise.all([
        api.listReadingCycles(),
        api.listRoutes(),
        api.listReadingOfficers(),
        api.listRouteAssignments(form.readingCycleId),
        api.listReadingStaffCandidates(),
        api.listZones(),
      ]);
      setCycles(c);
      setRoutes(r);
      setOfficers(o);
      setItems(a);
      setCandidates(s);
      setZones(z);
      if (!form.readingCycleId) {
        const active = c.find((x: Row) => x.status === "OPEN") ?? c[0];
        if (active)
          setForm((f) => ({
            ...f,
            readingCycleId: String(active.readingCycleId),
          }));
      }
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [form.readingCycleId]);
  async function assign(e: FormEvent) {
    e.preventDefault();
    try {
      await api.assignReadingRoute(form);
      await load();
      setForm({ ...form, routeId: "", fieldOfficerId: "", remarks: "" });
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function createOfficer(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createReadingOfficer({
        ...officer,
        homeZoneId: officer.homeZoneId || undefined,
      });
      setShowOfficer(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Page
      title="Route assignments"
      subtitle="Allocate reading routes to field officers for each cycle"
      actions={
        <Button onClick={() => setShowOfficer(!showOfficer)}>
          {showOfficer ? "Close reader form" : "Add meter reader"}
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      {showOfficer && (
        <Card title="Create meter reader profile" className="mb-4">
          <form onSubmit={createOfficer} className="grid gap-3 md:grid-cols-4">
            <Field label="Staff user" required>
              <select
                required
                className={INPUT}
                value={officer.userId}
                onChange={(e) => {
                  const user = candidates.find(
                    (x) => String(x.userId) === e.target.value,
                  );
                  setOfficer({
                    ...officer,
                    userId: e.target.value,
                    phoneNumber: user?.phoneNumber ?? officer.phoneNumber,
                  });
                }}
              >
                <option value="">Select active staff user</option>
                {candidates.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.firstName} {u.lastName} ({u.username})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Employee number" required>
              <input
                required
                className={INPUT}
                value={officer.employeeNumber}
                onChange={(e) =>
                  setOfficer({ ...officer, employeeNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Phone number" required>
              <input
                required
                className={INPUT}
                value={officer.phoneNumber}
                onChange={(e) =>
                  setOfficer({ ...officer, phoneNumber: e.target.value })
                }
              />
            </Field>
            <Field label="Home zone">
              <select
                className={INPUT}
                value={officer.homeZoneId}
                onChange={(e) =>
                  setOfficer({ ...officer, homeZoneId: e.target.value })
                }
              >
                <option value="">No home zone</option>
                {zones.map((z) => (
                  <option key={z.zoneId} value={z.zoneId}>
                    {z.zoneName}
                  </option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-4 flex justify-end">
              <Button tone="green">Create reader profile</Button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Assign route" className="mb-4">
        <form
          onSubmit={assign}
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
        >
          <Field label="Reading cycle" required>
            <select
              required
              className={INPUT}
              value={form.readingCycleId}
              onChange={(e) =>
                setForm({ ...form, readingCycleId: e.target.value })
              }
            >
              <option value="">Select cycle</option>
              {cycles
                .filter((c) => ["PLANNED", "OPEN"].includes(c.status))
                .map((c) => (
                  <option key={c.readingCycleId} value={c.readingCycleId}>
                    {c.cycleName}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Route" required>
            <select
              required
              className={INPUT}
              value={form.routeId}
              onChange={(e) => setForm({ ...form, routeId: e.target.value })}
            >
              <option value="">Select route</option>
              {routes.map((r) => (
                <option key={r.routeId} value={r.routeId}>
                  {r.routeName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Meter reader" required>
            <select
              required
              className={INPUT}
              value={form.fieldOfficerId}
              onChange={(e) =>
                setForm({ ...form, fieldOfficerId: e.target.value })
              }
            >
              <option value="">Select officer</option>
              {officers.map((o) => (
                <option key={o.fieldOfficerId} value={o.fieldOfficerId}>
                  {o.officerName} · {o.employeeNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned date">
            <input
              type="date"
              className={INPUT}
              value={form.assignedDate}
              onChange={(e) =>
                setForm({ ...form, assignedDate: e.target.value })
              }
            />
          </Field>
          <div className="flex items-end">
            <Button className="w-full">Assign route</Button>
          </div>
        </form>
      </Card>
      <Card title="Assignment register">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Cycle</th>
                <th className={TH}>Zone / Route</th>
                <th className={TH}>Officer</th>
                <th className={TH}>Assigned</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr
                  key={a.routeAssignmentId}
                  className="border-t border-slate-100"
                >
                  <td className={TD}>{a.cycle?.cycleName}</td>
                  <td className={TD}>
                    {a.route?.zone?.zoneName} /{" "}
                    <span className="font-medium text-slate-800">
                      {a.route?.routeName}
                    </span>
                  </td>
                  <td className={TD}>{a.officerName}</td>
                  <td className={TD}>{date(a.assignedDate)}</td>
                  <td className={TD}>
                    <Badge value={a.status} />
                  </td>
                  <td className={TD}>
                    {a.status !== "COMPLETED" && (
                      <button
                        className="font-semibold text-emerald-700"
                        onClick={async () => {
                          await api.updateRouteAssignmentStatus(
                            String(a.routeAssignmentId),
                            "COMPLETED",
                          );
                          load();
                        }}
                      >
                        Complete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function ReadingWorklist() {
  const [params, setParams] = useSearchParams();
  const [cycles, setCycles] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const cycleId = params.get("cycleId") ?? "";
  const routeId = params.get("routeId") ?? "";
  const search = params.get("search") ?? "";
  useEffect(() => {
    Promise.all([api.listReadingCycles(), api.listRoutes()])
      .then(([c, r]) => {
        setError("");
        setCycles(c);
        setRoutes(r);
        if (!cycleId) {
          const open = c.find((x: Row) => x.status === "OPEN");
          if (open) setParams({ cycleId: String(open.readingCycleId) });
        }
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!cycleId) return;
    api
      .readingWorklist({ cycleId, routeId, search })
      .then((nextItems) => {
        setError("");
        setItems(nextItems);
      })
      .catch((e) => setError(e.message));
  }, [cycleId, routeId, search]);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  return (
    <Page
      title="Meter reading worklist"
      subtitle="Customer meters due for capture in the selected cycle"
      actions={
        <LinkButton to="/readings/register">Reading register</LinkButton>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Reading cycle">
            <select
              className={INPUT}
              value={cycleId}
              onChange={(e) => update("cycleId", e.target.value)}
            >
              <option value="">Select cycle</option>
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Route">
            <select
              className={INPUT}
              value={routeId}
              onChange={(e) => update("routeId", e.target.value)}
            >
              <option value="">All routes</option>
              {routes.map((r) => (
                <option key={r.routeId} value={r.routeId}>
                  {r.routeName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search">
            <input
              className={INPUT}
              value={search}
              onChange={(e) => update("search", e.target.value)}
              placeholder="Meter, account or customer"
            />
          </Field>
        </div>
      </Card>
      <Card title={`${items.length} meter(s) in worklist`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Route</th>
                <th className={TH}>Account / Customer</th>
                <th className={TH}>Meter</th>
                <th className={TH}>Previous</th>
                <th className={TH}>Status</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.assignmentId} className="border-t border-slate-100">
                  <td className={TD}>{a.route?.routeName ?? "—"}</td>
                  <td className={TD}>
                    <div className="font-medium text-slate-800">
                      {a.account?.accountNumber}
                    </div>
                    <div className="text-sm text-slate-500">
                      {a.customerName}
                    </div>
                  </td>
                  <td className={TD}>{a.meter?.meterNumber}</td>
                  <td className={TD}>
                    {number(
                      a.meter?.readings?.[0]?.currentReading ??
                        a.meter?.openingReading,
                    )}
                  </td>
                  <td className={TD}>
                    {a.cycleReading ? (
                      <Badge value={a.cycleReading.approvalStatus} />
                    ) : (
                      <span className="text-orange-600">Unread</span>
                    )}
                  </td>
                  <td className={TD}>
                    {a.cycleReading ? (
                      <Link
                        className="font-semibold text-aqua-700"
                        to={`/readings/register?search=${encodeURIComponent(a.meter.meterNumber)}`}
                      >
                        View
                      </Link>
                    ) : (
                      <Link
                        className="font-semibold text-emerald-700"
                        to={`/readings/capture?cycleId=${cycleId}&meterId=${a.meterId}`}
                      >
                        Capture
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No eligible meters found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

async function fileEvidence(file?: File) {
  if (!file) return undefined;
  if (file.size > 4 * 1024 * 1024)
    throw new Error("Photo must be 4 MB or smaller");
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
  return {
    evidenceType: "METER_PHOTO",
    fileName: file.name,
    mimeType: file.type,
    content,
  };
}
export function CaptureReading() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cycleId = params.get("cycleId") ?? "";
  const meterId = params.get("meterId") ?? "";
  const [item, setItem] = useState<Row | null>(null);
  const [officers, setOfficers] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    currentReading: "",
    readingType: "ACTUAL",
    estimationReason: "",
    readingDate: new Date().toISOString().slice(0, 16),
    gpsLatitude: "",
    gpsLongitude: "",
    exceptionType: "NONE",
    fieldOfficerId: "",
    remarks: "",
  });
  const [photo, setPhoto] = useState<any>();
  useEffect(() => {
    Promise.all([api.readingWorklist({ cycleId }), api.listReadingOfficers()])
      .then(([items, officers]) => {
        setItem(items.find((x: Row) => String(x.meterId) === meterId) ?? null);
        setOfficers(officers);
      })
      .catch((e) => setError(e.message));
  }, [cycleId, meterId]);
  const previous = Number(
    item?.meter?.readings?.[0]?.currentReading ??
      item?.meter?.openingReading ??
      0,
  );
  const consumption = form.currentReading
    ? Number(form.currentReading) - previous
    : 0;
  function locate() {
    if (!navigator.geolocation)
      return setError("Geolocation is not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setForm({
          ...form,
          gpsLatitude: String(p.coords.latitude),
          gpsLongitude: String(p.coords.longitude),
        }),
      (e) => setError(e.message),
      { enableHighAccuracy: true },
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      meterId,
      readingCycleId: cycleId,
      previousReading: previous,
      currentReading: Number(form.currentReading),
      readingType: form.readingType,
      estimationReason: form.estimationReason || undefined,
      readingDate: new Date(form.readingDate).toISOString(),
      gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : undefined,
      gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : undefined,
      exceptionType: form.exceptionType,
      fieldOfficerId: form.fieldOfficerId || undefined,
      remarks: form.remarks || undefined,
      syncId: `web-${meterId}-${cycleId}-${Date.now()}`,
      evidence: photo ? [photo] : [],
    };
    try {
      await api.captureReading(payload);
      navigate(`/readings/worklist?cycleId=${cycleId}`);
    } catch (e: any) {
      if (/fetch|network|offline/i.test(e.message)) {
        const queue = JSON.parse(
          localStorage.getItem("aquaflow_reading_queue") ?? "[]",
        );
        queue.push(payload);
        localStorage.setItem("aquaflow_reading_queue", JSON.stringify(queue));
        setMessage(
          "Network unavailable. Reading saved to this device for later synchronization.",
        );
      } else setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  if (!item)
    return (
      <Page title="Capture meter reading" subtitle="Loading selected meter…">
        {error && <Notice>{error}</Notice>}
        <Card>
          <p className="text-slate-500">
            The meter is not eligible for this cycle, or the worklist is still
            loading.
          </p>
        </Card>
      </Page>
    );
  return (
    <Page
      title="Capture meter reading"
      subtitle={`${item.meter?.meterNumber} · ${item.account?.accountNumber} · ${item.customerName}`}
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}
      <form onSubmit={submit}>
        <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
          <Card title="Meter and account">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Meter</dt>
                <dd className="font-semibold text-slate-800">
                  {item.meter?.meterNumber}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Account</dt>
                <dd className="font-semibold text-slate-800">
                  {item.account?.accountNumber}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Customer</dt>
                <dd className="font-semibold text-slate-800">
                  {item.customerName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Route</dt>
                <dd className="font-semibold text-slate-800">
                  {item.route?.routeName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Previous reading</dt>
                <dd className="text-2xl font-bold text-aqua-700">
                  {number(previous)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Calculated consumption</dt>
                <dd
                  className={`text-2xl font-bold ${consumption < 0 ? "text-red-600" : "text-emerald-600"}`}
                >
                  {number(consumption)}
                </dd>
              </div>
            </dl>
          </Card>
          <Card title="Reading details">
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Current reading" required>
                <input
                  required
                  autoFocus
                  min="0"
                  step="0.001"
                  type="number"
                  className={INPUT}
                  value={form.currentReading}
                  onChange={(e) =>
                    setForm({ ...form, currentReading: e.target.value })
                  }
                />
              </Field>
              <Field label="Reading type" required>
                <select
                  className={INPUT}
                  value={form.readingType}
                  onChange={(e) =>
                    setForm({ ...form, readingType: e.target.value })
                  }
                >
                  <option value="ACTUAL">Actual</option>
                  <option value="ESTIMATED">Estimated</option>
                  <option value="SMART">Smart meter</option>
                </select>
              </Field>
              <Field label="Reading date and time" required>
                <input
                  required
                  type="datetime-local"
                  className={INPUT}
                  value={form.readingDate}
                  onChange={(e) =>
                    setForm({ ...form, readingDate: e.target.value })
                  }
                />
              </Field>
              {form.readingType === "ESTIMATED" && (
                <Field label="Estimation reason" required>
                  <input
                    required
                    className={INPUT}
                    value={form.estimationReason}
                    onChange={(e) =>
                      setForm({ ...form, estimationReason: e.target.value })
                    }
                  />
                </Field>
              )}
              <Field label="Field officer">
                <select
                  className={INPUT}
                  value={form.fieldOfficerId}
                  onChange={(e) =>
                    setForm({ ...form, fieldOfficerId: e.target.value })
                  }
                >
                  <option value="">Current authenticated user</option>
                  {officers.map((o) => (
                    <option key={o.fieldOfficerId} value={o.fieldOfficerId}>
                      {o.officerName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Observed exception">
                <select
                  className={INPUT}
                  value={form.exceptionType}
                  onChange={(e) =>
                    setForm({ ...form, exceptionType: e.target.value })
                  }
                >
                  <option value="NONE">Automatic detection</option>
                  <option value="TAMPERED">Tampering suspected</option>
                </select>
              </Field>
              <Field label="Meter photo">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className={INPUT}
                  onChange={async (e) => {
                    try {
                      setPhoto(await fileEvidence(e.target.files?.[0]));
                    } catch (x: any) {
                      setError(x.message);
                    }
                  }}
                />
              </Field>
              <Field label="GPS latitude">
                <input
                  type="number"
                  step="any"
                  className={INPUT}
                  value={form.gpsLatitude}
                  onChange={(e) =>
                    setForm({ ...form, gpsLatitude: e.target.value })
                  }
                />
              </Field>
              <Field label="GPS longitude">
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="any"
                    className={INPUT}
                    value={form.gpsLongitude}
                    onChange={(e) =>
                      setForm({ ...form, gpsLongitude: e.target.value })
                    }
                  />
                  <Button type="button" tone="slate" onClick={locate}>
                    Locate
                  </Button>
                </div>
              </Field>
              <div className="md:col-span-2 xl:col-span-3">
                <Field label="Remarks">
                  <textarea
                    rows={2}
                    className={INPUT}
                    value={form.remarks}
                    onChange={(e) =>
                      setForm({ ...form, remarks: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" tone="slate" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button disabled={saving || !form.currentReading}>
            {saving ? "Submitting…" : "Submit for approval"}
          </Button>
        </div>
      </form>
    </Page>
  );
}

function ReadingTable({
  items,
  actions,
}: {
  items: Row[];
  actions?: (row: Row) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Date / Cycle</th>
            <th className={TH}>Meter / Account</th>
            <th className={TH}>Customer</th>
            <th className={TH}>Previous</th>
            <th className={TH}>Current</th>
            <th className={TH}>Consumption</th>
            <th className={TH}>Type</th>
            <th className={TH}>Exception</th>
            <th className={TH}>Approval</th>
            {actions && <th className={TH}>Action</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.readingId} className="border-t border-slate-100">
              <td className={TD}>
                <div>{date(r.readingDate)}</div>
                <div className="text-xs text-slate-400">
                  {r.cycle?.cycleName}
                </div>
              </td>
              <td className={TD}>
                <div className="font-medium text-slate-800">
                  {r.meter?.meterNumber}
                </div>
                <div className="text-xs text-slate-400">
                  {r.account?.accountNumber}
                </div>
              </td>
              <td className={TD}>{customerName(r)}</td>
              <td className={TD}>{number(r.previousReading)}</td>
              <td className={TD}>{number(r.currentReading)}</td>
              <td
                className={`${TD} font-semibold ${Number(r.consumption) < 0 ? "text-red-600" : "text-slate-800"}`}
              >
                {number(r.consumption)}
              </td>
              <td className={TD}>{pretty(r.readingType)}</td>
              <td className={TD}>
                <Badge value={r.exceptionType} />
              </td>
              <td className={TD}>
                <Badge value={r.approvalStatus} />
              </td>
              {actions && <td className={TD}>{actions(r)}</td>}
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td
                colSpan={actions ? 10 : 9}
                className="p-8 text-center text-slate-400"
              >
                No readings match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ReadingRegister({
  exceptions = false,
}: {
  exceptions?: boolean;
}) {
  const [params] = useSearchParams();
  const [cycles, setCycles] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    cycleId: "",
    approvalStatus: "",
    readingType: "",
    search: params.get("search") ?? "",
  });
  useEffect(() => {
    api.listReadingCycles().then(setCycles);
  }, []);
  useEffect(() => {
    api
      .listReadings({ ...filters, exceptionOnly: exceptions ? "true" : "" })
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [filters, exceptions]);
  return (
    <Page
      title={exceptions ? "Reading exceptions" : "Meter reading register"}
      subtitle={
        exceptions
          ? "Investigate zero, negative, high, low and tampered readings"
          : "Search and export the complete reading history"
      }
      actions={
        <Button
          tone="green"
          onClick={() =>
            exportExcel(
              exceptions ? "reading-exceptions.xlsx" : "meter-readings.xlsx",
              "Meter Readings",
              items.map((r) => ({
                Cycle: r.cycle?.cycleName,
                Date: date(r.readingDate),
                Meter: r.meter?.meterNumber,
                Account: r.account?.accountNumber,
                Customer: customerName(r),
                Previous: Number(r.previousReading),
                Current: Number(r.currentReading),
                Consumption: Number(r.consumption),
                Type: r.readingType,
                Exception: r.exceptionType,
                Approval: r.approvalStatus,
              })),
            )
          }
        >
          Export Excel
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Cycle">
            <select
              className={INPUT}
              value={filters.cycleId}
              onChange={(e) =>
                setFilters({ ...filters, cycleId: e.target.value })
              }
            >
              <option value="">All cycles</option>
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Approval">
            <select
              className={INPUT}
              value={filters.approvalStatus}
              onChange={(e) =>
                setFilters({ ...filters, approvalStatus: e.target.value })
              }
            >
              <option value="">All decisions</option>
              <option>PENDING</option>
              <option>APPROVED</option>
              <option>REJECTED</option>
            </select>
          </Field>
          <Field label="Reading type">
            <select
              className={INPUT}
              value={filters.readingType}
              onChange={(e) =>
                setFilters({ ...filters, readingType: e.target.value })
              }
            >
              <option value="">All types</option>
              <option>ACTUAL</option>
              <option>ESTIMATED</option>
              <option>SMART</option>
            </select>
          </Field>
          <Field label="Search">
            <input
              className={INPUT}
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              placeholder="Meter, account or customer"
            />
          </Field>
        </div>
      </Card>
      <Card title={`${items.length} reading(s)`}>
        <ReadingTable
          items={items}
          actions={(r) =>
            r.evidence?.[0] ? (
              <button
                className="font-semibold text-aqua-700"
                onClick={() => openEvidence(r.evidence[0])}
              >
                Evidence
              </button>
            ) : (
              <span className="text-slate-400">—</span>
            )
          }
        />
      </Card>
    </Page>
  );
}

export function ReadingApprovals() {
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () =>
    api
      .listReadings({ approvalStatus: "PENDING" })
      .then((rows) => {
        setItems(rows);
        setSelected(
          (old) =>
            rows.find((r: Row) => r.readingId === old?.readingId) ??
            rows[0] ??
            null,
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!selected || comments.trim().length < 3)
      return setError("Enter approval comments before making a decision");
    setSaving(true);
    try {
      await api.decideReading(String(selected.readingId), decision, comments);
      setComments("");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Page
      title="Reading approvals"
      subtitle="Review captured and estimated readings before they become eligible for billing"
    >
      {error && <Notice>{error}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title={`${items.length} pending reading(s)`}>
          <ReadingTable
            items={items}
            actions={(r) => (
              <button
                className="font-semibold text-aqua-700"
                onClick={() => setSelected(r)}
              >
                Review
              </button>
            )}
          />
        </Card>
        <Card title="Approval decision">
          {selected ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold text-slate-900">
                      {selected.meter?.meterNumber}
                    </div>
                    <div className="text-sm text-slate-500">
                      {selected.account?.accountNumber} ·{" "}
                      {customerName(selected)}
                    </div>
                  </div>
                  <Badge value={selected.exceptionType} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-xs text-slate-500">Previous</div>
                    <div className="font-bold">
                      {number(selected.previousReading)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Current</div>
                    <div className="font-bold">
                      {number(selected.currentReading)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Consumption</div>
                    <div className="font-bold text-aqua-700">
                      {number(selected.consumption)}
                    </div>
                  </div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Reading type</dt>
                  <dd className="font-medium">
                    {pretty(selected.readingType)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Captured by</dt>
                  <dd className="font-medium">
                    {selected.fieldOfficer
                      ? `${selected.fieldOfficer.user.firstName} ${selected.fieldOfficer.user.lastName}`
                      : "Authenticated user"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">GPS</dt>
                  <dd className="font-medium">
                    {selected.gpsLatitude ? (
                      <a
                        className="text-aqua-700"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://maps.google.com/?q=${selected.gpsLatitude},${selected.gpsLongitude}`}
                      >
                        Open map
                      </a>
                    ) : (
                      "Not captured"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Evidence</dt>
                  <dd className="font-medium">
                    {selected.evidence?.length ? (
                      <button
                        className="text-aqua-700"
                        onClick={() => openEvidence(selected.evidence[0])}
                      >
                        View photo
                      </button>
                    ) : (
                      "No photo"
                    )}
                  </dd>
                </div>
              </dl>
              {selected.readingType === "ESTIMATED" && (
                <Notice tone="blue">
                  Estimation reason: {selected.estimationReason}
                </Notice>
              )}
              <Field label="Approval comments" required>
                <textarea
                  rows={3}
                  className={INPUT}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Record the reason for this decision"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  tone="red"
                  disabled={saving}
                  onClick={() => decide("REJECTED")}
                >
                  Reject
                </Button>
                <Button
                  tone="green"
                  disabled={saving}
                  onClick={() => decide("APPROVED")}
                >
                  Approve reading
                </Button>
              </div>
            </div>
          ) : (
            <p className="py-12 text-center text-slate-400">
              No readings await approval.
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}

export function ReadingProgress() {
  const [cycleId, setCycleId] = useState("");
  const [cycles, setCycles] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listReadingCycles().then((c) => {
      setCycles(c);
      const active = c.find((x: Row) => x.status === "OPEN") ?? c[0];
      if (active) setCycleId(String(active.readingCycleId));
    });
  }, []);
  useEffect(() => {
    if (cycleId)
      api
        .readingProgress(cycleId)
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [cycleId]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          total: a.total + r.totalMeters,
          captured: a.captured + r.captured,
          unread: a.unread + r.unread,
          exceptions: a.exceptions + r.exceptions,
        }),
        { total: 0, captured: 0, unread: 0, exceptions: 0 },
      ),
    [rows],
  );
  return (
    <Page
      title="Route completion report"
      subtitle="Monitor assigned readers, unread meters and route-level progress"
      actions={
        <Button
          tone="green"
          onClick={() =>
            exportExcel(
              "reading-route-progress.xlsx",
              "Route Progress",
              rows.map((r) => ({
                Zone: r.route?.zone?.zoneName,
                Route: r.route?.routeName,
                Officer: r.assignedOfficer,
                Total: r.totalMeters,
                Captured: r.captured,
                Unread: r.unread,
                Approved: r.approved,
                Exceptions: r.exceptions,
                "Completion %": r.completionPercent,
              })),
            )
          }
        >
          Export Excel
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      <Card className="mb-4">
        <div className="grid items-end gap-3 md:grid-cols-[1fr_repeat(4,160px)]">
          <Field label="Reading cycle">
            <select
              className={INPUT}
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
            >
              {cycles.map((c) => (
                <option key={c.readingCycleId} value={c.readingCycleId}>
                  {c.cycleName}
                </option>
              ))}
            </select>
          </Field>
          {[
            ["Meters", totals.total],
            ["Captured", totals.captured],
            ["Unread", totals.unread],
            ["Exceptions", totals.exceptions],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg bg-slate-50 px-3 py-2"
            >
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-xl font-bold text-slate-800">{value}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Progress by route">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Zone / Route</th>
                <th className={TH}>Assigned officer</th>
                <th className={TH}>Meters</th>
                <th className={TH}>Captured</th>
                <th className={TH}>Unread</th>
                <th className={TH}>Approved</th>
                <th className={TH}>Exceptions</th>
                <th className={TH}>Completion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.route.routeId} className="border-t border-slate-100">
                  <td className={TD}>
                    {r.route.zone?.zoneName} /{" "}
                    <span className="font-medium text-slate-800">
                      {r.route.routeName}
                    </span>
                  </td>
                  <td className={TD}>{r.assignedOfficer}</td>
                  <td className={TD}>{r.totalMeters}</td>
                  <td className={TD}>{r.captured}</td>
                  <td className={TD}>{r.unread}</td>
                  <td className={TD}>{r.approved}</td>
                  <td className={TD}>{r.exceptions}</td>
                  <td className={TD}>
                    <div className="min-w-32">
                      <div className="mb-1 flex justify-between text-xs">
                        <span>{r.completionPercent}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-aqua-600"
                          style={{ width: `${r.completionPercent}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

export function ReadingSyncQueue() {
  const [queue, setQueue] = useState<Row[]>(() =>
    JSON.parse(localStorage.getItem("aquaflow_reading_queue") ?? "[]"),
  );
  const [result, setResult] = useState("");
  async function sync() {
    if (!queue.length) return;
    try {
      const response = await api.syncReadings(queue);
      const failed = response.results
        .filter((r: Row) => !r.ok)
        .map((r: Row) => queue[r.index]);
      localStorage.setItem("aquaflow_reading_queue", JSON.stringify(failed));
      setQueue(failed);
      setResult(
        `${response.succeeded} reading(s) synchronized; ${response.failed} remain.`,
      );
    } catch (e: any) {
      setResult(e.message);
    }
  }
  return (
    <Page
      title="Offline reading queue"
      subtitle="Synchronize readings captured while the network was unavailable"
      actions={
        <Button disabled={!queue.length} onClick={sync}>
          Synchronize now
        </Button>
      }
    >
      {result && <Notice tone="blue">{result}</Notice>}
      <Card title={`${queue.length} pending reading(s)`}>
        {queue.length ? (
          <div className="space-y-2">
            {queue.map((r, i) => (
              <div
                key={r.syncId ?? i}
                className="flex justify-between rounded-lg border border-slate-200 p-3"
              >
                <span>
                  Meter {r.meterId} · Current {number(r.currentReading)}
                </span>
                <span className="text-sm text-slate-500">
                  {date(r.readingDate)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-slate-400">
            All locally captured readings are synchronized.
          </p>
        )}
      </Card>
    </Page>
  );
}
