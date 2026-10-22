import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { DropboxClient } from "../src/lib/dropbox.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.itemPhoto.findMany({ take: 3, orderBy: { createdAt: "desc" } });
  for (const r of rows) {
    console.log({ id: r.id, path: r.storagePath });
  }
  const linkPath = rows[0]?.storagePath;
  if (!linkPath) {
    console.log("no photos");
    return;
  }
  const client = DropboxClient.fromEnv();
  const p = linkPath.startsWith("/") ? linkPath : `/${linkPath}`;
  const link = await client.getTemporaryLink(p);
  console.log("temp_ok", link.slice(0, 90));

  const proxyUrl = `http://127.0.0.1:4100/api/files/proxy?path=${encodeURIComponent(linkPath)}`;
  const res = await fetch(proxyUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("proxy", { status: res.status, type: res.headers.get("content-type"), bytes: buf.length });

  // sample items API shape
  const itemsRes = await fetch("http://127.0.0.1:4100/api/catalog/periods");
  const periods = (await itemsRes.json()) as { periods: { id: string }[] };
  const periodId = periods.periods?.[0]?.id;
  if (periodId) {
    const list = await fetch(
      `http://127.0.0.1:4100/api/items?period_id=${periodId}&limit=1`,
    );
    const json = await list.json();
    console.log("item_sample_photos", JSON.stringify(json.items?.[0]?.photos ?? json, null, 2).slice(0, 800));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
