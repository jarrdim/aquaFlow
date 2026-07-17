import { Component, ErrorInfo, ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import Login from "./pages/Login";
import Customers from "./pages/Customers";
import NewCustomer from "./pages/NewCustomer";
import CustomerDetail from "./pages/CustomerDetail";
import {
  AssignMeter,
  BulkMeterImport,
  ExceptionReport,
  InstallationDetails,
  MeterDashboard,
  MeterHistory,
  MeterList,
  MeterProfile,
  MeterReplacement,
  RegisterMeter,
  ReplacementApproval,
  UpdateMeterStatus,
} from "./pages/MeterManagement";
import {
  CaptureReading,
  ReadingApprovals,
  ReadingCycles,
  ReadingDashboard,
  ReadingProgress,
  ReadingRegister,
  ReadingRouteAssignments,
  ReadingSyncQueue,
  ReadingWorklist,
} from "./pages/MeterReadings";
import {
  TariffActivation,
  TariffApprovals,
  TariffAssignments,
  TariffAudit,
  TariffBands,
  TariffComparison,
  TariffDashboard,
  TariffEditor,
  TariffHistory,
  TariffRegister,
  TariffSimulation,
} from "./pages/TariffManagement";
import {
  BillApprovals,
  BillGeneration,
  BillInvoice,
  BillingAdjustmentApprovals,
  BillingAdjustments,
  BillingAudit,
  BillingDashboard,
  BillingHistory,
  BillingPeriods,
  BillingSecurityAlerts,
  CustomerStatements,
  InvoiceRegister,
} from "./pages/BillingManagement";
import {
  CollectionReport,
  MpesaStkPush,
  PaymentAudit,
  PaymentChannels,
  PaymentHistory,
  PaymentReceipt,
  PaymentReconciliation,
  PaymentRegister,
  PaymentReversals,
  RecordPayment,
  RevenueDashboard,
  ReversalApprovals,
  UnmatchedPayments,
} from "./pages/PaymentManagement";
import {
  NotificationDashboard,
  NotificationHistory,
  NotificationProviders,
  NotificationQueue,
  NotificationSend,
  NotificationTemplates,
} from "./pages/NotificationManagement";
import {
  ArrearsAgingReport,
  ArrearsAudit,
  ArrearsDashboard,
  CustomerDebtProfile,
  DebtRecoveryReport,
  DebtWriteOffs,
  DemandNotices,
  DisconnectionLists,
  PaymentPlans,
  PaymentReminders,
  PromisesToPay,
} from "./pages/ArrearsManagement";
import { clearToken, getSessionUser, getToken } from "./lib/api";

class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page rendering failed", error, info);
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">
            This page could not be displayed
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            An unexpected display error occurred. You can retry without losing
            saved data.
          </p>
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {this.state.error.message}
          </div>
          <button
            type="button"
            className="mt-4 rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Retry page
          </button>
        </div>
      </div>
    );
  }
}

