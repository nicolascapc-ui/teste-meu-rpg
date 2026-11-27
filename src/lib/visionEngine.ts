import type { SceneWall } from '../types/vtt';

export interface Point2D {
  x: number;
  y: number;
}

interface SegmentPx {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function raySegmentIntersect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  seg: SegmentPx
): number | null {
  const sx = seg.bx - seg.ax;
  const sy = seg.by - seg.ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const qpx = seg.ax - ox;
  const qpy = seg.ay - oy;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dy - qpy * dx) / denom;

  if (t >= 0 && u >= -1e-6 && u <= 1 + 1e-6) {
    return t;
  }
  return null;
}

export interface VisionConeConfig {
  /** Compass direction in degrees: 0 = up (north), 90 = right (east), 180 = down (south), 270 = left (west) */
  facingDeg: number;
  /** Total cone opening angle in degrees (e.g. 25..240) */
  spreadDeg: number;
}

function normalizeAngleDelta(angle: number, center: number): number {
  let d = angle - center;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Computes a 2D line-of-sight visibility polygon in pixel coordinates for a token,
 * respecting all solid walls and closed doors, clipped to `radiusPx`.
 * Supports both full 360-degree circular vision (default) and a directional front cone.
 */
export function computeVisibilityPolygon(
  originX: number,
  originY: number,
  radiusPx: number,
  walls: SceneWall[],
  stageW: number,
  stageH: number,
  cone?: VisionConeConfig
): Point2D[] {
  const blockingSegments: SegmentPx[] = [];

  for (const w of walls) {
    // Open doors let vision pass right through
    if (w.kind === 'door' && w.isOpen) continue;
    blockingSegments.push({
      ax: w.x1 * stageW,
      ay: w.y1 * stageH,
      bx: w.x2 * stageW,
      by: w.y2 * stageH,
    });
  }

  // Add viewport boundary segments so rays always terminate cleanly
  blockingSegments.push(
    { ax: 0, ay: 0, bx: stageW, by: 0 },
    { ax: stageW, ay: 0, bx: stageW, by: stageH },
    { ax: stageW, ay: stageH, bx: 0, by: stageH },
    { ax: 0, ay: stageH, bx: 0, by: 0 }
  );

  const isCone = Boolean(cone && cone.spreadDeg > 0 && cone.spreadDeg < 355);
  const centerRad = isCone ? (((cone!.facingDeg ?? 0) - 90) * Math.PI) / 180 : 0;
  const halfRad = isCone
    ? (Math.max(15, Math.min(350, cone!.spreadDeg)) * Math.PI) / 360
    : Math.PI;

  const angles: number[] = [];

  if (isCone) {
    // Smooth arc rays across the directional cone from -halfRad to +halfRad
    const steps = Math.max(16, Math.ceil((cone!.spreadDeg / 360) * 72));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      angles.push(centerRad - halfRad + t * halfRad * 2);
    }
  } else {
    // 48 uniform angles for smooth 360-degree circular vision edges
    const uniformSteps = 48;
    for (let i = 0; i < uniformSteps; i++) {
      angles.push((i / uniformSteps) * Math.PI * 2 - Math.PI);
    }
  }

  // Exact corner rays (± epsilon) toward every wall/door endpoint inside vision reach
  const reachSq = (radiusPx * 1.15) ** 2;
  for (const seg of blockingSegments) {
    const pts: Array<[number, number]> = [
      [seg.ax, seg.ay],
      [seg.bx, seg.by],
    ];
    for (const [px, py] of pts) {
      const vx = px - originX;
      const vy = py - originY;
      if (vx * vx + vy * vy > reachSq) continue;
      const baseAngle = Math.atan2(vy, vx);
      if (isCone) {
        const delta = normalizeAngleDelta(baseAngle, centerRad);
        if (Math.abs(delta) > halfRad + 0.002) continue;
        const clampedMinus = Math.max(-halfRad, Math.min(halfRad, delta - 0.00035));
        const clampedCenter = Math.max(-halfRad, Math.min(halfRad, delta));
        const clampedPlus = Math.max(-halfRad, Math.min(halfRad, delta + 0.00035));
        angles.push(
          centerRad + clampedMinus,
          centerRad + clampedCenter,
          centerRad + clampedPlus
        );
      } else {
        angles.push(baseAngle - 0.00035, baseAngle, baseAngle + 0.00035);
      }
    }
  }

  const hits: Array<{ sortKey: number; x: number; y: number }> = [];

  for (const angle of angles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let closest = radiusPx;

    for (const seg of blockingSegments) {
      const dist = raySegmentIntersect(originX, originY, dx, dy, seg);
      if (dist !== null && dist < closest) {
        closest = dist;
      }
    }

    hits.push({
      sortKey: isCone ? normalizeAngleDelta(angle, centerRad) : angle,
      x: originX + dx * closest,
      y: originY + dy * closest,
    });
  }

  hits.sort((a, b) => a.sortKey - b.sortKey);
  if (isCone) {
    return [{ x: originX, y: originY }, ...hits.map((h) => ({ x: h.x, y: h.y }))];
  }
  return hits.map((h) => ({ x: h.x, y: h.y }));
}

export function distancePointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
