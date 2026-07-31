/**
 * Schema module barrel.
 *
 * Importing this module (directly or transitively) triggers registration of
 * every component's schema via the side-effect imports at the top. Any code
 * that needs to look up a schema must import from here, not directly from
 * `./registry.js`, so the component registrations are guaranteed to have
 * run before the first lookup.
 *
 * Adding a new component:
 *   1. Create `src/component/{name}/schema.ts` that calls `registerComponentSchemas`.
 *   2. Add one line below.
 * Both changes together. Forgetting the line is caught by the drift test.
 */

// --- Component schema registrations (side-effect imports) -------------------
import '../component/animation-controller/schema.js';
import '../component/atlas-manager/schema.js';
import '../component/audio-effect/schema.js';
import '../component/audio-player/schema.js';
import '../component/audio-track/schema.js';
import '../component/camera/schema.js';
import '../component/cell-map/schema.js';
import '../component/collider/schema.js';
import '../component/data-layer/schema.js';
import '../component/event-collider/schema.js';
import '../component/flag-manager/schema.js';
import '../component/input-controller/schema.js';
import '../component/light/schema.js';
import '../component/messenger/schema.js';
import '../component/nexus/schema.js';
import '../component/sprite/schema.js';
import '../component/texture-map/schema.js';
import '../component/timer/schema.js';
import '../component/transform/schema.js';
import '../component/ui-overlay/schema.js';
import '../component/viewport/schema.js';

// --- Public API re-exports --------------------------------------------------
export type {
  ComponentAction,
  ComponentSchemaVersion,
  ComponentSchemas,
  PropertySchema,
  PropertyType,
} from './types.js';
export { compareVersions, resolveSchema } from './version.js';
export {
  getComponentSchemas,
  listRegisteredComponents,
  registerComponentSchemas,
} from './registry.js';
