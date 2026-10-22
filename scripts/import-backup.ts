/**
 * Import Supabase JSON backup into SQL Server via Prisma.
 * Expects BACKUP_DIR with data/*.json and auth/users.json
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const prisma = new PrismaClient();

async function readJson<T>(file: string): Promise<T> {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as T;
}

function asDate(v: unknown): Date {
  if (!v) return new Date();
  return new Date(String(v));
}

function dec(v: unknown): Prisma.Decimal {
  return new Prisma.Decimal(v == null || v === "" ? 0 : Number(v));
}

async function main() {
  const backupDir = path.resolve(
    __dirname,
    "..",
    process.env.BACKUP_DIR || "../lelang/backup/20260918-095630",
  );
  const dataDir = path.join(backupDir, "data");
  const authUsersPath = path.join(backupDir, "auth", "users.json");

  console.log("Backup:", backupDir);

  type AuthUser = {
    id: string;
    email?: string;
    encrypted_password?: string;
    email_confirmed_at?: string | null;
    raw_user_meta_data?: Record<string, unknown> | string | null;
    created_at?: string;
    updated_at?: string;
  };

  const authUsers = await readJson<AuthUser[]>(authUsersPath);
  console.log(`Users: ${authUsers.length}`);
  for (const u of authUsers) {
    const email = (u.email || `${u.id}@migrated.local`).toLowerCase();
    const meta =
      typeof u.raw_user_meta_data === "string"
        ? u.raw_user_meta_data
        : JSON.stringify(u.raw_user_meta_data ?? {});
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        email,
        passwordHash: u.encrypted_password || (await import("bcryptjs")).default.hashSync("ChangeMe123!", 10),
        emailConfirmed: Boolean(u.email_confirmed_at),
        rawUserMeta: meta,
        createdAt: asDate(u.created_at),
        updatedAt: asDate(u.updated_at),
      },
      update: {
        email,
        passwordHash: u.encrypted_password || undefined,
        rawUserMeta: meta,
      },
    });
  }

  const companies = await readJson<any[]>(path.join(dataDir, "companies.json"));
  for (const c of companies) {
    await prisma.company.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        code: c.code,
        name: c.name,
        shortName: c.short_name,
        createdAt: asDate(c.created_at),
      },
      update: { code: c.code, name: c.name, shortName: c.short_name },
    });
  }
  console.log(`companies: ${companies.length}`);

  const banks = await readJson<any[]>(path.join(dataDir, "banks.json"));
  for (const b of banks) {
    await prisma.bank.upsert({
      where: { id: b.id },
      create: {
        id: b.id,
        code: b.code,
        name: b.name,
        sortOrder: b.sort_order ?? 0,
        createdAt: asDate(b.created_at),
      },
      update: { code: b.code, name: b.name, sortOrder: b.sort_order ?? 0 },
    });
  }
  console.log(`banks: ${banks.length}`);

  const categories = await readJson<any[]>(path.join(dataDir, "item_categories.json"));
  for (const c of categories) {
    await prisma.itemCategory.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order ?? 0,
        isActive: c.is_active ?? true,
        createdAt: asDate(c.created_at),
      },
      update: {
        name: c.name,
        sortOrder: c.sort_order ?? 0,
        isActive: c.is_active ?? true,
      },
    });
  }
  console.log(`item_categories: ${categories.length}`);

  const profiles = await readJson<any[]>(path.join(dataDir, "profiles.json"));
  let profileOk = 0;
  for (const p of profiles) {
    const userExists = await prisma.user.findUnique({ where: { id: p.id } });
    if (!userExists) {
      console.warn(`skip profile ${p.id} — no user`);
      continue;
    }
    try {
      await prisma.profile.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          companyId: p.company_id,
          username: p.username,
          fullName: p.full_name,
          employeeNik: p.employee_nik ?? null,
          role: p.role,
          isActive: p.is_active ?? true,
          createdAt: asDate(p.created_at),
          updatedAt: asDate(p.updated_at),
        },
        update: {
          companyId: p.company_id,
          username: p.username,
          fullName: p.full_name,
          employeeNik: p.employee_nik ?? null,
          role: p.role,
          isActive: p.is_active ?? true,
        },
      });
      profileOk++;
    } catch (e) {
      console.warn(`profile skip ${p.id}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`profiles: ${profileOk}/${profiles.length}`);

  const bidders = await readJson<any[]>(path.join(dataDir, "bidder_profiles.json"));
  let bidderOk = 0;
  for (const b of bidders) {
    try {
      await prisma.bidderProfile.upsert({
        where: { id: b.id },
        create: {
          id: b.id,
          authUserId: b.auth_user_id,
          companyId: b.company_id,
          employeeNik: b.employee_nik,
          fullName: b.full_name,
          ktpHash: b.ktp_hash || "migrated",
          publicAlias: b.public_alias || b.full_name,
          isActive: b.is_active ?? true,
          createdAt: asDate(b.created_at),
          updatedAt: asDate(b.updated_at),
        },
        update: {
          authUserId: b.auth_user_id,
          companyId: b.company_id,
          employeeNik: b.employee_nik,
          fullName: b.full_name,
          publicAlias: b.public_alias || b.full_name,
          isActive: b.is_active ?? true,
        },
      });
      bidderOk++;
    } catch (e) {
      console.warn(`bidder skip ${b.id}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`bidder_profiles: ${bidderOk}/${bidders.length}`);

  const periods = await readJson<any[]>(path.join(dataDir, "auction_periods.json"));
  for (const p of periods) {
    await prisma.auctionPeriod.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        companyId: p.company_id,
        code: p.code,
        title: p.title,
        description: p.description,
        startAt: asDate(p.start_at),
        endAt: asDate(p.end_at),
        status: p.status || "draft",
        winnerEmailsSentAt: p.winner_emails_sent_at ? asDate(p.winner_emails_sent_at) : null,
        createdAt: asDate(p.created_at),
        createdBy: p.created_by,
        updatedAt: asDate(p.updated_at),
        updatedBy: p.updated_by,
      },
      update: {
        title: p.title,
        description: p.description,
        status: p.status,
        startAt: asDate(p.start_at),
        endAt: asDate(p.end_at),
      },
    });
  }
  console.log(`auction_periods: ${periods.length}`);

  const items = await readJson<any[]>(path.join(dataDir, "auction_items.json"));
  for (const it of items) {
    await prisma.auctionItem.upsert({
      where: { id: it.id },
      create: {
        id: it.id,
        periodId: it.period_id,
        lotNumber: it.lot_number,
        itemName: it.item_name,
        description: it.description ?? "",
        category: it.category,
        itemCondition: it.item_condition,
        startingPrice: dec(it.starting_price),
        currentPrice: dec(it.current_price),
        bidIncrement: dec(it.bid_increment ?? 1000),
        status: it.status || "draft",
        paymentConfirmed: it.payment_confirmed ?? false,
        paymentConfirmedAt: it.payment_confirmed_at ? asDate(it.payment_confirmed_at) : null,
        createdAt: asDate(it.created_at),
        createdBy: it.created_by,
        updatedAt: asDate(it.updated_at),
        updatedBy: it.updated_by,
      },
      update: {
        itemName: it.item_name,
        description: it.description ?? "",
        currentPrice: dec(it.current_price),
        startingPrice: dec(it.starting_price),
        status: it.status,
        paymentConfirmed: it.payment_confirmed ?? false,
      },
    });
  }
  console.log(`auction_items: ${items.length}`);

  const photos = await readJson<any[]>(path.join(dataDir, "item_photos.json"));
  for (const ph of photos) {
    await prisma.itemPhoto.upsert({
      where: { id: ph.id },
      create: {
        id: ph.id,
        itemId: ph.item_id,
        storagePath: ph.storage_path,
        sortOrder: ph.sort_order ?? 0,
        uploadedBy: ph.uploaded_by,
        createdAt: asDate(ph.created_at),
      },
      update: {
        storagePath: ph.storage_path,
        sortOrder: ph.sort_order ?? 0,
      },
    });
  }
  console.log(`item_photos: ${photos.length}`);

  const bids = await readJson<any[]>(path.join(dataDir, "bids.json"));
  for (const b of bids) {
    await prisma.bid.upsert({
      where: { id: b.id },
      create: {
        id: b.id,
        itemId: b.item_id,
        bidderId: b.bidder_id,
        amount: dec(b.amount),
        status: b.status || "active",
        createdAt: asDate(b.created_at),
      },
      update: {
        amount: dec(b.amount),
        status: b.status || "active",
      },
    });
  }
  console.log(`bids: ${bids.length}`);

  const favorites = await readJson<any[]>(path.join(dataDir, "favorites.json"));
  for (const f of favorites) {
    await prisma.favorite.upsert({
      where: { id: f.id },
      create: {
        id: f.id,
        userId: f.user_id,
        itemId: f.item_id,
        createdAt: asDate(f.created_at),
      },
      update: {},
    });
  }
  console.log(`favorites: ${favorites.length}`);

  const bankAccounts = await readJson<any[]>(path.join(dataDir, "auction_bank_accounts.json"));
  for (const a of bankAccounts) {
    await prisma.auctionBankAccount.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        companyId: a.company_id,
        bankId: a.bank_id,
        accountHolder: a.account_holder,
        accountNumber: a.account_number,
        isActive: a.is_active ?? true,
        notes: a.notes,
        createdAt: asDate(a.created_at),
        createdBy: a.created_by,
        updatedAt: asDate(a.updated_at),
        updatedBy: a.updated_by,
      },
      update: {
        accountHolder: a.account_holder,
        accountNumber: a.account_number,
        isActive: a.is_active ?? true,
      },
    });
  }
  console.log(`auction_bank_accounts: ${bankAccounts.length}`);

  const push = await readJson<any[]>(path.join(dataDir, "push_subscriptions.json"));
  for (const s of push) {
    try {
      await prisma.pushSubscription.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          companyId: s.company_id,
          endpoint: s.endpoint,
          p256dh: s.p256dh,
          auth: s.auth,
          userAgent: s.user_agent,
          createdAt: asDate(s.created_at),
        },
        update: {
          p256dh: s.p256dh,
          auth: s.auth,
        },
      });
    } catch (e) {
      console.warn("push skip", s.id, e instanceof Error ? e.message : e);
    }
  }
  console.log(`push_subscriptions: ${push.length}`);

  const audits = await readJson<any[]>(path.join(dataDir, "audit_logs.json"));
  // clear then insert (identity)
  await prisma.auditLog.deleteMany();
  for (const a of audits) {
    await prisma.auditLog.create({
      data: {
        tableName: a.table_name,
        recordId: a.record_id,
        action: a.action,
        oldData: a.old_data != null ? JSON.stringify(a.old_data) : null,
        newData: a.new_data != null ? JSON.stringify(a.new_data) : null,
        userId: a.user_id,
        createdAt: asDate(a.created_at),
      },
    });
  }
  console.log(`audit_logs: ${audits.length}`);

  console.log("Import done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
