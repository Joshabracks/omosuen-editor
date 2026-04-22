/**
 * CLI test entrypoint. Runs every test suite and exits with a non-zero code
 * if any test failed.
 */

import { runEngineFixtureTests } from './engine-fixtures.test.js';
import { runGuardsTests } from './guards.test.js';
import { reportAndExit } from './harness.js';
import { runOmosceneTests } from './omoscene.test.js';
import { runProtocolTests } from './protocol.test.js';
import { runSchemaDriftTests } from './schema-drift.test.js';
import { runSchemaTests } from './schema.test.js';
import { runStateTests } from './state.test.js';

runGuardsTests();
runOmosceneTests();
runProtocolTests();
runSchemaTests();
runStateTests();
await runEngineFixtureTests();
await runSchemaDriftTests();
reportAndExit();
