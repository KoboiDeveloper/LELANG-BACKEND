import { createHash } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireStaff, type AuthedRequest } from "../lib/auth.js";
import { toNumber } from "../lib/money.js";

export const miscRouter = Router();

function hashKtp(ktp: string): string {
  return createHash("sha256").update(ktp.trim()).digest("hex");
}

function serializeBidder(b: {
  id: string;
  authUserId: string | null;
  companyId: string;
  employeeNik: string;
  fullName: string;
  publicAlias: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    auth_user_id: b.authUserId,
    company_id: b.companyId,
    employee_nik: b.employeeNik,
    full_name: b.fullName,
    public_alias: b.publicAlias,
    is_active: b.isActive,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
  };
}

miscRouter.get("/employee/by-nik", async (req, res) => {
  try {
    const nik = String(req.query.nik || "");
    if (!nik) {
      res.status(400).json({ error: "nik required" });
      return;
    }
    const base = process.env.EMPLOYEE_API_BASE_URL?.replace(/\/$/, "");
    const key = process.env.EMPLOYEE_API_KEY || "";
    if (!base) {
      res.status(500).json({ error: "EMPLOYEE_API_BASE_URL missing" });
      return;
    }
    const url = `${base}/employee/by-nik?nik=${encodeURIComponent(nik)}`;
    const upstream = await fetch(url, {
      headers: key ? { "x-api-key": key, Authorization: `Bearer ${key}` } : {},
    });
    const text = await upstream.text();
    res.status(upstream.status).type("json").send(text || "{}");
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Employee API gagal" });
  }
});

miscRouter.get("/admin/users", requireStaff(["ga", "ga_accounting"]), async (_req, res) => {
  const users = await prisma.profile.findMany({
    include: { user: { select: { email: true, createdAt: true } }, company: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    users: users.map((p) => ({
      id: p.id,
      email: p.user.email,
      username: p.username,
      full_name: p.fullName,
      employee_nik: p.employeeNik,
      role: p.role,
      is_active: p.isActive,
      company_id: p.companyId,
      company_code: p.company.code,
      created_at: p.createdAt.toISOString(),
    })),
  });
});

miscRouter.get("/admin/bidders", requireStaff(), async (req, res) => {
  const companyId = req.query.company_id ? String(req.query.company_id) : null;
  const withBidsOnly =
    String(req.query.with_bids || "") === "1" ||
    String(req.query.with_bids || "") === "true";

  if (companyId && withBidsOnly) {
    const bids = await prisma.bid.findMany({
      where: {
        item: { period: { companyId } },
        status: { not: "cancelled" },
      },
      select: { bidderId: true },
    });
    const bidderIds = [...new Set(bids.map((b) => b.bidderId))];
    if (bidderIds.length === 0) {
      res.json({ bidders: [], bid_counts: {} });
      return;
    }
    const bidders = await prisma.bidderProfile.findMany({
      where: { id: { in: bidderIds } },
      orderBy: { createdAt: "desc" },
    });
    const counts: Record<string, number> = {};
    for (const b of bids) {
      counts[b.bidderId] = (counts[b.bidderId] ?? 0) + 1;
    }
    res.json({
      bidders: bidders.map(serializeBidder),
      bid_counts: counts,
    });
    return;
  }

  const bidders = await prisma.bidderProfile.findMany({
    where: companyId ? { companyId } : undefined,
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    bidders: bidders.map((b) => ({
      ...serializeBidder(b),
      company: b.company
        ? {
            id: b.company.id,
            code: b.company.code,
            short_name: b.company.shortName,
            name: b.company.name,
          }
        : null,
    })),
  });
});

miscRouter.post("/admin/bidders", requireStaff(), async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const employeeNik = String(body.employee_nik || body.employeeNik || "").trim();
    const fullName = String(body.full_name || body.fullName || "").trim();
    const publicAlias = String(body.public_alias || body.publicAlias || "").trim();
    const ktp = String(body.ktp || "").trim();
    const isActive = body.is_active ?? body.isActive ?? true;
    const companyId = String(
      body.company_id || body.companyId || req.auth?.companyId || ""
    );

    if (!employeeNik || !fullName || !publicAlias || !ktp || !companyId) {
      res.status(400).json({
        error: "employee_nik, ktp, full_name, public_alias, company_id wajib",
      });
      return;
    }

    const existing = await prisma.bidderProfile.findFirst({
      where: { companyId, employeeNik },
    });

    const bidder = existing
      ? await prisma.bidderProfile.update({
          where: { id: existing.id },
          data: {
            fullName,
            publicAlias,
            ktpHash: hashKtp(ktp),
            isActive: Boolean(isActive),
          },
        })
      : await prisma.bidderProfile.create({
          data: {
            companyId,
            employeeNik,
            fullName,
            publicAlias,
            ktpHash: hashKtp(ktp),
            isActive: Boolean(isActive),
          },
        });

    res.status(existing ? 200 : 201).json({ bidder: serializeBidder(bidder) });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Gagal simpan bidder" });
  }
});

