import { describe, it, expect } from "vitest";
import {
  createInitialPlaybackState,
  playbackReducer,
  isAtTail,
  MIN_SPEED,
  MAX_SPEED,
  type PlaybackState,
} from "@/components/gibson/brain/playback";

// A paused, mid-timeline state: 10 ticks total, scrubbed to 3, speed 1x.
const mid = (over?: Partial<PlaybackState>): PlaybackState => ({
  position: 3,
  total: 10,
  playing: false,
  speed: 1,
  following: false,
  accumulatorMs: 0,
  ...over,
});

describe("createInitialPlaybackState", () => {
  it("starts pinned to the live tail, paused", () => {
    const s = createInitialPlaybackState({ total: 7 });
    expect(s).toMatchObject({
      position: 7,
      total: 7,
      playing: false,
      following: true,
    });
  });

  it("floors a fractional total and clamps a bad speed to the default", () => {
    const s = createInitialPlaybackState({ total: 4.9, speed: -3 });
    expect(s.total).toBe(4);
    expect(s.position).toBe(4);
    expect(s.speed).toBe(1);
  });
});

describe("play / pause / toggle", () => {
  it("play sets playing; pause halts", () => {
    const playing = playbackReducer(mid(), { type: "play" });
    expect(playing.playing).toBe(true);
    const paused = playbackReducer(playing, { type: "pause" });
    expect(paused.playing).toBe(false);
  });

  it("toggle flips the playing flag", () => {
    const on = playbackReducer(mid(), { type: "toggle" });
    expect(on.playing).toBe(true);
    const off = playbackReducer(on, { type: "toggle" });
    expect(off.playing).toBe(false);
  });
});

describe("step", () => {
  it("step-forward moves exactly one and pauses", () => {
    const s = playbackReducer(mid({ playing: true }), { type: "stepForward" });
    expect(s.position).toBe(4);
    expect(s.playing).toBe(false);
  });

  it("step-back moves exactly one", () => {
    const s = playbackReducer(mid(), { type: "stepBack" });
    expect(s.position).toBe(2);
  });

  it("clamps at the upper bound — never past total", () => {
    const s = playbackReducer(mid({ position: 10 }), { type: "stepForward" });
    expect(s.position).toBe(10);
    expect(s.following).toBe(true);
  });

  it("clamps at the lower bound — never below 0", () => {
    const s = playbackReducer(mid({ position: 0 }), { type: "stepBack" });
    expect(s.position).toBe(0);
  });

  it("stepping to the tail re-pins follow; stepping back drops it", () => {
    const atTail = playbackReducer(mid({ position: 9 }), { type: "stepForward" });
    expect(atTail.following).toBe(true);
    const off = playbackReducer(atTail, { type: "stepBack" });
    expect(off.following).toBe(false);
  });
});

describe("jump", () => {
  it("sets the position and pauses (manual control)", () => {
    const s = playbackReducer(mid({ playing: true }), {
      type: "jump",
      position: 6,
    });
    expect(s.position).toBe(6);
    expect(s.playing).toBe(false);
    expect(s.following).toBe(false);
  });

  it("clamps a jump beyond either bound", () => {
    expect(playbackReducer(mid(), { type: "jump", position: 99 }).position).toBe(
      10,
    );
    expect(
      playbackReducer(mid(), { type: "jump", position: -5 }).position,
    ).toBe(0);
  });

  it("jumping to total re-pins follow", () => {
    const s = playbackReducer(mid(), { type: "jump", position: 10 });
    expect(s.following).toBe(true);
  });
});

describe("setSpeed", () => {
  it("changes the advance rate", () => {
    expect(playbackReducer(mid(), { type: "setSpeed", speed: 2 }).speed).toBe(2);
  });

  it("clamps to [MIN_SPEED, MAX_SPEED] and rejects non-positive", () => {
    expect(
      playbackReducer(mid(), { type: "setSpeed", speed: 999 }).speed,
    ).toBe(MAX_SPEED);
    expect(
      playbackReducer(mid(), { type: "setSpeed", speed: 0.0001 }).speed,
    ).toBe(MIN_SPEED);
    expect(playbackReducer(mid(), { type: "setSpeed", speed: 0 }).speed).toBe(1);
  });
});

describe("followTail", () => {
  it("snaps to the live tail and pins follow", () => {
    const s = playbackReducer(mid({ position: 2 }), { type: "followTail" });
    expect(s.position).toBe(10);
    expect(s.following).toBe(true);
    expect(isAtTail(s)).toBe(true);
  });
});

describe("setTotal (the live tail moved)", () => {
  it("tracks the growing tail while following", () => {
    const s = playbackReducer(mid({ position: 10, following: true }), {
      type: "setTotal",
      total: 15,
    });
    expect(s.position).toBe(15);
  });

  it("leaves a scrubbed (non-following) position put", () => {
    const s = playbackReducer(mid({ position: 3, following: false }), {
      type: "setTotal",
      total: 15,
    });
    expect(s.position).toBe(3);
  });

  it("clamps a non-following position when the tail shrinks", () => {
    const s = playbackReducer(mid({ position: 8, following: false }), {
      type: "setTotal",
      total: 5,
    });
    expect(s.position).toBe(5);
  });
});

describe("tick (time-driven advancement)", () => {
  it("does nothing while paused", () => {
    const s = playbackReducer(mid({ playing: false }), {
      type: "tick",
      deltaMs: 1000,
    });
    expect(s.position).toBe(3);
  });

  it("advances one tick per second at 1x", () => {
    const s = playbackReducer(mid({ playing: true }), {
      type: "tick",
      deltaMs: 1000,
    });
    expect(s.position).toBe(4);
  });

  it("advances faster at higher speed", () => {
    const s = playbackReducer(mid({ playing: true, speed: 2 }), {
      type: "tick",
      deltaMs: 1000,
    });
    expect(s.position).toBe(5);
  });

  it("accumulates sub-tick progress across short frames", () => {
    const half = playbackReducer(mid({ playing: true }), {
      type: "tick",
      deltaMs: 500,
    });
    expect(half.position).toBe(3); // not enough for a whole tick yet
    const whole = playbackReducer(half, { type: "tick", deltaMs: 500 });
    expect(whole.position).toBe(4); // the carried 500ms completes the tick
  });

  it("clamps at the tail and pins follow instead of overshooting", () => {
    const s = playbackReducer(mid({ playing: true, position: 9 }), {
      type: "tick",
      deltaMs: 10000,
    });
    expect(s.position).toBe(10);
    expect(s.following).toBe(true);
  });

  it("ignores non-positive deltas", () => {
    const s = playbackReducer(mid({ playing: true }), {
      type: "tick",
      deltaMs: 0,
    });
    expect(s.position).toBe(3);
  });
});
