import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const TICKS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
// Tick labels. Suffix "Hz" onto the highest tick so we can drop the separate
// axis label entirely — same information, less chrome, more plot area.
const fmtHz = (v) => {
  if (v === 20000) return '20k Hz';
  if (v >= 1000)   return `${v / 1000}k`;
  return `${v}`;
};

export default function PlotArea({ measurements }) {
  const visible = measurements.filter((m) => m.visible);

  return (
    <div className="relative flex-1 min-w-0 h-full bg-zinc-950">
      {visible.length === 0 ? (
        <div className="h-full flex items-center justify-center text-zinc-600 text-[11px] tracking-[0.2em] uppercase">
          Toggle a measurement on the left to view its curve
        </div>
      ) : (
        <>
          {/* "dB SPL" caption floats above the 100 tick instead of the rotated
              YAxis label, so we can claim back ~30px of horizontal plot width. */}
          <div className="absolute top-1 left-3 text-[10px] font-bold tracking-[0.3em] uppercase text-zinc-500 pointer-events-none z-10">
            dB SPL
          </div>
          <ResponsiveContainer width="100%" height="100%">
            {/* Per-Line `data` props: each measurement plots against its own
                {freq, db} curve — so mixed-length legacy/new curves co-exist
                without index-aligned merging. */}
            <LineChart margin={{ top: 18, right: 20, left: -20, bottom: 6 }}>
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
                tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
              />
              <YAxis
                dataKey="db"
                domain={[20, 100]}
                allowDataOverflow={true}
                ticks={[20, 30, 40, 50, 60, 70, 80, 90, 100]}
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
              />
              <Tooltip
                contentStyle={{
                  background: '#09090b',
                  border: '1px solid #27272a',
                  borderRadius: '2px',
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  color: '#f4f4f5',
                }}
                labelStyle={{ color: '#71717a', fontSize: 10, letterSpacing: '0.15em' }}
                labelFormatter={(v) => `${fmtHz(v)} HZ`}
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
        </>
      )}
    </div>
  );
}
