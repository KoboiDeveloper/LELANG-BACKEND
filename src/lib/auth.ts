import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma.js";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  companyId: string | null;
  fullName: string;
  username: string;
};

const STAFF_ROLES = new Set(["ga", "accounting", "ga_accounting"]);

export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error("JWT_SECRET missing");
  return s;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  // Supabase may store bcrypt with $2a$ — bcryptjs handles it
  return bcrypt.compare(password, hash);
}

export function signToken(payload: AuthUser, expiresIn: string | number = "7d"): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, getJwtSecret()) as AuthUser;
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.profile?.role ?? "bidder",
    companyId: user.profile?.companyId ?? null,
    fullName: user.profile?.fullName ?? "",
    username: user.profile?.username ?? user.email,
  };
}

export type AuthedRequest = Request & { auth?: AuthUser };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireStaff(roles: string[] = [...STAFF_ROLES]) {
  const allowed = new Set(roles);
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      if (!req.auth || !allowed.has(req.auth.role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    });
  };
}

export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.has(role);
}
