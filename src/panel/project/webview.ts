/**
 * Project activity-bar view (Post-8 gap-fill).
 *
 * The first view under the Omosuen activity-bar container. Today it
 * hosts a single "Create New Project…" button; future project-settings
 * controls accrete into this panel over time.
 *
 * No bridge subscriptions needed — the panel doesn't care about the
 * active document. Clicking the button emits `command:invoke` with no
 * args; the host forwarder at [extension.ts](../../app/extension.ts)
 * runs `vscode.commands.executeCommand('omosuen.newProject')`.
 */

import { State } from 'state-street';
import { commandInvoke } from '../../protocol/index.js';
import { bootstrapPanel } from '../bootstrap.js';

interface PanelData {
  title: string;
}

const template = /* html */ `
<body>
  <div style="padding: 0.75em;">
    <h3 style="margin: 0 0 0.75em 0; font-size: 1em;">{{title}}</h3>
    <button
      type="button"
      :click=newProject()
      style="width: 100%; padding: 0.5em; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; font-size: 0.95em;"
    >Create New Project…</button>
    <p style="margin-top: 1em; color: var(--vscode-descriptionForeground); font-size: 0.85em;">
      More project settings will appear here in future releases.
    </p>
  </div>
</body>
`;

bootstrapPanel<PanelData>({
  template,
  initialData: { title: 'Omosuen Project' },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  methods: {
    newProject: ({ bridge }) => {
      bridge.dispatch(commandInvoke('omosuen.newProject'));
    },
  },
});
