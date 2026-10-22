import sql from "mssql";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

function parseDatabaseUrl(url: string) {
  // sqlserver://host:port;database=x;user=y;password=z;...
  const cleaned = url.replace(/^sqlserver:\/\//i, "");
  const [hostPart, ...rest] = cleaned.split(";");
  const [server, portStr] = hostPart.split(":");
  const params: Record<string, string> = {};
  for (const part of rest) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    params[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return {
    server,
    port: Number(portStr || 1433),
    user: params.user || params["user id"] || "sa",
    password: params.password || "",
    database: params.database || "lelang",
  };
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL missing");
  const cfg = parseDatabaseUrl(raw.replace(/^"|"$/g, ""));
  const pool = await sql.connect({
    server: cfg.server,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 60000,
  });

  const exists = await pool
    .request()
    .input("name", sql.NVarChar, cfg.database)
    .query(`SELECT DB_ID(@name) AS id`);
  if (exists.recordset[0]?.id) {
    console.log(`Database ${cfg.database} already exists`);
  } else {
    await pool.request().query(`CREATE DATABASE [${cfg.database}]`);
    console.log(`Created database ${cfg.database}`);
  }
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
