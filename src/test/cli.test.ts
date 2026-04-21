/**
 * CLI test entrypoint. Runs every test suite and exits with a non-zero code
 * if any test failed.
 */

import { runEngineFixtureTests } from './engine-fixtures.test.js';
import { reportAndExit } from './harness.js';
import { runOmosceneTests } from './omoscene.test.js';

runOmosceneTests();
await runEngineFixtureTests();
reportAndExit();
