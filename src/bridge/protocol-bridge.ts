import type { EditorMessage } from '../protocol';

export type BridgeListener = (msg: EditorMessage) => void;

/**
 * In-process (or IPC-adapted) transport for protocol messages.
 * Encoding at process boundaries is the adapter's job; the registry
 * broker speaks typed `EditorMessage` values.
 */
export interface Bridge {
  readonly dispatch: (msg: EditorMessage) => void;
  readonly onMessage: (listener: BridgeListener) => () => void;
  readonly dispose: () => void;
}
