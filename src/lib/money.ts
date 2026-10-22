import { Prisma } from "@prisma/client";

export function toNumber(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v);
}

export function bidIncrementForStartingPrice(startingPrice: number): number {
  if (startingPrice >= 10_000_000) return 10_000;
  if (startingPrice >= 5_000_000) return 5_000;
  return 3_000;
}
