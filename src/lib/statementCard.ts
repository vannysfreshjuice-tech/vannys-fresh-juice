// The statement card: one picture in Vanny's colours that tells a customer where they stand
// (a balance, all paid up, or money paid ahead), with no list of days. Drawn on a canvas and
// shared as a PNG (WhatsApp on the phone), 1080 x 1350, the shape WhatsApp shows full size.
import type { Standing } from './performance';

export interface CardInput {
  businessName: string;
  customerName: string;
  standing: Standing;
  currency: string;
  /** "Monday 16 November 2026" */
  dateText: string;
  whatsapp: string;
  phone: string;
  merchantCode: string;
  note: string;
}

const W = 1080;
const H = 1350;
const C = {
  cream: '#FFF8EE',
  orange: '#F7931E',
  orangeDeep: '#E2700A',
  mango: '#FFC425',
  leaf: '#3BA935',
  leafDeep: '#23801F',
  purple: '#7A2C8F',
  ink: '#3A2716',
  muted: '#8C7660',
  white: '#FFFFFF',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A citrus slice: rind, pith, and segments. */
function citrus(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rind: string, flesh: string, turn = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.fillStyle = rind;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFF3D6';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
  ctx.fill();
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + 0.06;
    const a1 = ((i + 1) / n) * Math.PI * 2 - 0.06;
    ctx.fillStyle = flesh;
    ctx.beginPath();
    ctx.moveTo(Math.cos((a0 + a1) / 2) * r * 0.1, Math.sin((a0 + a1) / 2) * r * 0.1);
    ctx.arc(0, 0, r * 0.8, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, turn: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(len * 0.08, 0);
  ctx.lineTo(len * 0.9, 0);
  ctx.stroke();
  ctx.restore();
}

function drop(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.6);
  ctx.bezierCurveTo(x + r, y - r * 0.4, x + r, y + r, x, y + r);
  ctx.bezierCurveTo(x - r, y + r, x - r, y - r * 0.4, x, y - r * 1.6);
  ctx.fill();
}

/** Text that shrinks until it fits the width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 800) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 4;
  } while (s > 24);
  ctx.fillText(text, x, y);
}

function money(n: number, currency: string) {
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
}

export async function drawStatementCard(input: CardInput, base = './'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const [logo, photo] = await Promise.all([loadImage(`${base}brand/logo.jpg`), loadImage(`${base}brand/juice-photo.jpg`)]);
  const s = input.standing;
  const tone = s.kind === 'owes' ? C.orangeDeep : C.leafDeep;

  // Cream page with a soft mango glow
  ctx.fillStyle = C.cream;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.55, 40, W * 0.85, H * 0.55, 620);
  glow.addColorStop(0, 'rgba(255,196,37,0.22)');
  glow.addColorStop(1, 'rgba(255,196,37,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // The orange wave across the top
  const wave = ctx.createLinearGradient(0, 0, W, 420);
  wave.addColorStop(0, C.orangeDeep);
  wave.addColorStop(0.55, C.orange);
  wave.addColorStop(1, C.mango);
  ctx.fillStyle = wave;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 330);
  ctx.bezierCurveTo(W * 0.72, 430, W * 0.38, 270, 0, 380);
  ctx.closePath();
  ctx.fill();
  // a purple straw ribbon along the wave
  ctx.strokeStyle = C.purple;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-20, 405);
  ctx.bezierCurveTo(W * 0.38, 295, W * 0.72, 455, W + 20, 352);
  ctx.stroke();

  // Fruit around the edges
  citrus(ctx, W - 70, 70, 120, '#F7811E', '#FFB547', 0.3);
  leaf(ctx, W - 250, 40, 110, 0.5, C.leaf);
  leaf(ctx, W - 210, 150, 90, 1.2, C.leafDeep);
  citrus(ctx, W - 60, H - 205, 110, '#E9B800', '#FFE071', -0.4);
  leaf(ctx, W - 190, H - 300, 95, -2.4, C.leaf);
  drop(ctx, 120, 300, 14, 'rgba(255,255,255,0.75)');
  drop(ctx, 190, 250, 9, 'rgba(255,255,255,0.6)');
  drop(ctx, W - 300, 250, 11, 'rgba(255,255,255,0.65)');

  // The juice photo as a watermark: large and faint behind the lower part of the card
  const watermark = (alpha: number, clip?: () => void) => {
    if (!photo) return;
    const ww = W * 0.95;
    const wh = (ww * photo.height) / photo.width;
    ctx.save();
    if (clip) {
      clip();
      ctx.clip();
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(photo, (W - ww) / 2, H - 110 - wh + 60, ww, wh);
    ctx.restore();
  };
  watermark(0.16);

  // Logo on a white rounded tile
  ctx.save();
  ctx.shadowColor = 'rgba(58,39,22,0.18)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = C.white;
  roundRect(ctx, W / 2 - 260, 70, 520, 290, 40);
  ctx.fill();
  ctx.restore();
  if (logo) ctx.drawImage(logo, W / 2 - 235, 92, 470, (470 * logo.height) / logo.width);
  else {
    ctx.fillStyle = C.orange;
    ctx.textAlign = 'center';
    fitText(ctx, input.businessName, W / 2, 240, 460, 64);
  }

  // The main panel
  const px = 90;
  const py = 440;
  const pw = W - 180;
  const ph = 520;
  ctx.save();
  ctx.shadowColor = 'rgba(58,39,22,0.16)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = C.white;
  roundRect(ctx, px, py, pw, ph, 48);
  ctx.fill();
  ctx.restore();
  watermark(0.07, () => roundRect(ctx, px, py, pw, ph, 48));
  ctx.fillStyle = tone;
  roundRect(ctx, px, py, 18, ph, 9);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  fitText(ctx, `Hi ${input.customerName}!`, W / 2, py + 100, pw - 120, 60, 800);

  ctx.fillStyle = C.muted;
  ctx.font = `600 34px ${FONT}`;
  const heading = s.kind === 'owes' ? 'Your balance with us' : s.kind === 'ahead' ? 'You have paid ahead' : 'Your account';
  ctx.fillText(heading, W / 2, py + 175);

  // The one figure
  ctx.fillStyle = tone;
  if (s.kind === 'clear') {
    fitText(ctx, 'All paid up', W / 2, py + 300, pw - 120, 112, 900);
  } else {
    fitText(ctx, money(s.amount, input.currency), W / 2, py + 305, pw - 120, 132, 900);
  }

  // A pill under the figure
  const pill = s.kind === 'owes' ? 'Thank you for settling when you can' : s.kind === 'ahead' ? (s.bottles > 0 ? `That's about ${s.bottles} ${s.bottles === 1 ? 'bottle' : 'bottles'} of juice` : 'Kept for your next juice') : 'Nothing to pay. Thank you!';
  ctx.font = `700 32px ${FONT}`;
  const pwid = ctx.measureText(pill).width + 70;
  ctx.fillStyle = s.kind === 'owes' ? '#FFF0DC' : '#E5F5E1';
  roundRect(ctx, W / 2 - pwid / 2, py + 350, pwid, 66, 33);
  ctx.fill();
  ctx.fillStyle = tone;
  ctx.fillText(pill, W / 2, py + 395);

  ctx.fillStyle = C.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(`As at ${input.dateText}`, W / 2, py + 470);

  // How to pay (only when something is owed) and contacts
  ctx.textAlign = 'left';
  const by = py + ph + 70;
  ctx.fillStyle = C.ink;
  ctx.font = `800 36px ${FONT}`;
  if (s.kind === 'owes') {
    ctx.fillText('Pay easily', 100, by);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.fillText('MTN MoMo · Airtel Money · Cash', 100, by + 50);
    if (input.merchantCode) ctx.fillText(`Merchant code: ${input.merchantCode}`, 100, by + 95);
  } else {
    ctx.fillText('Fresh juice, every day', 100, by);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText('Order on WhatsApp any time', 100, by + 50);
  }
  ctx.fillStyle = C.muted;
  ctx.font = `600 30px ${FONT}`;
  const cy = by + (s.kind === 'owes' && input.merchantCode ? 160 : 120);
  if (input.whatsapp) ctx.fillText(`WhatsApp ${input.whatsapp}`, 100, cy);
  if (input.phone && input.phone !== input.whatsapp) ctx.fillText(`Call ${input.phone}`, 100, cy + 44);

  // Green thank-you strip
  const strip = ctx.createLinearGradient(0, H - 110, W, H);
  strip.addColorStop(0, C.leafDeep);
  strip.addColorStop(1, C.leaf);
  ctx.fillStyle = strip;
  ctx.fillRect(0, H - 110, W, 110);
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  fitText(ctx, `${input.note || 'Thank you!'}  ·  ${input.businessName}`, W / 2, H - 42, W - 120, 36, 700);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The card could not be made.'))), 'image/png'));
}
