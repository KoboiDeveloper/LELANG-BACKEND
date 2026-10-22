import { Router } from "express";
import multer from "multer";
import { DropboxClient, buildLelangPhotoPath } from "../lib/dropbox.js";
import { requireStaff, type AuthedRequest } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { serializePhoto } from "../services/itemService.js";

export const filesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 << 20 } });

filesRouter.post("/upload", requireStaff(), upload.single("file"), async (req: AuthedRequest, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file field is required" });
      return;
    }
    const itemId = String(req.body?.item_id || req.body?.itemId || "");
    if (!itemId) {
      res.status(400).json({ error: "item_id required" });
      return;
    }
    const client = DropboxClient.fromEnv();
    const path = buildLelangPhotoPath(itemId, file.originalname || "photo.jpg");
    const meta = await client.uploadWithTemporaryLink(path, file.buffer);
    const sortOrder = Number(req.body?.sort_order ?? req.body?.sortOrder ?? 0);
    const photo = await prisma.itemPhoto.create({
      data: {
        itemId,
        storagePath: meta.path_display || path,
        sortOrder,
        uploadedBy: req.auth!.id,
      },
    });
    res.status(201).json({
      photo: serializePhoto(photo),
      temporary_link: meta.temporary_link ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Upload gagal" });
  }
});

filesRouter.get("/temporary-link", async (req, res) => {
  try {
    const path = String(req.query.path || "");
    if (!path) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const client = DropboxClient.fromEnv();
    const link = await client.getTemporaryLink(path.startsWith("/") ? path : `/${path}`);
    res.json({ link });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Gagal temporary link" });
  }
});

filesRouter.get("/proxy", async (req, res) => {
  try {
    const path = String(req.query.path || "");
    if (!path) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const client = DropboxClient.fromEnv();
    const link = await client.getTemporaryLink(path.startsWith("/") ? path : `/${path}`);
    const upstream = await fetch(link);
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: "Failed to fetch file" });
      return;
    }
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=300");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Proxy gagal" });
  }
});

filesRouter.delete("/", requireStaff(), async (req, res) => {
  try {
    const path = String(req.body?.path || req.query.path || "");
    const photoId = String(req.body?.photo_id || req.body?.photoId || "");
    const client = DropboxClient.fromEnv();
    if (path) await client.delete(path);
    if (photoId) await prisma.itemPhoto.delete({ where: { id: photoId } }).catch(() => null);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Delete gagal" });
  }
});
