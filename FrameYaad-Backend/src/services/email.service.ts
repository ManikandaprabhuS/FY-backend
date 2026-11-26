import { env } from "../config/env";

export interface EmailMessage { to: string; subject: string; html: string; text?: string; from?:string }
export class EmailDeliveryError extends Error {
  constructor(public readonly providerStatus?: number) {
    super("Email delivery failed. Check the Resend key and verified sender configuration.");
    this.name = "EmailDeliveryError";
  }
}

export const assertEmailConfigured = (): void => {
  const sender = env.EMAIL_FROM?.match(/<([^<>]+)>/)?.[1] ?? env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !sender || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender.trim())) {
    throw new EmailDeliveryError();
  }
};

// Shared Resend transport; never log message bodies, OTPs, or authorization headers.
export const sendEmail = async (message: EmailMessage, idempotencyKey?: string): Promise<{ id: string }> => {
  assertEmailConfigured();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({ from: env.EMAIL_FROM, ...message }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new EmailDeliveryError(response.status);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new EmailDeliveryError(response.status);
  return { id: result.id };
};