miscRouter.get("/admin/bids", requireStaff(), async (req, res) => {
  try {
    const companyId = req.query.company_id ? String(req.query.company_id) : null;
    const bidderId = req.query.bidder_id ? String(req.query.bidder_id) : null;
    const itemIds = String(req.query.item_ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const offset = Number(req.query.offset || 0);
    const limit = Math.min(Number(req.query.limit || 50), 500);

    const where = {
      ...(bidderId ? { bidderId } : {}),
      ...(itemIds.length ? { itemId: { in: itemIds } } : {}),
      ...(companyId ? { item: { period: { companyId } } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.bid.count({ where }),
      prisma.bid.findMany({
        where,
        include: {
          bidder: true,
          item: { include: { period: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
    ]);

    res.json({
      total,
      bids: rows.map((b) => ({
        id: b.id,
        amount: toNumber(b.amount),
        status: b.status,
        created_at: b.createdAt.toISOString(),
        item_id: b.itemId,
        bidder_id: b.bidderId,
        auction_items: {
          id: b.item.id,
          lot_number: b.item.lotNumber,
          item_name: b.item.itemName,
          starting_price: toNumber(b.item.startingPrice),
          current_price: toNumber(b.item.currentPrice),
          auction_periods: {
            code: b.item.period.code,
            title: b.item.period.title,
            status: b.item.period.status,
            company_id: b.item.period.companyId,
          },
        },
        bidder_profiles: {
          full_name: b.bidder.fullName,
          public_alias: b.bidder.publicAlias,
          employee_nik: b.bidder.employeeNik,
        },
      })),
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Gagal load bids" });
  }
});

miscRouter.post("/push/subscribe", async (req, res) => {
  const { endpoint, keys, userAgent } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "invalid subscription" });
    return;
  }
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const c of companies) {
    await prisma.pushSubscription.upsert({
      where: { endpoint_companyId: { endpoint: String(endpoint), companyId: c.id } },
      create: {
        companyId: c.id,
        endpoint: String(endpoint),
        p256dh: String(keys.p256dh),
        auth: String(keys.auth),
        userAgent: userAgent ? String(userAgent) : null,
      },
      update: {
        p256dh: String(keys.p256dh),
        auth: String(keys.auth),
        userAgent: userAgent ? String(userAgent) : null,
      },
    });
  }
  res.json({ ok: true });
});

miscRouter.post("/push/unsubscribe", async (req, res) => {
  const endpoint = String(req.body?.endpoint || "");
  if (!endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  res.json({ ok: true });
});

miscRouter.get("/push/subscriptions", async (req, res) => {
  const companyId = req.query.company_id ? String(req.query.company_id) : null;
  if (!companyId) {
    res.status(400).json({ error: "company_id required" });
    return;
  }
  const rows = await prisma.pushSubscription.findMany({ where: { companyId } });
  res.json({
    subscriptions: rows.map((s) => ({
      id: s.id,
      company_id: s.companyId,
      endpoint: s.endpoint,
      p256dh: s.p256dh,
      auth: s.auth,
      user_agent: s.userAgent,
      created_at: s.createdAt.toISOString(),
    })),
  });
});

miscRouter.get("/bidder/bids", requireAuth, async (req: AuthedRequest, res) => {
  const profiles = await prisma.bidderProfile.findMany({
    where: { authUserId: req.auth!.id },
    select: { id: true },
  });
  const ids = profiles.map((p) => p.id);
  const bids = await prisma.bid.findMany({
    where: { bidderId: { in: ids }, status: { not: "cancelled" } },
    include: {
      item: {
        include: { photos: { take: 1, orderBy: { sortOrder: "asc" } }, period: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ bids });
});
