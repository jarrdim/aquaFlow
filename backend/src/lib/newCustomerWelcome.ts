import { prisma } from "./prisma";
import { processOne } from "../routes/notifications";

type WelcomeSmsInput = {
  applicationId: bigint;
  customerId: bigint;
  accountId: bigint;
  accountNumber: string;
  recipient: string;
  customerName: string;
  requestedBy: bigint | null;
};

export async function queueNewCustomerWelcomeSms(input: WelcomeSmsInput) {
  try {
    const duplicate = await prisma.notification.findFirst({
      where: {
        accountId: input.accountId,
        notificationType: "NEW_CUSTOMER_WELCOME",
        channel: "SMS",
      },
      select: { notificationId: true, deliveryStatus: true },
    });
    if (duplicate) return duplicate;

    const settings = await prisma.systemSetting.findUnique({
      where: { settingId: 1n },
      select: { utilityName: true, phoneNumber: true },
    });
    const utilityName = settings?.utilityName?.trim() || "Samdamte Water";
    const paybill = "823496";
    const support = settings?.phoneNumber?.trim()
      ? ` For assistance, call ${settings.phoneNumber.trim()}.`
      : "";
    const greetingName = input.customerName.trim() || "Customer";
    const message = `Welcome to ${utilityName}, ${greetingName}. Your water account number is ${input.accountNumber}. Pay via M-Pesa PayBill ${paybill} and use ${input.accountNumber} as the account number. Keep this number for payments, statements and service enquiries.${support} Thank you for choosing ${utilityName}. Water is life.`;

    const notification = await prisma.notification.create({
      data: {
        customerId: input.customerId,
        accountId: input.accountId,
        notificationType: "NEW_CUSTOMER_WELCOME",
        channel: "SMS",
        recipient: input.recipient,
        messageBody: message,
        deliveryStatus: "QUEUED",
        requestedBy: input.requestedBy,
        metadata: {
          source: "NEW_CONNECTION_APPROVAL",
          connectionApplicationId: String(input.applicationId),
          accountNumber: input.accountNumber,
          paybill,
        },
      },
    });
    await prisma.newConnectionActivity.create({
      data: {
        connectionApplicationId: input.applicationId,
        activityType: "WELCOME_SMS_QUEUED",
        notes: `Welcome SMS queued to ${input.recipient} for account ${input.accountNumber}`,
        performedBy: input.requestedBy,
      },
    });

    setImmediate(async () => {
      try {
        const delivered = await processOne(notification.notificationId);
        await prisma.newConnectionActivity.create({
          data: {
            connectionApplicationId: input.applicationId,
            activityType: ["SENT", "DELIVERED"].includes(delivered?.deliveryStatus ?? "")
              ? "WELCOME_SMS_SENT"
              : "WELCOME_SMS_FAILED",
            notes: ["SENT", "DELIVERED"].includes(delivered?.deliveryStatus ?? "")
              ? `Welcome SMS sent to ${input.recipient} for account ${input.accountNumber}`
              : `Welcome SMS delivery requires attention: ${delivered?.failureReason || "provider did not accept the message"}`,
            performedBy: input.requestedBy,
          },
        });
      } catch (error) {
        console.error("New customer welcome SMS delivery failed", error);
      }
    });

    return notification;
  } catch (error) {
    // Customer and account creation remain authoritative. A provider or queue
    // failure is logged for operations and must never roll back the approval.
    console.error("Could not queue new customer welcome SMS", error);
    return null;
  }
}
