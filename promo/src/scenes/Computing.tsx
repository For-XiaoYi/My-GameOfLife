import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { LifeGrid } from '../components/LifeGrid';
import { Backdrop, Eyebrow, Heading, Rise } from '../components/ui';
import { C } from '../theme';
import { GATE_DEMOS, type GateDemo } from '../lib/gates';

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
          那有了开关，
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

// ── 门阵列：把四种门排成一片，信号在格子里走 ────────────────────────────────
const SYMBOLS = ['∧', '∨', '¬', '⊕'];
const TILE = 74;
const TGAP = 8;
const GRID = 8;

export const GateArrayScene: React.FC = () => {
  const frame = useCurrentFrame();
  const tiles = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      tiles.push({ x, y });
    }
  }
  const appear = interpolate(frame, [0, 45], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const zoom = interpolate(frame, [0, 160], [1.08, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [150, 180], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '86px 110px' }}>
        <div style={{ display: 'flex', gap: 50, alignItems: 'center', height: '100%' }}>
          <div style={{ width: 760 }}>
            <Rise delay={0}>
              <Eyebrow>从门到机器</Eyebrow>
              <Heading size={52}>把门排成阵列</Heading>
              <div style={{ marginTop: 20, fontSize: 24, color: C.text, lineHeight: 1.7, opacity: 0.9 }}>
                一颗滑翔机是一个比特，一排门是一条信号线。
              </div>
              <div style={{ marginTop: 10, fontSize: 21, color: C.dim, lineHeight: 1.7 }}>
                把与、或、非、异或排成一片，信号就能在格子里自己走。
              </div>
            </Rise>

            <Rise delay={50} style={{ marginTop: 70 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {[
                  { t: '逻辑门', n: '4 种反应' },
                  { t: '门阵列', n: '一片电路', on: true },
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
          </div>

          <div
            style={{
              position: 'relative',
              width: GRID * (TILE + TGAP) - TGAP,
              height: GRID * (TILE + TGAP) - TGAP,
              flexShrink: 0,
              transform: `scale(${zoom * fadeOut})`,
              opacity: appear,
            }}
          >
            {tiles.map(({ x, y }, i) => {
              const wave = (Math.sin((x + y) * 0.65 - frame * 0.12) + 1) / 2;
              const on = wave > 0.72;
              const kind = (x * 3 + y) % 4;
              const sym = SYMBOLS[kind];
              const label = ['AND', 'OR', 'NOT', 'XOR'][kind];
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x * (TILE + TGAP),
                    top: y * (TILE + TGAP),
                    width: TILE,
                    height: TILE,
                    borderRadius: 12,
                    border: `1px solid ${on ? C.accentSoft : C.line}`,
                    background: on ? 'rgba(108,245,210,0.10)' : 'rgba(8,13,19,0.72)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    opacity: 0.5 + 0.5 * wave,
                    boxShadow: on ? '0 0 22px rgba(108,245,210,0.16)' : 'none',
                  }}
                >
                  <div style={{ fontSize: 28, color: on ? C.accent : C.dim, fontWeight: 700 }}>{sym}</div>
                  <div style={{ fontSize: 9, letterSpacing: 1, color: C.dim }}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 图灵机：真实图案，缓慢推近 ─────────────────────────────────────────────
export const TuringMachineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, 160], [1.14, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drift = interpolate(frame, [160, 270], [0, 10], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const textIn = spring({ frame: frame - 30, fps, config: { damping: 200, mass: 0.8 } });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '72px 96px', flexDirection: 'row', alignItems: 'center', gap: 44 }}>
        <div style={{ width: 470, flexShrink: 0 }}>
          <Rise delay={0}>
            <Eyebrow>2000 · Paul Rendell</Eyebrow>
            <Heading size={78}>图灵机</Heading>
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
              height: 940,
              borderRadius: 18,
              border: `1px solid ${C.line}`,
              background: '#05090e',
              overflow: 'hidden',
              boxShadow: '0 0 120px rgba(108,245,210,0.10)',
            }}
          >
            <Img
              src={staticFile('pattern-turing.png')}
              style={{
                height: '100%',
                width: 'auto',
                display: 'block',
                transform: `scale(${zoom}) translateY(${drift}px)`,
                filter: 'saturate(1.15) brightness(1.05)',
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
                background: 'rgba(5,8,12,0.72)',
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
                真实图案
              </div>
              <div style={{ fontSize: 14, color: C.text, opacity: 0.8 }}>不是示意图</div>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 宏大结构：三段真实大图案，逐段推近 ─────────────────────────────────────
type Grand = { img: string; name: string; en: string; stat: string; note: string; credit: string };
const GRANDS: Grand[] = [
  {
    img: 'grand-p59.png',
    name: 'P59 炮阵',
    en: 'Period-59 gun array',
    stat: '8,870 × 7,352 格',
    note: '一排枪，连成一片大陆',
    credit: 'LifeWiki',
  },
  {
    img: 'grand-spacefiller.png',
    name: '太空填充者',
    en: 'Spacefiller',
    stat: '从 200 个细胞长成实心',
    note: '它把空白，一格一格地填满',
    credit: 'LifeWiki / Golly',
  },
  {
    img: 'grand-utm.png',
    name: '通用图灵机',
    en: 'Universal Turing machine',
    stat: '12,699 × 12,652 格',
    note: '一条数据带，绕了半张宇宙',
    credit: 'Paul Rendell · 2010',
  },
];

const SEG = 150;
const XFADE = 12;

export const GrandStructuresScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, overflow: 'hidden' }}>
      {GRANDS.map((g, i) => {
        const start = i * SEG;
        const o = interpolate(
          frame,
          [start - XFADE, start + XFADE, start + SEG - XFADE, start + SEG + XFADE],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
        const z = interpolate(frame, [start, start + SEG], [1.06, 1.0]);
        const tx = interpolate(frame, [start, start + SEG], [i % 2 ? -18 : 18, 0]);
        return (
          <AbsoluteFill key={g.img} style={{ opacity: o }}>
            <Img
              src={staticFile(g.img)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `scale(${z}) translateX(${tx}px)`,
                filter: 'saturate(1.1) brightness(1.05)',
              }}
            />
            <AbsoluteFill
              style={{
                background:
                  'linear-gradient(180deg, rgba(5,8,12,0.55) 0%, rgba(5,8,12,0.05) 26%, rgba(5,8,12,0.28) 55%, rgba(5,8,12,0.97) 100%)',
              }}
            />
            <AbsoluteFill
              style={{
                background:
                  'linear-gradient(90deg, rgba(5,8,12,0.85) 0%, rgba(5,8,12,0.2) 40%, rgba(5,8,12,0) 62%)',
              }}
            />
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
      })}
    </AbsoluteFill>
  );
};
