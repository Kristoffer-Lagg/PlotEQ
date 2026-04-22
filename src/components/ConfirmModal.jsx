import React from 'react';

export default function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', onConfirm, onDismiss }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-sm shadow-2xl p-6">
        <h3 className="text-xs font-bold tracking-[0.18em] uppercase text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-400 mt-3 leading-relaxed">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className="px-4 py-1.5 text-[10px] font-bold tracking-[0.2em] uppercase rounded-sm bg-transparent border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-[10px] font-bold tracking-[0.2em] uppercase rounded-sm bg-sky-500 hover:bg-sky-400 text-zinc-950 shadow-[0_0_20px_-6px_rgba(56,189,248,0.85)] transition-all"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
