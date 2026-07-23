import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getSessionUser } from "../lib/api";
import { CheckboxMultiSelect } from "../components/CheckboxMultiSelect";
import { SearchableSelect } from "../components/SearchableSelect";

type Role = {
  roleId: string;
  roleCode: string;
  roleName: string;
  description?: string;
  status: string;
  rolePermissions?: { permission: Permission }[];
  _count?: { userRoles: number };
};
type Permission = {
  permissionId: string;
  permissionCode: string;
  moduleName: string;
  permissionName: string;
  description?: string;
};
type User = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber?: string;
  userType: string;
  status: string;
  twoFactorEnabled: boolean;
  lastLoginAt?: string;
  userRoles: { role: Role }[];
};
const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20";

function Shell({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:px-6 lg:py-5">
      <div className="page-screen-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-[26px]">
            {title}
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-800">
        {title}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
function Loader() {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-500">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-aqua-600 border-t-transparent" />
      Loading administration data…
    </div>
  );
}
function Notice({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}
    </>
  );
}
function NoAccess() {
  return (
    <Card title="Access restricted">
      <p className="text-sm text-slate-600">
        Only a System Administrator can manage users, roles and permissions.
      </p>
    </Card>
  );
}
const isAdmin = () => Boolean(getSessionUser()?.roles.includes("SYSTEM_ADMIN"));

