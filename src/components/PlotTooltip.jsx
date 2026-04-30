import React from 'react';

/**
 * Custom Recharts tooltip with an explicit X close button. Used by both
 * the measurement plot and the RTA live plot.
 *
 * Recharts owns the tooltip's visibility (it shows it whenever the cursor
 * or finger is on a data point), so we can't truly "close" it from inside
 * the content. Instead, when the user taps X, the parent records a short
 * suppression window (~500 ms) during which we always return null — that
 * gives the user a moment to see the plot without the tooltip popping
 * back up from the same tap leaking through to the chart. After the
 * window expires, normal hover/touch tooltips resume.
 */
export default function PlotTooltip({
  active,
  payload,
  label,
  fmtHz,
  suppressedUntil = 0,
  onDismiss,
}) {
  if (!active || !payload?.length) return null;
  if (Date.now() < suppressedUntil) return null;

  return (
    <div
      className="bg-zinc-950/95 border border-zinc-800 rounded-sm shadow-lg backdrop-blur-sm font-mono text-zinc-100 relative pointer-events-auto"
      style={{ padding: '6px 30px 6px 8px', fontSize: 11 }}
    >
      {/* Close button — sits outside the top-right corner. Both pointer
          and touch handlers stopPropagation so the tap doesn't bubble to
          the chart underneath; the parent also sets a suppression window
          via onDismiss so any event that DID leak through still gets
          ignored for the next ~500ms. */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onDismiss?.();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        onTouchEnd={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onDismiss?.();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.();
        }}
        className="absolute top-[-4px] right-[-4px] w-8 h-7 flex items-center justify-center text-red-500 hover:text-red-400 active:text-red-300 transition-colors touch-manipulation"
        style={{ touchAction: 'none' }}
        aria-label="Close tooltip"
      >
        <span className="text-[20px] leading-none font-bold">×</span>
      </button>

      <div
        className="text-zinc-500 tracking-[0.15em]"
        style={{ fontSize: 10, marginBottom: 2 }}
      >
        {fmtHz ? `${fmtHz(label)} HZ` : `${label} HZ`}
      </div>
      {payload.map((p, i) => {
        const v = typeof p.value === 'number' ? p.value.toFixed(1) : p.value;
        return (
          <div
            key={`${p.dataKey}-${i}`}
            className="flex items-baseline gap-2 leading-tight"
            style={{ color: p.color || p.stroke || '#f4f4f5' }}
          >
            <span className="truncate max-w-[140px]">{p.name}</span>
            <span className="ml-auto tabular-nums">{v} dB</span>
          </div>
        );
      })}
    </div>
  );
}
