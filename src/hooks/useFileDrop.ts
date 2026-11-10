import { useEffect, useRef, useState } from 'react';
import { isTauri } from '../lib/native';

interface FileDropOptions {
  onPath: (path: string) => void;
  onFile: (file: File) => void;
  onPasteImage: (file: Blob) => void;
  disabled?: boolean;
}

export function useFileDrop(options: FileDropOptions): boolean {
  const [dragOver, setDragOver] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dragDepth = useRef(0);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    if (isTauri()) {
      import('@tauri-apps/api/webview')
        .then(async ({ getCurrentWebview }) => {
          const stop = await getCurrentWebview().onDragDropEvent((event) => {
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              setDragOver(true);
            } else if (payload.type === 'leave') {
              setDragOver(false);
            } else if (payload.type === 'drop') {
              setDragOver(false);
              const path = payload.paths.find((candidate) => /\.(jpe?g|png|webp)$/i.test(candidate));
              if (path) optionsRef.current.onPath(path);
            }
          });
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(() => {
          // Native drag events are optional; Open still works.
        });
    }

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const file = Array.from(event.dataTransfer.files).find((candidate) =>
        /^image\/(png|jpeg|webp)$/i.test(candidate.type) || /\.(png|jpe?g|webp)$/i.test(candidate.name),
      );
      if (file) optionsRef.current.onFile(file);
    };

    const onPaste = (event: ClipboardEvent) => {
      if (optionsRef.current.disabled) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        optionsRef.current.onPasteImage(file);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  return dragOver;
}
