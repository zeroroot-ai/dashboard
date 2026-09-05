/**
 * @vitest-environment node
 *
 * Tests for src/lib/correlation.ts.
 * Must run under the Node environment because AsyncLocalStorage is a
 * Node built-in not available in jsdom.
 */

import { describe, it, expect } from "vitest";
import { withCorrelation, getCorrelationId } from "../correlation";

// UUID v4 pattern, matches what crypto.randomUUID() produces.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("withCorrelation / getCorrelationId", () => {
  describe("getCorrelationId() outside a context", () => {
    it("returns a fresh UUID when called with no active context", () => {
      const id = getCorrelationId();
      expect(id).toMatch(UUID_RE);
    });

    it("returns a different UUID on each call outside a context", () => {
      const a = getCorrelationId();
      const b = getCorrelationId();
      // Not strictly guaranteed but crypto.randomUUID() collision probability
      // is negligible, two consecutive calls must differ.
      expect(a).not.toBe(b);
    });
  });

  describe("withCorrelation threads the id across await boundaries", () => {
    it("synchronous fn: getCorrelationId() inside returns the bound id", async () => {
      const id = "test-id-sync-001";
      let captured: string | undefined;

      await withCorrelation(id, () => {
        captured = getCorrelationId();
      });

      expect(captured).toBe(id);
    });

    it("async fn: getCorrelationId() after an await still returns the bound id", async () => {
      const id = "test-id-async-002";
      let captured: string | undefined;

      await withCorrelation(id, async () => {
        await Promise.resolve(); // yield to microtask queue
        captured = getCorrelationId();
      });

      expect(captured).toBe(id);
    });

    it("propagates through multiple await points", async () => {
      const id = "test-id-multi-await-003";
      const snapshots: string[] = [];

      await withCorrelation(id, async () => {
        snapshots.push(getCorrelationId());
        await new Promise<void>((r) => setTimeout(r, 0));
        snapshots.push(getCorrelationId());
        await Promise.resolve();
        snapshots.push(getCorrelationId());
      });

      expect(snapshots).toHaveLength(3);
      snapshots.forEach((s) => expect(s).toBe(id));
    });

    it("resolves to the return value of fn", async () => {
      const result = await withCorrelation("any-id", () => 42);
      expect(result).toBe(42);
    });

    it("resolves to the return value of an async fn", async () => {
      const result = await withCorrelation("any-id", async () => {
        await Promise.resolve();
        return "hello";
      });
      expect(result).toBe("hello");
    });

    it("rejects when fn throws synchronously", async () => {
      await expect(
        withCorrelation("err-id", () => {
          throw new Error("sync boom");
        })
      ).rejects.toThrow("sync boom");
    });

    it("rejects when async fn rejects", async () => {
      await expect(
        withCorrelation("err-id-async", async () => {
          await Promise.resolve();
          throw new Error("async boom");
        })
      ).rejects.toThrow("async boom");
    });
  });

  describe("nested withCorrelation", () => {
    it("inner call sees the inner id, outer call sees the outer id after inner resolves", async () => {
      const outer = "outer-context-004";
      const inner = "inner-context-005";

      let outerBeforeInner: string | undefined;
      let innerCapture: string | undefined;
      let outerAfterInner: string | undefined;

      await withCorrelation(outer, async () => {
        outerBeforeInner = getCorrelationId();

        await withCorrelation(inner, async () => {
          await Promise.resolve();
          innerCapture = getCorrelationId();
        });

        outerAfterInner = getCorrelationId();
      });

      expect(outerBeforeInner).toBe(outer);
      expect(innerCapture).toBe(inner);
      // After the inner scope exits, the outer scope is restored.
      expect(outerAfterInner).toBe(outer);
    });

    it("parallel withCorrelation calls do not bleed into each other", async () => {
      const idA = "parallel-a-006";
      const idB = "parallel-b-007";

      const captureA: string[] = [];
      const captureB: string[] = [];

      await Promise.all([
        withCorrelation(idA, async () => {
          captureA.push(getCorrelationId());
          await new Promise<void>((r) => setTimeout(r, 10));
          captureA.push(getCorrelationId());
        }),
        withCorrelation(idB, async () => {
          captureB.push(getCorrelationId());
          await new Promise<void>((r) => setTimeout(r, 5));
          captureB.push(getCorrelationId());
        }),
      ]);

      captureA.forEach((id) => expect(id).toBe(idA));
      captureB.forEach((id) => expect(id).toBe(idB));
    });
  });
});
