import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { LifeGrid } from '../components/LifeGrid';
import { Backdrop, Eyebrow, Heading, Rise } from '../components/ui';
import { C, FONT } from '../theme';
import { framesOf, getPattern, padBitmap, placeBitmap, type Bitmap } from '../lib/life';

const toBitmap = (rows: string[]): Bitmap => {
  const w = rows[0].length;
  const h = rows.length;
  const cells = new Array<number>(w * h).fill(0);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (cells[y * w + x] = ch === 'O' ? 1 : 0)));
  return { w, h, cells };
};

/** 往已有画布上叠加一个图案（placeBitmap 会新建空画布，不能叠第二层） */
const mergeInto = (base: Bitmap, bm: Bitmap, ox: number, oy: number): Bitmap => {
  const out: Bitmap = { w: base.w, h: base.h, cells: base.cells.slice() };
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) {
      if (bm.cells[y * bm.w + x]) out.cells[(oy + y) * out.w + (ox + x)] = 1;
    }
  }
  return out;
};

/** 大字计数器：让"时间在走"和"画面没变"形成对撞 */
const BigCounter: React.FC<{ gen: number; label: string; color?: string; size?: number }> = ({
  gen,
  label,
  color = C.accent,
  size = 64,
}) => (
  <div style={{ textAlign: 'right' }}>
    <div style={{ fontSize: 18, color: C.dim, letterSpacing: 4 }}>{label}</div>
    <div
      style={{
        fontSize: size,
        fontWeight: 800,
        color,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 1,
        lineHeight: 1.05,
        textShadow: `0 0 30px ${color}33`,
      }}
    >
      {Math.max(0, Math.floor(gen)).toLocaleString('en-US')}
    </div>
  </div>
);

/** 逐段出现的叙述：旧句子变暗，新句子亮起，引导注意力 */
const Lines: React.FC<{ lines: { at: number; text: string; big?: boolean }[]; width?: number }> = ({
  lines,
  width = 700,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width }}>
      {lines.map((l, i) => {
        const a = interpolate(frame, [l.at, l.at + 12], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const isLast = i === lines.length - 1 || frame < lines[i + 1].at;
        return (
          <div
            key={l.text}
            style={{
              opacity: a * (isLast ? 1 : 0.32),
              transform: `translateY(${(1 - a) * 10}px)`,
              fontSize: l.big ? 30 : 25,
              lineHeight: 1.65,
              fontWeight: l.big ? 700 : 400,
              color: isLast ? C.text : C.dim,
              transition: 'none',
            }}
          >
            {l.text}
          </div>
        );
      })}
    </div>
  );
};

/** 参数小卡：给数据一个落点，免得左下半边空着 */
const StatTile: React.FC<{ k: string; v: string; u?: string }> = ({ k, v, u }) => (
  <div
    style={{
      flex: 1,
      padding: '13px 18px 14px',
      borderRadius: 14,
      border: `1px solid ${C.line}`,
      background: 'rgba(10,16,23,0.72)',
    }}
  >
    <div style={{ fontSize: 15, letterSpacing: 3, color: C.dim }}>{k}</div>
    <div
      style={{
        marginTop: 5,
        fontSize: 32,
        fontWeight: 800,
        lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {v}
      {u && <span style={{ marginLeft: 6, fontSize: 15, fontWeight: 400, color: C.dim }}>{u}</span>}
    </div>
  </div>
);

/**
 * 一条"节拍轨道"：一格 = 一代，每 p 格一个刻度。
 * 光点波浪式扫过，刻度亮起 —— 把"周期"变成看得见的节拍。
 */
const PulseTrack: React.FC<{ p: number; cells: number }> = ({ p, cells }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 26 }}>
      {Array.from({ length: cells }, (_, i) => {
        const tick = i % p === 0;
        const wave = (Math.sin(frame / 7 - i * 0.34) + 1) / 2;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: tick ? 20 : 5,
              borderRadius: 3,
              background: tick ? C.accent : 'rgba(120,200,220,0.28)',
              opacity: tick ? 0.5 + 0.5 * wave : 0.1 + 0.14 * wave,
              boxShadow: tick && wave > 0.72 ? `0 0 12px ${C.accentSoft}` : 'none',
            }}
          />
        );
      })}
    </div>
  );
};

