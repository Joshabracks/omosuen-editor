"use strict";
/**
 * Task Provider for Omosuen webpack build/watch tasks.
 * Registers three tasks: Build (Dev), Build (Prod), and Watch.
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
exports.registerBuildTasks = registerBuildTasks;
const vscode = __importStar(require("vscode"));
const TASK_CONFIGS = [
    {
        task: 'build:dev',
        label: 'Omosuen: Build (Dev)',
        args: '--config webpack.config.js --env mode=development',
        isBackground: false,
    },
    {
        task: 'build:prod',
        label: 'Omosuen: Build (Prod)',
        args: '--config webpack.config.js --env mode=production',
        isBackground: false,
    },
    {
        task: 'watch',
        label: 'Omosuen: Watch',
        args: '--config webpack.config.js --env mode=development --watch',
        isBackground: true,
    },
];
class OmosuenTaskProvider {
    async provideTasks() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }
        // Only provide tasks if the workspace has a webpack config
        const configs = await vscode.workspace.findFiles('webpack.config.{js,ts,mjs,cjs}', '**/node_modules/**', 1);
        if (configs.length === 0) {
            return [];
        }
        return TASK_CONFIGS.map((cfg) => this.createTask(cfg, workspaceFolder));
    }
    resolveTask(task) {
        const definition = task.definition;
        const config = TASK_CONFIGS.find((c) => c.task === definition.task);
        if (!config) {
            return undefined;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }
        return this.createTask(config, workspaceFolder);
    }
    createTask(cfg, workspaceFolder) {
        const definition = {
            type: 'omosuen',
            task: cfg.task,
        };
        const execution = new vscode.ShellExecution(`npx webpack ${cfg.args}`, {
            cwd: workspaceFolder.uri.fsPath,
        });
        const task = new vscode.Task(definition, workspaceFolder, cfg.label, 'omosuen', execution);
        task.group = vscode.TaskGroup.Build;
        task.isBackground = cfg.isBackground;
        return task;
    }
}
function registerBuildTasks(context) {
    context.subscriptions.push(vscode.tasks.registerTaskProvider('omosuen', new OmosuenTaskProvider()));
}
//# sourceMappingURL=build.js.map