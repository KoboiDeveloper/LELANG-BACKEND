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
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // allow non-browser / same-origin tools
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Coolify sslip / preview hosts: allow if wildcard *.sslip.io is set
      const okSslip = allowedOrigins.some(
        (o) => o.startsWith("*.") && origin.endsWith(o.slice(1)),
      );
      callback(null, okSslip);
    },
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
