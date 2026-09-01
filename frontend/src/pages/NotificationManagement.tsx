import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";
import { SearchableSelect } from "../components/SearchableSelect";
import { CheckboxMultiSelect } from "../components/CheckboxMultiSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";

type Row = Record<string, any>;
const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-700 outline-none transition duration-200 placeholder:text-sm placeholder:italic placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10";
const CHECKBOX =
  "h-5 w-5 shrink-0 cursor-pointer rounded-md border-slate-300 accent-emerald-600 outline-none transition duration-150 hover:ring-4 hover:ring-emerald-500/10 focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40";
const TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500";
const TD = "px-4 py-3 text-[15px] text-slate-600";
const dateTime = (value: any) =>
  value ? new Date(value).toLocaleString("en-KE") : "—";
const money = (value: any) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pretty = (value: any) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const customerName = (customer: any) =>
  customer?.organizationName ||
  [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ");
const errorText = (error: any) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";

function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header sticky top-0 z-30 -mx-4 mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/95 px-4 py-3 shadow-sm backdrop-blur lg:-mx-6 lg:px-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1.5 text-[15px] font-medium text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
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
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4 text-[17px] font-bold text-slate-900">
          {title}
        </div>
      )}
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
function Button({
  tone = "blue",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "blue" | "green" | "red" | "orange" | "slate";
}) {
  const colors = {
    blue: "bg-emerald-700",
    green: "bg-emerald-600",
    red: "bg-red-600",
    orange: "bg-orange-500",
    slate: "bg-slate-600",
  };
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${colors[tone]} ${props.className ?? ""}`}
    />
  );
}
function Notice({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return <SweetAlertToast message={error || success} type={error ? "error" : "success"} />;
}
function Badge({ value }: { value: string }) {
  const colors: Row = {
    DELIVERED: "bg-emerald-50 text-emerald-700",
    SENT: "bg-blue-50 text-blue-700",
    QUEUED: "bg-amber-50 text-amber-700",
    FAILED: "bg-red-50 text-red-700",
    ACTIVE: "bg-emerald-50 text-emerald-700",
    INACTIVE: "border border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${colors[value] ?? "bg-slate-100 text-slate-600"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${value === "ACTIVE" || value === "DELIVERED" ? "bg-emerald-500" : value === "INACTIVE" || value === "FAILED" ? "bg-rose-500" : "bg-current opacity-60"}`} />
      {pretty(value)}
    </span>
  );
}
const nav = (
  <>
    <Link
      className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white"
      to="/notifications/send"
    >
      Send notification
    </Link>
    <Link
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
      to="/notifications/queue"
    >
      Open queue
    </Link>
  </>
);

const DELIVERY_COLORS: Record<string, string> = {
  QUEUED: "#f59e0b",
  SENT: "#3b82f6",
  DELIVERED: "#10b981",
  FAILED: "#ef4444",
};

