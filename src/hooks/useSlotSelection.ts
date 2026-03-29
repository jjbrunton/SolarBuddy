'use client';

import { useState, useCallback, useRef } from 'react';
import type { RefObject, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

interface UseSlotSelectionParams {
  containerRef: RefObject<HTMLDivElement | null>;
  slotCount: number;
  chartLeftMargin: number;
  chartRightMargin: number;
  enabled: boolean;
}

interface UseSlotSelectionReturn {
  selectedIndices: Set<number>;
  isDragging: boolean;
  dragRange: [number, number] | null;
  setSelectedIndices: (indices: Set<number>) => void;
  clearSelection: () => void;
  handlers: {
    onMouseDown: (e: ReactMouseEvent) => void;
    onMouseMove: (e: ReactMouseEvent) => void;
    onMouseUp: () => void;
    onTouchStart: (e: ReactTouchEvent) => void;
    onTouchMove: (e: ReactTouchEvent) => void;
    onTouchEnd: () => void;
  };
}

function getIndexFromX(
  clientX: number,
  containerRect: DOMRect,
  slotCount: number,
  leftMargin: number,
  rightMargin: number,
): number {
  const chartWidth = containerRect.width - leftMargin - rightMargin;
  const relativeX = clientX - containerRect.left - leftMargin;
  const index = Math.floor((relativeX / chartWidth) * slotCount);
  return Math.max(0, Math.min(slotCount - 1, index));
}

export function useSlotSelection({
  containerRef,
  slotCount,
  chartLeftMargin,
  chartRightMargin,
  enabled,
}: UseSlotSelectionParams): UseSlotSelectionReturn {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragRange, setDragRange] = useState<[number, number] | null>(null);

  const dragStartIndex = useRef<number | null>(null);
  const selectionMode = useRef<'add' | 'remove'>('add');

  const startDrag = useCallback(
    (clientX: number) => {
      if (!enabled || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const idx = getIndexFromX(clientX, rect, slotCount, chartLeftMargin, chartRightMargin);
      dragStartIndex.current = idx;
      selectionMode.current = selectedIndices.has(idx) ? 'remove' : 'add';
      setIsDragging(true);
      setDragRange([idx, idx]);
    },
    [enabled, containerRef, slotCount, chartLeftMargin, chartRightMargin, selectedIndices],
  );

  const moveDrag = useCallback(
    (clientX: number) => {
      if (!isDragging || dragStartIndex.current === null || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const idx = getIndexFromX(clientX, rect, slotCount, chartLeftMargin, chartRightMargin);
      const start = Math.min(dragStartIndex.current, idx);
      const end = Math.max(dragStartIndex.current, idx);
      setDragRange([start, end]);
    },
    [isDragging, containerRef, slotCount, chartLeftMargin, chartRightMargin],
  );

  const endDrag = useCallback(() => {
    if (!isDragging || !dragRange) {
      setIsDragging(false);
      return;
    }

    const [start, end] = dragRange;
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      for (let i = start; i <= end; i++) {
        if (selectionMode.current === 'add') {
          next.add(i);
        } else {
          next.delete(i);
        }
      }
      return next;
    });

    setIsDragging(false);
    setDragRange(null);
    dragStartIndex.current = null;
  }, [isDragging, dragRange]);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handlers = {
    onMouseDown: (e: ReactMouseEvent) => {
      e.preventDefault();
      startDrag(e.clientX);
    },
    onMouseMove: (e: ReactMouseEvent) => moveDrag(e.clientX),
    onMouseUp: () => endDrag(),
    onTouchStart: (e: ReactTouchEvent) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientX);
      }
    },
    onTouchMove: (e: ReactTouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        moveDrag(e.touches[0].clientX);
      }
    },
    onTouchEnd: () => endDrag(),
  };

  return {
    selectedIndices,
    isDragging,
    dragRange,
    setSelectedIndices,
    clearSelection,
    handlers,
  };
}
