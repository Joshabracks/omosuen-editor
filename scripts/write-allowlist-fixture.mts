import fs from 'node:fs';
import '../src/component/index.ts';
import { buildAllowlistFixtureFromRegistry } from '../src/editor-api/index.ts';

const fixture = buildAllowlistFixtureFromRegistry();
const types = Object.keys(fixture).sort();
const body = `/** Auto-synced from registered built-in schemas — update schemas, then re-run scripts/write-allowlist-fixture.mjs via tsx. */

import type { PropertyAllowlistFixture } from '../../editor-api';

export const BUILTIN_COMPONENT_COUNT = ${types.length};

export const BUILTIN_COMPONENT_TYPES = ${JSON.stringify(types, null, 2)} as const;

export const PROPERTY_ALLOWLIST_FIXTURE: PropertyAllowlistFixture = ${JSON.stringify(fixture, null, 2)};
`;

fs.writeFileSync(
  new URL('../src/test/fixtures/property-allowlist.ts', import.meta.url),
  body,
);
console.log('wrote fixture for', types.length, 'types');
