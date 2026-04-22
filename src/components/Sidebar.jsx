import React, { useState } from 'react';

export default function Sidebar({ measurements, onToggle, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const startEdit = (m) => {
    setEditingId(m.id);
    setDraft(m.name);
  };
  const commitEdit = (id) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
  };

  return (
    <aside className="w-60 shrink-0 border-r border-zinc-800/70 bg-zinc-950 flex flex-col">
      <div className="px-5 py-3 border-b border-zinc-800/70">
        <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em]">
          Measurements
        </h2>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {measurements.length === 0 && (
          <li className="px-5 py-6 text-[11px] text-zinc-600 tracking-wide">
            No measurements yet.
          </li>
        )}
        {measurements.map((m) => (
          <li
            key={m.id}
            className="group flex items-center gap-2.5 pl-3 pr-3 py-2 border-l-2 border-transparent hover:border-sky-500 hover:bg-zinc-900/60 transition-colors"
          >
            <input
              type="checkbox"
              checked={m.visible}
              onChange={() => onToggle(m.id)}
              className="accent-sky-500 h-3.5 w-3.5 cursor-pointer"
            />
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: m.color, boxShadow: `0 0 8px -1px ${m.color}` }}
            />
            {editingId === m.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitEdit(m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(m.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="flex-1 bg-zinc-900 border border-sky-500/60 text-zinc-100 text-[11px] px-2 py-0.5 rounded-sm outline-none font-mono"
              />
            ) : (
              <button
                onClick={() => startEdit(m)}
                className="flex-1 text-left text-[11px] text-zinc-300 truncate font-mono tracking-tight"
                title="Tap to rename"
              >
                {m.name}
              </button>
            )}
            <button
              onClick={() => onDelete(m.id)}
              className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs px-1 transition-opacity"
              title="Delete"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
