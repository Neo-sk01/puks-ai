"use client";

import { useMemo, useState } from "react";
import type { GraphPoint, ReviewRecord } from "@/lib/review";

interface Props {
  graph: GraphPoint[];
  byId: Record<string, ReviewRecord>;
  sampleIds: ReadonlySet<string>;
  annotatedIds: ReadonlySet<string>;
  onPick: (id: string) => void;
}

const PALETTE = ["#1b365f", "#2e7d4f", "#a8650a", "#6b4fbb", "#0e7c86", "#b23b3b", "#5f728f", "#8a6d1f"];
const W = 1000, H = 640, P = 40;
const X = (v: number) => P + v * (W - 2 * P);
const Y = (v: number) => H - P - v * (H - 2 * P);

/** Monotone-chain convex hull, expanded a little so points sit inside. */
function hull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** All 65 records as a 2D projection: colour is cluster, shape is
 *  answerable (circle) vs should-refuse (square), a thick border marks the
 *  queue, orange marks annotated. Only queued points open a record. */
export function MapView({ graph, byId, sampleIds, annotatedIds, onPick }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; g: GraphPoint } | null>(null);
  const clusters = useMemo(() => {
    const m = new Map<number, GraphPoint[]>();
    for (const g of graph) m.set(g.cluster, [...(m.get(g.cluster) ?? []), g]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [graph]);

  const hulls = clusters.map(([c, pts]) => {
    const h = hull(pts.map((g) => [X(g.x), Y(g.y)]));
    if (h.length < 3) return null;
    const cx = h.reduce((s, q) => s + q[0], 0) / h.length, cy = h.reduce((s, q) => s + q[1], 0) / h.length;
    const d = h.map(([x, y]) => [x + (x - cx) * 0.18 + Math.sign(x - cx) * 10, y + (y - cy) * 0.18 + Math.sign(y - cy) * 10])
      .map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ") + "Z";
    return <path key={c} d={d} fill={PALETTE[c % PALETTE.length]} stroke={PALETTE[c % PALETTE.length]} fillOpacity={0.1} strokeOpacity={0.35} />;
  });

  return (
    <div className="rounded-lg border border-rule bg-ink p-4">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {clusters.map(([c, pts]) => {
          const counts: Record<string, number> = {};
          for (const g of pts) counts[g.group] = (counts[g.group] || 0) + 1;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2)
            .map(([grp]) => byId[pts.find((g) => g.group === grp)!.id]?.group_title).join(" / ");
          return (
            <span key={c}>
              <i className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: PALETTE[c % PALETTE.length] }} />
              cluster {c} · {pts.length} · {top}
            </span>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Map of all 65 records">
        {hulls}
        {graph.map((g) => {
          const isS = sampleIds.has(g.id), isA = annotatedIds.has(g.id);
          const col = isA ? "#e07a1f" : PALETTE[g.cluster % PALETTE.length];
          const r = isS ? 9 : 5, x = X(g.x), y = Y(g.y);
          const common = {
            fill: col, fillOpacity: isS ? 1 : 0.55, stroke: isS ? "#1b365f" : "none", strokeWidth: isS ? 2.5 : 0,
            className: isS ? "cursor-pointer" : undefined,
            onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, g }),
            onMouseLeave: () => setTip(null),
            onClick: isS ? () => onPick(g.id) : undefined,
          };
          return (
            <g key={g.id}>
              {g.kind === "refuse" ? <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...common} /> : <circle cx={x} cy={y} r={r} {...common} />}
              {isS && <text x={x + r + 3} y={y + 4} fontSize={11} fontFamily="var(--font-mono)" fill="#1b365f">{g.id}</text>}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground/80">● answerable · ■ should-refuse · thick border = in your queue · orange = annotated · click a queued point to open it</p>
      {tip && (
        <div className="pointer-events-none fixed z-50 max-w-xs rounded bg-type px-2.5 py-1.5 text-xs text-ink" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <b>{tip.g.id}</b> · {byId[tip.g.id]?.group_title}{tip.g.refused ? " · refused" : ""}{tip.g.source_match === false ? " · source ≠ expected" : ""}
          <br />{tip.g.title}
          <br /><span className="opacity-70">{sampleIds.has(tip.g.id) ? "in queue" : "not in queue"}</span>
        </div>
      )}
    </div>
  );
}
