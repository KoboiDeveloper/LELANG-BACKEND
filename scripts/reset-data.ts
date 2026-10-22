import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });
const prisma = new PrismaClient();

async function main() {
  // FK-safe order
  await prisma.auditLog.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.itemPhoto.deleteMany();
  await prisma.auctionItem.deleteMany();
  await prisma.auctionPeriod.deleteMany();
  await prisma.auctionBankAccount.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.bidderProfile.deleteMany();
  await prisma.registrationOtp.deleteMany();
  await prisma.passwordResetOtp.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.itemCategory.deleteMany();
  await prisma.bank.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  console.log("All tables cleared");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
