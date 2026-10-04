import { describe, expect, test } from "vitest";
import {
  COVER_CANVAS_HEIGHT,
  COVER_CANVAS_WIDTH,
  photoWallLayout,
  type PhotoWallCard,
} from "@/components/cover-studio/short-video-canvas";

const base = {
  width: COVER_CANVAS_WIDTH,
  height: COVER_CANVAS_HEIGHT,
  photoCount: 3,
  speedFactor: 1,
};

/** The x positions of the cards in each row, top row first. */
function rowsOf(cards: PhotoWallCard[]): number[][] {
  const rows = new Map<number, number[]>();
  for (const card of cards) {
    rows.set(card.y, [...(rows.get(card.y) ?? []), card.x]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, xs]) => xs);
}

/**
 * Median rather than min/max: a row gains and loses cards at its edges as it
 * wraps, but the middle of the row is unaffected by that, so the median reads
 * the drift exactly.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

describe("photoWallLayout", () => {
  test("lays out the banner in three rows", () => {
    const rows = rowsOf(photoWallLayout({ ...base, elapsedMs: 0 }));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.length).toBeGreaterThan(2);
  });

  test("uses more rows on a tall frame", () => {
    const cards = photoWallLayout({ width: 1080, height: 1920, photoCount: 3, elapsedMs: 0, speedFactor: 1 });
    expect(rowsOf(cards)).toHaveLength(4);
  });

  test("is deterministic for the same moment", () => {
    expect(photoWallLayout({ ...base, elapsedMs: 500 })).toEqual(
      photoWallLayout({ ...base, elapsedMs: 500 }),
    );
  });

  test("moves as time advances", () => {
    const start = photoWallLayout({ ...base, elapsedMs: 0 }).map((card) => card.x);
    const later = photoWallLayout({ ...base, elapsedMs: 2000 }).map((card) => card.x);
    expect(later).not.toEqual(start);
  });

  test("drifts neighbouring rows in opposite directions", () => {
    // This is what makes the wall read as motion rather than a conveyor belt.
    const start = rowsOf(photoWallLayout({ ...base, elapsedMs: 0 }));
    const later = rowsOf(photoWallLayout({ ...base, elapsedMs: 2000 }));
    expect(median(later[0])).toBeLessThan(median(start[0]));
    expect(median(later[1])).toBeGreaterThan(median(start[1]));
  });

  test("scales the drift with the template's speed", () => {
    // Follows one card by its slot rather than measuring the row's median: a
    // wrapping row gains and loses cards at its edges, and that churn moves the
    // median by a fraction of a step — smaller than the drift being measured.
    const drift = (speedFactor: number) => {
      const start = photoWallLayout({ ...base, speedFactor, elapsedMs: 0 });
      const later = photoWallLayout({ ...base, speedFactor, elapsedMs: 2000 });
      const key = (card: PhotoWallCard) => `${card.row}:${card.slot}`;
      const before = new Map(start.map((card) => [key(card), card]));
      const probe = later.find((card) => card.row === 0 && before.has(key(card)));
      expect(probe).toBeDefined();
      return Math.abs(probe!.x - before.get(key(probe!))!.x);
    };
    expect(drift(1.4) / drift(0.6)).toBeCloseTo(1.4 / 0.6, 5);
  });

  test("leaves no gap at either edge of a row", () => {
    // A wrapped strip is the easy way to get this wrong: the pictures jump, or a
    // bare patch of background shows through. Both are caught here.
    const cards = photoWallLayout({ ...base, elapsedMs: 4321 });
    const cardWidth = cards[0].width;
    for (const row of rowsOf(cards)) {
      const sorted = [...row].sort((a, b) => a - b);
      const step = sorted[1] - sorted[0];
      expect(step).toBeGreaterThan(cardWidth);
      for (let index = 2; index < sorted.length; index += 1) {
        expect(sorted[index] - sorted[index - 1]).toBeCloseTo(step, 5);
      }
      expect(sorted[0]).toBeLessThanOrEqual(0);
      expect(sorted[sorted.length - 1] + cardWidth).toBeGreaterThanOrEqual(base.width);
    }
  });

  test("cycles the pictures when there are fewer than fit on screen", () => {
    const cards = photoWallLayout({ ...base, photoCount: 2, elapsedMs: 900 });
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.imageIndex).toBeGreaterThanOrEqual(0);
      expect(card.imageIndex).toBeLessThan(2);
    }
    expect(new Set(cards.map((card) => card.imageIndex))).toEqual(new Set([0, 1]));
  });

  test("never asks for a picture that is not there", () => {
    for (const photoCount of [1, 4, 9]) {
      const cards = photoWallLayout({ ...base, photoCount, elapsedMs: 2718 });
      for (const card of cards) {
        expect(card.imageIndex).toBeLessThan(photoCount);
        expect(card.imageIndex).toBeGreaterThanOrEqual(0);
      }
    }
    // A zero-picture call must still be safe rather than divide by nothing.
    expect(photoWallLayout({ ...base, photoCount: 0, elapsedMs: 0 }).length).toBeGreaterThan(0);
  });
});
