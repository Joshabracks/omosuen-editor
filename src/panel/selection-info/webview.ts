/**
 * Selection Info webview — Phase 4.5 sample.
 *
 * Proves the Phase 4 exit criterion: a panel showing live state-store
 * subscription with zero panel-specific lifecycle code. All lifecycle
 * (CSP, bridge, focus-or-open) is handled by `registerPanel` on the
 * extension-host side and `bootstrapPanel` here. Adding a second panel
 * is one more file like this plus one more `registerPanel` call.
 *
 * Flow: button click → `bridge.dispatch(componentSelect([id]))` →
 *   extension host echoes → webview receives via bridge →
 *   `wireIncoming` forwards into per-webview `createEditorState` →
 *   `selection` store updates → subscriber maps into `state.data` →
 *   State Street re-renders.
 */

import { State } from 'state-street';
import { componentSelect } from '../../protocol/index.js';
import { createEditorState } from '../../state/index.js';
import { bootstrapPanel } from '../bootstrap.js';

interface PanelData {
  selectionText: string;
}

// Per-webview canonical store (Phase 3.5.1 Option A). Each webview
// instance of this module gets its own `editor` — module state is safe
// because the webview has its own JS realm.
const editor = createEditorState();

const template = /* html */ `
<body>
  <div style="padding: 1em;">
    <h3 style="margin-top: 0;">Selection</h3>
    <div style="margin-bottom: 1em; font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground);">
      {{selectionText}}
    </div>
    <button :click=randomSelect()>Random Select</button>
  </div>
</body>
`;

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: { selectionText: '(none)' },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  methods: {
    randomSelect: ({ bridge }) => {
      const id = Math.floor(Math.random() * 100);
      bridge.dispatch(componentSelect([id]));
    },
  },
  wireIncoming: (msg) => {
    // Every incoming message flows into the per-webview canonical store.
    // We rely on the store's typed dispatch (not the bridge's raw path)
    // so Phase 3's discriminated-union exhaustiveness covers us.
    editor.dispatch(msg);
  },
});

// Pattern 1: canonical store is `editor.selection`; `state.data` holds
// only what the template renders.
editor.selection.subscribe((ids) => {
  panel.state.data.selectionText = ids.length === 0 ? '(none)' : ids.join(', ');
});
