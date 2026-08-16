import type { SoundEvent } from "./engine";

export const DEATH_CUE = {
  duration: 1.15,
  lowPassHz: 3200,
  mix: {
    leadGain: 0.022,
    bassGain: 0.016,
    impactGain: 0.012,
    screamGain: 0.085,
    breathGain: 0.03,
  },
  compressor: {
    threshold: -18,
    knee: 12,
    ratio: 4,
    attack: 0.003,
    release: 0.18,
  },
  notes: [
    { frequency: 659.25, start: 0, duration: 0.18 },
    { frequency: 587.33, start: 0.16, duration: 0.18 },
    { frequency: 523.25, start: 0.32, duration: 0.18 },
    { frequency: 440, start: 0.48, duration: 0.2 },
    { frequency: 349.23, start: 0.66, duration: 0.2 },
    { frequency: 261.63, start: 0.84, duration: 0.28 },
  ],
  bass: { startFrequency: 164.81, endFrequency: 65.41, duration: 1.12 },
  noiseDuration: 0.08,
  scream: {
    start: 0.03,
    duration: 0.92,
    pitch: { start: 430, peak: 620, peakTime: 0.08, end: 210 },
    vibrato: { frequency: 9, depth: 38 },
    formants: [
      { startFrequency: 850, endFrequency: 600, q: 7, gain: 1 },
      { startFrequency: 1400, endFrequency: 1050, q: 8, gain: 0.72 },
      { startFrequency: 2800, endFrequency: 2300, q: 9, gain: 0.42 },
    ],
    breathFrequency: 1300,
  },
} as const;

const SIMPLE_SOUNDS = {
  land: { frequency: 150, duration: 0.06, type: "sawtooth" },
  belt: { frequency: 260, duration: 0.08, type: "square" },
  hurt: { frequency: 90, duration: 0.12, type: "sawtooth" },
  spring: { frequency: 520, duration: 0.1, type: "square" },
  break: { frequency: 155, duration: 0.07, type: "sawtooth" },
} as const;

