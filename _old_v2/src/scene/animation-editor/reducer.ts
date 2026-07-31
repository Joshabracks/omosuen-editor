/**
 * Pure animation-list reducer (Phase 8.2).
 *
 * Operates on the `animations` array serialized on an animation-
 * controller component. Every operation returns a new array (no
 * in-place mutation) so the webview's State Street bindings see a
 * reference change and re-render. Keeps all list shape knowledge in
 * one place — the webview emits `component:update` with whatever this
 * returns.
 *
 * Testable in isolation via tsx — no DOM, no vscode, no engine. The
 * harness in [src/test/animation-editor.test.ts](../../test/animation-editor.test.ts)
 * exercises each operation's return-new-array invariant.
 */

export interface AnimationEntry {
  readonly name: string;
  readonly frames: readonly number[];
  readonly frameRate: number;
  readonly loop: boolean;
  readonly onComplete?: string;
}

/**
 * Normalize an unknown value read off a serialized component into an
 * `AnimationEntry[]`. Tolerant on purpose — scenes authored by hand
 * can have string frames, missing frameRate, etc. Silently drops
 * unrecoverable entries rather than throwing.
 */
export function parseAnimations(raw: unknown): AnimationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AnimationEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec['name'] !== 'string') continue;
    const frames = Array.isArray(rec['frames'])
      ? rec['frames']
          .map((f) => (typeof f === 'number' ? f : Number.NaN))
          .filter((f) => Number.isFinite(f) && f >= 0)
      : [];
    const frameRate =
      typeof rec['frameRate'] === 'number' && Number.isFinite(rec['frameRate'])
        ? (rec['frameRate'] as number)
        : 12;
    const loop = rec['loop'] === true;
    const entry: AnimationEntry = {
      name: rec['name'] as string,
      frames,
      frameRate,
      loop,
    };
    if (typeof rec['onComplete'] === 'string' && rec['onComplete'] !== '') {
      Object.assign(entry, { onComplete: rec['onComplete'] });
    }
    out.push(entry);
  }
  return out;
}

export function addAnimation(
  animations: readonly AnimationEntry[],
  name: string,
): AnimationEntry[] {
  const trimmed = name.trim();
  if (trimmed === '') return [...animations];
  if (animations.some((a) => a.name === trimmed)) return [...animations];
  return [
    ...animations,
    { name: trimmed, frames: [], frameRate: 12, loop: false },
  ];
}

export function removeAnimation(
  animations: readonly AnimationEntry[],
  name: string,
): AnimationEntry[] {
  return animations.filter((a) => a.name !== name);
}

export function renameAnimation(
  animations: readonly AnimationEntry[],
  oldName: string,
  newName: string,
): AnimationEntry[] {
  const trimmed = newName.trim();
  if (trimmed === '' || trimmed === oldName) return [...animations];
  if (animations.some((a) => a.name === trimmed)) return [...animations];
  return animations.map((a) =>
    a.name === oldName ? { ...a, name: trimmed } : a,
  );
}

export function setFrameRate(
  animations: readonly AnimationEntry[],
  name: string,
  frameRate: number,
): AnimationEntry[] {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return [...animations];
  return animations.map((a) => (a.name === name ? { ...a, frameRate } : a));
}

export function setLoop(
  animations: readonly AnimationEntry[],
  name: string,
  loop: boolean,
): AnimationEntry[] {
  return animations.map((a) => (a.name === name ? { ...a, loop } : a));
}

export function appendFrame(
  animations: readonly AnimationEntry[],
  name: string,
  frameIndex: number,
): AnimationEntry[] {
  if (!Number.isFinite(frameIndex) || frameIndex < 0) return [...animations];
  return animations.map((a) =>
    a.name === name ? { ...a, frames: [...a.frames, frameIndex] } : a,
  );
}

/**
 * Insert a frame index BEFORE the given timeline position. Mirrors
 * `_old`'s palette-click-with-timeline-selection semantics
 * (`_old/src/editors/animation-editor.ts:734-749`): when the user has
 * a timeline frame selected, clicking the palette inserts before the
 * selection rather than appending. Position past-end appends; negative
 * appends as well (defensive — UI should never pass that).
 */
export function insertFrame(
  animations: readonly AnimationEntry[],
  name: string,
  position: number,
  frameIndex: number,
): AnimationEntry[] {
  if (!Number.isFinite(frameIndex) || frameIndex < 0) return [...animations];
  return animations.map((a) => {
    if (a.name !== name) return a;
    const clamped =
      !Number.isFinite(position) || position < 0 || position > a.frames.length
        ? a.frames.length
        : Math.floor(position);
    const next = [...a.frames];
    next.splice(clamped, 0, frameIndex);
    return { ...a, frames: next };
  });
}

/**
 * Set the `onComplete` callback name on an animation. Empty string
 * removes the field entirely (matches the parser's "drop empty string"
 * behaviour and the engine's expectation that absent === unset).
 */
export function setOnComplete(
  animations: readonly AnimationEntry[],
  name: string,
  onComplete: string,
): AnimationEntry[] {
  return animations.map((a) => {
    if (a.name !== name) return a;
    const trimmed = onComplete.trim();
    if (trimmed === '') {
      // Strip the field entirely so absent === unset (matches the
      // tolerant parser, which drops empty-string `onComplete`).
      const next: AnimationEntry = {
        name: a.name,
        frames: a.frames,
        frameRate: a.frameRate,
        loop: a.loop,
      };
      return next;
    }
    return { ...a, onComplete: trimmed };
  });
}

export function removeFrameAt(
  animations: readonly AnimationEntry[],
  name: string,
  position: number,
): AnimationEntry[] {
  return animations.map((a) => {
    if (a.name !== name) return a;
    if (position < 0 || position >= a.frames.length) return a;
    const frames = [
      ...a.frames.slice(0, position),
      ...a.frames.slice(position + 1),
    ];
    return { ...a, frames };
  });
}

export function moveFrame(
  animations: readonly AnimationEntry[],
  name: string,
  fromIndex: number,
  toIndex: number,
): AnimationEntry[] {
  return animations.map((a) => {
    if (a.name !== name) return a;
    if (
      fromIndex < 0 ||
      fromIndex >= a.frames.length ||
      toIndex < 0 ||
      toIndex >= a.frames.length ||
      fromIndex === toIndex
    ) {
      return a;
    }
    const frames = [...a.frames];
    const [moved] = frames.splice(fromIndex, 1);
    if (moved === undefined) return a;
    frames.splice(toIndex, 0, moved);
    return { ...a, frames };
  });
}

/**
 * Serialize an `AnimationEntry[]` back to the plain JsonValue shape
 * that round-trips through `omoscene/parse` + the engine. Returns a
 * fresh array; input is not mutated.
 */
export function serializeAnimations(
  animations: readonly AnimationEntry[],
): Record<string, unknown>[] {
  return animations.map((a) => {
    const entry: Record<string, unknown> = {
      name: a.name,
      frames: [...a.frames],
      frameRate: a.frameRate,
      loop: a.loop,
    };
    if (a.onComplete !== undefined) entry['onComplete'] = a.onComplete;
    return entry;
  });
}
