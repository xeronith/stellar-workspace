import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DirNode, ExtStat, FileNode, WorkspaceData, WorkspaceStats } from './types';

const MAX_FILES = 3500;
const MAX_DEPTH = 10;
const MAX_ENTRIES_PER_DIR = 600;

/**
 * Directories that are almost never useful in a structural map and can be
 * enormous. Dot-directories are skipped everywhere by default.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'obj',
  'bin',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'Pods',
  'DerivedData',
]);

interface Budget {
  files: number;
  truncated: boolean;
}

export async function scanWorkspace(rootAbs: string): Promise<WorkspaceData> {
  const budget: Budget = { files: 0, truncated: false };
  const root = await walkDir(rootAbs, '', 0, budget);
  const stats = computeStats(root);

  return {
    workspaceName: path.basename(rootAbs) || rootAbs,
    rootAbs,
    root,
    stats,
    generatedAt: Date.now(),
    truncated: budget.truncated,
  };
}

async function walkDir(abs: string, rel: string, depth: number, budget: Budget): Promise<DirNode> {
  const node: DirNode = {
    type: 'dir',
    name: rel === '' ? path.basename(abs) || abs : path.basename(abs),
    path: rel,
    abs,
    depth,
    size: 0,
    fileCount: 0,
    dirCount: 0,
    ownFileCount: 0,
    children: [],
  };

  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return node;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  if (entries.length > MAX_ENTRIES_PER_DIR) {
    budget.truncated = true;
  }

  const filesToStat: Array<{ name: string; rel: string }> = [];

  for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIR)) {
    const name = entry.name;
    if (name.startsWith('.') || name === 'Thumbs.db') {
      continue;
    }

    const childRel = rel === '' ? name : `${rel}/${name}`;

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(name)) {
        continue;
      }
      if (depth >= MAX_DEPTH) {
        budget.truncated = true;
        continue;
      }
      node.children.push(await walkDir(path.join(abs, name), childRel, depth + 1, budget));
    } else if (entry.isFile()) {
      if (budget.files >= MAX_FILES) {
        budget.truncated = true;
        continue;
      }
      budget.files += 1;
      filesToStat.push({ name, rel: childRel });
    }
  }

  const fileNodes = await Promise.all(
    filesToStat.map(async ({ name, rel: fileRel }): Promise<FileNode> => {
      let size = 0;
      try {
        size = (await fs.stat(path.join(abs, name))).size;
      } catch {
        // Ignore unreadable files.
      }
      return {
        type: 'file',
        name,
        path: fileRel,
        size,
        ext: extensionOf(name),
      };
    }),
  );

  node.children.push(...fileNodes);
  node.ownFileCount = fileNodes.length;

  for (const child of node.children) {
    if (child.type === 'dir') {
      node.fileCount += child.fileCount;
      node.dirCount += child.dirCount + 1;
      node.size += child.size;
    } else {
      node.fileCount += 1;
      node.size += child.size;
    }
  }

  return node;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return '(none)';
  }
  return name.slice(dot + 1).toLowerCase();
}

function computeStats(root: DirNode): WorkspaceStats {
  const extMap = new Map<string, ExtStat>();
  const largest: Array<{ name: string; path: string; size: number }> = [];
  let maxDepth = 0;

  const visit = (node: DirNode): void => {
    maxDepth = Math.max(maxDepth, node.depth);
    for (const child of node.children) {
      if (child.type === 'dir') {
        visit(child);
      } else {
        const entry = extMap.get(child.ext) ?? { ext: child.ext, count: 0, size: 0 };
        entry.count += 1;
        entry.size += child.size;
        extMap.set(child.ext, entry);

        if (largest.length < 5 || child.size > (largest[4]?.size ?? 0)) {
          largest.push({ name: child.name, path: child.path, size: child.size });
          largest.sort((a, b) => b.size - a.size);
          largest.length = Math.min(largest.length, 5);
        }
      }
    }
  };

  visit(root);

  const byExt = [...extMap.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    totalFiles: root.fileCount,
    totalDirs: root.dirCount,
    totalSize: root.size,
    maxDepth,
    byExt,
    largestFiles: largest,
  };
}
