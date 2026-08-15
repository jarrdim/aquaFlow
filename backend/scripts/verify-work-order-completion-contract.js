require("dotenv").config();
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const base = process.env.CONTRACT_BASE_URL || "http://localhost:4000/api";
const results = [];
const fixture = { workOrders: [], users: [], inventory: [] };

const token = (userId, roles = ["FIELD_OFFICER"]) => jwt.sign({
  userId: String(userId), username: "completion-contract", userType: "STAFF", roles,
}, process.env.JWT_SECRET);

async function call(name, method, path, auth, body, expected) {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("json") ? await response.json() : await response.arrayBuffer();
  results.push({ name, status: response.status, expected, pass: response.status === expected });
  return data;
}

async function cleanup() {
  for (const workOrderId of fixture.workOrders) {
    for (const table of ["work_order_updates", "work_order_materials", "work_order_assignments", "work_order_evidence", "field_work_order_completion_reports"])
      await prisma.$executeRawUnsafe(`DELETE FROM aquaflow.${table} WHERE work_order_id=$1`, workOrderId);
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.work_orders WHERE work_order_id=$1", workOrderId);
  }
  for (const inventoryId of fixture.inventory)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.inventory_items WHERE inventory_item_id=$1", inventoryId);
  if (fixture.typeId)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.work_order_types WHERE work_order_type_id=$1", fixture.typeId);
  if (fixture.officerId)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.field_officers WHERE field_officer_id=$1", fixture.officerId);
  if (fixture.users.length)
    await prisma.$executeRawUnsafe("DELETE FROM aquaflow.users WHERE user_id=ANY($1::bigint[])", fixture.users);
}

