import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { exportExcel } from "../lib/meterFiles";

type Row = Record<string, any>;
const today = new Date().toISOString().slice(0, 10);
const money = (value: unknown) =>
  `KSh ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const input =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";
const th =
  "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500";
const td = "border-t border-slate-100 px-4 py-3 text-sm text-slate-700";

function Metric({
  label,
  value,
  tone = "sky",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "sky" | "green" | "amber";
}) {
  const colors =
    tone === "green"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : "border-sky-100 bg-sky-50 text-sky-700";
  return (
    <div className={`rounded-2xl border p-4 ${colors}`}>
      <div className="text-xs font-bold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-slate-900">{value}</div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden="true"
    />
  );
}

export default function Reports() {
  const [tab, setTab] = useState<"income" | "coverage">("income");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [weekday, setWeekday] = useState("");
  const [channels, setChannels] = useState<Row[]>([]);
  const [channelId, setChannelId] = useState("");
  const [zones, setZones] = useState<Row[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [income, setIncome] = useState<Row | null>(null);
  const [cycles, setCycles] = useState<Row[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [coverage, setCoverage] = useState<Row | null>(null);
  const [groupType, setGroupType] = useState("");
  const [readingStatus, setReadingStatus] = useState("");
  const [groupName, setGroupName] = useState("");
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.listReadingCycles(), api.listPaymentChannels(), api.listZones()])
      .then(([items, paymentChannels, zoneItems]) => {
        setCycles(items);
        setChannels(paymentChannels);
        setZones(zoneItems);
        const preferred =
          items.find((item: Row) => item.status === "OPEN") ?? items[0];
        if (preferred) setCycleId(String(preferred.readingCycleId));
      })
      .catch((err) => setError(err.message));
  }, []);

  async function loadIncome() {
    setIncomeLoading(true);
    setError("");
    try {
      setIncome(await api.dailyIncomeReport(from, to, channelId, zoneId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIncomeLoading(false);
    }
  }
  async function loadCoverage() {
    if (!cycleId) return;
    setCoverageLoading(true);
    setError("");
    try {
      setCoverage(await api.meterReadingCoverageReport(cycleId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCoverageLoading(false);
    }
  }
  function showMeters(
    groupTypeValue: string,
    groupNameValue: string,
    statusValue: "READ" | "UNREAD",
  ) {
    setGroupType(groupTypeValue);
    setGroupName(groupNameValue);
    setReadingStatus(statusValue);
    window.setTimeout(() => {
      document
        .getElementById("meter-details")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }
  useEffect(() => {
    void loadIncome();
  }, []);
  useEffect(() => {
    if (cycleId) void loadCoverage();
  }, [cycleId]);

  useEffect(() => {
    setFiltering(true);
    const timer = window.setTimeout(() => setFiltering(false), 180);
    return () => window.clearTimeout(timer);
  }, [weekday, groupType, groupName, readingStatus]);

  const incomeRows = useMemo(
    () =>
      (income?.rows ?? []).filter(
        (row: Row) =>
          !weekday ||
          String(new Date(`${row.date}T00:00:00.000Z`).getUTCDay()) === weekday,
      ),
    [income, weekday],
  );
  const incomeTotals = useMemo(
    () =>
      incomeRows.reduce(
        (totals: { amount: number; transactions: number }, row: Row) => ({
          amount: totals.amount + Number(row.amount ?? 0),
          transactions: totals.transactions + Number(row.transactions ?? 0),
        }),
        { amount: 0, transactions: 0 },
      ),
    [incomeRows],
  );

  const meterRows = useMemo(
    () =>
      (coverage?.meters ?? []).filter(
        (meter: Row) =>
          (!groupType || meter.groupType === groupType) &&
          (!readingStatus || meter.status === readingStatus) &&
          (!groupName || meter.groupName === groupName),
      ),
    [coverage, groupType, readingStatus, groupName],
  );
  const groupNames = useMemo<string[]>(
    () =>
      [
        ...new Set<string>(
          (coverage?.meters ?? [])
            .filter((meter: Row) => !groupType || meter.groupType === groupType)
            .map((meter: Row) => String(meter.groupName)),
        ),
      ].sort(),
    [coverage, groupType],
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Income and meter-reading operational reports in one place
        </p>
      </div>
      <div className="mb-5 flex gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <button
          onClick={() => setTab("income")}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "income" ? "bg-sky-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Daily Income
        </button>
        <button
          onClick={() => setTab("coverage")}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "coverage" ? "bg-sky-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Read vs Unread Meters
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {tab === "income" ? (
        <>
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto_auto]">
              <label className="text-xs font-semibold text-slate-600">
                From
                <input
                  type="date"
                  className={`${input} mt-1`}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                To
                <input
                  type="date"
                  className={`${input} mt-1`}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Day of week
                <select
                  className={`${input} mt-1`}
                  value={weekday}
                  onChange={(e) => setWeekday(e.target.value)}
                >
                  <option value="">All days</option>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                  <option value="0">Sunday</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Payment channel
                <select
                  className={`${input} mt-1`}
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="">All channels</option>
                  {channels.map((channel) => (
                    <option key={channel.channelId} value={channel.channelId}>
                      {channel.channelName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Zone
                <select
                  className={`${input} mt-1`}
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  <option value="">All zones</option>
                  {zones.map((zone) => (
                    <option key={zone.zoneId} value={zone.zoneId}>
                      {zone.zoneName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={incomeLoading}
                onClick={() => void loadIncome()}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-sky-700 px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {incomeLoading && <Spinner />}
                {incomeLoading ? "Loading..." : "Run report"}
              </button>
              <button
                disabled={incomeLoading || filtering}
                onClick={() =>
                  void exportExcel(
                    "daily-income-report.xlsx",
                    "Daily Income",
                    incomeRows,
                  )
                }
                className="mt-5 h-10 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Export Excel
              </button>
            </div>
          </div>
          {(incomeLoading || filtering) && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
              <Spinner />
              {incomeLoading
                ? "Loading income data..."
                : "Applying day filter..."}
            </div>
          )}
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <Metric
              label="Total posted income"
              value={money(incomeTotals.amount)}
              tone="green"
            />
            <Metric label="Transactions" value={incomeTotals.transactions} />
          </div>
          <div
            className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-opacity ${incomeLoading || filtering ? "opacity-50" : "opacity-100"}`}
          >
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Day</th>
                  <th className={th}>Payment channel</th>
                  <th className={`${th} text-right`}>Transactions</th>
                  <th className={`${th} text-right`}>Income</th>
                </tr>
              </thead>
              <tbody>
                {incomeRows.map((row: Row) => (
                  <tr key={`${row.date}-${row.channel}`}>
                    <td className={td}>{row.date}</td>
                    <td className={td}>
                      {new Date(`${row.date}T00:00:00.000Z`).toLocaleDateString(
                        "en-KE",
                        { weekday: "long", timeZone: "UTC" },
                      )}
                    </td>
                    <td className={td}>{row.channel}</td>
                    <td className={`${td} text-right`}>
                      <Link
                        className="inline-flex min-w-10 items-center justify-center rounded-lg bg-sky-50 px-3 py-1.5 font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 transition hover:bg-sky-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-300"
                        title={`View ${row.transactions} transactions for ${row.date}`}
                        to={`/payments/register?status=POSTED&from=${encodeURIComponent(row.date)}&to=${encodeURIComponent(row.date)}&channelId=${encodeURIComponent(row.channelId)}${zoneId ? `&zoneId=${encodeURIComponent(zoneId)}` : ""}`}
                      >
                        {row.transactions}
                      </Link>
                    </td>
                    <td className={`${td} text-right font-bold`}>
                      {money(row.amount)}
                    </td>
                  </tr>
                ))}
                {!incomeRows.length && (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-12 text-center text-sm text-slate-400"
                    >
                      No posted income matches this period and day.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-semibold text-slate-600">
                Reading cycle
                <select
                  disabled={coverageLoading}
                  className={`${input} mt-1 disabled:opacity-60`}
                  value={cycleId}
                  onChange={(e) => setCycleId(e.target.value)}
                >
                  <option value="">Select cycle</option>
                  {cycles.map((cycle) => (
                    <option
                      key={cycle.readingCycleId}
                      value={cycle.readingCycleId}
                    >
                      {cycle.cycleName} ({cycle.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Group
                <select
                  className={`${input} mt-1`}
                  value={groupType}
                  onChange={(e) => {
                    setGroupType(e.target.value);
                    setGroupName("");
                  }}
                >
                  <option value="">Zones & bulk</option>
                  <option value="ZONE">Zones only</option>
                  <option value="BULK">Bulk only</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Zone / group
                <select
                  className={`${input} mt-1`}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                >
                  <option value="">All groups</option>
                  {groupNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Reading status
                <select
                  className={`${input} mt-1`}
                  value={readingStatus}
                  onChange={(e) => setReadingStatus(e.target.value)}
                >
                  <option value="">Read & unread</option>
                  <option value="READ">Read</option>
                  <option value="UNREAD">Unread</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                disabled={coverageLoading || filtering}
                onClick={() =>
                  void exportExcel(
                    "meter-reading-coverage.xlsx",
                    "Meter Coverage",
                    meterRows,
                  )
                }
                className="h-10 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Export filtered meters
              </button>
            </div>
          </div>
          {(coverageLoading || filtering) && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
              <Spinner />
              {coverageLoading
                ? "Loading reading-cycle coverage..."
                : "Applying meter filters..."}
            </div>
          )}
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Total meters" value={coverage?.total ?? 0} />
            <Metric
              label="Read meters"
              value={coverage?.read ?? 0}
              tone="green"
            />
            <Metric
              label="Unread meters"
              value={coverage?.unread ?? 0}
              tone="amber"
            />
          </div>
          <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b px-4 py-3 font-bold text-slate-800">
              Coverage by zone and bulk
            </div>
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Type</th>
                  <th className={th}>Zone / group</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Read</th>
                  <th className={`${th} text-right`}>Unread</th>
                </tr>
              </thead>
              <tbody>
                {(coverage?.groups ?? []).map((row: Row) => (
                  <tr key={`${row.groupType}-${row.groupName}`}>
                    <td className={td}>
                      {row.groupType === "BULK" ? "Bulk" : "Zone"}
                    </td>
                    <td className={td}>{row.groupName}</td>
                    <td className={`${td} text-right`}>{row.total}</td>
                    <td className={`${td} text-right`}>
                      <button
                        type="button"
                        disabled={!Number(row.read)}
                        onClick={() =>
                          showMeters(row.groupType, row.groupName, "READ")
                        }
                        className="inline-flex min-w-10 items-center justify-center rounded-lg bg-emerald-50 px-3 py-1.5 font-bold text-emerald-700 underline decoration-emerald-300 underline-offset-2 transition hover:bg-emerald-600 hover:text-white disabled:cursor-default disabled:bg-transparent disabled:text-slate-400 disabled:no-underline"
                        title={`View read meters in ${row.groupName}`}
                      >
                        {row.read}
                      </button>
                    </td>
                    <td className={`${td} text-right`}>
                      <button
                        type="button"
                        disabled={!Number(row.unread)}
                        onClick={() =>
                          showMeters(row.groupType, row.groupName, "UNREAD")
                        }
                        className="inline-flex min-w-10 items-center justify-center rounded-lg bg-amber-50 px-3 py-1.5 font-bold text-amber-700 underline decoration-amber-300 underline-offset-2 transition hover:bg-amber-500 hover:text-white disabled:cursor-default disabled:bg-transparent disabled:text-slate-400 disabled:no-underline"
                        title={`View unread meters in ${row.groupName}`}
                      >
                        {row.unread}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            id="meter-details"
            className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div className="font-bold text-slate-800">
                Meter details ({meterRows.length})
              </div>
              {(groupName || readingStatus) && (
                <div className="text-xs font-semibold text-slate-500">
                  {groupName || "All groups"} · {readingStatus || "Read & unread"}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Meter</th>
                    <th className={th}>Type</th>
                    <th className={th}>Zone / group</th>
                    <th className={th}>Account</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Status</th>
                    <th className={th}>Reading date</th>
                  </tr>
                </thead>
                <tbody>
                  {meterRows.map((row: Row) => (
                    <tr key={row.meterId}>
                      <td className={`${td} font-bold text-sky-700`}>
                        {row.meterNumber}
                      </td>
                      <td className={td}>{row.meterType}</td>
                      <td className={td}>{row.groupName}</td>
                      <td className={td}>{row.accountNumber ?? "—"}</td>
                      <td className={td}>{row.customerName}</td>
                      <td className={td}>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.status === "READ" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className={td}>
                        {row.readingDate
                          ? String(row.readingDate).slice(0, 10)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {!meterRows.length && (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-12 text-center text-sm text-slate-400"
                      >
                        No meters match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
