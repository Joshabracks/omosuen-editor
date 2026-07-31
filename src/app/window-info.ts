import type { WindowInfo } from '../bridge/channels';

/** Parse role / windowId / viewId from a BrowserWindow loadFile query string. */
export function parseWindowInfoFromLocation(search: string): WindowInfo {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const role = params.get('role') === 'popout' ? 'popout' : 'primary';
  const windowId = params.get('windowId') || 'local';
  const viewId = params.get('viewId');
  return {
    role,
    windowId,
    viewId: role === 'popout' ? viewId : null,
    floating: params.get('floating') === '1',
  };
}
