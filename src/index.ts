import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { itemsRouter } from "./routes/items.js";
import { catalogRouter } from "./routes/catalog.js";
import { filesRouter } from "./routes/files.js";
import { miscRouter } from "./routes/misc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const app = express();
const port = Number(process.env.PORT || 4100);
const origin = process.env.CORS_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin: origin.split(",").map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send("aku sayang kamu\n");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "lelang-be" });
});

app.use("/api/auth", authRouter);
app.use("/api/items", itemsRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/files", filesRouter);
app.use("/api", miscRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
});

app.listen(port, () => {
  console.log(`lelang-be listening on :${port}`);
});
