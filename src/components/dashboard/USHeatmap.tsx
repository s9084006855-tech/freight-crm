interface StateCount {
  state: string;
  count: number;
}

interface Props {
  data: StateCount[];
  onStateClick?: (state: string) => void;
}

// Simplified SVG US map with approximate state positions as a grid
// For a production build this would use react-simple-maps, but this avoids
// the React 19 peer dep conflict entirely.

const STATE_POSITIONS: Record<string, [number, number]> = {
  WA: [1, 0], OR: [1, 1], CA: [1, 2],
  ID: [2, 0], NV: [2, 1], AZ: [2, 2],
  MT: [3, 0], WY: [3, 1], UT: [3, 2], NM: [3, 3],
  ND: [4, 0], SD: [4, 1], CO: [4, 2],
  NE: [5, 1], KS: [5, 2], OK: [5, 3], TX: [5, 4],
  MN: [6, 0], IA: [6, 1], MO: [6, 2], AR: [6, 3], LA: [6, 4],
  WI: [7, 0], IL: [7, 1], MS: [7, 3],
  MI: [8, 0], IN: [8, 1], KY: [8, 2], TN: [8, 3], AL: [8, 4],
  OH: [9, 1], WV: [9, 2], NC: [9, 3], GA: [9, 4], FL: [9, 5],
  PA: [10, 1], VA: [10, 2], SC: [10, 3],
  NY: [11, 0], MD: [11, 1], DE: [11, 2],
  NJ: [12, 1], CT: [12, 2], RI: [12, 3],
  MA: [13, 1], NH: [13, 2], VT: [13, 3],
  ME: [14, 2],
  AK: [0, 5], HI: [1, 5],
};

function lerp(t: number): string {
  const colors = [
    [24, 24, 27],   // zinc-900 #18181b
    [37, 99, 235],  // blue-600 #2563eb
  ];
  const r = Math.round(colors[0][0] + (colors[1][0] - colors[0][0]) * t);
  const g = Math.round(colors[0][1] + (colors[1][1] - colors[0][1]) * t);
  const bv = Math.round(colors[0][2] + (colors[1][2] - colors[0][2]) * t);
  return `rgb(${r},${g},${bv})`;
}

export function USHeatmap({ data, onStateClick }: Props) {
  const countMap: Record<string, number> = {};
  for (const d of data) countMap[d.state] = d.count;
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const cellSize = 28;
  const cols = 15;
  const rows = 6;
  const width = cols * (cellSize + 2);
  const height = rows * (cellSize + 2);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
        Contacts by state
      </h3>
      <svg width={width} height={height} className="overflow-visible">
        {Object.entries(STATE_POSITIONS).map(([state, [col, row]]) => {
          const count = countMap[state] ?? 0;
          const t = count / maxCount;
          const fill = count === 0 ? "#18181b" : lerp(t);
          const x = col * (cellSize + 2);
          const y = row * (cellSize + 2);
          return (
            <g
              key={state}
              onClick={() => onStateClick?.(state)}
              style={{ cursor: onStateClick ? "pointer" : "default" }}
            >
              <rect
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx={4}
                fill={fill}
                stroke="#27272a"
                strokeWidth={1}
              />
              <text
                x={x + cellSize / 2}
                y={y + cellSize / 2 + 4}
                textAnchor="middle"
                fontSize={8}
                fill={count > 0 ? "#e4e4e7" : "#52525b"}
                fontFamily="monospace"
              >
                {state}
              </text>
              {count > 0 && (
                <text
                  x={x + cellSize - 3}
                  y={y + 9}
                  textAnchor="end"
                  fontSize={7}
                  fill="#a1a1aa"
                  fontFamily="monospace"
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