export function createGameAudio() {
  let context: AudioContext | null = null;
  const activeSources = new Set<AudioScheduledSourceNode>();

  const audioContext = () => {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  };

  const track = (source: AudioScheduledSourceNode) => {
    activeSources.add(source);
    source.addEventListener("ended", () => activeSources.delete(source), { once: true });
  };

  const playSimple = (audio: AudioContext, event: Exclude<SoundEvent, "over">) => {
    const sound = SIMPLE_SOUNDS[event];
    const start = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = sound.type;
    oscillator.frequency.setValueAtTime(sound.frequency, start);
    gain.gain.setValueAtTime(0.05, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + sound.duration);
    oscillator.connect(gain).connect(audio.destination);
    track(oscillator);
    oscillator.start(start);
    oscillator.stop(start + sound.duration);
  };

  const playDeath = (audio: AudioContext) => {
    const start = audio.currentTime;
    const master = audio.createGain();
    const filter = audio.createBiquadFilter();
    const compressor = audio.createDynamicsCompressor();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(DEATH_CUE.lowPassHz, start);
    compressor.threshold.setValueAtTime(DEATH_CUE.compressor.threshold, start);
    compressor.knee.setValueAtTime(DEATH_CUE.compressor.knee, start);
    compressor.ratio.setValueAtTime(DEATH_CUE.compressor.ratio, start);
    compressor.attack.setValueAtTime(DEATH_CUE.compressor.attack, start);
    compressor.release.setValueAtTime(DEATH_CUE.compressor.release, start);
    master.gain.setValueAtTime(0.9, start);
    master.gain.setValueAtTime(0.9, start + 0.9);
    master.gain.exponentialRampToValueAtTime(0.001, start + DEATH_CUE.duration);
    filter.connect(compressor).connect(master).connect(audio.destination);

    const createSteppedNoise = (duration: number) => {
      const length = Math.ceil(audio.sampleRate * duration);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const data = buffer.getChannelData(0);
      const sampleHold = Math.max(1, Math.round(audio.sampleRate / 8000));
      let value = 0;
      for (let index = 0; index < data.length; index++) {
        if (index % sampleHold === 0) value = Math.random() * 2 - 1;
        data[index] = value;
      }
      return buffer;
    };

    for (const note of DEATH_CUE.notes) {
      const noteStart = start + note.start;
      const noteEnd = noteStart + note.duration;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      gain.gain.setValueAtTime(0.001, noteStart);
      gain.gain.linearRampToValueAtTime(DEATH_CUE.mix.leadGain, noteStart + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, noteEnd);
      oscillator.connect(gain).connect(filter);
      track(oscillator);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd);
    }

    const bass = audio.createOscillator();
    const bassGain = audio.createGain();
    bass.type = "sawtooth";
    bass.frequency.setValueAtTime(DEATH_CUE.bass.startFrequency, start);
    bass.frequency.exponentialRampToValueAtTime(DEATH_CUE.bass.endFrequency, start + DEATH_CUE.bass.duration);
    bassGain.gain.setValueAtTime(DEATH_CUE.mix.bassGain, start);
    bassGain.gain.exponentialRampToValueAtTime(0.001, start + DEATH_CUE.bass.duration);
    bass.connect(bassGain).connect(filter);
    track(bass);
    bass.start(start);
    bass.stop(start + DEATH_CUE.bass.duration);

    const noise = audio.createBufferSource();
    const noiseGain = audio.createGain();
    noise.buffer = createSteppedNoise(DEATH_CUE.noiseDuration);
    noiseGain.gain.setValueAtTime(DEATH_CUE.mix.impactGain, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, start + DEATH_CUE.noiseDuration);
    noise.connect(noiseGain).connect(filter);
    track(noise);
    noise.start(start);
    noise.stop(start + DEATH_CUE.noiseDuration);

    const screamStart = start + DEATH_CUE.scream.start;
    const screamEnd = screamStart + DEATH_CUE.scream.duration;
    const scream = audio.createOscillator();
    const screamEnvelope = audio.createGain();
    scream.type = "sawtooth";
    scream.frequency.setValueAtTime(DEATH_CUE.scream.pitch.start, screamStart);
    scream.frequency.exponentialRampToValueAtTime(DEATH_CUE.scream.pitch.peak, screamStart + DEATH_CUE.scream.pitch.peakTime);
    scream.frequency.exponentialRampToValueAtTime(DEATH_CUE.scream.pitch.end, screamEnd);
    screamEnvelope.gain.setValueAtTime(0.001, screamStart);
    screamEnvelope.gain.linearRampToValueAtTime(1, screamStart + 0.02);
    screamEnvelope.gain.setValueAtTime(0.9, screamStart + 0.12);
    screamEnvelope.gain.exponentialRampToValueAtTime(0.001, screamEnd);
    scream.connect(screamEnvelope);

    for (const formant of DEATH_CUE.scream.formants) {
      const band = audio.createBiquadFilter();
      const formantGain = audio.createGain();
      band.type = "bandpass";
      band.Q.setValueAtTime(formant.q, screamStart);
      band.frequency.setValueAtTime(formant.startFrequency, screamStart);
      band.frequency.exponentialRampToValueAtTime(formant.endFrequency, screamEnd);
      formantGain.gain.setValueAtTime(DEATH_CUE.mix.screamGain * formant.gain, screamStart);
      screamEnvelope.connect(band).connect(formantGain).connect(filter);
    }

    const vibrato = audio.createOscillator();
    const vibratoDepth = audio.createGain();
    vibrato.type = "sine";
    vibrato.frequency.setValueAtTime(DEATH_CUE.scream.vibrato.frequency, screamStart);
    vibratoDepth.gain.setValueAtTime(0, screamStart);
    vibratoDepth.gain.linearRampToValueAtTime(DEATH_CUE.scream.vibrato.depth, screamStart + 0.08);
    vibratoDepth.gain.setValueAtTime(DEATH_CUE.scream.vibrato.depth, screamEnd - 0.12);
    vibratoDepth.gain.linearRampToValueAtTime(0, screamEnd);
    vibrato.connect(vibratoDepth).connect(scream.detune);

    const breath = audio.createBufferSource();
    const breathBand = audio.createBiquadFilter();
    const breathGain = audio.createGain();
    breath.buffer = createSteppedNoise(DEATH_CUE.scream.duration);
    breathBand.type = "bandpass";
    breathBand.frequency.setValueAtTime(DEATH_CUE.scream.breathFrequency, screamStart);
    breathBand.Q.setValueAtTime(1.2, screamStart);
    breathGain.gain.setValueAtTime(0.001, screamStart);
    breathGain.gain.linearRampToValueAtTime(DEATH_CUE.mix.breathGain, screamStart + 0.025);
    breathGain.gain.exponentialRampToValueAtTime(0.001, screamEnd);
    breath.connect(breathBand).connect(breathGain).connect(filter);

    for (const source of [scream, vibrato, breath]) track(source);
    scream.start(screamStart);
    scream.stop(screamEnd);
    vibrato.start(screamStart);
    vibrato.stop(screamEnd);
    breath.start(screamStart);
    breath.stop(screamEnd);
  };

  const play = (event: SoundEvent) => {
    try {
      const audio = audioContext();
      if (event === "over") playDeath(audio);
      else playSimple(audio, event);
    } catch {
      // Web Audio 不可用时静音降级，音效异常不能打断游戏循环。
    }
  };

  const dispose = () => {
    for (const source of activeSources) {
      try { source.stop(); } catch { /* 音源可能已经自然结束 */ }
    }
    activeSources.clear();
    void context?.close().catch(() => {});
    context = null;
  };

  return { play, dispose };
}
