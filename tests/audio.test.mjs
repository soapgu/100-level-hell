import assert from "node:assert/strict";
import test from "node:test";
import { createGameAudio, DEATH_CUE } from "../src/game/audio.ts";

class MockParam {
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class MockNode {
  connect(destination) { return destination; }
}

class MockSource extends MockNode {
  stopCalls = 0;
  addEventListener() {}
  start() {}
  stop() { this.stopCalls++; }
}

class MockAudioContext {
  static instances = [];
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  destination = new MockNode();
  sources = [];
  closed = false;

  constructor() { MockAudioContext.instances.push(this); }
  createOscillator() {
    const source = Object.assign(new MockSource(), { frequency: new MockParam(), detune: new MockParam(), type: "sine" });
    this.sources.push(source);
    return source;
  }
  createBufferSource() {
    const source = Object.assign(new MockSource(), { buffer: null });
    this.sources.push(source);
    return source;
  }
  createGain() { return Object.assign(new MockNode(), { gain: new MockParam() }); }
  createBiquadFilter() { return Object.assign(new MockNode(), { frequency: new MockParam(), Q: new MockParam(), type: "lowpass" }); }
  createDynamicsCompressor() {
    return Object.assign(new MockNode(), {
      threshold: new MockParam(), knee: new MockParam(), ratio: new MockParam(), attack: new MockParam(), release: new MockParam(),
    });
  }
  createBuffer(_channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
}

test("death cue is a compact descending low-fi melody", () => {
  assert.equal(DEATH_CUE.duration, 1.15);
  assert.equal(DEATH_CUE.lowPassHz, 3200);
  assert.equal(DEATH_CUE.noiseDuration, 0.08);
  assert.ok(DEATH_CUE.notes.length >= 6);

  for (let index = 1; index < DEATH_CUE.notes.length; index++) {
    assert.ok(DEATH_CUE.notes[index].frequency < DEATH_CUE.notes[index - 1].frequency);
    assert.ok(DEATH_CUE.notes[index].start > DEATH_CUE.notes[index - 1].start);
  }

  const lastNote = DEATH_CUE.notes.at(-1);
  assert.ok(lastNote.start + lastNote.duration <= DEATH_CUE.duration);
  assert.ok(DEATH_CUE.bass.endFrequency < DEATH_CUE.bass.startFrequency);
  assert.ok(DEATH_CUE.bass.duration <= DEATH_CUE.duration);
});

test("death cue layers a prominent formant scream inside the transition", () => {
  const { scream, mix, compressor } = DEATH_CUE;
  assert.ok(scream.start + scream.duration <= DEATH_CUE.duration);
  assert.ok(scream.pitch.peak > scream.pitch.start);
  assert.ok(scream.pitch.end < scream.pitch.start);
  assert.ok(scream.pitch.peakTime > 0 && scream.pitch.peakTime < scream.duration);
  assert.ok(scream.vibrato.frequency >= 7 && scream.vibrato.frequency <= 12);
  assert.ok(scream.vibrato.depth >= 25 && scream.vibrato.depth <= 50);
  assert.equal(scream.formants.length, 3);
  assert.ok(scream.formants[0].startFrequency < scream.formants[1].startFrequency);
  assert.ok(scream.formants[1].startFrequency < scream.formants[2].startFrequency);
  assert.ok(scream.formants.every((formant) => formant.endFrequency < formant.startFrequency));
  assert.ok(mix.screamGain > mix.leadGain * 3);
  assert.ok(mix.screamGain > mix.bassGain * 4);
  assert.ok(compressor.threshold < 0 && compressor.ratio > 1);
});

test("one death playback schedules and disposes one complete source group", () => {
  const originalAudioContext = globalThis.AudioContext;
  MockAudioContext.instances.length = 0;
  globalThis.AudioContext = MockAudioContext;
  try {
    const sound = createGameAudio();
    sound.play("over");
    const context = MockAudioContext.instances[0];
    assert.ok(context);
    assert.equal(context.sources.length, 11);
    assert.ok(context.sources.every((source) => source.stopCalls === 1));
    sound.dispose();
    assert.equal(context.closed, true);
    assert.ok(context.sources.every((source) => source.stopCalls === 2));
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
  }
});
