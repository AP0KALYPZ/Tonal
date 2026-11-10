import type { ExportProgress } from '../../lib/types';

export function sanitizeFilename(name: string, extension: string): string {
  const cleaned = Array.from(name.replace(/[<>:"/\\|?*]/g, '-'))
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const withoutExt = cleaned.replace(/\.(png|pdf)$/i, '');
  const base = withoutExt || 'reference';
  return `${base}.${extension}`;
}

export function splitPath(path: string): { folder: string; filename: string } {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  if (index < 0) return { folder: '', filename: path };
  return { folder: path.slice(0, index), filename: path.slice(index + 1) };
}

export function joinPath(folder: string, filename: string): string {
  if (!folder) return filename;
  const separator = folder.includes('\\') || /^[A-Za-z]:/.test(folder) ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${filename}`;
}

export function progressStageLabel(stage: ExportProgress['stage']): string {
  switch (stage) {
    case 'render':
      return 'Preparing photo';
    case 'grid':
      return 'Drawing grid';
    case 'encode':
      return 'Encoding PNG';
    case 'layout':
      return 'Laying out pages';
    case 'write':
      return 'Writing file';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The export could not be completed.';
}
