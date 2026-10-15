// Wraps the artifact page (index.html) in a full HTML document for LifeOS on Vercel and copies the logo files.
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("index.html", root), "utf8");
const head =
  '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name="robots" content="noindex,nofollow">' +
  '<meta name="apple-mobile-web-app-title" content="LifeOS"><meta name="application-name" content="LifeOS">' +
  '<link rel="icon" type="image/png" sizes="32x32" href="/assets/lifeos-logo-32.png">' +
  '<link rel="icon" type="image/png" sizes="192x192" href="/assets/lifeos-logo-192.png">' +
  '<link rel="apple-touch-icon" href="/assets/lifeos-logo-192.png">' +
  "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}" +
  "body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>";

mkdirSync(new URL("dist/assets/", root), { recursive: true });
for (const size of [32, 64, 192]) copyFileSync(new URL(`assets/lifeos-logo-${size}.png`, root), new URL(`dist/assets/lifeos-logo-${size}.png`, root));
writeFileSync(new URL("dist/index.html", root), head + page + "</body></html>");
console.log("dist/index.html written");
