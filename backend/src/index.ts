import "dotenv/config";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth";
import { customersRouter } from "./routes/customers";
import { propertiesRouter } from "./routes/properties";
import { accountsRouter } from "./routes/accounts";
import { lookupsRouter } from "./routes/lookups";
import { metersRouter } from "./routes/meters";
import { readingsRouter } from "./routes/readings";
import { tariffsRouter } from "./routes/tariffs";
import { billingRouter } from "./routes/billing";
import { paymentsRouter } from "./routes/payments";
import { notificationsRouter } from "./routes/notifications";
import { arrearsRouter } from "./routes/arrears";
import { adminRouter } from "./routes/admin";
import { serviceRequestsRouter } from "./routes/serviceRequests";
import { reconnectionsRouter } from "./routes/reconnections";
import { settingsRouter } from "./routes/settings";
import { mobileRouter } from "./routes/mobile";
import { workOrdersRouter } from "./routes/workOrders";
import { connectionsRouter } from "./routes/connections";
import { reportsRouter } from "./routes/reports";
import { prisma } from "./lib/prisma";

// BigInt IDs (from BIGSERIAL columns) don't serialize to JSON by default.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = express();
const configuredOrigins = [
  ...(process.env.FRONTEND_ORIGINS ?? "").split(","),
  process.env.PUBLIC_APP_URL ?? "",
  ...(process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://127.0.0.1:5173"]),
].map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
const allowedOrigins = new Set(configuredOrigins);

if (process.env.NODE_ENV === "production") {
  if (!allowedOrigins.size) {
    throw new Error("Set PUBLIC_APP_URL or FRONTEND_ORIGINS before starting in production");
  }
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32 || jwtSecret.includes("replace-with")) {
    throw new Error("JWT_SECRET must be a non-placeholder secret of at least 32 characters");
  }
}

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
}));
app.use((req, res, next) => {
  const origin = req.headers.origin?.replace(/\/$/, "");
  if (origin && !allowedOrigins.has(origin) && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return res.status(403).json({ error: "Cross-origin request rejected" });
  }
  next();
});
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    service: "aquaflow-api",
    timestamp: new Date().toISOString(),
  }),
);
app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: "not_ready",
      database: "unavailable",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/customers", customersRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/lookups", lookupsRouter);
app.use("/api/meters", metersRouter);
app.use("/api/readings", readingsRouter);
app.use("/api/tariffs", tariffsRouter);
app.use("/api/billing", billingRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/arrears", arrearsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/service-requests", serviceRequestsRouter);
app.use("/api/reconnections", reconnectionsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/mobile", mobileRouter);
app.use("/api/work-orders", workOrdersRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/reports", reportsRouter);

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () =>
  console.log(`AquaFlow API listening on http://localhost:${port}`),
);
