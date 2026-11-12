import './style.css';
import type { DirNode, HostToWebview, WorkspaceData, WorkspaceStats } from '../src/types';
import { CATEGORY_HEX, categoryOf } from './fileColors';
import { StellarScene, type HoverInfo } from './scene';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const el = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
};

const canvas = el<HTMLCanvasElement>('scene');
const workspaceNameEl = el<HTMLSpanElement>('workspace-name');
const statusTextEl = el<HTMLSpanElement>('status-text');
const statFilesEl = el<HTMLSpanElement>('stat-files');
const statDirsEl = el<HTMLSpanElement>('stat-dirs');
const statSizeEl = el<HTMLSpanElement>('stat-size');
const statDepthEl = el<HTMLSpanElement>('stat-depth');
const compositionEl = el<HTMLDivElement>('composition');
const truncatedEl = el<HTMLDivElement>('truncated');
const tooltipEl = el<HTMLDivElement>('tooltip');
const tooltipKindEl = el<HTMLDivElement>('tooltip-kind');
const tooltipNameEl = el<HTMLDivElement>('tooltip-name');
const tooltipMetaEl = el<HTMLDivElement>('tooltip-meta');
const detailEl = el<HTMLElement>('detail');
const detailNameEl = el<HTMLHeadingElement>('detail-name');
const detailPathEl = el<HTMLDivElement>('detail-path');
const detailFilesEl = el<HTMLElement>('detail-files');
const detailDirsEl = el<HTMLElement>('detail-dirs');
const detailSizeEl = el<HTMLElement>('detail-size');
const detailRevealEl = el<HTMLButtonElement>('detail-reveal');
const detailCloseEl = el<HTMLButtonElement>('detail-close');
const loaderEl = el<HTMLDivElement>('loader');
const loaderStatusEl = el<HTMLDivElement>('loader-status');
const errorEl = el<HTMLDivElement>('error');
const errorMessageEl = el<HTMLParagraphElement>('error-message');
const refreshEl = el<HTMLButtonElement>('btn-refresh');
const resetEl = el<HTMLButtonElement>('btn-reset');
const errorRetryEl = el<HTMLButtonElement>('error-retry');
const fpsEl = el<HTMLSpanElement>('fps');

let selectedDir: DirNode | null = null;
let hasData = false;

const scene = new StellarScene(canvas, {
  onHover: (info, x, y) => {
    if (!info) {
      hideTooltip();
      return;
    }
    showTooltip(info, x, y);
  },
  onSelectDir: (node) => {
    selectedDir = node;
    showDetail(node);
  },
  onClearSelection: () => {
    selectedDir = null;
    detailEl.hidden = true;
  },
  onOpenFile: (node) => {
    hideTooltip();
    vscode.postMessage({ type: 'open', path: node.path });
  },
  onFps: (fps) => {
    fpsEl.textContent = String(fps);
  },
});

// ------------------------------------------------------------------ messaging

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  switch (message.type) {
    case 'data':
      handleData(message.payload);
      break;
    case 'status':
      loaderStatusEl.textContent = message.message.toUpperCase();
      if (hasData) {
        statusTextEl.textContent = message.message.toUpperCase();
      }
      refreshEl.disabled = true;
      break;
    case 'error':
      showError(message.message);
      break;
  }
});

function handleData(data: WorkspaceData): void {
  hasData = true;
  workspaceNameEl.textContent = data.workspaceName.toUpperCase();
  statusTextEl.textContent = `SYNC ${formatTime(data.generatedAt)}`;
  statFilesEl.textContent = formatCount(data.stats.totalFiles);
  statDirsEl.textContent = formatCount(data.stats.totalDirs);
  statSizeEl.textContent = formatBytes(data.stats.totalSize);
  statDepthEl.textContent = String(data.stats.maxDepth);

  renderComposition(data.stats);
  truncatedEl.hidden = !data.truncated;

  scene.setData(data);

  hideTooltip();
  detailEl.hidden = true;
  selectedDir = null;
  errorEl.hidden = true;
  loaderEl.classList.add('hidden');
  refreshEl.disabled = false;
  document.body.classList.add('ready');
}

