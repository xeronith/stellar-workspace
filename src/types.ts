export interface FileNode {
  type: 'file';
  name: string;
  /** Workspace-relative path using forward slashes. */
  path: string;
  size: number;
  ext: string;
}

export interface DirNode {
  type: 'dir';
  name: string;
  /** Workspace-relative path using forward slashes. Empty string for the root. */
  path: string;
  /** Absolute path on disk. Only present on directories. */
  abs: string;
  depth: number;
  size: number;
  /** Number of files in this directory and all descendants. */
  fileCount: number;
  /** Number of subdirectories in this directory and all descendants. */
  dirCount: number;
  /** Files directly inside this directory. */
  ownFileCount: number;
  children: Array<DirNode | FileNode>;
}

export interface ExtStat {
  ext: string;
  count: number;
  size: number;
}

export interface WorkspaceStats {
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  maxDepth: number;
  byExt: ExtStat[];
  largestFiles: Array<{ name: string; path: string; size: number }>;
}

export interface WorkspaceData {
  workspaceName: string;
  rootAbs: string;
  root: DirNode;
  stats: WorkspaceStats;
  generatedAt: number;
  truncated: boolean;
}

export type HostToWebview =
  | { type: 'data'; payload: WorkspaceData }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'reveal'; path: string }
  | { type: 'open'; path: string };
