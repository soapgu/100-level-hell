export type GameStatus = "ready" | "running" | "paused" | "gameover";
export type PlatformType = "normal" | "spike" | "belt-left" | "belt-right" | "spring" | "fragile";
export type PlatformWeights = readonly [normal: number, fragile: number, spike: number, beltLeft: number, beltRight: number, spring: number];

export interface PlatformGenerationState {
  lastSpringFloor: number;
}

export interface Platform { id: number; x: number; y: number; width: number; type: PlatformType; broken: boolean; crumble: number; }
export interface GameSnapshot { status: GameStatus; life: number; floor: number; best: number; reason: "fell" | "life" | null; }

export const CONFIG = {
  width: 360,
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
  springVelocity: -238,
  beltSpeed: 42,
  fragileDelay: 0.34,
} as const;

export function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
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

export type SoundEvent = "land" | "hurt" | "spring" | "break" | "over";

export class ShaftEngine {
  private ctx: CanvasRenderingContext2D;
  private random: () => number;
  private onChange: (snapshot: GameSnapshot) => void;
  private onSound: (event: SoundEvent) => void;
  private accumulator = 0;
  private lastTime = 0;
  private notifyClock = 0;
  private platformId = 0;
  private generationState: PlatformGenerationState = { lastSpringFloor: 0 };
  private keys = { left: false, right: false };
  private player = { x: 171, y: 118, vy: 0, invulnerable: 0, facing: 1, landedOn: -1 };
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
    this.player = { x: 171, y: 118, vy: 0, invulnerable: 0, facing: 1, landedOn: 0 };
    this.platforms = [];
    const seed = [150, 262, 374, 486, 598, 710];
    let previousX = 132;
    seed.forEach((y, index) => {
      const width = index === 0 ? 96 : 76 + Math.floor(this.random() * 24);
      const x = index === 0 ? 132 : reachablePlatformX(previousX, width, this.random());
      const type = platformTypeFor(index, this.random(), this.generationState);
      this.platforms.push({ id: this.platformId++, x, y, width, type, broken: false, crumble: 0 });
      previousX = x;
      this.generationState = advanceGenerationState(this.generationState, index, type);
    });
  }

  start() {
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
    this.lastTime = 0;
    this.emit();
  }

  setKey(direction: "left" | "right", pressed: boolean) { this.keys[direction] = pressed; }

  frame(time: number) {
    if (!this.lastTime) this.lastTime = time;
    const delta = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    if (this.snapshot.status === "running") {
      this.accumulator += delta;
      while (this.accumulator >= CONFIG.step) {
        this.update(CONFIG.step);
        this.accumulator -= CONFIG.step;
      }
    }
    this.render();
  }

  /** Deterministic entry point used by unit tests. */
  advance(seconds: number) {
    const steps = Math.floor(seconds / CONFIG.step);
    for (let i = 0; i < steps && this.snapshot.status === "running"; i++) this.update(CONFIG.step);
    this.render();
  }

  private update(dt: number) {
    const difficulty = difficultyAt(this.snapshot.floor);
    const scroll = difficulty.scrollSpeed * dt;
    this.player.invulnerable = Math.max(0, this.player.invulnerable - dt);
    this.player.x += ((this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)) * CONFIG.moveSpeed * dt;
    if (this.keys.right) this.player.facing = 1;
    if (this.keys.left) this.player.facing = -1;
    this.player.x = clamp(this.player.x, 7, CONFIG.width - CONFIG.playerWidth - 7);

    const previousY = this.player.y;
    const previousBottom = previousY + CONFIG.playerHeight;
    this.player.vy = Math.min(CONFIG.maxFallSpeed, this.player.vy + CONFIG.gravity * dt);
    this.player.y += this.player.vy * dt;
    const previousLanding = this.player.landedOn;
    this.player.landedOn = -1;

    for (const platform of this.platforms) platform.y -= scroll;

    if (this.player.vy >= 0) {
      const candidates = this.platforms
        .filter((platform) => crossedPlatform(previousBottom, this.player.y + CONFIG.playerHeight, this.player.x, this.player.x + CONFIG.playerWidth, platform, scroll))
        .sort((a, b) => a.y - b.y);
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

    this.platforms = this.platforms.filter((platform) => platform.y > -24);
    this.generatePlatforms();
    this.notifyClock += dt;
    if (this.notifyClock >= 0.1) { this.notifyClock = 0; this.emit(); }
  }

  private land(platform: Platform, previousLanding: number) {
    this.player.y = platform.y - CONFIG.playerHeight;
    this.player.landedOn = platform.id;
    this.snapshot.floor = nextFloor(this.snapshot.floor, platform.id);
    if (platform.type === "spike") {
      this.player.vy = 42;
      this.hurt();
    } else if (platform.type === "spring") {
      this.player.vy = CONFIG.springVelocity;
      this.onSound("spring");
    } else {
      this.player.vy = 0;
      if (platform.type === "belt-left") this.player.x -= CONFIG.beltSpeed * CONFIG.step;
      if (platform.type === "belt-right") this.player.x += CONFIG.beltSpeed * CONFIG.step;
      if (platform.type === "fragile" && platform.crumble === 0) platform.crumble = 0.001;
      if (previousLanding !== platform.id) {
        if (this.snapshot.life < CONFIG.maxLife) this.snapshot.life = healLife(this.snapshot.life);
        this.onSound("land");
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
    if (this.snapshot.status === "gameover") return;
    this.snapshot.status = "gameover";
    this.snapshot.reason = reason;
    this.snapshot.best = Math.max(this.snapshot.best, this.snapshot.floor);
    this.onSound("over");
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
      const next: Platform = { id: this.platformId++, x, y: lowest.y + gap + (this.random() - 0.5) * 16, width, type, broken: false, crumble: 0 };
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
      ctx.fillRect(38 + ((i * 73) % 270), y, 14 + (i % 3) * 8, 3);
    }
  }

  private drawPlatform(ctx: CanvasRenderingContext2D, platform: Platform) {
    const { x, y, width } = platform;
    const colors: Record<PlatformType, string> = { normal: "#e2cda3", spike: "#8f321d", "belt-left": "#e9aa22", "belt-right": "#e9aa22", spring: "#52c7c9", fragile: "#b59156" };
    ctx.fillStyle = colors[platform.type];
    ctx.fillRect(Math.round(x), Math.round(y), width, CONFIG.platformHeight);
    ctx.fillStyle = "#4f4638";
    ctx.fillRect(Math.round(x), Math.round(y + CONFIG.platformHeight), width, 4);
    if (platform.type === "normal") {
      ctx.fillStyle = "#8a7d68";
      for (let px = x + 5; px < x + width; px += 17) ctx.fillRect(Math.round(px), Math.round(y + 2), 9, 2);
    } else if (platform.type === "spike") {
      ctx.fillStyle = "#f2dfb5";
      for (let px = x + 5; px < x + width - 3; px += 12) {
        ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + 4, y - 10); ctx.lineTo(px + 8, y); ctx.fill();
      }
    } else if (platform.type.startsWith("belt")) {
      ctx.fillStyle = "#5d4013";
      const direction = platform.type === "belt-left" ? -1 : 1;
      for (let px = x + 8; px < x + width - 4; px += 14) {
        ctx.beginPath(); ctx.moveTo(px, y + 2); ctx.lineTo(px + direction * 5, y + 4); ctx.lineTo(px, y + 6); ctx.fill();
      }
    } else if (platform.type === "spring") {
      ctx.strokeStyle = "#d8ffff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + width / 2 - 10, y); ctx.lineTo(x + width / 2 + 7, y - 8); ctx.lineTo(x + width / 2 - 7, y - 16); ctx.lineTo(x + width / 2 + 10, y - 24); ctx.stroke();
    } else if (platform.type === "fragile") {
      ctx.strokeStyle = "#392617"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + width * .45, y); ctx.lineTo(x + width * .52, y + 4); ctx.lineTo(x + width * .46, y + 9); ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    if (this.player.invulnerable > 0 && Math.floor(this.player.invulnerable * 16) % 2 === 0) return;
    const x = Math.round(this.player.x), y = Math.round(this.player.y);
    ctx.fillStyle = "#e85d1c"; ctx.fillRect(x + 3, y, 12, 5); ctx.fillRect(x + 1, y + 4, 16, 3);
    ctx.fillStyle = "#f2dfb5"; ctx.fillRect(x + 4, y + 7, 10, 8);
    ctx.fillStyle = "#17120e"; ctx.fillRect(x + (this.player.facing > 0 ? 11 : 5), y + 9, 2, 2);
    ctx.fillStyle = "#e85d1c"; ctx.fillRect(x + 3, y + 15, 12, 6);
    ctx.fillStyle = "#7c321b"; ctx.fillRect(x + 2, y + 21, 5, 3); ctx.fillRect(x + 11, y + 21, 5, 3);
  }

  private drawCeiling(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#342d25"; ctx.fillRect(0, 0, CONFIG.width, 10);
    ctx.fillStyle = "#f2dfb5";
    for (let x = 20; x < CONFIG.width - 14; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x + 8, 31); ctx.lineTo(x + 16, 10); ctx.fill();
    }
  }
}
