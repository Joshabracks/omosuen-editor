/** Pure helpers for choosing which editor buffer receives an open. */

export type EditorOpenMode = 'reuse' | 'new-preview';

export interface OpenTargetInput {
  readonly mode: EditorOpenMode;
  readonly lastInteractedId: string | null;
  readonly activeId: string | null;
  readonly openIds: readonly string[];
}

export type OpenTargetResult =
  | { readonly kind: 'reuse'; readonly bufferId: string }
  | { readonly kind: 'create'; readonly preview: boolean };

export function resolveOpenTarget(input: OpenTargetInput): OpenTargetResult {
  if (input.mode === 'new-preview') {
    return { kind: 'create', preview: true };
  }

  const open = new Set(input.openIds);
  if (input.lastInteractedId && open.has(input.lastInteractedId)) {
    return { kind: 'reuse', bufferId: input.lastInteractedId };
  }
  if (input.activeId && open.has(input.activeId)) {
    return { kind: 'reuse', bufferId: input.activeId };
  }
  return { kind: 'create', preview: false };
}
