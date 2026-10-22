import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DropboxClient } from "../src/lib/dropbox.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const client = DropboxClient.fromEnv();
const p = `/uploads/lelang/_health/${Date.now()}.txt`;
const meta = await client.upload(p, Buffer.from("lelang-be dropbox ok"));
const link = await client.getTemporaryLink(meta.path_display || p);
console.log({ path: meta.path_display, link: link.slice(0, 60) + "..." });
