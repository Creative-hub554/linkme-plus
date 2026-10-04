"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Windowed rendering for the social feed.
 *
 * A long feed keeps every post it has paged in, and a card is not cheap: it
 * carries an avatar, media, action rows and a menu. Mounting hundreds of them
 * costs memory and makes every shared style recalculation walk the whole list,
 * which is what makes scrolling degrade the further you scroll.
 *
 * Only the items overlapping the viewport (plus a band either side) are
 * mounted, positioned inside a spacer sized to the full list, so the scrollbar
 * and page height behave exactly as if everything were rendered.
 *
 * Heights are measured rather than assumed: posts vary from a one-line text
 * card to a tall video, so an item is measured on mount and re-measured
 * whenever its own box changes (an image finishing load, a comment expanding).
 * Items that have never been mounted fall back to an estimate, which is fine
 * because they are below the fold by definition. A measurement is dropped
 * straight back into the layout before paint, so the estimate is never visible
 * as a jump.
 */

/** Rough card height, used only until an item has been measured. */
const DEFAULT_ESTIMATE_HEIGHT = 260;
/** Extra pixels rendered above and below the viewport to cover fast scrolling. */
const DEFAULT_OVERSCAN = 700;
/** Ignore sub-pixel churn from measurement. */
const HEIGHT_EPSILON = 0.5;

export interface VirtualFeedListProps<T> {
  items: T[];
  /** Stable identity per item; also the measurement key. */
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Height assumed for items that have not been measured yet, gap included. */
  estimateHeight?: number;
  /** Pixels of list rendered beyond each edge of the viewport. */
  overscan?: number;
  /**
   * Vertical space between items. Applied as padding on the item wrapper so it
   * is part of the measured box — the measurement and the spacing can then
   * never disagree.
   */
  gap?: number;
  className?: string;
  /** Key of the item to mark as the current destination of a jump. */
  highlightKey?: string | null;
}

export interface VirtualFeedListHandle {
  /**
   * Brings the item with this key to the top of the viewport. Returns false
   * when the list does not hold that key (yet).
   */
  scrollToKey: (key: string) => boolean;
}

/** Largest index whose item starts at or before `position`. */
function findStartIndex(starts: number[], sizes: number[], position: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = starts.length;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] + sizes[middle] >= position) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return Math.min(found, starts.length);
}

