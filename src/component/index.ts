/**
 * Side-effect imports: register every built-in editor contribution (E16 / 2d).
 * Import this module before resolving types for inspector / drift.
 */

import './animation-controller/schema';
import './animation-map/schema';
import './atlas-manager/schema';
import './audio-effect/schema';
import './audio-player/schema';
import './audio-track/schema';
import './camera/schema';
import './cell-map/schema';
import './collider/schema';
import './data-layer/schema';
import './event-collider/schema';
import './flag-manager/schema';
import './input-controller/schema';
import './light/schema';
import './messenger/schema';
import './nexus/schema';
import './speed-dial/schema';
import './sprite/schema';
import './texture-map/schema';
import './timer/schema';
import './transform/schema';
import './ui-overlay/schema';
import './viewport/schema';

export { listEditorTypes, resolveEditorType } from '../editor-api';
