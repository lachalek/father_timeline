import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { TimelineLayout } from './useAspectRatio';

export type DragPoint = {
  x: number;
  y: number;
  slot: number | null;
};

export type CardPointerHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

const DRAG_THRESHOLD_PX = 8;

const readSlot = (node: Element): number | null => {
  if (!(node instanceof HTMLButtonElement)) return null;
  const raw = node.dataset.slot;
  if (raw == null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
};

export const useCardDrag = ({
  enabled,
  layout,
  scrollerRef,
  onDrop,
}: {
  enabled: boolean;
  layout: TimelineLayout;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onDrop: (slot: number) => void;
}): { drag: DragPoint | null; handlers: CardPointerHandlers } => {
  const [drag, setDrag] = useState<DragPoint | null>(null);
  const point = useRef({ x: 0, y: 0, pointerId: -1 });
  const origin = useRef({ x: 0, y: 0 });

  const hitTest = useCallback(
    (x: number, y: number): number | null => {
      const board = scrollerRef.current;
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      const pad = 28;
      const onBoard =
        layout === 'row'
          ? y >= rect.top - pad && y <= rect.bottom + pad
          : x >= rect.left - pad && x <= rect.right + pad;
      if (!onBoard) return null;
      let bestIndex: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of board.querySelectorAll('[data-slot]')) {
        const slot = readSlot(node);
        if (slot === null) continue;
        const slotRect = node.getBoundingClientRect();
        const center =
          layout === 'row'
            ? slotRect.left + slotRect.width / 2
            : slotRect.top + slotRect.height / 2;
        const pointer = layout === 'row' ? x : y;
        const distance = Math.abs(pointer - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = slot;
        }
      }
      return bestIndex;
    },
    [layout, scrollerRef]
  );

  const dragging = drag !== null && enabled;

  useEffect(() => {
    if (!dragging) return undefined;
    let frame = 0;
    const tick = () => {
      const board = scrollerRef.current;
      if (board) {
        const rect = board.getBoundingClientRect();
        const edge = 56;
        const speed = 16;
        if (layout === 'row') {
          if (point.current.x < rect.left + edge) board.scrollLeft -= speed;
          else if (point.current.x > rect.right - edge)
            board.scrollLeft += speed;
        } else if (point.current.y < rect.top + edge) board.scrollTop -= speed;
        else if (point.current.y > rect.bottom - edge) board.scrollTop += speed;
      }
      const slot = hitTest(point.current.x, point.current.y);
      setDrag((current) => {
        if (!current || current.slot === slot) return current;
        return { ...current, slot };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const blockTouch = (event: TouchEvent) => {
      event.preventDefault();
    };
    document.addEventListener('touchmove', blockTouch, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('touchmove', blockTouch);
    };
  }, [dragging, hitTest, layout, scrollerRef]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    event.preventDefault();
    point.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    origin.current = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture fails if the pointer is already gone. Move events still track the drag.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || point.current.pointerId !== event.pointerId) return;
    point.current.x = event.clientX;
    point.current.y = event.clientY;
    const distance = Math.hypot(
      event.clientX - origin.current.x,
      event.clientY - origin.current.y
    );
    if (distance < DRAG_THRESHOLD_PX && drag === null) return;
    setDrag({
      x: event.clientX,
      y: event.clientY,
      slot: hitTest(event.clientX, event.clientY),
    });
  };

  const finish = (event: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    if (point.current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - origin.current.x,
      event.clientY - origin.current.y
    );
    const slot =
      commit && enabled && distance >= DRAG_THRESHOLD_PX
        ? hitTest(event.clientX, event.clientY)
        : null;
    point.current.pointerId = -1;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (slot !== null) onDrop(slot);
  };

  return {
    drag: enabled ? drag : null,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finish(event, true),
      onPointerCancel: (event) => finish(event, false),
    },
  };
};
