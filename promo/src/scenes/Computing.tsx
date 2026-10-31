import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { LifeGrid } from '../components/LifeGrid';
import { Backdrop, Eyebrow, Heading, Rise } from '../components/ui';
import { C } from '../theme';
import { GATE_DEMOS, type GateDemo } from '../lib/gates';
import { CIRCUITS, type CircuitDef } from '../lib/circuits';
import { framesOf, type Bitmap, type Frame } from '../lib/life';

// ── 黑屏字幕：电路段结束后，把问题抛给下一章 ───────────────────────────────
export const BlackCaptionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - 6, fps, config: { damping: 200, mass: 0.8 } });
  const line = interpolate(frame, [20, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ opacity: a, transform: `translateY(${(1 - a) * 18}px)`, textAlign: 'center' }}>
        <div style={{ fontSize: 18, letterSpacing: 10, color: C.accent, marginBottom: 26 }}>问下去</div>
        <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: 2, lineHeight: 1.55 }}>
          那有了判断，
          <br />
          我们可以拿它来做什么呢？
        </div>
        <div
          style={{
            width: 140 * line,
            height: 2,
            margin: '38px auto 0',
            background: C.accent,
            opacity: 0.6,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ── 逻辑门的一张小卡：小画布 + 真值表 + 当前 A/B/Q ─────────────────────────
const CASE_LEN = 28;
// 6 代/帧，一个 case 28 帧 → 最多 168 代；OR 的反射在 120 代左右出现，能留出 8 帧看输出
const GATE_GENS_PER_FRAME = 6;

const TruthTable: React.FC<{ demo: GateDemo; active: number }> = ({ demo, active }) => {
  const not = demo.kind === 'NOT';
  const head = not ? ['A', 'Q'] : ['A', 'B', 'Q'];
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: not ? '1fr 1fr' : '1fr 1fr 1fr',
          gap: 3,
          fontSize: 12,
          color: C.dim,
          letterSpacing: 2,
          marginBottom: 4,
        }}
      >
        {head.map((h) => (
          <div key={h} style={{ textAlign: 'center' }}>{h}</div>
        ))}
      </div>
      {demo.cases.map((c, i) => {
        const on = i === active;
        return (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: not ? '1fr 1fr' : '1fr 1fr 1fr',
              gap: 3,
              fontSize: 15,
              lineHeight: '20px',
              borderRadius: 5,
              background: on ? `${demo.color}18` : 'transparent',
              border: `1px solid ${on ? `${demo.color}55` : 'transparent'}`,
              color: on ? C.text : C.dim,
            }}
          >
            <div style={{ textAlign: 'center' }}>{c.a ? '1' : '0'}</div>
            {!not && <div style={{ textAlign: 'center' }}>{c.b ? '1' : '0'}</div>}
            <div style={{ textAlign: 'center', color: c.q ? demo.color : C.dim, fontWeight: 700 }}>
              {c.q ? '1' : '0'}
            </div>
          </div>
        );
      })}
      {not && <div style={{ marginTop: 5, fontSize: 11, color: C.dim }}>{demo.note}</div>}
    </div>
  );
};

