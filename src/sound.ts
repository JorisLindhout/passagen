import { CELL, WALL_H } from "./maze";
import type { Solid } from "./walk";

const SPEED_OF_SOUND = 343;
const VARIANTS = 8;
/** Free distance is measured to this far; beyond it an echo is too faint to matter. */
const MAX_REACH = 30;
const EAR_HEIGHT = 1.6;

/** Meters from the listener to the nearest wall along each world axis. */
export type Space = { east: number; west: number; south: number; north: number };

/**
 * Everything that shapes a step and the room around it. A step is up to three
 * layers of filtered noise (brush, thud, click), heard again as the toe rolls
 * off, then off the walls and ceiling, then as a reverb tail.
 */
export type SoundSettings = {
  volume: number;
  /** Soft noise between two filters: the body of the step. */
  brushLevel: number;
  brushLowHz: number;
  brushHighHz: number;
  attackMs: number;
  decayMs: number;
  /** Low noise under the brush: weight through the floor. */
  thudLevel: number;
  thudHz: number;
  thudDecayMs: number;
  /** Bright noise at the instant of contact: a hard sole. */
  clickLevel: number;
  clickHz: number;
  clickDecayMs: number;
  /** The roll onto the toe, repeating the step's layers softer and later. */
  toeDelayMs: number;
  toeLevel: number;
  toeAttackMs: number;
  /** How much filters and timing differ between the eight variants, 0 to 1. */
  variation: number;
  pitchVariation: number;
  levelVariation: number;
  /** Left and right feet pan this far apart. */
  sway: number;
  /** How much quieter a slow step is than one at full speed, 0 to 1. */
  speedLoudness: number;
  echoLevel: number;
  echoToneHz: number;
  ceilingLevel: number;
  ceilingToneHz: number;
  roomShortSeconds: number;
  roomLongSeconds: number;
  roomShortLevel: number;
  roomLongLevel: number;
  /** 0 bright stone, 1 dark and soft. */
  roomDarkness: number;
  /** 0 the room sounds the same everywhere, 1 dead ends are dry and junctions ring. */
  spaceInfluence: number;
};

export const DEFAULT_SOUND: SoundSettings = {
  volume: 0.32,
  brushLevel: 0.46,
  brushLowHz: 25,
  brushHighHz: 117,
  attackMs: 4,
  decayMs: 34,
  thudLevel: 0.34,
  thudHz: 39,
  thudDecayMs: 20,
  clickLevel: 0,
  clickHz: 300,
  clickDecayMs: 0.5,
  toeDelayMs: 31,
  toeLevel: 0.34,
  toeAttackMs: 28.5,
  variation: 0.77,
  pitchVariation: 0.12,
  levelVariation: 0.09,
  sway: 0.3,
  speedLoudness: 0.4,
  echoLevel: 0.73,
  echoToneHz: 3373,
  ceilingLevel: 0.33,
  ceilingToneHz: 900,
  roomShortSeconds: 0.8,
  roomLongSeconds: 2.3,
  roomShortLevel: 0.64,
  roomLongLevel: 0.54,
  roomDarkness: 0.85,
  spaceInfluence: 1,
};

const VOICE_KEYS: (keyof SoundSettings)[] = [
  "brushLevel",
  "brushLowHz",
  "brushHighHz",
  "attackMs",
  "decayMs",
  "thudLevel",
  "thudHz",
  "thudDecayMs",
  "clickLevel",
  "clickHz",
  "clickDecayMs",
  "toeDelayMs",
  "toeLevel",
  "toeAttackMs",
  "variation",
];
const ROOM_KEYS: (keyof SoundSettings)[] = ["roomShortSeconds", "roomLongSeconds", "roomDarkness"];

export type Footsteps = {
  /** Call from a user gesture; browsers keep audio silent until then. */
  start: () => void;
  suspend: () => void;
  step: (space: Space, yaw: number, speed: number) => void;
  settings: () => SoundSettings;
  setSettings: (next: Partial<SoundSettings>) => void;
  /** One of the current step variants, dry, for drawing. */
  sample: () => AudioBuffer | null;
};

