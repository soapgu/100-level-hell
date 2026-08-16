import assert from "node:assert/strict";
import test from "node:test";
import { DirectionInputController } from "../src/game/input.ts";

test("keyboard and touch sources do not release each other", () => {
  const changes = [];
  const input = new DirectionInputController((direction, pressed) => changes.push([direction, pressed]));
  input.setKeyboard("left", true);
  input.addPointer("left", 10);
  input.setKeyboard("left", false);
  assert.equal(input.isPressed("left"), true);
  assert.deepEqual(changes, [["left", true]]);
  input.removePointer("left", 10);
  assert.equal(input.isPressed("left"), false);
  assert.deepEqual(changes, [["left", true], ["left", false]]);
});

test("multiple pointers remain active until the last pointer is released", () => {
  const changes = [];
  const input = new DirectionInputController((direction, pressed) => changes.push([direction, pressed]));
  input.addPointer("right", 1);
  input.addPointer("right", 2);
  input.removePointer("right", 1);
  assert.equal(input.isPressed("right"), true);
  input.removePointer("right", 2);
  assert.equal(input.isPressed("right"), false);
  assert.deepEqual(changes, [["right", true], ["right", false]]);
});

test("release all clears keyboard and every active pointer", () => {
  const changes = [];
  const input = new DirectionInputController((direction, pressed) => changes.push([direction, pressed]));
  input.setKeyboard("left", true);
  input.addPointer("right", 7);
  input.releaseAll();
  assert.equal(input.isPressed("left"), false);
  assert.equal(input.isPressed("right"), false);
  assert.deepEqual(changes, [["left", true], ["right", true], ["left", false], ["right", false]]);
});
