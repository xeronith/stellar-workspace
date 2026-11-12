export type FileCategory = 'code' | 'data' | 'media' | 'doc' | 'other';

const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs',
  'java', 'kt', 'kts', 'rb', 'php', 'swift', 'm', 'mm', 'scala', 'ex', 'exs', 'erl', 'hs', 'lua',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'astro', 'dart',
  'clj', 'cljs', 'fs', 'fsx', 'zig', 'nim', 'r', 'jl',
]);

const DATA = new Set([
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'ini', 'cfg', 'conf',
  'env', 'lock', 'plist', 'proto', 'tf', 'tfvars', 'hcl', 'properties',
]);

const MEDIA = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'svg', 'mp4', 'mov', 'webm',
  'mp3', 'wav', 'ogg', 'flac', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'glb', 'gltf', 'obj', 'fbx', 'blend',
]);

const DOC = new Set(['md', 'mdx', 'txt', 'rst', 'adoc', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);

export const CATEGORY_HEX: Record<FileCategory, string> = {
  code: '#5ceaff',
  data: '#ffc857',
  media: '#ff64d8',
  doc: '#b8ff5e',
  other: '#8fa3b8',
};

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  code: 'CODE',
  data: 'DATA',
  media: 'MEDIA',
  doc: 'DOC',
  other: 'OTHER',
};

export function categoryOf(ext: string): FileCategory {
  const key = ext.replace(/^\./, '').toLowerCase();
  if (CODE.has(key)) return 'code';
  if (DATA.has(key)) return 'data';
  if (MEDIA.has(key)) return 'media';
  if (DOC.has(key)) return 'doc';
  return 'other';
}
