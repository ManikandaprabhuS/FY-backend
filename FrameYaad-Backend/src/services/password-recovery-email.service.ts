import { sendEmail } from "./email.service";

export const sendPasswordRecoveryEmail = (email: string, otp: string) => sendEmail({
  to: email,
  subject: "Your FrameYaad password reset code",
  text: `Your FrameYaad password reset code is ${otp}. It expires in 10 minutes and can only be used once. If you did not request this, ignore this email.`,
  html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111"><h1 style="font-size:24px">Reset your FrameYaad password</h1><p>Enter this verification code on the password reset screen:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p><p>This code expires in 10 minutes and can only be used once.</p><p>If you did not request this, ignore this email.</p></div>`,
});