const GateCard: React.FC<{ demo: GateDemo; entry: number; index: number }> = ({ demo, entry, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - entry;
  const appear = spring({ frame: local - 4, fps, config: { damping: 200, mass: 0.65 } });
  if (local < 0) return null;

  const cases = demo.cases.length;
  const caseIdx = Math.floor(local / CASE_LEN) % cases;
  const caseLocal = local % CASE_LEN;
  const caseDef = demo.cases[caseIdx];
  const gi = Math.min(
    demo.frames[caseIdx].length - 1,
    Math.max(0, Math.floor(caseLocal * GATE_GENS_PER_FRAME)),
  );
  const pulse = 0.6 + 0.4 * Math.sin(frame / 8 - index);
  const step = demo.px + demo.gap;
  const cropW = demo.crop.w * step - demo.gap;
  const cropH = demo.crop.h * step - demo.gap;

  return (
    <div
      style={{
        width: 400,
        height: 560,
        padding: '18px 18px 16px',
        borderRadius: 18,
        border: `1px solid ${demo.color}44`,
        background: 'linear-gradient(180deg, rgba(11,18,26,0.96), rgba(7,11,17,0.92))',
        boxShadow: `0 0 ${50 * pulse}px ${demo.color}12`,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 46}px) scale(${0.96 + 0.04 * appear})`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: demo.color }}>{demo.name}</div>
        <div style={{ fontSize: 16, letterSpacing: 3, color: C.dim }}>{demo.en}</div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            letterSpacing: 1,
            color: C.dim,
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          真实反应
        </div>
      </div>
      <div style={{ marginTop: 5, fontSize: 14, color: C.dim, height: 20 }}>{demo.desc}</div>

      <div
        style={{
          height: 300,
          marginTop: 8,
          borderRadius: 12,
          background: 'rgba(5,9,14,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', width: cropW, height: cropH, overflow: 'hidden', borderRadius: 8 }}>
          <div style={{ position: 'absolute', left: -demo.crop.x * step, top: -demo.crop.y * step }}>
            <LifeGrid frames={demo.frames[caseIdx]} gi={gi} px={demo.px} gap={demo.gap} radius={1} showGrid />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {[
          { k: 'A', v: caseDef.a },
          { k: demo.kind === 'NOT' ? 'CLK' : 'B', v: caseDef.b },
          { k: 'Q', v: caseDef.q },
        ].map((x) => (
          <div
            key={x.k}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: 7,
              background: x.k === 'Q' ? `${demo.color}14` : 'rgba(255,255,255,0.035)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 14,
            }}
          >
            <span style={{ color: C.dim }}>{x.k}</span>
            <span style={{ color: x.v ? demo.color : C.dim, fontWeight: 700 }}>{x.v}</span>
          </div>
        ))}
      </div>

      <TruthTable demo={demo} active={caseIdx} />
    </div>
  );
};

export const GatesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [282, 300], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const entries = [0, 45, 90, 135];

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '76px 120px', opacity: out }}>
        <Rise delay={0}>
          <Eyebrow>逻辑 · 其六</Eyebrow>
          <Heading size={46}>四种门，四种反应</Heading>
          <div style={{ marginTop: 10, fontSize: 20, color: C.dim }}>
            都是细胞真的在跑 —— 为了让眼睛看清，每张卡循环同一组输入。
          </div>
        </Rise>

        <div style={{ display: 'flex', gap: 20, marginTop: 30 }}>
          {GATE_DEMOS.map((d, i) => (
            <GateCard key={d.kind} demo={d} entry={entries[i]} index={i} />
          ))}
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 14, fontSize: 16, color: C.dim }}>
          <div style={{ width: 22, height: 1, background: C.accent, opacity: 0.6 }} />
          与：两路都到才有输出 · 或：任一路到就有 · 非：输入抹掉一拍 · 异或：同到才抵消
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 门阵列：不用符号，换成四台真实搭建、真的在跑的小电路 ──────────────────
const ARRAY_STYLE: Record<string, { pad: number; px: number }> = {
  demux: { pad: 4, px: 4 },
  toggle: { pad: 1, px: 3 },
  memory: { pad: 4, px: 4 },
  loaf: { pad: 4, px: 5 },
};

type ArrayItem = CircuitDef & {
  board: Bitmap;
  px: number;
  gap: number;
  frames: Frame[];
};

const ARRAY_ITEMS: ArrayItem[] = CIRCUITS.map((c) => {
  const { pad, px } = ARRAY_STYLE[c.id] ?? { pad: 4, px: 4 };
  const gap = 1;
  const w = c.w + pad * 2;
  const h = c.h + pad * 2;
  const cells = new Array<number>(w * h).fill(0);
  for (const idx of c.cells) {
    const x = idx % c.w;
    const y = Math.floor(idx / c.w);
    cells[(y + pad) * w + (x + pad)] = 1;
  }
  const board: Bitmap = { w, h, cells };
  const frames = framesOf(`circuit-${c.id}`, board, 90, { wrapX: false, wrapY: false });
  return { ...c, board, px, gap, frames };
});

const CircuitCard: React.FC<{ item: ArrayItem; index: number; entry: number }> = ({ item, index, entry }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - entry;
  const appear = spring({ frame: local, fps, config: { damping: 200, mass: 0.7 } });
  if (local < 0) return null;
  const gi = Math.floor(local * 0.6 + index * 9) % item.frames.length;

  return (
    <div
      style={{
        width: 380,
        height: 380,
        padding: '14px 16px 12px',
        borderRadius: 16,
        border: `1px solid ${C.line}`,
        background: 'linear-gradient(180deg, rgba(11,18,26,0.94), rgba(7,11,17,0.9))',
        opacity: appear,
        transform: `translateY(${(1 - appear) * 24}px)`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{item.name}</div>
        <div style={{ fontSize: 11, letterSpacing: 2, color: C.dim }}>{item.en}</div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: C.accent,
            border: `1px solid ${C.accentSoft}`,
            borderRadius: 999,
            padding: '2px 7px',
            letterSpacing: 1,
          }}
        >
          真实电路
        </div>
      </div>

      <div
        style={{
          flex: 1,
          marginTop: 8,
          borderRadius: 10,
          background: 'rgba(5,9,14,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <LifeGrid frames={item.frames} gi={gi} px={item.px} gap={item.gap} radius={1} showGrid />
      </div>

      <div style={{ marginTop: 7, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.dim }}>
        <span>{item.w} × {item.h} 格</span>
        <span style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>第 {gi} 代</span>
      </div>
    </div>
  );
};

export const GateArrayScene: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [150, 180], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const closing = interpolate(frame, [128, 150], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dim = interpolate(frame, [128, 166], [1, 0.18], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '76px 110px', opacity: fadeOut }}>
        <div style={{ display: 'flex', gap: 44, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div style={{ width: 760 }}>
            <Rise delay={0}>
              <Eyebrow>从门到机器</Eyebrow>
              <Heading size={52}>把门排成阵列</Heading>
              <div style={{ marginTop: 20, fontSize: 24, color: C.text, lineHeight: 1.7, opacity: 0.9 }}>
                一颗滑翔机是一个比特，一排门是一条信号线。
              </div>
              <div style={{ marginTop: 10, fontSize: 21, color: C.dim, lineHeight: 1.7 }}>
                右边不是画出来的符号 —— 是四台真的在跑的小电路。
              </div>
            </Rise>

            <Rise delay={50} style={{ marginTop: 54 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {[
                  { t: '逻辑门', n: '4 种反应' },
                  { t: '门阵列', n: '真实电路', on: true },
                  { t: '图灵机', n: '一台机器' },
                ].map((s, i) => (
                  <div key={s.t} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div
                      style={{
                        padding: '12px 18px',
                        borderRadius: 12,
                        border: `1px solid ${s.on ? C.accent : C.line}`,
                        background: s.on ? 'rgba(108,245,210,0.10)' : 'rgba(10,16,23,0.7)',
                      }}
                    >
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.on ? C.accent : C.text }}>{s.t}</div>
                      <div style={{ fontSize: 14, color: C.dim, marginTop: 2 }}>{s.n}</div>
                    </div>
                    {i < 2 && <div style={{ fontSize: 20, color: C.dim }}>→</div>}
                  </div>
                ))}
              </div>
            </Rise>

            <Rise delay={90} style={{ marginTop: 28 }}>
              <div style={{ fontSize: 16, color: C.dim, lineHeight: 1.75 }}>
                解复用器 · 触发器 · 存储单元 · 面包触发器
                <br />
                都是 LifeWiki 上真实搭出来的图案，每一格都在按四条规则演化。
              </div>
            </Rise>
          </div>

          <div
            style={{
              position: 'relative',
              width: 778,
              height: 778,
              flexShrink: 0,
              opacity: dim,
              transform: `scale(${1 - 0.03 * closing})`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage:
                  'linear-gradient(to right, rgba(120,200,220,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,200,220,0.06) 1px, transparent 1px)',
                backgroundSize: '26px 26px',
                borderRadius: 18,
              }}
            />
            <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '380px 380px', gap: 18 }}>
              {ARRAY_ITEMS.map((item, i) => (
                <CircuitCard key={item.id} item={item} index={i} entry={i * 8} />
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>

      {/* 结尾把问题抛给下一段：四块电路接起来是什么？ */}
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', inset: 0, background: `rgba(5,8,12,${0.56 * closing})` }} />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '40%',
            textAlign: 'center',
            opacity: closing,
            fontSize: 42,
            fontWeight: 700,
            letterSpacing: 3,
            color: '#eafff8',
            textShadow: '0 2px 34px rgba(5,8,12,0.95), 0 0 24px rgba(108,245,210,0.15)',
          }}
        >
          四块电路，接起来会是什么？
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 图灵机：真实图案，缓慢推近 ─────────────────────────────────────────────
export const TuringMachineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const textIn = spring({ frame: frame - 30, fps, config: { damping: 200, mass: 0.8 } });
  // 镜头不要钉死：9 秒里缓慢推近 + 轻微平移
  const camScale = interpolate(frame, [0, 270], [1.0, 1.14], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const camX = interpolate(frame, [0, 270], [0, -24], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const camY = interpolate(frame, [0, 270], [0, 14], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '72px 96px', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 44 }}>
        <div style={{ width: 470, flexShrink: 0 }}>
          <Rise delay={0}>
            <div style={{ fontSize: 16, letterSpacing: 7, color: C.dim }}>四块电路接起来</div>
            <div style={{ marginTop: 6, fontSize: 34, fontWeight: 800, color: C.accent }}>是一台机器。</div>
            <div style={{ marginTop: 20 }}>
              <Eyebrow>2000 · Paul Rendell</Eyebrow>
              <Heading size={68}>图灵机</Heading>
            </div>
          </Rise>
          <div style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 16}px)` }}>
            <div style={{ marginTop: 26, fontSize: 25, color: C.text, lineHeight: 1.7, opacity: 0.9 }}>
              把门阵列接起来，就是一台图灵机。
            </div>
            <div style={{ marginTop: 16, fontSize: 22, color: C.dim, lineHeight: 1.65 }}>
              这四条规则，能算任何可计算的东西。
            </div>
            <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['1,714 × 1,647', '个格子'],
                ['36,549', '个活细胞'],
                ['LifeWiki', '收录的完整图案'],
              ].map(([v, k]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                  <div style={{ fontSize: 15, color: C.dim }}>{k}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              position: 'relative',
              width: 960,
              height: 720,
              borderRadius: 18,
              border: `1px solid ${C.line}`,
              background: '#05090e',
              overflow: 'hidden',
              boxShadow: '0 0 120px rgba(108,245,210,0.10)',
            }}
          >
            {/* 250×... 的局部实时演化：机器真的在跑 */}
            <OffthreadVideo
              src={staticFile('clip-turing-live.mp4')}
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'saturate(1.15) brightness(1.05)',
                transform: `scale(${camScale}) translate(${camX}px, ${camY}px)`,
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
                background: 'rgba(5,8,12,0.78)',
                border: `1px solid ${C.line}`,
              }}
            >
              <div
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: `1px solid ${C.accentSoft}`,
                  background: 'rgba(108,245,210,0.1)',
                  fontSize: 13,
                  letterSpacing: 2,
                  color: C.accent,
                }}
              >
                真实图案 · 实时演化
              </div>
              <div style={{ fontSize: 13, color: C.text, opacity: 0.75 }}>局部放大</div>
            </div>

            {/* 全图小地图：让观众知道镜头在整台机器的哪里 */}
            <div
              style={{
                position: 'absolute',
                top: 16,
                right: 18,
                width: 180,
                padding: 5,
                borderRadius: 10,
                background: 'rgba(5,8,12,0.78)',
                border: `1px solid ${C.line}`,
              }}
            >
              <div style={{ position: 'relative', width: 170, height: 164, overflow: 'hidden', borderRadius: 6 }}>
                <Img
                  src={staticFile('pattern-turing.png')}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.65 }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${(768 / 1714) * 100}%`,
                    top: `${(768 / 1647) * 100}%`,
                    width: `${(640 / 1714) * 100}%`,
                    height: `${(480 / 1647) * 100}%`,
                    border: `1.5px solid ${C.accent}`,
                    boxShadow: '0 0 10px rgba(108,245,210,0.5)',
                  }}
                />
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: C.dim, letterSpacing: 2, textAlign: 'center' }}>
                整机位置
              </div>
            </div>

            <div
              style={{
                position: 'absolute',
                right: 18,
                bottom: 14,
                padding: '5px 11px',
                borderRadius: 999,
                background: 'rgba(5,8,12,0.78)',
                border: `1px solid ${C.line}`,
                fontSize: 13,
                color: C.accent,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              第 {Math.min(269, Math.floor(frame))} 代
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 宏大结构：三段真实大图案，直接播放模拟器算出来的局部演化 ──────────────
type Grand = {
  clip: string;
  img: string;
  name: string;
  en: string;
  stat: string;
  note: string;
  credit: string;
  /** 图案总尺寸（小地图用） */
  pw: number;
  ph: number;
  /** 局部裁切（小地图上的框） */
  crop: { x: number; y: number; w: number; h: number };
  /** 每帧推进几代 */
  gpf: number;
  /** inset：全图当背景，右上角开一个实时演化的小窗；full：整屏都是视频 */
  mode: 'inset' | 'full';
  zoom?: number;
  localLabel?: string;
  /** 小窗在 5 秒里推近的倍数和焦点 */
  insetZoom?: number;
  insetFocus?: string;
  /** 右下角的种子卡（太空填充者） */
  seed?: string;
};

const GRANDS: Grand[] = [
  {
    clip: 'clip-p59-live.mp4',
    img: 'grand-p59.png',
    name: 'P59 炮阵',
    en: 'Period-59 gun array',
    stat: '8,870 × 7,352 格',
    note: '一排枪，连成一片大陆',
    credit: 'LifeWiki',
    pw: 8870,
    ph: 7352,
    crop: { x: 3612, y: 3860, w: 480, h: 270 },
    gpf: 1,
    mode: 'inset',
    zoom: 4,
    localLabel: '炮阵的密集区',
    insetZoom: 1.35,
    insetFocus: '50% 55%',
  },
  {
    clip: 'clip-spacefiller-live.mp4',
    img: 'grand-spacefiller.png',
    name: '太空填充者',
    en: 'Spacefiller',
    stat: '从 200 个细胞长成实心',
    note: '它把空白，一格一格地填满',
    credit: 'LifeWiki / Golly',
    pw: 427,
    ph: 404,
    crop: { x: -260, y: -70, w: 960, h: 540 },
    gpf: 3,
    mode: 'full',
    seed: 'spacefiller-seed.png',
  },
  {
    clip: 'clip-utm-live.mp4',
    img: 'grand-utm.png',
    name: '通用图灵机',
    en: 'Universal Turing machine',
    stat: '12,699 × 12,652 格',
    note: '一条数据带，绕了半张宇宙',
    credit: 'Paul Rendell · 2010',
    pw: 12699,
    ph: 12652,
    crop: { x: 6000, y: 6000, w: 960, h: 540 },
    gpf: 1,
    mode: 'inset',
    zoom: 2,
    localLabel: '机器头部',
    insetZoom: 1.55,
    insetFocus: '58% 42%',
  },
];

const SEG = 150;
const XFADE = 12;

const GrandSegment: React.FC<{ g: Grand; i: number; opacity: number }> = ({ g, i, opacity }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, SEG], [1.04, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tx = interpolate(f, [0, SEG], [i % 2 ? -10 : 10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const gen = Math.floor(f * g.gpf);

  return (
    <AbsoluteFill style={{ opacity }}>
      {g.mode === 'inset' ? (
        <AbsoluteFill style={{ overflow: 'hidden', transform: `scale(${z}) translateX(${tx}px)` }}>
          <Img
            src={staticFile(g.img)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(1.06) brightness(0.92)' }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ overflow: 'hidden', transform: `scale(${z}) translateX(${tx}px)` }}>
          <OffthreadVideo
            src={staticFile(g.clip)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(1.1) brightness(1.05)' }}
          />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(5,8,12,0.46) 0%, rgba(5,8,12,0.04) 26%, rgba(5,8,12,0.3) 55%, rgba(5,8,12,0.97) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, rgba(5,8,12,0.86) 0%, rgba(5,8,12,0.2) 40%, rgba(5,8,12,0) 62%)',
        }}
      />

      {/* 全图 + 实时小窗：大结构先交代清楚，再让观众看到它真的在动 */}
      {g.mode === 'inset' && (
        <>
          <div
            style={{
              position: 'absolute',
              right: 96,
              top: 150,
              width: 620,
              height: 349,
              borderRadius: 14,
              overflow: 'hidden',
              border: `1px solid ${C.accentSoft}`,
              boxShadow: '0 24px 70px rgba(0,0,0,0.6), 0 0 60px rgba(108,245,210,0.10)',
            }}
          >
            <OffthreadVideo
              src={staticFile(g.clip)}
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `scale(${1 + ((g.insetZoom ?? 1.15) - 1) * (f / SEG)})`,
                transformOrigin: g.insetFocus ?? '50% 50%',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 10,
                top: 10,
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(5,8,12,0.78)',
                border: `1px solid ${C.accentSoft}`,
                fontSize: 11,
                letterSpacing: 2,
                color: C.accent,
              }}
            >
              局部 ×{g.zoom}
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              right: 96,
              top: 510,
              width: 620,
              textAlign: 'right',
              fontSize: 13,
              letterSpacing: 2,
              color: C.dim,
            }}
          >
            局部：{g.localLabel}，镜头正在缓慢推近
          </div>
        </>
      )}

      {g.seed && (
        <div
          style={{
            position: 'absolute',
            right: 96,
            bottom: 148,
            width: 420,
            padding: 14,
            borderRadius: 16,
            border: `1px solid ${C.line}`,
            background: 'rgba(5,8,12,0.76)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, letterSpacing: 2, color: C.dim }}>
            <span>种子</span>
            <span style={{ color: C.accent }}>200 个细胞</span>
          </div>
          <Img
            src={staticFile(g.seed)}
            style={{ width: '100%', marginTop: 8, display: 'block', filter: 'saturate(1.1) brightness(1.05)' }}
          />
          <div style={{ marginTop: 6, fontSize: 11, color: C.dim, letterSpacing: 2 }}>
            49 × 26 格 · 第 0 代
          </div>
        </div>
      )}

      {/* 实时状态：局部位 + 第几代 */}
      <div
        style={{
          position: 'absolute',
          top: 78,
          left: 96,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            padding: '5px 12px',
            borderRadius: 999,
            border: `1px solid ${C.accentSoft}`,
            background: 'rgba(5,8,12,0.74)',
            fontSize: 13,
            letterSpacing: 2,
            color: C.accent,
          }}
        >
          {g.mode === 'inset' ? '局部实时' : '实时生长'}
        </div>
        <div
          style={{
            padding: '5px 12px',
            borderRadius: 999,
            border: `1px solid ${C.line}`,
            background: 'rgba(5,8,12,0.74)',
            fontSize: 13,
            color: C.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          第 {gen} 代
        </div>
      </div>

      <AbsoluteFill style={{ padding: '78px 96px', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 15, letterSpacing: 6, color: C.accent }}>大神们的作品</div>
              <div style={{ fontSize: 13, color: C.dim, letterSpacing: 2 }}>0{i + 1} / 03</div>
            </div>
            <div style={{ fontSize: 66, fontWeight: 800, letterSpacing: 3 }}>{g.name}</div>
            <div style={{ marginTop: 6, fontSize: 20, letterSpacing: 4, color: C.accent }}>{g.en}</div>
            <div style={{ marginTop: 18, fontSize: 24, color: C.text, opacity: 0.86 }}>{g.note}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{g.stat}</div>
            <div style={{ marginTop: 6, fontSize: 15, color: C.dim }}>{g.credit}</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const GrandStructuresScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, overflow: 'hidden' }}>
      {GRANDS.map((g, i) => {
        const start = i * SEG;
        const o =
          i === 0
            ? interpolate(frame, [0, XFADE, SEG - XFADE, SEG + XFADE], [1, 1, 1, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            : interpolate(
                frame,
                [start - XFADE, start + XFADE, start + SEG - XFADE, start + SEG + XFADE],
                [0, 1, 1, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
              );
        return (
          <Sequence key={g.clip} from={start} durationInFrames={SEG + XFADE}>
            <GrandSegment g={g} i={i} opacity={o} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
