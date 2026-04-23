import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createSweep } from '../utils/audioEngine.js';
import { parseCalFile, applyCalibration } from '../utils/calParser.js';

const QUALITIES = ['128k', '256k', '512k', '1M', '2M', '4M'];
const STORAGE_MIC_KEY = 'ploteq:mic:last';
const calStorageKey = (label) => `ploteq:cal:${label}`;
// Session-only decision (cleared when tab closes): 'use' | 'skip'
const calDecisionKey = (label) => `ploteq:cal-decision:${label}`;

export default function MeasureModal({ open, onClose, onComplete }) {
  const [startHz, setStartHz] = useState(20);
  const [stopHz, setStopHz] = useState(20000);
  const [volume, setVolume] = useState(0);
  const [quality, setQuality] = useState('512k');

  // Mic state
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Calibration state
  const [calData, setCalData] = useState(null);       // parsed cal, null = no cal
  const [calFileName, setCalFileName] = useState(''); // display name
  const [pendingCal, setPendingCal] = useState(null); // { fileName, content } awaiting confirm

  // Sweep state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const sweepRef = useRef(null);
  const fileInputRef = useRef(null);

  // Enumerate audio input devices. Android Chrome hides non-default mics
  // (including USB OTG) until getUserMedia permission is granted AND labels
  // become available — so we trigger a throwaway permission request on first
  // open, then enumerate.
  const enumerate = useCallback(async (keepDeviceId) => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter((d) => d.kind === 'audioinput');
      // If labels are all empty, we haven't been granted mic permission yet —
      // request it (and immediately release the stream) so the next enumeration
      // returns real labels and the full device list (USB OTG mics included).
      const needsPermission = mics.length === 0 || mics.every((m) => !m.label);
      if (needsPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          const all2 = await navigator.mediaDevices.enumerateDevices();
          const mics2 = all2.filter((d) => d.kind === 'audioinput');
          setDevices(mics2);
          applyInitialPick(mics2, keepDeviceId);
          return;
        } catch {
          // Permission denied — fall through with the redacted list
        }
      }
      setDevices(mics);
      applyInitialPick(mics, keepDeviceId);
    } catch {}
  }, []);

  const applyInitialPick = (mics, keepDeviceId) => {
    const lastId = keepDeviceId || localStorage.getItem(STORAGE_MIC_KEY);
    const match = lastId && mics.find((m) => m.deviceId === lastId);
    const pick = match ? match : mics[0];
    if (pick) {
      setSelectedDeviceId(pick.deviceId);
      checkSavedCal(pick.label || pick.deviceId);
    }
  };

  useEffect(() => {
    if (!open) return;
    enumerate();
  }, [open, enumerate]);

  // Hot-plug: Android OTG USB mic appearing/disappearing fires devicechange
  useEffect(() => {
    if (!open) return;
    const handler = () => enumerate(selectedDeviceId);
    navigator.mediaDevices.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handler);
  }, [open, enumerate, selectedDeviceId]);

  // Back-compat name used by the sweep completion path
  const reEnumerate = (keepDeviceId) => enumerate(keepDeviceId);

  const checkSavedCal = (micLabel) => {
    try {
      const raw = localStorage.getItem(calStorageKey(micLabel));
      if (raw) {
        const { fileName, content } = JSON.parse(raw);
        // Respect prior decision in this browser session
        const decision = sessionStorage.getItem(calDecisionKey(micLabel));
        if (decision === 'use') {
          try {
            const parsed = parseCalFile(content);
            setCalData(parsed);
            setCalFileName(fileName);
            setPendingCal(null);
            return;
          } catch {
            // Fall through to prompt if saved cal is corrupt
          }
        }
        if (decision === 'skip') {
          setPendingCal(null);
          setCalData(null);
          setCalFileName('');
          return;
        }
        setPendingCal({ fileName, content, micLabel });
        setCalData(null);
        setCalFileName('');
        return;
      }
    } catch {}
    setPendingCal(null);
    setCalData(null);
    setCalFileName('');
  };

  const handleMicChange = (deviceId) => {
    setSelectedDeviceId(deviceId);
    localStorage.setItem(STORAGE_MIC_KEY, deviceId);
    const dev = devices.find((d) => d.deviceId === deviceId);
    checkSavedCal(dev?.label || deviceId);
  };

  const acceptPendingCal = () => {
    if (!pendingCal) return;
    try {
      const parsed = parseCalFile(pendingCal.content);
      setCalData(parsed);
      setCalFileName(pendingCal.fileName);
      sessionStorage.setItem(calDecisionKey(pendingCal.micLabel), 'use');
    } catch {
      setError('Could not parse saved calibration file.');
    }
    setPendingCal(null);
  };

  const rejectPendingCal = () => {
    if (pendingCal) sessionStorage.setItem(calDecisionKey(pendingCal.micLabel), 'skip');
    setPendingCal(null);
    setCalData(null);
    setCalFileName('');
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      try {
        const parsed = parseCalFile(content);
        setCalData(parsed);
        setCalFileName(file.name);
        setPendingCal(null);
        // Persist for this mic
        const dev = devices.find((d) => d.deviceId === selectedDeviceId);
        const micLabel = dev?.label || selectedDeviceId;
        localStorage.setItem(calStorageKey(micLabel), JSON.stringify({ fileName: file.name, content }));
        sessionStorage.setItem(calDecisionKey(micLabel), 'use');
      } catch {
        setError('Could not parse calibration file. Expected UMIK-style format.');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected later
    e.target.value = '';
  };

  const removeCal = () => {
    const dev = devices.find((d) => d.deviceId === selectedDeviceId);
    const label = dev?.label || selectedDeviceId;
    if (label) sessionStorage.setItem(calDecisionKey(label), 'skip');
    setCalData(null);
    setCalFileName('');
    setPendingCal(null);
  };

  const start = async () => {
    setError(null);
    setProgress(0);
    setRunning(true);

    const sweep = createSweep({
      startHz,
      stopHz,
      volumeDb: volume,
      quality,
      deviceId: selectedDeviceId || undefined,
      onProgress: (p) => setProgress(p),
    });
    sweepRef.current = sweep;

    try {
      let curve = await sweep.promise; // raw dBFS [{freq, db}]
      // Re-enumerate now that permission is granted — labels may have appeared
      reEnumerate(selectedDeviceId);
      // Apply calibration in raw dBFS space (before display mapping)
      if (calData) curve = applyCalibration(curve, calData);
      // Map raw dBFS to display range [20, 100].
      // Offset +120 so [-100, -20] dBFS → [20, 100] display dB.
      curve = curve.map(({ freq, db }) => ({
        freq,
        db: +Math.max(20, Math.min(100, db + 120)).toFixed(2),
      }));
      setRunning(false);
      setProgress(0);
      sweepRef.current = null;
      onComplete(curve);
    } catch (err) {
      setRunning(false);
      setProgress(0);
      sweepRef.current = null;
      if (err?.message === 'cancelled') return;
      if (err?.name === 'NotAllowedError') setError('Microphone permission denied.');
      else if (err?.name === 'NotFoundError') setError('No microphone found.');
      else setError(err?.message || 'Sweep failed.');
    }
  };

  const cancel = () => {
    sweepRef.current?.cancel();
    sweepRef.current = null;
    setRunning(false);
    setProgress(0);
  };

  const close = () => {
    cancel();
    setError(null);
    onClose();
  };

  if (!open) return null;

  const selectedDev = devices.find((d) => d.deviceId === selectedDeviceId);
  const micLabel = selectedDev?.label || selectedDeviceId || '';

  // Shared class strings for the refreshed look
  const labelCls = 'block text-[10px] font-bold tracking-[0.25em] uppercase text-zinc-500';
  const inputCls = 'mt-2 w-full bg-zinc-950 border border-zinc-800 focus:border-sky-500/60 rounded-sm px-3 py-1.5 text-[12px] text-zinc-100 font-mono outline-none transition-colors';
  const ghostBtn = 'text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-1.5 rounded-sm bg-transparent border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-sm shadow-2xl flex flex-col">

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="text-[11px] font-bold tracking-[0.3em] uppercase text-zinc-100">New Measurement</h3>
          <button
            onClick={close}
            className="text-zinc-600 hover:text-zinc-200 text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">

          {/* Frequency range */}
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              Start Hz
              <input
                type="number"
                value={startHz}
                min={1}
                onChange={(e) => setStartHz(+e.target.value)}
                disabled={running}
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              Stop Hz
              <input
                type="number"
                value={stopHz}
                min={1}
                onChange={(e) => setStopHz(+e.target.value)}
                disabled={running}
                className={inputCls}
              />
            </label>
          </div>

          {/* Volume */}
          <label className={labelCls}>
            <div className="flex items-center justify-between">
              <span>Volume</span>
              <span className="text-[11px] font-mono tracking-tight text-sky-400 normal-case">
                {volume > 0 ? `+${volume}` : volume} dB
              </span>
            </div>
            <input
              type="range"
              min={-30}
              max={30}
              value={volume}
              onChange={(e) => setVolume(+e.target.value)}
              disabled={running}
              className="mt-2 w-full accent-sky-500"
            />
          </label>

          {/* Quality */}
          <label className={labelCls}>
            Quality
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={running}
              className={inputCls}
            >
              {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>

          {/* Divider */}
          <div className="border-t border-zinc-800" />

          {/* Microphone selector */}
          <div>
            <div className="flex items-center justify-between">
              <span className={labelCls}>Microphone</span>
              <button
                onClick={() => enumerate(selectedDeviceId)}
                disabled={running}
                title="Re-scan audio devices (plug in USB mic first)"
                className="text-[9px] font-bold tracking-[0.2em] uppercase px-2 py-1 rounded-sm bg-transparent border border-zinc-800 hover:border-sky-500/60 hover:text-sky-400 text-zinc-500 transition-colors"
              >
                Refresh
              </button>
            </div>
            <select
              value={selectedDeviceId}
              onChange={(e) => handleMicChange(e.target.value)}
              disabled={running}
              className={inputCls}
            >
              {devices.length === 0
                ? <option value="">Default microphone</option>
                : devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
                    </option>
                  ))
              }
            </select>
          </div>

          {/* Calibration section */}
          <div className="space-y-2">
            <div className={labelCls}>Calibration</div>

            {/* Pending cal prompt */}
            {pendingCal && (
              <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2">
                <span className="text-[11px] text-zinc-400 truncate mr-2 font-mono">
                  Last used: <span className="text-sky-400">{pendingCal.fileName}</span>
                </span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={acceptPendingCal}
                    className="text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-1.5 rounded-sm bg-sky-500 hover:bg-sky-400 text-zinc-950 shadow-[0_0_16px_-6px_rgba(56,189,248,0.85)] transition-all"
                  >
                    Use
                  </button>
                  <button onClick={rejectPendingCal} className={ghostBtn}>
                    No
                  </button>
                </div>
              </div>
            )}

            {/* Active cal file */}
            {!pendingCal && calData && (
              <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2">
                <span className="text-[11px] text-emerald-400 truncate mr-2 font-mono tracking-tight">
                  ✓ {calFileName}
                </span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={running}
                    className={ghostBtn}
                  >
                    Change
                  </button>
                  <button onClick={removeCal} disabled={running} className={ghostBtn}>
                    Remove
                  </button>
                </div>
              </div>
            )}

            {/* No cal loaded */}
            {!pendingCal && !calData && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] tracking-[0.18em] uppercase text-amber-400/80">
                  No calibration — uncalibrated
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={running}
                  className={`${ghostBtn} shrink-0`}
                >
                  Load file
                </button>
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.cal,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Progress bar */}
          {running && (
            <div>
              <div className="h-[2px] w-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.9)] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[10px] font-bold tracking-[0.3em] uppercase text-zinc-500 mt-2">
                Sweeping · <span className="text-sky-400 font-mono tracking-tight normal-case">{Math.round(progress)}%</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/60 rounded-sm px-3 py-2 font-mono tracking-tight">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
          {running ? (
            <button
              onClick={cancel}
              className="px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm bg-red-500 hover:bg-red-400 text-zinc-950 shadow-[0_0_20px_-6px_rgba(248,113,113,0.85)] transition-all"
            >
              Cancel
            </button>
          ) : (
            <>
              <button onClick={close} className={ghostBtn}>
                Close
              </button>
              <button
                onClick={start}
                className="px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm bg-sky-500 hover:bg-sky-400 text-zinc-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.85)] hover:shadow-[0_0_32px_-4px_rgba(56,189,248,1)] transition-all"
              >
                Start
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