const PULSE_ROWS = [
  { name: '闪光灯', p: 2 },
  { name: '脉冲星', p: 3 },
  { name: '十五面体', p: 15 },
];

// ── 1) 静物：先亮明主题，再逐个摆出来 ─────────────────────────────────────
const STILLS = [
  { rows: ['OO', 'OO'], name: '方块', note: '四格，最简的静止' },
  { rows: ['.OO.', 'O..O', '.OO.'], name: '蜂巢', note: '六格，边缘互相撑住' },
  { rows: ['OO.', 'O.O', '.O.'], name: '小船', note: '五格，斜着也稳' },
  { rows: ['.O.', 'O.O', '.O.'], name: '浴缸', note: '中间永远空着' },
];

export const StillsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = interpolate(frame, [0, 10, 46, 56], [1, 1, 1, 0.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cardsIn = interpolate(frame, [44, 58], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const gen = 120 + Math.max(0, frame - 8) * 64;

  return (
    <Backdrop>
      {/* 开场先只给标题，让观众知道这一段要讲什么 */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: intro,
          transform: `scale(${1 + (1 - intro) * 0.04})`,
        }}
      >
        <Eyebrow>组件 · 其一</Eyebrow>
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: 4 }}>固定组件</div>
        <div style={{ marginTop: 26, fontSize: 34, color: C.text, letterSpacing: 3, opacity: 0.9 }}>
          有些形状，一万代也不动一下
        </div>
      </AbsoluteFill>

      {/* 标题退场后进入展示 */}
      {cardsIn > 0 && (
        <AbsoluteFill style={{ padding: '86px 104px', opacity: cardsIn }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <Eyebrow>固定组件 · 静物</Eyebrow>
              <Heading size={54}>每一代都被重新判定，结果永远是自己</Heading>
              <div style={{ marginTop: 16, fontSize: 23, color: C.dim, maxWidth: 820, lineHeight: 1.6 }}>
                它们叫静物。平衡得很精确 —— 少一格会塌，多一格会炸。
              </div>
            </div>
            <BigCounter gen={gen} label="已经算过的代数" size={72} />
          </div>

          <div style={{ display: 'flex', gap: 26, marginTop: 54 }}>
            {STILLS.map((s, i) => {
              const frames = framesOf(`still-${s.name}`, toBitmap(s.rows), 1);
              const a = spring({ frame: frame - 58 - i * 7, fps, config: { damping: 200, mass: 0.7 } });
              return (
                <div
                  key={s.name}
                  style={{
                    flex: 1,
                    opacity: a,
                    transform: `translateY(${(1 - a) * 26}px)`,
                    padding: '24px 22px 20px',
                    borderRadius: 18,
                    border: `1px solid ${C.line}`,
                    background: 'rgba(10,16,23,0.75)',
                  }}
                >
                  <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LifeGrid frames={frames} gi={0} px={32} gap={6} radius={5} />
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{s.name}</div>
                    <div
                      style={{
                        fontSize: 16,
                        color: C.accent,
                        border: `1px solid ${C.accentSoft}`,
                        borderRadius: 999,
                        padding: '2px 10px',
                      }}
                    >
                      静止
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 17, color: C.dim }}>{s.note}</div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      )}
    </Backdrop>
  );
};

// ── 2) 振荡子：会动，但不走 ────────────────────────────────────────────────
type Osc = { name: string; period: number; px: number; note: string; rows?: string[]; id?: string };

const OSCILLATORS: Osc[] = [
  { name: '闪光灯', period: 2, px: 46, note: '三格横竖翻面，最朴素的节拍', rows: ['OOO'] },
  { name: '脉冲星', period: 3, px: 20, note: '13×13 的节拍器，三步一轮', id: 'pulsar' },
  { name: '十五面体', period: 15, px: 22, note: '拉长又弹回，十五代一个呼吸', id: 'pentadecathlon' },
];

export const OscillatorsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '86px 104px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Rise delay={0}>
            <Eyebrow>组件 · 其二</Eyebrow>
            <Heading size={54}>有些形状在原地打转</Heading>
            <div style={{ marginTop: 14, fontSize: 23, color: C.dim }}>
              它们叫振荡子：位置不动，但每一代都在变。
            </div>
          </Rise>
        </div>

        <div style={{ display: 'flex', gap: 28, marginTop: 52, alignItems: 'stretch' }}>
          {OSCILLATORS.map((o, i) => {
            const raw = o.rows ? toBitmap(o.rows) : getPattern(o.id ?? 'pulsar');
            // 加空边：否则小棋盘上图案会绕回自身，行为就变了
            const bm = padBitmap(raw, 4);
            const frames = framesOf(`osc-${o.name}`, bm, Math.max(o.period * 2, 8));
            const gi = Math.floor(frame * (0.22 + i * 0.03)) % frames.length;
            const a = spring({ frame: frame - 10 - i * 10, fps, config: { damping: 200, mass: 0.7 } });
            return (
              <div
                key={o.name}
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  opacity: a,
                  transform: `translateY(${(1 - a) * 28}px)`,
                  padding: '24px 22px',
                  borderRadius: 18,
                  border: `1px solid ${C.line}`,
                  background: 'rgba(10,16,23,0.75)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ fontSize: 30, fontWeight: 700 }}>{o.name}</div>
                  <div style={{ fontSize: 17, color: C.accent }}>周期 {o.period}</div>
                </div>
                <div
                  style={{
                    height: 300,
                    marginTop: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    background: 'rgba(5,10,14,0.7)',
                    overflow: 'hidden',
                  }}
                >
                  <LifeGrid frames={frames} gi={gi} px={o.px} gap={Math.max(2, o.px * 0.12)} radius={3} />
                </div>
                <div style={{ marginTop: 14, fontSize: 17, color: C.dim, lineHeight: 1.5 }}>{o.note}</div>
              </div>
            );
          })}
        </div>

        {/* 它通向什么：周期 → 节拍 → 时钟 */}
        <Rise delay={50} style={{ marginTop: 28 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 30,
              padding: '20px 28px',
              borderRadius: 18,
              border: `1px solid ${C.line}`,
              background: 'rgba(10,16,23,0.72)',
            }}
          >
            <div style={{ width: 600 }}>
              <div style={{ fontSize: 16, letterSpacing: 6, color: C.accent }}>它通向什么</div>
              <div style={{ marginTop: 8, fontSize: 27, fontWeight: 700, lineHeight: 1.45 }}>
                位置不动，节拍不停
              </div>
              <div style={{ marginTop: 4, fontSize: 19, color: C.dim, lineHeight: 1.55 }}>
                后来搭出的生命游戏电路，把它们当时钟用：给整台机器打拍子。
              </div>
            </div>

            <div style={{ width: 1, alignSelf: 'stretch', background: C.line }} />

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {PULSE_ROWS.map((r) => (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <div style={{ width: 72, fontSize: 15, color: C.dim }}>{r.name}</div>
                  <div style={{ flex: 1 }}>
                    <PulseTrack p={r.p} cells={26} />
                  </div>
                  <div style={{ width: 34, textAlign: 'right', fontSize: 15, color: C.accent }}>
                    p{r.p}
                  </div>
                </div>
              ))}
              <div style={{ textAlign: 'right', fontSize: 13, color: C.dim, letterSpacing: 2 }}>
                一格 = 一代
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 28, color: C.dim }}>→</div>
              <div
                style={{
                  padding: '12px 20px',
                  borderRadius: 14,
                  border: `1px solid ${C.accentSoft}`,
                  background: 'rgba(108,245,210,0.08)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700, color: C.accent }}>时钟</div>
                <div style={{ fontSize: 13, color: C.dim, letterSpacing: 2 }}>clock</div>
              </div>
            </div>
          </div>
        </Rise>

        <Rise delay={104} style={{ marginTop: 20 }}>
          <div style={{ fontSize: 21, color: C.dim }}>
            静物不变，振荡子来回变 —— 但都留在原地。真正会走的，还在后面。
          </div>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 3) 滑翔机（静态）：先把这五格看清楚 ────────────────────────────────────
const GLIDER_ROWS = ['.O.', '..O', 'OOO'];

export const GliderStaticScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frames = framesOf('glider-static', toBitmap(GLIDER_ROWS), 0);
  const s = spring({ frame: frame - 6, fps, config: { damping: 200, mass: 0.8 } });
  const glow = 0.55 + 0.25 * Math.sin(frame / 9);

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '0 110px', flexDirection: 'row', alignItems: 'center', gap: 80 }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              padding: 34,
              borderRadius: 24,
              border: `1px solid ${C.line}`,
              background: 'rgba(8,13,19,0.85)',
              boxShadow: `0 0 ${60 * glow}px rgba(108,245,210,0.18)`,
              transform: `scale(${0.94 + 0.06 * s})`,
            }}
          >
            <LifeGrid frames={frames} gi={0} px={74} gap={8} radius={8} glow={glow} />
          </div>
        </div>

        <div style={{ width: 720 }}>
          <Rise delay={0}>
            <Eyebrow>组件 · 其三</Eyebrow>
            <Heading size={62}>滑翔机</Heading>
            <div style={{ marginTop: 24, fontSize: 26, color: C.text, lineHeight: 1.7, opacity: 0.9 }}>
              五格而已。放在那儿不动的时候，它看起来一点也不特别。
            </div>
            <div style={{ marginTop: 18, fontSize: 24, color: C.dim, lineHeight: 1.7 }}>
              可一旦把它丢进画布、让它跑起来 —— 它会自己朝一个方向，一直走下去。
            </div>
          </Rise>
          <Rise delay={26} style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 20, color: C.accent }}>
              <div style={{ width: 30, height: 2, background: C.accent, opacity: 0.6 }} />
              下一步：把它放进画布
            </div>
          </Rise>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 4) 滑翔枪 ─────────────────────────────────────────────────────────────
