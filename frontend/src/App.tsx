import {
  Component,
  ErrorInfo,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import Login from "./pages/Login";
import LandingPage from "./pages/LandingPage";
import PublicPaymentPage from "./pages/PublicPaymentPage";
import OperationalDashboard from "./pages/OperationalDashboard";
import Reports from "./pages/Reports";
import WorkOrderManagement from "./pages/WorkOrderManagement";
import Customers from "./pages/Customers";
import NewCustomer from "./pages/NewCustomer";
import CustomerDetail from "./pages/CustomerDetail";
import ConnectionDashboard, {
  ConnectionProfile,
  NewConnectionApplication,
} from "./pages/ConnectionManagement";
import {
  AssignMeter,
  BulkMeterAssignmentImport,
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
  BulkCurrentReadingImport,
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
  BillNotifications,
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
import {
  AdminDashboard,
  PermissionRegister,
  RoleAdministration,
  UserAdministration,
} from "./pages/AdminManagement";
import {
  RegisterServiceRequest,
  ServiceRequestDashboard,
} from "./pages/ServiceRequestManagement";
import SettingsManagement from "./pages/SettingsManagement";
import ReconnectionManagement from "./pages/ReconnectionManagement";
import { api, clearToken, getSessionUser, getToken } from "./lib/api";
import { encodeId } from "./lib/hashids";
import { maskPhone, usePrivacyMode } from "./lib/privacyMode";

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

function GuestOnly({ children }: { children: React.ReactNode }) {
  if (getToken()) return <Navigate to="/dashboard" replace />;
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
  { label: "Dashboard", Icon: IcoDashboard, path: "/dashboard", iconClass: "bg-sky-400/10 text-sky-300" },
  { label: "Customers", Icon: IcoCustomers, path: "/customers", iconClass: "bg-violet-400/10 text-violet-300" },
  { label: "New Connections", Icon: IcoDroplet, path: "/connections", iconClass: "bg-cyan-400/10 text-cyan-300" },
  { label: "Billing", Icon: IcoBilling, path: "/billing", iconClass: "bg-emerald-400/10 text-emerald-300" },
  { label: "Meter Management", Icon: IcoMeter, path: "/meters", iconClass: "bg-amber-400/10 text-amber-300" },
  { label: "Meter Readings", Icon: IcoReadings, path: "/readings", iconClass: "bg-cyan-400/10 text-cyan-300" },
  { label: "Tariff Management", Icon: IcoTariff, path: "/tariffs", iconClass: "bg-fuchsia-400/10 text-fuchsia-300" },
  { label: "Payments & Revenue", Icon: IcoCollections, path: "/payments", iconClass: "bg-green-400/10 text-green-300" },
  { label: "Arrears & Debt", Icon: IcoArrears, path: "/arrears", iconClass: "bg-orange-400/10 text-orange-300" },
  { label: "Notifications", Icon: IcoMail, path: "/notifications", iconClass: "bg-blue-400/10 text-blue-300" },
  { label: "Accounts", Icon: IcoAccounts, path: null, iconClass: "bg-indigo-400/10 text-indigo-300" },
  { label: "Service Requests", Icon: IcoService, path: "/service-requests", iconClass: "bg-rose-400/10 text-rose-300" },
  { label: "Work Orders", Icon: IcoWorkOrders, path: "/work-orders", iconClass: "bg-yellow-400/10 text-yellow-300" },
  { label: "Assets", Icon: IcoAssets, path: null, iconClass: "bg-teal-400/10 text-teal-300" },
  { label: "Reports", Icon: IcoReports, path: "/reports", iconClass: "bg-purple-400/10 text-purple-300" },
  { label: "Admin", Icon: IcoAdmin, path: "/admin", iconClass: "bg-red-400/10 text-red-300" },
  { label: "Settings", Icon: IcoSettings, path: "/settings", iconClass: "bg-slate-400/10 text-slate-300" },
];

const CUSTOMER_MENU = [
  ["Manage Customers", "/customers"],
  ["Register Customer", "/customers/new"],
] as const;

const CONNECTION_MENU = [
  ["Connection dashboard", "/connections"],
  ["New application", "/connections/new"],
] as const;

const METER_MENU = [
  ["Overview", "/meters"],
  ["All Meters", "/meters/list"],
  ["Add Meter", "/meters/register"],
  ["Customer Assignment", "/meters/assign"],
  ["Network Assignment", "/meters/assign/non-customer"],
  ["Import Meters", "/meters/import"],
  ["Import Assignments", "/meters/import-assignments"],
  ["Replacement Reviews", "/meters/replacements"],
  ["Exception Register", "/meters/reports/exceptions"],
  ["Alert Queue", "/meters/alerts"],
] as const;

const READING_MENU = [
  ["Overview", "/readings"],
  ["Reading Cycles", "/readings/cycles"],
  ["Reader Assignments", "/readings/assignments"],
  ["Reading Worklist", "/readings/worklist"],
  ["All Readings", "/readings/register"],
  ["Import Baseline", "/readings/import-current"],
  ["Approval Queue", "/readings/approvals"],
  ["Exception Queue", "/readings/exceptions"],
  ["Route Tracking", "/readings/progress"],
  ["Sync Queue", "/readings/sync"],
] as const;

const TARIFF_MENU = [
  ["Overview", "/tariffs"],
  ["All Tariffs", "/tariffs/register"],
  ["New Tariff", "/tariffs/new"],
  ["Category Assignments", "/tariffs/assignments"],
  ["Tariff Simulations", "/tariffs/simulations"],
  ["Approval Queue", "/tariffs/approvals"],
  ["Activation Queue", "/tariffs/activation"],
  ["Version History", "/tariffs/history"],
  ["Compare Tariffs", "/tariffs/compare"],
  ["Audit Trail", "/tariffs/audit"],
] as const;

const BILLING_MENU = [
  ["Billing Dashboard", "/billing"],
  ["Billing Periods", "/billing/periods"],
  ["Generate Bills", "/billing/generate"],
  ["Bill Approval", "/billing/approvals"],
  ["Invoices", "/billing/invoices"],
  ["Send Bills", "/billing/notifications"],
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

const SERVICE_REQUEST_MENU = [
  ["Service dashboard", "/service-requests"],
  ["Register request", "/service-requests/new"],
  ["Complaints", "/service-requests/complaints"],
  ["Leak reports", "/service-requests/leaks"],
  ["Reconnection requests", "/reconnections"],
] as const;

const WORK_ORDER_MENU = [
  ["Work order register", "/work-orders"],
  ["Create work order", "/work-orders/new"],
] as const;

const ADMIN_MENU = [
  ["Administration dashboard", "/admin"],
  ["Users", "/admin/users"],
  ["Roles", "/admin/roles"],
  ["Permissions", "/admin/permissions"],
] as const;

const SIDEBAR_CHILD_MENUS: Record<
  string,
  readonly (readonly [string, string])[]
> = {
  Customers: CUSTOMER_MENU,
  "New Connections": CONNECTION_MENU,
  Billing: BILLING_MENU,
  "Meter Management": METER_MENU,
  "Meter Readings": READING_MENU,
  "Tariff Management": TARIFF_MENU,
  "Payments & Revenue": PAYMENT_MENU,
  "Arrears & Debt": ARREARS_MENU,
  Notifications: NOTIFICATION_MENU,
  "Service Requests": SERVICE_REQUEST_MENU,
  "Work Orders": WORK_ORDER_MENU,
  Admin: ADMIN_MENU,
};

const MODULE_LABELS: Record<string, string> = {
  customers: "Customers",
  connections: "New Connections",
  billing: "Billing",
  meters: "Meter Management",
  readings: "Meter Readings",
  tariffs: "Tariff Management",
  payments: "Payments & Revenue",
  arrears: "Arrears & Debt",
  notifications: "Notifications",
  "service-requests": "Service Requests",
  "work-orders": "Work Orders",
  admin: "Administration",
  settings: "Settings",
};

const ROUTE_LABELS = new Map<string, string>([
  ...METER_MENU.map(([label, path]) => [path, label] as const),
  ...CONNECTION_MENU.map(([label, path]) => [path, label] as const),
  ...READING_MENU.map(([label, path]) => [path, label] as const),
  ...TARIFF_MENU.map(([label, path]) => [path, label] as const),
  ...BILLING_MENU.map(([label, path]) => [path, label] as const),
  ...PAYMENT_MENU.map(([label, path]) => [path, label] as const),
  ...NOTIFICATION_MENU.map(([label, path]) => [path, label] as const),
  ...ARREARS_MENU.map(([label, path]) => [path, label] as const),
  ...SERVICE_REQUEST_MENU.map(([label, path]) => [path, label] as const),
  ...WORK_ORDER_MENU.map(([label, path]) => [path, label] as const),
  ...ADMIN_MENU.map(([label, path]) => [path, label] as const),
  ["/customers", "Customers"],
  ["/customers/new", "New Customer"],
]);

const PAGE_HEADING_LABELS = new Map<string, string>([
  ["/readings/progress", "Route completion report"],
  ["/service-requests", "Service requests and complaints"],
  ["/service-requests/new", "Register service request"],
  ["/service-requests/complaints", "Complaints"],
  ["/work-orders", "Work order management"],
  ["/work-orders/new", "Create work order"],
  ["/admin", "Administration"],
  ["/admin/users", "User administration"],
  ["/admin/roles", "Role administration"],
  ["/admin/permissions", "Permission register"],
  ["/settings", "System settings"],
  ["/connections", "New connection management"],
  ["/connections/new", "New connection application"],
]);

function detailPageLabel(pathname: string) {
  if (/^\/customers\/[^/]+$/.test(pathname)) return "Customer Profile";
  if (/^\/connections\/[^/]+$/.test(pathname)) return "Connection application";
  if (/^\/billing\/invoices\/[^/]+$/.test(pathname)) return "Invoice Details";
  if (/^\/payments\/receipts\/[^/]+$/.test(pathname)) return "Payment Receipt";
  if (/^\/meters\/[^/]+\/history$/.test(pathname)) return "Meter History";
  if (/^\/meters\/[^/]+\/installation$/.test(pathname)) return "Installation Details";
  if (/^\/meters\/[^/]+\/replace$/.test(pathname)) return "Replace Meter";
  if (/^\/meters\/[^/]+\/status$/.test(pathname)) return "Update Meter Status";
  if (/^\/meters\/[^/]+$/.test(pathname)) return "Meter Profile";
  if (/^\/readings\/capture/.test(pathname)) return "Capture Meter Reading";
  if (/^\/tariffs\/[^/]+\/bands$/.test(pathname)) return "Tariff Band Setup";
  if (/^\/tariffs\/[^/]+\/simulate$/.test(pathname)) return "Tariff Simulation";
  if (/^\/tariffs\/[^/]+\/audit$/.test(pathname)) return "Tariff Audit";
  if (/^\/arrears\/accounts\/[^/]+$/.test(pathname)) return "Account Arrears Details";

  const pathSegments = pathname.split("/").filter(Boolean);
  const finalSegment = pathSegments[pathSegments.length - 1] ?? "Details";
  if (/^\d+$/.test(finalSegment)) return "Details";
  return finalSegment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function AppBreadcrumbs() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean);
  const moduleKey = segments[0];
  const moduleLabel = MODULE_LABELS[moduleKey];
  const modulePath = moduleKey ? `/${moduleKey}` : "/";
  const useWideReadingLayout = moduleKey === "readings";

  if (
    !moduleLabel ||
    (pathname === modulePath && !["service-requests", "work-orders", "admin", "settings"].includes(moduleKey))
  ) {
    return null;
  }

  const exactLabel = ROUTE_LABELS.get(pathname);
  const parentEntry = Array.from(ROUTE_LABELS.entries())
    .filter(
      ([path]) =>
        path !== modulePath &&
        pathname.startsWith(`${path}/`),
    )
    .sort(([left], [right]) => right.length - left.length)[0];
  const currentLabel =
    PAGE_HEADING_LABELS.get(pathname) ?? exactLabel ?? detailPageLabel(pathname);
  const canGoBack = Number(window.history.state?.idx ?? 0) > 0;

  function returnToPreviousPage() {
    if (canGoBack) {
      navigate(-1);
      return;
    }
    navigate(modulePath);
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={`app-breadcrumbs mx-auto flex w-full flex-wrap items-center gap-2 px-5 pt-3 text-xs font-medium text-slate-500 ${
        useWideReadingLayout ? "max-w-[1680px] lg:px-5" : "max-w-[1600px] lg:px-8"
      }`}
    >
      {pathname === modulePath ? (
        <h1
          aria-current="page"
          className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl"
        >
          {currentLabel}
        </h1>
      ) : (
        <>
          <button
            type="button"
            onClick={returnToPreviousPage}
            className="inline-flex items-center gap-1 font-semibold text-aqua-700 transition-colors hover:text-aqua-600"
            title={canGoBack ? "Return to the previous page with its filters" : `Return to ${moduleLabel}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <span aria-hidden="true" className="text-slate-300">/</span>
          <Link
            to={modulePath}
            className="transition-colors hover:text-aqua-700"
          >
            {moduleLabel}
          </Link>
          {parentEntry && (
            <>
              <span aria-hidden="true" className="text-slate-300">/</span>
              <Link
                to={parentEntry[0]}
                className="transition-colors hover:text-aqua-700"
              >
                {parentEntry[1]}
              </Link>
            </>
          )}
          <span aria-hidden="true" className="text-slate-300">/</span>
          <h1
            aria-current="page"
            className="ml-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl"
          >
            {currentLabel}
          </h1>
        </>
      )}
    </nav>
  );
}

type GlobalSearchResult = {
  id: string;
  kind: "Customer" | "Account" | "Meter";
  title: string;
  detail: string;
  path: string;
};

function entityName(entity: any) {
  return (
    entity?.organizationName ||
    [entity?.firstName, entity?.middleName, entity?.lastName]
      .filter(Boolean)
      .join(" ") ||
    "Unnamed customer"
  );
}

function notificationLabel(notification: any) {
  return String(notification?.notificationType ?? "Notification")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { enabled: privacyMode, setEnabled: setPrivacyMode } = usePrivacyMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("aquaflow_sidebar_collapsed") === "true",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationData, setNotificationData] = useState<any>({
    queued: 0,
    failed: 0,
    recent: [],
  });
  const [sidebarFlyout, setSidebarFlyout] = useState<string | null>(null);
  const [sidebarFlyoutTop, setSidebarFlyoutTop] = useState(72);
  const searchRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const sidebarFlyoutTimer = useRef<number | null>(null);
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

  useEffect(() => {
    localStorage.setItem(
      "aquaflow_sidebar_collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    let active = true;
    async function refreshNotifications() {
      try {
        const data = await api.notificationDashboard();
        if (active) setNotificationData(data);
      } catch {
        // The page-level API handler manages expired sessions. The navbar stays
        // available when a role cannot load notification details.
      }
    }
    void refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const [customers, accounts, meters] = await Promise.all([
          api.listCustomers(query, 1),
          api.listAccounts(query, 6),
          api.listMeters({ search: query, take: "6" }),
        ]);
        if (!active) return;
        const customerResults: GlobalSearchResult[] = (
          customers.items ?? []
        )
          .slice(0, 6)
          .map((customer: any) => ({
            id: `customer-${customer.customerId}`,
            kind: "Customer",
            title: entityName(customer),
            detail: `${customer.customerNumber} · ${customer.phoneNumber ?? "No phone"}`,
            path: `/customers/${encodeId(customer.customerId)}`,
          }));
        const accountResults: GlobalSearchResult[] = (accounts ?? []).map(
          (account: any) => ({
            id: `account-${account.accountId}`,
            kind: "Account",
            title: account.accountNumber,
            detail: `${entityName(account.customer)} · ${account.accountStatus}`,
            path: `/customers/${encodeId(account.customerId)}`,
          }),
        );
        const meterResults: GlobalSearchResult[] = (meters ?? [])
          .slice(0, 6)
          .map((meter: any) => ({
            id: `meter-${meter.meterId}`,
            kind: "Meter",
            title: meter.meterNumber,
            detail: `${meter.serialNumber} · ${String(meter.status).replace(/_/g, " ")}`,
            path: `/meters/${encodeId(meter.meterId)}`,
          }));
        setSearchResults([
          ...customerResults,
          ...accountResults,
          ...meterResults,
        ]);
      } catch {
        if (active) setSearchResults([]);
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    function closePopovers(event: MouseEvent) {
      const target = event.target as Node;
      if (!searchRef.current?.contains(target)) setSearchOpen(false);
      if (!notificationRef.current?.contains(target))
        setNotificationOpen(false);
    }
    document.addEventListener("mousedown", closePopovers);
    return () => document.removeEventListener("mousedown", closePopovers);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setNotificationOpen(false);
    setSidebarFlyout(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarCollapsed) setSidebarFlyout(null);
  }, [sidebarCollapsed]);

  const actionNotificationCount =
    Number(notificationData.queued ?? 0) + Number(notificationData.failed ?? 0);

  function cancelSidebarFlyoutClose() {
    if (sidebarFlyoutTimer.current !== null) {
      window.clearTimeout(sidebarFlyoutTimer.current);
      sidebarFlyoutTimer.current = null;
    }
  }

  function openSidebarFlyout(label: string, element: HTMLElement) {
    if (!sidebarCollapsed) return;
    cancelSidebarFlyoutClose();
    const rect = element.getBoundingClientRect();
    setSidebarFlyoutTop(
      Math.max(64, Math.min(rect.top, window.innerHeight - 460)),
    );
    setSidebarFlyout(label);
  }

  function scheduleSidebarFlyoutClose() {
    cancelSidebarFlyoutClose();
    sidebarFlyoutTimer.current = window.setTimeout(
      () => setSidebarFlyout(null),
      160,
    );
  }

  const flyoutMenu = sidebarFlyout
    ? SIDEBAR_CHILD_MENUS[sidebarFlyout]
    : undefined;
  const flyoutModule = sidebarFlyout
    ? NAV_ITEMS.find((item) => item.label === sidebarFlyout)
    : undefined;

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-slate-50">
      {/* ── Sidebar ── */}
      <aside
        className={`app-sidebar flex h-screen flex-shrink-0 flex-col overflow-hidden bg-navy-900 text-white ${
          sidebarCollapsed ? "app-sidebar-collapsed w-20" : "w-64"
        }`}
      >
        {/* Utility logo */}
        <div className={`flex items-center border-b border-white/10 px-3 py-3 ${sidebarCollapsed ? "justify-center" : ""}`}>
          <Link
            to="/dashboard"
            aria-label="Go to dashboard"
            title="Dashboard"
            className={`overflow-hidden rounded-xl shadow-sm ${privacyMode ? "bg-white ring-1 ring-amber-300/70" : ""} ${
              sidebarCollapsed ? "h-11 w-11" : privacyMode ? "h-16 w-full" : "h-16 w-full"
            }`}
          >
            <img
              src={privacyMode ? "/zevra-demo-logo.png" : "/samdamte-navbar-logo-transparent.png"}
              alt={privacyMode ? "Zevra Holdings Ltd demo branding" : "Samdamte Water Utility Management"}
              className={`max-w-none object-contain ${privacyMode ? "h-full w-full scale-[1.72]" : sidebarCollapsed ? "h-11 w-auto object-left" : "h-full w-full"
              }`}
            />
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3 text-sm">
          {NAV_ITEMS.map(({ label, Icon: NavIcon, path, iconClass }) => {
            const active = path !== null && location.pathname.startsWith(path);
            const cls = `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${sidebarCollapsed ? "justify-center" : ""} ${
              active
                ? "bg-navy-600 text-white font-medium"
                : "text-blue-100/60 hover:text-white hover:bg-white/10 cursor-default"
            }`;
            return path ? (
              <div
                key={label}
                onMouseEnter={(event) =>
                  openSidebarFlyout(label, event.currentTarget)
                }
                onMouseLeave={scheduleSidebarFlyoutClose}
                onFocus={(event) =>
                  openSidebarFlyout(label, event.currentTarget)
                }
                onBlur={scheduleSidebarFlyoutClose}
              >
                <Link
                  to={path}
                  className={cls}
                  aria-label={sidebarCollapsed ? label : undefined}
                >
                  <span className={`nav-icon ${iconClass}`}>
                    <NavIcon />
                  </span>
                  <span className={sidebarCollapsed ? "sr-only" : ""}>
                    {label}
                  </span>
                </Link>
                {!sidebarCollapsed && label === "Customers" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {CUSTOMER_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/customers"
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
                {!sidebarCollapsed && label === "Billing" && active && (
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
                {!sidebarCollapsed && label === "Payments & Revenue" && active && (
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
                {!sidebarCollapsed && label === "Notifications" && active && (
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
                {!sidebarCollapsed && label === "Arrears & Debt" && active && (
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
                {!sidebarCollapsed && label === "Meter Management" && active && (
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
                {!sidebarCollapsed && label === "Meter Readings" && active && (
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
                          title={itemPath === "/readings/import-current" ? "Migration/setup tool for approved legacy reading baselines" : undefined}
                          className={`block rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                            itemActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span>{itemLabel}</span>
                            {itemPath === "/readings/import-current" && (
                              <span className="shrink-0 rounded-full border border-amber-300/40 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-200">
                                Migration
                              </span>
                            )}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
                {!sidebarCollapsed && label === "Tariff Management" && active && (
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
                {!sidebarCollapsed && label === "Service Requests" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {SERVICE_REQUEST_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/service-requests"
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
                {!sidebarCollapsed && label === "Admin" && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-2">
                    {ADMIN_MENU.map(([itemLabel, itemPath]) => {
                      const itemActive =
                        itemPath === "/admin"
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
              <span
                key={label}
                className={cls}
                title={sidebarCollapsed ? label : undefined}
              >
                <span className={`nav-icon ${iconClass}`}>
                  <NavIcon />
                </span>
                <span className={sidebarCollapsed ? "sr-only" : ""}>
                  {label}
                </span>
              </span>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-white/10 px-3 py-3">
          <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "mb-2 gap-2"}`}>
            <div className="w-8 h-8 rounded-full bg-aqua-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials}
            </div>
            <div className={`min-w-0 ${sidebarCollapsed ? "hidden" : ""}`}>
              <div className="text-xs font-medium truncate">{displayName}</div>
              <div className="text-[10px] text-blue-200/50 truncate">
                {displayRole}
              </div>
            </div>
          </div>
          <button
            title={sidebarCollapsed ? "Sign out" : undefined}
            onClick={() => {
              clearToken();
              navigate("/login");
            }}
            className={`text-[11px] text-blue-100/50 transition-colors hover:text-white ${sidebarCollapsed ? "sr-only" : ""}`}
          >
            Sign out
          </button>
        </div>
      </aside>

      {sidebarCollapsed && sidebarFlyout && flyoutModule?.path && (
        <div
          role="menu"
          aria-label={`${sidebarFlyout} navigation`}
          className="fixed left-20 z-[70] w-64 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xl"
          style={{ top: sidebarFlyoutTop }}
          onMouseEnter={cancelSidebarFlyoutClose}
          onMouseLeave={scheduleSidebarFlyoutClose}
        >
          <Link
            to={flyoutModule.path}
            role="menuitem"
            className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 font-bold text-slate-900 hover:bg-sky-50 hover:text-aqua-700"
            onClick={() => setSidebarFlyout(null)}
          >
            <span>{sidebarFlyout}</span>
            <span aria-hidden="true" className="text-slate-400">›</span>
          </Link>
          {flyoutMenu?.length ? (
            <div className="max-h-[390px] overflow-y-auto p-2">
              {flyoutMenu.map(([itemLabel, itemPath]) => {
                const itemActive =
                  itemPath === flyoutModule.path
                    ? location.pathname === itemPath
                    : location.pathname.startsWith(itemPath);
                return (
                  <Link
                    key={itemPath}
                    to={itemPath}
                    role="menuitem"
                    title={itemPath === "/readings/import-current" ? "Migration/setup tool for approved legacy reading baselines" : undefined}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      itemActive
                        ? "bg-sky-50 text-aqua-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                    onClick={() => setSidebarFlyout(null)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>{itemLabel}</span>
                      {itemPath === "/readings/import-current" && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-800">
                          Migration
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-3 text-xs text-slate-500">
              Open {sidebarFlyout}
            </div>
          )}
        </div>
      )}

      {/* ── Main column ── */}
      <div className="app-main-column flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="app-topbar h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-4 flex-shrink-0">
          <button
            type="button"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <IcoMenu />
          </button>
          <div ref={searchRef} className="relative max-w-xl flex-1">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-slate-400 pointer-events-none">
                <IcoSearch />
              </span>
              <input
                type="text"
                placeholder="Search customers, accounts, meter..."
                value={searchQuery}
                aria-label="Global search"
                aria-expanded={searchOpen}
                className="w-full rounded-full border-0 bg-slate-100 py-2 pl-9 pr-10 text-[15px] focus:outline-none focus:ring-2 focus:ring-aqua-500"
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearchOpen(false);
                  if (event.key === "Enter" && searchResults[0]) {
                    navigate(searchResults[0].path);
                    setSearchQuery("");
                    setSearchOpen(false);
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute right-2 rounded-full px-2 py-1 text-slate-400 hover:bg-white hover:text-slate-700"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {searchOpen && (
              <div className="absolute left-0 top-[calc(100%+0.55rem)] z-50 w-full min-w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Global search
                </div>
                {searchQuery.trim().length < 2 ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-500">
                    Enter at least two characters to search.
                  </div>
                ) : searchLoading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-slate-500">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                    Searching…
                  </div>
                ) : searchResults.length ? (
                  <div className="max-h-[420px] overflow-y-auto py-1">
                    {searchResults.map((result) => {
                      const kindColors = {
                        Customer: "bg-violet-50 text-violet-700",
                        Account: "bg-emerald-50 text-emerald-700",
                        Meter: "bg-amber-50 text-amber-700",
                      };
                      return (
                        <button
                          type="button"
                          key={result.id}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sky-50"
                          onClick={() => {
                            navigate(result.path);
                            setSearchQuery("");
                            setSearchOpen(false);
                          }}
                        >
                          <span
                            className={`w-20 flex-shrink-0 rounded-full px-2 py-1 text-center text-[11px] font-semibold ${kindColors[result.kind]}`}
                          >
                            {result.kind}
                          </span>
                          <span className="min-w-0">
                            <strong className="block truncate text-sm text-slate-800">
                              {result.title}
                            </strong>
                            <span className="block truncate text-xs text-slate-500">
                              {result.detail}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-sm text-slate-500">
                    No customer, account or meter matched “{searchQuery}”.
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-pressed={privacyMode}
              title={privacyMode ? "Turn off demo privacy mode" : "Turn on demo privacy mode"}
              onClick={() => setPrivacyMode(!privacyMode)}
              className={`mr-2 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${privacyMode ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {privacyMode ? "Privacy mode on" : "Privacy mode"}
            </button>
            <div ref={notificationRef} className="relative">
              <button
                type="button"
                aria-label="Open notifications"
                aria-expanded={notificationOpen}
                className="topbar-icon relative rounded-lg p-2 text-amber-500 hover:bg-amber-50 hover:text-amber-600"
                onClick={() => {
                  setNotificationOpen((open) => !open);
                  setSearchOpen(false);
                  void api
                    .notificationDashboard()
                    .then(setNotificationData)
                    .catch(() => undefined);
                }}
              >
                <IcoBell />
                {actionNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                    {actionNotificationCount > 99
                      ? "99+"
                      : actionNotificationCount}
                  </span>
                )}
              </button>
              {notificationOpen && (
                <div className="absolute right-0 top-[calc(100%+0.55rem)] z-50 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Notifications
                      </h3>
                      <p className="text-xs text-slate-500">
                        {notificationData.queued ?? 0} queued ·{" "}
                        {notificationData.failed ?? 0} failed
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-aqua-700 hover:text-aqua-600"
                      onClick={() => navigate("/notifications/history")}
                    >
                      View all
                    </button>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    {(notificationData.recent ?? [])
                      .slice(0, 6)
                      .map((notification: any) => (
                        <button
                          type="button"
                          key={notification.notificationId}
                          className="flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-sky-50"
                          onClick={() => navigate("/notifications/history")}
                        >
                          <span
                            className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                              notification.deliveryStatus === "FAILED"
                                ? "bg-red-500"
                                : notification.deliveryStatus === "QUEUED"
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
                            }`}
                          />
                          <span className="min-w-0">
                            <strong className="block truncate text-sm text-slate-800">
                              {notificationLabel(notification)}
                            </strong>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {notification.recipient} ·{" "}
                              {String(notification.deliveryStatus)
                                .toLowerCase()
                                .replace(/_/g, " ")}
                            </span>
                          </span>
                        </button>
                      ))}
                    {!(notificationData.recent ?? []).length && (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        No notifications have been created yet.
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-3">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-sky-200 hover:text-sky-700"
                      onClick={() => navigate("/notifications/queue")}
                    >
                      Open queue
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-aqua-700 px-3 py-2 text-sm font-semibold text-white hover:bg-aqua-600"
                      onClick={() => navigate("/notifications/send")}
                    >
                      Send notification
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              title="Send notification"
              aria-label="Send notification"
              className="topbar-icon rounded-lg p-2 text-sky-600 hover:bg-sky-50 hover:text-sky-700"
              onClick={() => navigate("/notifications/send")}
            >
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
          {privacyMode && (
            <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
              <span><strong>DEMO PRIVACY MODE</strong> — contact details are masked on supported views. No data has been changed.</span>
              <button type="button" onClick={() => setPrivacyMode(false)} className="whitespace-nowrap font-bold underline">Show real details</button>
            </div>
          )}
          <AppBreadcrumbs />
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
      <Route path="/" element={<LandingPage />} />
      <Route path="/pay/:token" element={<PublicPaymentPage />} />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Shell>
              <OperationalDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/reports"
        element={
          <Protected>
            <Shell>
              <Reports />
            </Shell>
          </Protected>
        }
      />
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
        path="/connections"
        element={
          <Protected>
            <Shell>
              <ConnectionDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/connections/new"
        element={
          <Protected>
            <Shell>
              <NewConnectionApplication />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/connections/:id"
        element={
          <Protected>
            <Shell>
              <ConnectionProfile />
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
        element={
          <Protected>
            <Shell>
              <BillNotifications />
            </Shell>
          </Protected>
        }
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
        path="/readings/import-current"
        element={
          <Protected>
            <Shell>
              <BulkCurrentReadingImport />
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
        path="/meters/import-assignments"
        element={
          <Protected>
            <Shell>
              <BulkMeterAssignmentImport />
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
      <Route
        path="/service-requests"
        element={
          <Protected>
            <Shell>
              <ServiceRequestDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/reconnections"
        element={
          <Protected>
            <Shell>
              <ReconnectionManagement />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/service-requests/new"
        element={
          <Protected>
            <Shell>
              <RegisterServiceRequest />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/service-requests/complaints"
        element={
          <Protected>
            <Shell>
              <ServiceRequestDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/service-requests/leaks"
        element={
          <Protected>
            <Shell>
              <ServiceRequestDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/work-orders"
        element={
          <Protected>
            <Shell>
              <WorkOrderManagement />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/work-orders/new"
        element={
          <Protected>
            <Shell>
              <WorkOrderManagement />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected>
            <Shell>
              <AdminDashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/admin/users"
        element={
          <Protected>
            <Shell>
              <UserAdministration />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <Protected>
            <Shell>
              <RoleAdministration />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/admin/permissions"
        element={
          <Protected>
            <Shell>
              <PermissionRegister />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <Shell>
              <SettingsManagement />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
