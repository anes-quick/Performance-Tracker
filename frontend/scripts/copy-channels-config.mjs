/**
 * Copy repo-root channels.config.json into frontend/ so Vercel bundles it with the app.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const src = path.join(frontendRoot, "..", "channels.config.json");
const dest = path.join(frontendRoot, "channels.config.json");

if (!fs.existsSync(src)) {
  console.error("copy-channels-config: missing", src);
  process.exit(1);
}
fs.copyFileSync(src, dest);
console.log("copy-channels-config: copied channels.config.json → frontend/");