function Protected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="flex-shrink-0"
  >
    <path d={d} />
  </svg>
);
const IcoDashboard = () => (
  <Icon d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" />
);
const IcoCustomers = () => (
  <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 2a3 3 0 0 1 0 6m3-6a3 3 0 1 0-5.48 1.61" />
);
const IcoBilling = () => (
  <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM9 13h6m-6 4h6m-3-9V2l5 5h-5" />
);
const IcoMeter = () => (
  <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 6v4l3 3" />
);
const IcoReadings = () => (
  <Icon d="M4 3h16v18H4zM8 7h8M8 11h3m2 0h3M8 15h2m2 0h4" />
);
const IcoTariff = () => (
  <Icon d="M20 13V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M8 8h8M8 12h5m3 5h6m-3-3v6" />
);
const IcoCollections = () => (
  <Icon d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM1 13h22" />
);
const IcoArrears = () => (
  <Icon d="M12 8v4l2 2m7-2a9 9 0 1 1-9-9 9 9 0 0 1 9 9zM18 18l3 3" />
);
const IcoAccounts = () => (
  <Icon d="M20 7H8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14" />
);
const IcoService = () => (
  <Icon d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
);
const IcoWorkOrders = () => (
  <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4" />
);
const IcoAssets = () => (
  <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
);
const IcoReports = () => <Icon d="M18 20V10m-6 10V4M6 20v-6" />;
const IcoAdmin = () => <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
const IcoSettings = () => (
  <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.07-1.56l1.44-1.44a1 1 0 0 0 0-1.41L19.07 9a1 1 0 0 0-1.06-.21l-1.73.64a6.96 6.96 0 0 0-1.08-.62l-.4-1.8A1 1 0 0 0 13.82 6h-3.64a1 1 0 0 0-.98.79l-.4 1.8c-.39.18-.76.4-1.1.63l-1.72-.65a1 1 0 0 0-1.06.22L3.49 10.59a1 1 0 0 0 0 1.41l1.44 1.44c-.06.37-.09.75-.09 1.13s.03.76.09 1.13L3.49 17.14a1 1 0 0 0 0 1.41l1.44 1.44a1 1 0 0 0 1.06.21l1.73-.64c.34.23.71.45 1.1.62l.4 1.8a1 1 0 0 0 .98.79h3.64a1 1 0 0 0 .98-.79l.4-1.8c.39-.17.76-.39 1.1-.62l1.72.64a1 1 0 0 0 1.06-.21l1.44-1.44a1 1 0 0 0 0-1.41l-1.44-1.44c.06-.37.09-.75.09-1.13s-.03-.76-.09-1.13z" />
);
const IcoMenu = () => <Icon d="M3 12h18M3 6h18M3 18h18" size={20} />;
const IcoSearch = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
const IcoBell = () => (
  <Icon
    d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
    size={18}
  />
);
const IcoMail = () => (
  <Icon
    d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm18 2-10 7L2 6"
    size={18}
  />
);
const IcoDroplet = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="white" stroke="none">
    <path d="M12 2C6 10 4 14.5 4 16.5a8 8 0 0 0 16 0C20 14.5 18 10 12 2z" />
  </svg>
);

const NAV_ITEMS = [
  { label: "Dashboard", Icon: IcoDashboard, path: null, iconClass: "bg-sky-400/10 text-sky-300" },
  { label: "Customers", Icon: IcoCustomers, path: "/customers", iconClass: "bg-violet-400/10 text-violet-300" },
  { label: "Billing", Icon: IcoBilling, path: "/billing", iconClass: "bg-emerald-400/10 text-emerald-300" },
  { label: "Meter Management", Icon: IcoMeter, path: "/meters", iconClass: "bg-amber-400/10 text-amber-300" },
  { label: "Meter Readings", Icon: IcoReadings, path: "/readings", iconClass: "bg-cyan-400/10 text-cyan-300" },
  { label: "Tariff Management", Icon: IcoTariff, path: "/tariffs", iconClass: "bg-fuchsia-400/10 text-fuchsia-300" },
  { label: "Payments & Revenue", Icon: IcoCollections, path: "/payments", iconClass: "bg-green-400/10 text-green-300" },
  { label: "Arrears & Debt", Icon: IcoArrears, path: "/arrears", iconClass: "bg-orange-400/10 text-orange-300" },
  { label: "Notifications", Icon: IcoMail, path: "/notifications", iconClass: "bg-blue-400/10 text-blue-300" },
  { label: "Accounts", Icon: IcoAccounts, path: null, iconClass: "bg-indigo-400/10 text-indigo-300" },
  { label: "Service Requests", Icon: IcoService, path: null, iconClass: "bg-rose-400/10 text-rose-300" },
  { label: "Work Orders", Icon: IcoWorkOrders, path: null, iconClass: "bg-yellow-400/10 text-yellow-300" },
  { label: "Assets", Icon: IcoAssets, path: null, iconClass: "bg-teal-400/10 text-teal-300" },
  { label: "Reports", Icon: IcoReports, path: null, iconClass: "bg-purple-400/10 text-purple-300" },
  { label: "Admin", Icon: IcoAdmin, path: null, iconClass: "bg-red-400/10 text-red-300" },
  { label: "Settings", Icon: IcoSettings, path: null, iconClass: "bg-slate-400/10 text-slate-300" },
];

