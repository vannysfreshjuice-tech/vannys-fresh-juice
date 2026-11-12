// Makes the app icons from assets/business-card.jpg (Vanny's card). Run once ("npm run icons") and
// commit the results; the release workflow does not run this.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = 'assets/business-card.jpg';
const OUT = 'public';
mkdirSync(`${OUT}/brand`, { recursive: true });
const CREAM = { r: 255, g: 248, b: 238, alpha: 1 };

// The juice-cup mark (left of "Vanny's") and the full logo with the name.
const mark = () => sharp(SRC).extract({ left: 50, top: 148, width: 162, height: 272 });
const logo = sharp(SRC).extract({ left: 45, top: 145, width: 530, height: 280 });

// A square icon: the cup centred on cream.
async function icon(size, inner) {
  const h = Math.round(size * inner);
  const cup = await mark().resize({ height: h }).toBuffer();
  const meta = await sharp(cup).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
    .composite([{ input: cup, left: Math.round((size - meta.width) / 2), top: Math.round((size - h) / 2) }])
    .png();
}
await (await icon(180, 0.86)).toFile(`${OUT}/apple-touch-icon.png`);
await (await icon(192, 0.86)).toFile(`${OUT}/icon-192.png`);
await (await icon(512, 0.86)).toFile(`${OUT}/icon-512.png`);
await (await icon(32, 0.94)).toFile(`${OUT}/favicon-32.png`);
// Maskable: phones may cut the icon to a circle, so keep the cup inside the middle 70%.
await (await icon(512, 0.66)).toFile(`${OUT}/icon-maskable-512.png`);
await logo.resize(800).jpeg({ quality: 90 }).toFile(`${OUT}/brand/logo.jpg`);
await mark().resize({ height: 256 }).png().toFile(`${OUT}/brand/mark.png`);
// The juice photo from the card, for the PIN screen on a laptop.
await sharp(SRC).extract({ left: 652, top: 0, width: 428, height: 675 }).jpeg({ quality: 88 }).toFile(`${OUT}/brand/juice-photo.jpg`);
console.log('icons made');
