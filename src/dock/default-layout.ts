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
            createTabGroup(
              'tabs-left',
              ['scene-tree', 'file-explorer'],
              'scene-tree',
            ),
            createTabGroup(
              'tabs-center',
              ['viewport', 'text-buffer'],
              'viewport',
            ),
            createTabGroup('tabs-right', ['inspector'], 'inspector'),
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
