import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG, advanceGenerationState, crossedPlatform, damageLife, difficultyAt, gameplayWeightsAt, healLife, isGameOver, nextFloor, platformTypeFor, reachablePlatformX, weightedPlatformType, weightsAt } from "../src/game/engine.ts";

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
