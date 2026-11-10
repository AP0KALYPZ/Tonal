import type {
  ExportProgress,
  ExportResult,
  ImportedSource,
  PdfExportRequest,
  PngExportRequest,
} from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function readableError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error.replace(/^Error:\s*/i, ''));
  return new Error('The operation could not be completed.');
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch (error) {
    throw readableError(error);
  }
}

export interface PickedImage {
  source: ImportedSource;
  file?: File;
}

const BROWSER_FILE_STORE = new Map<string, string>();
let browserFileSeq = 0;

function nextBrowserPath(name: string): string {
  browserFileSeq += 1;
  return `browser://${browserFileSeq}/${name}`;
}

function pickWithInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Browser-only proxy used while reviewing UI with `npm run dev`; native app uses Rust decode. */
async function importBrowserFile(file: File): Promise<PickedImage> {
  const buffer = await file.arrayBuffer();
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error("We couldn't open this file. Choose a JPG, PNG or WebP image.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: file.type || 'image/png' }), {
      imageOrientation: 'from-image',
    });
  } catch {
    throw new Error('The photo appears damaged or unreadable. Your current project is unchanged.');
  }
  const max = 2800;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image preview is unavailable in this environment.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const hasAlpha = /png|webp/i.test(file.type);
  const dataUrl = canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.92);
  const path = nextBrowserPath(file.name);
  return {
    file,
    source: {
      path,
      filename: file.name,
      orientedWidth: bitmap.width,
      orientedHeight: bitmap.height,
      proxyWidth: width,
      proxyHeight: height,
      dataUrl,
      format: file.type || 'image/png',
      hasAlpha,
      checksumSha256: await sha256(buffer),
      bytes: file.size,
      warnings: [],
    },
  };
}

export async function pickAndImportImage(): Promise<PickedImage | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Open photo',
      filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (!selected || Array.isArray(selected)) return null;
    const source = await invokeCommand<ImportedSource>('import_image', { path: selected });
    return { source };
  }
  const file = await pickWithInput('image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp');
  return file ? importBrowserFile(file) : null;
}

export async function importImagePath(path: string): Promise<ImportedSource> {
  if (!isTauri()) {
    throw new Error('Importing a file path requires the TONAL desktop app.');
  }
  return invokeCommand<ImportedSource>('import_image', { path });
}

export async function importClipboardImage(file: Blob, filename = 'pasted-reference.png'): Promise<PickedImage> {
  if (!isTauri()) {
    return importBrowserFile(new File([file], filename, { type: file.type || 'image/png' }));
  }
  const buffer = await file.arrayBuffer();
  const source = await invokeCommand<ImportedSource>('import_clipboard_image', {
    bytesBase64: bufferToBase64(buffer),
    extension: (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'),
    filename,
  });
  return { source };
}

export interface SaveDialogOptions {
  title: string;
  defaultName: string;
  filters: Array<{ name: string; extensions: string[] }>;
  folder?: string;
}

export async function pickSavePath(options: SaveDialogOptions): Promise<string | null> {
  if (!isTauri()) return `browser://${options.defaultName}`;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const defaultPath = options.folder
    ? `${options.folder.replace(/[\\/]$/, '')}${options.folder.includes('\\') ? '\\' : '/'}${options.defaultName}`
    : options.defaultName;
  const selected = await save({
    title: options.title,
    defaultPath,
    filters: options.filters,
  });
  return selected ?? null;
}

export async function saveProjectFile(path: string, json: string): Promise<void> {
  if (!isTauri()) {
    BROWSER_FILE_STORE.set(path, json);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path.split('/').pop() || 'reference.tonal';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  await invokeCommand('save_project', { path, json });
}

export async function openProjectFile(): Promise<{ path: string; json: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Open TONAL project',
      filters: [{ name: 'TONAL project', extensions: ['tonal'] }],
    });
    if (!selected || Array.isArray(selected)) return null;
    const json = await invokeCommand<string>('load_project', { path: selected });
    return { path: selected, json };
  }
  const file = await pickWithInput('.tonal,application/json');
  if (!file) return null;
  const json = await file.text();
  const path = nextBrowserPath(file.name);
  BROWSER_FILE_STORE.set(path, json);
  return { path, json };
}

export async function readProjectPath(path: string): Promise<string> {
  if (!isTauri()) {
    const stored = BROWSER_FILE_STORE.get(path);
    if (!stored) throw new Error('This project is not available in the browser review session.');
    return stored;
  }
  return invokeCommand<string>('load_project', { path });
}

export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return true;
  return invokeCommand<boolean>('path_exists', { path });
}

export async function defaultExportDir(): Promise<string> {
  if (!isTauri()) return '';
  return invokeCommand<string>('default_export_dir');
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri()) return;
  await invokeCommand('reveal_in_folder', { path });
}

export async function sourceReference(
  projectPath: string,
  sourcePath: string,
): Promise<{ originalPath: string; relativePath: string | null }> {
  if (!isTauri()) return { originalPath: sourcePath, relativePath: null };
  return invokeCommand('source_reference', { projectPath, sourcePath });
}

export async function resolveSourcePath(
  projectPath: string,
  originalPath: string | undefined,
  relativePath: string | undefined,
): Promise<string | null> {
  if (!isTauri()) return originalPath ?? null;
  return invokeCommand<string | null>('resolve_source_path', {
    projectPath,
    originalPath: originalPath ?? null,
    relativePath: relativePath ?? null,
  });
}

export async function exportPng(request: PngExportRequest): Promise<ExportResult> {
  if (!isTauri()) {
    throw new Error('Full-resolution PNG export requires the TONAL desktop app.');
  }
  return invokeCommand<ExportResult>('export_png', { request });
}

export async function exportPdf(request: PdfExportRequest): Promise<ExportResult> {
  if (!isTauri()) {
    throw new Error('PDF printing requires the TONAL desktop app.');
  }
  return invokeCommand<ExportResult>('export_pdf', { request });
}

export async function cancelJob(jobId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeCommand('cancel_job', { jobId });
}

export async function onExportProgress(
  handler: (progress: ExportProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<ExportProgress>('tonal://export-progress', (event) => {
    handler(event.payload);
  });
  return unlisten;
}

export async function closeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().destroy();
}

export async function onWindowCloseRequested(
  handler: () => Promise<boolean>,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().onCloseRequested(async (event) => {
    const canClose = await handler();
    if (!canClose) event.preventDefault();
  });
}