/** Casts along the grid from the listener to the first wall face in each direction. */
export function measureSpace(x: number, z: number, solid: Solid): Space {
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  const reach = (dx: number, dz: number) => {
    for (let i = 1; i * CELL < MAX_REACH + CELL; i++) {
      if (!solid(gx + dx * i, gz + dz * i)) continue;
      if (dx === 1) return (gx + i) * CELL - x;
      if (dx === -1) return x - (gx - i + 1) * CELL;
      if (dz === 1) return (gz + i) * CELL - z;
      return z - (gz - i + 1) * CELL;
    }
    return MAX_REACH;
  };
  return { east: reach(1, 0), west: reach(-1, 0), south: reach(0, 1), north: reach(0, -1) };
}

/** 0 in a tight dead end, 1 where long corridors meet. */
export function openness(space: Space): number {
  const across = Math.min(space.east + space.west, space.north + space.south);
  const along = Math.max(space.east + space.west, space.north + space.south);
  return clamp01((along - 4) / 22) * 0.7 + clamp01((across - CELL) / (3 * CELL)) * 0.3;
}

type Reflection = { delay: DelayNode; tone: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode };

/**
 * Footsteps in an empty building. Each step is heard dry, then off the four
 * nearest walls and the ceiling, each delayed by its round trip, then as a
 * tail whose length follows how open the spot is.
 */
