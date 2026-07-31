/**
 * Audio editor — webview bootstrap (Phase 8.4 B-2).
 *
 * Thin shell that loads the engine UMD (via `extraScripts` set up by
 * the host's `prepareWebview`), wires the bridge, and hands control
 * to the engine scene module ([scene.ts](./scene.ts)) which owns
 * the actual UI (via `ui-overlay`), state (via `data-layer`), and
 * persistence (via `messenger`).
 *
 * The previous Phase B implementation hosted a State Street panel
 * and ran the engine as a side-thread; this version flips that —
 * the engine scene IS the editor, and the webview is just the iframe
 * that hosts it. See `.design/05-implementation-plan.md` §8.4 for
 * the architectural rationale + diff between the two approaches.
 */

import {
  createWebviewBridge,
  defaultWebviewTransport,
} from '../../bridge/index.js';
import type { EditorMessage } from '../../protocol/index.js';
import {
  applyIncomingMessenger,
  attachBridgeListener,
  buildAudioEditorScene,
  parseAudioEffect,
  type BuildAudioEditorSceneOptions,
} from './scene.js';
import type {
  OmosceneFile,
  SerializedComponent,
} from '../../omoscene/index.js';
import type { AudioTrackEntry } from '../../protocol/index.js';

interface BootstrapState {
  componentId: number | null;
  componentType: string | null;
  /** Most recent effect data parsed from the omoscene scene:load. */
  effectData: ReturnType<typeof parseAudioEffect> | null;
  /** Most recent track inventory from the host's audio:tracks push. */
  tracks: readonly AudioTrackEntry[];
  /** Whether the engine scene has been built for the current data. */
  sceneBuilt: boolean;
}

const state: BootstrapState = {
  componentId: readComponentIdFromBody(),
  componentType: null,
  effectData: null,
  tracks: [],
  sceneBuilt: false,
};

const bridge = createWebviewBridge({ transport: defaultWebviewTransport() });
attachBridgeListener(bridge);

bridge.onMessage((msg: EditorMessage) => {
  if (msg.kind === 'scene:load') {
    hydrateFromScene(msg.file);
    void rebuildIfReady();
    return;
  }
  if (msg.kind === 'component:update') {
    if (msg.id !== state.componentId) return;
    // The inspector edited the audio-effect we're hosting. Push the
    // change into the live engine scene via the same messenger
    // bridge we use for outgoing.
    applyIncomingMessenger({
      kind: 'messenger:send',
      pattern: 'audio-effect:incoming',
      data: { field: msg.property, value: msg.value },
    });
    return;
  }
  if (msg.kind === 'audio:tracks') {
    state.tracks = msg.tracks;
    state.sceneBuilt = false;
    void rebuildIfReady();
    return;
  }
  if (msg.kind === 'messenger:send') {
    applyIncomingMessenger(msg);
    return;
  }
});

function readComponentIdFromBody(): number | null {
  if (typeof document === 'undefined') return null;
  const raw = document.body.dataset['componentId'];
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hydrateFromScene(file: OmosceneFile): void {
  if (state.componentId === null) return;
  const target = findById(file.scene, state.componentId);
  if (target === null) return;
  state.componentType = target.type;
  state.effectData = parseAudioEffect(target);
  // A fresh scene:load may bring a different audio-effect snapshot
  // (e.g. the user reverted an edit on disk). Force a rebuild so
  // the engine state matches.
  state.sceneBuilt = false;
}

async function rebuildIfReady(): Promise<void> {
  if (state.componentId === null) return;
  if (state.effectData === null) return;
  if (state.sceneBuilt) return;
  state.sceneBuilt = true;
  const opts: BuildAudioEditorSceneOptions = {
    componentId: state.componentId,
    effectData: state.effectData,
    tracks: state.tracks,
  };
  try {
    await buildAudioEditorScene(opts);
  } catch (err) {
    console.warn('[audio-editor] scene rebuild failed', err);
    state.sceneBuilt = false;
  }
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue;
    const c = child as SerializedComponent;
    const hit = findById(c, id);
    if (hit !== null) return hit;
  }
  return null;
}
