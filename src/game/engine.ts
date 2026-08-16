export type GameStatus = "ready" | "running" | "paused" | "dying" | "gameover";
export type PlatformType = "normal" | "spike" | "belt-left" | "belt-right" | "spring" | "fragile";
export type PlatformWeights = readonly [normal: number, fragile: number, spike: number, beltLeft: number, beltRight: number, spring: number];

export interface PlatformGenerationState {
  lastSpringFloor: number;
}

export interface Platform { id: number; x: number; y: number; width: number; type: PlatformType; broken: boolean; crumble: number; springTime: number; beltTime: number; }
export interface GameSnapshot { status: GameStatus; life: number; floor: number; best: number; reason: "fell" | "life" | null; }

export const CONFIG = {
  width: 420,
  height: 640,
  step: 1 / 60,
  gravity: 650,
  moveSpeed: 168,
  maxFallSpeed: 310,
  playerWidth: 18,
  playerHeight: 24,
  maxLife: 10,
  spikeDamage: 5,
  heal: 1,
  ceiling: 34,
  platformHeight: 9,
  minPlatformWidth: 62,
  maxPlatformWidth: 104,
  startScroll: 29,
  maxScroll: 55,
  invulnerability: 0.78,
  springVelocity: -380,
  springCompressDuration: 0.1,
  springLaunchDelay: 0.2,
  springRestoreDuration: 0.12,
  springTravel: 5,
  beltSpeed: 84,
  fragileDelay: 0.34,
  deathTransitionDuration: 1.5,
} as const;

export const PLAYER_VISUAL = {
  width: 30,
  height: 32,
  offsetX: -6,
  offsetY: -8,
} as const;

export function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
export function centeredX(width: number) { return Math.floor((CONFIG.width - width) / 2); }
export function springOffsetAt(time: number) {
  if (time <= 0) return 0;
  if (time <= CONFIG.springCompressDuration) return CONFIG.springTravel * time / CONFIG.springCompressDuration;
  if (time <= CONFIG.springLaunchDelay) {
    const progress = (time - CONFIG.springCompressDuration) / (CONFIG.springLaunchDelay - CONFIG.springCompressDuration);
    return CONFIG.springTravel - CONFIG.springTravel * 2 * progress;
  }
  const restoreEnd = CONFIG.springLaunchDelay + CONFIG.springRestoreDuration;
  if (time >= restoreEnd) return 0;
  return -CONFIG.springTravel + CONFIG.springTravel * (time - CONFIG.springLaunchDelay) / CONFIG.springRestoreDuration;
}
export function platformSurfaceY(platform: Pick<Platform, "y" | "type" | "springTime">) {
  return platform.y + (platform.type === "spring" ? springOffsetAt(platform.springTime) : 0);
}
export function beltDirection(type: PlatformType | undefined) {
  return type === "belt-left" ? -1 : type === "belt-right" ? 1 : 0;
}
export function horizontalVelocity(inputDirection: number, platformType?: PlatformType) {
  return clamp(inputDirection, -1, 1) * CONFIG.moveSpeed + beltDirection(platformType) * CONFIG.beltSpeed;
}
export function beltVisualAt(time: number, type: PlatformType) {
  const direction = beltDirection(type);
  const cycle = 20;
  const offset = ((time * 60 * direction) % cycle + cycle) % cycle;
  const step = Math.floor(time / (7 / 60)) % 4;
  return {
    offset,
    highlightIndex: direction < 0 ? 3 - step : step,
  };
}
export function normalPlatformDashes(x: number, width: number) {
  const dashWidth = 9;
  const pitch = 17;
  const edgePadding = 5;
  const innerWidth = Math.max(dashWidth, width - edgePadding * 2);
  const count = Math.max(1, Math.floor((innerWidth + pitch - dashWidth) / pitch));
  const patternWidth = (count - 1) * pitch + dashWidth;
  const start = x + (width - patternWidth) / 2;
  return Array.from({ length: count }, (_, index) => start + index * pitch);
}
export function spikePlatformTeeth(x: number, width: number) {
  const toothWidth = 8;
  const pitch = 12;
  const edgePadding = 5;
  const innerWidth = Math.max(toothWidth, width - edgePadding * 2);
  const count = Math.max(1, Math.floor((innerWidth + pitch - toothWidth) / pitch));
  const patternWidth = (count - 1) * pitch + toothWidth;
  const start = x + (width - patternWidth) / 2;
  return Array.from({ length: count }, (_, index) => start + index * pitch);
}
export function healLife(life: number) { return Math.min(CONFIG.maxLife, life + CONFIG.heal); }
export function damageLife(life: number) { return Math.max(0, life - CONFIG.spikeDamage); }
export function nextFloor(current: number, platformId: number) { return Math.max(current, platformId); }
export function isGameOver(life: number, playerY: number) { return life <= 0 || playerY > CONFIG.height + 20; }
export function crossedPlatform(previousBottom: number, nextBottom: number, playerLeft: number, playerRight: number, platform: Pick<Platform, "x" | "y" | "width" | "broken">, scroll: number) {
  return !platform.broken && playerRight - 3 > platform.x && playerLeft + 3 < platform.x + platform.width && previousBottom <= platform.y + scroll + 2 && nextBottom >= platform.y;
}
export function difficultyAt(floor: number) {
  const progress = clamp(floor / 180, 0, 1);
  return {
    scrollSpeed: CONFIG.startScroll + (CONFIG.maxScroll - CONFIG.startScroll) * progress,
    gap: 94 + progress * 28,
  };
}

