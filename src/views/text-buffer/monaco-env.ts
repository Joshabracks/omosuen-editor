/** Configure Monaco worker URLs (call before creating the editor). */

export function installMonacoEnvironment(): void {
  (globalThis as typeof globalThis & {
    MonacoEnvironment: {
      getWorker(_: string, label: string): Worker;
    };
  }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      const base = new URL('./monaco/', window.location.href).href;
      const file = workerFileForLabel(label);
      return new Worker(new URL(file, base).href);
    },
  };
}

function workerFileForLabel(label: string): string {
  switch (label) {
    case 'json':
      return 'json.worker.js';
    case 'css':
    case 'scss':
    case 'less':
      return 'css.worker.js';
    case 'html':
    case 'handlebars':
    case 'razor':
      return 'html.worker.js';
    case 'typescript':
    case 'javascript':
      return 'ts.worker.js';
    default:
      return 'editor.worker.js';
  }
}
