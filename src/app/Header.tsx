import { useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Download,
  FolderOpen,
  ImagePlus,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ProjectMenu } from '../features/projects/ProjectMenu';
import type { RecentProject } from '../lib/recentProjects';

interface HeaderProps {
  projectName: string;
  dirty: boolean;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  recent: RecentProject[];
  onUndo: () => void;
  onRedo: () => void;
  onOpenPhoto: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onNew: () => void;
  onOpenProject: () => void;
  onCloseProject: () => void;
  onOpenRecent: (path: string) => void;
  onShortcuts: () => void;
  busy?: ReactNode;
}

export function Header({
  projectName,
  dirty,
  canSave,
  canUndo,
  canRedo,
  recent,
  onUndo,
  onRedo,
  onOpenPhoto,
  onSave,
  onSaveAs,
  onExport,
  onNew,
  onOpenProject,
  onCloseProject,
  onOpenRecent,
  onShortcuts,
  busy,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="brand" aria-label="TONAL — Graphite Reference Studio">
        <img src="/brand/tonal-icon.svg" alt="" className="brand-mark" width={34} height={34} />
        <div className="brand-word">
          <span className="brand-name">
            TONAL<span>.</span>
          </span>
          <span className="brand-descriptor">Graphite Reference Studio</span>
        </div>
      </div>

      <div className="header-divider" aria-hidden="true" />

      <button
        type="button"
        className="project-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        title="Project menu"
      >
        {dirty ? <span className="dirty-dot" aria-label="Unsaved changes" /> : null}
        <span className="project-name">{projectName}</span>
        <span className="project-kind">project</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {menuOpen ? (
        <ProjectMenu
          recent={recent}
          canSave={canSave}
          onClose={() => setMenuOpen(false)}
          onNew={() => {
            setMenuOpen(false);
            onNew();
          }}
          onOpenProject={() => {
            setMenuOpen(false);
            onOpenProject();
          }}
          onSave={() => {
            setMenuOpen(false);
            onSave();
          }}
          onSaveAs={() => {
            setMenuOpen(false);
            onSaveAs();
          }}
          onOpenRecent={(path) => {
            setMenuOpen(false);
            onOpenRecent(path);
          }}
          onCloseProject={() => {
            setMenuOpen(false);
            onCloseProject();
          }}
          onShortcuts={() => {
            setMenuOpen(false);
            onShortcuts();
          }}
        />
      ) : null}

      <div className="header-actions">
        {busy}
        <IconButton
          label="Undo (Ctrl+Z)"
          icon={<Undo2 size={17} />}
          onClick={onUndo}
          disabled={!canUndo}
        />
        <IconButton
          label="Redo (Ctrl+Shift+Z)"
          icon={<Redo2 size={17} />}
          onClick={onRedo}
          disabled={!canRedo}
        />
        <span className="header-sep" aria-hidden="true" />
        <Button
          variant="ghost"
          onClick={onSave}
          disabled={!canSave}
          icon={<Save size={15} />}
          title="Save project (Ctrl+S)"
        >
          <span className="btn-label-optional">Save</span>
        </Button>
        <Button
          variant="secondary"
          onClick={onOpenPhoto}
          icon={<ImagePlus size={15} />}
          title="Open photo (Ctrl+O)"
        >
          <span className="btn-label-optional">Open photo</span>
        </Button>
        <Button
          variant="primary"
          onClick={onExport}
          disabled={!canSave}
          icon={<Download size={16} />}
          title="Export reference (Ctrl+E)"
        >
          Export
        </Button>
      </div>

      <span className="visually-hidden" aria-live="polite">
        {dirty ? 'Project has unsaved changes' : 'Project saved'}
      </span>
      <span className="visually-hidden">
        <FolderOpen size={1} aria-hidden="true" />
      </span>
    </header>
  );
}
