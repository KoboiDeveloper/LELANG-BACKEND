import { prisma } from "../lib/prisma.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  loadAuthUser,
  type AuthUser,
} from "../lib/auth.js";
import {
  generateOtp,
  hashOtp,
  otpExpiresAt,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_MINUTES,
} from "../lib/otp.js";
import { sendOtpEmail } from "../lib/email.js";

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { profile: true },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw Object.assign(new Error("Email atau password salah"), { status: 401 });
  }
  const auth = await loadAuthUser(user.id);
  if (!auth) throw Object.assign(new Error("User tidak valid"), { status: 401 });
  if (user.profile && !user.profile.isActive) {
    throw Object.assign(new Error("Akun nonaktif"), { status: 403 });
  }
  // ensure bidder profile if role bidder
  if (auth.role === "bidder") {
    await ensureBidderProfile(user.id);
  }
  return { token: signToken(auth), user: auth };
}

export async function ensureBidderProfile(userId: string) {
  const existing = await prisma.bidderProfile.findFirst({ where: { authUserId: userId } });
  if (existing) return existing;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user?.profile) return null;
  const meta = parseMeta(user.rawUserMeta);
  const nik =
    user.profile.employeeNik ||
    String(meta.employee_nik || meta.employeeNik || "");
  if (!nik) return null;
  return prisma.bidderProfile.create({
    data: {
      authUserId: userId,
      companyId: user.profile.companyId,
      employeeNik: nik,
      fullName: user.profile.fullName,
      ktpHash: String(meta.ktp_hash || "migrated"),
      publicAlias: String(meta.public_alias || user.profile.fullName.split(" ")[0] || "Bidder"),
      isActive: true,
    },
  });
}

export async function sendRegistrationOtp(input: {
  email: string;
  employeeNik: string;
  fullName: string;
  companyId?: string | null;
  ptName?: string | null;
}) {
  const email = input.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw Object.assign(new Error("Email sudah terdaftar"), { status: 409 });

  const recent = await prisma.registrationOtp.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    const elapsed = (Date.now() - recent.createdAt.getTime()) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SEC) {
      throw Object.assign(new Error("Tunggu sebentar sebelum kirim ulang OTP"), {
        status: 429,
      });
    }
  }

  const otp = generateOtp();
  await prisma.registrationOtp.create({
    data: {
      email,
      otpHash: hashOtp(email, otp),
      employeeNik: input.employeeNik,
      fullName: input.fullName,
      companyId: input.companyId ?? null,
      ptName: input.ptName ?? null,
      expiresAt: otpExpiresAt(),
    },
  });
  await sendOtpEmail(email, otp, "register");
  return { ok: true, message: "OTP terkirim", expiresInMinutes: OTP_TTL_MINUTES };
}

export async function register(input: {
  email: string;
  otp: string;
  password: string;
  employeeNik: string;
  fullName: string;
}) {
  const email = input.email.toLowerCase().trim();
  const row = await prisma.registrationOtp.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw Object.assign(new Error("OTP tidak ditemukan"), { status: 400 });
  if (row.expiresAt < new Date()) {
    throw Object.assign(new Error("OTP kadaluarsa"), { status: 400 });
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw Object.assign(new Error("Terlalu banyak percobaan OTP"), { status: 429 });
  }
  if (row.otpHash !== hashOtp(email, input.otp)) {
    await prisma.registrationOtp.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    throw Object.assign(new Error("OTP salah"), { status: 400 });
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    throw Object.assign(new Error("Email sudah terdaftar"), { status: 409 });
  }

  const companyId = row.companyId;
  if (!companyId) throw Object.assign(new Error("Company belum dipilih"), { status: 400 });

  const passwordHash = await hashPassword(input.password);
  const alias = input.fullName.split(/\s+/)[0] || "Bidder";
  const meta = {
    role: "bidder",
    employee_nik: input.employeeNik,
    public_alias: alias,
  };

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        passwordHash,
        emailConfirmed: true,
        rawUserMeta: JSON.stringify(meta),
      },
    });
    await tx.profile.create({
      data: {
        id: u.id,
        companyId,
        username: email.split("@")[0],
        fullName: input.fullName,
        employeeNik: input.employeeNik,
        role: "bidder",
        isActive: true,
      },
    });
    await tx.bidderProfile.create({
      data: {
        authUserId: u.id,
        companyId,
        employeeNik: input.employeeNik,
        fullName: input.fullName,
        ktpHash: "registered",
        publicAlias: alias,
        isActive: true,
      },
    });
    await tx.registrationOtp.deleteMany({ where: { email } });
    return u;
  });

  return { ok: true, message: "Registrasi berhasil. Silakan login.", userId: user.id };
}

export async function sendPasswordResetOtp(employeeNik: string, email: string) {
  const profile = await prisma.profile.findFirst({
    where: { employeeNik, isActive: true },
  });
  if (!profile) throw Object.assign(new Error("NIK tidak ditemukan"), { status: 404 });
  const user = await prisma.user.findUnique({ where: { id: profile.id } });
  if (!user || user.email.toLowerCase() !== email.toLowerCase().trim()) {
    throw Object.assign(new Error("Email tidak cocok dengan NIK"), { status: 400 });
  }
  const otp = generateOtp();
  await prisma.passwordResetOtp.create({
    data: {
      employeeNik,
      email: email.toLowerCase().trim(),
      otpHash: hashOtp(email.toLowerCase().trim(), otp),
      expiresAt: otpExpiresAt(),
    },
  });
  await sendOtpEmail(email, otp, "reset");
  return { ok: true, message: "OTP reset terkirim", expiresInMinutes: OTP_TTL_MINUTES };
}

export async function resetPassword(input: {
  employeeNik: string;
  email: string;
  otp: string;
  password: string;
}) {
  const email = input.email.toLowerCase().trim();
  const row = await prisma.passwordResetOtp.findFirst({
    where: { employeeNik: input.employeeNik, email },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.expiresAt < new Date()) {
    throw Object.assign(new Error("OTP tidak valid"), { status: 400 });
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw Object.assign(new Error("Terlalu banyak percobaan"), { status: 429 });
  }
  if (row.otpHash !== hashOtp(email, input.otp)) {
    await prisma.passwordResetOtp.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    throw Object.assign(new Error("OTP salah"), { status: 400 });
  }
  const profile = await prisma.profile.findFirst({
    where: { employeeNik: input.employeeNik },
  });
  if (!profile) throw Object.assign(new Error("User tidak ditemukan"), { status: 404 });
  await prisma.user.update({
    where: { id: profile.id },
    data: { passwordHash: await hashPassword(input.password) },
  });
  await prisma.passwordResetOtp.deleteMany({ where: { employeeNik: input.employeeNik } });
  return { ok: true, message: "Password berhasil diubah" };
}
