import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import PlotArea from './components/PlotArea.jsx';
import RTA from './components/RTA.jsx';
import MeasureModal from './components/MeasureModal.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import BottomNav from './components/BottomNav.jsx';
import { makeMeasurement, generateFakeCurve, formatName, nextColor } from './utils/measurements.js';
import { applySmoothing, SMOOTHING_MODES } from './utils/smoothing.js';

const STORAGE_KEY = 'ploteq:measurements:v1';
const SMOOTHING_STORAGE_KEY = 'ploteq:smoothing:v1';

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Seed with fake placeholders
  const seeds = [];
  for (let i = 0; i < 3; i++) {
    const now = new Date(Date.now() - (2 - i) * 60_000);
    seeds.push({
      id: `seed-${i}`,
      name: formatName(now),
      color: nextColor(seeds),
      visible: true,
      createdAt: now.toISOString(),
      curve: generateFakeCurve(Math.random()),
    });
  }
  return seeds;
}

export default function App() {
  const [measurements, setMeasurements] = useState(loadInitial);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [smoothing, setSmoothing] = useState(() => {
    try { return localStorage.getItem(SMOOTHING_STORAGE_KEY) || 'none'; } catch { return 'none'; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('measure');

  // Track fullscreen state so the button label reflects reality even when the
  // user exits via the ESC key or the browser's native UI.
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // iOS Safari on iPhone doesn't expose the Fullscreen API on arbitrary
      // elements — silently ignore. Users can still "Add to Home Screen" for
      // a chromeless experience.
    }
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(measurements)); } catch {}
  }, [measurements]);

  useEffect(() => {
    try { localStorage.setItem(SMOOTHING_STORAGE_KEY, smoothing); } catch {}
  }, [smoothing]);

  // Apply smoothing post-process. Each measurement keeps its original
  // `curve` untouched so flipping the dropdown (or picking None) never
  // loses data — only the `curve` field passed to PlotArea is transformed.
  const displayMeasurements = useMemo(() => {
    if (smoothing === 'none') return measurements;
    return measurements.map((m) => ({
      ...m,
      curve: applySmoothing(m.curve, smoothing),
    }));
  }, [measurements, smoothing]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      setLeaveOpen(true);
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const toggleVisible = (id) =>
    setMeasurements((ms) => ms.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)));
  const rename = (id, name) =>
    setMeasurements((ms) => ms.map((m) => (m.id === id ? { ...m, name } : m)));
  const del = (id) => setMeasurements((ms) => ms.filter((m) => m.id !== id));
  const addMeasurement = useCallback((curve) => {
    setMeasurements((ms) => [...ms, makeMeasurement(ms, curve)]);
    setMeasureOpen(false);
  }, []);

  // RTA save flow: same measurement shape, but the display name is prefixed
  // with "RTA" so captures from the analyzer are visually distinct from sweep
  // measurements in the sidebar list.
  const addRtaMeasurement = useCallback((curve) => {
    setMeasurements((ms) => {
      const m = makeMeasurement(ms, curve);
      return [...ms, { ...m, name: `RTA ${m.name}` }];
    });
  }, []);

  const downloadJson = () => {
    const visible = measurements.filter((m) => m.visible);
    const payload = visible.length ? visible : measurements;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ploteq-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveOpen(false);
  };

  return (
    <div className="h-full w-full flex flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="h-12 shrink-0 border-b border-zinc-800/70 bg-zinc-950 flex items-center justify-between px-5">
        <button
          onClick={() => setMeasureOpen(true)}
          className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm bg-sky-500 hover:bg-sky-400 text-zinc-950 transition-all shadow-[0_0_24px_-6px_rgba(56,189,248,0.85)] hover:shadow-[0_0_32px_-4px_rgba(56,189,248,1)]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-950 animate-pulse" />
          Measure
        </button>
        <div className="flex items-center gap-5">
          <h1 className="text-[11px] font-extrabold tracking-[0.45em] text-zinc-100 uppercase select-none">
            Plot<span className="text-sky-400">EQ</span>
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-[0.3em] uppercase text-zinc-600">
              Smooth
            </span>
            <select
              value={smoothing}
              onChange={(e) => setSmoothing(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-sky-500/60 text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-300 px-2 py-1 rounded-sm outline-none transition-colors cursor-pointer"
              title="Re-smooth all visible curves without re-measuring"
            >
              {SMOOTHING_MODES.map((m) => (
                <option key={m.value} value={m.value} className="bg-zinc-950 text-zinc-300">
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm bg-transparent border border-zinc-800 hover:border-sky-500/60 hover:text-sky-400 text-zinc-400 transition-colors"
          >
            {isFullscreen ? 'Exit FS' : 'Fullscreen'}
          </button>
          <button
            onClick={() => setSaveOpen(true)}
            className="px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm bg-transparent border border-zinc-800 hover:border-sky-500/60 hover:text-sky-400 text-zinc-400 transition-colors"
          >
            Save
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        <Sidebar
          measurements={measurements}
          onToggle={toggleVisible}
          onRename={rename}
          onDelete={del}
        />
        {activeTab === 'measure' ? (
          <PlotArea measurements={displayMeasurements} />
        ) : (
          <RTA smoothing={smoothing} onSaveMeasurement={addRtaMeasurement} />
        )}
      </div>

      <BottomNav active={activeTab} onChange={setActiveTab} />

      <MeasureModal
        open={measureOpen}
        onClose={() => setMeasureOpen(false)}
        onComplete={addMeasurement}
      />
      <ConfirmModal
        open={saveOpen}
        title="Save measurements?"
        message="This will download the currently visible measurements as a JSON file to your device."
        confirmLabel="Save"
        onConfirm={downloadJson}
        onDismiss={() => setSaveOpen(false)}
      />
      <ConfirmModal
        open={leaveOpen}
        title="Save before leaving?"
        message="You're about to leave PlotEQ. Save your measurements to device first?"
        confirmLabel="Save"
        onConfirm={() => {
          downloadJson();
          setLeaveOpen(false);
        }}
        onDismiss={() => setLeaveOpen(false)}
      />
    </div>
  );
}
