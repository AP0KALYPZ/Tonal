import { useState } from 'react';
import { FileImage, Printer } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../state/store';
import { PngExportForm } from './PngExportForm';
import { PdfExportForm } from './PdfExportForm';

interface ExportDialogProps {
  initialTab: 'png' | 'pdf';
  onClose: () => void;
}

export function ExportDialog({ initialTab, onClose }: ExportDialogProps) {
  const [tab, setTab] = useState<'png' | 'pdf'>(initialTab);
  const busy = useAppStore((state) => state.busy);

  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal
      title="Export reference"
      subtitle="Save a high-quality guide for your drawing. Nothing is uploaded."
      onClose={close}
      size="lg"
      headerExtra={
        <div className="modal-tabs" role="tablist" aria-label="Export format">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'png'}
            className={`modal-tab${tab === 'png' ? ' is-active' : ''}`}
            onClick={() => setTab('png')}
          >
            <FileImage size={13} /> PNG reference
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pdf'}
            className={`modal-tab${tab === 'pdf' ? ' is-active' : ''}`}
            onClick={() => setTab('pdf')}
          >
            <Printer size={13} /> Print PDF
          </button>
        </div>
      }
    >
      {tab === 'png' ? <PngExportForm onClose={close} /> : <PdfExportForm onClose={close} />}
    </Modal>
  );
}
