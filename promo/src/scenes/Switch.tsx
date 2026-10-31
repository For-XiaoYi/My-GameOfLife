import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { LifeGrid } from '../components/LifeGrid';
import { Backdrop, Eyebrow, Heading, Rise } from '../components/ui';
import { C } from '../theme';
import { framesOf, getPattern, placeBitmap, type Bitmap } from '../lib/life';

/** 左右镜像一个图案（滑翔机对撞用） */
const flipX = (bm: Bitmap): Bitmap => {
  const out: Bitmap = { w: bm.w, h: bm.h, cells: bm.cells.slice() };
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) out.cells[y * bm.w + x] = bm.cells[y * bm.w + (bm.w - 1 - x)];
  }
  return out;
};

/** 把图案叠到已有画布（placeBitmap 会新建空画布） */
const mergeInto = (base: Bitmap, bm: Bitmap, ox: number, oy: number): Bitmap => {
  const out: Bitmap = { w: base.w, h: base.h, cells: base.cells.slice() };
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) {
      if (bm.cells[y * bm.w + x]) out.cells[(oy + y) * out.w + (ox + x)] = 1;
    }
  }
  return out;
};

// 56×40 有界棋盘；两颗镜像滑翔机差 1 行，正好在 (28,20) —— 棋盘正中心 —— 第 54 代湮灭
const BOARD_W = 56;
const BOARD_H = 40;
const PX = 10;
const GAP = 2;
const STEP = PX + GAP;
const LEFT = { x: 13, y: 6 };
const RIGHT = { x: 43, y: 7 };
const HIT_GEN = 54;
const START_FRAME = 34;
const GEN_PER_FRAME = 0.8;
const HIT_FRAME = Math.round(START_FRAME + HIT_GEN / GEN_PER_FRAME); // ≈ 102

const BOARD = mergeInto(
  placeBitmap(getPattern('glider'), BOARD_W, BOARD_H, LEFT.x, LEFT.y),
  flipX(getPattern('glider')),
  RIGHT.x,
  RIGHT.y,
);
const FRAMES = framesOf('switch-v7', BOARD, 90, { wrapX: false, wrapY: false });

// 碰撞格（28,20）在棋盘与面板里的坐标
const CELL_X = 28 * STEP + PX / 2; // 341
const CELL_Y = 20 * STEP + PX / 2; // 245
const PAD = 14;

const Lines: React.FC<{ lines: { at: number; text: string; big?: boolean }[] }> = ({ lines }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: 840 }}>
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
            }}
          >
            {l.text}
          </div>
        );
      })}
    </div>
  );
};

const PARTICLE_ANGLES = Array.from({ length: 14 }, (_, i) => (i / 14) * Math.PI * 2 + 0.35);

