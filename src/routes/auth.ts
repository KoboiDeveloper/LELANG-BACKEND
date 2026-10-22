import { Router } from "express";
import {
  login,
  register,
  sendRegistrationOtp,
  sendPasswordResetOtp,
  resetPassword,
} from "../services/authService.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";

export const authRouter = Router();

function statusOf(err: unknown): number {
  return typeof err === "object" && err && "status" in err
    ? Number((err as { status: number }).status)
    : 500;
}

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "email dan password wajib" });
      return;
    }
    const result = await login(String(email), String(password));
    res.json(result);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Login gagal" });
  }
});

authRouter.post("/send-otp", async (req, res) => {
  try {
    const { email, employeeNik, fullName, companyId, pt } = req.body ?? {};
    const result = await sendRegistrationOtp({
      email: String(email || ""),
      employeeNik: String(employeeNik || ""),
      fullName: String(fullName || ""),
      companyId: companyId ? String(companyId) : null,
      ptName: pt ? String(pt) : null,
    });
    res.json(result);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Gagal kirim OTP" });
  }
});

authRouter.post("/register", async (req, res) => {
  try {
    const { email, otp, password, employeeNik, fullName } = req.body ?? {};
    const result = await register({
      email: String(email || ""),
      otp: String(otp || ""),
      password: String(password || ""),
      employeeNik: String(employeeNik || ""),
      fullName: String(fullName || ""),
    });
    res.json(result);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Registrasi gagal" });
  }
});

authRouter.post("/forgot-password/send-otp", async (req, res) => {
  try {
    const { employeeNik, email } = req.body ?? {};
    const result = await sendPasswordResetOtp(String(employeeNik || ""), String(email || ""));
    res.json(result);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Gagal kirim OTP" });
  }
});

authRouter.post("/forgot-password/reset", async (req, res) => {
  try {
    const { employeeNik, email, otp, password } = req.body ?? {};
    const result = await resetPassword({
      employeeNik: String(employeeNik || ""),
      email: String(email || ""),
      otp: String(otp || ""),
      password: String(password || ""),
    });
    res.json(result);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Reset gagal" });
  }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  res.json({ user: req.auth });
});
