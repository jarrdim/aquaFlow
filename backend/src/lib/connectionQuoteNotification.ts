import { prisma } from "./prisma";
import { processOne } from "../routes/notifications";

type QuoteRevisionSmsInput = {
  applicationId: bigint;
  applicationNumber: string;
  customerId: bigint | null;
  recipient: string;
  oldTotal: number;
  newTotal: number;
  requestedBy: bigint;
};

export async function queueQuoteRevisionSms(input: QuoteRevisionSmsInput) {
  try {
    const message = `Your connection quotation ${input.applicationNumber} has been revised from KSh ${input.oldTotal.toFixed(2)} to KSh ${input.newTotal.toFixed(2)}. Please use the revised amount for payment. Contact Samdamte Water if you need clarification.`;
    const notification = await prisma.notification.create({
      data: {
        customerId: input.customerId,
        notificationType: "GENERAL",
        channel: "SMS",
        recipient: input.recipient,
        messageBody: message,
        deliveryStatus: "QUEUED",
        requestedBy: input.requestedBy,
        metadata: {
          source: "NEW_CONNECTION_QUOTE_REVISION",
          connectionApplicationId: String(input.applicationId),
          applicationNumber: input.applicationNumber,
          oldTotal: input.oldTotal,
          newTotal: input.newTotal,
        },
      },
    });

    await prisma.newConnectionActivity.create({
      data: {
        connectionApplicationId: input.applicationId,
        activityType: "QUOTE_REVISION_SMS_QUEUED",
        notes: `Revised quotation SMS queued to ${input.recipient}`,
        performedBy: input.requestedBy,
      },
    });

    setImmediate(async () => {
      try {
        const delivered = await processOne(notification.notificationId);
        const sent = ["SENT", "DELIVERED"].includes(delivered?.deliveryStatus ?? "");
        await prisma.newConnectionActivity.create({
          data: {
            connectionApplicationId: input.applicationId,
            activityType: sent ? "QUOTE_REVISION_SMS_SENT" : "QUOTE_REVISION_SMS_FAILED",
            notes: sent
              ? `Revised quotation SMS sent to ${input.recipient}`
              : `Revised quotation SMS delivery requires attention: ${delivered?.failureReason || "provider did not accept the message"}`,
            performedBy: input.requestedBy,
          },
        });
      } catch (error) {
        console.error("Connection quotation revision SMS delivery failed", error);
      }
    });

    return notification;
  } catch (error) {
    // A messaging failure must not undo an otherwise valid quotation revision.
    console.error("Could not queue connection quotation revision SMS", error);
    return null;
  }
}
