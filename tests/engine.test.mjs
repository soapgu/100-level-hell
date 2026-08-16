import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG, PLAYER_VISUAL, ShaftEngine, advanceGenerationState, beltDirection, beltVisualAt, centeredX, crossedPlatform, damageLife, difficultyAt, gameplayWeightsAt, healLife, horizontalVelocity, isGameOver, nextFloor, normalPlatformDashes, platformSurfaceY, platformTypeFor, reachablePlatformX, spikePlatformTeeth, springOffsetAt, weightedPlatformType, weightsAt } from "../src/game/engine.ts";

function createMockCanvas() {
  const noop = () => {};
  const context = {
    arc: noop,
    beginPath: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    restore: noop,
    save: noop,
    scale: noop,
    setLineDash: noop,
    stroke: noop,
    translate: noop,
  };
  return { getContext: () => context };
}

test("the widened playfield keeps initial game objects centered", () => {
  assert.equal(CONFIG.width, 420);
  assert.equal(CONFIG.height, 640);
  assert.equal(centeredX(CONFIG.playerWidth), 201);
  assert.equal(centeredX(96), 162);
});

test("normal platform dashes stay centered inside every generated width", () => {
  for (let width = CONFIG.minPlatformWidth; width <= CONFIG.maxPlatformWidth; width++) {
    const x = 137;
    const dashes = normalPlatformDashes(x, width);
    assert.ok(dashes.length > 0);
    assert.ok(Math.round(dashes[0]) >= x + 5);
    assert.ok(Math.round(dashes.at(-1)) + 9 <= x + width - 5);
    const leftPadding = dashes[0] - x;
    const rightPadding = x + width - (dashes.at(-1) + 9);
    assert.ok(Math.abs(leftPadding - rightPadding) < 0.001);
  }
});

test("spike teeth stay centered inside every generated platform width", () => {
  for (let width = CONFIG.minPlatformWidth; width <= CONFIG.maxPlatformWidth; width++) {
    const x = 137;
    const teeth = spikePlatformTeeth(x, width);
    assert.ok(teeth.length > 0);
    assert.ok(Math.round(teeth[0]) >= x + 5);
    assert.ok(Math.round(teeth.at(-1)) + 8 <= x + width - 5);
    const leftPadding = teeth[0] - x;
    const rightPadding = x + width - (teeth.at(-1) + 8);
    assert.ok(Math.abs(leftPadding - rightPadding) < 0.001);
  }
});

test("the larger player sprite stays aligned with its unchanged collision box", () => {
  assert.equal(CONFIG.playerWidth, 18);
  assert.equal(CONFIG.playerHeight, 24);
  assert.equal(PLAYER_VISUAL.offsetX + PLAYER_VISUAL.width / 2, CONFIG.playerWidth / 2);
  assert.equal(PLAYER_VISUAL.offsetY + PLAYER_VISUAL.height, CONFIG.playerHeight);

  const leftEdge = 7 + PLAYER_VISUAL.offsetX;
  const rightEdge = CONFIG.width - CONFIG.playerWidth - 7 + PLAYER_VISUAL.offsetX + PLAYER_VISUAL.width;
  assert.ok(leftEdge >= 0);
  assert.ok(rightEdge <= CONFIG.width);
});

test("spring animation offsets drive the same moving collision surface", () => {
  assert.equal(springOffsetAt(0), 0);
  assert.equal(springOffsetAt(0.1), 5);
  assert.equal(springOffsetAt(0.2), -5);
  assert.equal(springOffsetAt(0.32), 0);

  const platform = { y: 200, type: "spring", springTime: 0.1 };
  assert.equal(platformSurfaceY(platform), 205);
  assert.equal(platformSurfaceY({ ...platform, springTime: 0.2 }), 195);
  assert.equal(platformSurfaceY({ ...platform, type: "normal" }), 200);
});

