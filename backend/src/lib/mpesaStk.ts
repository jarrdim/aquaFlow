import { prisma } from "./prisma";
import { normalizeKenyanPhone, requestStkPush } from "./mpesa";

type StkAccount = {
  accountId: bigint;
  accountNumber: string;
};

export async function initiateMpesaStk(input: {
  account: StkAccount;
  phoneNumber: string;
  amount: number;
  initiatedBy: bigint | null;
  accountReference?: string;
  description?: string;
  purposeType?: "BILL_PAYMENT" | "RECONNECTION_FEE" | "NEW_CONNECTION_FEE";
  purposeReference?: string;
}) {
  const phoneNumber = normalizeKenyanPhone(input.phoneNumber);
  if (!Number.isInteger(input.amount)) {
    throw Object.assign(
      new Error("M-Pesa Express amount must be a whole number of Kenya shillings"),
      { status: 400 },
    );
  }

  const recent = await prisma.mpesaStkRequest.findFirst({
    where: {
      accountId: input.account.accountId,
      phoneNumber,
      amount: input.amount,
      status: "PENDING",
      purposeType: input.purposeType ?? "BILL_PAYMENT",
      purposeReference: input.purposeReference ?? null,
      createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    throw Object.assign(
      new Error("A matching M-Pesa prompt is already pending for this account"),
      { status: 409, stkRequestId: String(recent.stkRequestId) },
    );
  }

  const response = await requestStkPush({
    phoneNumber,
    amount: input.amount,
    accountReference: input.accountReference ?? input.account.accountNumber,
    description: input.description ?? "AquaFlow water bill",
  });
  if (String(response.ResponseCode) !== "0" || !response.CheckoutRequestID) {
    throw Object.assign(
      new Error(
        response.ResponseDescription || "M-Pesa did not accept the STK request",
      ),
      { status: 400, daraja: response },
    );
  }

  return prisma.mpesaStkRequest.create({
    data: {
      accountId: input.account.accountId,
      initiatedBy: input.initiatedBy,
      phoneNumber,
      amount: input.amount,
      merchantRequestId: String(response.MerchantRequestID),
      checkoutRequestId: String(response.CheckoutRequestID),
      customerMessage: String(response.CustomerMessage ?? ""),
      responseCode: String(response.ResponseCode),
      responseDescription: String(response.ResponseDescription ?? ""),
      status: "PENDING",
      purposeType: input.purposeType ?? "BILL_PAYMENT",
      purposeReference: input.purposeReference ?? null,
    },
  });
}
