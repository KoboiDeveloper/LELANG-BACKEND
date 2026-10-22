import { createHash, randomInt } from "node:crypto";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;

function secret(): string {
  return process.env.OTP_SECRET || process.env.JWT_SECRET || "otp-fallback";
}

export function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export function hashOtp(email: string, otp: string): string {
  return createHash("sha256")
    .update(`${email.toLowerCase().trim()}:${otp}:${secret()}`)
    .digest("hex");
}

export function otpExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + OTP_TTL_MINUTES * 60_000);
}