export const SwitchScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const gi = Math.min(
    FRAMES.length - 1,
    Math.max(0, Math.floor((frame - START_FRAME) * GEN_PER_FRAME)),
  );
  const glidersIn = interpolate(frame, [18, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const after = frame >= HIT_FRAME;
  const post = interpolate(frame, [HIT_FRAME, HIT_FRAME + 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shake = interpolate(frame, [HIT_FRAME, HIT_FRAME + 6], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const tx = Math.sin(frame * 13) * 2.6 * shake;
  const ty = Math.cos(frame * 17) * 1.7 * shake;
  const flash = interpolate(frame, [HIT_FRAME, HIT_FRAME + 2, HIT_FRAME + 7], [0, 0.18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const answerIn = spring({
    frame: frame - HIT_FRAME - 3,
    fps,
    config: { damping: 14, mass: 0.5, stiffness: 180 },
  });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '76px 100px' }}>
        <Rise delay={0}>
          <Eyebrow>组件 · 其五</Eyebrow>
          <Heading size={44}>两个滑翔机撞在一起，会发生什么？</Heading>
        </Rise>

        <div style={{ display: 'flex', gap: 48, marginTop: 24, alignItems: 'center' }}>
          <div
            style={{
              position: 'relative',
              width: 700,
              height: 620,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                position: 'relative',
                padding: PAD,
                borderRadius: 20,
                border: `1px solid ${C.line}`,
                background: 'rgba(8,13,19,0.86)',
                transform: `translate(${tx}px, ${ty}px)`,
                boxShadow: after ? '0 0 80px rgba(108,245,210,0.10)' : 'none',
              }}
            >
              <div style={{ position: 'relative', width: BOARD_W * STEP - GAP, height: BOARD_H * STEP - GAP }}>
                {/* 空网格单独一层：滑翔机淡入时网格不动 */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage:
                      'linear-gradient(to right, rgba(120,200,220,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,200,220,0.07) 1px, transparent 1px)',
                    backgroundSize: `${STEP}px ${STEP}px`,
                    opacity: 0.8,
                  }}
                />
                <div style={{ position: 'absolute', inset: 0, opacity: glidersIn * (1 - 0.35 * post) }}>
                  <LifeGrid frames={FRAMES} gi={gi} px={PX} gap={GAP} radius={2} showGrid={false} />
                </div>

                {/* A / B 标签，跟着滑翔机一起淡入 */}
                {[
                  { t: 'A', x: LEFT.x * STEP + PX / 2, y: LEFT.y * STEP + PX / 2 },
                  { t: 'B', x: RIGHT.x * STEP + PX / 2, y: RIGHT.y * STEP + PX / 2 },
                ].map((l) => (
                  <div
                    key={l.t}
                    style={{
                      position: 'absolute',
                      left: l.x,
                      top: l.y - 42,
                      transform: 'translateX(-50%)',
                      padding: '3px 10px',
                      borderRadius: 999,
                      border: `1px solid ${C.accentSoft}`,
                      background: 'rgba(5,8,12,0.78)',
                      fontSize: 15,
                      color: C.accent,
                      letterSpacing: 2,
                      opacity: glidersIn * (after ? 0 : 1),
                    }}
                  >
                    {l.t}
                  </div>
                ))}

                {/* 冲击波 */}
                {[0, 1, 2].map((i) => {
                  const from = HIT_FRAME + i * 4;
                  const t = interpolate(frame, [from, from + 24], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  });
                  const size = 36 + 300 * t;
                  if (t <= 0 || t >= 1) return null;
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: CELL_X - size / 2,
                        top: CELL_Y - size / 2,
                        width: size,
                        height: size,
                        borderRadius: '50%',
                        border: `2px solid rgba(108,245,210,${0.55 * (1 - t)})`,
                        boxShadow: `0 0 24px rgba(108,245,210,${0.18 * (1 - t)})`,
                        pointerEvents: 'none',
                      }}
                    />
                  );
                })}

                {/* 细胞碎片 */}
                {after &&
                  PARTICLE_ANGLES.map((a, i) => {
                    const p = interpolate(frame, [HIT_FRAME + 2, HIT_FRAME + 30], [0, 1], {
                      extrapolateLeft: 'clamp',
                      extrapolateRight: 'clamp',
                    });
                    const dist = 18 + (50 + (i % 5) * 14) * p;
                    const size = Math.max(1, 6 * (1 - p));
                    return (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          left: CELL_X + Math.cos(a) * dist - size / 2,
                          top: CELL_Y + Math.sin(a) * dist - size / 2,
                          width: size,
                          height: size,
                          borderRadius: 2,
                          background: C.accent,
                          opacity: 1 - p,
                          boxShadow: `0 0 10px ${C.accentSoft}`,
                          pointerEvents: 'none',
                        }}
                      />
                    );
                  })}

                {/* 答案：完全消失（压在碰撞点上方一点） */}
                <div
                  style={{
                    position: 'absolute',
                    left: CELL_X,
                    top: CELL_Y - 30,
                    transform: `translate(-50%, -50%) scale(${0.7 + 0.3 * answerIn})`,
                    opacity: answerIn,
                    fontSize: 58,
                    fontWeight: 800,
                    letterSpacing: 4,
                    color: '#eafff8',
                    textShadow: `0 0 36px rgba(108,245,210,0.55), 0 2px 18px rgba(5,8,12,0.9)`,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  完全消失
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: CELL_X,
                    top: CELL_Y + 32,
                    transform: 'translate(-50%, -50%)',
                    opacity: after ? 0.75 : 0,
                    fontSize: 17,
                    letterSpacing: 10,
                    color: C.accent,
                    textShadow: '0 0 20px rgba(5,8,12,0.9)',
                    pointerEvents: 'none',
                  }}
                >
                  湮灭
                </div>

                {/* 闪光 */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: `rgba(108,245,210,${flash})`,
                    pointerEvents: 'none',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                fontSize: 17,
                color: C.dim,
                textAlign: 'center',
                opacity: after ? 1 : 0.45,
              }}
            >
              {after ? 'A + B → 0 · 画布空了，但「关」被记住了' : 'A、B 两路信号，正在靠近'}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <Lines
              lines={[
                { at: 118, text: '它们会精确抵消 —— 像什么都没发生过。' },
                { at: 172, text: '抵消 = 「关」；不抵消 = 「开」。一个开关，有了。', big: true },
                { at: 228, text: '把开关接起来，就是逻辑门。' },
              ]}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 26 }}>
          {[
            { t: 'A', n: '输入 1' },
            { t: 'B', n: '输入 1' },
            { t: 'Q', n: '输出 0' },
          ].map((c, i) => (
            <div key={c.t} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  padding: '9px 16px',
                  borderRadius: 12,
                  border: `1px solid ${i === 2 ? C.accent : C.line}`,
                  background: i === 2 ? 'rgba(108,245,210,0.08)' : 'rgba(10,16,23,0.7)',
                  opacity: after || i < 2 ? 1 : 0.3,
                }}
              >
                <div style={{ fontSize: 19, fontWeight: 700, color: i === 2 ? C.accent : C.text }}>
                  {c.t}
                  <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 400, color: C.dim }}>{c.n}</span>
                </div>
              </div>
              {i < 2 && <div style={{ fontSize: 20, color: C.dim }}>+</div>}
              {i === 1 && <div style={{ fontSize: 20, color: C.dim, marginLeft: 4 }}>=</div>}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