export function createFootsteps(initial: Partial<SoundSettings> = {}): Footsteps {
  let settings: SoundSettings = { ...DEFAULT_SOUND, ...initial };
  let ctx: AudioContext | null = null;
  let voices: AudioBuffer[] = [];
  let master: GainNode | null = null;
  let bus: GainNode | null = null;
  let walls: Reflection[] = [];
  let ceiling: Reflection | null = null;
  let shortRoom: { send: GainNode; convolver: ConvolverNode } | null = null;
  let longRoom: { send: GainNode; convolver: ConvolverNode } | null = null;
  let foot = 0;
  let lastVoice = -1;

  const makeVoices = (audio: AudioContext) => {
    voices = Array.from({ length: VARIANTS }, () => footstep(audio, settings));
  };
  const makeRooms = (audio: AudioContext) => {
    if (shortRoom) shortRoom.convolver.buffer = impulse(audio, settings.roomShortSeconds, settings.roomDarkness);
    if (longRoom) longRoom.convolver.buffer = impulse(audio, settings.roomLongSeconds, settings.roomDarkness);
  };
  const applyFixed = () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    master?.gain.setTargetAtTime(settings.volume, now, 0.02);
    ceiling?.gain.gain.setTargetAtTime(settings.ceilingLevel, now, 0.02);
    ceiling?.tone.frequency.setTargetAtTime(settings.ceilingToneHz, now, 0.02);
  };

  const build = (audio: AudioContext) => {
    master = audio.createGain();
    master.gain.value = settings.volume;
    const limiter = audio.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    master.connect(limiter);
    limiter.connect(audio.destination);

    const input = audio.createGain();
    bus = input;
    input.connect(master);
    const output = master;

    const reflection = (): Reflection => {
      const delay = audio.createDelay(0.25);
      const tone = audio.createBiquadFilter();
      tone.type = "lowpass";
      const gain = audio.createGain();
      gain.gain.value = 0;
      const pan = audio.createStereoPanner();
      input.connect(delay);
      delay.connect(tone);
      tone.connect(gain);
      gain.connect(pan);
      pan.connect(output);
      return { delay, tone, gain, pan };
    };
    walls = [reflection(), reflection(), reflection(), reflection()];
    ceiling = reflection();
    const ceilingPath = 2 * WALL_H - EAR_HEIGHT;
    ceiling.delay.delayTime.value = (ceilingPath - EAR_HEIGHT) / SPEED_OF_SOUND;
    ceiling.tone.frequency.value = settings.ceilingToneHz;
    ceiling.gain.gain.value = settings.ceilingLevel;

    const room = () => {
      const convolver = audio.createConvolver();
      const send = audio.createGain();
      send.gain.value = 0;
      input.connect(send);
      send.connect(convolver);
      convolver.connect(output);
      return { send, convolver };
    };
    shortRoom = room();
    longRoom = room();
    makeRooms(audio);
    makeVoices(audio);
  };

  return {
    start() {
      // Web Audio defaults to "ambient", which the iPhone silent switch mutes.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== "playback") session.type = "playback";
      if (!ctx) {
        ctx = new AudioContext();
        build(ctx);
      }
      if (ctx.state !== "running") void ctx.resume();
    },
    suspend() {
      void ctx?.suspend();
    },
    settings: () => ({ ...settings }),
    setSettings(next) {
      const before = settings;
      settings = { ...settings, ...next };
      if (!ctx) return;
      if (VOICE_KEYS.some((key) => before[key] !== settings[key])) makeVoices(ctx);
      if (ROOM_KEYS.some((key) => before[key] !== settings[key])) makeRooms(ctx);
      applyFixed();
    },
    sample: () => voices[0] ?? null,
    step(space, yaw, speed) {
      if (!ctx || !bus || ctx.state !== "running" || voices.length === 0) return;
      const now = ctx.currentTime;
      shape(now, space, yaw);

      let index = Math.floor(Math.random() * voices.length);
      if (index === lastVoice) index = (index + 1) % voices.length;
      lastVoice = index;
      foot = 1 - foot;

      const source = ctx.createBufferSource();
      source.buffer = voices[index] ?? null;
      source.playbackRate.value = 1 + settings.pitchVariation * (Math.random() * 2 - 1);
      const level = ctx.createGain();
      const pace = 1 - settings.speedLoudness * (1 - Math.min(1, speed));
      level.gain.value = pace * (1 + settings.levelVariation * (Math.random() * 2 - 1));
      const side = ctx.createStereoPanner();
      side.pan.value = ((foot === 0 ? -1 : 1) * settings.sway) / 2;
      source.connect(level);
      level.connect(side);
      side.connect(bus);
      source.start(now);
      source.onended = () => {
        source.disconnect();
        level.disconnect();
        side.disconnect();
      };
    },
  };

  function shape(now: number, space: Space, yaw: number): void {
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const sides = [
      { d: space.east, x: 1, z: 0 },
      { d: space.west, x: -1, z: 0 },
      { d: space.south, x: 0, z: 1 },
      { d: space.north, x: 0, z: -1 },
    ];
    sides.forEach((side, i) => {
      const wall = walls[i];
      if (!wall) return;
      const distance = Math.max(0.4, side.d);
      const path = 2 * distance;
      const level = distance >= MAX_REACH ? 0 : settings.echoLevel * (EAR_HEIGHT / (EAR_HEIGHT + path)) ** 0.6;
      wall.delay.delayTime.setTargetAtTime(Math.min(0.24, path / SPEED_OF_SOUND), now, 0.01);
      wall.gain.gain.setTargetAtTime(level, now, 0.01);
      wall.tone.frequency.setTargetAtTime(settings.echoToneHz / (1 + distance / 8), now, 0.01);
      wall.pan.pan.setTargetAtTime(0.85 * (side.x * rightX + side.z * rightZ), now, 0.01);
    });

    const open = 0.5 + (openness(space) - 0.5) * settings.spaceInfluence;
    shortRoom?.send.gain.setTargetAtTime(settings.roomShortLevel * (1 - open), now, 0.05);
    longRoom?.send.gain.setTargetAtTime(settings.roomLongLevel * open, now, 0.05);
  }
}

