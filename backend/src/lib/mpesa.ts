type DarajaJson = Record<string, any>;

export type MpesaConfig = {
  environment: "sandbox" | "production";
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passkey: string;
  callbackUrl: string;
  callbackToken: string;
};

export type MpesaC2bConfig = {
  environment: "sandbox" | "production";
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  validationUrl: string;
  confirmationUrl: string;
  validationToken: string;
  confirmationToken: string;
  responseType: "Completed" | "Cancelled";
};

function environmentConfig() {
  const environment = process.env.MPESA_ENVIRONMENT === "production" ? "production" : "sandbox";
  return {
    environment,
    baseUrl: environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
  } as const;
}

export function getMpesaConfig(): MpesaConfig {
  const environment = environmentConfig();
  const config = {
    ...environment,
    consumerKey: process.env.MPESA_CONSUMER_KEY?.trim() ?? "",
    consumerSecret: process.env.MPESA_CONSUMER_SECRET?.trim() ?? "",
    shortCode: (process.env.MPESA_SHORTCODE ?? process.env.MPESA_SHORT_CODE)?.trim() ?? "",
    passkey: process.env.MPESA_PASSKEY?.trim() ?? "",
    callbackUrl: process.env.MPESA_CALLBACK_URL?.trim() ?? "",
    callbackToken: process.env.MPESA_CALLBACK_TOKEN?.trim() ?? "",
  } as MpesaConfig;
  const missing = Object.entries(config).filter(([key, value]) => !["environment", "baseUrl"].includes(key) && !value).map(([key]) => key);
  if (missing.length) throw Object.assign(new Error(`M-Pesa is not configured. Missing: ${missing.join(", ")}`), { status: 503 });
  if (!/^https:\/\//i.test(config.callbackUrl)) throw Object.assign(new Error("MPESA_CALLBACK_URL must be a public HTTPS URL"), { status: 503 });
  if (new URL(config.callbackUrl).searchParams.get("token") !== config.callbackToken) throw Object.assign(new Error("MPESA_CALLBACK_URL must include the configured callback token"), { status: 503 });
  return config;
}

export function getMpesaC2bConfig(): MpesaC2bConfig {
  const config = {
    ...environmentConfig(),
    consumerKey: (process.env.MPESA_C2B_CONSUMER_KEY ?? process.env.MPESA_CONSUMER_KEY)?.trim() ?? "",
    consumerSecret: (process.env.MPESA_C2B_CONSUMER_SECRET ?? process.env.MPESA_CONSUMER_SECRET)?.trim() ?? "",
    shortCode: (process.env.MPESA_C2B_SHORTCODE ?? process.env.MPESA_SHORTCODE ?? process.env.MPESA_SHORT_CODE)?.trim() ?? "",
    validationUrl: process.env.MPESA_C2B_VALIDATION_URL?.trim() ?? "",
    confirmationUrl: process.env.MPESA_C2B_CONFIRMATION_URL?.trim() ?? "",
    validationToken: (process.env.MPESA_C2B_VALIDATION_TOKEN ?? process.env.MPESA_C2B_CALLBACK_TOKEN ?? process.env.MPESA_CALLBACK_TOKEN)?.trim() ?? "",
    confirmationToken: (process.env.MPESA_C2B_CONFIRMATION_TOKEN ?? process.env.MPESA_C2B_CALLBACK_TOKEN ?? process.env.MPESA_CALLBACK_TOKEN)?.trim() ?? "",
    responseType: process.env.MPESA_C2B_RESPONSE_TYPE === "Cancelled" ? "Cancelled" : "Completed",
  } as MpesaC2bConfig;
  const missing = Object.entries(config)
    .filter(([key, value]) => !["environment", "baseUrl", "responseType"].includes(key) && !value)
    .map(([key]) => key);
  if (missing.length)
    throw Object.assign(new Error(`M-Pesa C2B is not configured. Missing: ${missing.join(", ")}`), { status: 503 });
  for (const [name, url, token] of [
    ["MPESA_C2B_VALIDATION_URL", config.validationUrl, config.validationToken],
    ["MPESA_C2B_CONFIRMATION_URL", config.confirmationUrl, config.confirmationToken],
  ] as const) {
    if (!/^https:\/\//i.test(url))
      throw Object.assign(new Error(`${name} must be a public HTTPS URL`), { status: 503 });
    if (new URL(url).searchParams.get("token") !== token)
      throw Object.assign(new Error(`${name} must include its configured C2B callback token`), { status: 503 });
  }
  return config;
}

export function normalizeKenyanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  throw Object.assign(new Error("Use a valid Kenyan Safaricom phone number, for example 0712345678"), { status: 400 });
}

function timestamp(now = new Date()) {
  const n = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${n(now.getMonth() + 1)}${n(now.getDate())}${n(now.getHours())}${n(now.getMinutes())}${n(now.getSeconds())}`;
}

async function darajaJson(url: string, options: RequestInit): Promise<DarajaJson> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error: any) {
    const timedOut =
      error?.name === "TimeoutError" || error?.cause?.code === "ETIMEDOUT";
    throw Object.assign(
      new Error(
        timedOut
          ? "Safaricom Daraja did not respond in time. Please try again."
          : "Unable to connect to Safaricom Daraja. Please try again.",
      ),
      { status: 502 },
    );
  }
  const body = await response.json().catch(() => ({})) as DarajaJson;
  if (!response.ok) {
    const message = body.errorMessage || body.error_description || body.ResponseDescription || `Daraja request failed (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status >= 500 ? 502 : 400, daraja: body });
  }
  return body;
}

async function accessToken(config: Pick<MpesaConfig, "baseUrl" | "consumerKey" | "consumerSecret">) {
  const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const body = await darajaJson(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  if (!body.access_token) throw Object.assign(new Error("Daraja did not return an access token"), { status: 502 });
  return String(body.access_token);
}

export async function requestStkPush(input: { phoneNumber: string; amount: number; accountReference: string; description: string }) {
  const config = getMpesaConfig();
  const time = timestamp();
  const password = Buffer.from(`${config.shortCode}${config.passkey}${time}`).toString("base64");
  const token = await accessToken(config);
  return darajaJson(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortCode,
      Password: password,
      Timestamp: time,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(input.amount),
      PartyA: input.phoneNumber,
      PartyB: config.shortCode,
      PhoneNumber: input.phoneNumber,
      CallBackURL: config.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 20),
    }),
  });
}

export async function queryStkPush(checkoutRequestId: string) {
  const config = getMpesaConfig();
  const time = timestamp();
  const password = Buffer.from(`${config.shortCode}${config.passkey}${time}`).toString("base64");
  const token = await accessToken(config);
  return darajaJson(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortCode,
      Password: password,
      Timestamp: time,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
}

export async function registerC2bUrls() {
  const config = getMpesaC2bConfig();
  const token = await accessToken(config);
  return darajaJson(`${config.baseUrl}/mpesa/c2b/v2/registerurl`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ShortCode: config.shortCode,
      ResponseType: config.responseType,
      ConfirmationURL: config.confirmationUrl,
      ValidationURL: config.validationUrl,
    }),
  });
}

export function parseMpesaDate(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{14}$/.test(text)) return new Date();
  return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+03:00`);
}