test("spring holds the player, launches once, restores, and can trigger again", () => {
  const sounds = [];
  const engine = new ShaftEngine(createMockCanvas(), 0, () => {}, (sound) => sounds.push(sound), () => 0.5);
  engine.start();
  const spring = { id: 1, x: 150, y: 200, width: 96, type: "spring", broken: false, crumble: 0, springTime: 0, beltTime: 0 };
  engine.platforms = [spring];
  engine.player = { x: 160, y: 175, vy: 100, invulnerable: 0, facing: 1, landedOn: -1 };

  engine.advance(CONFIG.step);
  assert.equal(engine.player.vy, 0);
  assert.equal(engine.player.landedOn, spring.id);
  assert.deepEqual(sounds, ["spring"]);

  engine.advance(0.18);
  assert.equal(engine.player.vy, 0);
  assert.equal(engine.player.landedOn, spring.id);
  engine.advance(0.05);
  assert.ok(engine.player.vy < 0);
  assert.equal(engine.player.landedOn, -1);
  assert.deepEqual(sounds, ["spring"]);

  engine.advance(0.12);
  assert.equal(spring.springTime, 0);
  engine.player = { x: 160, y: spring.y - CONFIG.playerHeight - 1, vy: 100, invulnerable: 0, facing: 1, landedOn: -1 };
  engine.advance(CONFIG.step);
  assert.deepEqual(sounds, ["spring", "spring"]);
});

test("spring launch rises about 110 pixels under current gravity", () => {
  const height = CONFIG.springVelocity ** 2 / (2 * CONFIG.gravity);
  assert.ok(height >= 108 && height <= 113);
});

test("conveyor direction, input combination, and animation follow the same type", () => {
  assert.equal(CONFIG.beltSpeed * 2, CONFIG.moveSpeed);
  assert.equal(beltDirection("belt-left"), -1);
  assert.equal(beltDirection("belt-right"), 1);
  assert.equal(beltDirection("normal"), 0);
  assert.equal(horizontalVelocity(0, "belt-left"), -84);
  assert.equal(horizontalVelocity(0, "belt-right"), 84);
  assert.equal(horizontalVelocity(1, "belt-right"), 252);
  assert.equal(horizontalVelocity(-1, "belt-right"), -84);

  assert.deepEqual(beltVisualAt(0, "belt-right"), { offset: 0, highlightIndex: 0 });
  assert.deepEqual(beltVisualAt(7 / 60, "belt-right"), { offset: 7, highlightIndex: 1 });
  assert.deepEqual(beltVisualAt(7 / 60, "belt-left"), { offset: 13, highlightIndex: 2 });
});

test("conveyor pushes continuously, heals and sounds once, then releases the player", () => {
  const sounds = [];
  const engine = new ShaftEngine(createMockCanvas(), 0, () => {}, (sound) => sounds.push(sound), () => 0.5);
  engine.start();
  const belt = { id: 1, x: 100, y: 200, width: 220, type: "belt-right", broken: false, crumble: 0, springTime: 0, beltTime: 0 };
  engine.platforms = [belt];
  engine.snapshot.life = 9;
  engine.player = { x: 160, y: 175, vy: 100, invulnerable: 0, facing: 1, landedOn: -1 };

  engine.advance(CONFIG.step);
  assert.equal(engine.getSnapshot().life, 10);
  assert.equal(engine.player.landedOn, belt.id);
  assert.deepEqual(sounds, ["belt"]);
  const landedX = engine.player.x;
  engine.advance(0.2);
  assert.ok(engine.player.x - landedX >= 16 && engine.player.x - landedX <= 18);
  assert.deepEqual(sounds, ["belt"]);

  const movingBeltTime = belt.beltTime;
  engine.togglePause();
  engine.advance(1);
  assert.equal(belt.beltTime, movingBeltTime);
  engine.togglePause();

  engine.setKey("left", true);
  const opposingX = engine.player.x;
  engine.advance(0.1);
  assert.ok(engine.player.x - opposingX <= -8 && engine.player.x - opposingX >= -9);
  engine.setKey("left", false);

  engine.player.x = belt.x + belt.width - CONFIG.playerWidth - 4;
  engine.advance(0.25);
  assert.equal(engine.player.landedOn, -1);
  const releasedX = engine.player.x;
  engine.advance(0.1);
  assert.equal(engine.player.x, releasedX);
});

