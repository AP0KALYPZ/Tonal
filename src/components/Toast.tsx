import { useEffect } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { useAppStore } from '../state/store';

export function Toast() {
  const toast = useAppStore((state) => state.toast);
  const dismiss = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(dismiss, toast.kind === 'error' ? 9000 : 5200);
    return () => window.clearTimeout(timeout);
  }, [toast, dismiss]);

  if (!toast) return null;
  const icon =
    toast.kind === 'success' ? <Check size={15} /> : toast.kind === 'error' ? <AlertTriangle size={15} /> : <Info size={15} />;

  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
      {toast.action && toast.actionLabel ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.();
            dismiss();
          }}
        >
          {toast.actionLabel}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
