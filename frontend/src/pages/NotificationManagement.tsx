import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";

type Row = Record<string, any>;
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] text-slate-700 outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";
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
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:px-6 lg:py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>
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
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b px-4 py-3 font-semibold text-slate-800">
          {title}
        </div>
      )}
      <div className="p-4">{children}</div>
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
    blue: "bg-aqua-700",
    green: "bg-emerald-600",
    red: "bg-red-600",
    orange: "bg-orange-500",
    slate: "bg-slate-600",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${colors[tone]} ${props.className ?? ""}`}
    />
  );
}
function Notice({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
    >
      {error || success}
    </div>
  );
}
function Badge({ value }: { value: string }) {
  const colors: Row = {
    DELIVERED: "bg-emerald-50 text-emerald-700",
    SENT: "bg-blue-50 text-blue-700",
    QUEUED: "bg-amber-50 text-amber-700",
    FAILED: "bg-red-50 text-red-700",
    ACTIVE: "bg-emerald-50 text-emerald-700",
    INACTIVE: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${colors[value] ?? "bg-slate-100 text-slate-600"}`}
    >
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
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Recent notification activity">
          <NotificationTable rows={data.recent ?? []} compact />
        </Card>
        <Card title="Messages by channel">
          <div className="space-y-3">
            {(data.byChannel ?? []).map((row: Row) => (
              <div
                key={row.channel}
                className="flex items-center justify-between rounded-xl border px-4 py-3"
              >
                <span className="font-semibold">{row.channel}</span>
                <span className="text-xl font-bold text-aqua-700">
                  {row.count}
                </span>
              </div>
            ))}
            {!(data.byChannel ?? []).length && (
              <p className="py-8 text-center text-slate-400">
                No messages have been created yet.
              </p>
            )}
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
}: {
  rows: Row[];
  compact?: boolean;
  onRetry?: (id: string) => void;
  selected?: string[];
  onSelectionChange?: (ids: string[]) => void;
}) {
  const selectableIds = rows
    .filter((row) => ["QUEUED", "FAILED"].includes(row.deliveryStatus))
    .map((row) => String(row.notificationId));
  const selectionEnabled = Boolean(selected && onSelectionChange);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[760px]">
        <thead>
          <tr>
            {selectionEnabled && (
              <th className={TH}>
                <input
                  aria-label="Select all visible queued notifications"
                  type="checkbox"
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
          {rows.map((row) => (
            <tr className="border-t border-slate-100" key={row.notificationId}>
              {selectionEnabled && (
                <td className={TD}>
                  {["QUEUED", "FAILED"].includes(row.deliveryStatus) ? (
                    <input
                      aria-label={`Select notification ${row.notificationId}`}
                      type="checkbox"
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
              <td className={TD}>{dateTime(row.createdAt)}</td>
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
                      className="font-semibold text-aqua-700"
                      onClick={() => onRetry(String(row.notificationId))}
                    >
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
                className="px-4 py-14 text-center text-slate-400"
              >
                No notifications found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function NotificationSend() {
  const [mode, setMode] = useState<"SINGLE" | "BULK">("SINGLE");
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
    </div>
  );
  return (
    mode === "SINGLE"
      ? <NotificationSendLegacy modeSwitch={modeSwitch} />
      : <BulkNotificationSend modeSwitch={modeSwitch} />
  );
}

function BulkNotificationSend({ modeSwitch }: { modeSwitch: ReactNode }) {
  const [filters, setFilters] = useState({
    search: "",
    minimumBalance: "0.01",
    accountStatus: "ACTIVE",
  });
  const [applied, setApplied] = useState(filters);
  const [audience, setAudience] = useState<Row>({
    items: [],
    total: 0,
    pageSize: 25,
    totalBalance: 0,
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [channels, setChannels] = useState<string[]>(["EMAIL"]);
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
    setLoading(true);
    api
      .notificationAudience({
        ...applied,
        page: String(page),
        pageSize: "25",
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
    Math.ceil(Number(audience.total) / Number(audience.pageSize ?? 25)),
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
      setSuccess(
        `${Number(result.created).toLocaleString()} notification(s) queued for ${Number(result.accounts).toLocaleString()} account(s). Process them from the delivery queue in controlled batches.`,
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
          <div className="grid gap-3 md:grid-cols-3">
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
              Account status
              <select
                className={`${INPUT} mt-1`}
                value={filters.accountStatus}
                onChange={(e) =>
                  setFilters({ ...filters, accountStatus: e.target.value })
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="">All statuses</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="INACTIVE">Inactive</option>
              </select>
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
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr>
                <th className={TH}>
                  <input
                    type="checkbox"
                    aria-label="Select all accounts on this page"
                    checked={allMatching || allPageSelected}
                    disabled={allMatching}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </th>
                <th className={TH}>Account / customer</th>
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
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    Loading audience…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row: Row) => (
                  <tr key={row.accountId} className="border-t">
                    <td className={TD}>
                      <input
                        type="checkbox"
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
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
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
              <select
                className={`${INPUT} mt-1`}
                value={notificationType}
                onChange={(e) => setNotificationType(e.target.value)}
              >
                <option value="BALANCE_REMINDER">Balance reminder</option>
                <option value="GENERAL">General message</option>
              </select>
            </label>
            <div>
              <div className="mb-2 text-sm font-medium">Delivery channels</div>
              <div className="grid grid-cols-3 gap-2">
                {["SMS", "EMAIL", "PUSH"].map((channel) => (
                  <label
                    key={channel}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-xs font-semibold ${
                      channels.includes(channel)
                        ? "border-sky-200 bg-sky-50 text-sky-800"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
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
                  </label>
                ))}
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
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["EMAIL"]);
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
                <select
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
                </select>
              </label>
              <label className="text-sm font-medium">
                Message type
                <select
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
                      <option value="PAYMENT_REVERSAL">Payment reversal</option>
                    </>
                  )}
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium lg:col-span-2">
              Customer record
              <select
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
              </select>
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-sm font-medium">Delivery channels</div>
              <div className="grid grid-cols-3 gap-2">
                {["SMS", "EMAIL", "PUSH"].map((channel) => (
                  <label
                    key={channel}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium ${
                      selectedChannels.includes(channel)
                        ? "border-sky-300 text-sky-800 shadow-sm"
                        : "border-slate-200 text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
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
                  </label>
                ))}
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
  const load = () =>
    api
      .listNotifications({ status, channel, search })
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, [status, channel]);
  async function processQueue() {
    setBusy(true);
    setError("");
    try {
      const result = await api.processNotifications(
        selected.length ? selected : undefined,
      );
      setSuccess(
        `${result.processed?.length ?? 0} due notification(s) processed.`,
      );
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
      title={queueOnly ? "Notification queue" : "Notification history"}
      subtitle={
        queueOnly
          ? "Process scheduled messages and retry failed deliveries"
          : "Search the complete customer communication record"
      }
      actions={
        queueOnly ? (
          <Button tone="green" disabled={busy} onClick={processQueue}>
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
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <select
            className={INPUT}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="QUEUED">Queued</option>
            <option value="SENT">Sent</option>
            <option value="DELIVERED">Delivered</option>
            <option value="FAILED">Failed</option>
          </select>
          <select
            className={INPUT}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">All channels</option>
            <option>SMS</option>
            <option>EMAIL</option>
            <option>PUSH</option>
          </select>
          <div className="flex gap-2">
            <input
              className={INPUT}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Recipient, account or subject"
            />
            <Button onClick={load}>Search</Button>
          </div>
        </div>
        {queueOnly && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            <span>
              {selected.length
                ? `${selected.length} notification(s) selected for this batch.`
                : "Select rows, select all visible rows, or process the next due batch."}
            </span>
            <span className="font-semibold">Maximum 200 processed per run</span>
          </div>
        )}
        <NotificationTable
          rows={rows}
          onRetry={retry}
          selected={queueOnly ? selected : undefined}
          onSelectionChange={queueOnly ? setSelected : undefined}
        />
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
                <select
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
                </select>
                <select
                  className={INPUT}
                  value={form.channel}
                  onChange={(e) =>
                    setForm({ ...form, channel: e.target.value })
                  }
                >
                  <option>SMS</option>
                  <option>EMAIL</option>
                  <option>PUSH</option>
                </select>
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
  return (
    <Page
      title="Notification providers"
      subtitle="Delivery gateway configuration and safe testing environments"
    >
      <Notice error={error} success={success} />
      <div className={`grid gap-4 ${isAdmin ? "xl:grid-cols-[1fr_2fr]" : ""}`}>
        {isAdmin && (
          <Card title="Add provider">
            <form className="space-y-3" onSubmit={create}>
              <input
                required
                className={INPUT}
                placeholder="Provider code"
                value={form.providerCode}
                onChange={(e) =>
                  setForm({ ...form, providerCode: e.target.value })
                }
              />
              <input
                required
                className={INPUT}
                placeholder="Provider name"
                value={form.providerName}
                onChange={(e) =>
                  setForm({ ...form, providerName: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  className={INPUT}
                  value={form.channel}
                  onChange={(e) =>
                    setForm({ ...form, channel: e.target.value })
                  }
                >
                  <option>SMS</option>
                  <option>EMAIL</option>
                  <option>PUSH</option>
                </select>
                <select
                  className={INPUT}
                  value={form.providerType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      providerType: e.target.value,
                      ...(e.target.value === "SMTP"
                        ? { channel: "EMAIL" }
                        : {}),
                    })
                  }
                >
                  <option value="SIMULATED">Simulated</option>
                  <option value="SMTP">SMTP email</option>
                  <option value="HTTP_API">HTTP API</option>
                </select>
              </div>
              {form.providerType === "HTTP_API" && (
                <input
                  className={INPUT}
                  type="url"
                  placeholder="Provider endpoint URL"
                  value={form.endpointUrl}
                  onChange={(e) =>
                    setForm({ ...form, endpointUrl: e.target.value })
                  }
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) =>
                    setForm({ ...form, isDefault: e.target.checked })
                  }
                />
                Set as default for this channel
              </label>
              <textarea
                className={INPUT}
                placeholder="Configuration notes"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
              <Button tone="green" className="w-full">
                Add provider
              </Button>
            </form>
          </Card>
        )}
        <Card title={`${rows.length} provider(s)`}>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.providerId} className="rounded-xl border p-4">
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="font-semibold">{row.providerName}</div>
                    <div className="text-xs text-slate-400">
                      {row.providerCode}
                    </div>
                  </div>
                  <Badge value={row.status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-slate-400">Channel</span>
                    <div className="font-semibold">{row.channel}</div>
                  </div>
                  <div>
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
                <p className="mt-3 text-xs text-slate-500">
                  {row.remarks || "No provider notes."}
                </p>
                {isAdmin && (
                  <div className="mt-3 flex flex-wrap gap-3 border-t pt-3">
                    {row.providerType === "SMTP" && (
                      <button
                        className="text-sm font-semibold text-emerald-700"
                        onClick={() => configureSmtp(row)}
                      >
                        Configure SMTP
                      </button>
                    )}
                    <button
                      className="text-sm font-semibold text-aqua-700"
                      onClick={() => update(row, { isDefault: true })}
                    >
                      Make default
                    </button>
                    <button
                      className="text-sm font-semibold text-slate-600"
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
    </Page>
  );
}