const METER_MENU = [
  ["Dashboard", "/meters"],
  ["Register Meter", "/meters/register"],
  ["Meter Register", "/meters/list"],
  ["Assign Customer Meter", "/meters/assign"],
  ["Assign Bulk / Zone", "/meters/assign/non-customer"],
  ["Replacement Approval", "/meters/replacements"],
  ["Exception Report", "/meters/reports/exceptions"],
  ["Bulk Import", "/meters/import"],
  ["Exception Alerts", "/meters/alerts"],
] as const;

const READING_MENU = [
  ["Reading Dashboard", "/readings"],
  ["Reading Cycles", "/readings/cycles"],
  ["Route Assignments", "/readings/assignments"],
  ["Reading Worklist", "/readings/worklist"],
  ["Reading Register", "/readings/register"],
  ["Reading Approvals", "/readings/approvals"],
  ["Reading Exceptions", "/readings/exceptions"],
  ["Route Progress", "/readings/progress"],
  ["Offline Queue", "/readings/sync"],
] as const;

const TARIFF_MENU = [
  ["Tariff Dashboard", "/tariffs"],
  ["Tariff Register", "/tariffs/register"],
  ["Create Tariff", "/tariffs/new"],
  ["Category Assignment", "/tariffs/assignments"],
  ["Simulations", "/tariffs/simulations"],
  ["Tariff Approval", "/tariffs/approvals"],
  ["Tariff Activation", "/tariffs/activation"],
  ["Tariff History", "/tariffs/history"],
  ["Tariff Comparison", "/tariffs/compare"],
  ["Tariff Audit Trail", "/tariffs/audit"],
] as const;

const BILLING_MENU = [
  ["Billing Dashboard", "/billing"],
  ["Billing Periods", "/billing/periods"],
  ["Generate Bills", "/billing/generate"],
  ["Bill Approval", "/billing/approvals"],
  ["Invoices", "/billing/invoices"],
  ["Customer Statements", "/billing/statements"],
  ["Adjustment Requests", "/billing/adjustments"],
  ["Adjustment Approval", "/billing/adjustments/approvals"],
  ["Security Alerts", "/billing/alerts"],
  ["Billing History", "/billing/history"],
  ["Billing Audit Trail", "/billing/audit"],
] as const;

const PAYMENT_MENU = [
  ["Revenue Dashboard", "/payments"],
  ["M-Pesa Express", "/payments/mpesa"],
  ["Record Payment", "/payments/record"],
  ["Payment Register", "/payments/register"],
  ["Payment Channels", "/payments/channels"],
  ["Unmatched Payments", "/payments/unmatched"],
  ["Reversal Requests", "/payments/reversals"],
  ["Reversal Approval", "/payments/reversals/approvals"],
  ["Daily Collections", "/payments/reports/daily"],
  ["Reconciliation", "/payments/reconciliation"],
  ["Customer Payment History", "/payments/history"],
  ["Payment Audit Trail", "/payments/audit"],
] as const;

const NOTIFICATION_MENU = [
  ["Notification Dashboard", "/notifications"],
  ["Send Notification", "/notifications/send"],
  ["Delivery Queue", "/notifications/queue"],
  ["Templates", "/notifications/templates"],
  ["Providers", "/notifications/providers"],
  ["Notification History", "/notifications/history"],
] as const;

