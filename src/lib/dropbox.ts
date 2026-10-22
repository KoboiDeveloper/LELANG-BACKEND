const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
const TEMP_LINK_URL = "https://api.dropboxapi.com/2/files/get_temporary_link";
const DELETE_URL = "https://api.dropboxapi.com/2/files/delete_v2";

export type UploadResult = {
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
  size: number;
  temporary_link?: string;
};

export class DropboxClient {
  private accessToken = "";
  private expiresAt = 0;

  constructor(
    private appKey: string,
    private appSecret: string,
    private refreshToken: string,
  ) {}

  static fromEnv(): DropboxClient {
    const appKey = process.env.DROPBOX_APP_KEY?.trim() || "";
    const appSecret = process.env.DROPBOX_APP_SECRET?.trim() || "";
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN?.trim() || "";
    if (!appKey || !appSecret || !refreshToken) {
      throw new Error(
        "DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN are required",
      );
    }
    return new DropboxClient(appKey, appSecret, refreshToken);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });
    const auth = Buffer.from(`${this.appKey}:${this.appSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`dropbox token error ${res.status}: ${text}`);
    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("empty access_token from dropbox");
    this.accessToken = json.access_token;
    this.expiresAt = Date.now() + (json.expires_in || 14400) * 1000;
    return this.accessToken;
  }

  async upload(path: string, content: Buffer): Promise<UploadResult> {
    const token = await this.getAccessToken();
    const arg = JSON.stringify({
      path,
      mode: "overwrite",
      autorename: false,
      mute: false,
      strict_conflict: false,
    });
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": arg,
      },
      body: content,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`dropbox upload error ${res.status}: ${text}`);
    return JSON.parse(text) as UploadResult;
  }

  async getTemporaryLink(path: string): Promise<string> {
    const token = await this.getAccessToken();
    const res = await fetch(TEMP_LINK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`dropbox temp link error ${res.status}: ${text}`);
    const json = JSON.parse(text) as { link?: string };
    if (!json.link) throw new Error("empty temporary link");
    return json.link;
  }

  async delete(path: string): Promise<void> {
    let p = path.trim();
    if (!p) return;
    if (!p.startsWith("/")) p = `/${p}`;
    const token = await this.getAccessToken();
    const res = await fetch(DELETE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: p }),
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 409 || text.includes("not_found")) return;
      throw new Error(`dropbox delete error ${res.status}: ${text}`);
    }
  }

  async uploadWithTemporaryLink(path: string, content: Buffer): Promise<UploadResult> {
    const meta = await this.upload(path, content);
    const linkPath = meta.path_display || path;
    try {
      meta.temporary_link = await this.getTemporaryLink(linkPath);
    } catch {
      // ignore temp link failure on upload
    }
    return meta;
  }
}

export function buildLelangPhotoPath(itemId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `/uploads/lelang/auction-photos/${itemId}/${Date.now()}-${safe}`;
}
