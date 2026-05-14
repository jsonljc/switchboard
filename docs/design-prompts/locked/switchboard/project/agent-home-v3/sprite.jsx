// Pixel sprite engine.
// Every Alex sprite is a 24×24 grid encoded as 24 strings of 24 chars.
// '.' or ' ' = transparent. Other chars are palette keys.

const SZ = 24;

// ── frame builder ───────────────────────────────────────────────────
// Compose a sprite from drawing commands. Each cmd is an array:
//   ['rect', x, y, w, h, c]
//   ['row',  y, x, str]      // skip '_' / ' ' chars to leave grid as-is
//   ['col',  x, y, str]
//   ['px',   x, y, c]
//   ['rows', startY, startX, [str, str, ...]]   // multi-row block
function buildSprite(commands) {
  const g = Array.from({ length: SZ }, () => Array(SZ).fill('.'));
  const setPx = (x, y, c) => {
    if (x >= 0 && x < SZ && y >= 0 && y < SZ && c) g[y][x] = c;
  };
  const skip = (ch) => ch === undefined || ch === '_' || ch === ' ';
  for (const cmd of commands || []) {
    if (!cmd) continue;
    const [type, ...a] = cmd;
    if (type === 'rect') {
      const [x, y, w, h, c] = a;
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) setPx(xx, yy, c);
    } else if (type === 'row') {
      const [y, x, str] = a;
      for (let i = 0; i < str.length; i++) {
        if (!skip(str[i])) setPx(x + i, y, str[i]);
      }
    } else if (type === 'col') {
      const [x, y, str] = a;
      for (let i = 0; i < str.length; i++) {
        if (!skip(str[i])) setPx(x, y + i, str[i]);
      }
    } else if (type === 'px') {
      setPx(a[0], a[1], a[2]);
    } else if (type === 'rows') {
      const [y, x, arr] = a;
      for (let i = 0; i < arr.length; i++) {
        const row = arr[i] || '';
        for (let j = 0; j < row.length; j++) {
          if (!skip(row[j])) setPx(x + j, y + i, row[j]);
        }
      }
    }
  }
  return g.map((r) => r.join(''));
}

// Apply additional commands on top of an existing sprite grid.
function mergeSprite(base, commands) {
  const grid = base.map((r) => r.split(''));
  const setPx = (x, y, c) => {
    if (x >= 0 && x < SZ && y >= 0 && y < SZ && c) grid[y][x] = c;
  };
  const skip = (ch) => ch === undefined || ch === '_' || ch === ' ';
  for (const cmd of commands || []) {
    if (!cmd) continue;
    const [type, ...a] = cmd;
    if (type === 'rect') {
      const [x, y, w, h, c] = a;
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) setPx(xx, yy, c);
    } else if (type === 'row') {
      const [y, x, str] = a;
      for (let i = 0; i < str.length; i++) {
        if (!skip(str[i])) setPx(x + i, y, str[i]);
      }
    } else if (type === 'col') {
      const [x, y, str] = a;
      for (let i = 0; i < str.length; i++) {
        if (!skip(str[i])) setPx(x, y + i, str[i]);
      }
    } else if (type === 'px') {
      setPx(a[0], a[1], a[2]);
    } else if (type === 'clear') {
      const [x, y, w, h] = a;
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) setPx(xx, yy, '.');
    } else if (type === 'rows') {
      const [y, x, arr] = a;
      for (let i = 0; i < arr.length; i++) {
        const row = arr[i] || '';
        for (let j = 0; j < row.length; j++) {
          if (!skip(row[j])) setPx(x + j, y + i, row[j]);
        }
      }
    }
  }
  return grid.map((r) => r.join(''));
}

// ── renderer ────────────────────────────────────────────────────────
function PixelSprite({ rows, palette, size = 96, bg, style, showGrid = false }) {
  const rects = [];
  for (let y = 0; y < SZ; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < SZ; x++) {
      const ch = row[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      const color = palette[ch];
      if (!color) continue;
      rects.push(
        <rect key={`${x}_${y}`} x={x} y={y} width={1.02} height={1.02} fill={color} />
      );
    }
  }
  const gridLines = showGrid ? (
    <g stroke="rgba(0,0,0,0.08)" strokeWidth="0.03">
      {Array.from({ length: SZ + 1 }, (_, i) => (
        <React.Fragment key={i}>
          <line x1={i} y1={0} x2={i} y2={SZ} />
          <line x1={0} y1={i} x2={SZ} y2={i} />
        </React.Fragment>
      ))}
    </g>
  ) : null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SZ} ${SZ}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', background: bg || 'transparent', ...style }}
    >
      {rects}
      {gridLines}
    </svg>
  );
}

// ── animation hook ──────────────────────────────────────────────────
// frames: [{rows, dur}], loops by default.
function useFrameCycle(frames, { playing = true } = {}) {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (!playing || !frames || frames.length <= 1) return;
    const f = frames[idx % frames.length];
    const t = setTimeout(() => setIdx((i) => (i + 1) % frames.length), f?.dur ?? 400);
    return () => clearTimeout(t);
  }, [idx, frames, playing]);
  return frames?.[idx % (frames?.length || 1)]?.rows;
}

function AnimatedSprite({ frames, palette, size, bg, showGrid, style }) {
  const rows = useFrameCycle(frames);
  if (!rows) return null;
  return (
    <PixelSprite rows={rows} palette={palette} size={size} bg={bg} showGrid={showGrid} style={style} />
  );
}

Object.assign(window, {
  SZ,
  buildSprite,
  mergeSprite,
  PixelSprite,
  AnimatedSprite,
  useFrameCycle,
});
