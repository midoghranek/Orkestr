import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".json": "application/json",
  ".srt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Ephemeral, loopback-only file server for renderers (Remotion's headless Chrome).
 * Only files explicitly registered are served, under unguessable tokens. Supports HTTP Range.
 */
export class EphemeralFileServer {
  private server?: http.Server;
  private files = new Map<string, string>();
  private port = 0;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const token = (req.url ?? "").split("?")[0].replace(/^\/f\//, "").split("/")[0];
      const file = this.files.get(token);
      if (!file || req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(404).end();
        return;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        res.writeHead(404).end();
        return;
      }
      const headers: Record<string, string | number> = {
        "Content-Type": mimeFor(file),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      };
      const range = req.headers.range ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
          return;
        }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
        if (req.method === "HEAD") return void res.end();
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      if (req.method === "HEAD") return void res.end();
      fs.createReadStream(file).pipe(res);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", () => resolve()));
    const addr = this.server.address();
    this.port = typeof addr === "object" && addr ? addr.port : 0;
  }

  /** Register a file and get its URL. The extension is kept in the URL so browsers sniff correctly. */
  url(file: string): string {
    const token = crypto.randomBytes(12).toString("hex");
    this.files.set(token, path.resolve(file));
    return `http://127.0.0.1:${this.port}/f/${token}/${encodeURIComponent(path.basename(file))}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.files.clear();
  }
}