test("normal platforms heal without exceeding max life", () => {
  assert.equal(healLife(4), 5);
  assert.equal(healLife(CONFIG.maxLife), CONFIG.maxLife);
});

test("spikes deal five damage and life never becomes negative", () => {
  assert.equal(damageLife(10), 5);
  assert.equal(damageLife(3), 0);
});

test("collision only resolves while crossing a solid platform from above", () => {
  const platform = { x: 100, y: 200, width: 80, broken: false };
  assert.equal(crossedPlatform(195, 204, 115, 133, platform, 1), true);
  assert.equal(crossedPlatform(205, 210, 115, 133, platform, 1), false);
  assert.equal(crossedPlatform(195, 204, 10, 28, platform, 1), false);
  assert.equal(crossedPlatform(195, 204, 115, 133, { ...platform, broken: true }, 1), false);
});

test("floor count never decreases and death checks both failure modes", () => {
  assert.equal(nextFloor(12, 9), 12);
  assert.equal(nextFloor(12, 13), 13);
  assert.equal(isGameOver(0, 100), true);
  assert.equal(isGameOver(5, CONFIG.height + 21), true);
  assert.equal(isGameOver(5, 300), false);
});

test("falling starts one frozen death transition before showing game over", () => {
  const sounds = [];
  const snapshots = [];
  const engine = new ShaftEngine(createMockCanvas(), 0, (snapshot) => snapshots.push(snapshot), (sound) => sounds.push(sound), () => 0.5);
  engine.start();
  engine.snapshot.floor = 12;
  engine.player.y = CONFIG.height + 21;
  engine.advance(CONFIG.step);

  assert.equal(engine.getSnapshot().status, "dying");
  assert.equal(engine.getSnapshot().reason, "fell");
  assert.equal(engine.getSnapshot().best, 12);
  assert.deepEqual(sounds, ["over"]);
  const frozenPlayer = { ...engine.player };
  const frozenPlatforms = engine.getPlatforms();

  engine.setKey("right", true);
  engine.start();
  engine.togglePause();
  engine.advance(1.49);
  assert.equal(engine.getSnapshot().status, "dying");
  assert.deepEqual(engine.player, frozenPlayer);
  assert.deepEqual(engine.getPlatforms(), frozenPlatforms);
  assert.deepEqual(sounds, ["over"]);

  engine.advance(0.01);
  assert.equal(engine.getSnapshot().status, "gameover");
  assert.equal(snapshots.at(-1).status, "gameover");
});

test("life depletion triggers one death cue and resets for the next game", () => {
  const sounds = [];
  const engine = new ShaftEngine(createMockCanvas(), 0, () => {}, (sound) => sounds.push(sound), () => 0.5);
  engine.start();
  engine.snapshot.life = 0;
  engine.advance(CONFIG.step);
  assert.equal(engine.getSnapshot().status, "dying");
  assert.equal(engine.getSnapshot().reason, "life");
  assert.deepEqual(sounds, ["over"]);

  engine.advance(CONFIG.deathTransitionDuration);
  engine.start();
  assert.equal(engine.getSnapshot().status, "running");
  assert.equal(engine.getSnapshot().reason, null);
  engine.snapshot.life = 0;
  engine.advance(CONFIG.step);
  assert.deepEqual(sounds, ["over", "over"]);
});

test("difficulty rises smoothly but remains capped", () => {
  const start = difficultyAt(0);
  const middle = difficultyAt(90);
  const cap = difficultyAt(999);
  assert.ok(start.scrollSpeed < middle.scrollSpeed && middle.scrollSpeed < cap.scrollSpeed);
  assert.equal(cap.scrollSpeed, CONFIG.maxScroll);
  assert.ok(start.gap < middle.gap && middle.gap < cap.gap);
});

test("early floors are safe and generated x positions stay reachable and on-screen", () => {
  assert.equal(platformTypeFor(2, 0, { lastSpringFloor: 0 }), "normal");
  for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
    const x = reachablePlatformX(150, 80, roll);
    assert.ok(x >= 12 && x <= CONFIG.width - 92);
    assert.ok(Math.abs(x - 150) <= 112);
  }
});