const PLATFORM_TYPES: readonly PlatformType[] = ["normal", "fragile", "spike", "belt-left", "belt-right", "spring"];
const SPIKE_WEIGHT_MULTIPLIER = 1.5;
const WEIGHT_ANCHORS: readonly { floor: number; weights: PlatformWeights }[] = [
  { floor: 1, weights: [10, 3, 1, 1, 1, 2] },
  { floor: 5, weights: [10, 3, 1, 1, 1, 2] },
  { floor: 20, weights: [7, 3, 1, 1, 1, 2] },
  { floor: 55, weights: [5, 4, 2, 2, 2, 3] },
  { floor: 89, weights: [3, 5, 3, 3, 3, 3] },
  { floor: 100, weights: [2, 6, 4, 4, 4, 4] },
];

export function weightsAt(floor: number): PlatformWeights {
  const cappedFloor = clamp(Math.floor(floor), 1, 100);
  const upperIndex = WEIGHT_ANCHORS.findIndex((anchor) => anchor.floor >= cappedFloor);
  const upper = WEIGHT_ANCHORS[upperIndex];
  if (upper.floor === cappedFloor || upperIndex === 0) return [...upper.weights] as PlatformWeights;

  const lower = WEIGHT_ANCHORS[upperIndex - 1];
  const progress = (cappedFloor - lower.floor) / (upper.floor - lower.floor);
  return lower.weights.map((weight, index) => Math.round(weight + (upper.weights[index] - weight) * progress)) as unknown as PlatformWeights;
}

export function gameplayWeightsAt(floor: number): PlatformWeights {
  const weights = [...weightsAt(floor)] as [number, number, number, number, number, number];
  weights[2] = Math.round(weights[2] * SPIKE_WEIGHT_MULTIPLIER);
  return weights;
}

export function weightedPlatformType(weights: PlatformWeights, roll: number): PlatformType {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = clamp(roll, 0, 1 - Number.EPSILON) * total;
  let cumulative = 0;
  for (let index = 0; index < weights.length; index++) {
    cumulative += weights[index];
    if (target < cumulative) return PLATFORM_TYPES[index];
  }
  return "spring";
}

export function platformTypeFor(floor: number, roll: number, state: PlatformGenerationState): PlatformType {
  if (floor < 3) return "normal";
  if (floor === 4) return "spring";
  if (floor % 7 === 0) return "normal";
  if (floor - state.lastSpringFloor >= 12) return "spring";
  return weightedPlatformType(gameplayWeightsAt(floor), roll);
}