function showError(message: string): void {
  loaderEl.classList.add('hidden');
  errorMessageEl.textContent = message;
  errorEl.hidden = false;
  refreshEl.disabled = false;
  statusTextEl.textContent = 'SIGNAL LOST';
}

// -------------------------------------------------------------------- tooltip

function showTooltip(info: HoverInfo, x: number, y: number): void {
  tooltipEl.hidden = false;
  if (info.kind === 'dir') {
    const node = info.node;
    tooltipKindEl.textContent = node.path === '' ? 'WORKSPACE ROOT' : 'DIRECTORY CRYSTAL';
    tooltipNameEl.textContent = node.name;
    tooltipMetaEl.textContent = `${formatCount(node.fileCount)} files · ${formatCount(
      node.dirCount,
    )} subdirs · ${formatBytes(node.size)} · ${node.path === '' ? '/' : `/${node.path}`}`;
  } else {
    const node = info.node;
    tooltipKindEl.textContent = `FILE MOTE · ${node.ext === '(none)' ? 'NO EXT' : node.ext.toUpperCase()}`;
    tooltipNameEl.textContent = node.name;
    tooltipMetaEl.textContent = `${formatBytes(node.size)} · /${node.path}`;
  }

  const margin = 14;
  const width = tooltipEl.offsetWidth;
  const height = tooltipEl.offsetHeight;
  const left = Math.min(x + 18, window.innerWidth - width - margin);
  const top = Math.min(y + 20, window.innerHeight - height - margin);
  tooltipEl.style.left = `${Math.max(margin, left)}px`;
  tooltipEl.style.top = `${Math.max(margin, top)}px`;
}

function hideTooltip(): void {
  tooltipEl.hidden = true;
}

// --------------------------------------------------------------------- detail

function showDetail(node: DirNode): void {
  detailEl.hidden = false;
  detailNameEl.textContent = node.name;
  detailPathEl.textContent = node.path === '' ? '/ WORKSPACE ROOT' : `/${node.path}`;
  detailFilesEl.textContent = formatCount(node.fileCount);
  detailDirsEl.textContent = formatCount(node.dirCount);
  detailSizeEl.textContent = formatBytes(node.size);
}

// ----------------------------------------------------------------- composition

function renderComposition(stats: WorkspaceStats): void {
  compositionEl.innerHTML = '';
  if (stats.byExt.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'comp-empty';
    empty.textContent = 'NO FILES DETECTED';
    compositionEl.append(empty);
    return;
  }

  const max = Math.max(...stats.byExt.map((entry) => entry.count), 1);
  for (const entry of stats.byExt) {
    const color = CATEGORY_HEX[categoryOf(entry.ext)];
    const row = document.createElement('div');
    row.className = 'comp-row';

    const name = document.createElement('span');
    name.className = 'comp-name';
    name.textContent = entry.ext === '(none)' ? '∅ no extension' : `.${entry.ext}`;

    const count = document.createElement('span');
    count.className = 'comp-count';
    count.textContent = formatCount(entry.count);

    const track = document.createElement('div');
    track.className = 'comp-track';
    const bar = document.createElement('i');
    bar.style.width = `${Math.max(2, (entry.count / max) * 100)}%`;
    bar.style.background = color;
    bar.style.color = color;
    track.append(bar);

    row.append(name, count, track);
    compositionEl.append(row);
  }
}

// ---------------------------------------------------------------------- events

refreshEl.addEventListener('click', () => {
  statusTextEl.textContent = 'RESCANNING';
  refreshEl.disabled = true;
  vscode.postMessage({ type: 'refresh' });
});

resetEl.addEventListener('click', () => {
  scene.resetView();
});

errorRetryEl.addEventListener('click', () => {
  errorEl.hidden = true;
  loaderEl.classList.remove('hidden');
  loaderStatusEl.textContent = 'RE-ESTABLISHING SIGNAL';
  vscode.postMessage({ type: 'refresh' });
});

detailCloseEl.addEventListener('click', () => {
  scene.clearSelection();
});

detailRevealEl.addEventListener('click', () => {
  if (selectedDir) {
    vscode.postMessage({ type: 'reveal', path: selectedDir.path });
  }
});

window.addEventListener('resize', hideTooltip);

// --------------------------------------------------------------------- helpers

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
}

vscode.postMessage({ type: 'ready' });
