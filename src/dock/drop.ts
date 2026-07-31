import type { DropEdge } from './types';

export type DropZone = 'center' | DropEdge;

/**
 * Map pointer position within a panel rect to E13 drop affordance:
 * edge bands → split; center → tab.
 */
export function hitTestDropZone(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  edgeRatio = 0.25,
): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return 'center';
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const edge = Math.min(Math.max(edgeRatio, 0.05), 0.45);

  const distLeft = x;
  const distRight = 1 - x;
  const distTop = y;
  const distBottom = 1 - y;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  if (min > edge) return 'center';
  if (min === distLeft) return 'left';
  if (min === distRight) return 'right';
  if (min === distTop) return 'top';
  return 'bottom';
}
