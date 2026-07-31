"use strict";
/**
 * "Omosuen: Change Engine Version" command.
 * Updates the engine dependency in an existing project without
 * requiring a full project re-creation.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChangeVersionCommand = registerChangeVersionCommand;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const create_project_1 = require("./create-project");
function registerChangeVersionCommand(context) {
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.changeVersion', async () => {
        // 1. Find workspace root
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const rootDir = folders[0].uri.fsPath;
        const pkgPath = path.join(rootDir, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            vscode.window.showErrorMessage('No package.json found in workspace root.');
            return;
        }
        // 2. Parse current omosuen dependency tag
        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        }
        catch {
            vscode.window.showErrorMessage('Failed to parse package.json.');
            return;
        }
        const deps = pkg.dependencies;
        const dep = deps?.omosuen;
        if (!dep) {
            vscode.window.showErrorMessage('No omosuen dependency found in package.json. Is this an Omosuen project?');
            return;
        }
        const currentTag = dep.includes('#') ? dep.split('#').pop() : null;
        // 3. Fetch available releases from GitHub
        let releases;
        try {
            releases = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching Omosuen releases...',
                cancellable: false,
            }, () => (0, create_project_1.fetchReleases)());
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to fetch releases: ${message}`);
            return;
        }
        if (releases.length === 0) {
            vscode.window.showErrorMessage('No releases found on the Omosuen repository.');
            return;
        }
        // 4. Show QuickPick with versions (mark current)
        const picked = await vscode.window.showQuickPick(releases.map((r) => ({
            label: r.tag,
            description: r.tag === currentTag
                ? '(current)'
                : r.label !== r.tag
                    ? r.label
                    : undefined,
        })), {
            placeHolder: `Current: ${currentTag || 'unknown'}`,
            title: 'Omosuen: Change Engine Version',
        });
        if (!picked) {
            return;
        }
        if (picked.label === currentTag) {
            vscode.window.showInformationMessage(`Already on ${currentTag}.`);
            return;
        }
        const newTag = picked.label;
        // 5-7. Update package.json, npm install, download engine bundle
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating engine to ${newTag}...`,
                cancellable: false,
            }, async (progress) => {
                // Update package.json dependency
                progress.report({ message: 'Updating package.json...' });
                deps.omosuen = `github:Joshabracks/omosuen#${newTag}`;
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
                // Run npm install
                progress.report({
                    message: 'Installing dependencies (this may take a minute)...',
                });
                await (0, create_project_1.runCommand)('npm', ['install'], rootDir);
                // Download engine UMD bundle for editor preview
                progress.report({ message: 'Downloading engine bundle...' });
                const editorDir = path.join(rootDir, '.omosuen_editor');
                fs.mkdirSync(editorDir, { recursive: true });
                const bundleUrl = `https://github.com/Joshabracks/omosuen/releases/download/${newTag}/omosuen.min.js`;
                await (0, create_project_1.httpsDownloadFile)(bundleUrl, path.join(editorDir, 'omosuen.min.js'));
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to update engine: ${message}`);
            return;
        }
        // 8. Success
        vscode.window.showInformationMessage(`Engine updated: ${currentTag || 'unknown'} → ${newTag}`);
    }));
}
//# sourceMappingURL=change-version.js.map