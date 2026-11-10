import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { SourcePanel } from '../features/source/SourcePanel';
import { GridPanel } from '../features/grid/GridPanel';
import { PaperPanel } from '../features/paper/PaperPanel';
import { TonePanel } from '../features/tones/TonePanel';
import { ExportDialog } from '../features/export/ExportDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { MissingSourceDialog, UnsavedDialog, type UnsavedIntent } from '../features/projects/Dialogs';
import { Toast } from '../components/Toast';
import { useAppStore, type SourcePreview } from '../state/store';
import { useSourceImage } from '../hooks/useSourceImage';
import { usePreviewPipeline } from '../hooks/usePreviewPipeline';
import { useShortcuts } from '../hooks/useShortcuts';
import { useFileDrop } from '../hooks/useFileDrop';
import {
  closeWindow,
  importClipboardImage,
  importImagePath,
  onWindowCloseRequested,
  openProjectFile,
  pathExists,
  pickAndImportImage,
  pickSavePath,
  readProjectPath,
  resolveSourcePath,
  saveProjectFile,
  sourceReference,
} from '../lib/native';
import {
  basename,
  displayProjectName,
  parseProject,
  projectFolder,
  serializeProject,
  sourceStem,
  withUpdatedAt,
} from '../lib/project';
import { calculateSquareCrop, clampCrop, cropCenter } from '../lib/geometry';
import type { ExportMode, ImportedSource, SourceRef, TonalProject } from '../lib/types';
import { rememberRecentProject, readRecentProjects, removeRecentProject, type RecentProject } from '../lib/recentProjects';

function previewFromImported(source: ImportedSource): SourcePreview {
  return {
    dataUrl: source.dataUrl,
    proxyWidth: source.proxyWidth,
    proxyHeight: source.proxyHeight,
    warning: source.warnings,
  };
}

function updatedSourceRef(previous: SourceRef | null, imported: ImportedSource): SourceRef {
  return {
    originalPath: imported.path,
    filename: imported.filename,
    checksumSha256: imported.checksumSha256,
    orientedWidth: imported.orientedWidth,
    orientedHeight: imported.orientedHeight,
    alphaBackground: previous?.alphaBackground ?? '#FFFFFF',
    format: imported.format,
    hasAlpha: imported.hasAlpha,
  };
}

function relinkProject(project: TonalProject, imported: ImportedSource): TonalProject {
  const source = updatedSourceRef(project.source, imported);
  let crop = project.composition.crop;
  if (project.grid.trueSquareCells) {
    crop = calculateSquareCrop(
      imported.orientedWidth,
      imported.orientedHeight,
      project.grid.columns,
      project.grid.rows,
      cropCenter(crop),
    );
  } else {
    crop = clampCrop(crop);
  }
  return {
    ...project,
    source,
    composition: { ...project.composition, crop },
  };
}