function VirtualFeedListInner<T>(
  {
    items,
    getKey,
    renderItem,
    estimateHeight = DEFAULT_ESTIMATE_HEIGHT,
    overscan = DEFAULT_OVERSCAN,
    gap = 16,
    className,
    highlightKey = null,
  }: VirtualFeedListProps<T>,
  ref: Ref<VirtualFeedListHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Measured heights by item key; entries survive unmounting so re-mounting is exact. */
  const heightsRef = useRef(new Map<string, number>());
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  // Bumped when a measurement changes so offsets and the window recompute.
  const [measureTick, setMeasureTick] = useState(0);
  // Visible band of the list, in list-local coordinates.
  const [band, setBand] = useState({ from: 0, to: 0 });

  const applyHeight = useCallback(
    (key: string, height: number) => {
      const rounded = Math.round(height * 100) / 100;
      if (rounded <= 0) return;

      const previous = heightsRef.current.get(key);
      if (previous !== undefined && Math.abs(previous - rounded) < HEIGHT_EPSILON) return;

      heightsRef.current.set(key, rounded);

      // Growth above the fold would otherwise shove what the reader is looking
      // at down the page, so compensate for the height delta. A first
      // measurement counts too: until an item is mounted its height is an
      // estimate, and replacing that estimate with a real (usually taller)
      // measurement moves everything below it exactly the same way.
      const node = nodesRef.current.get(key);
      if (node?.isConnected && node.getBoundingClientRect().bottom <= 0) {
        const delta = rounded - (previous ?? estimateHeight);
        if (delta !== 0) window.scrollBy(0, delta);
      }

      setMeasureTick((tick) => tick + 1);
    },
    [estimateHeight],
  );

  // One observer for the whole list. A detached node reports a zero box, which
  // applyHeight ignores, so stale observers are harmless.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        if (!node.isConnected) continue;
        const key = node.dataset.vkey;
        if (!key) continue;
        const borderBox = entry.borderBoxSize?.[0];
        const height = borderBox ? borderBox.blockSize : node.getBoundingClientRect().height;
        applyHeight(key, height);
      }
    });
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [applyHeight]);

  // Stable across renders, so React never detaches and re-attaches a node.
  const attachNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const key = node.dataset.vkey;
      if (!key) return;
      nodesRef.current.set(key, node);
      observerRef.current?.observe(node);
      // Measure before paint so the estimate is never seen.
      applyHeight(key, node.getBoundingClientRect().height);
    },
    [applyHeight],
  );

  const layout = useMemo(() => {
    const starts = new Array<number>(items.length);
    const sizes = new Array<number>(items.length);
    let total = 0;

    for (let index = 0; index < items.length; index += 1) {
      // Measured heights already include the wrapper's gap padding.
      const size = heightsRef.current.get(getKey(items[index], index)) ?? estimateHeight;
      starts[index] = total;
      sizes[index] = size;
      total += size;
    }

    return { starts, sizes, total };
    // `measureTick` is a deliberate invalidation signal, not a value this memo
    // reads: measured heights live in `heightsRef`, which the ResizeObserver
    // mutates, so the only way to recompute on a new measurement is to depend on
    // the counter its callback bumps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, getKey, estimateHeight, measureTick]);

  // Removing an item shifts everything below it up by that item's height. If the
  // removed post sat above the reader, compensate — otherwise the text they were
  // reading slides up the page under the cursor.
  const previousPositionsRef = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    for (let index = 0; index < items.length; index += 1) {
      nextPositions.set(getKey(items[index], index), layout.starts[index]);
    }

    const previous = previousPositionsRef.current;
    previousPositionsRef.current = nextPositions;
    if (!previous) return;

    // Only a pure removal (a post that was deleted) is compensated. A list that
    // is being *replaced* — a refresh swapping the page back to the newest posts
    // — also drops keys, and shifting the reader for that would fight the list
    // change itself instead of preserving their place.
    for (const key of nextPositions.keys()) {
      if (!previous.has(key)) return;
    }

    const container = containerRef.current;
    if (!container) return;
    // List-local offset of the viewport's top edge: anything ending above it has
    // already been scrolled past.
    const viewportTop = -container.getBoundingClientRect().top;

    let removedAbove = 0;
    for (const [key, start] of previous) {
      if (nextPositions.has(key)) continue;
      // Measured heights already include the wrapper's gap padding, so their sum
      // is exactly what the list shrank by.
      const height = heightsRef.current.get(key);
      if (height === undefined) continue;
      if (start + height <= viewportTop) removedAbove += height;
    }

    if (removedAbove > 0) window.scrollBy(0, -removedAbove);
  }, [items, getKey, layout]);

  const sync = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    const from = Math.max(0, -rect.top);
    const to = window.innerHeight - rect.top;

    setBand((previous) =>
      Math.abs(previous.from - from) < 1 && Math.abs(previous.to - to) < 1
        ? previous
        : { from, to },
    );
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };

    sync();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sync]);

  // Offsets and item count both move the window; re-sync whenever they do.
  useEffect(() => {
    sync();
  }, [sync, items.length, measureTick]);

  const range = useMemo(() => {
    if (items.length === 0) return { first: 0, last: 0 };

    const first = findStartIndex(layout.starts, layout.sizes, band.from - overscan);
    const stop = band.to + overscan;

    let last = first;
    while (last < items.length && layout.starts[last] < stop) last += 1;

    return { first, last };
  }, [items.length, layout, band, overscan]);

  /**
   * Jumping to an item needs no measurement guesswork: an item is positioned at
   * exactly its layout offset, so scrolling there lands on it whether its height
   * was measured or estimated. The scroll is instant rather than smooth because
   * a deep link can be tens of thousands of pixels away, and a long smooth
   * scroll would pass through every item on the way — mounting work for a card
   * the reader never looks at.
   */
  const timersRef = useRef<number[]>([]);
  const stopJumpRef = useRef<(() => void) | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToKey(key: string) {
        const index = items.findIndex((item, itemIndex) => getKey(item, itemIndex) === key);
        const container = containerRef.current;
        if (index < 0 || !container) return false;

        const header = document.querySelector("header");
        const headerOffset = header ? header.getBoundingClientRect().height + 12 : 0;
        const jumpTo = () => {
          const target =
            container.getBoundingClientRect().top + window.scrollY + layout.starts[index];
          window.scrollTo({ top: Math.max(0, target - headerOffset), behavior: "auto" });
        };

        stopJumpRef.current?.();
        jumpTo();

        // Landing is only exact once the items around the target have been
        // measured, and a jump can precede that by a frame or two, so the
        // position is re-checked shortly after. Any wheel, touch or key cancels
        // the remaining checks, so a correction can never fight the reader.
        let cancelled = false;
        const cancel = () => {
          cancelled = true;
          stop();
        };
        const stop = () => {
          for (const timer of timersRef.current) window.clearTimeout(timer);
          timersRef.current = [];
          window.removeEventListener("wheel", cancel);
          window.removeEventListener("touchstart", cancel);
          window.removeEventListener("keydown", cancel);
          if (stopJumpRef.current === cancel) stopJumpRef.current = null;
        };
        stopJumpRef.current = cancel;
        window.addEventListener("wheel", cancel, { passive: true });
        window.addEventListener("touchstart", cancel, { passive: true });
        window.addEventListener("keydown", cancel);

        // Spread over the window the target stays ringed: an item above it can
        // be measured late (an image finishing loading grows its card), and each
        // of those pushes the target further down.
        timersRef.current = [120, 400, 800, 1400, 2000, 2600].map((delay, position, all) =>
          window.setTimeout(() => {
            if (cancelled) return;
            const node = nodesRef.current.get(key);
            if (node?.isConnected) {
              const delta = node.getBoundingClientRect().top - headerOffset;
              if (Math.abs(delta) > 2) window.scrollBy(0, delta);
            }
            if (position === all.length - 1) stop();
          }, delay),
        );

        return true;
      },
    }),
    [items, getKey, layout.starts],
  );

  useEffect(() => () => stopJumpRef.current?.(), []);

  const visible: ReactNode[] = [];
  for (let index = range.first; index < range.last; index += 1) {
    const item = items[index];
    const key = getKey(item, index);
    visible.push(
      <div
        key={key}
        ref={attachNode}
        data-vkey={key}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingBottom: gap,
          transform: `translateY(${layout.starts[index]}px)`,
        }}
      >
        {/* The highlight wraps the card rather than the padded wrapper, so the
            ring hugs the post instead of the space beneath it. */}
        <div className={cn(key === highlightKey && "feed-highlight")}>{renderItem(item, index)}</div>
      </div>,
    );
  }

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", height: layout.total }}>
      {visible}
    </div>
  );
}

/**
 * `forwardRef` erases generics, so the exported component is re-typed to keep
 * the item type flowing from `items` through `renderItem`.
 */
export const VirtualFeedList = forwardRef(VirtualFeedListInner) as <T>(
  props: VirtualFeedListProps<T> & { ref?: Ref<VirtualFeedListHandle> },
) => ReactElement;
