import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const TICKS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const fmtHz = (v) => (v >= 1000 ? `${v / 1000}k` : `${v}`);

export default function PlotArea({ measurements }) {
  const visible = measurements.filter((m) => m.visible);

  return (
    <div className="flex-1 min-w-0 h-full bg-zinc-950">
      {visible.length === 0 ? (
        <div className="h-full flex items-center justify-center text-zinc-600 text-[11px] tracking-[0.2em] uppercase">
          Toggle a measurement on the left to view its curve
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {/* Per-Line `data` props: each measurement plots against its own
              {freq, db} curve — so mixed-length legacy/new curves co-exist
              without index-aligned merging. */}
          <LineChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
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
              label={{
                value: 'FREQUENCY (Hz)',
                position: 'insideBottom',
                offset: -10,
                fill: '#52525b',
                fontSize: 10,
                letterSpacing: '0.3em',
              }}
            />
            <YAxis
              dataKey="db"
              domain={[20, 100]}
              allowDataOverflow={true}
              ticks={[20, 30, 40, 50, 60, 70, 80, 90, 100]}
              stroke="#3f3f46"
              tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
              label={{
                value: 'dB SPL',
                angle: -90,
                position: 'insideLeft',
                fill: '#52525b',
                fontSize: 10,
                letterSpacing: '0.3em',
              }}
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
            <Legend
              wrapperStyle={{
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: '#a1a1aa',
              }}
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
      )}
    </div>
  );
}
