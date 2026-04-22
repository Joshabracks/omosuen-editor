/**
 * CLI test entrypoint. Runs every test suite and exits with a non-zero code
 * if any test failed.
 */

import { runAnimationEditorTests } from './animation-editor.test.js';
import { runBootstrapTests } from './bootstrap.test.js';
import { runBridgeTests } from './bridge.test.js';
import { runDocumentControllerTests } from './document-controller.test.js';
import { runDocumentRegistryTests } from './document-registry.test.js';
import { runGitHubReleasesTests } from './github-releases.test.js';
import { runEngineFixtureTests } from './engine-fixtures.test.js';
import { runGuardsTests } from './guards.test.js';
import { runInspectorWidgetsTests } from './inspector-widgets.test.js';
import { reportAndExit } from './harness.js';
import { runOmosceneTests } from './omoscene.test.js';
import { runPanelHTMLTests } from './panel-html.test.js';
import { runPreviewServerTests } from './preview-server.test.js';
import { runProjectTemplateTests } from './project-template.test.js';
import { runProtocolTests } from './protocol.test.js';
import { runSceneSanitizationTests } from './scene-sanitization.test.js';
import { runSchemaDriftTests } from './schema-drift.test.js';
import { runSchemaTests } from './schema.test.js';
import { runStateTests } from './state.test.js';
import { runWebsocketHostBridgeTests } from './websocket-host-bridge.test.js';

runAnimationEditorTests();
runBootstrapTests();
runBridgeTests();
runDocumentControllerTests();
runDocumentRegistryTests();
runGitHubReleasesTests();
runGuardsTests();
runInspectorWidgetsTests();
runOmosceneTests();
runPanelHTMLTests();
runProjectTemplateTests();
runProtocolTests();
runSceneSanitizationTests();
runSchemaTests();
runStateTests();
await runEngineFixtureTests();
await runPreviewServerTests();
await runSchemaDriftTests();
await runWebsocketHostBridgeTests();
reportAndExit();
