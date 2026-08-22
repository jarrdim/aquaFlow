require("dotenv").config();
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const base = process.env.CONTRACT_BASE_URL || "http://localhost:4000/api";
const results = [];
const fixture = { workOrders: [], users: [] };
const expectedReasons = [
  ["CUSTOMER_UNAVAILABLE", "Customer unavailable"],
  ["SITE_INACCESSIBLE", "Site inaccessible"],
  ["SAFETY_RISK", "Safety risk"],
  ["METER_OR_EQUIPMENT_ISSUE", "Meter or equipment issue"],
  ["INCORRECT_TASK_DETAILS", "Incorrect task details"],
  ["REQUIRES_SUPERVISOR", "Requires supervisor"],
  ["OTHER", "Other"],
];

const token = (userId, roles = ["FIELD_OFFICER"]) => jwt.sign({
  userId: String(userId), username: "escalation-contract", userType: "STAFF", roles,
}, process.env.JWT_SECRET);

async function call(name, method, path, auth, body, expected) {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  results.push({ name, status: response.status, expected, pass: response.status === expected });
  return data;
}

async function cleanup() {
  for (const workOrderId of fixture.workOrders) {
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.work_order_updates WHERE work_order_id=$1", workOrderId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.work_order_assignments WHERE work_order_id=$1", workOrderId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.work_orders WHERE work_order_id=$1", workOrderId);
  }
  if (fixture.officerId)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.field_officers WHERE field_officer_id=$1", fixture.officerId);
  if (fixture.users.length)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.users WHERE user_id=ANY($1::bigint[])", fixture.users);
}

