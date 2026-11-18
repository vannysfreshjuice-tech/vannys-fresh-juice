// Home: the last 8 weeks at a glance. Bars = what was sold each week; the line = the money that came in.
// One axis (both in shillings). Legend always shown, the latest week labelled, every week tappable for
// its figures (the orange is light on the page, so the numbers are always written out too).
import { useState } from 'react';
import { showDay } from '../lib/dates';
import type { WeekPoint } from '../lib/performance';

const SALES = '#EF8410';
const MONEY = '#2A64A8';
const W = 640;
const H = 230;
const PAD = { l: 44, r: 12, t: 16, b: 28 };

const short = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

/** A round top for the axis: 10k, 20k, 50k, 100k... */
function niceMax(v: number): number {
  if (v <= 0) return 10000;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function WeeklyChart({ points, currency, onOpen }: { points: WeekPoint[]; currency: string; onOpen?: () => void }) {
  const [pick, setPick] = useState(points.length - 1);
  const top = niceMax(Math.max(...points.map((p) => Math.max(p.sales, p.moneyIn))));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / points.length;
  const barW = Math.min(24, slot * 0.5);
  const x = (i: number) => PAD.l + slot * i + slot / 2;
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const p = points[pick] ?? points[points.length - 1];
  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString('en-US')}`;
  const line = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i)},${y(pt.moneyIn)}`).join(' ');
  const empty = points.every((pt) => !pt.sales && !pt.moneyIn);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: SALES }} />
          Sold
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: MONEY }} />
          <span className="inline-block h-2 w-2 -translate-x-3 rounded-full" style={{ background: MONEY }} />
          Money in
        </span>
      </div>
      {empty ? (
        <p className="py-8 text-center text-sm text-muted">No sales in the last 8 weeks yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Sales and money in for the last ${points.length} weeks`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(top * f)} y2={y(top * f)} stroke="#F1E3D0" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(top * f) + 4} textAnchor="end" fontSize="11" fill="#8C7660">
                {short(top * f)}
              </text>
            </g>
          ))}
          {points.map((pt, i) => {
            const h = Math.max(0, y(0) - y(pt.sales));
            const r = Math.min(4, h);
            const bx = x(i) - barW / 2;
            const by = y(pt.sales);
            return (
              <g key={pt.start}>
                {h > 0 && (
                  <path
                    d={`M${bx},${y(0)} L${bx},${by + r} Q${bx},${by} ${bx + r},${by} L${bx + barW - r},${by} Q${bx + barW},${by} ${bx + barW},${by + r} L${bx + barW},${y(0)} Z`}
                    fill={SALES}
                    opacity={i === pick ? 1 : 0.75}
                  />
                )}
                <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={i === pick ? '#3A2716' : '#8C7660'} fontWeight={i === pick ? 700 : 400}>
                  {showDay(pt.start).split(' ').slice(1, 3).join(' ')}
                </text>
              </g>
            );
          })}
          <path d={line} fill="none" stroke={MONEY} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((pt, i) => (
            <circle key={pt.start} cx={x(i)} cy={y(pt.moneyIn)} r={i === pick ? 5 : 4} fill={MONEY} stroke="#FFFFFF" strokeWidth={2} />
          ))}
          {/* tap targets, wider than the marks */}
          {points.map((pt, i) => (
            <rect key={`hit-${pt.start}`} x={PAD.l + slot * i} y={PAD.t} width={slot} height={plotH + PAD.b} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => setPick(i)} onMouseEnter={() => setPick(i)}>
              <title>{`Week of ${showDay(pt.start)}: sold ${money(pt.sales)}, money in ${money(pt.moneyIn)}`}</title>
            </rect>
          ))}
        </svg>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-page px-3 py-2 text-sm">
        <span className="col-span-3 text-xs text-muted">
          Week of {showDay(p.start)}
          {pick === points.length - 1 ? ' (this week so far)' : ''}
        </span>
        <span>
          <span className="block text-xs text-muted">Sold</span>
          <b className="num">{money(p.sales)}</b>
        </span>
        <span>
          <span className="block text-xs text-muted">Money in</span>
          <b className="num">{money(p.moneyIn)}</b>
        </span>
        <span>
          <span className="block text-xs text-muted">Bottles</span>
          <b className="num">{p.bottles}</b>
        </span>
      </div>
      {onOpen && (
        <button type="button" className="mt-2 text-sm font-semibold text-accent-dark underline" onClick={onOpen}>
          More in Reports
        </button>
      )}
    </div>
  );
}
