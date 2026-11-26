import { env } from "../../config/env";
import { logger } from "../../config/logger";
import type { AppointmentEmailView } from "../../modules/appointment/appointment.types";
import { sendEmail } from "../email.service";

type EmailMessage = { to: string; subject: string; html: string };

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const dateLabel = (value: Date): string => new Intl.DateTimeFormat("en-IN", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
}).format(value);

const locationLabel = (value: string): string => value === "ODDANCHATRAM" ? "Oddanchatram" : "Coimbatore";
const requirementLabel = (value: string): string => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const requirements = (appointment: AppointmentEmailView): string => [
  ...appointment.frameTypes.filter((value) => value !== "OTHERS").map(requirementLabel),
  ...(appointment.frameTypes.includes("OTHERS") && appointment.otherFrameType ? [appointment.otherFrameType] : []),
].map(escapeHtml).join(", ");

const layout = (title: string, content: string): string => `
  <div style="font-family:Arial,sans-serif;color:#111;line-height:1.6;max-width:620px;margin:auto">
    <div style="border:1px solid #ddd;border-radius:14px;overflow:hidden;background:#fff">
      <div style="background:#000;color:#fff;padding:20px 24px;font-size:20px;font-weight:700">FrameYaad</div>
      <div style="padding:24px"><h1 style="font-size:24px;margin:0 0 18px">${escapeHtml(title)}</h1>${content}<p style="margin-top:24px">Warm regards,<br><strong>The FrameYaad Team</strong></p><p style="font-size:12px;color:#666">Please keep this email for your appointment details.</p></div>
    </div>
  </div>`;

const details = (appointment: AppointmentEmailView, date = appointment.bookingDate): string => `
  <p><strong>Booking reference:</strong> ${escapeHtml(appointment.id)}</p>
  <p><strong>Name:</strong> ${escapeHtml(appointment.firstName)}</p>
  <p><strong>Date:</strong> ${escapeHtml(dateLabel(date))}</p>
  <p><strong>Location:</strong> ${escapeHtml(locationLabel(appointment.location))}</p>
  <p><strong>Requirements:</strong> ${requirements(appointment)}</p>`;

const deliver = async (message: EmailMessage): Promise<boolean> => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    logger.error({ recipient: message.to }, "Appointment email configuration is missing");
    return false;
  }
  try {
    const result=await sendEmail(message);
    logger.info({providerMessageId:result.id},'Appointment email accepted by Resend (delivery not yet verified)');
    return true;
  } catch (error) {
    logger.error({ errorType:error instanceof Error?error.name:'EmailDeliveryError' }, "Appointment email request failed");
    return false;
  }
};

export const buildAppointmentCreatedEmails = (appointment: AppointmentEmailView): EmailMessage[] => [
 { to:appointment.email,subject:'Appointment Request Received',html:layout('Appointment Request Received',`<p>Hello ${escapeHtml(appointment.firstName)},</p><p>We received your framing appointment request.</p>${details(appointment)}<p><strong>Status:</strong> Pending</p>`) },
 ...(env.ADMIN_EMAIL?[{to:env.ADMIN_EMAIL,subject:'New FrameYaad Appointment Request',html:layout('New FrameYaad Appointment Request',`<p><strong>Action required:</strong> A new appointment is waiting for review.</p>${details(appointment)}<p><strong>Email:</strong> ${escapeHtml(appointment.email)}</p><p><strong>Phone:</strong> ${escapeHtml(appointment.phoneNumber)}</p>`)}]:[]),
];
export const buildAppointmentStatusEmail = (appointment:AppointmentEmailView,previousBookingDate?:Date):EmailMessage|null => {
 if(appointment.status==='COMPLETED')return null;
 if(appointment.status==='CONFIRMED')return {to:appointment.email,subject:'Appointment Confirmed',html:layout('Appointment Confirmed',`<p>Hello ${escapeHtml(appointment.firstName)},</p><p>Your FrameYaad appointment is confirmed.</p>${details(appointment)}`)};
 if(appointment.status==='RESCHEDULED')return {to:appointment.email,subject:'Appointment Rescheduled',html:layout('Appointment Rescheduled',`<p>Hello ${escapeHtml(appointment.firstName)},</p><p>Your appointment has been rescheduled.</p><p><strong>Previous date:</strong> ${escapeHtml(dateLabel(previousBookingDate??appointment.originalBookingDate))}</p><p><strong>New date:</strong> ${escapeHtml(dateLabel(appointment.bookingDate))}</p><p><strong>Location:</strong> ${escapeHtml(locationLabel(appointment.location))}</p><p><strong>Requirements:</strong> ${requirements(appointment)}</p>${appointment.rescheduleReason?`<p><strong>Reason:</strong> ${escapeHtml(appointment.rescheduleReason)}</p>`:''}`)};
 return {to:appointment.email,subject:'Appointment Cancelled',html:layout('Appointment Cancelled',`<p>Hello ${escapeHtml(appointment.firstName)},</p><p>Your FrameYaad appointment has been cancelled.</p>${details(appointment)}<p><strong>Originally requested:</strong> ${escapeHtml(dateLabel(appointment.originalBookingDate))}</p>${appointment.cancellationReason?`<p><strong>Reason:</strong> ${escapeHtml(appointment.cancellationReason)}</p>`:''}`)};
};
// Kept for compatibility/tests; the business service now persists jobs instead of calling these synchronously.
export const sendAppointmentCreatedEmails=async(appointment:AppointmentEmailView):Promise<boolean> => (await Promise.all(buildAppointmentCreatedEmails(appointment).map(deliver))).every(Boolean);
export const sendAppointmentStatusEmail=async(appointment:AppointmentEmailView,previousBookingDate?:Date):Promise<boolean|null> => {const message=buildAppointmentStatusEmail(appointment,previousBookingDate);return message?deliver(message):null;};
