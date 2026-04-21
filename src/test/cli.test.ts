/**
 * CLI test entrypoint. Runs every test suite and exits with a non-zero code
 * if any test failed.
 */

import { runEngineFixtureTests } from './engine-fixtures.test.js';
import { reportAndExit } from './harness.js';
import { runOmosceneTests } from './omoscene.test.js';
import { runSmokeTests } from './smoke.test.js';

runSmokeTests();
runOmosceneTests();
await runEngineFixtureTests();
reportAndExit();
