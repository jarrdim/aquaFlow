import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { CheckboxMultiSelect } from "./CheckboxMultiSelect";
import { DateInput } from "./DateInput";
import { SearchableSelect } from "./SearchableSelect";
import { showToast } from "./SweetAlertToast";

type LinkedRequest = {
  serviceRequestId: string;
  requestNumber: string;
  requestType: string;
  subject: string;
  description: string;
  priority: string;
  account?: { accountId: string; accountNumber: string };
  customer?: {
    customerId: string;
    customerNumber: string;
    firstName?: string;
    lastName?: string;
    organizationName?: string;
  };
  assignee?: { userId: string; firstName: string; lastName: string };
};

type Props = {
  request: LinkedRequest;
  copyFrom?: {
    workOrderTypeId: string;
    priority: string;
    fieldOfficerIds?: string[];
    scheduledDate?: string;
    dueDate?: string;
    description: string;
  };
  onClose: () => void;
  onCreated: (message: string) => void;
};

const fieldClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";

const titleCase = (value: string) =>
  value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function CreateLinkedWorkOrderModal({ request, copyFrom, onClose, onCreated }: Props) {
  const [lookups, setLookups] = useState<any>({ types: [], officers: [], priorities: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigneeMatched, setAssigneeMatched] = useState(false);
  const [form, setForm] = useState({
    workOrderTypeId: copyFrom ? String(copyFrom.workOrderTypeId) : "",
    priority: copyFrom?.priority || (request.priority === "URGENT" ? "EMERGENCY" : request.priority === "MEDIUM" ? "NORMAL" : request.priority),
    fieldOfficerIds: copyFrom?.fieldOfficerIds?.map(String) || [] as string[],
    scheduledDate: copyFrom?.scheduledDate?.slice(0, 10) || "",
    dueDate: copyFrom?.dueDate?.slice(0, 10) || "",
    description: copyFrom?.description || `${request.subject}: ${request.description}`.slice(0, 5000),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.workOrderLookups()
      .then((data: any) => {
        if (!active) return;
        setLookups(data);
        const matchingOfficer = request.assignee
          ? data.officers.find((officer: any) => String(officer.userId) === String(request.assignee?.userId))
          : null;
        if (matchingOfficer && !copyFrom) {
          setAssigneeMatched(true);
          setForm((current) => ({
            ...current,
            fieldOfficerIds: [String(matchingOfficer.fieldOfficerId)],
          }));
        }
      })
      .catch((error: any) => showToast(error.message, "error"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [request.assignee, copyFrom]);

  const selectedOfficers = useMemo(
    () => lookups.officers.filter((officer: any) => form.fieldOfficerIds.includes(String(officer.fieldOfficerId))),
    [form.fieldOfficerIds, lookups.officers],
  );
  const customerName = request.customer?.organizationName ||
    [request.customer?.firstName, request.customer?.lastName].filter(Boolean).join(" ") ||
    request.customer?.customerNumber || "No customer";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.workOrderTypeId) return showToast("Select a work order type.", "warning");
    if (!form.description.trim()) return showToast("Enter the work description.", "warning");
    setSaving(true);
    try {
      const created = await api.createWorkOrder({
        ...form,
        accountId: request.account?.accountId || null,
        customerId: request.customer?.customerId || null,
        serviceRequestId: request.serviceRequestId,
        sourceType: request.requestType === "COMPLAINT" ? "COMPLAINT" : "SERVICE_REQUEST",
        scheduledDate: form.scheduledDate || null,
        dueDate: form.dueDate || null,
      });
      const number = created.work_order_number || created.workOrderNumber || "Work order";
      onCreated(`${number} created${form.fieldOfficerIds.length ? " and assigned" : ""}.`);
    } catch (error: any) {
      showToast(error.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-6">
      <button type="button" aria-label="Close work order form" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-[2px]" />
      <section role="dialog" aria-modal="true" aria-labelledby="linked-work-order-title" className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-black/5">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-aqua-700">{request.requestNumber}</div>
            <h2 id="linked-work-order-title" className="text-xl font-bold text-slate-900">{copyFrom ? "Copy linked work order" : "Create linked work order"}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{copyFrom ? "Review the copied details before creating a separate work order." : "The customer, complaint and assigned field officer are carried over automatically."}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">×</button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <div className="grid gap-3 rounded-xl border border-sky-100 bg-sky-50/70 p-4 text-sm sm:grid-cols-2">
              <div><span className="block text-xs font-semibold uppercase text-slate-500">Customer</span><strong className="text-slate-900">{customerName}</strong></div>
              <div><span className="block text-xs font-semibold uppercase text-slate-500">Account</span><strong className="text-slate-900">{request.account?.accountNumber || "No account"}</strong></div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <label><span className="mb-1 block text-sm font-medium">Work order type *</span><SearchableSelect className={fieldClass} value={form.workOrderTypeId} onChange={(event) => setForm({ ...form, workOrderTypeId: event.target.value })}><option value="">Select type</option>{lookups.types.map((item: any) => <option key={item.workOrderTypeId} value={item.workOrderTypeId}>{item.typeName}</option>)}</SearchableSelect></label>
                <label><span className="mb-1 block text-sm font-medium">Priority *</span><SearchableSelect className={fieldClass} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{lookups.priorities.map((item: string) => <option key={item} value={item}>{titleCase(item)}</option>)}</SearchableSelect></label>
                <label className="md:col-span-2"><span className="mb-1 block text-sm font-medium">Assign field officers</span><CheckboxMultiSelect className={fieldClass} disabled={loading} emptyMessage="No active field officers are configured" placeholder={loading ? "Loading field officers…" : "Leave unassigned"} value={form.fieldOfficerIds} onChange={(fieldOfficerIds) => setForm({ ...form, fieldOfficerIds })} options={lookups.officers.map((item: any) => ({ value: String(item.fieldOfficerId), label: `${item.firstName} ${item.lastName}${item.employeeNumber ? ` · ${item.employeeNumber}` : ""}` }))} />
                  {request.assignee && !loading && (assigneeMatched ? <span className="mt-1 block text-xs font-medium text-emerald-700">{request.assignee.firstName} {request.assignee.lastName} was selected from the complaint assignment.</span> : <span className="mt-1 block text-xs text-amber-700">{request.assignee.firstName} {request.assignee.lastName} has no active field-officer profile, so select another field officer.</span>)}</label>
                <label><span className="mb-1 block text-sm font-medium">Scheduled date</span><DateInput className={fieldClass} value={form.scheduledDate} onChange={(event) => setForm({ ...form, scheduledDate: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-medium">Due date</span><DateInput className={fieldClass} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
                <label className="md:col-span-2"><span className="mb-1 block text-sm font-medium">Work description *</span><textarea rows={4} className={fieldClass} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <strong>Dispatch summary</strong>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedOfficers.length ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{selectedOfficers.length ? `Assigned to ${selectedOfficers.map((officer: any) => `${officer.firstName} ${officer.lastName}`).join(", ")}` : "Unassigned queue"}</span>
            </div>
          </div>

          <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white px-5 py-3">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving || loading} className="min-w-44 rounded-lg bg-aqua-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-aqua-600 disabled:opacity-50">{saving ? "Creating…" : selectedOfficers.length ? "Create and assign" : "Create work order"}</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