(async () => {
  try {
    const seed = (await prisma.$queryRawUnsafe(
      "SELECT field_officer_id,user_id FROM aquaflow.field_officers WHERE status='ACTIVE' LIMIT 1",
    ))[0];
    const target = (await prisma.$queryRawUnsafe(
      "SELECT ca.account_id,ca.property_id,p.zone_id FROM aquaflow.customer_accounts ca JOIN aquaflow.properties p ON p.property_id=ca.property_id LIMIT 1",
    ))[0];
    const type = (await prisma.$queryRawUnsafe(
      "SELECT work_order_type_id FROM aquaflow.work_order_types WHERE status='ACTIVE' AND requires_signature=FALSE LIMIT 1",
    ))[0];
    if (!seed || !target || !type) throw new Error("Local seed data required for disposable escalation test is unavailable");

    const stamp = Date.now();
    const users = await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.users
      (username,first_name,last_name,email_address,password_hash,user_type,status)
      VALUES($1,'Other','Officer',$2,'x','STAFF','ACTIVE'),($3,'No','Profile',$4,'x','STAFF','ACTIVE') RETURNING user_id`,
      `escalation.other.${stamp}`, `escalation.other.${stamp}@test.invalid`,
      `escalation.none.${stamp}`, `escalation.none.${stamp}@test.invalid`);
    fixture.users = users.map((row) => row.user_id);
    fixture.officerId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.field_officers
      (user_id,employee_number,officer_type,phone_number,status)
      VALUES($1,$2,'METER_READER',$3,'ACTIVE') RETURNING field_officer_id`,
      users[0].user_id, `ESC-${stamp}`, `+254${String(stamp).slice(-9)}`))[0].field_officer_id;

    async function createJob(label, status = "ASSIGNED") {
      const workOrderId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.work_orders
        (work_order_number,work_order_type_id,account_id,property_id,zone_id,priority,description,status,created_by,source_type)
        VALUES($1,$2,$3,$4,$5,'NORMAL','Disposable structured escalation contract job',$6,$7,'MANUAL')
        RETURNING work_order_id`, `ESC-WO-${label}-${stamp}`, type.work_order_type_id, target.account_id,
        target.property_id, target.zone_id, status, seed.user_id))[0].work_order_id;
      fixture.workOrders.push(workOrderId);
      const assignmentStatus = status === "ASSIGNED" ? "ASSIGNED" : status === "COMPLETED" ? "COMPLETED" : "ACCEPTED";
      await prisma.$executeRawUnsafe(`INSERT INTO aquaflow.work_order_assignments
        (work_order_id,field_officer_id,assigned_by,status) VALUES($1,$2,$3,$4)`,
        workOrderId, seed.field_officer_id, seed.user_id, assignmentStatus);
      return workOrderId;
    }

    const main = await createJob("MAIN");
    const otherReason = await createJob("OTHER");
    const validation = await createJob("VALIDATION");
    const optionalNotes = await createJob("OPTIONAL");
    const lifecycle = await createJob("LIFECYCLE");
    const own = token(seed.user_id);
    const other = token(users[0].user_id);
    const noProfile = token(users[1].user_id);
    const admin = token(seed.user_id, ["SYSTEM_ADMIN"]);
    const statusPath = (id) => `/mobile/field/work-orders/${id}/status`;

    const reasonResponse = await call("controlled reasons endpoint", "GET", "/mobile/field/work-orders/escalation-reasons", own, null, 200);
    const reasonPairs = reasonResponse.items?.map((item) => [item.code, item.label]);
    results.push({ name: "reason codes and labels are exact and stable", pass: JSON.stringify(reasonPairs) === JSON.stringify(expectedReasons) });
    results.push({ name: "reason codes contain no duplicates", pass: new Set(reasonResponse.items?.map((item) => item.code)).size === expectedReasons.length });

    const list = await call("own task list", "GET", "/mobile/field/work-orders", own, null, 200);
    const listed = list.items?.find((item) => String(item.workOrderId) === String(main));
    results.push({
      name: "selector context is present",
      pass: Boolean(listed?.workOrderNumber && listed?.taskType && listed?.status && (listed?.customerName || listed?.accountNumber || listed?.zoneName)),
    });

    await call("missing reason rejected", "PATCH", statusPath(validation), own,
      { status: "ESCALATED", notes: "Site inaccessible." }, 400);
    await call("invalid reason rejected", "PATCH", statusPath(validation), own,
      { status: "ESCALATED", reasonCode: "MADE_UP_REASON" }, 400);
    await call("Other without notes rejected", "PATCH", statusPath(validation), own,
      { status: "ESCALATED", reasonCode: "OTHER" }, 400);
    await call("whitespace notes rejected", "PATCH", statusPath(validation), own,
      { status: "ESCALATED", reasonCode: "OTHER", notes: "   " }, 400);
    await call("notes above 250 rejected", "PATCH", statusPath(validation), own,
      { status: "ESCALATED", reasonCode: "SITE_INACCESSIBLE", notes: "x".repeat(251) }, 400);
    await call("different officer forbidden", "PATCH", statusPath(validation), other,
      { status: "ESCALATED", reasonCode: "SITE_INACCESSIBLE", notes: "Gate locked." }, 403);
    await call("no-profile user forbidden", "PATCH", statusPath(validation), noProfile,
      { status: "ESCALATED", reasonCode: "SITE_INACCESSIBLE", notes: "Gate locked." }, 403);

    const notes = "Gate locked.";
    const mainResponse = await call("valid structured escalation", "PATCH", statusPath(main), own,
      { status: "ESCALATED", reasonCode: "SITE_INACCESSIBLE", notes: `  ${notes}  ` }, 200);
    results.push({
      name: "authoritative escalation response",
      pass: String(mainResponse.workOrderId) === String(main) && mainResponse.status === "ESCALATED" && mainResponse.previousStatus === "ASSIGNED" &&
        mainResponse.reasonCode === "SITE_INACCESSIBLE" && mainResponse.notes === notes &&
        !Number.isNaN(Date.parse(mainResponse.escalatedAt)),
    });
    const otherNotes = "Requires investigation by billing team.";
    await call("Other with meaningful notes succeeds", "PATCH", statusPath(otherReason), own,
      { status: "ESCALATED", reasonCode: "OTHER", notes: otherNotes }, 200);
    const optionalResponse = await call("defined reason permits omitted notes", "PATCH", statusPath(optionalNotes), own,
      { status: "ESCALATED", reasonCode: "SAFETY_RISK" }, 200);
    results.push({ name: "omitted notes return null", pass: optionalResponse.notes === null });
    await call("already escalated conflict", "PATCH", statusPath(main), own,
      { status: "ESCALATED", reasonCode: "SITE_INACCESSIBLE", notes }, 409);

    const stored = (await prisma.$queryRawUnsafe(`SELECT wo.status,a.status assignment_status,u.previous_status,u.new_status,
      u.reason_code,u.notes,u.field_officer_id,u.updated_at FROM aquaflow.work_orders wo
      JOIN aquaflow.work_order_assignments a ON a.work_order_id=wo.work_order_id
      JOIN aquaflow.work_order_updates u ON u.work_order_id=wo.work_order_id
      WHERE wo.work_order_id=$1 ORDER BY u.updated_at DESC LIMIT 1`, main))[0];
    results.push({
      name: "structured reason, notes, officer and history persisted",
      pass: Boolean(stored && stored.status === "ESCALATED" && stored.assignment_status === "ASSIGNED" &&
        stored.previous_status === "ASSIGNED" && stored.new_status === "ESCALATED" &&
        stored.reason_code === "SITE_INACCESSIBLE" && stored.notes === notes && stored.updated_at &&
        String(stored.field_officer_id) === String(seed.field_officer_id)),
    });
    const mobileDetail = await call("mobile history detail", "GET", `/mobile/field/work-orders/${main}`, own, null, 200);
    results.push({
      name: "mobile history exposes structured escalation",
      pass: mobileDetail.notes?.[0]?.reasonCode === "SITE_INACCESSIBLE" && mobileDetail.notes[0].notes === notes,
    });
    const adminDetail = await call("admin work-order detail", "GET", `/work-orders/${main}`, admin, null, 200);
    results.push({
      name: "admin history exposes structured escalation",
      pass: adminDetail.updates?.[0]?.reason_code === "SITE_INACCESSIBLE" && adminDetail.updates[0].notes === notes &&
        Boolean(adminDetail.updates[0].first_name),
    });

    await call("non-escalation assigned to accepted", "PATCH", statusPath(lifecycle), own,
      { status: "ACCEPTED", notes: "Accepted for testing" }, 200);
    await call("non-escalation accepted to in progress", "PATCH", statusPath(lifecycle), own,
      { status: "IN_PROGRESS", notes: "Work started" }, 200);
    await call("non-escalation in progress to completed", "PATCH", statusPath(lifecycle), own,
      { status: "COMPLETED", notes: "Work completed" }, 200);
    const lifecycleState = (await prisma.$queryRawUnsafe(`SELECT wo.status,
      COUNT(*) FILTER (WHERE u.reason_code IS NOT NULL)::int structured_reasons
      FROM aquaflow.work_orders wo JOIN aquaflow.work_order_updates u ON u.work_order_id=wo.work_order_id
      WHERE wo.work_order_id=$1 GROUP BY wo.status`, lifecycle))[0];
    results.push({
      name: "ordinary transition contract remains compatible",
      pass: lifecycleState.status === "COMPLETED" && lifecycleState.structured_reasons === 0,
    });

    console.log(JSON.stringify({
      passed: results.filter((item) => item.pass).length,
      total: results.length,
      failed: results.filter((item) => !item.pass),
      results,
    }, null, 2));
    if (results.some((item) => !item.pass)) process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
