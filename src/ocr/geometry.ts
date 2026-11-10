import type { Box, Point } from './types';

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.left + b.width);
    bottom = Math.max(bottom, b.top + b.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function centerOf(box: Box): Point {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
