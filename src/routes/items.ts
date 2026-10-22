import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {
  listItems,
  serializeItem,
  serializePhoto,
  adminCreateAuctionItem,
  getPeriodWinners,
  getPeriodWinnerNotifications,
  allocateNextLotNumber,
} from "../services/itemService.js";
import { placeAuthenticatedBid, getPublicBidFeed, getItemBidCounts, adminDeleteBid } from "../services/bidService.js";
import { requireAuth, requireStaff, type AuthedRequest } from "../lib/auth.js";
import { toNumber } from "../lib/money.js";
import { Prisma } from "@prisma/client";

export const itemsRouter = Router();

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? String(value[0]) : String(value);
}

function statusOf(err: unknown): number {
  return typeof err === "object" && err && "status" in err
    ? Number((err as { status: number }).status)
    : 500;
}

itemsRouter.get("/", async (req, res) => {
  try {
    const periodId = String(req.query.period_id || "");
    if (!periodId) {
      res.json({ items: [], hasMore: false, total: 0 });
      return;
    }
    const result = await listItems({
      periodId,
      offset: Number(req.query.offset || 0),
      limit: Number(req.query.limit || 12),
      category: req.query.category ? String(req.query.category) : null,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gagal load items" });
  }
});

itemsRouter.get("/meta/bid-counts", async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const counts = await getItemBidCounts(ids);
  res.json({ counts });
});

itemsRouter.get("/meta/period-winners/:periodId", async (req, res) => {
  const winners = await getPeriodWinners(paramId(req.params.periodId));
  res.json({ winners });
});

itemsRouter.get("/meta/period-winner-notifications/:periodId", requireStaff(), async (req, res) => {
  const notifications = await getPeriodWinnerNotifications(paramId(req.params.periodId));
  res.json({ notifications });
});

itemsRouter.get("/meta/next-lot/:periodId", requireStaff(), async (req, res) => {
  const lot = await allocateNextLotNumber(paramId(req.params.periodId));
  res.json({ lot_number: lot });
});

itemsRouter.delete("/bids/:bidId", requireStaff(), async (req, res) => {
  try {
    await adminDeleteBid(paramId(req.params.bidId));
    res.json({ ok: true });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Gagal hapus bid" });
  }
});

itemsRouter.get("/:id", async (req, res) => {
  try {
    const id = paramId(req.params.id);
    const item = await prisma.auctionItem.findUnique({
      where: { id },
      include: { photos: { orderBy: { sortOrder: "asc" } }, period: true },
    });
    if (!item) {
      res.status(404).json({ error: "Item tidak ditemukan" });
      return;
    }
    const counts = await getItemBidCounts([item.id]);
    res.json({
      item: serializeItem(item),
      photos: item.photos.map(serializePhoto),
      bidCount: counts[0]?.bid_count ?? 0,
      period: {
        id: item.period.id,
        code: item.period.code,
        title: item.period.title,
        status: item.period.status,
        start_at: item.period.startAt.toISOString(),
        end_at: item.period.endAt.toISOString(),
        company_id: item.period.companyId,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gagal" });
  }
});

itemsRouter.get("/:id/price", async (req, res) => {
  const item = await prisma.auctionItem.findUnique({
    where: { id: paramId(req.params.id) },
    select: { currentPrice: true, status: true, updatedAt: true },
  });
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    current_price: toNumber(item.currentPrice),
    status: item.status,
    updated_at: item.updatedAt.toISOString(),
  });
});

itemsRouter.get("/:id/bids", async (req, res) => {
  try {
    const feed = await getPublicBidFeed(paramId(req.params.id));
    res.json({ bids: feed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gagal" });
  }
});

itemsRouter.post("/:id/bids", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "amount tidak valid" });
      return;
    }
    const result = await placeAuthenticatedBid(
      req.auth!.id,
      paramId(req.params.id),
      amount
    );
    res.json({ message: result.message, bid: result.bid });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Gagal bid" });
  }
});

itemsRouter.post("/", requireStaff(), async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const item = await adminCreateAuctionItem({
      periodId: String(body.period_id || body.periodId),
      itemName: String(body.item_name || body.itemName || ""),
      category: body.category ?? null,
      description: body.description ?? "",
      itemCondition: body.item_condition ?? body.itemCondition ?? null,
      status: body.status ?? "draft",
      startingPrice: body.starting_price != null ? Number(body.starting_price) : Number(body.startingPrice || 0),
      bidIncrement: body.bid_increment != null ? Number(body.bid_increment) : undefined,
      createdBy: req.auth!.id,
    });
    res.status(201).json({ item: serializeItem(item) });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Gagal create" });
  }
});

itemsRouter.patch("/:id", requireStaff(), async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.AuctionItemUncheckedUpdateInput = {
      updatedBy: req.auth!.id,
    };
    if (body.item_name != null || body.itemName != null) data.itemName = String(body.item_name ?? body.itemName);
    if (body.description != null) data.description = String(body.description);
    if (body.category !== undefined) data.category = body.category;
    if (body.item_condition !== undefined || body.itemCondition !== undefined) {
      data.itemCondition = body.item_condition ?? body.itemCondition;
    }
    if (body.status != null) data.status = String(body.status);
    if (body.starting_price != null || body.startingPrice != null) {
      const sp = Number(body.starting_price ?? body.startingPrice);
      data.startingPrice = new Prisma.Decimal(sp);
    }
    if (body.bid_increment != null || body.bidIncrement != null) {
      data.bidIncrement = new Prisma.Decimal(
        Number(body.bid_increment ?? body.bidIncrement)
      );
    }
    if (body.payment_confirmed != null || body.paymentConfirmed != null) {
      const pc = Boolean(body.payment_confirmed ?? body.paymentConfirmed);
      data.paymentConfirmed = pc;
      if (body.payment_confirmed_at !== undefined || body.paymentConfirmedAt !== undefined) {
        const raw = body.payment_confirmed_at ?? body.paymentConfirmedAt;
        data.paymentConfirmedAt = raw ? new Date(raw) : null;
      } else {
        data.paymentConfirmedAt = pc ? new Date() : null;
      }
    }
    const item = await prisma.auctionItem.update({
      where: { id: paramId(req.params.id) },
      data,
    });
    res.json({ item: serializeItem(item) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gagal update" });
  }
});

itemsRouter.delete("/:id", requireStaff(), async (req, res) => {
  try {
    await prisma.auctionItem.delete({ where: { id: paramId(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Gagal hapus item" });
  }
});
