// How a rolled die moves on the felt, for show only: the roll is already made.
// A die is thrown in from the bottom right, bounces twice as it loses height,
// spins a little less at each hit, then slides to a stop in its own slot. A
// small physics run gives the path, which is then shifted to end in the slot
// and has its spin stretched to whole turns, so the die lands flat on the face
// the game rolled.

/** Where a die is at one moment: px on the felt, px above it, and its spin in degrees about `axis`. */
export interface Pose {
  x: number;
  y: number;
  h: number;
  spin: number;
  /** Turn about the vertical, in degrees, which eases to 0. */
  yaw: number;
  /** The axis of the spin, a unit vector. */
  axis: { x: number; y: number; z: number };
}

export interface Toss {
  /** How long to wait before this die moves, in ms. */
  delay: number;
  /** How long it moves, in ms. */
  dur: number;
  /** The pose `t` ms after it starts to move. It is at rest in its slot from `dur` on. */
  at(t: number): Pose;
}

/** px / s^2: strong, so the toss is quick. */
const GRAVITY = 6400;
/** How much of its speed into the felt a die keeps at a bounce. */
const BOUNCE = 0.32;
const STEP = 1 / 240;
/** At most 1.5 s of motion, which a toss never comes near. */
const MAX_STEPS = 360;

interface Frame {
  x: number;
  y: number;
  h: number;
  spin: number;
}

/**
 * Runs one throw: `vx`, `vy` and `vh` in px/s, `h` in px, `w` the spin in
 * degrees/s. Returns the frames, one per 1/240 s, from the throw to rest.
 */
export function simulate(vx: number, vy: number, h: number, vh: number, w: number): Frame[] {
  let x = 0;
  let y = 0;
  let spin = 0;
  const frames: Frame[] = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    frames.push({ x, y, h, spin });
    vh -= GRAVITY * STEP;
    h += vh * STEP;
    if (h <= 0) {
      h = 0;
      const hit = -vh;
      if (hit > 120) {
        // A bounce: up again with less speed, and less slide and spin.
        vh = hit * BOUNCE;
        vx *= 0.72;
        vy *= 0.72;
        w *= 0.6;
      } else vh = 0;
    }
    if (h === 0 && vh === 0) {
      // On the felt: it slides and spins to a stop.
      const k = Math.exp(-24 * STEP);
      vx *= k;
      vy *= k;
      w *= Math.exp(-22 * STEP);
    }
    x += vx * STEP;
    y += vy * STEP;
    spin += w * STEP;
    if (h === 0 && vh === 0 && Math.hypot(vx, vy) < 6 && Math.abs(w) < 30) break;
  }
  frames.push({ x, y, h: 0, spin });
  return frames;
}

const ease = (p: number) => 1 - (1 - p) ** 3;

/** The toss of the `n`th die that moves in a roll, from random numbers in [0, 1). */
export function toss(n: number, rand: () => number = Math.random): Toss {
  const between = (a: number, b: number) => a + rand() * (b - a);
  const frames = simulate(
    -between(340, 440),
    -between(220, 300),
    between(26, 38),
    between(200, 280),
    between(1500, 2000) * (rand() < 0.5 ? -1 : 1),
  );
  const end = frames.at(-1)!;
  // Whole turns, so the die ends as it started: flat, on its rolled face.
  const turns = Math.sign(end.spin || 1) * Math.max(360, Math.round(Math.abs(end.spin) / 360) * 360);
  const stretch = end.spin ? turns / end.spin : 0;
  const path = frames.map((f) => ({
    x: f.x - end.x,
    y: f.y - end.y,
    h: f.h,
    spin: f.spin * stretch - turns,
  }));
  const dur = (path.length - 1) * STEP * 1000;
  const axis = unit(between(-1, 1), between(-1, 1), between(-0.3, 0.3));
  const yaw = between(-70, 70);
  return {
    delay: n * between(10, 22),
    dur,
    at(t) {
      const i = Math.max(0, Math.min(path.length - 1, (t / dur) * (path.length - 1)));
      const a = path[Math.floor(i)]!;
      const b = path[Math.ceil(i)]!;
      const f = i - Math.floor(i);
      const mix = (p: number, q: number) => p + (q - p) * f;
      return {
        x: mix(a.x, b.x),
        y: mix(a.y, b.y),
        h: mix(a.h, b.h),
        spin: mix(a.spin, b.spin),
        yaw: yaw * (1 - ease(Math.min(1, t / dur))),
        axis,
      };
    },
  };
}

function unit(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