const GUN_BOARD = placeBitmap(getPattern('gosperglidergun'), 74, 32, 4, 11);
const GUN_FRAMES = framesOf('gun-fire', GUN_BOARD, 220);

export const GunScene: React.FC = () => {
  const frame = useCurrentFrame();
  const gi = Math.min(GUN_FRAMES.length - 1, Math.floor(frame * 0.95));
  const made = Math.floor(gi / 30);

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '0 96px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 46, alignItems: 'center' }}>
          <div style={{ width: 620 }}>
            <Rise delay={0}>
              <Eyebrow>组件 · 其四</Eyebrow>
              <Heading size={50}>滑翔枪</Heading>
            </Rise>
            <div style={{ marginTop: 26 }}>
              <Lines
                width={590}
                lines={[
                  { at: 8, text: '1970 年，康威悬赏 50 美元：谁能让这些格子无限长下去？' },
                  { at: 82, text: '同年，Bill Gosper 交出了这把枪。', big: true },
                  { at: 150, text: '每 30 代吐出一艘滑翔机，永远不停 —— 第一个被证明会无限增长的图案。' },
                ]}
              />
            </div>

            {/* 左下补三张参数卡：周期 30、枪体 36×9、产出无限 */}
            <Rise delay={96} style={{ marginTop: 34 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <StatTile k="周期" v="30" u="代" />
                <StatTile k="枪体" v="36 × 9" u="格" />
                <StatTile k="产出" v="∞" u="不停止" />
              </div>
            </Rise>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <div
              style={{
                padding: 20,
                borderRadius: 18,
                border: `1px solid ${C.line}`,
                background: 'rgba(8,13,19,0.8)',
              }}
            >
              <LifeGrid frames={GUN_FRAMES} gi={gi} px={11} gap={2} radius={2} showGrid />
            </div>
          </div>
        </div>

        <div style={{ position: 'absolute', top: 54, right: 96 }}>
          <BigCounter gen={made} label="已产出的滑翔机" size={56} />
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 5) 逻辑电路：两条信号相撞抵消 ───────────────────────────────────────────
const COLLIDE_BOARD = (() => {
  const base = placeBitmap(getPattern('glider'), 46, 28, 4, 8);
  const other = getPattern('glider');
  const flipped: Bitmap = { w: other.w, h: other.h, cells: other.cells.slice() };
  for (let y = 0; y < other.h; y++) {
    for (let x = 0; x < other.w; x++) {
      flipped.cells[y * other.w + x] = other.cells[y * other.w + (other.w - 1 - x)];
    }
  }
  return mergeInto(base, flipped, 34, 10);
})();

const COLLIDE_FRAMES = framesOf('glider-collide', COLLIDE_BOARD, 90);

export const CircuitsScene: React.FC = () => {
  const frame = useCurrentFrame();
  // 放慢到第 ~72 帧才撞上，别一进场就撞完留 8 秒空画布
  const gi = Math.min(COLLIDE_FRAMES.length - 1, 8 + Math.floor(frame * 0.72));
  const hitAt = 60;
  const ring = interpolate(gi, [hitAt, hitAt + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const after = gi > hitAt;
  const boardDim = interpolate(frame, [64, 96], [1, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // 先让空画布退干净，再让图案进来：两段不重叠，避免字幕叠在图案上
  const boardOut = interpolate(frame, [100, 114], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const arrayIn = interpolate(frame, [116, 134], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const arrayZoom = interpolate(frame, [134, 300], [0, 0.06], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '76px 100px' }}>
        <Rise delay={0}>
          <Eyebrow>组件 · 其五</Eyebrow>
          {/* 标题跟着画面一起换：讲对撞时讲对撞，讲图灵机时讲门 */}
          <div style={{ position: 'relative', height: 60 }}>
            <Heading
              size={48}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 1 - interpolate(frame, [100, 112], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              }}
            >
              两颗滑翔机撞上，会一起消失
            </Heading>
            <Heading
              size={48}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: interpolate(frame, [112, 126], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              }}
            >
              把门接起来，就能算
            </Heading>
          </div>
        </Rise>

        <div style={{ display: 'flex', gap: 52, marginTop: 28, alignItems: 'center' }}>
          {/* 左：先演示对撞，再换成真实的图灵机图案；两块位置固定，不跳版 */}
          <div style={{ position: 'relative', width: 700, height: 680, flexShrink: 0 }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 14,
                opacity: boardOut,
              }}
            >
          <div
            style={{
              position: 'relative',
              width: 'fit-content',
              margin: '0 auto',
              padding: 16,
              borderRadius: 20,
              border: `1px solid ${C.line}`,
              background: 'rgba(8,13,19,0.82)',
              opacity: boardDim,
            }}
          >
            <LifeGrid frames={COLLIDE_FRAMES} gi={gi} px={12} gap={2} radius={2} showGrid />
            {ring > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: 60 + 200 * ring,
                  height: 60 + 200 * ring,
                  marginLeft: -(30 + 100 * ring),
                  marginTop: -(30 + 100 * ring),
                  borderRadius: '50%',
                  border: `2px solid rgba(108,245,210,${0.7 * (1 - ring)})`,
                  opacity: 1 - ring,
                }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '42%',
                textAlign: 'center',
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: 10,
                color: C.accent,
                opacity: after
                  ? interpolate(gi, [hitAt + 4, hitAt + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
                  : 0,
                textShadow: '0 0 26px rgba(5,8,12,0.95)',
              }}
            >
              湮灭
            </div>
          </div>
            <div
              style={{
                fontSize: 18,
                color: C.dim,
                textAlign: 'center',
                opacity: interpolate(frame, [70, 88], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              }}
            >
              画布回到空无一物 —— 这就是「抵消」
            </div>
            </div>

            {/* 真实的图灵机图案：1714×1647 格，Paul Rendell 2000 年建成，来自 LifeWiki */}
            <div style={{ position: 'absolute', inset: 0, opacity: arrayIn }}>
              <div
                style={{
                  position: 'relative',
                  width: 700,
                  height: 636,
                  borderRadius: 18,
                  border: `1px solid ${C.line}`,
                  background: '#05090e',
                  overflow: 'hidden',
                  boxShadow: '0 0 80px rgba(108,245,210,0.08)',
                }}
              >
                <Img
                  src={staticFile('pattern-turing.png')}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: `scale(${1 + arrayZoom})`,
                    filter: 'saturate(1.2) brightness(1.1)',
                  }}
                />
                <AbsoluteFill
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(5,8,12,0.72) 0%, rgba(5,8,12,0.18) 14%, rgba(5,8,12,0) 26%, rgba(5,8,12,0) 66%, rgba(5,8,12,0.9) 100%)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 16,
                    left: 18,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '5px 13px 5px 6px',
                    borderRadius: 999,
                    background: 'rgba(5,8,12,0.66)',
                    border: `1px solid ${C.line}`,
                  }}
                >
                  <div
                    style={{
                      padding: '3px 10px',
                      borderRadius: 999,
                      border: `1px solid ${C.accentSoft}`,
                      background: 'rgba(108,245,210,0.1)',
                      fontSize: 14,
                      letterSpacing: 2,
                      color: C.accent,
                    }}
                  >
                    真实图案
                  </div>
                  <div style={{ fontSize: 15, color: C.text, opacity: 0.82 }}>1714 × 1647 格</div>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: 18,
                    right: 18,
                    bottom: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 15,
                    color: C.text,
                    opacity: 0.7,
                    textShadow: '0 1px 8px rgba(5,8,12,0.95)',
                  }}
                >
                  <span>Paul Rendell · 2000</span>
                  <span>36,549 个活细胞</span>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 17, color: C.dim, textAlign: 'center' }}>
                LifeWiki 收录的完整图案
              </div>
            </div>
          </div>

          <div style={{ width: 860 }}>
            <Lines
              width={840}
              lines={[
                { at: 4, text: '两颗滑翔机正面相撞，会精确抵消。', big: true },
                { at: 84, text: '抵消，就是「关」；不抵消，就是「开」。一个开关有了。' },
                { at: 140, text: '把开关接起来：与门、或非门、触发器、加法器……' },
                { at: 196, text: '2000 年，Paul Rendell 在里面搭出了一台图灵机。', big: true },
              ]}
            />
          </div>
        </div>

        {/* 递进：从一颗滑翔机，到能算数的机器 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 34, paddingLeft: 4 }}>
          {[
            { t: '滑翔机', n: '1 个比特' },
            { t: '滑翔机流', n: '1 条信号线' },
            { t: '湮灭', n: '逻辑门' },
            { t: '门阵列', n: '图灵机' },
          ].map((s, i) => {
            const a = interpolate(frame, [112 + i * 26, 126 + i * 26], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div key={s.t} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: a }}>
                <div
                  style={{
                    padding: '12px 20px',
                    borderRadius: 12,
                    border: `1px solid ${i === 3 ? C.accent : C.line}`,
                    background: i === 3 ? 'rgba(108,245,210,0.1)' : 'rgba(10,16,23,0.7)',
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: i === 3 ? C.accent : C.text }}>{s.t}</div>
                  <div style={{ fontSize: 16, color: C.dim, marginTop: 3 }}>{s.n}</div>
                </div>
                {i < 3 && (
                  <div style={{ fontSize: 22, color: C.dim, opacity: a, transform: `translateX(${(1 - a) * -8}px)` }}>
                    →
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 穿插：真实界面操作 ─────────────────────────────────────────────────────
export const InsertScene: React.FC<{
  file: string;
  step?: string;
  caption: string;
  rate?: number;
  startFrom?: number;
}> = ({ file, step, caption, rate = 1, startFrom = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 3, fps, config: { damping: 200, mass: 0.8 } });
  const out = interpolate(frame, [196, 208], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, fontFamily: FONT, opacity: out }}>
      <OffthreadVideo
        src={staticFile(file)}
        muted
        startFrom={startFrom}
        playbackRate={rate}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(1.16) contrast(1.04)' }}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(5,8,12,0.9) 0%, rgba(5,8,12,0) 26%)' }} />
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, rgba(5,8,12,0.92) 0%, rgba(5,8,12,0.55) 18%, rgba(5,8,12,0) 34%)',
        }}
      />
      <AbsoluteFill style={{ padding: '64px 96px' }}>
        <div style={{ opacity: s, transform: `translateY(${(1 - s) * 16}px)` }}>
          <div style={{ fontSize: 18, letterSpacing: 6, color: C.accent }}>{step ?? '实机演示'}</div>
          <div style={{ marginTop: 12, fontSize: 38, fontWeight: 700 }}>{caption}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
