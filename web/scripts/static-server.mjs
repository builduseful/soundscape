// Serves src/ on a free local port, as GitHub Pages serves it at the site root,
// for the scripts that render the app with Playwright.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const MIME_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".opus": "audio/ogg",
};

export async function startServer() {
    const server = createServer(async (req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        const filePath = path.join(srcDir, urlPath === "/" ? "index.html" : urlPath);

        try {
            const data = await readFile(filePath);
            const ext = path.extname(filePath);
            res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
            res.end(data);
        } catch {
            res.writeHead(404);
            res.end();
        }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return { server, url: `http://127.0.0.1:${port}/` };
}
