import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireStaff, type AuthedRequest } from "../lib/auth.js";

export const catalogRouter = Router();

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? String(value[0]) : String(value);
}

function serializePeriod(p: {
  id: string;
  companyId: string;
  code: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  winnerEmailsSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    company_id: p.companyId,
    code: p.code,
    title: p.title,
    description: p.description,
    start_at: p.startAt.toISOString(),
    end_at: p.endAt.toISOString(),
    status: p.status,
    winner_emails_sent_at: p.winnerEmailsSentAt?.toISOString() ?? null,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

function serializeBankAccount(a: {
  id: string;
  companyId: string;
  bankId: string;
  accountHolder: string;
  accountNumber: string;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  bank?: { id: string; code: string; name: string } | null;
}) {
  return {
    id: a.id,
    company_id: a.companyId,
    bank_id: a.bankId,
    account_holder: a.accountHolder,
    account_number: a.accountNumber,
    is_active: a.isActive,
    notes: a.notes,
    created_at: a.createdAt.toISOString(),
    created_by: a.createdBy,
    updated_at: a.updatedAt.toISOString(),
    updated_by: a.updatedBy,
    banks: a.bank
      ? { id: a.bank.id, code: a.bank.code, name: a.bank.name }
      : null,
    bank: a.bank ?? null,
  };
}

catalogRouter.get("/companies", async (_req, res) => {
  const rows = await prisma.company.findMany({ orderBy: { code: "asc" } });
  res.json({
    companies: rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      short_name: c.shortName,
      created_at: c.createdAt.toISOString(),
    })),
  });
});

catalogRouter.get("/periods", async (req, res) => {
  const companyId = req.query.company_id ? String(req.query.company_id) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await prisma.auctionPeriod.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { startAt: "desc" },
  });
  res.json({ periods: rows.map(serializePeriod) });
});

catalogRouter.post("/periods", requireStaff(), async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const period = await prisma.auctionPeriod.create({
      data: {
        companyId: String(body.company_id || body.companyId),
        code: String(body.code),
        title: String(body.title),
        description: body.description ?? null,
        startAt: new Date(body.start_at || body.startAt),
        endAt: new Date(body.end_at || body.endAt),
        status: String(body.status || "draft"),
        createdBy: req.auth!.id,
        updatedBy: req.auth!.id,
      },
    });
    res.status(201).json({ period: serializePeriod(period) });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Gagal create periode" });
  }
});

catalogRouter.patch("/periods/:id", requireStaff(), async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const period = await prisma.auctionPeriod.update({
      where: { id: paramId(req.params.id) },
      data: {
        ...(body.code != null ? { code: String(body.code) } : {}),
        ...(body.title != null ? { title: String(body.title) } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status != null ? { status: String(body.status) } : {}),
        ...(body.start_at || body.startAt
          ? { startAt: new Date(body.start_at || body.startAt) }
          : {}),
        ...(body.end_at || body.endAt
          ? { endAt: new Date(body.end_at || body.endAt) }
          : {}),
        ...(body.winner_emails_sent_at !== undefined ||
        body.winnerEmailsSentAt !== undefined
          ? {
              winnerEmailsSentAt: body.winner_emails_sent_at || body.winnerEmailsSentAt
                ? new Date(body.winner_emails_sent_at || body.winnerEmailsSentAt)
                : null,
            }
          : {}),
        updatedBy: req.auth!.id,
      },
    });
    res.json({ period: serializePeriod(period) });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Gagal update periode" });
  }
});

catalogRouter.delete("/periods/:id", requireStaff(), async (req, res) => {
  try {
    const id = paramId(req.params.id);
    const itemCount = await prisma.auctionItem.count({
      where: { periodId: id },
    });
    if (itemCount > 0) {
      res.status(400).json({
        error: "Periode masih memiliki barang. Hapus semua barang terlebih dahulu.",
      });
      return;
    }
    await prisma.auctionPeriod.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Gagal hapus periode" });
  }
});

catalogRouter.get("/banks", async (_req, res) => {
  const banks = await prisma.bank.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({
    banks: banks.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      sort_order: b.sortOrder,
      created_at: b.createdAt.toISOString(),
    })),
  });
});

catalogRouter.get("/bank-accounts", async (req, res) => {
  const companyId = req.query.company_id ? String(req.query.company_id) : undefined;
  const includeInactive =
    String(req.query.include_inactive || "") === "1" ||
    String(req.query.include_inactive || "") === "true";
  const rows = await prisma.auctionBankAccount.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    include: { bank: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ accounts: rows.map(serializeBankAccount) });
});

catalogRouter.post(
  "/bank-accounts",
  requireStaff(),
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body ?? {};
      const account = await prisma.auctionBankAccount.create({
        data: {
          companyId: String(body.company_id || body.companyId),
          bankId: String(body.bank_id || body.bankId),
          accountHolder: String(body.account_holder || body.accountHolder),
          accountNumber: String(body.account_number || body.accountNumber),
          notes: body.notes ?? null,
          isActive: body.is_active ?? body.isActive ?? true,
          createdBy: req.auth!.id,
          updatedBy: req.auth!.id,
        },
        include: { bank: true },
      });
      res.status(201).json({ account: serializeBankAccount(account) });
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Gagal create rekening" });
    }
  }
);

catalogRouter.patch(
  "/bank-accounts/:id",
  requireStaff(),
  async (req: AuthedRequest, res) => {
    try {
      const body = req.body ?? {};
      const account = await prisma.auctionBankAccount.update({
        where: { id: paramId(req.params.id) },
        data: {
          ...(body.bank_id != null || body.bankId != null
            ? { bankId: String(body.bank_id ?? body.bankId) }
            : {}),
          ...(body.account_holder != null || body.accountHolder != null
            ? { accountHolder: String(body.account_holder ?? body.accountHolder) }
            : {}),
          ...(body.account_number != null || body.accountNumber != null
            ? { accountNumber: String(body.account_number ?? body.accountNumber) }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.is_active != null || body.isActive != null
            ? { isActive: Boolean(body.is_active ?? body.isActive) }
            : {}),
          updatedBy: req.auth!.id,
        },
        include: { bank: true },
      });
      res.json({ account: serializeBankAccount(account) });
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Gagal update rekening" });
    }
  }
);

catalogRouter.delete("/bank-accounts/:id", requireStaff(), async (req, res) => {
  try {
    await prisma.auctionBankAccount.delete({
      where: { id: paramId(req.params.id) },
    });
    res.json({ ok: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Gagal hapus rekening" });
  }
});

catalogRouter.get("/categories", async (_req, res) => {
  const categories = await prisma.itemCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  res.json({ categories });
});

catalogRouter.get("/favorites", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await prisma.favorite.findMany({
    where: { userId: req.auth!.id },
    include: {
      item: { include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ favorites: rows });
});

catalogRouter.post("/favorites", requireAuth, async (req: AuthedRequest, res) => {
  const itemId = String(req.body?.item_id || req.body?.itemId || "");
  const fav = await prisma.favorite.upsert({
    where: { userId_itemId: { userId: req.auth!.id, itemId } },
    create: { userId: req.auth!.id, itemId },
    update: {},
  });
  res.json({ favorite: fav });
});

catalogRouter.delete("/favorites/:itemId", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.favorite.deleteMany({
    where: { userId: req.auth!.id, itemId: paramId(req.params.itemId) },
  });
  res.json({ ok: true });
});
