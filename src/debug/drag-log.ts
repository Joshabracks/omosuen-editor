/** Debug logging for dock / multi-window drag. Visible in DevTools + main terminal. */
const PREFIX = '[omosuen:drag]';

export function dragLog(
  scope: 'renderer' | 'main' | 'controller',
  message: string,
  data?: Record<string, unknown>,
): void {
  if (data) {
    console.log(`${PREFIX} [${scope}] ${message}`, data);
  } else {
    console.log(`${PREFIX} [${scope}] ${message}`);
  }
}
