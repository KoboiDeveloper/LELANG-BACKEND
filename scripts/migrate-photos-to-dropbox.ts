/**
 * Download photos from Supabase public URLs (or local storage backup) and upload to Dropbox.
 * Updates item_photos.storage_path to Dropbox path.
 *
 * Env:
 *   SUPABASE_URL (optional, for public object URLs)
 *   DROPBOX_* required
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { DropboxClient } from "../src/lib/dropbox.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });
loadEnv({ path: path.join(__dirname, "..", "..", "lelang", ".env.local") });

const prisma = new PrismaClient();

async function fileExists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const client = DropboxClient.fromEnv();
  const backupDir = path.resolve(
    __dirname,
    "..",
    process.env.BACKUP_DIR || "../lelang/backup/20260918-095630",
  );
  const storageRoot = path.join(backupDir, "storage", "auction-photos");
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://krdahtspgtbwavoiplyg.supabase.co";

  const photos = await prisma.itemPhoto.findMany();
  console.log(`Photos to migrate: ${photos.length}`);
  let ok = 0;
  let fail = 0;
  const concurrency = Number(process.env.MIGRATE_CONCURRENCY || 4);
  let idx = 0;

  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= photos.length) return;
      const photo = photos[i];
      const oldPath = photo.storagePath;
      if (oldPath.startsWith("/uploads/lelang/")) {
        ok++;
        continue;
      }
      try {
        let buf: Buffer;
        const local = path.join(storageRoot, oldPath);
        if (await fileExists(local)) {
          buf = await readFile(local);
        } else {
          const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/auction-photos/${oldPath}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`download ${res.status}`);
          buf = Buffer.from(await res.arrayBuffer());
        }
        const filename = path.basename(oldPath) || `${Date.now()}.jpg`;
        const dropboxPath = `/uploads/lelang/auction-photos/${photo.itemId}/${filename}`;
        const meta = await client.upload(dropboxPath, buf);
        const newPath = meta.path_display || dropboxPath;
        await prisma.itemPhoto.update({
          where: { id: photo.id },
          data: { storagePath: newPath },
        });
        ok++;
        if (ok % 25 === 0) console.log(`progress ok=${ok} fail=${fail} / ${photos.length}`);
      } catch (e) {
        fail++;
        console.warn(`fail ${photo.id} ${oldPath}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`Done. ok=${ok} fail=${fail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
