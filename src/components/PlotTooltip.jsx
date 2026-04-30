import React from 'react';

/**
 * Custom Recharts tooltip with an explicit X close button. Used by both
 * the measurement plot and the RTA live plot.
 *
 * Recharts owns the tooltip's visibility (it shows it whenever the cursor
 * or finger is on a data point), so we can't truly "close" it from inside
 * the content. Instead we:
 *   1. record which label (= frequency) the user has dismissed in parent
 *      state via `onDismiss(label)`
 *   2. return null from the content while `dismissedLabel === label`
 *   3. reset automatically when the user moves to a different label
 *      (the parent handles that — when label changes from the dismissed
 *      one, the tooltip naturally renders again)
 */
export default function PlotTooltip({
  active,
  payload,
  label,
  fmtHz,
  dismissedLabel,
  onDismiss,
}) {
  if (!active || !payload?.length) return null;
  if (dismissedLabel != null && dismissedLabel === label) return null;

  return (
    <div
      className="bg-zinc-950/95 border border-zinc-800 rounded-sm shadow-lg backdrop-blur-sm font-mono text-zinc-100 relative pointer-events-auto"
      style={{ padding: '6px 22px 6px 8px', fontSize: 11 }}
    >
      {/* Close button — bigger hit area on the right edge so a fingertip
          can reliably tap it without grazing the data rows. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.(label);
        }}
        onTouchEnd={(e) => {
          e.stopPropagation();
          onDismiss?.(label);
        }}
        className="absolute top-0 right-0 w-5 h-full flex items-center justify-center text-zinc-500 hover:text-zinc-100 active:text-sky-400 transition-colors"
        aria-label="Close tooltip"
      >
        <span className="text-[12px] leading-none">×</span>
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
