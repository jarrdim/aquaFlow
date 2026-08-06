import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { encodeId } from "../lib/hashids";
import { SearchableSelect } from "../components/SearchableSelect";
import { SweetAlertToast } from "../components/SweetAlertToast";
import { exportExcel, parseMeterWorkbook } from "../lib/meterFiles";

interface Customer {
  customerId: string;
  customerNumber: string;
  customerType: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  organizationName?: string;
  phoneNumber: string;
  emailAddress?: string;
  status: string;
  registrationDate: string;
  accountCount: number;
  activeMeters: Array<{ meterId: string; meterNumber: string }>;
}

const PAGE_SIZE = 20;
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-slate-200 bg-slate-100 text-slate-600",
  SUSPENDED: "border-amber-200 bg-amber-50 text-amber-700",
  CLOSED: "border-red-200 bg-red-50 text-red-700",
};

function customerName(customer: Customer) {
  return customer.customerType === "ORGANIZATION"
    ? customer.organizationName || "Unnamed organization"
    : [customer.firstName, customer.middleName, customer.lastName]
        .filter(Boolean)
        .join(" ");
}

function initials(customer: Customer) {
  return customerName(customer)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    STATUS_COLORS[status] ?? "border-slate-200 bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "slate",
  icon,
}: {
  label: string;
  value: string | number;
  tone?: "slate" | "emerald" | "violet" | "sky" | "amber";
  icon: React.ReactNode;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="flex min-w-0 items-center gap-3 px-5 py-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <p className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      </div>
    </div>
  );
}

const UsersIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8 0a4 4 0 0 0 0-8m3 18v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BuildingIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M4 21V3h12v18M8 7h4M8 11h4M8 15h4m4-6h4v12H2m16-8h.01m0 4h.01" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SelectionIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MeterIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 12l3-3M8 16h8M9 7.5h6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Customers() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState(() => urlParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => urlParams.get("status") ?? "");
  const [meterAssignmentFilter, setMeterAssignmentFilter] = useState(
    () => urlParams.get("meterAssignment") ?? "",
  );
  const [page, setPage] = useState(() =>
    Math.max(1, Number(urlParams.get("page")) || 1),
  );
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("ACTIVE");
  const [updating, setUpdating] = useState(false);
  const [withoutActiveMeter, setWithoutActiveMeter] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, unknown>[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [showPropertyImport, setShowPropertyImport] = useState(false);
  const [propertyRows, setPropertyRows] = useState<Record<string, unknown>[]>([]);
  const [propertyErrors, setPropertyErrors] = useState<string[]>([]);
  const [importingProperties, setImportingProperties] = useState(false);

  async function load(
    q = search,
    status = statusFilter,
    meterAssignment = meterAssignmentFilter,
    currentPage = page,
  ) {
    setLoading(true);
    setError("");
    try {
      const data = await api.listCustomers(q, currentPage, status, meterAssignment);
      setCustomers(data.items ?? []);
      setTotal(Number(data.total ?? 0));
      setWithoutActiveMeter(Number(data.summary?.withoutActiveMeter ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Customers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(search, statusFilter, meterAssignmentFilter, page);
  }, [page]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (statusFilter) next.set("status", statusFilter);
    if (meterAssignmentFilter) next.set("meterAssignment", meterAssignmentFilter);
    if (page > 1) next.set("page", String(page));
    setUrlParams(next, { replace: true });
  }, [search, statusFilter, meterAssignmentFilter, page, setUrlParams]);

  const pageIds = customers.map((customer) => String(customer.customerId));
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const shownActive = customers.filter(
    (customer) => customer.status === "ACTIVE",
  ).length;
  const shownOrganizations = customers.filter(
    (customer) => customer.customerType === "ORGANIZATION",
  ).length;
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    return Array.from(
      { length: Math.min(5, totalPages) },
      (_, index) => start + index,
    );
  }, [page, totalPages]);

  function submitSearch(event?: FormEvent) {
    event?.preventDefault();
    setPage(1);
    void load(search, statusFilter, meterAssignmentFilter, 1);
  }

  function changeStatusFilter(status: string) {
    setStatusFilter(status);
    setPage(1);
    setSelected([]);
    void load(search, status, meterAssignmentFilter, 1);
  }

  function changeMeterAssignmentFilter(value: string) {
    setMeterAssignmentFilter(value);
    setPage(1);
    setSelected([]);
    void load(search, statusFilter, value, 1);
  }

  function togglePage(checked: boolean) {
    setSelected((current) =>
      checked
        ? Array.from(new Set([...current, ...pageIds])).slice(0, 1000)
        : current.filter((id) => !pageIds.includes(id)),
    );
  }

  async function applyBulkStatus() {
    if (!selected.length) return;
    setUpdating(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.bulkUpdateCustomerStatus(selected, bulkStatus);
      setSuccess(
        `${result.updated} customer(s) updated to ${bulkStatus.toLowerCase()}.`,
      );
      setSelected([]);
      await load(search, statusFilter, meterAssignmentFilter, page);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The selected customers could not be updated.",
      );
    } finally {
      setUpdating(false);
    }
  }

  function cell(row: Record<string, unknown>, name: string) {
    const entry = Object.entries(row).find(
      ([key]) => key.trim().toLowerCase() === name.toLowerCase(),
    );
    return String(entry?.[1] ?? "").trim();
  }

  async function selectImportFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      const sourceRows = await parseMeterWorkbook(file);
      const errors: string[] = [];
      const normalized = sourceRows.map((row, index) => {
        const customerType = cell(row, "Customer Type").toUpperCase();
        const firstName = cell(row, "First Name");
        const lastName = cell(row, "Last Name");
        const organizationName = cell(row, "Organization Name");
        const emailAddress = cell(row, "Email Address");
        const registrationDate = cell(row, "Registration Date");
        if (!cell(row, "Customer Number")) errors.push(`Row ${index + 2}: Customer Number is required.`);
        if (!cell(row, "Phone Number")) errors.push(`Row ${index + 2}: Phone Number is required.`);
        if (!["INDIVIDUAL", "ORGANIZATION"].includes(customerType)) errors.push(`Row ${index + 2}: Customer Type must be INDIVIDUAL or ORGANIZATION.`);
        if (customerType === "INDIVIDUAL" && (!firstName || !lastName)) errors.push(`Row ${index + 2}: First Name and Last Name are required.`);
        if (customerType === "ORGANIZATION" && !organizationName) errors.push(`Row ${index + 2}: Organization Name is required.`);
        if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) errors.push(`Row ${index + 2}: Email Address is invalid.`);
        if (registrationDate && !/^\d{4}-\d{2}-\d{2}$/.test(registrationDate)) errors.push(`Row ${index + 2}: Registration Date must be YYYY-MM-DD.`);
        return {
          customerNumber: cell(row, "Customer Number"), customerType,
          firstName, middleName: cell(row, "Middle Name"), lastName, organizationName,
          nationalId: cell(row, "National ID"), registrationNumber: cell(row, "Registration Number"),
          phoneNumber: cell(row, "Phone Number"), alternativePhone: cell(row, "Alternative Phone"),
          emailAddress, preferredLanguage: cell(row, "Preferred Language").toUpperCase() || "EN",
          status: cell(row, "Status").toUpperCase() || "ACTIVE", registrationDate: registrationDate || undefined,
        };
      });
      if (!sourceRows.length) errors.push("The selected file has no customer rows.");
      setImportRows(normalized);
      setImportErrors(errors);
    } catch (err) {
      setImportRows([]);
      setImportErrors([err instanceof Error ? err.message : "The file could not be read."]);
    }
  }

  async function importCustomers() {
    if (!importRows.length || importErrors.length) return;
    setImporting(true);
    setError("");
    try {
      let imported = 0;
      for (let offset = 0; offset < importRows.length; offset += 1000) {
        const result = await api.bulkImportCustomers(importRows.slice(offset, offset + 1000));
        imported += Number(result.imported ?? 0);
      }
      setSuccess(`${imported} customer(s) imported successfully.`);
      setImportRows([]);
      setShowImport(false);
      setPage(1);
      await load(search, statusFilter, meterAssignmentFilter, 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Customers could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  async function selectPropertyFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      const sourceRows = await parseMeterWorkbook(file);
      const errors: string[] = [];
      const normalized = sourceRows.map((row, index) => {
        const propertyCode = cell(row, "propertyCode");
        const customerNumber = cell(row, "customerNumber");
        const serviceAreaCode = cell(row, "serviceAreaCode");
        const physicalAddress = cell(row, "physicalAddress");
        if (!propertyCode) errors.push(`Row ${index + 2}: propertyCode is required.`);
        if (!customerNumber) errors.push(`Row ${index + 2}: customerNumber is required.`);
        if (!serviceAreaCode) errors.push(`Row ${index + 2}: serviceAreaCode is required.`);
        if (!physicalAddress) errors.push(`Row ${index + 2}: physicalAddress is required.`);
        return {
          propertyCode,
          customerNumber,
          serviceAreaCode,
          plotNumber: cell(row, "plotNumber"),
          buildingName: cell(row, "buildingName"),
          physicalAddress,
          occupancyStatus: cell(row, "occupancyStatus").toUpperCase() || "OWNER_OCCUPIED",
          status: cell(row, "status").toUpperCase() || "ACTIVE",
        };
      });
      if (!sourceRows.length) errors.push("The selected file has no property rows.");
      setPropertyRows(normalized);
      setPropertyErrors(errors);
    } catch (err) {
      setPropertyRows([]);
      setPropertyErrors([err instanceof Error ? err.message : "The file could not be read."]);
    }
  }

  async function importProperties() {
    if (!propertyRows.length || propertyErrors.length) return;
    setImportingProperties(true);
    setError("");
    try {
      let imported = 0;
      for (let offset = 0; offset < propertyRows.length; offset += 1000) {
        const result = await api.bulkImportProperties(propertyRows.slice(offset, offset + 1000));
        imported += Number(result.imported ?? 0);
      }
      setSuccess(`${imported} properties imported successfully.`);
      setPropertyRows([]);
      setShowPropertyImport(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Properties could not be imported.");
    } finally {
      setImportingProperties(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-sky-300 shadow-lg shadow-slate-300/60 sm:flex">
            <UsersIcon />
          </span>
          <div>
            <h1 className="text-[27px] font-extrabold leading-tight text-slate-900">
              Customers
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage customer identities, contacts and service accounts.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowPropertyImport((value) => !value)} className="inline-flex items-center rounded-xl border border-violet-300 bg-white px-5 py-3 text-sm font-bold text-violet-700">
          {showPropertyImport ? "Close properties" : "Import properties"}
        </button>
        <button type="button" onClick={() => setShowImport((value) => !value)} className="inline-flex items-center rounded-xl border border-aqua-700 bg-white px-5 py-3 text-sm font-bold text-aqua-700">
          {showImport ? "Close import" : "Bulk import"}
        </button>
        <Link to="/customers/new" className="inline-flex items-center gap-2 rounded-xl bg-aqua-700 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-sky-200/70 transition hover:-translate-y-0.5 hover:bg-aqua-600">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add customer
        </Link>
        </div>
      </div>

      {showImport && (
        <section className="mb-5 rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-bold text-slate-900">Bulk customer import</h2><p className="mt-1 text-sm text-slate-500">Upload up to 1,000 customers from Excel or CSV. The whole batch is rejected if any row is invalid.</p></div>
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => exportExcel("customer-import-template.xlsx", "Customers", [{ "Customer Number": "CUST-00001", "Customer Type": "INDIVIDUAL", "First Name": "Jane", "Middle Name": "", "Last Name": "Doe", "Organization Name": "", "National ID": "12345678", "Registration Number": "", "Phone Number": "0712345678", "Alternative Phone": "", "Email Address": "jane@example.com", "Preferred Language": "EN", "Status": "ACTIVE", "Registration Date": new Date().toISOString().slice(0, 10) }])}>Download template</button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-slate-700">Excel or CSV file</span><input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => void selectImportFile(event.target.files?.[0])} className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm" /></label>
            <button type="button" disabled={!importRows.length || importErrors.length > 0 || importing} onClick={() => void importCustomers()} className="h-11 rounded-xl bg-aqua-700 px-6 text-sm font-bold text-white disabled:opacity-40">{importing ? "Importing..." : `Import ${importRows.length || ""} customers`}</button>
          </div>
          {importRows.length > 0 && !importErrors.length && <p className="mt-3 text-sm font-semibold text-emerald-700">{importRows.length} rows validated and ready to import.</p>}
          {importErrors.length > 0 && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><strong>Fix these issues:</strong><ul className="mt-1 list-disc pl-5">{importErrors.slice(0, 20).map((message) => <li key={message}>{message}</li>)}</ul>{importErrors.length > 20 && <p className="mt-1">And {importErrors.length - 20} more.</p>}</div>}
        </section>
      )}

      {showPropertyImport && (
        <section className="mb-5 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-bold text-slate-900">Bulk property import</h2><p className="mt-1 text-sm text-slate-500">Import properties after customers. Customer numbers and service-area codes are matched to existing records.</p></div>
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => exportExcel("property-import-template.xlsx", "Properties", [{ propertyCode: "PROP-000001", customerNumber: "CUST-2026-00001", serviceAreaCode: "11", plotNumber: "1", buildingName: "", physicalAddress: "Plot 1, 40 ACRES", occupancyStatus: "OWNER_OCCUPIED", status: "ACTIVE" }])}>Download template</button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-slate-700">Property Excel or CSV file</span><input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => void selectPropertyFile(event.target.files?.[0])} className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm" /></label>
            <button type="button" disabled={!propertyRows.length || propertyErrors.length > 0 || importingProperties} onClick={() => void importProperties()} className="h-11 rounded-xl bg-violet-700 px-6 text-sm font-bold text-white disabled:opacity-40">{importingProperties ? "Importing..." : `Import ${propertyRows.length || ""} properties`}</button>
          </div>
          {propertyRows.length > 0 && !propertyErrors.length && <p className="mt-3 text-sm font-semibold text-emerald-700">{propertyRows.length} property rows validated and ready.</p>}
          {propertyErrors.length > 0 && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><strong>Fix these issues:</strong><ul className="mt-1 list-disc pl-5">{propertyErrors.slice(0, 20).map((message) => <li key={message}>{message}</li>)}</ul>{propertyErrors.length > 20 && <p className="mt-1">And {propertyErrors.length - 20} more.</p>}</div>}
        </section>
      )}

      <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
          <SummaryMetric label="Total customers" value={total} icon={<UsersIcon />} />
          <button
            type="button"
            className="text-left transition hover:bg-amber-50/60"
            onClick={() => changeMeterAssignmentFilter("UNASSIGNED")}
            title="Show customers without an active meter assignment"
          >
            <SummaryMetric label="Without active meter" value={withoutActiveMeter} tone="amber" icon={<MeterIcon />} />
          </button>
          <SummaryMetric label="Active on page" value={shownActive} tone="emerald" icon={<CheckIcon />} />
          <SummaryMetric label="Organizations on page" value={shownOrganizations} tone="violet" icon={<BuildingIcon />} />
          <SummaryMetric label="Selected records" value={selected.length} tone="sky" icon={<SelectionIcon />} />
        </div>
      </section>

      <SweetAlertToast message={error} type="error" />
      <SweetAlertToast message={success} type="success" />

      <form
        onSubmit={submitSearch}
        className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(260px,1fr)_210px_230px_auto]"
      >
        <label className="relative block">
          <span className="sr-only">Find a customer</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-aqua-500 focus:bg-white focus:ring-2 focus:ring-aqua-500/20"
              placeholder="Search name, number, phone or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
        <label>
          <span className="sr-only">Customer status</span>
          <SearchableSelect
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20"
            value={statusFilter}
            onChange={(event) => changeStatusFilter(event.target.value)}
          >
            <option value="">All customer statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </SearchableSelect>
        </label>
        <label>
          <span className="sr-only">Meter assignment</span>
          <SearchableSelect
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20"
            value={meterAssignmentFilter}
            onChange={(event) => changeMeterAssignmentFilter(event.target.value)}
          >
            <option value="">All meter assignments</option>
            <option value="ASSIGNED">Active meter assigned</option>
            <option value="UNASSIGNED">Without active meter</option>
          </SearchableSelect>
        </label>
        <button
          className="h-11 rounded-xl bg-navy-900 px-7 text-sm font-bold text-white transition hover:bg-aqua-700"
          type="submit"
        >
          Search
        </button>
      </form>

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm">
          <div>
            <strong className="text-sm text-sky-900">
              {selected.length} customer(s) selected
            </strong>
            <p className="text-xs text-sky-700">
              Selections can be retained across pages, up to 1,000 records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableSelect
              className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm"
              value={bulkStatus}
              onChange={(event) => setBulkStatus(event.target.value)}
            >
              <option value="ACTIVE">Set Active</option>
              <option value="INACTIVE">Set Inactive</option>
              <option value="SUSPENDED">Set Suspended</option>
              <option value="CLOSED">Set Closed</option>
            </SearchableSelect>
            <button
              type="button"
              disabled={updating}
              onClick={applyBulkStatus}
              className="rounded-lg bg-aqua-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {updating ? "Updating…" : "Apply to selected"}
            </button>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_42px_-30px_rgba(15,32,56,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Customer directory</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {total.toLocaleString()} records · Page {page} of {totalPages}
            </p>
          </div>
          <nav className="flex items-center gap-1" aria-label="Customer directory top pagination">
            <button
              type="button"
              aria-label="Previous customer page"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Previous
            </button>
            <div className="hidden items-center gap-1 sm:flex">
              {pageNumbers.map((pageNumber) => (
                <button
                  type="button"
                  key={`top-${pageNumber}`}
                  aria-label={`Go to customer page ${pageNumber}`}
                  aria-current={pageNumber === page ? "page" : undefined}
                  onClick={() => setPage(pageNumber)}
                  className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-bold transition ${
                    pageNumber === page
                      ? "border-aqua-700 bg-aqua-700 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50"
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Next customer page"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
        </div>
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          <p className="text-xs font-medium text-slate-500">
            Showing {customers.length} customers on this page
          </p>
          {(search || statusFilter || meterAssignmentFilter) && (
            <button
              type="button"
              className="text-xs font-bold text-aqua-700 hover:text-aqua-600"
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setMeterAssignmentFilter("");
                setPage(1);
                void load("", "", "", 1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead className="bg-white">
              <tr>
                <th className="w-14 px-5 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all customers on this page"
                    checked={allPageSelected}
                    onChange={(event) => togglePage(event.target.checked)}
                  />
                </th>
                {[
                  "Customer",
                  "Contact",
                  "Type",
                  "Meter assignment",
                  "Registered",
                  "Status",
                  "Actions",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                      Loading customers…
                    </span>
                  </td>
                </tr>
              ) : customers.length ? (
                customers.map((customer) => {
                  const id = String(customer.customerId);
                  const detailPath = `/customers/${encodeId(id)}`;
                  return (
                    <tr
                      key={id}
                      className={`group transition hover:bg-slate-50/80 ${
                        selected.includes(id) ? "bg-sky-50/70" : ""
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${customer.customerNumber}`}
                          checked={selected.includes(id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, id].slice(0, 1000)
                                : current.filter((value) => value !== id),
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-50 to-violet-100 text-xs font-extrabold text-violet-700 ring-1 ring-violet-100">
                            {initials(customer)}
                          </span>
                          <div>
                            <Link
                              to={detailPath}
                              className="text-sm font-bold text-slate-900 hover:text-aqua-700"
                            >
                              {customerName(customer)}
                            </Link>
                            <div className="mt-0.5 text-xs font-semibold text-aqua-700">
                              {customer.customerNumber}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-slate-600">
                        <div>{customer.phoneNumber}</div>
                        <div className="max-w-[240px] truncate text-xs text-slate-400">
                          {customer.emailAddress || "No email address"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {customer.customerType === "ORGANIZATION"
                            ? "Organization"
                            : "Individual"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {customer.activeMeters?.length ? (
                          <div>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                              Assigned
                            </span>
                            <div className="mt-1 max-w-[190px] truncate text-xs text-slate-500" title={customer.activeMeters.map((meter) => meter.meterNumber).join(", ")}>
                              {customer.activeMeters.map((meter) => meter.meterNumber).join(", ")}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            No active meter
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-slate-600">
                        {customer.registrationDate
                          ? new Date(customer.registrationDate).toLocaleDateString(
                              "en-KE",
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={customer.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <Link
                          to={detailPath}
                          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-aqua-700 transition hover:bg-sky-50"
                        >
                          View
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M5 12h14m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="font-semibold text-slate-700">
                      No customers matched
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Change the search or status filter and try again.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-4 text-sm text-slate-500">
          <span>
            {total
              ? `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, total)}–${Math.min(
                  page * PAGE_SIZE,
                  total,
                )} of ${total.toLocaleString()}`
              : "No records to display"}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                type="button"
                key={pageNumber}
                onClick={() => setPage(pageNumber)}
                className={`h-8 min-w-8 rounded-lg border px-2 font-semibold ${
                  pageNumber === page
                    ? "border-aqua-700 bg-aqua-700 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