const ARREARS_MENU = [
  ["Arrears Dashboard", "/arrears"],
  ["Balances & Ageing", "/arrears/aging"],
  ["Payment Reminders", "/arrears/reminders"],
  ["Demand Notices", "/arrears/notices"],
  ["Disconnection Lists", "/arrears/disconnections"],
  ["Payment Plans", "/arrears/plans"],
  ["Promises to Pay", "/arrears/promises"],
  ["Debt Write-Off", "/arrears/write-offs"],
  ["Debt Recovery Report", "/arrears/recovery"],
  ["Arrears Audit Trail", "/arrears/audit"],
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionUser = getSessionUser();
  const displayName =
    [sessionUser?.firstName, sessionUser?.lastName].filter(Boolean).join(" ") ||
    sessionUser?.username ||
    "Signed-in user";
  const displayRole =
    sessionUser?.roles?.[0]
      ?.toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) ||
    "Authenticated user";
  const initials = (
    sessionUser?.firstName && sessionUser?.lastName
      ? `${sessionUser.firstName[0]}${sessionUser.lastName[0]}`
      : sessionUser?.username
          ?.split(/[._-]/)
          .map((part) => part[0])
          .join("")
          .slice(0, 2) || "AU"
  ).toUpperCase();

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-slate-50">
      {/* ── Sidebar ── */}
      <aside className="app-sidebar flex h-screen w-60 flex-shrink-0 flex-col overflow-hidden bg-navy-900 text-white">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500 flex items-center justify-center flex-shrink-0">
            <IcoDroplet />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight">AquaFlow</div>
            <div className="text-[10px] text-blue-200/60 leading-tight truncate">
              Water Utility Management
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3 text-sm">
          {NAV_ITEMS.map(({ label, Icon: NavIcon, path, iconClass }) => {
            const active = path !== null && location.pathname.startsWith(path);
            const cls = `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
              active
                ? "bg-navy-600 text-white font-medium"
                : "text-blue-100/60 hover:text-white hover:bg-white/10 cursor-default"
            }`;
            return path ? (
              <div key={label}>
                <Link to={path} className={cls}>
                  <span className={`nav-icon ${iconClass}`}>
                    <NavIcon />
                  </span>
                  {label}
                </Link>
                {label === "Billing" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {BILLING_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/billing"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={itemPath}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                            itemActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
                {label === "Payments & Revenue" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {PAYMENT_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/payments"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={itemPath}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${itemActive ? "bg-white/10 text-white" : "text-blue-100/50 hover:bg-white/5 hover:text-white"}`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
                {label === "Notifications" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {NOTIFICATION_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/notifications"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={itemPath}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${itemActive ? "bg-white/10 text-white" : "text-blue-100/50 hover:bg-white/5 hover:text-white"}`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
                {label === "Arrears & Debt" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {ARREARS_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/arrears"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={`${itemLabel}-${itemPath}`}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                            itemActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
                {label === "Meter Management" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {METER_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/meters"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={itemPath}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                            itemActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
                {label === "Meter Readings" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {READING_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/readings"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={itemPath}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                            itemActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
                {label === "Tariff Management" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {TARIFF_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/tariffs"
                          ? location.pathname === itemPath
                          : location.pathname.startsWith(itemPath);
                      return (
                        <Link
                          key={itemPath}
                          to={itemPath}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                            itemActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {itemLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <span key={label} className={cls}>
                <span className={`nav-icon ${iconClass}`}>
                  <NavIcon />
                </span>
                {label}
              </span>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-aqua-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{displayName}</div>
              <div className="text-[10px] text-blue-200/50 truncate">
                {displayRole}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              clearToken();
              navigate("/login");
            }}
            className="text-[11px] text-blue-100/50 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="app-main-column flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="app-topbar h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-4 flex-shrink-0">
          <button className="text-slate-400 hover:text-slate-600 p-1">
            <IcoMenu />
          </button>
          <div className="flex-1 max-w-md">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-slate-400 pointer-events-none">
                <IcoSearch />
              </span>
              <input
                type="text"
                placeholder="Search customers, accounts, meter..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-aqua-500"
              />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button className="topbar-icon relative rounded-lg p-2 text-amber-500 hover:bg-amber-50 hover:text-amber-600">
              <IcoBell />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
            </button>
            <button className="topbar-icon rounded-lg p-2 text-sky-600 hover:bg-sky-50 hover:text-sky-700">
              <IcoMail />
            </button>
            <button
              title={`${displayName} · ${displayRole}`}
              className="ml-1 w-8 h-8 rounded-full bg-aqua-600 flex items-center justify-center text-xs font-bold text-white"
            >
              {initials}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="app-content min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <PageErrorBoundary resetKey={location.pathname}>
            {children}
          </PageErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/customers"
        element={
          <Protected>
            <Shell>
              <Customers />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/customers/new"
        element={
          <Protected>
            <Shell>
              <NewCustomer />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/customers/:id"
        element={
          <Protected>
            <Shell>
              <CustomerDetail />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing"
        element={
          <Protected>
            <Shell>
              <BillingDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/periods"
        element={
          <Protected>
            <Shell>
              <BillingPeriods />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/generate"
        element={
          <Protected>
            <Shell>
              <BillGeneration />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/approvals"
        element={
          <Protected>
            <Shell>
              <BillApprovals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/invoices"
        element={
          <Protected>
            <Shell>
              <InvoiceRegister />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/invoices/:id"
        element={
          <Protected>
            <Shell>
              <BillInvoice />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/statements"
        element={
          <Protected>
            <Shell>
              <CustomerStatements />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/notifications"
        element={<Navigate to="/notifications/send" replace />}
      />
      <Route
        path="/billing/adjustments"
        element={
          <Protected>
            <Shell>
              <BillingAdjustments />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/adjustments/approvals"
        element={
          <Protected>
            <Shell>
              <BillingAdjustmentApprovals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/alerts"
        element={
          <Protected>
            <Shell>
              <BillingSecurityAlerts />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/history"
        element={
          <Protected>
            <Shell>
              <BillingHistory />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/billing/audit"
        element={
          <Protected>
            <Shell>
              <BillingAudit />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments"
        element={
          <Protected>
            <Shell>
              <RevenueDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/mpesa"
        element={
          <Protected>
            <Shell>
              <MpesaStkPush />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/record"
        element={
          <Protected>
            <Shell>
              <RecordPayment />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/register"
        element={
          <Protected>
            <Shell>
              <PaymentRegister />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/channels"
        element={
          <Protected>
            <Shell>
              <PaymentChannels />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/unmatched"
        element={
          <Protected>
            <Shell>
              <UnmatchedPayments />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/receipts/:id"
        element={
          <Protected>
            <Shell>
              <PaymentReceipt />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/reversals"
        element={
          <Protected>
            <Shell>
              <PaymentReversals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/reversals/approvals"
        element={
          <Protected>
            <Shell>
              <ReversalApprovals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/reports/daily"
        element={
          <Protected>
            <Shell>
              <CollectionReport />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/reconciliation"
        element={
          <Protected>
            <Shell>
              <PaymentReconciliation />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/history"
        element={
          <Protected>
            <Shell>
              <PaymentHistory />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/payments/audit"
        element={
          <Protected>
            <Shell>
              <PaymentAudit />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears"
        element={
          <Protected>
            <Shell>
              <ArrearsDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/aging"
        element={
          <Protected>
            <Shell>
              <ArrearsAgingReport />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/accounts/:id"
        element={
          <Protected>
            <Shell>
              <CustomerDebtProfile />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/reminders"
        element={
          <Protected>
            <Shell>
              <PaymentReminders />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/notices"
        element={
          <Protected>
            <Shell>
              <DemandNotices />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/disconnections"
        element={
          <Protected>
            <Shell>
              <DisconnectionLists />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/plans"
        element={
          <Protected>
            <Shell>
              <PaymentPlans />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/promises"
        element={
          <Protected>
            <Shell>
              <PromisesToPay />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/write-offs"
        element={
          <Protected>
            <Shell>
              <DebtWriteOffs />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/recovery"
        element={
          <Protected>
            <Shell>
              <DebtRecoveryReport />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/arrears/audit"
        element={
          <Protected>
            <Shell>
              <ArrearsAudit />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/notifications"
        element={
          <Protected>
            <Shell>
              <NotificationDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/notifications/send"
        element={
          <Protected>
            <Shell>
              <NotificationSend />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/notifications/queue"
        element={
          <Protected>
            <Shell>
              <NotificationQueue />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/notifications/templates"
        element={
          <Protected>
            <Shell>
              <NotificationTemplates />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/notifications/providers"
        element={
          <Protected>
            <Shell>
              <NotificationProviders />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/notifications/history"
        element={
          <Protected>
            <Shell>
              <NotificationHistory />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs"
        element={
          <Protected>
            <Shell>
              <TariffDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/register"
        element={
          <Protected>
            <Shell>
              <TariffRegister />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/new"
        element={
          <Protected>
            <Shell>
              <TariffEditor />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/assignments"
        element={
          <Protected>
            <Shell>
              <TariffAssignments />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/simulations"
        element={
          <Protected>
            <Shell>
              <TariffSimulation />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/approvals"
        element={
          <Protected>
            <Shell>
              <TariffApprovals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/activation"
        element={
          <Protected>
            <Shell>
              <TariffActivation />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/history"
        element={
          <Protected>
            <Shell>
              <TariffHistory />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/compare"
        element={
          <Protected>
            <Shell>
              <TariffComparison />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/audit"
        element={
          <Protected>
            <Shell>
              <TariffAudit />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/:id/edit"
        element={
          <Protected>
            <Shell>
              <TariffEditor />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/:id/bands"
        element={
          <Protected>
            <Shell>
              <TariffBands />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/:id/simulate"
        element={
          <Protected>
            <Shell>
              <TariffSimulation />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/tariffs/:id/audit"
        element={
          <Protected>
            <Shell>
              <TariffAudit />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings"
        element={
          <Protected>
            <Shell>
              <ReadingDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/cycles"
        element={
          <Protected>
            <Shell>
              <ReadingCycles />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/assignments"
        element={
          <Protected>
            <Shell>
              <ReadingRouteAssignments />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/worklist"
        element={
          <Protected>
            <Shell>
              <ReadingWorklist />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/capture"
        element={
          <Protected>
            <Shell>
              <CaptureReading />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/register"
        element={
          <Protected>
            <Shell>
              <ReadingRegister />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/approvals"
        element={
          <Protected>
            <Shell>
              <ReadingApprovals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/exceptions"
        element={
          <Protected>
            <Shell>
              <ReadingRegister exceptions />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/progress"
        element={
          <Protected>
            <Shell>
              <ReadingProgress />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/readings/sync"
        element={
          <Protected>
            <Shell>
              <ReadingSyncQueue />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters"
        element={
          <Protected>
            <Shell>
              <MeterDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/list"
        element={
          <Protected>
            <Shell>
              <MeterList />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/register"
        element={
          <Protected>
            <Shell>
              <RegisterMeter />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/assign"
        element={
          <Protected>
            <Shell>
              <AssignMeter />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/assign/non-customer"
        element={
          <Protected>
            <Shell>
              <AssignMeter nonCustomer />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/replacements"
        element={
          <Protected>
            <Shell>
              <ReplacementApproval />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/reports/exceptions"
        element={
          <Protected>
            <Shell>
              <ExceptionReport />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/import"
        element={
          <Protected>
            <Shell>
              <BulkMeterImport />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/alerts"
        element={
          <Protected>
            <Shell>
              <ExceptionReport alerts />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/:id"
        element={
          <Protected>
            <Shell>
              <MeterProfile />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/:id/installation"
        element={
          <Protected>
            <Shell>
              <InstallationDetails />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/:id/status"
        element={
          <Protected>
            <Shell>
              <UpdateMeterStatus />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/:id/replace"
        element={
          <Protected>
            <Shell>
              <MeterReplacement />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/meters/:id/history"
        element={
          <Protected>
            <Shell>
              <MeterHistory />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/customers" replace />} />
    </Routes>
  );
}
