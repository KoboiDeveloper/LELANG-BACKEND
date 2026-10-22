import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { toNumber } from "../lib/money.js";

export async function placeAuthenticatedBid(userId: string, itemId: string, amount: number) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.bidderProfile.findFirst({
      where: { authUserId: userId, isActive: true },
    });
    if (!profile) {
      throw Object.assign(new Error("Profil bidder tidak ditemukan"), { status: 403 });
    }

    const item = await tx.auctionItem.findUnique({
      where: { id: itemId },
      include: { period: true },
    });
    if (!item) throw Object.assign(new Error("Item tidak ditemukan"), { status: 404 });
    if (item.status !== "active") {
      throw Object.assign(new Error("Item tidak aktif untuk ditawar"), { status: 400 });
    }
    const now = new Date();
    if (item.period.status !== "active" || now < item.period.startAt || now > item.period.endAt) {
      throw Object.assign(new Error("Periode lelang tidak aktif"), { status: 400 });
    }

    const current = toNumber(item.currentPrice);
    const increment = toNumber(item.bidIncrement);
    const minBid = current + increment;
    if (amount < minBid) {
      throw Object.assign(
        new Error(`Penawaran minimal ${minBid.toLocaleString("id-ID")}`),
        { status: 400 },
      );
    }

    const bid = await tx.bid.create({
      data: {
        itemId,
        bidderId: profile.id,
        amount: new Prisma.Decimal(amount),
        status: "active",
      },
    });

    await tx.auctionItem.update({
      where: { id: itemId },
      data: { currentPrice: new Prisma.Decimal(amount) },
    });

    return { message: "Penawaran berhasil!", bid };
  });
}

export async function getPublicBidFeed(itemId: string) {
  const bids = await prisma.bid.findMany({
    where: { itemId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { bidder: { select: { publicAlias: true } } },
  });
  return bids.map((b) => ({
    amount: toNumber(b.amount),
    bid_status: b.status,
    bid_time: b.createdAt.toISOString(),
    bidder_alias: b.bidder.publicAlias,
  }));
}

export async function getItemBidCounts(itemIds: string[]) {
  if (!itemIds.length) return [];
  const grouped = await prisma.bid.groupBy({
    by: ["itemId"],
    where: { itemId: { in: itemIds }, status: { not: "cancelled" } },
    _count: { _all: true },
  });
  return itemIds.map((id) => {
    const g = grouped.find((x) => x.itemId === id);
    return { item_id: id, bid_count: g?._count._all ?? 0 };
  });
}

export async function adminDeleteBid(bidId: string) {
  await prisma.$transaction(async (tx) => {
    const bid = await tx.bid.findUnique({ where: { id: bidId } });
    if (!bid) throw Object.assign(new Error("Bid tidak ditemukan"), { status: 404 });

    await tx.bid.update({
      where: { id: bidId },
      data: { status: "cancelled" },
    });

    const top = await tx.bid.findFirst({
      where: { itemId: bid.itemId, status: { not: "cancelled" } },
      orderBy: { amount: "desc" },
    });
    const item = await tx.auctionItem.findUnique({ where: { id: bid.itemId } });
    if (!item) return;
    await tx.auctionItem.update({
      where: { id: bid.itemId },
      data: {
        currentPrice: top ? top.amount : item.startingPrice,
      },
    });
  });
}
