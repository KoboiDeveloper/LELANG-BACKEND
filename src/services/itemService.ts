import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bidIncrementForStartingPrice, toNumber } from "../lib/money.js";
import { getItemBidCounts } from "./bidService.js";

export async function allocateNextLotNumber(periodId: string): Promise<string> {
  const items = await prisma.auctionItem.findMany({
    where: { periodId },
    select: { lotNumber: true },
  });
  let max = 0;
  for (const it of items) {
    const m = it.lotNumber.match(/(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `LOT ${String(max + 1).padStart(3, "0")}`;
}

export async function adminCreateAuctionItem(input: {
  periodId: string;
  itemName: string;
  category?: string | null;
  description?: string;
  itemCondition?: string | null;
  status?: string;
  startingPrice?: number;
  bidIncrement?: number;
  createdBy?: string | null;
}) {
  const starting = input.startingPrice ?? 0;
  const increment =
    input.bidIncrement ?? bidIncrementForStartingPrice(starting);
  const lotNumber = await allocateNextLotNumber(input.periodId);
  return prisma.auctionItem.create({
    data: {
      periodId: input.periodId,
      lotNumber,
      itemName: input.itemName,
      category: input.category ?? null,
      description: input.description ?? "",
      itemCondition: input.itemCondition ?? null,
      status: input.status ?? "draft",
      startingPrice: new Prisma.Decimal(starting),
      currentPrice: new Prisma.Decimal(starting),
      bidIncrement: new Prisma.Decimal(increment),
      createdBy: input.createdBy ?? null,
      updatedBy: input.createdBy ?? null,
    },
  });
}

export async function listItems(params: {
  periodId: string;
  offset?: number;
  limit?: number;
  category?: string | null;
}) {
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 12;
  const where: Prisma.AuctionItemWhereInput = {
    periodId: params.periodId,
    ...(params.category ? { category: params.category } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auctionItem.count({ where }),
    prisma.auctionItem.findMany({
      where,
      orderBy: { lotNumber: "asc" },
      skip: offset,
      take: limit,
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  const counts = await getItemBidCounts(rows.map((r) => r.id));
  const countMap = new Map(counts.map((c) => [c.item_id, c.bid_count]));
  return {
    items: rows.map((item) => ({
      item: serializeItem(item),
      photos: item.photos.map(serializePhoto),
      bidCount: countMap.get(item.id) ?? 0,
    })),
    hasMore: offset + rows.length < total,
    total,
  };
}

export function serializeItem(item: {
  id: string;
  periodId: string;
  lotNumber: string;
  itemName: string;
  description: string;
  category: string | null;
  itemCondition: string | null;
  startingPrice: Prisma.Decimal;
  currentPrice: Prisma.Decimal;
  bidIncrement: Prisma.Decimal;
  status: string;
  paymentConfirmed: boolean;
  paymentConfirmedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}) {
  return {
    id: item.id,
    period_id: item.periodId,
    lot_number: item.lotNumber,
    item_name: item.itemName,
    description: item.description,
    category: item.category,
    item_condition: item.itemCondition,
    starting_price: toNumber(item.startingPrice),
    current_price: toNumber(item.currentPrice),
    bid_increment: toNumber(item.bidIncrement),
    status: item.status,
    payment_confirmed: item.paymentConfirmed,
    payment_confirmed_at: item.paymentConfirmedAt?.toISOString() ?? null,
    created_at: item.createdAt.toISOString(),
    created_by: item.createdBy,
    updated_at: item.updatedAt.toISOString(),
    updated_by: item.updatedBy,
  };
}

export function serializePhoto(p: {
  id: string;
  itemId: string;
  storagePath: string;
  sortOrder: number;
  uploadedBy: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    item_id: p.itemId,
    storage_path: p.storagePath,
    sort_order: p.sortOrder,
    uploaded_by: p.uploadedBy,
    created_at: p.createdAt.toISOString(),
  };
}

export async function getPeriodWinners(periodId: string) {
  const items = await prisma.auctionItem.findMany({
    where: { periodId, status: { in: ["active", "sold", "closed", "finished"] } },
    include: {
      photos: { orderBy: { sortOrder: "asc" }, take: 1 },
      bids: {
        where: { status: { not: "cancelled" } },
        orderBy: { amount: "desc" },
        take: 1,
        include: { bidder: true },
      },
    },
    orderBy: { lotNumber: "asc" },
  });

  return items.map((item) => {
    const top = item.bids[0];
    return {
      item_id: item.id,
      lot_number: item.lotNumber,
      item_name: item.itemName,
      starting_price: toNumber(item.startingPrice),
      last_price: toNumber(item.currentPrice),
      winner_name: top?.bidder.fullName ?? null,
      winner_alias: top?.bidder.publicAlias ?? null,
      photo_path: item.photos[0]?.storagePath ?? null,
    };
  });
}

export async function getPeriodWinnerNotifications(periodId: string) {
  const items = await prisma.auctionItem.findMany({
    where: { periodId, status: { in: ["active", "sold", "closed", "finished"] } },
    include: {
      bids: {
        where: { status: { not: "cancelled" } },
        orderBy: { amount: "desc" },
        take: 1,
        include: {
          bidder: {
            include: { user: { select: { email: true } } },
          },
        },
      },
    },
    orderBy: { lotNumber: "asc" },
  });

  return items
    .map((item) => {
      const top = item.bids[0];
      if (!top) return null;
      return {
        bidder_id: top.bidder.id,
        bidder_email: top.bidder.user?.email ?? null,
        bidder_name: top.bidder.fullName,
        public_alias: top.bidder.publicAlias,
        item_id: item.id,
        lot_number: item.lotNumber,
        item_name: item.itemName,
        last_price: toNumber(item.currentPrice),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}
