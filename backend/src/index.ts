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

// BigInt IDs (from BIGSERIAL columns) don't serialize to JSON by default.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

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
