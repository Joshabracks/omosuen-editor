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
            createTabGroup('tabs-left', ['file-explorer'], 'file-explorer'),
            createTabGroup(
              'tabs-center',
              ['empty-b', 'text-buffer'],
              'empty-b',
            ),
            createTabGroup('tabs-right', ['empty-c'], 'empty-c'),
          ],
          [0.22, 0.56, 0.22],
        ),
        createTabGroup(
          'tabs-bottom',
          ['output', 'problems'],
          'output',
        ),
      ],
      [0.72, 0.28],
    ),
  };
}
