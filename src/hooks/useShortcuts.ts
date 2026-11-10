import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/store';

export interface ShortcutActions {
  openPhoto: () => void;
  openProject: () => void;
  saveProject: () => void;
  saveProjectAs: () => void;
  newProject: () => void;
  exportDialog: () => void;
  showShortcuts: () => void;
  escape: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  );
}

export function useShortcuts(actions: ShortcutActions): void {
  const previousCompare = useRef<'off' | 'locked' | 'held'>('off');
  const comparingWithKey = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const setCompareMode = useAppStore.getState().setCompareMode;
    const setSpaceHeld = useAppStore.getState().setSpaceHeld;
    const setLoupeEnabled = useAppStore.getState().setLoupeEnabled;
    const setGrid = useAppStore.getState().setGrid;
    const setMirror = useAppStore.getState().setMirror;
    const setZoom = useAppStore.getState().setZoom;
    const fitToView = useAppStore.getState().fitToView;
    const actualPixels = useAppStore.getState().actualPixels;
    const undo = useAppStore.getState().undo;
    const redo = useAppStore.getState().redo;

    const onKeyDown = (event: KeyboardEvent) => {
      const state = useAppStore.getState();
      if (event.key === 'Escape') {
        if (state.modal) return;
        actionsRef.current.escape();
        if (state.compareMode === 'held') setCompareMode('off');
        return;
      }
      if (state.modal) return;
      if (isEditableTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod) {
        if (key === 'o') {
          event.preventDefault();
          if (event.shiftKey) actionsRef.current.openProject();
          else actionsRef.current.openPhoto();
          return;
        }
        if (key === 's') {
          event.preventDefault();
          if (event.shiftKey) actionsRef.current.saveProjectAs();
          else actionsRef.current.saveProject();
          return;
        }
        if (key === 'e') {
          event.preventDefault();
          actionsRef.current.exportDialog();
          return;
        }
        if (key === 'n') {
          event.preventDefault();
          actionsRef.current.newProject();
          return;
        }
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          redo();
          return;
        }
        return;
      }

      if (key === 'g') {
        event.preventDefault();
        setGrid({ visible: !state.project.grid.visible });
        return;
      }
      if (key === 'l') {
        event.preventDefault();
        setLoupeEnabled(!state.loupeEnabled);
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        setMirror(!state.project.composition.mirror);
        return;
      }
      if (key === 'c' && !event.repeat) {
        if (state.compareMode !== 'held') {
          previousCompare.current = state.compareMode;
          comparingWithKey.current = true;
          setCompareMode('held');
        }
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) setSpaceHeld(true);
        return;
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        setZoom((state.zoomMode === 'fit' ? 1 : state.zoom) * 1.25, 'custom');
        return;
      }
      if (key === '-' || key === '_') {
        event.preventDefault();
        setZoom((state.zoomMode === 'fit' ? 1 : state.zoom) / 1.25, 'custom');
        return;
      }
      if (key === '0') {
        event.preventDefault();
        fitToView();
        return;
      }
      if (key === '1') {
        event.preventDefault();
        actualPixels();
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        actionsRef.current.showShortcuts();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'c' && comparingWithKey.current) {
        comparingWithKey.current = false;
        const restore = previousCompare.current;
        useAppStore.getState().setCompareMode(restore === 'held' ? 'off' : restore);
      }
      if (event.code === 'Space') setSpaceHeld(false);
    };

    const onBlur = () => {
      setSpaceHeld(false);
      if (comparingWithKey.current) {
        comparingWithKey.current = false;
        useAppStore.getState().setCompareMode('off');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
