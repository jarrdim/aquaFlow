# AquaFlow — Water Utility Management

Android field-app integration and offline synchronization are documented in
[`docs/ANDROID_FIELD_APP_HANDOFF.md`](docs/ANDROID_FIELD_APP_HANDOFF.md).

Live server installation and database upgrade commands are preserved in
[`LIVE_DEPLOYMENT.md`](LIVE_DEPLOYMENT.md). Follow that checklist in order when
transferring a new release to production.

This is a working first slice of the AquaFlow Water Distribution, Billing and Field
Management System, built from your Functional Requirements Specification and
`aquaflow_postgresql_ddl.sql`. It covers FRS sections **3.1 (Authentication)** and
**3.2 (Customer Management)** — the top of the phase-1 priority list in your spec.

Stack: **Node.js + TypeScript + Express + Prisma + PostgreSQL** (backend),
**React + Vite + TypeScript + Tailwind** (frontend).

## What's included

- Login (JWT-based) against the `users` / `roles` / `user_roles` tables
- Customer list with search
- Create customer (enforces the INDIVIDUAL/ORGANIZATION rule from the DDL's
  `ck_customer_identity` constraint at the API layer too, so you get a clean
  400 error instead of a raw Postgres error)
- **Edit customer** (name, contact info, status)
- **Properties**: create a property under a customer (zone required, service
  area / route optional — matches the DDL's FK structure)
- **Customer accounts**: open an account linking a customer + property +
  customer category, enforcing the FRS rule that "an account shall not be
  activated without a valid customer, property and customer category"
- Lookup endpoints (`/api/lookups/*`) powering the zone/area/route/category
  dropdowns in the property and account forms
- A Prisma schema covering the tables this slice touches (customers,
  properties, accounts, zones, service areas, routes, users/roles/permissions),
  hand-mapped to match your DDL's table/column names exactly
- Complete meter lifecycle management: inventory registration, customer/bulk/
  zone/borehole assignment, installation evidence and materials, status audit
  history, alerts, work-order creation, replacement approval, and Excel/CSV import
- Complete meter-reading operations: cycles, route/reader assignments, worklists,
  actual/estimated/smart capture, photo and GPS evidence, offline synchronization,
  exception detection, supervisor approval, register export and route progress
- Complete tariff management: flat, consumption and tiered definitions, continuous
  bands, single/bulk simulation, maker-checker approval, scheduled activation,
  category assignment history, tariff comparison and permanent audit events
- Complete billing management: billing periods, preview and generation, itemized
  tariff calculations, maker-checker approval, controlled posting, invoices,
  statements, notifications, adjustments, security alerts and audit events
- Payment and revenue management: payment channels, automatic oldest-bill
  allocation, partial and advance payments, receipts, unmatched payments,
  reversal approval, daily collections, reconciliation and payment audit
- Complete arrears and debt management: overdue balance ageing, customer debt
  profiles, reminder queues, maker-checker demand notices, payment plans,
  promises to pay, controlled disconnection lists, debt write-off approvals,
  recovery reporting and audit history

**If you already had this running:** apply the additive meter upgrade before
regenerating Prisma. It preserves existing records and may be safely re-run:

```bash
cd backend
npm run db:meter-upgrade
npm run db:reading-upgrade
npm run db:meter-event-upgrade
npm run db:tariff-upgrade
npm run db:billing-upgrade
npm run db:payment-upgrade
npm run db:mpesa-upgrade
npm run db:notification-upgrade
npm run db:arrears-upgrade
npm run db:admin-upgrade
npm run db:service-request-upgrade
npm run db:settings-upgrade
npm run db:legacy-settings-upgrade
npm run db:work-order-upgrade
npm run prisma:generate
```

## One-time setup

1. **Create the database and run your DDL** (Postgres 14+ recommended):

   ```bash
   createdb aquaflow
   psql aquaflow -f aquaflow_postgresql_ddl.sql
   ```

2. **Backend:**

   ```bash
   cd backend
   cp .env.example .env
   # edit .env: set DATABASE_URL to your local Postgres connection string
   npm install
   npm run db:meter-upgrade # adds the complete meter-management extension
   npm run db:reading-upgrade # adds reading evidence, audit and sync support
   npm run db:tariff-upgrade # adds tariff workflow, simulation and audit support
   npm run db:billing-upgrade # adds bills, periods and control workflows
   npm run db:payment-upgrade # adds payment, receipt and reconciliation workflows
   npm run db:mpesa-upgrade # adds M-Pesa Express request and callback tracking
   npm run db:notification-upgrade # adds providers and delivery tracking
   npm run db:arrears-upgrade # adds arrears, plans and recovery controls
   npm run prisma:generate
   npm run seed          # creates an admin user: admin / ChangeMe123!
   npm run dev            # http://localhost:4000
   ```

3. **Frontend** (separate terminal):

   ```bash
   cd frontend
   npm install
   npm run dev             # http://localhost:5173
   ```

4. Log in at `http://localhost:5173` with `admin` / `ChangeMe123!` and change
   that password immediately — it's a seed default, not for real use.

### Local workflow test users

`npm run seed` creates these idempotent local accounts. Their default password is
`ChangeMe123!`, or the value of `SEED_DEFAULT_PASSWORD` when the seed is run.
It does not create zones, service areas or routes by default, so operational
geography can be imported first without primary-key collisions. To assign the
seeded meter reader and supervisor to an imported zone, set
`SEED_FIELD_OFFICER_ZONE_CODE` to that zone's code before running the seed.
For the original local demo geography (`ZONE-01`, `AREA-01`, `ROUTE-01`), set
`SEED_DEMO_GEOGRAPHY=true`.

| Username             | Role                 | Typical test action                      |
| -------------------- | -------------------- | ---------------------------------------- |
| `admin`              | System Administrator | Configuration and administration         |
| `billing.officer`    | Billing Officer      | Create tariffs/periods and generate bills|
| `billing.supervisor` | Billing Supervisor   | Approve tariffs, bills and adjustments   |
| `finance.manager`    | Finance Manager      | Activate tariffs and post approved bills |
| `meter.reader`       | Meter Reader         | Capture assigned route readings          |
| `meter.supervisor`   | Meter Supervisor     | Approve readings and meter operations    |
| `cashier`            | Cashier              | Record payments and issue receipts       |
| `accountant`         | Accountant           | Reconcile collections and check controls |
| `auditor`            | Auditor              | Review financial and operational audits  |
| `credit.officer`     | Credit Control Officer | Reminders, notices, plans and follow-up |
| `credit.supervisor`  | Credit Control Supervisor | Approve notices and payment plans    |
| `customer.care`      | Customer Care Officer | View balances and record promises       |

Maker-checker tests must use different accounts—for example, create a tariff as
`billing.officer`, then approve it as `billing.supervisor`. Change all seeded
passwords before using the application outside local testing.

### Billing workflow test

Billing depends on the completed customer-to-reading chain. Test it in this order:

1. Sign in as `meter.supervisor`, approve the readings, then close their reading
   cycle. A billing period can only use one closed reading cycle.
2. Confirm every account being billed is active and its customer category has an
   active tariff effective for the period. Preview reports missing readings,
   tariffs and duplicate bills before anything is generated.
3. Sign in as `billing.officer`, open **Billing → Billing Periods**, create a
   period, then use **Bill Generation** to preview and generate draft bills.
4. Sign in as `billing.supervisor`, open **Bill Approvals**, review consumption,
   standing charge, meter rent and minimum-charge adjustment, then approve or
   return the bills. The generator cannot approve their own bills.
5. Sign in as `finance.manager` and post the approved billing period. Posting is
   when the new charges are added to customer account balances.
6. Verify the output under **Invoices**, **Statements** and **Notifications**.
   Notification records are stored locally; actual SMS/email delivery requires a
   provider integration.
7. Test adjustments with different maker and checker users, and verify blocked
   self-approval under **Billing Security Alerts** and **Billing Audit**.

### Arrears and debt workflow test

Arrears are based on overdue bills, not merely a positive account balance. A
posted bill appears in arrears only after its due date.

1. Sign in as `credit.officer`, open **Arrears & Debt → Arrears Ageing
   Report**, and set the report date after the bill due date.
2. Use **Payment Reminders** to select overdue accounts and queue SMS, email or
   app messages. Process them in **Notifications → Delivery Queue**.
3. Create a demand notice, then sign in as `credit.supervisor` to approve or
   return it. Confirm the creator cannot approve their own notice.
4. Create a payment plan as `credit.officer`; approve it as
   `credit.supervisor`, then inspect its instalment schedule.
5. Sign in as `customer.care` and record a promise to pay.
6. After an approved final demand, create a disconnection list and decide it as
   `finance.manager`.
7. For debt aged at least 120 days, submit a write-off request as
   `credit.officer` and decide it as `finance.manager`. Approval records the
   controlled decision; financial posting remains a separate accounting action.
8. Review **Debt Recovery Report**, **Customer Debt Profile**, and **Arrears
   Audit Trail** to reconcile every recovery action.

### M-Pesa Express (STK Push)

Open **Payments & Revenue -> M-Pesa Express** to send a payment prompt. The
request remains pending until Daraja calls AquaFlow's callback endpoint. Only a
successful callback creates and allocates the payment and generates a receipt;
cancelled, timed-out and failed prompts do not change the customer balance.

Copy the M-Pesa variables from `backend/.env.example` into `backend/.env` and
replace the placeholders with newly generated credentials from one Daraja app.
`MPESA_CALLBACK_URL` must be a public HTTPS URL ending in
`/api/payments/mpesa/callback?token=...`. Set the same long random value in
`MPESA_CALLBACK_TOKEN` so unsolicited callbacks are rejected. For local sandbox
testing, expose backend port 4000 through a secure tunnel. Never commit Consumer
Secrets, passkeys or callback tokens.

### M-Pesa PayBill (C2B)

PayBill payments made directly from a customer's phone are received through
Daraja C2B validation and confirmation callbacks. Copy the `MPESA_C2B_*`
variables from `backend/.env.example`, set both callback URLs to the public
HTTPS API address, and use separate long random validation and confirmation
tokens. The optional dedicated
`MPESA_C2B_CONSUMER_KEY` and `MPESA_C2B_CONSUMER_SECRET` let C2B use a separate
Daraja app while the existing `MPESA_CONSUMER_*` credentials continue serving
STK Push. After deployment, an
authenticated System Administrator or Finance Manager must register the URLs
once by sending `POST /api/payments/mpesa/c2b/register`.

Daraja rejects callback URLs containing the word `mpesa`, so the public C2B
callbacks use `/api/payments/c2b/validation` and
`/api/payments/c2b/confirmation`.
The current Daraja C2B integration uses the v2 register and callback contract.
Use the predefined C2B shortcode shown by the Daraja sandbox simulator rather
than copying a shortcode from a documentation example.

The customer's PayBill account number (`BillRefNumber`) is matched
case-insensitively to an AquaFlow customer account. A match posts the payment,
allocates it to the oldest open bills, updates the account balance, creates a
receipt, and records an audit event. Confirmed payments with unknown account
numbers are retained in suspense for manual allocation. Repeated callbacks are
safe because the M-Pesa transaction ID is unique.

### Notification management test

Open **Notifications** from the main sidebar. The database upgrade creates safe
simulated SMS, email and push providers, so local delivery tests do not contact a
customer or incur provider charges.

1. Sign in as `admin` and check **Templates** and **Providers**. Only a System
   Administrator can create, activate or deactivate this configuration.
2. Open **Send Notification**, select an account, posted bill or payment, choose
   a message type and one or more channels, then send immediately or schedule it.
3. Use **Delivery Queue** to process due scheduled messages and retry failed
   attempts. A retry stops when the configured maximum is reached.
4. Use **Notification History** to verify the rendered message, recipient,
   provider, delivery status, failure reason and account association.
5. For live delivery, add an HTTP API provider only after its credentials,
   endpoint and delivery callback have been secured. The current HTTP provider
   mode intentionally fails closed until a connector is implemented.

Billing officers, billing supervisors, finance managers, cashiers and
accountants may send/process notifications. Auditors have read-only access.

For real email, sign in as `admin`, open **Notifications → Providers**, select
**SMTP Email Gateway**, and choose **Configure SMTP**. Gmail normally uses host
`smtp.gmail.com`, port `587`, and STARTTLS (leave Direct TLS off). Use a newly
generated Google app password and a From address that matches the authenticated
account or a verified Gmail alias. AquaFlow encrypts the password with
`NOTIFICATION_ENCRYPTION_KEY` (falling back to `JWT_SECRET` for existing local
setups), never returns it to the browser, and provides a verify/test-email action
before the provider is activated and made default. Rotate any credential that
has been pasted into chat, logs or screenshots.

> Note: this schema.prisma is a hand-written subset (customers, accounts,
> properties, users, roles/permissions) that mirrors the DDL. Once your
> database is running the full DDL, run `npm run prisma:pull` in `backend/`
> to have Prisma introspect and regenerate the schema for **all 66 tables**
> automatically — that's the fastest way to unlock the next modules below.

## Suggested build order (from your FRS §5 priority list)

Completed modules and recommended next work, in order:

1. **Completed:** meters and meter assignment (3.5)
2. **Completed:** meter readings and approvals (3.6)
3. **Completed:** tariffs, simulation and activation (3.7)
4. **Completed:** billing, invoices and adjustments (3.8)
5. **Completed:** payments, allocations, receipts and revenue controls (3.9)
6. **Completed:** notification templates, queue, providers and delivery history (3.20)
7. **Completed:** arrears, debt recovery and controlled escalation (3.10)
8. **Complaints and work orders** (3.11–3.13)
9. **User roles / permissions UI** (3.1) — admin role-management screens
10. **Cross-module audit reporting** (3.24)

Each of these maps directly to a DDL section and an FRS subsection, so the
same pattern used here (Prisma model → Express route with zod validation →
React page) repeats cleanly.

## Known limitation in this sandbox

`prisma generate` needs to download a query-engine binary from
`binaries.prisma.sh`, which isn't reachable from the environment this was
built in. It will work normally on your machine — just run
`npm run prisma:generate` after `npm install`.
