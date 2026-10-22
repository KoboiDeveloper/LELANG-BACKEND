# lelang-be

Backend Prisma + Express untuk aplikasi E-Lelang. Database SQL Server `lelang` (server AMS). Storage foto di Dropbox.

## Setup

```bash
npm install
cp .env.example .env   # isi DATABASE_URL, DROPBOX_*, JWT_SECRET, dll
npm run db:create      # CREATE DATABASE lelang (jika belum)
npx prisma db push
npm run import:backup  # dari backup JSON Supabase
npm run migrate:photos # upload ulang foto ke Dropbox
npm run dev            # http://localhost:4100
```

## Scripts

| Script | Keterangan |
|--------|------------|
| `npm run db:create` | Buat database `lelang` |
| `npm run import:backup` | Import `BACKUP_DIR` JSON → SQL Server |
| `npm run migrate:photos` | Supabase public URL / local storage → Dropbox |
| `npm run dev` | Dev server (tsx watch) |

## Frontend

Set di `lelang/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4100
```
