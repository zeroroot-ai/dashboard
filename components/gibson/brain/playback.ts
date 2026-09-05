"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";

/**
 * The mission-Scroller playback controller (S5 of the World slider, gibson#1059).
 *
 * This module is the pure brain of timeline playback: a reducer + action set that
 * drives a scrub position over time (play, pause, step, jump, speed, follow-tail)
 * with ZERO I/O. It emits an integer tick position clamped to [0, total] — the
 * exact shape the Scroller's slider and `/api/world/frame` fetch already consume
 * (see BrainView). Because it does no network and no timer work, the controller
 * is unit-testable in isolation (prior art: WorldGraph's `worldToGraph`, the
 * scrubber behavioural test dashboard#675).
 *
 * The only side-effecting piece is `usePlayback`, a thin hook that wires a
 * wall-clock timer to the reducer's `tick` action; the timer measures elapsed
 * time and hands it to the pure reducer, which alone decides how far to advance.
 */

/** Selectable playback rates, in ticks per second. */
export const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 16;
const DEFAULT_SPEED = 1;

/** Timer cadence for `usePlayback`. The reducer is rate-agnostic — it advances
 *  by elapsed wall-clock time, not by tick count — so the cadence only bounds
 *  visual smoothness, not playback speed. */
const TICK_INTERVAL_MS = 100;

export interface PlaybackState {
  /** Current tick, integer, always clamped to [0, total]. */
  position: number;
  /** The live tail (last tick available). */
  total: number;
  playing: boolean;
  /** Advance rate in ticks per second, always within [MIN_SPEED, MAX_SPEED]. */
  speed: number;
  /** Pinned to the live tail: when the tail grows, position tracks it. */
  following: boolean;
  /** Sub-tick progress (ms) carried between `tick`s so fractional rates and
   *  short frames accumulate instead of being lost. */
  accumulatorMs: number;
}

type PlaybackAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "stepForward" }
  | { type: "stepBack" }
  | { type: "jump"; position: number }
  | { type: "setSpeed"; speed: number }
  | { type: "followTail" }
  | { type: "setTotal"; total: number }
  | { type: "tick"; deltaMs: number };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const clampSpeed = (speed: number): number => {
  if (!Number.isFinite(speed) || speed <= 0) return DEFAULT_SPEED;
  return clamp(speed, MIN_SPEED, MAX_SPEED);
};

export function createInitialPlaybackState(opts?: {
  total?: number;
  speed?: number;
}): PlaybackState {
  const total = Math.max(0, Math.floor(opts?.total ?? 0));
  return {
    position: total, // start pinned to the live tail
    total,
    playing: false,
    speed: clampSpeed(opts?.speed ?? DEFAULT_SPEED),
    following: true,
    accumulatorMs: 0,
  };
}

/**
 * The pure playback reducer. Every transition keeps `position` an integer within
 * [0, total]; manual moves (step/jump) take control by pausing and dropping the
 * follow-tail pin, while `followTail` re-pins to the live end. Advancement is
 * driven solely by `tick` from elapsed wall-clock time, so speed is honoured
 * deterministically and the result is fully testable without a timer.
 */
