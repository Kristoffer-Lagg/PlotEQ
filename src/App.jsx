import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import PlotArea from './components/PlotArea.jsx';
import RTA from './components/RTA.jsx';
import MeasureModal from './components/MeasureModal.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import BottomNav from './components/BottomNav.jsx';
import { makeMeasurement } from './utils/measurements.js';
import { applySmoothing, SMOOTHING_MODES } from './utils/smoothing.js';

const SMOOTHING_STORAGE_KEY = 'ploteq:smoothing:v1';
// Visible build stamp — lets us tell at a glance whether the phone is
// running fresh code or a cached old bundle. Bump for each behaviour
// change we want to verify on the device.
const BUILD_TAG = 'v0.8';

export default function App() {
  // Cold start: always begin with an empty list. Measurements live only in
  // memory for the duration of this app session — screen-off / background
  // preserves them, but a fresh process launch starts clean.
  const [measurements, setMeasurements] = useState([]);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [backHint, setBackHint] = useState(false);
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

  // Two-press back-button-to-close in standalone (TWA / PWA) mode only.
  //
  //   idle    -> back press -> toast "Press back again to close" for 2s
  //   hinted  -> back press -> save-or-leave modal
  //   modal   -> back press -> dismiss modal (state machine resets)
  //
  // Implementation notes:
  //   * State machine lives in a ref (phaseRef) so the popstate handler
  //     reads the current phase synchronously — React's setState is async,
  //     and rapid back presses can fire popstate again before the previous
  //     render has committed.
  //   * We keep a *buffer* of guard history entries instead of just one,
  //     so a stray extra popstate (which TWAs sometimes emit) can't deplete
  //     history and let the back press through to Chrome (which would close
  //     the app). The buffer is topped back up after each consumed pop.
  const hintTimerRef = useRef(null);
  const phaseRef = useRef('idle'); // 'idle' | 'hinted' | 'modal'
  const guardDepthRef = useRef(0);
  const GUARD_TARGET = 3;

  const topUpGuards = useCallback(() => {
    try {
      while (guardDepthRef.current < GUARD_TARGET) {
        window.history.pushState({ ploteqGuard: true }, '');
        guardDepthRef.current += 1;
      }
    } catch {}
  }, []);

  const exitApp = useCallback(() => {
    // Best-effort close: window.close() works for TWAs and PWAs launched
    // from the home screen. If the runtime refuses, unwind every guard
    // we've pushed so the user lands back on whatever was before.
    try { window.close(); } catch {}
    setTimeout(() => {
      const back = guardDepthRef.current + 1;
      if (back > 0) {
        try { window.history.go(-back); } catch {}
      }
    }, 50);
  }, []);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true;
    if (!standalone) return;

    topUpGuards();

    const onPopState = () => {
      // A guard was just consumed by the back press.
      guardDepthRef.current = Math.max(0, guardDepthRef.current - 1);

      // Read + advance phase synchronously so concurrent popstates can't
      // re-process the same phase.
      const phase = phaseRef.current;

      if (phase === 'modal') {
        phaseRef.current = 'idle';
        setLeaveOpen(false);
        topUpGuards();
        return;
      }

      if (phase === 'hinted') {
        phaseRef.current = 'modal';
        clearTimeout(hintTimerRef.current);
        setBackHint(false);
        setLeaveOpen(true);
        topUpGuards();
        return;
      }

      // idle -> hinted
      phaseRef.current = 'hinted';
      setBackHint(true);
      topUpGuards();
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => {
        if (phaseRef.current === 'hinted') phaseRef.current = 'idle';
        setBackHint(false);
      }, 2000);
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      clearTimeout(hintTimerRef.current);
    };
    // Mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const downloadJson = async () => {
    const visible = measurements.filter((m) => m.visible);
    const payload = visible.length ? visible : measurements;
    const json = JSON.stringify(payload, null, 2);
    const suggested = `ploteq-${Date.now()}.json`;

    // Prefer the File System Access API so the user picks the destination
    // (Chrome desktop + Chrome Android). Falls back to anchor-download on
    // browsers that don't expose showSaveFilePicker (Firefox, Safari, older
    // Chrome) — those land in the default Downloads folder as before.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{
            description: 'PlotEQ measurement',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
      } catch (err) {
        // AbortError = user cancelled the picker; swallow silently.
        if (err?.name !== 'AbortError') console.error(err);
      }
      setSaveOpen(false);
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggested;
    a.click();
    URL.revokeObjectURL(url);
    setSaveOpen(false);
  };

  // Shared header-button class string for the two right-side icons
  // (Fullscreen, Save) that appear on both tabs.
  const headerBtn =
    'px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm bg-transparent border border-zinc-800 hover:border-sky-500/60 hover:text-sky-400 text-zinc-400 transition-colors';

  return (
    <div className="h-full w-full flex flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar — full controls on the Measure tab, minimal on the RTA tab. */}
      <header className="h-12 shrink-0 border-b border-zinc-800/70 bg-zinc-950 flex items-center justify-between px-5">
        {activeTab === 'measure' ? (
          <>
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
          </>
        ) : (
          // RTA: empty left/center. Full width available for the plot below.
          <div />
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className={headerBtn}
          >
            {isFullscreen ? 'Exit FS' : 'Fullscreen'}
          </button>
          <button onClick={() => setSaveOpen(true)} className={headerBtn}>
            Save
          </button>
        </div>
      </header>

      {/* Body — sidebar only on Measure tab; RTA uses the full width. */}
      <div className="flex-1 min-h-0 flex">
        {activeTab === 'measure' ? (
          <>
            <Sidebar
              measurements={measurements}
              onToggle={toggleVisible}
              onRename={rename}
              onDelete={del}
            />
            <PlotArea measurements={displayMeasurements} />
          </>
        ) : (
          <RTA onSaveMeasurement={addRtaMeasurement} />
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
        message="Save your measurements to device before closing PlotEQ?"
        confirmLabel="Save & close"
        dismissLabel="Close without saving"
        onConfirm={async () => {
          await downloadJson();
          setLeaveOpen(false);
          exitApp();
        }}
        onDismiss={() => {
          setLeaveOpen(false);
          exitApp();
        }}
      />

      {/* Back-hint toast — shown after the first back press in standalone
          mode. Sits above the bottom nav so it doesn't get covered. */}
      {backHint && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-20 z-40 px-4 py-2 rounded-sm bg-zinc-900 border border-zinc-800 shadow-lg pointer-events-none">
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-300">
            Press back again to close
          </span>
        </div>
      )}

      {/* Tiny build stamp, bottom-left — purely diagnostic so we can tell
          if the phone has loaded the latest deploy. */}
      <span className="fixed bottom-1 left-1 z-50 text-[8px] font-mono text-zinc-700 pointer-events-none select-none">
        {BUILD_TAG}
      </span>
    </div>
  );
}
