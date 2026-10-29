// Build: bundle src/main.ts with esbuild and copy the static files into dist/.
//   node scripts/build.mjs           → dist/
//   node scripts/build.mjs --serve   → dev server on http://localhost:8000 (rebuilds on save)
// Env: SITE_URL (absolute URL of the deployed site, for link previews), REPO (owner/name on GitHub).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const serve = process.argv.includes("--serve");
const SITE_URL = (process.env.SITE_URL || "https://example.github.io/snowfinder/").replace(/\/?$/, "/");
const REPO = process.env.REPO || "OWNER/snowfinder";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
cpSync("src/styles.css", "dist/styles.css");
writeFileSync("dist/index.html", readFileSync("index.html", "utf8").replaceAll("%SITE_URL%", SITE_URL).replaceAll("%REPO%", REPO));

const options = { entryPoints: ["src/main.ts"], bundle: true, format: "esm", target: "es2020", outfile: "dist/app.js", minify: !serve, sourcemap: serve, logLevel: "info" };
if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: 8000 });
  console.log(`Snowfinder dev server: http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
