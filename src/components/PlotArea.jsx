import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import PlotTooltip from './PlotTooltip.jsx';

const TICKS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
// Tick labels. Suffix "Hz" onto the highest tick so we can drop the separate
// axis label entirely — same information, less chrome, more plot area.
// Tooltip hover values can be arbitrary floats with precision-noise tails
// (e.g. 1234.5600000007 from log-spacing math), so we clean those before
// dividing by 1000 — otherwise the noise gets amplified into the display.
const cleanHz = (v) => +(+v).toPrecision(7);
const fmtHz = (v) => {
  if (v == null || Number.isNaN(v)) return '';
  const c = cleanHz(v);
  if (c === 20000) return '20k Hz';
  if (c >= 1000)   return `${c / 1000}k`;
  return `${c}`;
};

export default function PlotArea({ measurements }) {
  const visible = measurements.filter((m) => m.visible);
  // When the user taps the X on the tooltip, suppress all tooltips for a
  // short window so the same tap leaking through to the chart underneath
  // doesn't immediately re-summon the popup. After the window expires the
  // next touch-on-curve naturally re-shows the tooltip.
  const [suppressedUntil, setSuppressedUntil] = useState(0);
  const dismissTooltip = () => setSuppressedUntil(Date.now() + 500);

  return (
    <div className="relative flex-1 min-w-0 h-full bg-zinc-950">
      {visible.length === 0 ? (
        <div className="h-full flex items-center justify-center text-zinc-600 text-[11px] tracking-[0.2em] uppercase">
          Toggle a measurement on the left to view its curve
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height="100%">
            {/* Per-Line `data` props: each measurement plots against its own
                {freq, db} curve — so mixed-length legacy/new curves co-exist
                without index-aligned merging. */}
            <LineChart margin={{ top: 8, right: 18, left: -26, bottom: 4 }}>
              <CartesianGrid stroke="#18181b" strokeDasharray="2 4" />
              <XAxis
                dataKey="freq"
                type="number"
                scale="log"
                domain={[20, 20000]}
                allowDataOverflow={true}
                ticks={TICKS}
                tickFormatter={fmtHz}
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
              />
              <YAxis
                dataKey="db"
                domain={[20, 100]}
                allowDataOverflow={true}
                ticks={[20, 30, 40, 50, 60, 70, 80, 90, 100]}
                tickFormatter={(v) => `${v}`}
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
              />
              <Tooltip
                isAnimationActive={false}
                content={(props) => (
                  <PlotTooltip
                    {...props}
                    fmtHz={fmtHz}
                    suppressedUntil={suppressedUntil}
                    onDismiss={dismissTooltip}
                  />
                )}
              />
              {visible.map((m) => (
                <Line
                  key={m.id}
                  data={m.curve}
                  type="linear"
                  dataKey="db"
                  name={m.name}
                  stroke={m.color}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {/* "dB" unit annotation — overlaid via CSS so it renders
              reliably regardless of axis margin. Vertically aligned with
              the top-most "100" tick label, with a small horizontal gap
              from the y-axis line. */}
          <span className="absolute top-[5px] left-[44px] text-[9px] font-semibold text-zinc-500 pointer-events-none select-none font-mono tracking-tight leading-none">
            dB
          </span>
        </>
      )}
    </div>
  );
}
