import { Modal } from '../components/Modal';
import { Button } from '../components/Button';

interface ShortcutsDialogProps {
  onClose: () => void;
}

const GROUPS: Array<{ title: string; rows: Array<{ label: string; keys: string[] }> }> = [
  {
    title: 'Project',
    rows: [
      { label: 'Open photo', keys: ['Ctrl', 'O'] },
      { label: 'Open project', keys: ['Ctrl', 'Shift', 'O'] },
      { label: 'Save project', keys: ['Ctrl', 'S'] },
      { label: 'Save as', keys: ['Ctrl', 'Shift', 'S'] },
      { label: 'New project', keys: ['Ctrl', 'N'] },
      { label: 'Export dialog', keys: ['Ctrl', 'E'] },
    ],
  },
  {
    title: 'Compose',
    rows: [
      { label: 'Pan while dragging', keys: ['Space'] },
      { label: 'Zoom in / out', keys: ['+', '−'] },
      { label: 'Fit reference', keys: ['0'] },
      { label: 'Actual pixels', keys: ['1'] },
      { label: 'Mirror reference', keys: ['M'] },
      { label: 'Show or hide grid', keys: ['G'] },
    ],
  },
  {
    title: 'Inspect',
    rows: [
      { label: 'Hold to compare original', keys: ['C'] },
      { label: 'Loupe and tone sample', keys: ['L'] },
      { label: 'Undo / redo', keys: ['Ctrl', 'Z'] },
      { label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: 'Keyboard shortcuts', keys: ['?'] },
      { label: 'Close dialog or tool', keys: ['Esc'] },
    ],
  },
];

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  return (
    <Modal
      title="Keyboard shortcuts"
      subtitle="Shortcuts pause while you type in a field or work in a dialog."
      onClose={onClose}
      size="md"
      footer={
        <>
          <span className="info-note">
            Wheel scrolls the canvas. Ctrl/Cmd + wheel zooms around the pointer.
          </span>
          <div className="modal-footer-actions">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      }
    >
      <div className="shortcut-grid">
        {GROUPS.map((group) => (
          <div className="shortcut-group" key={group.title}>
            <h3>{group.title}</h3>
            {group.rows.map((row) => (
              <div className="shortcut-row" key={row.label}>
                <span>{row.label}</span>
                <span className="shortcut-keys">
                  {row.keys.map((key) => (
                    <span className="kbd" key={key}>
                      {key}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
