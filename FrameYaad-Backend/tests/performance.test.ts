import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../src/utils/map-concurrent";

describe("bounded upload concurrency", () => {
  it("runs at most three uploads and preserves input order", async () => {
    let active = 0;
    let peak = 0;
    const output = await mapConcurrent([3, 2, 1, 0, 4], 3, async value => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, value * 2));
      active--;
      return value * 10;
    });
    expect(peak).toBe(3);
    expect(output).toEqual([30, 20, 10, 0, 40]);
    expect(active).toBe(0);
  });

  it("waits for in-flight writes before returning a failure for rollback", async () => {
    const completed: number[] = [];
    await expect(mapConcurrent([0, 1, 2, 3, 4], 3, async value => {
      await new Promise(resolve => setTimeout(resolve, value === 0 ? 1 : 10));
      if (value === 0) throw new Error("Storage unavailable");
      completed.push(value);
      return value;
    })).rejects.toThrow("Storage unavailable");
    expect(completed.sort()).toEqual([1, 2]);
  });

  it("handles empty uploads and rejects invalid concurrency", async () => {
    expect(await mapConcurrent([], 3, () => Promise.resolve(1))).toEqual([]);
    await expect(mapConcurrent([1], 0, value => Promise.resolve(value))).rejects.toThrow(RangeError);
  });
});
