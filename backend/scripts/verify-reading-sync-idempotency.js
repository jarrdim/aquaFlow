require("dotenv").config();
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const base = process.env.CONTRACT_BASE_URL || "http://localhost:4000/api";
const fixture = {};
const results = [];

const token = (userId) => jwt.sign({
  userId: String(userId), username: "reading-sync-contract", userType: "STAFF", roles: ["METER_READER"],
}, process.env.JWT_SECRET);

async function sync(auth, reading) {
  const response = await fetch(base + "/readings/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ readings: [reading] }),
  });
  return { status: response.status, data: await response.json() };
}

async function cleanup() {
  if (fixture.meterId) {
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.meter_events WHERE meter_id=$1", fixture.meterId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.meter_readings WHERE meter_id=$1", fixture.meterId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.meter_assignments WHERE meter_id=$1", fixture.meterId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.meters WHERE meter_id=$1", fixture.meterId);
  }
  if (fixture.cycleId) {
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.route_assignments WHERE reading_cycle_id=$1", fixture.cycleId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.reading_cycles WHERE reading_cycle_id=$1", fixture.cycleId);
  }
  if (fixture.accountId)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.customer_accounts WHERE account_id=$1", fixture.accountId);
  if (fixture.propertyId)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.properties WHERE property_id=$1", fixture.propertyId);
  if (fixture.customerId)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.customers WHERE customer_id=$1", fixture.customerId);
}

(async () => {
  try {
    const target = (await prisma.$queryRawUnsafe(`SELECT fo.field_officer_id,fo.user_id,
      COALESCE(ca.route_id,p.route_id) route_id,p.zone_id,ca.category_id
      FROM aquaflow.field_officers fo CROSS JOIN aquaflow.customer_accounts ca
      JOIN aquaflow.properties p ON p.property_id=ca.property_id
      WHERE fo.status='ACTIVE' AND COALESCE(ca.route_id,p.route_id) IS NOT NULL LIMIT 1`))[0];
    if (!target) throw new Error("Local seed data required for disposable reading-sync test is unavailable");
    const stamp = Date.now();
    fixture.customerId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.customers
      (customer_number,customer_type,first_name,last_name,phone_number,status,created_by)
      VALUES($1,'INDIVIDUAL','Disposable','Sync Test',$2,'ACTIVE',$3) RETURNING customer_id`,
      `SYNC-CUST-${stamp}`, `+254${String(stamp).slice(-9)}`, target.user_id))[0].customer_id;
    fixture.propertyId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.properties
      (property_code,owner_customer_id,zone_id,route_id,physical_address,status)
      VALUES($1,$2,$3,$4,'Disposable sync contract property','ACTIVE') RETURNING property_id`,
      `SYNC-PROP-${stamp}`, fixture.customerId, target.zone_id, target.route_id))[0].property_id;
    fixture.accountId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.customer_accounts
      (account_number,customer_id,property_id,category_id,route_id,account_status)
      VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING account_id`,
      `SYNC-ACC-${stamp}`, fixture.customerId, fixture.propertyId, target.category_id, target.route_id))[0].account_id;
    fixture.cycleId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.reading_cycles
      (cycle_code,cycle_name,start_date,end_date,status,created_by,remarks)
      VALUES($1,$2,CURRENT_DATE,CURRENT_DATE + 1,'OPEN',$3,'Disposable idempotency contract cycle')
      RETURNING reading_cycle_id`, `SYNC-${stamp}`, `Sync test ${stamp}`, target.user_id))[0].reading_cycle_id;
    await prisma.$executeRawUnsafe(`INSERT INTO aquaflow.route_assignments
      (reading_cycle_id,route_id,field_officer_id,status,assigned_by,remarks)
      VALUES($1,$2,$3,'ASSIGNED',$4,'Disposable idempotency contract assignment')`,
      fixture.cycleId, target.route_id, target.field_officer_id, target.user_id);
    fixture.meterId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.meters
      (meter_number,meter_type,technology,meter_size_mm,installation_status,opening_reading,status,remarks)
      VALUES($1,'CUSTOMER','MANUAL',15,'INSTALLED',10,'ACTIVE','Disposable idempotency contract meter')
      RETURNING meter_id`, `SYNC-MTR-${stamp}`))[0].meter_id;
    await prisma.$executeRawUnsafe(`INSERT INTO aquaflow.meter_assignments
      (meter_id,account_id,assignment_date,assignment_status,installation_status,installed_by,remarks)
      VALUES($1,$2,CURRENT_DATE,'ACTIVE','COMPLETED',$3,'Disposable idempotency contract assignment')`,
      fixture.meterId, fixture.accountId, target.user_id);

    const auth = token(target.user_id);
    const syncId = `sync-contract-${stamp}`;
    const reading = {
      meterId: String(fixture.meterId), readingCycleId: String(fixture.cycleId), previousReading: 10,
      currentReading: 15, readingType: "ACTUAL", meterCondition: "GOOD", syncId, evidence: [],
    };
    const first = await sync(auth, reading);
    results.push({ name: "first submission accepted", pass: first.status === 200 && first.data.succeeded === 1 && first.data.results[0].duplicateSync === false });
    const retry = await sync(auth, reading);
    results.push({ name: "same syncId retry is idempotent success", pass: retry.status === 200 && retry.data.succeeded === 1 && retry.data.results[0].duplicateSync === true });
    const conflict = await sync(auth, { ...reading, syncId: `${syncId}-different` });
    results.push({
      name: "different operation for same meter/cycle is non-retryable conflict",
      pass: conflict.status === 200 && conflict.data.failed === 1 && conflict.data.results[0].statusCode === 409 && conflict.data.results[0].retryable === false,
    });
    const missing = await sync(auth, { ...reading, meterId: "999999999999", syncId: `${syncId}-missing` });
    results.push({
      name: "per-item authorization/validation metadata is explicit",
      pass: missing.status === 200 && missing.data.failed === 1 && missing.data.results[0].statusCode === 404 && missing.data.results[0].retryable === false,
    });
    const count = (await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::int count FROM aquaflow.meter_readings WHERE meter_id=$1 AND reading_cycle_id=$2",
      fixture.meterId, fixture.cycleId,
    ))[0].count;
    results.push({ name: "backend contains exactly one reading after retry", pass: count === 1 });

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
