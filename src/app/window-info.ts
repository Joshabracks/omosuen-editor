import type { WindowInfo } from '../bridge/channels';

/** Parse role / windowId / viewId(s) from a BrowserWindow loadFile query string. */
export function parseWindowInfoFromLocation(search: string): WindowInfo {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const role = params.get('role') === 'popout' ? 'popout' : 'primary';
  const windowId = params.get('windowId') || 'local';
  const viewIdsParam = params.get('viewIds');
  const single = params.get('viewId');
  const viewIds =
    viewIdsParam && viewIdsParam.length > 0
      ? viewIdsParam.split(',').filter(Boolean)
      : single
        ? [single]
        : [];
  return {
    role,
    windowId,
    viewId: role === 'popout' ? (viewIds[0] ?? null) : null,
    floating: params.get('floating') === '1',
  };
}

export function parseViewIdsFromLocation(search: string): string[] {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const viewIdsParam = params.get('viewIds');
  if (viewIdsParam && viewIdsParam.length > 0) {
    return viewIdsParam.split(',').filter(Boolean);
  }
  const single = params.get('viewId');
  return single ? [single] : [];
}