export function App() {
  const project = useAppStore((state) => state.project);
  const projectPath = useAppStore((state) => state.projectPath);
  const dirty = useAppStore((state) => state.dirty);
  const past = useAppStore((state) => state.past);
  const future = useAppStore((state) => state.future);
  const sourcePreview = useAppStore((state) => state.sourcePreview);
  const sourceStatus = useAppStore((state) => state.sourceStatus);
  const setSourceStatus = useAppStore((state) => state.setSourceStatus);
  const setSourcePreview = useAppStore((state) => state.setSourcePreview);
  const showToast = useAppStore((state) => state.showToast);
  const setModal = useAppStore((state) => state.setModal);
  const modal = useAppStore((state) => state.modal);
  const setLoupeEnabled = useAppStore((state) => state.setLoupeEnabled);
  const setCompareMode = useAppStore((state) => state.setCompareMode);

  const [exportTab, setExportTab] = useState<'png' | 'pdf' | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [unsavedIntent, setUnsavedIntent] = useState<UnsavedIntent | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [pendingProject, setPendingProject] = useState<{ project: TonalProject; path: string } | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>(() => readRecentProjects());
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  const sourceImage = useSourceImage(sourcePreview?.dataUrl ?? null);
  const pipeline = usePreviewPipeline(sourceImage.image);

  /* --------------------------- status + title --------------------------- */
  useEffect(() => {
    if (sourceImage.error && sourceStatus === 'ready') {
      setSourceStatus('error', sourceImage.error);
    }
  }, [sourceImage.error, sourceStatus, setSourceStatus]);

  useEffect(() => {
    const name = projectPath ? basename(projectPath).replace(/\.tonal$/i, '') : project.title;
    document.title = `TONAL — ${name}${dirty ? ' •' : ''}`;
  }, [project.title, projectPath, dirty]);

  useEffect(() => {
    if (modal) {
      if (modal === 'export') setExportTab((current) => current ?? 'png');
      if (modal === 'shortcuts') setShortcutsOpen(true);
    }
  }, [modal]);

  /* ------------------------------ helpers ------------------------------ */
  const applyImported = useCallback(
    (imported: ImportedSource) => {
      const state = useAppStore.getState();
      const isFirstPhoto = !state.project.source;
      state.setSource(imported, previewFromImported(imported), isFirstPhoto);
      showToast({
        kind: 'success',
        message: `Loaded ${imported.filename} · ${imported.orientedWidth.toLocaleString()} × ${imported.orientedHeight.toLocaleString()} px`,
      });
      if (imported.warnings.length) {
        showToast({ kind: 'notice', message: imported.warnings.join(' ') });
      }
    },
    [showToast],
  );

  const runImport = useCallback(
    async (loader: () => Promise<ImportedSource | null>) => {
      const state = useAppStore.getState();
      const hadSource = Boolean(state.project.source);
      state.setSourceStatus('loading', null);
      try {
        const imported = await loader();
        if (!imported) {
          setSourceStatus(hadSource ? (state.sourcePreview ? 'ready' : 'missing') : 'empty');
          return;
        }
        applyImported(imported);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The photo could not be opened.';
        if (hadSource) {
          setSourceStatus('ready', message);
          showToast({ kind: 'error', message });
        } else {
          setSourceStatus('error', message);
          showToast({ kind: 'error', message });
        }
      }
    },
    [applyImported, setSourceStatus, showToast],
  );

  const guard = useCallback((intent: UnsavedIntent, action: () => void | Promise<void>) => {
    if (!useAppStore.getState().dirty) {
      void action();
      return;
    }
    pendingActionRef.current = action;
    setUnsavedIntent(intent);
  }, []);

  const runPendingAction = useCallback(async () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedIntent(null);
    if (action) await action();
  }, []);

  const requestOpenPhoto = useCallback(() => {
    const action = () =>
      runImport(async () => {
        const picked = await pickAndImportImage();
        return picked?.source ?? null;
      });
    if (useAppStore.getState().project.source) guard('replace-photo', action);
    else void action();
  }, [guard, runImport]);

  const requestImportPath = useCallback(
    (path: string) => {
      const action = () => runImport(() => importImagePath(path));
      if (useAppStore.getState().project.source) guard('replace-photo', action);
      else void action();
    },
    [guard, runImport],
  );

  const requestImportBlob = useCallback(
    (blob: Blob, name?: string) => {
      const action = () =>
        runImport(async () => (await importClipboardImage(blob, name ?? 'pasted-reference.png')).source);
      if (useAppStore.getState().project.source) guard('replace-photo', action);
      else void action();
    },
    [guard, runImport],
  );

  const rememberRecent = useCallback((path: string, title: string) => {
    setRecent(rememberRecentProject(path, title));
  }, []);

  const finishOpenProject = useCallback(
    (loaded: TonalProject, path: string, imported: ImportedSource | null) => {
      const state = useAppStore.getState();
      state.replaceProject(loaded, path, true);
      if (imported) {
        state.setSourcePreview(previewFromImported(imported));
        state.setSourceStatus('ready');
      } else {
        state.setSourcePreview(null);
        state.setSourceStatus(loaded.source ? 'missing' : 'empty');
      }
      rememberRecent(path, displayProjectName(loaded, path));
      showToast({ kind: 'success', message: `Opened ${displayProjectName(loaded, path)}` });
    },
    [rememberRecent, showToast],
  );

  const openProjectFromJson = useCallback(
    async (path: string, json: string) => {
      let loaded: TonalProject;
      try {
        loaded = parseProject(json);
      } catch (error) {
        showToast({
          kind: 'error',
          message: error instanceof Error ? error.message : 'This project file could not be read.',
        });
        return;
      }

      if (!loaded.source) {
        finishOpenProject(loaded, path, null);
        return;
      }

      const resolved = await resolveSourcePath(
        path,
        loaded.source.originalPath,
        loaded.source.relativePath,
      );
      if (!resolved) {
        setPendingProject({ project: loaded, path });
        return;
      }

      try {
        const imported = await importImagePath(resolved);
        const relinked = relinkProject(loaded, imported);
        finishOpenProject(relinked, path, imported);
      } catch {
        setPendingProject({ project: loaded, path });
      }
    },
    [finishOpenProject, showToast],
  );

  const requestOpenProject = useCallback(() => {
    const action = async () => {
      try {
        const file = await openProjectFile();
        if (!file) return;
        await openProjectFromJson(file.path, file.json);
      } catch (error) {
        showToast({
          kind: 'error',
          message: error instanceof Error ? error.message : 'The project could not be opened.',
        });
      }
    };
    guard('open', action);
  }, [guard, openProjectFromJson, showToast]);

  const requestOpenRecent = useCallback(
    (path: string) => {
      const action = async () => {
        try {
          const exists = await pathExists(path);
          if (!exists) {
            setRecent(removeRecentProject(path));
            showToast({ kind: 'error', message: 'That project file is no longer in this location.' });
            return;
          }
          const json = await readProjectPath(path);
          await openProjectFromJson(path, json);
        } catch (error) {
          showToast({
            kind: 'error',
            message: error instanceof Error ? error.message : 'The project could not be opened.',
          });
        }
      };
      guard('open', action);
    },
    [guard, openProjectFromJson, showToast],
  );

  const saveProject = useCallback(
    async (saveAs = false): Promise<boolean> => {
      const state = useAppStore.getState();
      const projectToSave = state.project;
      const source = projectToSave.source;
      if (!source) {
        showToast({ kind: 'notice', message: 'Open a photo before saving a project.' });
        return false;
      }
      let path = saveAs ? null : state.projectPath;
      if (!path || path.startsWith('browser://')) {
        const picked = await pickSavePath({
          title: 'Save TONAL project',
          defaultName: `${sourceStem(source.filename)}.tonal`,
          filters: [{ name: 'TONAL project', extensions: ['tonal'] }],
          folder: projectFolder(state.projectPath) ?? '',
        });
        if (!picked) return false;
        path = /\.tonal$/i.test(picked) ? picked : `${picked}.tonal`;
      }
      try {
        let next: TonalProject = projectToSave;
        if (source.originalPath) {
          const ref = await sourceReference(path, source.originalPath);
          next = {
            ...next,
            source: {
              ...source,
              originalPath: ref.originalPath,
              relativePath: ref.relativePath ?? undefined,
            },
          };
        }
        next = withUpdatedAt(next);
        await saveProjectFile(path, serializeProject(next));
        useAppStore.getState().commitSavedProject(next, path);
        rememberRecent(path, displayProjectName(next, path));
        showToast({ kind: 'success', message: 'Project saved.' });
        return true;
      } catch (error) {
        showToast({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : "TONAL couldn't save to this location. Choose another folder or check access.",
        });
        return false;
      }
    },
    [rememberRecent, showToast],
  );

  const requestNewProject = useCallback(() => {
    guard('new', () => useAppStore.getState().newProject());
  }, [guard]);

  const requestCloseProject = useCallback(() => {
    guard('close-project', () => useAppStore.getState().newProject());
  }, [guard]);

  const locateCurrentSource = useCallback(async () => {
    try {
      const picked = await pickAndImportImage();
      if (!picked) return;
      useAppStore.getState().relinkSource(picked.source);
      setSourcePreview(previewFromImported(picked.source));
      setSourceStatus('ready');
      showToast({
        kind: 'success',
        message: `Source restored · ${picked.source.orientedWidth.toLocaleString()} × ${picked.source.orientedHeight.toLocaleString()} px`,
      });
    } catch (error) {
      showToast({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The photo could not be opened.',
      });
    }
  }, [setSourcePreview, setSourceStatus, showToast]);

  const locatePendingProject = useCallback(async () => {
    if (!pendingProject) return;
    try {
      const picked = await pickAndImportImage();
      if (!picked) return;
      const relinked = relinkProject(pendingProject.project, picked.source);
      const { path } = pendingProject;
      setPendingProject(null);
      finishOpenProject(relinked, path, picked.source);
    } catch (error) {
      showToast({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The photo could not be opened.',
      });
    }
  }, [pendingProject, finishOpenProject, showToast]);

  const openExport = useCallback(
    (mode?: ExportMode, tab: 'png' | 'pdf' = 'png') => {
      const state = useAppStore.getState();
      if (!state.project.source) {
        showToast({ kind: 'notice', message: 'Open a photo before exporting a reference.' });
        return;
      }
      if (mode) state.setExportDefaults({ mode });
      setExportTab(tab);
      setModal('export');
    },
    [setModal, showToast],
  );

  const closeExport = useCallback(() => {
    setExportTab(null);
    setModal(null);
  }, [setModal]);

  const closeShortcuts = useCallback(() => {
    setShortcutsOpen(false);
    setModal(null);
  }, [setModal]);

  const showShortcuts = useCallback(() => {
    setShortcutsOpen(true);
    setModal('shortcuts');
  }, [setModal]);

  /* ---------------------------- shortcuts ---------------------------- */
  useShortcuts({
    openPhoto: requestOpenPhoto,
    openProject: requestOpenProject,
    saveProject: () => void saveProject(false),
    saveProjectAs: () => void saveProject(true),
    newProject: requestNewProject,
    exportDialog: () => openExport(undefined, 'png'),
    showShortcuts,
    escape: () => {
      setLoupeEnabled(false);
      setCompareMode('off');
    },
  });

  /* ---------------------------- drag/drop ---------------------------- */
  const dragOver = useFileDrop({
    onPath: requestImportPath,
    onFile: (file) => requestImportBlob(file, file.name),
    onPasteImage: (file) => requestImportBlob(file, 'pasted-reference.png'),
    disabled: Boolean(exportTab || shortcutsOpen || unsavedIntent || pendingProject),
  });

  /* --------------------------- close guard --------------------------- */
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onWindowCloseRequested(async () => {
      if (!useAppStore.getState().dirty) return true;
      pendingActionRef.current = () => closeWindow();
      setUnsavedIntent('close');
      return false;
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /* ------------------------------ render ------------------------------ */
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const projectName = displayProjectName(project, projectPath);

  const onUnsavedSave = async () => {
    setSavingProject(true);
    const saved = await saveProject(false);
    setSavingProject(false);
    if (saved) await runPendingAction();
  };

  return (
    <div className="app-shell">
      <Header
        projectName={projectName}
        dirty={dirty}
        canSave={Boolean(project.source)}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        recent={recent}
        onUndo={undo}
        onRedo={redo}
        onOpenPhoto={requestOpenPhoto}
        onSave={() => void saveProject(false)}
        onSaveAs={() => void saveProject(true)}
        onExport={() => openExport(undefined, 'png')}
        onNew={requestNewProject}
        onOpenProject={requestOpenProject}
        onCloseProject={requestCloseProject}
        onOpenRecent={requestOpenRecent}
        onShortcuts={showShortcuts}
      />

      <main className="workspace">
        <aside className="sidebar sidebar-left" aria-label="Reference and drawing grid">
          <div className="sidebar-scroll">
            <SourcePanel onOpenPhoto={requestOpenPhoto} onLocateImage={() => void locateCurrentSource()} />
            <GridPanel />
            <PaperPanel onPrintSetup={() => openExport(undefined, 'pdf')} />
          </div>
          <div className="sidebar-foot">
            <div className="sidebar-foot-note">
              <span className="badge">Local · non-destructive</span>
              <span>Source photos never leave this computer</span>
            </div>
          </div>
        </aside>

        <CanvasStage
          image={sourceImage.image}
          pipeline={pipeline}
          dragOver={dragOver}
          onOpenPhoto={requestOpenPhoto}
          onLocateImage={() => void locateCurrentSource()}
          onOpenExport={() => openExport(undefined, 'png')}
        />

        <aside className="sidebar sidebar-right" aria-label="Tonal development and export">
          <div className="sidebar-scroll">
            <TonePanel onOpenExport={openExport} />
          </div>
        </aside>
      </main>

      <Footer onShowShortcuts={showShortcuts} />
      <Toast />

      {exportTab ? <ExportDialog initialTab={exportTab} onClose={closeExport} /> : null}
      {shortcutsOpen ? <ShortcutsDialog onClose={closeShortcuts} /> : null}

      {unsavedIntent ? (
        <UnsavedDialog
          intent={unsavedIntent}
          projectTitle={projectName}
          saving={savingProject}
          onSave={() => void onUnsavedSave()}
          onDiscard={() => void runPendingAction()}
          onCancel={() => {
            pendingActionRef.current = null;
            setUnsavedIntent(null);
          }}
        />
      ) : null}

      {pendingProject ? (
        <MissingSourceDialog
          projectTitle={displayProjectName(pendingProject.project, pendingProject.path)}
          filename={pendingProject.project.source?.filename}
          onLocate={() => void locatePendingProject()}
          onKeepOpen={() => {
            const loaded = pendingProject;
            setPendingProject(null);
            finishOpenProject(loaded.project, loaded.path, null);
          }}
          onCancel={() => setPendingProject(null)}
        />
      ) : null}
    </div>
  );
}