function DeliveryStatusChart({ data }: { data: Row }) {
  const segments = [
    { label: "Queued", value: Number(data.queued ?? 0), color: DELIVERY_COLORS.QUEUED },
    { label: "Sent", value: Number(data.sent ?? 0), color: DELIVERY_COLORS.SENT },
    { label: "Delivered", value: Number(data.delivered ?? 0), color: DELIVERY_COLORS.DELIVERED },
    { label: "Failed", value: Number(data.failed ?? 0), color: DELIVERY_COLORS.FAILED },
  ];
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const gradient = total
    ? segments
        .filter((item) => item.value > 0)
        .map((item) => {
          const start = cursor;
          cursor += (item.value / total) * 100;
          return `${item.color} ${start}% ${cursor}%`;
        })
        .join(", ")
    : "#e2e8f0 0 100%";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Delivery status</h3>
          <p className="mt-0.5 text-xs text-slate-500">Current outcome distribution</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">All time</span>
      </div>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
        <div
          role="img"
          aria-label={`Delivery status chart for ${total} notifications`}
          className="relative h-36 w-36 shrink-0 rounded-full shadow-inner transition duration-300 hover:scale-[1.03]"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-[18px] grid place-items-center rounded-full bg-white shadow-sm">
            <div className="text-center">
              <div className="text-2xl font-extrabold text-slate-900">{total.toLocaleString()}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Messages</div>
            </div>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-x-5 gap-y-3">
          {segments.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full ring-4 ring-slate-100" style={{ backgroundColor: item.color }} />
              <div>
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="font-bold text-slate-800">{item.value.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelVolumeChart({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count ?? 0)));
  return (
    <div className="border-t border-slate-100 pt-5">
      <div className="mb-4">
        <h3 className="font-bold text-slate-900">Messages by channel</h3>
        <p className="mt-0.5 text-xs text-slate-500">Volume across configured delivery methods</p>
      </div>
      {rows.length ? (
        <div className="space-y-4">
          {rows.map((row) => {
            const value = Number(row.count ?? 0);
            const width = Math.max(5, (value / max) * 100);
            return (
              <div key={row.channel}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700">{row.channel}</span>
                  <span className="font-bold text-emerald-700">{value.toLocaleString()}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm transition-all duration-700 ease-out"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-400">
          Channel activity will appear here after messages are created.
        </div>
      )}
    </div>
  );
}

function ChannelDeliveryStats({ rows }: { rows: Row[] }) {
  const channels = ["SMS", "PUSH"].map((channel) =>
    rows.find((row) => row.channel === channel) ?? {
      channel,
      count: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
    },
  );
  const statuses = [
    ["Queued", "queued", "text-amber-600", "bg-amber-50"],
    ["Sent", "sent", "text-blue-600", "bg-blue-50"],
    ["Delivered", "delivered", "text-emerald-600", "bg-emerald-50"],
    ["Failed", "failed", "text-red-600", "bg-red-50"],
  ];
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {channels.map((channel) => (
        <Card key={channel.channel}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`grid h-11 w-11 place-items-center rounded-xl text-sm font-extrabold ${channel.channel === "SMS" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>
                {channel.channel}
              </span>
              <div>
                <div className="font-bold text-slate-900">{channel.channel} notifications</div>
                <div className="text-xs text-slate-500">Delivery outcome by channel</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total</div>
              <div className="text-2xl font-extrabold text-slate-900">{Number(channel.count).toLocaleString()}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statuses.map(([label, key, color, background]) => (
              <div key={key} className={`rounded-xl px-3 py-3 ${background}`}>
                <div className="text-xs font-medium text-slate-500">{label}</div>
                <div className={`mt-1 text-xl font-bold ${color}`}>{Number(channel[key]).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function NotificationDashboard() {
  const [data, setData] = useState<Row>({});
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .notificationDashboard()
      .then(setData)
      .catch((e) => setError(errorText(e)));
  }, []);
  const stats = [
    ["Total notifications", data.total ?? 0, "text-slate-900"],
    ["Queued", data.queued ?? 0, "text-amber-600"],
    ["Delivered", data.delivered ?? 0, "text-emerald-600"],
    ["Failed", data.failed ?? 0, "text-red-600"],
  ];
  return (
    <Page
      title="Notification management"
      subtitle="Customer messages, delivery tracking, templates and provider controls"
      actions={nav}
    >
      <Notice error={error} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(([label, value, color]) => (
          <Card key={String(label)}>
            <div className="text-sm text-slate-500">{label}</div>
            <div className={`mt-2 text-3xl font-bold ${color}`}>{value}</div>
          </Card>
        ))}
      </div>
      <ChannelDeliveryStats rows={data.byChannel ?? []} />
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Recent notification activity">
          <NotificationTable rows={data.recent ?? []} compact />
        </Card>
        <Card title="Notification analytics">
          <div className="space-y-5">
            <DeliveryStatusChart data={data} />
            <ChannelVolumeChart rows={data.byChannel ?? []} />
          </div>
        </Card>
      </div>
    </Page>
  );
}

function NotificationTable({
  rows,
  compact = false,
  onRetry,
  selected,
  onSelectionChange,
  queueMode = false,
}: {
  rows: Row[];
  compact?: boolean;
  onRetry?: (id: string) => void;
  selected?: string[];
  onSelectionChange?: (ids: string[]) => void;
  queueMode?: boolean;
}) {
  const selectableIds = rows
    .filter((row) => ["QUEUED", "FAILED"].includes(row.deliveryStatus))
    .map((row) => String(row.notificationId));
  const selectionEnabled = Boolean(selected && onSelectionChange);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="bg-slate-50/90">
          <tr>
            {selectionEnabled && (
              <th className={TH}>
                <input
                  aria-label="Select all visible queued notifications"
                  type="checkbox"
                  className={CHECKBOX}
                  checked={
                    selectableIds.length > 0 &&
                    selectableIds.every((id) => selected!.includes(id))
                  }
                  onChange={(event) =>
                    onSelectionChange!(
                      event.target.checked
                        ? Array.from(new Set([...selected!, ...selectableIds]))
                        : selected!.filter((id) => !selectableIds.includes(id)),
                    )
                  }
                />
              </th>
            )}
            <th className={TH}>Created</th>
            <th className={TH}>Recipient</th>
            <th className={TH}>Type / channel</th>
            {!compact && <th className={TH}>Message</th>}
            <th className={TH}>Status</th>
            {onRetry && <th className={TH}>Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className={`border-t border-slate-100 transition-colors duration-150 hover:bg-emerald-50/40 ${index % 2 ? "bg-slate-50/40" : "bg-white"}`} key={row.notificationId}>
              {selectionEnabled && (
                <td className={TD}>
                  {["QUEUED", "FAILED"].includes(row.deliveryStatus) ? (
                    <input
                      aria-label={`Select notification ${row.notificationId}`}
                      type="checkbox"
                      className={CHECKBOX}
                      checked={selected!.includes(String(row.notificationId))}
                      onChange={(event) =>
                        onSelectionChange!(
                          event.target.checked
                            ? [...selected!, String(row.notificationId)]
                            : selected!.filter(
                                (id) => id !== String(row.notificationId),
                              ),
                        )
                      }
                    />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              )}
              <td className={TD}>
                <div>{dateTime(row.createdAt)}</div>
                {row.scheduledAt && (
                  <div className={`mt-1 text-xs font-medium ${new Date(row.scheduledAt) > new Date() ? "text-amber-600" : "text-emerald-600"}`}>
                    {new Date(row.scheduledAt) > new Date() ? "Scheduled" : "Due"} · {dateTime(row.scheduledAt)}
                  </div>
                )}
              </td>
              <td className={TD}>
                <div className="font-semibold text-slate-700">
                  {row.recipient}
                </div>
                <div className="text-xs text-slate-400">
                  {row.account?.accountNumber ?? "General"}
                </div>
              </td>
              <td className={TD}>
                <div>{pretty(row.notificationType)}</div>
                <div className="text-xs text-slate-400">
                  {row.channel} ·{" "}
                  {row.provider?.providerName ?? "Provider pending"}
                </div>
              </td>
              {!compact && (
                <td className={`${TD} max-w-md`}>
                  <div className="line-clamp-2">{row.messageBody}</div>
                  {row.failureReason && (
                    <div className="mt-1 text-xs text-red-600">
                      {row.failureReason}
                    </div>
                  )}
                </td>
              )}
              <td className={TD}>
                <Badge value={row.deliveryStatus} />
              </td>
              {onRetry && (
                <td className={TD}>
                  {row.deliveryStatus === "FAILED" &&
                  row.retryCount < row.maxRetries ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-emerald-700 transition hover:bg-emerald-50"
                      onClick={() => onRetry(String(row.notificationId))}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8" /><path d="M20 3v5h-5" /></svg>
                      Retry
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td
                colSpan={
                  (onRetry ? 6 : compact ? 4 : 5) +
                  (selectionEnabled ? 1 : 0)
                }
                className="px-4 py-16 text-center text-slate-400"
              >
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-7 w-7"><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4Z" /></svg></div>
                <div className="mt-3 font-semibold text-slate-600">Your queue is clear</div>
                <div className="mt-1 text-sm text-slate-400">No notifications match the current filters.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {queueMode && rows.length > 0 && (
        <div className="flex items-center justify-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs font-medium text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />End of loaded queue · {rows.length} item{rows.length === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

export function NotificationSend() {
  const [mode, setMode] = useState<"SINGLE" | "BULK" | "BROADCAST">("BROADCAST");
  const modeSwitch = (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <button
        type="button"
        className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "SINGLE" ? "bg-aqua-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
        onClick={() => setMode("SINGLE")}
      >
        Single customer
      </button>
      <button
        type="button"
        className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "BULK" ? "bg-aqua-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
        onClick={() => setMode("BULK")}
      >
        Bulk balance campaign
      </button>
      <button
        type="button"
        className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "BROADCAST" ? "bg-aqua-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
        onClick={() => setMode("BROADCAST")}
      >
        General SMS broadcast
      </button>
    </div>
  );
  return (
    mode === "SINGLE"
      ? <NotificationSendLegacy modeSwitch={modeSwitch} />
      : mode === "BULK"
        ? <BulkNotificationSend modeSwitch={modeSwitch} />
        : <GeneralSmsBroadcast modeSwitch={modeSwitch} />
  );
}

function GeneralSmsBroadcast({ modeSwitch }: { modeSwitch: ReactNode }) {
  const [audience, setAudience] = useState<Row>({ totalCustomers: 0, smsReady: 0, missingPhone: 0 });
  const [message, setMessage] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    api.notificationBroadcastAudience()
      .then(setAudience)
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Queue this SMS for ${Number(audience.smsReady).toLocaleString()} active customers?`)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await api.sendGeneralSmsBroadcast({
        message,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });
      setSuccess(`${Number(result.created).toLocaleString()} SMS notification(s) queued successfully.${Number(result.skippedDuplicate) ? ` ${Number(result.skippedDuplicate).toLocaleString()} existing queued notification(s) were skipped.` : ""}`);
      setMessage("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const smsSegments = message ? Math.max(1, Math.ceil(message.length / (/[^\x00-\x7F]/.test(message) ? 70 : 160))) : 0;
  return <Page
    title="General customer SMS broadcast"
    subtitle="Compose one service announcement and queue it for every active customer with a mobile number"
    actions={<>{modeSwitch}<Link to="/notifications/queue" className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aqua-600">Open delivery queue</Link></>}
  >
    <Notice error={error} success={success} />
    <div className="mb-5 overflow-hidden rounded-2xl border border-navy-700 bg-navy-800 p-6 text-white shadow-sm">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div><div className="text-xs font-bold uppercase tracking-[0.2em] text-aqua-100">Utility-wide communication</div><h2 className="mt-2 text-2xl font-extrabold text-white">Reach all active customers in one controlled campaign</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">Messages are queued for audit and provider processing. Customers without a mobile number are excluded automatically.</p></div>
        <div className="rounded-2xl border border-aqua-500/40 bg-aqua-700 px-5 py-4 shadow-sm"><div className="text-xs uppercase tracking-wider text-aqua-100">SMS-ready audience</div><div className="mt-1 text-3xl font-extrabold text-white">{loading ? "Loading..." : Number(audience.smsReady).toLocaleString()}</div></div>
      </div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Compose announcement">
        <form onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-semibold text-slate-700">SMS message<textarea required maxLength={1000} className={`${INPUT} mt-2 min-h-52 resize-y leading-6`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type the announcement customers should receive..." /></label>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{message.length.toLocaleString()} / 1,000 characters</span><span>{smsSegments || 0} estimated SMS segment{smsSegments === 1 ? "" : "s"} per customer</span></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Personalisation available</div><p className="text-sm text-slate-600">Use <code className="rounded bg-white px-1.5 py-1 text-aqua-700">{"{{customer_name}}"}</code> or <code className="rounded bg-white px-1.5 py-1 text-aqua-700">{"{{customer_number}}"}</code> in the message.</p></div>
          <label className="block text-sm font-semibold text-slate-700">Schedule delivery (optional)<input type="datetime-local" className={`${INPUT} mt-2`} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /><span className="mt-1 block text-xs font-normal text-slate-500">Leave blank to place the campaign in the queue immediately.</span></label>
          <Button tone="green" className="w-full py-3" disabled={busy || loading || !message.trim() || !Number(audience.smsReady)}>{busy ? "Queueing broadcast..." : `Review and queue for ${Number(audience.smsReady).toLocaleString()} customers`}</Button>
        </form>
      </Card>
      <div className="space-y-5">
        <Card title="Audience readiness"><div className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-sky-50 p-4"><span className="text-sm font-semibold text-sky-800">Active customers</span><strong className="text-xl">{Number(audience.totalCustomers).toLocaleString()}</strong></div><div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4"><span className="text-sm font-semibold text-emerald-800">Mobile number available</span><strong className="text-xl text-emerald-700">{Number(audience.smsReady).toLocaleString()}</strong></div><div className="flex items-center justify-between rounded-xl bg-amber-50 p-4"><span className="text-sm font-semibold text-amber-800">Missing mobile number</span><strong className="text-xl text-amber-700">{Number(audience.missingPhone).toLocaleString()}</strong></div></div></Card>
        <Card title="Delivery workflow"><ol className="space-y-4 text-sm text-slate-600"><li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-100 font-bold text-sky-700">1</span><span>Review the audience and compose the announcement.</span></li><li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-100 font-bold text-sky-700">2</span><span>Confirm once to create auditable queued notifications.</span></li><li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-100 font-bold text-sky-700">3</span><span>Open the delivery queue to process messages in safe provider batches.</span></li></ol></Card>
      </div>
    </div>
  </Page>;
}

function BulkNotificationSend({ modeSwitch }: { modeSwitch: ReactNode }) {
  const [filters, setFilters] = useState<{
    search: string;
    minimumBalance: string;
    accountStatuses: string[];
    zoneIds: string[];
    categoryIds: string[];
  }>({
    search: "",
    minimumBalance: "0.01",
    accountStatuses: ["ACTIVE"],
    zoneIds: [],
    categoryIds: [],
  });
  const [applied, setApplied] = useState(filters);
  const [zones, setZones] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [audience, setAudience] = useState<Row>({
    items: [],
    total: 0,
    pageSize: 1000,
    totalBalance: 0,
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [channels, setChannels] = useState<string[]>(["SMS"]);
  const [notificationType, setNotificationType] =
    useState("BALANCE_REMINDER");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    Promise.all([api.listZones(), api.listCategories()])
      .then(([zoneRows, categoryRows]) => {
        setZones(zoneRows);
        setCategories(categoryRows);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .notificationAudience({
        search: applied.search,
        minimumBalance: applied.minimumBalance,
        accountStatuses: applied.accountStatuses.join(","),
        zoneIds: applied.zoneIds.join(","),
        categoryIds: applied.categoryIds.join(","),
        page: String(page),
        pageSize: "1000",
      })
      .then(setAudience)
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [applied, page]);

  const rows = audience.items ?? [];
  const pageIds = rows.map((row: Row) => String(row.accountId));
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id: string) => selected.includes(id));
  const selectedCount = allMatching ? Number(audience.total) : selected.length;
  const pages = Math.max(
    1,
    Math.ceil(Number(audience.total) / Number(audience.pageSize ?? 1000)),
  );
  const customRequired = notificationType === "GENERAL";

  function applyFilters() {
    setPage(1);
    setSelected([]);
    setAllMatching(false);
    setError("");
    setSuccess("");
    setApplied({ ...filters });
  }

  function togglePage(checked: boolean) {
    setAllMatching(false);
    setSelected((current) =>
      checked
        ? Array.from(new Set([...current, ...pageIds])).slice(0, 1000)
        : current.filter((id) => !pageIds.includes(id)),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.sendBulkNotification({
        selectionMode: allMatching ? "FILTER" : "SELECTED",
        accountIds: allMatching ? [] : selected,
        filters: {
          ...applied,
          minimumBalance: Number(applied.minimumBalance),
        },
        notificationType,
        channels,
        subject: subject || undefined,
        message: message || undefined,
        scheduledAt: scheduledAt
          ? new Date(scheduledAt).toISOString()
          : undefined,
      });
      const created = Number(result.created ?? 0);
      if (!created) {
        throw new Error(
          "No notifications were queued. Check the selected channel, customer contact details, and active notification template.",
        );
      }
      const skipped = result.skipped ?? {};
      const skippedCount = Number(skipped.missingSms ?? 0) + Number(skipped.missingEmail ?? 0) + Number(skipped.unavailableTemplate ?? 0) + Number(skipped.duplicateQueued ?? 0);
      const duplicateCount = Number(skipped.duplicateQueued ?? 0);
      setSuccess(
        `${created.toLocaleString()} notification(s) queued for ${Number(result.accounts).toLocaleString()} account(s).${skippedCount ? ` ${skippedCount.toLocaleString()} delivery option(s) were skipped.` : ""}${duplicateCount ? ` ${duplicateCount.toLocaleString()} duplicate queued notification(s) were prevented.` : ""} Open the delivery queue to process them.`,
      );
      setSelected([]);
      setAllMatching(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Bulk balance notification campaign"
      subtitle="Filter outstanding accounts, review recipients and queue up to 1,000 customers per campaign"
      actions={
        <>
          {modeSwitch}
          <Link
            to="/notifications/queue"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Open delivery queue
          </Link>
        </>
      }
    >
      <Notice error={error} success={success} />
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px] 2xl:items-start">
        <Card
          className="2xl:col-start-1 2xl:row-start-1"
          title="Audience filters"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-sm font-medium">
              Minimum outstanding balance
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={`${INPUT} mt-1`}
                value={filters.minimumBalance}
                onChange={(e) =>
                  setFilters({ ...filters, minimumBalance: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium">
              Account statuses
              <CheckboxMultiSelect
                className={`${INPUT} mt-1`}
                value={filters.accountStatuses}
                onChange={(accountStatuses) => setFilters({ ...filters, accountStatuses })}
                placeholder="All statuses"
                options={[{ value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended" }, { value: "INACTIVE", label: "Inactive" }, { value: "PENDING", label: "Pending" }, { value: "CLOSED", label: "Closed" }]}
              />
            </label>
            <label className="text-sm font-medium">
              Zones
              <CheckboxMultiSelect
                className={`${INPUT} mt-1`}
                value={filters.zoneIds}
                onChange={(zoneIds) => setFilters({ ...filters, zoneIds })}
                placeholder="All zones"
                options={zones.map((zone) => ({ value: String(zone.zoneId), label: zone.zoneName }))}
              />
            </label>
            <label className="text-sm font-medium">
              Customer categories
              <CheckboxMultiSelect
                className={`${INPUT} mt-1`}
                value={filters.categoryIds}
                onChange={(categoryIds) => setFilters({ ...filters, categoryIds })}
                placeholder="All categories"
                options={categories.map((category) => ({ value: String(category.categoryId), label: category.categoryName }))}
              />
            </label>
            <label className="text-sm font-medium">
              Account or customer
              <input
                className={`${INPUT} mt-1`}
                placeholder="Optional search"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </label>
          </div>
          <Button type="button" className="mt-3 w-full" onClick={applyFilters}>
            Preview matching customers
          </Button>
        </Card>
        <Card
          className="2xl:col-start-2 2xl:row-start-1"
          title="Audience summary"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-sky-50 p-3">
              <div className="text-xs font-semibold text-sky-700">Matching</div>
              <div className="mt-1 text-2xl font-bold">
                {Number(audience.total).toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-700">
                Selected
              </div>
              <div className="mt-1 text-2xl font-bold">
                {selectedCount.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500">
              Matching outstanding balance
            </div>
            <div className="mt-1 text-xl font-bold text-aqua-700">
              {money(audience.totalBalance)}
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Campaigns are queued first. The delivery queue processes at most
            200 messages per run to protect provider limits.
          </p>
        </Card>
      <Card
        className="order-4 min-w-0 2xl:order-none 2xl:col-start-1 2xl:row-start-2"
        title={`${Number(audience.total).toLocaleString()} matching customer account(s)`}
      >
        {selected.length > 0 && !allMatching && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            <span>{selected.length} account(s) selected across pages.</span>
            {Number(audience.total) <= 1000 && (
              <button
                type="button"
                className="font-bold text-aqua-700"
                onClick={() => setAllMatching(true)}
              >
                Select all {Number(audience.total).toLocaleString()} matching
              </button>
            )}
          </div>
        )}
        {allMatching && (
          <div className="mb-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>
              All {Number(audience.total).toLocaleString()} matching accounts
              are selected.
            </span>
            <button
              type="button"
              className="font-bold"
              onClick={() => {
                setAllMatching(false);
                setSelected([]);
              }}
            >
              Clear
            </button>
          </div>
        )}
        {Number(audience.total) > 1000 && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            More than 1,000 accounts match. Narrow the filters or select up to
            1,000 rows across pages.
          </div>
        )}
        <div className="mb-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            tone="slate"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </Button>
          <span className="min-w-24 text-center text-sm font-semibold text-slate-600">
            Page {page} of {pages}
          </span>
          <Button
            type="button"
            disabled={page >= pages || loading}
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
          >
            Next
          </Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr>
                <th className={TH}>
                  <input
                  type="checkbox"
                  className={CHECKBOX}
                  aria-label="Select all accounts on this page"
                    checked={allMatching || allPageSelected}
                    disabled={allMatching}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </th>
                <th className={TH}>Account / customer</th>
                <th className={TH}>Zone</th>
                <th className={TH}>Category</th>
                <th className={TH}>SMS contact</th>
                <th className={TH}>Email contact</th>
                <th className={TH}>Balance</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    Loading audience…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row: Row) => (
                  <tr key={row.accountId} className="border-t">
                    <td className={TD}>
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        aria-label={`Select ${row.accountNumber}`}
                        checked={
                          allMatching ||
                          selected.includes(String(row.accountId))
                        }
                        disabled={allMatching}
                        onChange={(e) =>
                          setSelected((current) =>
                            e.target.checked
                              ? [...current, String(row.accountId)].slice(
                                  0,
                                  1000,
                                )
                              : current.filter(
                                  (id) => id !== String(row.accountId),
                                ),
                          )
                        }
                      />
                    </td>
                    <td className={TD}>
                      <strong className="block text-slate-800">
                        {row.accountNumber}
                      </strong>
                      <span className="text-xs text-slate-500">
                        {row.customerName}
                      </span>
                    </td>
                    <td className={TD}>{row.property?.zone?.zoneName ?? "—"}</td>
                    <td className={TD}>
                      {row.category?.categoryName ?? "—"}
                    </td>
                    <td className={TD}>
                      <span
                        className={
                          row.hasSms ? "text-slate-700" : "text-red-500"
                        }
                      >
                        {row.customer?.phoneNumber ?? "Missing"}
                      </span>
                    </td>
                    <td className={TD}>
                      <span
                        className={
                          row.hasEmail ? "text-slate-700" : "text-amber-600"
                        }
                      >
                        {row.customer?.emailAddress ?? "Missing"}
                      </span>
                    </td>
                    <td className={`${TD} font-bold text-red-700`}>
                      {money(row.currentBalance)}
                    </td>
                    <td className={TD}>
                      <Badge value={row.accountStatus} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    No accounts match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {pages} · {rows.length} record(s) shown
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              tone="slate"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Card
        className="order-3 2xl:sticky 2xl:top-24 2xl:order-none 2xl:col-start-2 2xl:row-start-2"
        title="Campaign message and delivery"
      >
        <form
          onSubmit={submit}
          className="space-y-4"
        >
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Ready recipients
              </div>
              <div className="mt-0.5 text-xl font-bold text-slate-900">
                {selectedCount.toLocaleString()}
              </div>
            </div>
            <div className="text-right text-xs leading-5 text-slate-500">
              <div>{channels.length} channel(s) selected</div>
              <div>Maximum 1,000 accounts</div>
            </div>
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Message type
              <SearchableSelect
                className={`${INPUT} mt-1`}
                value={notificationType}
                onChange={(e) => setNotificationType(e.target.value)}
              >
                <option value="BALANCE_REMINDER">Balance reminder</option>
                <option value="GENERAL">General message</option>
              </SearchableSelect>
            </label>
            <div>
              <div className="mb-2 text-sm font-medium">Delivery channels</div>
              <div className="grid grid-cols-3 gap-2">
                {["SMS", "EMAIL", "PUSH"].map((channel) => {
                  const disabled = channel !== "SMS";
                  return (
                  <label
                    key={channel}
                    aria-disabled={disabled}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-xs font-semibold transition ${
                      disabled
                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-70"
                        : "cursor-pointer border-emerald-300 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
                    } ${
                      channels.includes(channel)
                        ? disabled ? "" : "shadow-sm"
                        : disabled ? "" : "hover:bg-emerald-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      disabled={disabled}
                      checked={channels.includes(channel)}
                      onChange={(e) =>
                        setChannels(
                          e.target.checked
                            ? [...channels, channel]
                            : channels.filter((item) => item !== channel),
                        )
                      }
                    />
                    {channel}
                    {disabled && <span className="sr-only"> unavailable</span>}
                  </label>
                  );
                })}
              </div>
            </div>
            <label className="block text-sm font-medium">
              Schedule (optional)
              <input
                type="datetime-local"
                className={`${INPUT} mt-1`}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              Email subject override (optional)
              <input
                className={`${INPUT} mt-1`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Uses the approved template"
              />
            </label>
            <label className="block text-sm font-medium">
              Custom message {customRequired ? "*" : "(optional)"}
              <textarea
                className={`${INPUT} mt-1 min-h-28`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Leave blank to use the approved template"
              />
            </label>
            <Button
              tone="green"
              className="w-full"
              disabled={
                busy ||
                !selectedCount ||
                !channels.length ||
                (allMatching && Number(audience.total) > 1000) ||
                (customRequired && !message.trim())
              }
            >
              {busy
                ? "Creating campaign…"
                : `Queue campaign for ${selectedCount.toLocaleString()} account(s)`}
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </Page>
  );
}

function NotificationSendLegacy({ modeSwitch }: { modeSwitch: ReactNode }) {
  const [targets, setTargets] = useState<Row>({
    accounts: [],
    bills: [],
    payments: [],
  });
  const [targetType, setTargetType] = useState("ACCOUNT");
  const [targetId, setTargetId] = useState("");
  const [notificationType, setNotificationType] = useState("BALANCE_REMINDER");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["SMS"]);
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const requiresCustomMessage = notificationType === "GENERAL";
  const clearFeedback = () => {
    setError("");
    setSuccess("");
  };
  useEffect(() => {
    api
      .notificationTargets()
      .then(setTargets)
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    setTargetId("");
    setNotificationType(
      targetType === "BILL"
        ? "BILL_ISSUED"
        : targetType === "PAYMENT"
          ? "PAYMENT_RECEIPT"
          : "BALANCE_REMINDER",
    );
  }, [targetType]);
  const rows =
    targetType === "BILL"
      ? (targets.bills ?? [])
      : targetType === "PAYMENT"
        ? (targets.payments ?? [])
        : (targets.accounts ?? []);
  const optionText = (row: Row) =>
    targetType === "BILL"
      ? `${row.billNumber} · ${row.account?.accountNumber} · ${row.customerName} · ${money(row.totalAmountDue)}`
      : targetType === "PAYMENT"
        ? `${row.transactionReference} · ${row.account?.accountNumber} · ${money(row.amount)}`
        : `${row.accountNumber} · ${row.customerName} · Balance ${money(row.currentBalance)}`;
  const optionId = (row: Row) =>
    targetType === "BILL"
      ? row.billId
      : targetType === "PAYMENT"
        ? row.paymentId
        : row.accountId;
  const selectedTarget = rows.find(
    (row: Row) => String(optionId(row)) === String(targetId),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const result = await api.sendNotification({
        targetType,
        targetId,
        notificationType,
        channels: selectedChannels,
        message: message || undefined,
        subject: subject || undefined,
        scheduledAt: scheduledAt
          ? new Date(scheduledAt).toISOString()
          : undefined,
        processNow: !scheduledAt,
      });
      const created = result.created?.length ?? 0;
      const skipped = result.skipped
        ?.map((item: Row) => `${item.channel}: ${item.reason}`)
        .join(" ");
      setSuccess(
        `${created} notification(s) ${scheduledAt ? "queued" : "processed"}.${skipped ? ` Skipped: ${skipped}` : ""}`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Send customer notification"
      subtitle="Use approved templates or compose a controlled one-off customer message"
      actions={
        <>
          {modeSwitch}
          <Link
            to="/notifications/history"
            className="rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white"
          >
            View history
          </Link>
        </>
      }
    >
      <Notice error={error} success={success} />
      <form
        onSubmit={submit}
        className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]"
      >
        <Card title="1. Recipient and message">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-4 md:grid-cols-2 lg:col-span-2">
              <label className="text-sm font-medium">
                Target source
                <SearchableSelect
                  className={`${INPUT} mt-1`}
                  value={targetType}
                  onChange={(e) => {
                    setTargetType(e.target.value);
                    clearFeedback();
                  }}
                >
                  <option value="ACCOUNT">Customer account</option>
                  <option value="BILL">Posted bill</option>
                  <option value="PAYMENT">Payment / receipt</option>
                </SearchableSelect>
              </label>
              <label className="text-sm font-medium">
                Message type
                <SearchableSelect
                  className={`${INPUT} mt-1`}
                  value={notificationType}
                  onChange={(e) => {
                    setNotificationType(e.target.value);
                    clearFeedback();
                  }}
                >
                  {targetType === "ACCOUNT" && (
                    <>
                      <option value="BALANCE_REMINDER">Balance reminder</option>
                      <option value="GENERAL">General message</option>
                    </>
                  )}
                  {targetType === "BILL" && (
                    <>
                      <option value="BILL_ISSUED">Bill issued</option>
                      <option value="DUE_DATE_REMINDER">
                        Due-date reminder
                      </option>
                    </>
                  )}
                  {targetType === "PAYMENT" && (
                    <>
                      <option value="PAYMENT_RECEIPT">Payment receipt</option>
                      <option value="PAYMENT_REVERSAL">Receipt cancellation</option>
                    </>
                  )}
                </SearchableSelect>
              </label>
            </div>
            <label className="block text-sm font-medium lg:col-span-2">
              Customer record
              <SearchableSelect
                required
                className={`${INPUT} mt-1`}
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  clearFeedback();
                }}
              >
                <option value="">Select a record</option>
                {rows.map((row: Row) => (
                  <option key={optionId(row)} value={optionId(row)}>
                    {optionText(row)}
                  </option>
                ))}
              </SearchableSelect>
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-sm font-medium">Delivery channels</div>
              <div className="grid grid-cols-3 gap-2">
                {["SMS", "EMAIL", "PUSH"].map((channel) => {
                  const disabled = channel !== "SMS";
                  return (
                  <label
                    key={channel}
                    aria-disabled={disabled}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      disabled
                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-70"
                        : "cursor-pointer border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm"
                    } ${
                      selectedChannels.includes(channel)
                        ? ""
                        : disabled ? "" : "hover:bg-emerald-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      disabled={disabled}
                      checked={selectedChannels.includes(channel)}
                      onChange={(e) => {
                        setSelectedChannels(
                          e.target.checked
                            ? [...selectedChannels, channel]
                            : selectedChannels.filter(
                                (item) => item !== channel,
                              ),
                        );
                        clearFeedback();
                      }}
                    />
                    {channel}
                    {disabled && <span className="sr-only"> unavailable</span>}
                  </label>
                  );
                })}
              </div>
            </div>
            <label className="block text-sm font-medium">
              Schedule (optional)
              <input
                type="datetime-local"
                className={`${INPUT} mt-1`}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Email subject override (optional)
              <input
                className={`${INPUT} mt-1`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Uses the active template by default"
              />
            </label>
            <label className="block text-sm font-medium">
              Custom message override{" "}
              {requiresCustomMessage ? "*" : "(optional)"}
              <textarea
                className={`${INPUT} mt-1 min-h-24`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  requiresCustomMessage
                    ? "Enter the general message to send"
                    : "Leave blank to use the active approved template"
                }
              />
            </label>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 lg:col-span-2">
              Simulated providers record delivery immediately without sending a
              real SMS or email. Switch to a live provider only after
              credentials and callbacks are configured.
            </div>
          </div>
        </Card>
        <Card className="xl:sticky xl:top-24" title="2. Review and send">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recipient
              </div>
              {selectedTarget ? (
                <div className="mt-2">
                  <div className="text-sm font-semibold leading-5 text-slate-900">
                    {optionText(selectedTarget)}
                  </div>
                  <div className="mt-1 text-xs font-medium text-emerald-700">
                    Ready for delivery
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">
                  Select a customer record to continue.
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">
                Selected channels
              </div>
              <div className="flex min-h-7 flex-wrap gap-2">
                {selectedChannels.length ? (
                  selectedChannels.map((channel) => (
                    <span
                      key={channel}
                      className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800"
                    >
                      {channel}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-red-600">
                    Select at least one channel.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs leading-5 text-slate-600">
              <div className="flex justify-between gap-3">
                <span>Email</span>
                <strong className="text-right text-slate-800">
                  Profile address required
                </strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>SMS</span>
                <strong className="text-right text-slate-800">
                  Phone number required
                </strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>Push</span>
                <strong className="text-right text-slate-800">
                  Device token required
                </strong>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
              Simulated providers record delivery without contacting a real
              customer. Live providers use the configured gateway.
            </div>

            <Button
              disabled={
                busy ||
                !targetId ||
                !selectedChannels.length ||
                (requiresCustomMessage && !message.trim())
              }
              tone="green"
              className="w-full"
            >
              {busy
                ? "Processing…"
                : scheduledAt
                  ? "Schedule notification"
                  : "Send notification"}
            </Button>
          </div>
        </Card>
      </form>
    </Page>
  );
}

function NotificationRegister({ queueOnly = false }: { queueOnly?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState(queueOnly ? "QUEUED" : "");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(1000);
  const [processingBatchSize, setProcessingBatchSize] = useState(1000);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const load = (pageValue = page) =>
    api
      .listNotifications({ status, channel, search, page: String(pageValue), pageSize: String(pageSize) })
      .then((result) => {
        setRows(result.items ?? []);
        setTotal(Number(result.total ?? 0));
        setPages(Math.max(1, Number(result.pages ?? 1)));
        if (pageValue > Number(result.pages ?? 1)) setPage(Math.max(1, Number(result.pages ?? 1)));
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, [status, channel, page, pageSize]);
  async function processQueue() {
    setBusy(true);
    setError("");
    try {
      const result = await api.processNotifications(
        selected.length ? selected : undefined,
        selected.length ? Math.min(selected.length, 1000) : processingBatchSize,
      );
      const processed = result.processed ?? [];
      const delivered = processed.filter((row: Row) => ["SENT", "DELIVERED"].includes(row?.deliveryStatus));
      const failed = processed.filter((row: Row) => row?.deliveryStatus === "FAILED");
      if (failed.length) {
        const reasons = Array.from(new Set(failed.map((row: Row) => row.failureReason).filter(Boolean))).slice(0, 2).join(" ");
        setError(`${failed.length} notification(s) failed to send.${reasons ? ` ${reasons}` : " Check the active SMS provider configuration."}`);
      } else if (!processed.length) {
        setSuccess("No notifications are due yet. Scheduled items will remain queued until their delivery time.");
      } else {
        setSuccess(`${delivered.length} notification(s) submitted to the delivery provider.`);
      }
      setSelected([]);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    try {
      await api.retryNotification(id);
      setSuccess("Notification retry processed.");
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Page
      title={queueOnly ? <span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4Z" /></svg></span>Delivery queue</span> : "Notification history"}
      subtitle={
        queueOnly
          ? "Process scheduled messages and retry failed deliveries"
          : "Search the complete customer communication record"
      }
      actions={
        queueOnly ? (
          <Button tone="green" disabled={busy} onClick={processQueue} className="inline-flex items-center gap-2">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8" /><path d="M20 3v5h-5" /></svg>
            {busy
              ? "Processing…"
              : selected.length
                ? `Process selected (${selected.length})`
                : "Process due queue"}
          </Button>
        ) : (
          nav
        )
      }
    >
      <Notice error={error} success={success} />
      <Card>
        <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(180px,0.65fr)_minmax(180px,0.65fr)_minmax(280px,1.4fr)]">
          <div className="relative">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-emerald-600"><path d="M4 5h16M7 12h10M10 19h4" /></svg>
          <SearchableSelect
            className={`${INPUT} pl-10`}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); setSelected([]); }}
          >
            <option value="">All statuses</option>
            <option value="QUEUED">Queued</option>
            <option value="SENT">Sent</option>
            <option value="DELIVERED">Delivered</option>
            <option value="FAILED">Failed</option>
          </SearchableSelect>
          </div>
          <div className="relative">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-emerald-600"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10" /></svg>
          <SearchableSelect
            className={`${INPUT} pl-10`}
            value={channel}
            onChange={(e) => { setChannel(e.target.value); setPage(1); setSelected([]); }}
          >
            <option value="">All channels</option>
            <option>SMS</option>
            <option>EMAIL</option>
            <option>PUSH</option>
          </SearchableSelect>
          </div>
          <div className="flex min-w-0 gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search notifications</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              className={`${INPUT} pl-10`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Recipient, account or subject"
            />
            </label>
            <Button onClick={() => { setPage(1); setSelected([]); void load(1); }}><span className="inline-flex items-center gap-1.5"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>Search</span></Button>
          </div>
        </div>
        {queueOnly && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
            <span className="flex items-center gap-2">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 flex-none text-emerald-600"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
              {selected.length
                ? `${selected.length} notification(s) selected for this batch.`
                : "Select rows, select all visible rows, or process the next due batch."}
            </span>
            <label className="flex items-center gap-2 font-semibold">
              <span>Process per run</span>
              <select
                className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-sm text-emerald-900 outline-none"
                value={processingBatchSize}
                disabled={busy || selected.length > 0}
                onChange={(event) => setProcessingBatchSize(Number(event.target.value))}
              >
                {[200, 500, 1000].map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
              </select>
            </label>
          </div>
        )}
        <nav className="mb-3 flex items-center justify-end gap-2" aria-label="Top notification pagination">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
            disabled={page <= 1}
            onClick={() => { setPage((current) => Math.max(1, current - 1)); setSelected([]); }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m15 18-6-6 6-6" /></svg>
            Previous
          </button>
          <span className="min-w-24 text-center text-sm font-semibold text-slate-600">Page {page} of {pages}</span>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
            disabled={page >= pages}
            onClick={() => { setPage((current) => Math.min(pages, current + 1)); setSelected([]); }}
          >
            Next
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </nav>
        <NotificationTable
          rows={rows}
          onRetry={retry}
          selected={queueOnly ? selected : undefined}
          onSelectionChange={queueOnly ? setSelected : undefined}
          queueMode={queueOnly}
        />
        <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>
              {total
                ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
                : "Showing 0 results"}
            </span>
            <label className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">Rows</span>
              <select
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); setSelected([]); }}
              >
                {[10, 25, 50, 100, 250, 500, 1000].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>
          <nav className="flex items-center gap-2" aria-label="Notification pagination">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
              disabled={page <= 1}
              onClick={() => { setPage((current) => Math.max(1, current - 1)); setSelected([]); }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m15 18-6-6 6-6" /></svg>
              Previous
            </button>
            <span className="min-w-24 text-center text-sm font-semibold text-slate-600">Page {page} of {pages}</span>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
              disabled={page >= pages}
              onClick={() => { setPage((current) => Math.min(pages, current + 1)); setSelected([]); }}
            >
              Next
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </nav>
        </div>
      </Card>
    </Page>
  );
}
export const NotificationQueue = () => <NotificationRegister queueOnly />;
export const NotificationHistory = () => <NotificationRegister />;

export function NotificationTemplates() {
  const user = getSessionUser();
  const isAdmin = user?.roles.includes("SYSTEM_ADMIN");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState<Row>({
    templateCode: "",
    templateName: "",
    notificationType: "GENERAL",
    channel: "SMS",
    subject: "",
    messageBody: "",
    description: "",
  });
  const load = () =>
    api
      .listNotificationTemplates()
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.createNotificationTemplate(form);
      setSuccess("Notification template created.");
      setForm({
        ...form,
        templateCode: "",
        templateName: "",
        subject: "",
        messageBody: "",
        description: "",
      });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function toggle(row: Row) {
    try {
      await api.updateNotificationTemplate(String(row.templateId), {
        status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Page
      title="Notification templates"
      subtitle="Approved reusable wording, channels and supported placeholders"
    >
      <Notice error={error} success={success} />
      <div className={`grid gap-4 ${isAdmin ? "xl:grid-cols-[1fr_2fr]" : ""}`}>
        {isAdmin && (
          <Card title="Create template">
            <form className="space-y-3" onSubmit={create}>
              <input
                required
                className={INPUT}
                placeholder="Template code"
                value={form.templateCode}
                onChange={(e) =>
                  setForm({ ...form, templateCode: e.target.value })
                }
              />
              <input
                required
                className={INPUT}
                placeholder="Template name"
                value={form.templateName}
                onChange={(e) =>
                  setForm({ ...form, templateName: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <SearchableSelect
                  className={INPUT}
                  value={form.notificationType}
                  onChange={(e) =>
                    setForm({ ...form, notificationType: e.target.value })
                  }
                >
                  {[
                    "GENERAL",
                    "BILL_ISSUED",
                    "DUE_DATE_REMINDER",
                    "BALANCE_REMINDER",
                    "PAYMENT_RECEIPT",
                    "PAYMENT_REVERSAL",
                  ].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </SearchableSelect>
                <SearchableSelect
                  className={INPUT}
                  value={form.channel}
                  onChange={(e) =>
                    setForm({ ...form, channel: e.target.value })
                  }
                >
                  <option>SMS</option>
                  <option>EMAIL</option>
                  <option>PUSH</option>
                </SearchableSelect>
              </div>
              <input
                className={INPUT}
                placeholder="Email subject (optional)"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
              <textarea
                required
                className={`${INPUT} min-h-28`}
                placeholder="Message body; e.g. Dear {{customer_name}}..."
                value={form.messageBody}
                onChange={(e) =>
                  setForm({ ...form, messageBody: e.target.value })
                }
              />
              <textarea
                className={INPUT}
                placeholder="Description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
              <Button tone="green" className="w-full">
                Create template
              </Button>
            </form>
          </Card>
        )}
        <Card title={`${rows.length} template(s)`}>
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.templateId}
                className={`group rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  row.channel === "EMAIL"
                    ? "border-l-sky-500"
                    : row.channel === "SMS"
                      ? "border-l-emerald-500"
                      : "border-l-violet-500"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-800">
                      {row.templateName}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{row.templateCode}</span>
                      <span>·</span>
                      <span>{pretty(row.notificationType)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          row.channel === "EMAIL"
                            ? "bg-sky-50 text-sky-700"
                            : row.channel === "SMS"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-violet-50 text-violet-700"
                        }`}
                      >
                        {row.channel}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge value={row.status} />
                    {isAdmin && (
                      <button
                        className="text-sm font-semibold text-aqua-700"
                        onClick={() => toggle(row)}
                      >
                        {row.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </div>
                </div>
                {row.subject && (
                  <div className="mt-3 text-sm">
                    <strong>Subject:</strong> {row.subject}
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm leading-6 text-slate-600">
                  {row.messageBody}
                </div>
                {row.description && (
                  <p className="mt-2 text-xs text-slate-400">
                    {row.description}
                  </p>
                )}
              </div>
            ))}
            {!rows.length && (
              <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center md:col-span-2">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5.1A7 7 0 0 1 3 12V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /></svg></div>
                <div className="mt-3 font-semibold text-slate-700">No providers configured</div>
                <p className="mt-1 max-w-sm text-sm text-slate-400">Add an SMS, email, or push gateway to begin delivering customer notifications.</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function NotificationProviders() {
  const user = getSessionUser();
  const isAdmin = user?.roles.includes("SYSTEM_ADMIN");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [smtpProvider, setSmtpProvider] = useState<Row | null>(null);
  const [onfonProvider, setOnfonProvider] = useState<Row | null>(null);
  const [onfonBusy, setOnfonBusy] = useState(false);
  const [onfonResult, setOnfonResult] = useState("");
  const [onfonTestPhone, setOnfonTestPhone] = useState("");
  const [onfonForm, setOnfonForm] = useState<Row>({
    driver: "ONFON",
    senderId: "SAMDAMTE",
    endpointUrl: "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS",
    apiKey: "",
    clientId: "",
    accessKey: "",
    callbackToken: "",
  });
  const [smtpBusy, setSmtpBusy] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [smtpTestResult, setSmtpTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [smtpForm, setSmtpForm] = useState<Row>({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    user: "",
    password: "",
    fromEmail: "",
    fromName: "AquaFlow",
    replyTo: "",
  });
  const [form, setForm] = useState<Row>({
    providerCode: "",
    providerName: "",
    channel: "SMS",
    providerType: "SIMULATED",
    endpointUrl: "",
    isDefault: false,
    remarks: "",
  });
  const load = () =>
    api
      .listNotificationProviders()
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await api.createNotificationProvider({
        ...form,
        endpointUrl: form.endpointUrl || undefined,
      });
      setSuccess("Notification provider created.");
      setForm({
        ...form,
        providerCode: "",
        providerName: "",
        endpointUrl: "",
        remarks: "",
      });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function update(row: Row, data: Row) {
    try {
      await api.updateNotificationProvider(String(row.providerId), data);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  function configureSmtp(row: Row) {
    const configuration = row.configuration ?? {};
    setSmtpProvider(row);
    setSmtpForm({
      host: configuration.host ?? "smtp.gmail.com",
      port: configuration.port ?? 587,
      secure: configuration.secure ?? false,
      user: configuration.user ?? "",
      password: "",
      fromEmail: configuration.fromEmail ?? configuration.user ?? "",
      fromName: configuration.fromName ?? "AquaFlow",
      replyTo: configuration.replyTo ?? "",
    });
    setTestRecipient(configuration.user ?? "");
    setError("");
    setSuccess("");
    setSmtpTestResult(null);
  }
  async function saveSmtp(event: FormEvent) {
    event.preventDefault();
    if (!smtpProvider) return;
    setSmtpBusy(true);
    setError("");
    try {
      const saved = await api.configureSmtpProvider(
        String(smtpProvider.providerId),
        {
          ...smtpForm,
          port: Number(smtpForm.port),
          password: smtpForm.password || undefined,
          replyTo: smtpForm.replyTo || undefined,
        },
      );
      setSuccess(
        "SMTP settings saved securely. The password cannot be displayed again.",
      );
      setSmtpProvider({ ...smtpProvider, ...saved });
      setSmtpForm({ ...smtpForm, password: "" });
      setSmtpTestResult(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSmtpBusy(false);
    }
  }
  async function testSmtp() {
    if (!smtpProvider || !testRecipient) return;
    setSmtpBusy(true);
    setError("");
    setSmtpTestResult(null);
    try {
      const result = await api.testNotificationProvider(
        String(smtpProvider.providerId),
        testRecipient,
      );
      setSuccess(result.message ?? "SMTP test email accepted.");
      setSmtpTestResult({
        ok: true,
        message: result.message ?? "SMTP test email accepted.",
      });
    } catch (e) {
      const message = errorText(e);
      setError(message);
      setSmtpTestResult({ ok: false, message });
    } finally {
      setSmtpBusy(false);
    }
  }
  function generateCallbackToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  function configureOnfon(row: Row) {
    const configuration = row.configuration ?? {};
    setOnfonProvider(row);
    setOnfonForm({
      driver: "ONFON",
      senderId: configuration.senderId ?? "SAMDAMTE",
      endpointUrl: configuration.endpointUrl ?? row.endpointUrl ?? "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS",
      apiKey: "",
      clientId: "",
      accessKey: "",
      callbackToken: row.secretConfiguredAt ? "" : generateCallbackToken(),
    });
    setOnfonResult("");
    setError("");
    setSuccess("");
  }
  async function saveOnfon(event: FormEvent) {
    event.preventDefault();
    if (!onfonProvider) return;
    setOnfonBusy(true);
    setError("");
    try {
      const saved = await api.configureOnfonProvider(String(onfonProvider.providerId), {
        ...onfonForm,
        apiKey: onfonForm.apiKey || undefined,
        clientId: onfonForm.clientId || undefined,
        accessKey: onfonForm.accessKey || undefined,
        callbackToken: onfonForm.callbackToken || undefined,
      });
      setOnfonProvider({ ...onfonProvider, ...saved });
      setOnfonForm({ ...onfonForm, apiKey: "", clientId: "", accessKey: "" });
      setSuccess("Onfon settings saved securely.");
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setOnfonBusy(false); }
  }
  async function checkOnfonBalance() {
    if (!onfonProvider) return;
    setOnfonBusy(true); setError(""); setOnfonResult("");
    try {
      const result = await api.getOnfonBalance(String(onfonProvider.providerId));
      setOnfonResult(`Available balance: ${result.balance}`);
    } catch (e) { setError(errorText(e)); }
    finally { setOnfonBusy(false); }
  }
  async function testOnfon() {
    if (!onfonProvider || !onfonTestPhone) return;
    setOnfonBusy(true); setError(""); setOnfonResult("");
    try {
      const result = await api.testOnfonProvider(String(onfonProvider.providerId), onfonTestPhone, "Samdamte Water: your Onfon SMS integration is working correctly.");
      setOnfonResult(`${result.message} Reference: ${result.reference}`);
    } catch (e) { setError(errorText(e)); }
    finally { setOnfonBusy(false); }
  }
  return (
    <Page
      title="Notification providers"
      subtitle="Delivery gateway configuration and safe testing environments"
    >
      <Notice error={error} success={success} />
      <div className={`grid gap-6 ${isAdmin ? "lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.65fr)]" : ""}`}>
        {isAdmin && (
          <Card title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg></span>Add provider</span>}>
            <form className="space-y-4" onSubmit={create}>
              <label className="block text-sm font-semibold text-slate-700">Provider code<span className="mt-1 block text-xs font-normal text-slate-400">A unique internal identifier</span><input required className={`${INPUT} mt-1.5`} placeholder="e.g. ONFON_SMS" value={form.providerCode} onChange={(e) => setForm({ ...form, providerCode: e.target.value })} /></label>
              <label className="block text-sm font-semibold text-slate-700">Provider name<span className="mt-1 block text-xs font-normal text-slate-400">A recognizable display name</span><input required className={`${INPUT} mt-1.5`} placeholder="e.g. Onfon Media" value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <SearchableSelect
                  className={INPUT}
                  value={form.channel}
                  onChange={(e) =>
                    setForm({ ...form, channel: e.target.value })
                  }
                >
                  <option>SMS</option>
                  <option>EMAIL</option>
                  <option>PUSH</option>
                </SearchableSelect>
                <SearchableSelect
                  className={INPUT}
                  value={form.providerType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      providerType: e.target.value,
                      ...(e.target.value === "SMTP"
                        ? { channel: "EMAIL" }
                        : e.target.value === "HTTP_API"
                          ? { channel: "SMS", endpointUrl: "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS" }
                        : {}),
                    })
                  }
                >
                  <option value="SIMULATED">Simulated</option>
                  <option value="SMTP">SMTP email</option>
                  <option value="HTTP_API">Onfon SMS (HTTP API)</option>
                </SearchableSelect>
              </div>
              {form.providerType === "HTTP_API" && (
                <label className="block text-sm font-semibold text-slate-700">API endpoint<input className={`${INPUT} mt-1.5`} type="url" placeholder="https://api.provider.com/..." value={form.endpointUrl} onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })} /></label>
              )}
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50/50">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={form.isDefault}
                  onChange={(e) =>
                    setForm({ ...form, isDefault: e.target.checked })
                  }
                />
                Set as default for this channel
              </label>
              <label className="block text-sm font-semibold text-slate-700">Notes <span className="font-normal text-slate-400">(optional)</span><textarea className={`${INPUT} mt-1.5 min-h-24`} placeholder="Add internal configuration notes…" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
              <Button tone="green" className="w-full">
                Add provider
              </Button>
            </form>
          </Card>
        )}
        <Card title={<span className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h6" /></svg></span>Configured providers</span><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">{rows.length}</span></span>}>
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.providerId} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-slate-200/60">
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="text-base font-bold text-slate-900">{row.providerName}</div>
                    <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                      {row.providerCode}
                    </div>
                  </div>
                  <Badge value={row.status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className="text-slate-400">Channel</span>
                    <div className="font-semibold">{row.channel}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className="text-slate-400">Type</span>
                    <div className="font-semibold">
                      {pretty(row.providerType)}
                    </div>
                  </div>
                </div>
                {row.isDefault && (
                  <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    Default provider
                  </div>
                )}
                <p className="mt-3 text-xs italic text-slate-400">
                  {row.remarks || "No provider notes."}
                </p>
                {isAdmin && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    {row.providerType === "SMTP" && (
                      <button
                        className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        onClick={() => configureSmtp(row)}
                      >
                        Configure SMTP
                      </button>
                    )}
                    {row.providerType === "HTTP_API" && row.channel === "SMS" && (
                      <button
                        className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        onClick={() => configureOnfon(row)}
                      >
                        Configure Onfon
                      </button>
                    )}
                    <button
                      className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
                      onClick={() => update(row, { isDefault: true })}
                    >
                      Make default
                    </button>
                    <button
                      className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                      onClick={() =>
                        update(row, {
                          status:
                            row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        })
                      }
                    >
                      {row.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
      {isAdmin && smtpProvider && (
        <Card
          className="mt-4"
          title={`SMTP settings · ${smtpProvider.providerName}`}
        >
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Use a newly generated Gmail app password. The password is encrypted
            before storage and never returned to this page. For Gmail, the From
            address should normally match the authenticated Gmail account unless
            a verified alias is configured.
          </div>
          <form onSubmit={saveSmtp} className="grid gap-4 lg:grid-cols-3">
            <label className="text-sm font-medium">
              SMTP host
              <input
                required
                className={`${INPUT} mt-1`}
                value={smtpForm.host}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, host: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium">
              Port
              <input
                required
                type="number"
                min="1"
                max="65535"
                className={`${INPUT} mt-1`}
                value={smtpForm.port}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, port: e.target.value })
                }
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm font-medium">
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={smtpForm.secure}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, secure: e.target.checked })
                }
              />
              Direct TLS (normally enabled for port 465; leave off for STARTTLS
              port 587)
            </label>
            <label className="text-sm font-medium">
              SMTP username
              <input
                required
                className={`${INPUT} mt-1`}
                value={smtpForm.user}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, user: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium">
              App password
              <input
                type="password"
                className={`${INPUT} mt-1`}
                autoComplete="new-password"
                placeholder={
                  smtpProvider.secretConfiguredAt
                    ? "Leave blank to keep saved password"
                    : "Required"
                }
                value={smtpForm.password}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, password: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium">
              Sender name
              <input
                required
                className={`${INPUT} mt-1`}
                value={smtpForm.fromName}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, fromName: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium">
              From email
              <input
                required
                type="email"
                className={`${INPUT} mt-1`}
                value={smtpForm.fromEmail}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, fromEmail: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium">
              Reply-to email (optional)
              <input
                type="email"
                className={`${INPUT} mt-1`}
                value={smtpForm.replyTo}
                onChange={(e) =>
                  setSmtpForm({ ...smtpForm, replyTo: e.target.value })
                }
              />
            </label>
            <div className="flex items-end">
              <Button tone="green" className="w-full" disabled={smtpBusy}>
                {smtpBusy ? "Saving…" : "Save encrypted settings"}
              </Button>
            </div>
          </form>
          <div className="mt-5 grid gap-3 border-t pt-4 md:grid-cols-[1fr_auto]">
            <input
              type="email"
              className={INPUT}
              placeholder="Test recipient email"
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
            />
            <Button
              type="button"
              onClick={testSmtp}
              disabled={smtpBusy || !testRecipient}
            >
              Verify and send test email
            </Button>
          </div>
          {smtpTestResult && (
            <div
              className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
                smtpTestResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {smtpTestResult.message}
            </div>
          )}
        </Card>
      )}
      {isAdmin && onfonProvider && (
        <Card className="mt-4" title={`Onfon SMS settings · ${onfonProvider.providerName}`}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-emerald-50/60 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5.1A7 7 0 0 1 3 12V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>
              </div>
              <div><div className="font-bold text-slate-900">Onfon SMS gateway</div><div className="text-sm text-slate-500">Secure messaging and delivery tracking</div></div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              {onfonProvider.secretConfiguredAt ? "Credentials secured" : "Setup required"}
            </div>
          </div>
          <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-sm font-bold text-emerald-700 ring-1 ring-emerald-100">1</span><div><div className="text-base font-bold text-slate-900">Gateway configuration</div><div className="text-xs text-slate-500">Sender identity, endpoint and encrypted API credentials</div></div></div>
          <form onSubmit={saveOnfon} className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-3">
            <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium">
              Approved sender ID
              <input required className={`${INPUT} mt-1`} value={onfonForm.senderId} onChange={(e) => setOnfonForm({ ...onfonForm, senderId: e.target.value })} />
            </label>
            <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium lg:col-span-2">
              SMS endpoint
              <input required type="url" className={`${INPUT} mt-1`} value={onfonForm.endpointUrl} onChange={(e) => setOnfonForm({ ...onfonForm, endpointUrl: e.target.value })} />
            </label>
            {[
              ["apiKey", "API key"],
              ["clientId", "Client ID"],
              ["accessKey", "Access key"],
            ].map(([key, label]) => (
              <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium" key={key}>
                {label}
                <input
                  type="password"
                  autoComplete="new-password"
                  className={`${INPUT} mt-1`}
                  placeholder={onfonProvider.secretConfiguredAt ? "Leave blank to keep saved value" : "Required"}
                  value={onfonForm[key]}
                  onChange={(e) => setOnfonForm({ ...onfonForm, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium lg:col-span-2">
              Delivery callback token
              <input
                type="password"
                autoComplete="new-password"
                className={`${INPUT} mt-1`}
                placeholder={onfonProvider.secretConfiguredAt ? "Leave blank to keep saved token" : "Required"}
                value={onfonForm.callbackToken}
                onChange={(e) => setOnfonForm({ ...onfonForm, callbackToken: e.target.value })}
              />
            </label>
            <div className="flex items-end">
              <Button type="button" tone="slate" className="w-full" onClick={() => setOnfonForm({ ...onfonForm, callbackToken: generateCallbackToken() })}>
                Generate secure token
              </Button>
            </div>
            {onfonForm.callbackToken && (
              <label className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-sm font-medium lg:col-span-3">
                Delivery-report URL to register with Onfon
                <input
                  readOnly
                  className={`${INPUT} mt-1 bg-slate-50 font-mono text-xs`}
                  value={`${window.location.origin}/api/notifications/onfon/dlr?token=${onfonForm.callbackToken}`}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
            <div className="lg:col-span-3 flex justify-end">
              <Button tone="green" disabled={onfonBusy}>{onfonBusy ? "Saving…" : "Save encrypted Onfon settings"}</Button>
            </div>
          </form>
          <div className="mb-3 mt-6 flex items-center gap-2 border-t border-slate-100 pt-5"><span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-sm font-bold text-emerald-700 ring-1 ring-emerald-100">2</span><div><div className="text-base font-bold text-slate-900">Connection tools</div><div className="text-xs text-slate-500">Send a live test or confirm your Onfon wallet balance</div></div></div>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-[1fr_auto_auto]">
            <input className={INPUT} placeholder="Test mobile number, e.g. 0712345678" value={onfonTestPhone} onChange={(e) => setOnfonTestPhone(e.target.value)} />
            <Button type="button" onClick={testOnfon} disabled={onfonBusy || !onfonTestPhone}>Send test SMS</Button>
            <Button type="button" tone="slate" onClick={checkOnfonBalance} disabled={onfonBusy}>Check balance</Button>
          </div>
          {onfonResult && <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 h-4 w-4 flex-none"><path d="m5 12 4 4L19 6" /></svg><span>{onfonResult}</span></div>}
        </Card>
      )}
    </Page>
  );
}