(async () => {
  try {
    const seed = (await prisma.$queryRawUnsafe("SELECT field_officer_id,user_id FROM aquaflow.field_officers WHERE status='ACTIVE' LIMIT 1"))[0];
    const target = (await prisma.$queryRawUnsafe(`SELECT ca.account_id,ca.property_id,p.zone_id FROM aquaflow.customer_accounts ca JOIN aquaflow.properties p ON p.property_id=ca.property_id LIMIT 1`))[0];
    const stamp = Date.now();
    const users = await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.users
      (username,first_name,last_name,email_address,password_hash,user_type,status)
      VALUES($1,'Other','Officer',$2,'x','STAFF','ACTIVE'),($3,'No','Profile',$4,'x','STAFF','ACTIVE') RETURNING user_id`,
      `completion.other.${stamp}`, `completion.other.${stamp}@test.invalid`,
      `completion.none.${stamp}`, `completion.none.${stamp}@test.invalid`);
    fixture.users = users.map((row) => row.user_id);
    fixture.officerId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.field_officers
      (user_id,employee_number,officer_type,phone_number,status)
      VALUES($1,$2,'METER_READER',$3,'ACTIVE') RETURNING field_officer_id`,
      users[0].user_id, `CMP-${stamp}`, `+254${String(stamp).slice(-9)}`))[0].field_officer_id;
    fixture.typeId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.work_order_types
      (type_code,type_name,description,requires_photo,requires_gps,requires_signature,status)
      VALUES($1,$2,'Disposable completion contract type',FALSE,FALSE,TRUE,'ACTIVE') RETURNING work_order_type_id`,
      `CMP_${stamp}`, `Completion test ${stamp}`))[0].work_order_type_id;
    const inventory = await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.inventory_items
      (item_code,item_name,item_category,unit_of_measure,unit_cost,reorder_level,status)
      VALUES($1,'PVC coupling','FITTING','pcs',50,0,'ACTIVE'),($2,'Service pipe','PIPE','m',80,0,'ACTIVE')
      RETURNING inventory_item_id,item_code,unit_of_measure`, `CMP-A-${stamp}`, `CMP-B-${stamp}`);
    fixture.inventory = inventory.map((row) => row.inventory_item_id);

    async function createJob(label, status = "IN_PROGRESS", typeId = fixture.typeId) {
      const workOrderId = (await prisma.$queryRawUnsafe(`INSERT INTO aquaflow.work_orders
        (work_order_number,work_order_type_id,account_id,property_id,zone_id,priority,description,status,created_by,source_type,started_at)
        VALUES($1,$2,$3,$4,$5,'NORMAL','Disposable completion contract job',$6,$7,'MANUAL',CASE WHEN $6='IN_PROGRESS' THEN NOW() ELSE NULL END)
        RETURNING work_order_id`, `CMP-WO-${label}-${stamp}`, typeId, target.account_id,
        target.property_id, target.zone_id, status, seed.user_id))[0].work_order_id;
      fixture.workOrders.push(workOrderId);
      await prisma.$executeRawUnsafe(`INSERT INTO aquaflow.work_order_assignments
        (work_order_id,field_officer_id,assigned_by,status,accepted_at)
        VALUES($1,$2,$3,$4,CASE WHEN $4='ACCEPTED' THEN NOW() ELSE NULL END)`,
        workOrderId, seed.field_officer_id, seed.user_id, status === "ASSIGNED" ? "ASSIGNED" : "ACCEPTED");
      return workOrderId;
    }

    const main = await createJob("MAIN");
    const noMaterials = await createJob("NONE");
    const assigned = await createJob("ASSIGNED", "ASSIGNED");
    const disconnectionType = (await prisma.$queryRawUnsafe(`SELECT work_order_type_id FROM aquaflow.work_order_types WHERE type_code='DISCONNECTION'`))[0];
    const specialized = await createJob("SPECIAL", "IN_PROGRESS", disconnectionType.work_order_type_id);
    const own = token(seed.user_id), other = token(users[0].user_id), none = token(users[1].user_id);
    const admin = token(seed.user_id, ["SYSTEM_ADMIN"]);
    const mainPath = `/mobile/field/work-orders/${main}/completion`;
    const signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    let data = await call("catalogue", "GET", "/mobile/field/work-orders/materials/catalogue", own, null, 200);
    results.push({ name: "catalogue uses inventory IDs and units", pass: data.items.some((item) => String(item.materialId) === String(inventory[0].inventory_item_id) && item.unit === "pcs") });
    await call("catalogue no profile", "GET", "/mobile/field/work-orders/materials/catalogue", none, null, 403);
    data = await call("own detail", "GET", `/mobile/field/work-orders/${main}`, own, null, 200);
    results.push({ name: "eligible detail context", pass: Boolean(data.completionEligible === true && data.completion?.eligible === true && data.customerName && data.accountNumber) });
    await call("cross detail", "GET", `/mobile/field/work-orders/${main}`, other, null, 403);
    await call("no-profile detail", "GET", `/mobile/field/work-orders/${main}`, none, null, 403);
    data = await call("specialized detail", "GET", `/mobile/field/work-orders/${specialized}`, own, null, 200);
    results.push({ name: "Screen 24/25 types excluded", pass: data.completionEligible === false && data.completion?.eligible === false });
    await call("specialized completion rejected", "POST", `/mobile/field/work-orders/${specialized}/completion/draft`, own, {}, 409);

    await call("invalid material", "POST", `${mainPath}/draft`, own, { materials: [{ materialId: "999999999", quantity: 1, unit: "pcs" }] }, 400);
    await call("zero quantity", "POST", `${mainPath}/draft`, own, { materials: [{ materialId: String(inventory[0].inventory_item_id), quantity: 0, unit: "pcs" }] }, 400);
    await call("negative quantity", "POST", `${mainPath}/draft`, own, { materials: [{ materialId: String(inventory[0].inventory_item_id), quantity: -1, unit: "pcs" }] }, 400);
    await call("invalid unit", "POST", `${mainPath}/draft`, own, { materials: [{ materialId: String(inventory[0].inventory_item_id), quantity: 1, unit: "kg" }] }, 400);
    await call("duplicate material", "POST", `${mainPath}/draft`, own, { materials: [
      { materialId: String(inventory[0].inventory_item_id), quantity: 1, unit: "pcs" },
      { materialId: String(inventory[0].inventory_item_id), quantity: 2, unit: "pcs" },
    ] }, 400);
    await call("partial materials draft", "POST", `${mainPath}/draft`, own, { materials: [{ materialId: String(inventory[0].inventory_item_id), quantity: 2, unit: "pcs" }] }, 200);
    await call("repeated partial draft", "POST", `${mainPath}/draft`, own, { customerNameConfirmed: true }, 200);
    const merged = (await prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT r.completion_report_id)::int reports,COUNT(m.usage_id)::int materials,
      bool_or(r.customer_name_confirmed) confirmed FROM aquaflow.field_work_order_completion_reports r
      LEFT JOIN aquaflow.work_order_materials m ON m.completion_report_id=r.completion_report_id WHERE r.work_order_id=$1`, main))[0];
    results.push({ name: "one merged report", pass: merged.reports === 1 && merged.materials === 1 && merged.confirmed });
    await call("cross draft", "POST", `${mainPath}/draft`, other, { customerNameConfirmed: true }, 403);
    await call("no-profile draft", "POST", `${mainPath}/draft`, none, { customerNameConfirmed: true }, 403);
    await call("cross signature upload", "POST", `${mainPath}/signature`, other, { content: signature }, 403);
    await call("no-profile signature upload", "POST", `${mainPath}/signature`, none, { content: signature }, 403);
    await call("invalid signature", "POST", `${mainPath}/signature`, own, { content: "data:image/png;base64," + "A".repeat(120) }, 400);
    data = await call("signature upload", "POST", `${mainPath}/signature`, own, { content: signature }, 201);
    await call("signature content", "GET", `${mainPath}/signature/content`, own, null, 200);
    await call("cross signature content", "GET", `${mainPath}/signature/content`, other, null, 403);
    await call("signature replace", "POST", `${mainPath}/signature`, own, { content: signature }, 201);
    const signatures = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int count FROM aquaflow.work_order_evidence WHERE work_order_id=$1 AND evidence_type='SIGNATURE'`, main))[0].count;
    results.push({ name: "signature replacement is one-to-one", pass: signatures === 1 });
    await call("cross signature delete", "DELETE", `${mainPath}/signature`, other, null, 403);
    await call("signature delete", "DELETE", `${mainPath}/signature`, own, null, 200);
    await call("signature retake", "POST", `${mainPath}/signature`, own, { content: signature }, 201);
    await call("missing confirmation", "POST", `${mainPath}/submit`, own, { customerNameConfirmed: false, customerIdentityConfirmed: true, noMaterialsUsed: false, completionNotes: "Done" }, 400);
    await call("wrong work-order status", "POST", `/mobile/field/work-orders/${assigned}/completion/submit`, own, { customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: true, completionNotes: "Done" }, 409);
    await call("Screen 22 direct completion blocked", "PATCH", `/mobile/field/work-orders/${main}/status`, own, { status: "COMPLETED", notes: "Done" }, 409);

    await call("missing required signature", "POST", `/mobile/field/work-orders/${noMaterials}/completion/submit`, own,
      { materials: [], customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: true, completionNotes: "Completed without materials" }, 400);
    await call("no-material signature", "POST", `/mobile/field/work-orders/${noMaterials}/completion/signature`, own, { content: signature }, 201);
    data = await call("explicit no-material completion", "POST", `/mobile/field/work-orders/${noMaterials}/completion/submit`, own,
      { materials: [], customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: true, completionNotes: "Completed without materials" }, 200);
    results.push({ name: "no-material state completed", pass: data.status === "COMPLETED" && data.completion.noMaterialsUsed === true });

    const stockBefore = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int count FROM aquaflow.stock_transactions WHERE work_order_id=ANY($1::bigint[])`, fixture.workOrders))[0].count;
    await call("cross final submission", "POST", `${mainPath}/submit`, other, { customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: false, completionNotes: "Denied" }, 403);
    await call("no-profile final submission", "POST", `${mainPath}/submit`, none, { customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: false, completionNotes: "Denied" }, 403);
    data = await call("valid final completion", "POST", `${mainPath}/submit`, own, {
      materials: [{ materialId: String(inventory[0].inventory_item_id), quantity: 2, unit: "pcs" }],
      customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: false,
      completionNotes: "Repair completed and acknowledged",
    }, 200);
    results.push({ name: "completion response", pass: data.status === "COMPLETED" && data.assignmentStatus === "COMPLETED" && data.completion.status === "SUBMITTED" });
    data = await call("completed reload", "GET", `/mobile/field/work-orders/${main}`, own, null, 200);
    results.push({ name: "completed detail readable", pass: Boolean(data.status === "COMPLETED" && data.assignmentStatus === "COMPLETED" && data.completion.signature) });
    await call("completed draft locked", "POST", `${mainPath}/draft`, own, { completionNotes: "Again" }, 409);
    await call("completed signature locked", "POST", `${mainPath}/signature`, own, { content: signature }, 409);
    await call("completed signature delete locked", "DELETE", `${mainPath}/signature`, own, null, 409);
    await call("completed signature readable", "GET", `${mainPath}/signature/content`, own, null, 200);
    await call("duplicate submit", "POST", `${mainPath}/submit`, own, { customerNameConfirmed: true, customerIdentityConfirmed: true, noMaterialsUsed: false, completionNotes: "Again" }, 409);
    await call("cross completed detail", "GET", `/mobile/field/work-orders/${main}`, other, null, 403);
    const stockAfter = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int count FROM aquaflow.stock_transactions WHERE work_order_id=ANY($1::bigint[])`, fixture.workOrders))[0].count;
    results.push({ name: "stock transactions unchanged", pass: stockBefore === stockAfter && stockAfter === 0 });
    const states = (await prisma.$queryRawUnsafe(`SELECT wo.status,a.status assignment_status,r.status report_status
      FROM aquaflow.work_orders wo JOIN aquaflow.work_order_assignments a ON a.work_order_id=wo.work_order_id
      JOIN aquaflow.field_work_order_completion_reports r ON r.work_order_id=wo.work_order_id WHERE wo.work_order_id=$1`, main))[0];
    results.push({ name: "transactional completion states", pass: states.status === "COMPLETED" && states.assignment_status === "COMPLETED" && states.report_status === "SUBMITTED" });
    data = await call("admin detail", "GET", `/work-orders/${main}`, admin, null, 200);
    results.push({ name: "admin completion visible and signature protected", pass: Boolean(data.completionEvidence?.status === "SUBMITTED" && data.completionEvidence.materials?.length === 1 && data.completionEvidence.signature?.contentUrl && !data.completionEvidence.file_path) });
    await call("admin protected signature", "GET", `/work-orders/${main}/completion/signature/content`, admin, null, 200);

    console.log(JSON.stringify({ passed: results.filter((item) => item.pass).length, total: results.length, failed: results.filter((item) => !item.pass), results }, null, 2));
    if (results.some((item) => !item.pass)) process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
