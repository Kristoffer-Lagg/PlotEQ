import React from 'react';

const TABS = [
  { id: 'measure',  label: 'Measure'  },
  { id: 'library',  label: 'Library'  },
  { id: 'tools',    label: 'Tools'    },
  { id: 'settings', label: 'Settings' },
];

export default function BottomNav() {
  return (
    <nav className="h-9 shrink-0 border-t border-zinc-800/70 bg-zinc-950 flex">
      {TABS.map((t, i) => {
        const isActive = i === 0;
        return (
          <button
            key={t.id}
            className={`flex-1 relative flex items-center justify-center text-[10px] font-bold tracking-[0.3em] uppercase transition-colors ${
              isActive ? 'text-sky-400' : 'text-zinc-600 hover:text-zinc-300'
            }`}
          >
            {isActive && (
              <span className="absolute top-0 left-0 right-0 h-px bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
            )}
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
