import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanWorkspace } from './scanner';
import type { HostToWebview, WebviewToHost } from './types';

let panel: vscode.WebviewPanel | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let scanning = false;
let pendingRefresh = false;

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusItem.text = '$(symbol-structure) STELLAR';
  statusItem.tooltip = 'Open the 3D Stellar Workspace map';
  statusItem.command = 'stellarWorkspace.show';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('stellarWorkspace.show', () => openMap(context)),
    vscode.commands.registerCommand('stellarWorkspace.refresh', () => {
      if (panel) {
        void sendWorkspaceData(panel, true);
      } else {
        void vscode.commands.executeCommand('stellarWorkspace.show');
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (panel) {
        void sendWorkspaceData(panel, true);
      }
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
  panel = undefined;
}

function openMap(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal(undefined, false);
    return;
  }

  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  panel = vscode.window.createWebviewPanel(
    'stellarWorkspace.map',
    'Stellar Workspace',
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    },
  );

  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
  panel.webview.html = getHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(
    (message: WebviewToHost) => void handleMessage(message, panel!),
    undefined,
    context.subscriptions,
  );

  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    undefined,
    context.subscriptions,
  );
}

async function handleMessage(message: WebviewToHost, target: vscode.WebviewPanel): Promise<void> {
  switch (message.type) {
    case 'ready':
      await sendWorkspaceData(target, true);
      break;
    case 'refresh':
      await sendWorkspaceData(target, true);
      break;
    case 'reveal':
      await revealPath(message.path);
      break;
    case 'open':
      await openPath(message.path);
      break;
  }
}

async function revealPath(relPath: string): Promise<void> {
  const root = currentRoot();
  if (!root) {
    return;
  }
  const uri = vscode.Uri.file(path.join(root.fsPath, relPath));
  await vscode.commands.executeCommand('revealInExplorer', uri);
}

async function openPath(relPath: string): Promise<void> {
  const root = currentRoot();
  if (!root) {
    return;
  }
  const uri = vscode.Uri.file(path.join(root.fsPath, relPath));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    void vscode.window.showWarningMessage(`Stellar Workspace: could not open ${relPath}`);
  }
}

function currentRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function sendWorkspaceData(target: vscode.WebviewPanel, announce: boolean): Promise<void> {
  if (scanning) {
    pendingRefresh = true;
    return;
  }

  const root = currentRoot();
  if (!root) {
    post(target, { type: 'error', message: 'Open a folder to map a workspace.' });
    return;
  }

  scanning = true;
  try {
    if (announce) {
      post(target, { type: 'status', message: 'Scanning workspace…' });
    }
    const data = await scanWorkspace(root.fsPath);
    post(target, { type: 'data', payload: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post(target, { type: 'error', message: `Scan failed: ${message}` });
  } finally {
    scanning = false;
    if (pendingRefresh && panel) {
      pendingRefresh = false;
      void sendWorkspaceData(panel, false);
    }
  }
}

function post(target: vscode.WebviewPanel, message: HostToWebview): void {
  target.webview.postMessage(message).then(undefined, () => undefined);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
  const htmlPath = vscode.Uri.joinPath(mediaRoot, 'index.html').fsPath;
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.css'));
  const nonce = createNonce();

  return fs
    .readFileSync(htmlPath, 'utf8')
    .replaceAll('{{nonce}}', nonce)
    .replaceAll('{{scriptUri}}', scriptUri.toString())
    .replaceAll('{{styleUri}}', styleUri.toString())
    .replaceAll('{{cspSource}}', webview.cspSource);
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