/** Brush, thud, and click, each shaped by its own envelope, heard again at the toe. */
function footstep(audio: AudioContext, s: SoundSettings): AudioBuffer {
  const rate = audio.sampleRate;
  const vary = (value: number) => value * (1 + s.variation * 0.35 * (Math.random() * 2 - 1));
  const attack = Math.max(0.0005, vary(s.attackMs) / 1000);
  const decay = Math.max(0.002, vary(s.decayMs) / 1000);
  const thudDecay = Math.max(0.002, vary(s.thudDecayMs) / 1000);
  const clickDecay = Math.max(0.0005, vary(s.clickDecayMs) / 1000);
  const toeAt = Math.max(0, vary(s.toeDelayMs) / 1000);
  const toeAttack = Math.max(0.0005, vary(s.toeAttackMs) / 1000);
  const toeLevel = s.toeLevel * (1 + s.variation * 0.4 * (Math.random() * 2 - 1));
  const longest = Math.max(decay, thudDecay, clickDecay);
  const length = Math.ceil(rate * Math.min(1.5, toeAt + toeAttack + attack + longest * 6));
  const buffer = audio.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  const brushHigh = highpassCoefficient(vary(s.brushLowHz), rate);
  const brushLow = lowpassCoefficient(vary(s.brushHighHz), rate);
  const thudLow = lowpassCoefficient(vary(s.thudHz), rate);
  const clickHigh = highpassCoefficient(vary(s.clickHz), rate);

  let previous = 0;
  let brushHp = 0;
  let brushA = 0;
  let brushB = 0;
  let thudA = 0;
  let thudB = 0;
  let clickHp = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const white = Math.random() * 2 - 1;
    brushHp = brushHigh * (brushHp + white - previous);
    clickHp = clickHigh * (clickHp + white - previous);
    previous = white;
    brushA += brushLow * (brushHp - brushA);
    brushB += brushLow * (brushA - brushB);
    thudA += thudLow * (white - thudA);
    thudB += thudLow * (thudA - thudB);

    const layers = (u: number, rise: number) => {
      if (u < 0) return 0;
      const onset = swell(u, rise);
      return (
        s.brushLevel * brushB * onset * Math.exp(-u / decay) * 4 +
        s.thudLevel * thudB * onset * Math.exp(-u / thudDecay) * 12 +
        s.clickLevel * clickHp * Math.exp(-u / clickDecay)
      );
    };
    const sample = layers(t, attack) + toeLevel * layers(t - toeAt, toeAttack);
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak > 0) for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) / peak;
  return buffer;
}

/** Rises smoothly from zero over the given seconds, with no edge to click on. */
function swell(t: number, seconds: number): number {
  if (t >= seconds) return 1;
  const x = Math.sin((t / seconds) * (Math.PI / 2));
  return x * x;
}

function lowpassCoefficient(hz: number, rate: number): number {
  return 1 - Math.exp((-2 * Math.PI * Math.max(20, hz)) / rate);
}

function highpassCoefficient(hz: number, rate: number): number {
  return Math.exp((-2 * Math.PI * Math.max(1, hz)) / rate);
}

/** Stereo decaying noise whose highs fade faster the darker the room. */
function impulse(audio: AudioContext, seconds: number, darkness: number): AudioBuffer {
  const rate = audio.sampleRate;
  const length = Math.floor(rate * seconds * 1.1);
  const buffer = audio.createBuffer(2, length, rate);
  const predelay = Math.floor(rate * 0.012);
  const startHz = 9000 * (1 - darkness) + 900 * darkness;
  const endHz = 3500 * (1 - darkness) + 180 * darkness;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = predelay; i < length; i++) {
      const t = (i - predelay) / rate;
      const decay = Math.exp((-6.91 * t) / seconds);
      const fade = Math.exp(-t / (seconds * 0.3));
      const damping = lowpassCoefficient(endHz + (startHz - endHz) * fade, rate);
      smooth += damping * (Math.random() * 2 - 1 - smooth);
      data[i] = smooth * decay * 0.6;
    }
  }
  return buffer;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
