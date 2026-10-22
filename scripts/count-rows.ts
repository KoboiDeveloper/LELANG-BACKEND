import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });
const p = new PrismaClient();

const counts = {
  users: await p.user.count(),
  companies: await p.company.count(),
  items: await p.auctionItem.count(),
  photos: await p.itemPhoto.count(),
  bids: await p.bid.count(),
  profiles: await p.profile.count(),
};
console.log(counts);
await p.$disconnect();