test("anchor weights match the reference curve and cap after floor 100", () => {
  const anchors = new Map([
    [1, [10, 3, 1, 1, 1, 2]],
    [5, [10, 3, 1, 1, 1, 2]],
    [20, [7, 3, 1, 1, 1, 2]],
    [55, [5, 4, 2, 2, 2, 3]],
    [89, [3, 5, 3, 3, 3, 3]],
    [100, [2, 6, 4, 4, 4, 4]],
  ]);
  for (const [floor, expected] of anchors) assert.deepEqual(weightsAt(floor), expected);
  assert.deepEqual(weightsAt(38), [6, 4, 2, 2, 2, 3]);
  assert.deepEqual(weightsAt(0), weightsAt(1));
  assert.deepEqual(weightsAt(120), weightsAt(100));
});

test("weighted sampling covers all six cumulative ranges", () => {
  const weights = weightsAt(1);
  assert.equal(weightedPlatformType(weights, 0), "normal");
  assert.equal(weightedPlatformType(weights, 10 / 18), "fragile");
  assert.equal(weightedPlatformType(weights, 13 / 18), "spike");
  assert.equal(weightedPlatformType(weights, 14 / 18), "belt-left");
  assert.equal(weightedPlatformType(weights, 15 / 18), "belt-right");
  assert.equal(weightedPlatformType(weights, 16 / 18), "spring");
  assert.equal(weightedPlatformType(weights, 1), "spring");
});

test("gameplay weights increase only spikes by one and a half times", () => {
  assert.deepEqual(gameplayWeightsAt(1), [10, 3, 2, 1, 1, 2]);
  assert.deepEqual(gameplayWeightsAt(55), [5, 4, 3, 2, 2, 3]);
  assert.deepEqual(gameplayWeightsAt(89), [3, 5, 5, 3, 3, 3]);
  assert.deepEqual(gameplayWeightsAt(100), [2, 6, 6, 4, 4, 4]);
});

test("generation constraints hold across 1000 deterministic 120-floor runs", () => {
  const seen = new Set();
  let earlySpikes = 0;
  let lateSpikes = 0;
  let consecutiveSpikes = 0;
  for (let run = 1; run <= 1000; run++) {
    let seed = run;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let state = { lastSpringFloor: 0 };
    let previousX = 132;
    let lastSpring = 0;
    let previousType = "normal";
    for (let floor = 0; floor <= 120; floor++) {
      const type = platformTypeFor(floor, random(), state);
      seen.add(type);
      if (floor < 3) assert.equal(type, "normal");
      if (floor === 4) assert.equal(type, "spring");
      if (floor > 0 && floor % 7 === 0) assert.equal(type, "normal");
      if (floor >= 1 && floor <= 20 && type === "spike") earlySpikes++;
      if (floor >= 90 && floor <= 100 && type === "spike") lateSpikes++;
      if (previousType === "spike" && type === "spike") consecutiveSpikes++;
      if (type === "spring") {
        if (lastSpring > 0) assert.ok(floor - lastSpring <= 13);
        lastSpring = floor;
      }

      const width = CONFIG.minPlatformWidth + Math.floor(random() * (CONFIG.maxPlatformWidth - CONFIG.minPlatformWidth));
      const x = reachablePlatformX(previousX, width, random());
      assert.ok(x >= 12 && x <= CONFIG.width - width - 12);
      assert.ok(Math.abs(x - previousX) <= 112);
      previousX = x;
      state = advanceGenerationState(state, floor, type);
      previousType = type;
    }
  }
  assert.deepEqual([...seen].sort(), ["belt-left", "belt-right", "fragile", "normal", "spike", "spring"]);
  assert.ok(consecutiveSpikes > 0);
  assert.ok(earlySpikes / (1000 * 20) > 0.075 && earlySpikes / (1000 * 20) < 0.092);
  assert.ok(lateSpikes / (1000 * 11) > 0.165 && lateSpikes / (1000 * 11) < 0.192);
});