export function playbackReducer(
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackState {
  switch (action.type) {
    case "play": {
      if (state.playing) return state;
      return { ...state, playing: true, accumulatorMs: 0 };
    }
    case "pause": {
      if (!state.playing) return state;
      return { ...state, playing: false, accumulatorMs: 0 };
    }
    case "toggle": {
      return { ...state, playing: !state.playing, accumulatorMs: 0 };
    }
    case "stepForward": {
      const position = clamp(state.position + 1, 0, state.total);
      return {
        ...state,
        position,
        playing: false,
        following: position >= state.total,
        accumulatorMs: 0,
      };
    }
    case "stepBack": {
      const position = clamp(state.position - 1, 0, state.total);
      return {
        ...state,
        position,
        playing: false,
        following: position >= state.total,
        accumulatorMs: 0,
      };
    }
    case "jump": {
      const position = clamp(Math.round(action.position), 0, state.total);
      return {
        ...state,
        position,
        playing: false,
        following: position >= state.total,
        accumulatorMs: 0,
      };
    }
    case "setSpeed": {
      return { ...state, speed: clampSpeed(action.speed) };
    }
    case "followTail": {
      return {
        ...state,
        position: state.total,
        following: true,
        accumulatorMs: 0,
      };
    }
    case "setTotal": {
      const total = Math.max(0, Math.floor(action.total));
      const position = state.following
        ? total
        : clamp(state.position, 0, total);
      return { ...state, total, position };
    }
    case "tick": {
      if (!state.playing || action.deltaMs <= 0) return state;
      // Already at the tail: nothing ahead to play; settle into follow mode so
      // newly-arriving events keep streaming in.
      if (state.position >= state.total) {
        return state.following
          ? state
          : { ...state, following: true, accumulatorMs: 0 };
      }
      const accumulated = state.accumulatorMs + action.deltaMs;
      const ticks = Math.floor((accumulated * state.speed) / 1000);
      if (ticks <= 0) {
        return { ...state, accumulatorMs: accumulated };
      }
      const position = clamp(state.position + ticks, 0, state.total);
      const reachedTail = position >= state.total;
      return {
        ...state,
        position,
        following: reachedTail,
        // Keep the leftover only while there is still runway; at the tail the
        // remainder is meaningless.
        accumulatorMs: reachedTail
          ? 0
          : accumulated - (ticks * 1000) / state.speed,
      };
    }
    default:
      return state;
  }
}

/** True when the position is pinned at (or beyond) the live tail. */
export const isAtTail = (state: PlaybackState): boolean =>
  state.position >= state.total;

interface PlaybackControls {
  play(): void;
  pause(): void;
  toggle(): void;
  stepForward(): void;
  stepBack(): void;
  jump(position: number): void;
  setSpeed(speed: number): void;
  followTail(): void;
}

interface UsePlayback {
  position: number;
  total: number;
  playing: boolean;
  speed: number;
  following: boolean;
  atTail: boolean;
  controls: PlaybackControls;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * usePlayback wires the pure {@link playbackReducer} to React and a wall-clock
 * timer. The timer is the sole side effect: it measures elapsed milliseconds and
 * dispatches `tick`, leaving every advancement decision to the reducer. `total`
 * is the live tail (e.g. `timeline.length`); when it grows while following, the
 * position tracks it, so playback flows seamlessly into live-tail follow.
 */
export function usePlayback(
  total: number,
  options?: { speed?: number },
): UsePlayback {
  const [state, dispatch] = useReducer(
    playbackReducer,
    { total, speed: options?.speed },
    createInitialPlaybackState,
  );

  // Keep the controller's notion of the live tail in sync with the prop.
  useEffect(() => {
    dispatch({ type: "setTotal", total });
  }, [total]);

  // The only I/O: a wall-clock timer feeding elapsed time into the reducer.
  const lastRef = useRef<number>(0);
  useEffect(() => {
    if (!state.playing) return;
    lastRef.current = now();
    const id = setInterval(() => {
      const t = now();
      const deltaMs = t - lastRef.current;
      lastRef.current = t;
      dispatch({ type: "tick", deltaMs });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.playing]);

  const controls = useMemo<PlaybackControls>(
    () => ({
      play: () => dispatch({ type: "play" }),
      pause: () => dispatch({ type: "pause" }),
      toggle: () => dispatch({ type: "toggle" }),
      stepForward: () => dispatch({ type: "stepForward" }),
      stepBack: () => dispatch({ type: "stepBack" }),
      jump: (position: number) => dispatch({ type: "jump", position }),
      setSpeed: (speed: number) => dispatch({ type: "setSpeed", speed }),
      followTail: () => dispatch({ type: "followTail" }),
    }),
    [],
  );

  return {
    position: state.position,
    total: state.total,
    playing: state.playing,
    speed: state.speed,
    following: state.following,
    atTail: isAtTail(state),
    controls,
  };
}