export function advanceGenerationState(state: PlatformGenerationState, floor: number, type: PlatformType): PlatformGenerationState {
  return {
    lastSpringFloor: type === "spring" ? floor : state.lastSpringFloor,
  };
}

export function reachablePlatformX(previousX: number, width: number, roll: number) {
  const maxShift = 112;
  const x = previousX + (roll * 2 - 1) * maxShift;
  return clamp(x, 12, CONFIG.width - width - 12);
}

export type SoundEvent = "land" | "belt" | "hurt" | "spring" | "break" | "over";

export class ShaftEngine {
  private ctx: CanvasRenderingContext2D;
  private random: () => number;
  private onChange: (snapshot: GameSnapshot) => void;
  private onSound: (event: SoundEvent) => void;
  private accumulator = 0;
  private lastTime = 0;
  private notifyClock = 0;
  private deathClock = 0;
  private platformId = 0;
  private generationState: PlatformGenerationState = { lastSpringFloor: 0 };
  private keys = { left: false, right: false };
  private player = { x: centeredX(CONFIG.playerWidth), y: 118, vy: 0, invulnerable: 0, facing: 1, landedOn: -1 };
  private platforms: Platform[] = [];
  private snapshot: GameSnapshot;

  constructor(canvas: HTMLCanvasElement, best: number, onChange: (snapshot: GameSnapshot) => void, onSound: (event: SoundEvent) => void, random = Math.random) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    this.ctx = context;
    this.random = random;
    this.onChange = onChange;
    this.onSound = onSound;
    this.snapshot = { status: "ready", life: CONFIG.maxLife, floor: 0, best, reason: null };
    this.resetWorld();
    this.render();
  }

  getSnapshot() { return { ...this.snapshot }; }
  getPlatforms() { return this.platforms.map((platform) => ({ ...platform })); }

  private resetWorld() {
    this.platformId = 0;
    this.generationState = { lastSpringFloor: 0 };
    this.deathClock = 0;
    this.player = { x: centeredX(CONFIG.playerWidth), y: 118, vy: 0, invulnerable: 0, facing: 1, landedOn: 0 };
    this.platforms = [];
    const seed = [150, 262, 374, 486, 598, 710];
    let previousX = centeredX(96);
    seed.forEach((y, index) => {
      const width = index === 0 ? 96 : 76 + Math.floor(this.random() * 24);
      const x = index === 0 ? centeredX(width) : reachablePlatformX(previousX, width, this.random());
      const type = platformTypeFor(index, this.random(), this.generationState);
      this.platforms.push({ id: this.platformId++, x, y, width, type, broken: false, crumble: 0, springTime: 0, beltTime: 0 });
      previousX = x;
      this.generationState = advanceGenerationState(this.generationState, index, type);
    });
  }

  start() {
    if (this.snapshot.status === "dying") return;
    if (this.snapshot.status === "ready" || this.snapshot.status === "gameover") {
      const best = this.snapshot.best;
      this.snapshot = { status: "running", life: CONFIG.maxLife, floor: 0, best, reason: null };
      this.resetWorld();
      this.accumulator = 0;
      this.lastTime = 0;
    } else if (this.snapshot.status === "paused") this.snapshot.status = "running";
    this.emit();
  }

  togglePause() {
    if (this.snapshot.status === "running") this.snapshot.status = "paused";
    else if (this.snapshot.status === "paused") this.snapshot.status = "running";
    else return;
    this.lastTime = 0;
    this.emit();
  }

  setKey(direction: "left" | "right", pressed: boolean) { this.keys[direction] = pressed; }

  frame(time: number) {
    if (!this.lastTime) this.lastTime = time;
    const elapsed = Math.max(0, (time - this.lastTime) / 1000);
    const delta = Math.min(elapsed, 0.1);
    this.lastTime = time;
    if (this.snapshot.status === "running") {
      this.accumulator += delta;
      while (this.accumulator >= CONFIG.step) {
        this.update(CONFIG.step);
        this.accumulator -= CONFIG.step;
      }
    } else if (this.snapshot.status === "dying") {
      this.advanceDeathTransition(elapsed);
    }
    this.render();
  }

  /** Deterministic entry point used by unit tests. */
  advance(seconds: number) {
    if (this.snapshot.status === "dying") {
      this.advanceDeathTransition(Math.max(0, seconds));
      this.render();
      return;
    }
    const steps = Math.floor(seconds / CONFIG.step);
    for (let i = 0; i < steps && this.snapshot.status === "running"; i++) this.update(CONFIG.step);
    this.render();
  }

  private update(dt: number) {
    const difficulty = difficultyAt(this.snapshot.floor);
    const scroll = difficulty.scrollSpeed * dt;
    this.player.invulnerable = Math.max(0, this.player.invulnerable - dt);
    const inputDirection = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const standingPlatform = this.platforms.find((platform) => platform.id === this.player.landedOn);
    this.player.x += horizontalVelocity(inputDirection, standingPlatform?.type) * dt;
    if (this.keys.right) this.player.facing = 1;
    if (this.keys.left) this.player.facing = -1;
    this.player.x = clamp(this.player.x, 7, CONFIG.width - CONFIG.playerWidth - 7);

    const previousLanding = this.player.landedOn;
    const heldSpring = this.platforms.find((platform) => platform.id === previousLanding && platform.type === "spring" && platform.springTime > 0 && platform.springTime < CONFIG.springLaunchDelay);
    const previousY = this.player.y;
    const previousBottom = previousY + CONFIG.playerHeight;
    if (heldSpring) {
      this.player.vy = 0;
    } else {
      this.player.vy = Math.min(CONFIG.maxFallSpeed, this.player.vy + CONFIG.gravity * dt);
      this.player.y += this.player.vy * dt;
      this.player.landedOn = -1;
    }

    for (const platform of this.platforms) platform.y -= scroll;

    const springCycleDuration = CONFIG.springLaunchDelay + CONFIG.springRestoreDuration;
    for (const platform of this.platforms) {
      if (platform.type === "spring" && platform.springTime > 0) {
        platform.springTime += dt;
        if (platform.springTime >= springCycleDuration) platform.springTime = 0;
      }
      if (platform.type === "belt-left" || platform.type === "belt-right") {
        platform.beltTime = (platform.beltTime + dt) % 60;
      }
    }

    if (heldSpring) {
      this.player.y = platformSurfaceY(heldSpring) - CONFIG.playerHeight;
      if (heldSpring.springTime >= CONFIG.springLaunchDelay) {
        this.player.vy = CONFIG.springVelocity;
        this.player.landedOn = -1;
      } else {
        this.player.landedOn = heldSpring.id;
      }
    } else if (this.player.vy >= 0) {
      const candidates = this.platforms
        .filter((platform) => crossedPlatform(previousBottom, this.player.y + CONFIG.playerHeight, this.player.x, this.player.x + CONFIG.playerWidth, { ...platform, y: platformSurfaceY(platform) }, scroll))
        .sort((a, b) => platformSurfaceY(a) - platformSurfaceY(b));
      const landed = candidates[0];
      if (landed) this.land(landed, previousLanding);
    }

    for (const platform of this.platforms) {
      if (platform.type === "fragile" && platform.crumble > 0 && !platform.broken) {
        platform.crumble += dt;
        if (platform.crumble >= CONFIG.fragileDelay) { platform.broken = true; this.onSound("break"); }
      }
    }

    if (this.player.y < CONFIG.ceiling) {
      this.player.y = CONFIG.ceiling;
      this.player.vy = 86;
      this.hurt();
    }
    if (this.player.y > CONFIG.height + 20) this.gameOver("fell");
    if (this.snapshot.life <= 0) this.gameOver("life");
    if (this.snapshot.status === "dying") return;

    this.platforms = this.platforms.filter((platform) => platform.y > -24);
    this.generatePlatforms();
    this.notifyClock += dt;
    if (this.notifyClock >= 0.1) { this.notifyClock = 0; this.emit(); }
  }

  private land(platform: Platform, previousLanding: number) {
    this.player.y = platformSurfaceY(platform) - CONFIG.playerHeight;
    this.player.landedOn = platform.id;
    this.snapshot.floor = nextFloor(this.snapshot.floor, platform.id);
    if (platform.type === "spike") {
      this.player.vy = 42;
      this.hurt();
    } else if (platform.type === "spring") {
      this.player.vy = 0;
      if (platform.springTime === 0) {
        platform.springTime = Number.EPSILON;
        this.onSound("spring");
      }
    } else {
      this.player.vy = 0;
      if (platform.type === "fragile" && platform.crumble === 0) platform.crumble = 0.001;
      if (previousLanding !== platform.id) {
        if (this.snapshot.life < CONFIG.maxLife) this.snapshot.life = healLife(this.snapshot.life);
        this.onSound(platform.type === "belt-left" || platform.type === "belt-right" ? "belt" : "land");
      }
    }
  }

  private hurt() {
    if (this.player.invulnerable > 0) return;
    this.snapshot.life = damageLife(this.snapshot.life);
    this.player.invulnerable = CONFIG.invulnerability;
    this.onSound("hurt");
  }

  private gameOver(reason: "fell" | "life") {
    if (this.snapshot.status !== "running") return;
    this.snapshot.status = "dying";
    this.snapshot.reason = reason;
    this.snapshot.best = Math.max(this.snapshot.best, this.snapshot.floor);
    this.deathClock = 0;
    this.keys = { left: false, right: false };
    this.onSound("over");
    this.emit();
  }

  private advanceDeathTransition(seconds: number) {
    if (this.snapshot.status !== "dying") return;
    this.deathClock += seconds;
    if (this.deathClock < CONFIG.deathTransitionDuration) return;
    this.deathClock = CONFIG.deathTransitionDuration;
    this.snapshot.status = "gameover";
    this.emit();
  }

  private generatePlatforms() {
    let lowest = this.platforms.reduce((result, platform) => platform.y > result.y ? platform : result, this.platforms[0]);
    while (lowest && lowest.y < CONFIG.height + 110) {
      const floor = this.platformId;
      const { gap } = difficultyAt(floor);
      const width = Math.floor(CONFIG.minPlatformWidth + this.random() * (CONFIG.maxPlatformWidth - CONFIG.minPlatformWidth));
      const x = reachablePlatformX(lowest.x, width, this.random());
      const type = platformTypeFor(floor, this.random(), this.generationState);
      const next: Platform = { id: this.platformId++, x, y: lowest.y + gap + (this.random() - 0.5) * 16, width, type, broken: false, crumble: 0, springTime: 0, beltTime: 0 };
      this.platforms.push(next);
      this.generationState = advanceGenerationState(this.generationState, floor, type);
      lowest = next;
    }
  }

  private emit() { this.onChange({ ...this.snapshot }); }

  private render() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#050504";
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
    this.drawShaft(ctx);
    for (const platform of this.platforms) if (!platform.broken) this.drawPlatform(ctx, platform);
    this.drawPlayer(ctx);
    this.drawCeiling(ctx);
  }

  private drawShaft(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#160d0a";
    ctx.fillRect(0, 0, 18, CONFIG.height);
    ctx.fillRect(CONFIG.width - 18, 0, 18, CONFIG.height);
    ctx.fillStyle = "#5d2418";
    for (let y = -8; y < CONFIG.height; y += 22) {
      const offset = ((Math.floor(y / 22) & 1) * 8);
      for (let x = -offset; x < 18; x += 16) ctx.fillRect(x, y, 13, 8);
      for (let x = CONFIG.width - 18 - offset; x < CONFIG.width; x += 16) ctx.fillRect(x, y, 13, 8);
    }
    ctx.fillStyle = "#17140f";
    for (let i = 0; i < 13; i++) {
      const y = (i * 59 + this.snapshot.floor * 7) % CONFIG.height;
      ctx.fillRect(38 + ((i * 73) % (CONFIG.width - 90)), y, 14 + (i % 3) * 8, 3);
    }
  }

  private drawPlatform(ctx: CanvasRenderingContext2D, platform: Platform) {
    const { x, y, width } = platform;
    if (platform.type === "spring") {
      const top = platformSurfaceY(platform);
      const base = y + 20;
      ctx.save();
      ctx.fillStyle = "#d8ffff";
      ctx.fillRect(Math.round(x), Math.round(top), width, 2);
      ctx.fillStyle = "#52c7c9";
      ctx.fillRect(Math.round(x), Math.round(top + 2), width, 4);
      ctx.fillStyle = "#21666a";
      ctx.fillRect(Math.round(x), Math.round(top + 6), width, 2);

      ctx.strokeStyle = "#aeb8ae";
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 3]);
      for (const ratio of [0.25, 0.5, 0.75]) {
        const column = Math.round(x + width * ratio);
        ctx.beginPath();
        ctx.moveTo(column, Math.round(top + 8));
        ctx.lineTo(column, Math.round(base));
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.fillStyle = "#8a7d68";
      ctx.fillRect(Math.round(x), Math.round(base), width, 4);
      ctx.fillStyle = "#4f4638";
      ctx.fillRect(Math.round(x), Math.round(base + 4), width, 3);
      ctx.restore();
      return;
    }

    if (platform.type === "belt-left" || platform.type === "belt-right") {
      const direction = beltDirection(platform.type);
      const visual = beltVisualAt(platform.beltTime, platform.type);
      const left = x + 9;
      const right = x + width - 9;
      ctx.save();
      ctx.fillStyle = "#21170a";
      ctx.fillRect(Math.round(x), Math.round(y), width, 12);
      ctx.fillStyle = "#e9aa22";
      ctx.fillRect(Math.round(x + 3), Math.round(y + 1), width - 6, 10);
      ctx.fillStyle = "#17120e";
      ctx.fillRect(Math.round(left), Math.round(y + 3), Math.max(0, width - 18), 6);

      ctx.fillStyle = "#f2dfb5";
      for (let position = left - 20 + visual.offset; position < right; position += 20) {
        const segmentLeft = clamp(position, left, right);
        const segmentRight = clamp(position + 10, left, right);
        if (segmentRight > segmentLeft) {
          ctx.fillRect(Math.round(segmentLeft), Math.round(y + 1), Math.ceil(segmentRight - segmentLeft), 2);
          ctx.fillRect(Math.round(segmentLeft), Math.round(y + 9), Math.ceil(segmentRight - segmentLeft), 2);
        }
      }

      for (let index = 0; index < 4; index++) {
        const center = x + width * (0.28 + index * 0.147);
        const point = center + direction * 4;
        ctx.fillStyle = index === visual.highlightIndex ? "#f2dfb5" : "#b87a17";
        ctx.beginPath();
        ctx.moveTo(center - direction * 3, y + 4);
        ctx.lineTo(point, y + 6);
        ctx.lineTo(center - direction * 3, y + 8);
        ctx.fill();
      }

      for (const center of [x + 6, x + width - 6]) {
        ctx.fillStyle = "#f2dfb5";
        ctx.beginPath();
        ctx.arc(center, y + 6, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#5d4013";
        ctx.beginPath();
        ctx.arc(center, y + 6, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    const colors: Record<PlatformType, string> = { normal: "#e2cda3", spike: "#8f321d", "belt-left": "#e9aa22", "belt-right": "#e9aa22", spring: "#52c7c9", fragile: "#b59156" };
    ctx.fillStyle = colors[platform.type];
    ctx.fillRect(Math.round(x), Math.round(y), width, CONFIG.platformHeight);
    ctx.fillStyle = "#4f4638";
    ctx.fillRect(Math.round(x), Math.round(y + CONFIG.platformHeight), width, 4);
    if (platform.type === "normal") {
      ctx.fillStyle = "#8a7d68";
      for (const px of normalPlatformDashes(x, width)) ctx.fillRect(Math.round(px), Math.round(y + 2), 9, 2);
    } else if (platform.type === "spike") {
      ctx.fillStyle = "#f2dfb5";
      for (const px of spikePlatformTeeth(x, width)) {
        ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + 4, y - 10); ctx.lineTo(px + 8, y); ctx.fill();
      }
    } else if (platform.type === "fragile") {
      ctx.strokeStyle = "#392617"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + width * .45, y); ctx.lineTo(x + width * .52, y + 4); ctx.lineTo(x + width * .46, y + 9); ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    if (this.player.invulnerable > 0 && Math.floor(this.player.invulnerable * 16) % 2 === 0) return;
    const x = Math.round(this.player.x + PLAYER_VISUAL.offsetX);
    const y = Math.round(this.player.y + PLAYER_VISUAL.offsetY);
    const standing = this.player.landedOn >= 0 && Math.abs(this.player.vy) < 1;
    const paint = (color: string, rectangles: readonly (readonly [number, number, number, number])[]) => {
      ctx.fillStyle = color;
      for (const [px, py, width, height] of rectangles) ctx.fillRect(px, py, width, height);
    };

    ctx.save();
    if (this.player.facing < 0) {
      ctx.translate(x + PLAYER_VISUAL.width, y);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(x, y);
    }

    // Limbs are drawn first so the body keeps a strong, readable outline.
    if (standing) {
      paint("#21120c", [[2, 21, 7, 8], [22, 21, 6, 8], [7, 27, 8, 5], [17, 27, 8, 5]]);
      paint("#e85d1c", [[4, 22, 5, 5], [22, 22, 4, 5], [9, 27, 5, 3], [18, 27, 5, 3]]);
      paint("#f2b35f", [[3, 27, 5, 3], [25, 27, 4, 3]]);
      paint("#4a2417", [[7, 30, 8, 2], [17, 30, 8, 2]]);
    } else {
      paint("#21120c", [[2, 21, 8, 7], [21, 15, 6, 11], [24, 11, 5, 7], [7, 26, 8, 6], [17, 26, 10, 5]]);
      paint("#e85d1c", [[4, 22, 6, 4], [21, 17, 4, 8], [9, 26, 5, 4], [18, 26, 7, 3]]);
      paint("#f2b35f", [[2, 26, 5, 4], [25, 12, 4, 5]]);
      paint("#4a2417", [[8, 30, 7, 2], [23, 28, 5, 3]]);
    }

    // Torso, work jacket and belt.
    paint("#21120c", [[7, 20, 17, 9]]);
    paint("#e85d1c", [[9, 21, 13, 6]]);
    paint("#f28a22", [[10, 21, 5, 4]]);
    paint("#7c321b", [[9, 26, 13, 3]]);
    paint("#e9aa22", [[15, 26, 3, 3]]);

    // Square face with sideburns and a prominent helmet brim.
    paint("#21120c", [[6, 8, 19, 14], [4, 9, 23, 4]]);
    paint("#f2b35f", [[8, 11, 15, 9], [6, 13, 3, 5]]);
    paint("#f2dfb5", [[9, 11, 12, 3]]);
    paint("#7c321b", [[8, 18, 4, 3], [20, 14, 3, 6]]);
    paint("#17120e", [[11, 14, 3, 3], [18, 14, 3, 3], [14, 18, 6, 2]]);
    paint("#f2dfb5", [[15, 17, 3, 2]]);

    // Hard hat, lamp and warm highlights echo the poster artwork.
    paint("#21120c", [[7, 2, 16, 2], [4, 4, 21, 7], [2, 9, 25, 4], [18, 0, 8, 8]]);
    paint("#e85d1c", [[8, 2, 10, 2], [6, 4, 17, 5], [4, 9, 21, 2]]);
    paint("#f28a22", [[8, 4, 10, 3], [6, 8, 18, 2]]);
    paint("#f2dfb5", [[20, 1, 5, 5]]);
    paint("#52c7c9", [[21, 2, 3, 3]]);
    paint("#17120e", [[19, 6, 7, 2]]);

    ctx.restore();
  }

  private drawCeiling(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#342d25"; ctx.fillRect(0, 0, CONFIG.width, 10);
    ctx.fillStyle = "#f2dfb5";
    for (let x = 20; x < CONFIG.width - 14; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x + 8, 31); ctx.lineTo(x + 16, 10); ctx.fill();
    }
  }
}
