import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(webRoot, "public", "design-poc");
await mkdir(output, { recursive: true });

const productSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="3000" viewBox="0 0 3000 3000">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dbeafe"/><stop offset="0.52" stop-color="#ffffff"/><stop offset="1" stop-color="#93c5fd"/>
    </linearGradient>
    <filter id="shadow"><feGaussianBlur stdDeviation="35"/></filter>
  </defs>
  <ellipse cx="1530" cy="2570" rx="680" ry="150" fill="#0f172a" opacity=".18" filter="url(#shadow)"/>
  <path d="M1130 620 Q1130 460 1290 420 H1710 Q1870 460 1870 620 V2440 Q1870 2610 1700 2640 H1300 Q1130 2610 1130 2440Z" fill="url(#body)" stroke="#1d4ed8" stroke-width="34"/>
  <rect x="1260" y="280" width="480" height="300" rx="90" fill="#1e3a8a"/>
  <rect x="1320" y="210" width="360" height="150" rx="50" fill="#60a5fa"/>
  <circle cx="1500" cy="1420" r="360" fill="#2563eb"/>
  <path d="M1340 1440 L1480 1580 L1740 1250" fill="none" stroke="#fff" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="1500" y="2030" text-anchor="middle" font-family="Arial" font-weight="700" font-size="170" fill="#0f172a">DQ</text>
  <path d="M1840 760 L2170 930 L1870 1080Z" fill="#f59e0b" stroke="#92400e" stroke-width="20"/>
</svg>`;

const backgroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="2400" viewBox="0 0 3200 2400">
  <rect width="3200" height="2400" fill="#f8fafc"/>
  <g stroke="#94a3b8" stroke-width="8" opacity=".72">
    ${Array.from({ length: 9 }, (_, index) => `<path d="M${index * 400} 0V2400"/>`).join("")}
    ${Array.from({ length: 7 }, (_, index) => `<path d="M0 ${index * 400}H3200"/>`).join("")}
  </g>
  <g font-family="Arial" font-weight="700" font-size="210" fill="#1d4ed8">
    <text x="90" y="250">1 TL</text><text x="2500" y="250">2 TR</text>
    <text x="90" y="2260">3 BL</text><text x="2500" y="2260">4 BR</text>
  </g>
  <circle cx="1600" cy="1200" r="520" fill="#dbeafe" stroke="#2563eb" stroke-width="30"/>
  <path d="M1300 1200H1900M1600 900V1500" stroke="#2563eb" stroke-width="36"/>
</svg>`;

const brandSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="16" y="16" width="224" height="224" rx="56" fill="#2563eb"/><circle cx="128" cy="128" r="66" fill="none" stroke="#fff" stroke-width="24"/><path d="M128 62v132M62 128h132" stroke="#fff" stroke-width="18"/></svg>`;

await Promise.all([
    sharp(Buffer.from(productSvg)).png().toFile(path.join(output, "product-transparent.png")),
    sharp(Buffer.from(backgroundSvg)).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(path.join(output, "product-background.jpg")),
    writeFile(path.join(output, "brand-mark.svg"), brandSvg, "utf8"),
]);

console.log(`Design PoC fixtures generated in ${output}`);
