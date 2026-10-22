import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });
const p = new PrismaClient();

async function main() {
  const periods = await p.auctionPeriod.findMany({
    select: { id: true, code: true, status: true, title: true },
  });
  console.log("periods", periods);
  for (const per of periods) {
    const n = await p.auctionItem.count({ where: { periodId: per.id } });
    const withPhoto = await p.auctionItem.count({
      where: { periodId: per.id, photos: { some: {} } },
    });
    console.log(per.code, "items", n, "withPhoto", withPhoto, "status", per.status);
  }

  const sample = await p.auctionItem.findFirst({
    where: { photos: { some: {} } },
    include: { photos: { take: 1, orderBy: { sortOrder: "asc" } }, period: true },
  });
  console.log("sample", {
    id: sample?.id,
    periodId: sample?.periodId,
    path: sample?.photos[0]?.storagePath,
  });

  if (!sample) return;

  const url = `http://127.0.0.1:4100/api/items?period_id=${sample.periodId}&limit=2`;
  const res = await fetch(url);
  const json = (await res.json()) as {
    total?: number;
    items?: Array<{ photos?: unknown; item?: unknown }>;
  };
  console.log("api total", json.total);
  console.log("first photos", JSON.stringify(json.items?.[0]?.photos, null, 2));
  console.log("photo url check", json.items?.[0]?.photos);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