export function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (isAdmin())
      api
        .adminDashboard()
        .then(setData)
        .catch(() => setData({ error: true }));
  }, []);
  if (!isAdmin())
    return (
      <Shell title="Administration" subtitle="User access and system security">
        <NoAccess />
      </Shell>
    );
  return (
    <Shell
      title="Administration"
      subtitle="Manage system users, access roles and permission grants"
    >
      {!data ? (
        <Loader />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["Users", data.users],
              ["Active users", data.activeUsers],
              ["Roles", data.roles],
              ["Permissions", data.permissions],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {label}
                </div>
                <div className="mt-2 text-3xl font-bold text-slate-900">
                  {Number(value || 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              [
                "User accounts",
                "Create staff users, reset access and assign roles.",
                "/admin/users",
              ],
              [
                "Roles",
                "Define job roles and grant precise permissions.",
                "/admin/roles",
              ],
              [
                "Permission register",
                "Review and maintain the permission catalogue.",
                "/admin/permissions",
              ],
            ].map(([title, text, path]) => (
              <Link
                key={path}
                to={path}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-aqua-300 hover:shadow"
              >
                <h2 className="font-bold text-slate-900">{title}</h2>
                <p className="mt-2 text-sm text-slate-500">{text}</p>
                <span className="mt-4 inline-block text-sm font-semibold text-aqua-700">
                  Open →
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

export function UserAdministration() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [selected, setSelected] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const empty = {
    username: "",
    firstName: "",
    lastName: "",
    emailAddress: "",
    phoneNumber: "",
    password: "",
    userType: "STAFF",
    status: "ACTIVE",
    twoFactorEnabled: false,
    roleIds: [] as string[],
  };
  const [form, setForm] = useState(empty);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [r, u] = await Promise.all([
        api.listAdminRoles(),
        api.listAdminUsers({
          q,
          status: filterStatus,
          roleId: filterRole,
          page: String(page),
          take: "25",
        }),
      ]);
      setRoles(r);
      setUsers(u.data);
      setTotal(u.total);
      setPages(u.pages);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, filterStatus, filterRole, page]);
  useEffect(() => {
    if (isAdmin()) load();
  }, [load]);
  const edit = (user: User) => {
    setSelected(user);
    setCreating(false);
    setForm({
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      emailAddress: user.emailAddress,
      phoneNumber: user.phoneNumber || "",
      password: "",
      userType: user.userType,
      status: user.status,
      twoFactorEnabled: user.twoFactorEnabled,
      roleIds: user.userRoles.map((item) => item.role.roleId),
    });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (creating)
        await api.createAdminUser({
          ...form,
          phoneNumber: form.phoneNumber || null,
        });
      else if (selected) {
        await api.updateAdminUser(selected.userId, {
          firstName: form.firstName,
          lastName: form.lastName,
          emailAddress: form.emailAddress,
          phoneNumber: form.phoneNumber || null,
          userType: form.userType,
          status: form.status,
          twoFactorEnabled: form.twoFactorEnabled,
          ...(form.password ? { password: form.password } : {}),
        });
        await api.updateAdminUserRoles(selected.userId, form.roleIds);
      }
      setSuccess(creating ? "User created." : "User updated.");
      setCreating(false);
      setSelected(null);
      setForm(empty);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  if (!isAdmin())
    return (
      <Shell title="User administration" subtitle="Manage staff access">
        <NoAccess />
      </Shell>
    );
  return (
    <Shell
      title="User administration"
      subtitle="Create accounts, manage status and assign one or more roles"
      action={
        <button
          className="rounded-lg bg-aqua-700 px-4 py-2.5 text-sm font-semibold text-white"
          onClick={() => {
            setCreating(true);
            setSelected(null);
            setForm(empty);
          }}
        >
          + Add user
        </button>
      }
    >
      <Notice error={error} success={success} />
      <Card title={`${total.toLocaleString()} user account(s)`}>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px_260px]">
          <input
            className={input}
            placeholder="Search name, username or email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <SearchableSelect
            className={input}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </SearchableSelect>
          <SearchableSelect
            className={input}
            value={filterRole}
            onChange={(e) => {
              setFilterRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.roleName}
              </option>
            ))}
          </SearchableSelect>
        </div>
        {loading ? (
          <Loader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {[
                    "User",
                    "Contact",
                    "Roles",
                    "Last login",
                    "Status",
                    "Action",
                  ].map((h) => (
                    <th key={h} className="px-4 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.userId}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="text-xs text-slate-500">
                        @{user.username}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{user.emailAddress}</div>
                      <div className="text-xs text-slate-500">
                        {user.phoneNumber || "No phone"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {user.userRoles.map((x) => (
                          <span
                            key={x.role.roleId}
                            className="rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-700"
                          >
                            {x.role.roleName}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${user.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="font-semibold text-aqua-700"
                        onClick={() => edit(user)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              className="rounded border px-3 py-1.5 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="rounded border px-3 py-1.5 disabled:opacity-40"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </Card>
      {(creating || selected) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/30"
          onMouseDown={() => {
            setCreating(false);
            setSelected(null);
          }}
        >
          <form
            onSubmit={save}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"
          >
            <div className="flex justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  {creating ? "Create user" : "Edit user"}
                </h2>
                <p className="text-sm text-slate-500">
                  Account identity and access roles
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setSelected(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                ["First name", "firstName"],
                ["Last name", "lastName"],
                ["Username", "username"],
                ["Email", "emailAddress"],
                ["Phone", "phoneNumber"],
                [
                  creating ? "Temporary password" : "New password (optional)",
                  "password",
                ],
              ].map(([label, key]) => (
                <label
                  key={key}
                  className={
                    key === "emailAddress" || key === "password"
                      ? "md:col-span-2"
                      : ""
                  }
                >
                  <span className="mb-1 block text-sm font-medium">
                    {label}
                  </span>
                  <input
                    className={input}
                    disabled={!creating && key === "username"}
                    required={
                      [
                        "firstName",
                        "lastName",
                        "username",
                        "emailAddress",
                      ].includes(key) ||
                      (creating && key === "password")
                    }
                    type={
                      key === "password"
                        ? "password"
                        : key === "emailAddress"
                          ? "email"
                          : "text"
                    }
                    value={(form as any)[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                <span className="mb-1 block text-sm font-medium">Status</span>
                <SearchableSelect
                  className={input}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </SearchableSelect>
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium">
                  User type
                </span>
                <SearchableSelect
                  className={input}
                  value={form.userType}
                  onChange={(e) =>
                    setForm({ ...form, userType: e.target.value })
                  }
                >
                  <option>STAFF</option>
                  <option>SYSTEM</option>
                </SearchableSelect>
              </label>
              <label className="md:col-span-2">
                <span className="mb-1 block text-sm font-medium">Roles *</span>
                <CheckboxMultiSelect
                  className={input}
                  placeholder="Select roles"
                  options={roles
                    .filter((r) => r.status === "ACTIVE")
                    .map((r) => ({ value: r.roleId, label: r.roleName }))}
                  value={form.roleIds}
                  onChange={(roleIds) => setForm({ ...form, roleIds })}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border px-4 py-2"
                onClick={() => {
                  setCreating(false);
                  setSelected(null);
                }}
              >
                Cancel
              </button>
              <button
                disabled={saving || !form.roleIds.length}
                className="rounded-lg bg-aqua-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save user"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  );
}

export function RoleAdministration() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    roleCode: "",
    roleName: "",
    description: "",
    status: "ACTIVE",
    permissionIds: [] as string[],
  });
  const load = async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        api.listAdminRoles(),
        api.listAdminPermissions(),
      ]);
      setRoles(r);
      setPermissions(p);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (isAdmin()) load();
  }, []);
  const edit = (r: Role) => {
    setSelected(r);
    setCreating(false);
    setForm({
      roleCode: r.roleCode,
      roleName: r.roleName,
      description: r.description || "",
      status: r.status,
      permissionIds: (r.rolePermissions || []).map(
        (x) => x.permission.permissionId,
      ),
    });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let role = selected;
      if (creating) role = await api.createAdminRole(form);
      else if (selected)
        role = await api.updateAdminRole(selected.roleId, form);
      await api.updateRolePermissions(role!.roleId, form.permissionIds);
      setSuccess("Role and permission grants saved.");
      setSelected(null);
      setCreating(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  if (!isAdmin())
    return (
      <Shell title="Role administration" subtitle="Manage access roles">
        <NoAccess />
      </Shell>
    );
  return (
    <Shell
      title="Role administration"
      subtitle="Define roles and grant only the permissions each job requires"
      action={
        <button
          className="rounded-lg bg-aqua-700 px-4 py-2.5 text-sm font-semibold text-white"
          onClick={() => {
            setCreating(true);
            setSelected(null);
            setForm({
              roleCode: "",
              roleName: "",
              description: "",
              status: "ACTIVE",
              permissionIds: [],
            });
          }}
        >
          + Add role
        </button>
      }
    >
      <Notice error={error} success={success} />
      {loading ? (
        <Loader />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
          <Card title={`${roles.length} role(s)`}>
            <div className="divide-y divide-slate-100">
              {roles.map((r) => (
                <button
                  key={r.roleId}
                  onClick={() => edit(r)}
                  className={`flex w-full items-center justify-between px-2 py-4 text-left ${selected?.roleId === r.roleId ? "bg-sky-50" : ""}`}
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      {r.roleName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.roleCode} · {r.rolePermissions?.length || 0}{" "}
                      permissions
                    </div>
                  </div>
                  <span className="text-sm text-slate-500">
                    {r._count?.userRoles || 0} users →
                  </span>
                </button>
              ))}
            </div>
          </Card>
          <Card
            title={
              creating
                ? "Create role"
                : selected
                  ? `Edit ${selected.roleName}`
                  : "Select a role"
            }
          >
            {!creating && !selected ? (
              <p className="text-sm text-slate-500">
                Choose a role to inspect and update its grants.
              </p>
            ) : (
              <form onSubmit={save} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Role code
                  </span>
                  <input
                    className={input}
                    required
                    value={form.roleCode}
                    disabled={!creating}
                    onChange={(e) =>
                      setForm({ ...form, roleCode: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Role name
                  </span>
                  <input
                    className={input}
                    required
                    value={form.roleName}
                    onChange={(e) =>
                      setForm({ ...form, roleName: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Description
                  </span>
                  <textarea
                    className={input}
                    rows={3}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Permission grants
                  </span>
                  <CheckboxMultiSelect
                    className={input}
                    placeholder="Select permissions"
                    options={permissions.map((p) => ({
                      value: p.permissionId,
                      label: `${p.moduleName} · ${p.permissionName}`,
                    }))}
                    value={form.permissionIds}
                    onChange={(permissionIds) =>
                      setForm({ ...form, permissionIds })
                    }
                  />
                </label>
                <button
                  disabled={saving}
                  className="w-full rounded-lg bg-aqua-700 px-4 py-2.5 font-semibold text-white"
                >
                  {saving ? "Saving…" : "Save role"}
                </button>
              </form>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}

export function PermissionRegister() {
  const [items, setItems] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    permissionCode: "",
    moduleName: "",
    permissionName: "",
    description: "",
  });
  const load = () =>
    api
      .listAdminPermissions()
      .then(setItems)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  useEffect(() => {
    if (isAdmin()) load();
  }, []);
  const filtered = useMemo(
    () =>
      items.filter((p) =>
        `${p.permissionCode} ${p.moduleName} ${p.permissionName}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
    [items, q],
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createAdminPermission(form);
      setShow(false);
      setForm({
        permissionCode: "",
        moduleName: "",
        permissionName: "",
        description: "",
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  if (!isAdmin())
    return (
      <Shell title="Permission register" subtitle="System permissions">
        <NoAccess />
      </Shell>
    );
  return (
    <Shell
      title="Permission register"
      subtitle="Maintain the catalogue used to grant access through roles"
      action={
        <button
          className="rounded-lg bg-aqua-700 px-4 py-2.5 text-sm font-semibold text-white"
          onClick={() => setShow(true)}
        >
          + Add permission
        </button>
      }
    >
      <Notice error={error} success="" />
      <Card title={`${filtered.length} permission(s)`}>
        <input
          className={`${input} mb-4`}
          placeholder="Search module, code or permission"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading ? (
          <Loader />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <div
                key={p.permissionId}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="text-xs font-semibold uppercase text-aqua-700">
                  {p.moduleName}
                </div>
                <div className="mt-1 font-bold text-slate-900">
                  {p.permissionName}
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  {p.permissionCode}
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {p.description || "No description"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
      {show && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
          <form
            onSubmit={save}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 className="text-xl font-bold">Add permission</h2>
            {[
              ["Permission code", "permissionCode"],
              ["Module", "moduleName"],
              ["Permission name", "permissionName"],
              ["Description", "description"],
            ].map(([l, k]) => (
              <label key={k} className="block">
                <span className="mb-1 block text-sm font-medium">{l}</span>
                <input
                  className={input}
                  required={k !== "description"}
                  value={(form as any)[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border px-4 py-2"
                onClick={() => setShow(false)}
              >
                Cancel
              </button>
              <button className="rounded-lg bg-aqua-700 px-4 py-2 font-semibold text-white">
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  );
}
