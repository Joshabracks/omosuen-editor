import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import { collectViewIds } from '../dock/mutations';
import {
  encodeExplorerPath,
  renderFileTree,
  type TreeNodeState,
} from '../views/file-explorer';
import {
  OUTPUT_VIEW_ID,
  renderOutputLine,
} from '../views/output';
import {
  formatProblemLocation,
  PROBLEMS_VIEW_ID,
  renderProblemRow,
} from '../views/problems';

test('default layout hosts Output and Problems on the bottom tabs', () => {
  const ids = collectViewIds(createDefaultLayout().root);
  assert.ok(ids.includes(OUTPUT_VIEW_ID));
  assert.ok(ids.includes(PROBLEMS_VIEW_ID));
});

test('formatProblemLocation includes path, line, column, and source', () => {
  assert.equal(
    formatProblemLocation({
      id: '1',
      severity: 'error',
      message: 'x',
      relativePath: 'src/app.ts',
      line: 12,
      column: 4,
      source: 'ts',
    }),
    'src/app.ts:12:4 · ts',
  );
  assert.equal(
    formatProblemLocation({
      id: '2',
      severity: 'info',
      message: 'y',
      source: 'shell',
    }),
    'shell',
  );
});

test('output / problems / files row HTML uses State Street bindings', () => {
  assert.match(
    renderOutputLine({
      id: 'out-1',
      level: 'info',
      message: 'hello',
      timestamp: 0,
    }),
    /output-message/,
  );

  const openable = renderProblemRow({
    id: 'p1',
    severity: 'error',
    message: 'boom',
    relativePath: 'a.ts',
    line: 1,
  });
  assert.match(openable, /:click=openProblem\(id="p1"\)/);
  assert.doesNotMatch(openable, /disabled/);

  const blocked = renderProblemRow({
    id: 'p2',
    severity: 'info',
    message: 'note',
  });
  assert.match(blocked, /disabled="disabled"/);
  assert.doesNotMatch(blocked, /:click=/);

  const tree: TreeNodeState[] = [
    {
      entry: {
        name: 'src',
        relativePath: 'src',
        kind: 'directory',
      },
      expanded: false,
      children: null,
      loading: false,
    },
    {
      entry: {
        name: 'readme.md',
        relativePath: 'readme.md',
        kind: 'file',
      },
      expanded: false,
      children: null,
      loading: false,
    },
  ];
  const html = renderFileTree(tree);
  assert.match(html, /:click=onRowClick\(/);
  assert.match(html, /:dblclick=onRowDblClick\(/);
  assert.match(html, /:contextmenu=onRowContext\(/);
  assert.ok(html.includes(encodeExplorerPath('readme.md')));
});
