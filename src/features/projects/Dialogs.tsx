import { AlertTriangle, MapPin, Save } from 'lucide-react';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';

interface MissingSourceDialogProps {
  projectTitle: string;
  filename?: string;
  onLocate: () => void;
  onKeepOpen: () => void;
  onCancel: () => void;
}

export function MissingSourceDialog({
  projectTitle,
  filename,
  onLocate,
  onKeepOpen,
  onCancel,
}: MissingSourceDialogProps) {
  return (
    <Modal
      title="Original photo not found"
      subtitle="TONAL stores edit settings, not image pixels. Point it at the original file to continue."
      onClose={onCancel}
      size="md"
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel open
          </Button>
          <Button variant="secondary" onClick={onKeepOpen}>
            Keep project open
          </Button>
          <Button variant="primary" onClick={onLocate} icon={<MapPin size={15} />}>
            Locate image…
          </Button>
        </div>
      }
    >
      <div className="confirm-body">
        <div className="confirm-icon">
          <AlertTriangle size={19} />
        </div>
        <div>
          <div className="confirm-title">{projectTitle}</div>
          <p className="confirm-text">
            The photo {filename ? <strong>{filename}</strong> : 'referenced by this project'} has moved or
            been renamed. Your grid, crop, tonal settings and paper measurements are intact.
          </p>
        </div>
        <div className="confirm-detail">
          Locate the original JPG, PNG or WebP. TONAL will verify its dimensions and keep your settings.
        </div>
      </div>
    </Modal>
  );
}

export type UnsavedIntent = 'new' | 'open' | 'close' | 'close-project' | 'replace-photo';

interface UnsavedDialogProps {
  intent: UnsavedIntent;
  projectTitle: string;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

const COPY: Record<UnsavedIntent, { title: string; body: string; discard: string }> = {
  new: {
    title: 'Start a new project?',
    body: 'This project has unsaved changes. Save them before starting a new reference?',
    discard: 'Discard & start new',
  },
  open: {
    title: 'Open another project?',
    body: 'This project has unsaved changes. Save them before opening another .tonal project?',
    discard: 'Discard & open',
  },
  close: {
    title: 'Close TONAL?',
    body: 'This project has unsaved changes. Save them before closing the app?',
    discard: 'Discard & close',
  },
  'close-project': {
    title: 'Close this project?',
    body: 'This project has unsaved changes. Save them before returning to the empty studio?',
    discard: 'Discard & close',
  },
  'replace-photo': {
    title: 'Open a different photo?',
    body: 'Your grid and tonal settings will stay, but the source photo reference changes. Save the project first?',
    discard: 'Replace photo',
  },
};

export function UnsavedDialog({
  intent,
  projectTitle,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedDialogProps) {
  const copy = COPY[intent];
  return (
    <Modal
      title={copy.title}
      onClose={onCancel}
      size="md"
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={saving}>
            {copy.discard}
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving} icon={<Save size={14} />}>
            {saving ? 'Saving…' : 'Save project'}
          </Button>
        </div>
      }
    >
      <div className="confirm-body">
        <div className="confirm-icon">
          <AlertTriangle size={19} />
        </div>
        <div>
          <div className="confirm-title">{projectTitle}</div>
          <p className="confirm-text">{copy.body}</p>
        </div>
        <div className="confirm-detail">Unsaved settings are only kept in memory until the app closes.</div>
      </div>
    </Modal>
  );
}
