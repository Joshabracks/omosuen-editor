/**
 * "Omosuen: Create New Project" command.
 * Scaffolds a TypeScript/webpack game project that installs omosuen
 * from GitHub and bundles .omoscene files via raw-loader.
 */
import * as vscode from 'vscode';
export interface ReleaseOption {
    tag: string;
    label: string;
}
export declare function fetchReleases(): Promise<ReleaseOption[]>;
/**
 * Downloads a file from a URL to a local path, following redirects.
 * Exported for reuse by editors that need to fetch engine assets on-demand.
 */
export declare function httpsDownloadFile(url: string, destPath: string): Promise<void>;
export declare function runCommand(command: string, args: string[], cwd: string): Promise<string>;
export declare function registerCreateProjectCommand(context: vscode.ExtensionContext): void;
