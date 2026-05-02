"use client";

import { useToast } from "./use-toast";

export function ToastShelf() {
  const { toast, dismissToast } = useToast();
  if (!toast) return null;

  const handleUndo = () => {
    toast.onUndo?.();
    dismissToast();
  };

  return (
    <div className="toast-shelf" role="status" aria-live="polite">
      <div className="toast">
        <span>
          <b>{toast.title}</b> · {toast.detail}
        </span>
        {toast.undoable && (
          <button className="undo" type="button" onClick={handleUndo}>
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
