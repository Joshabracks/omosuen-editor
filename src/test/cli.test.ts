/**
 * CLI test entrypoint. Runs every test suite and exits with a non-zero code
 * if any test failed.
 */

import { runBootstrapTests } from './bootstrap.test.js';
import { runBridgeTests } from './bridge.test.js';
import { runDocumentControllerTests } from './document-controller.test.js';
import { runDocumentRegistryTests } from './document-registry.test.js';
import { runEngineFixtureTests } from './engine-fixtures.test.js';
import { runGuardsTests } from './guards.test.js';
import { runInspectorWidgetsTests } from './inspector-widgets.test.js';
import { reportAndExit } from './harness.js';
import { runOmosceneTests } from './omoscene.test.js';
import { runPanelHTMLTests } from './panel-html.test.js';
import { runProtocolTests } from './protocol.test.js';
import { runSceneSanitizationTests } from './scene-sanitization.test.js';
import { runSchemaDriftTests } from './schema-drift.test.js';
import { runSchemaTests } from './schema.test.js';
import { runStateTests } from './state.test.js';

runBootstrapTests();
runBridgeTests();
runDocumentControllerTests();
runDocumentRegistryTests();
runGuardsTests();
runInspectorWidgetsTests();
runOmosceneTests();
runPanelHTMLTests();
runProtocolTests();
runSceneSanitizationTests();
runSchemaTests();
runStateTests();
await runEngineFixtureTests();
await runSchemaDriftTests();
reportAndExit();
