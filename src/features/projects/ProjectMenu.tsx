import { useEffect } from 'react';
import {
  Clock3,
  FileDown,
  FilePlus2,
  FolderOpen,
  Keyboard,
  Save,
  SaveAll,
  X,
} from 'lucide-react';
import type { RecentProject } from '../../lib/recentProjects';

interface ProjectMenuProps {
  onClose: () => void;
  onNew: () => void;
  onOpenProject: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseProject: () => void;
  onShortcuts: () => void;
  onOpenRecent: (path: string) => void;
  recent: RecentProject[];
  canSave: boolean;
}

export function ProjectMenu({
  onClose,
  onNew,
  onOpenProject,
  onSave,
  onSaveAs,
  onCloseProject,
  onShortcuts,
  onOpenRecent,
  recent,
  canSave,
}: ProjectMenuProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={onClose} role="presentation" />
      <div className="project-menu" role="menu" aria-label="Project menu">
        <div className="menu-section">
          <div className="menu-label">Project</div>
          <button type="button" role="menuitem" className="menu-item" onClick={onNew}>
            <FilePlus2 size={14} />
            New project
            <span className="menu-hint">Ctrl+N</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={onOpenProject}>
            <FolderOpen size={14} />
            Open project…
            <span className="menu-hint">Ctrl+Shift+O</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={onSave} disabled={!canSave}>
            <Save size={14} />
            Save project
            <span className="menu-hint">Ctrl+S</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={onSaveAs} disabled={!canSave}>
            <SaveAll size={14} />
            Save as…
            <span className="menu-hint">Ctrl+Shift+S</span>
          </button>
        </div>

        <div className="menu-sep" />

        <div className="menu-section">
          <div className="menu-label">
            <Clock3 size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            Recent projects
          </div>
          <div className="recent-list">
            {recent.length === 0 ? (
              <p className="recent-empty">Projects you open or save will appear here.</p>
            ) : (
              recent.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  role="menuitem"
                  className="recent-item"
                  onClick={() => onOpenRecent(entry.path)}
                  title={entry.path}
                >
                  <span className="recent-name">{entry.title}</span>
                  <span className="recent-path">{entry.path}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="menu-sep" />

        <div className="menu-section">
          <button type="button" role="menuitem" className="menu-item" onClick={onShortcuts}>
            <Keyboard size={14} />
            Keyboard shortcuts
            <span className="menu-hint">?</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={onCloseProject}>
            <FileDown size={14} />
            Close project
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={onClose}>
            <X size={14} />
            Dismiss menu
          </button>
        </div>
      </div>
    </>
  );
}
