import { createSplit, createTabGroup, type DockLayout } from './types';

/** Default layout approximating tree | main | inspector + bottom tabs. */
export function createDefaultLayout(): DockLayout {
  return {
    root: createSplit(
      'split-main',
      'vertical',
      [
        createSplit(
          'split-row',
          'horizontal',
          [
            createTabGroup('tabs-left', ['empty-a'], 'empty-a'),
            createTabGroup('tabs-center', ['empty-b'], 'empty-b'),
            createTabGroup('tabs-right', ['empty-c'], 'empty-c'),
          ],
          [0.22, 0.56, 0.22],
        ),
        createTabGroup(
          'tabs-bottom',
          ['empty-d', 'empty-e'],
          'empty-d',
        ),
      ],
      [0.72, 0.28],
    ),
  };
}
