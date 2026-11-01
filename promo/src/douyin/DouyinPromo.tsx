import type { ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Backdrop } from '../components/ui';
import { LifeGrid } from '../components/LifeGrid';
import { C, FONT } from '../theme';
import { GATE_DEMOS } from '../lib/gates';
import { CIRCUITS } from '../lib/circuits';
import { framesOf, getPattern, type Bitmap } from '../lib/life';
import { GUN_FRAMES_V } from '../scenes/Anatomy';
import { SWITCH_BOARD_H, SWITCH_BOARD_W, SWITCH_FRAMES } from '../scenes/Switch';

// 1080×1920 竖屏：一屏只讲一件事，字要大，镜头要动
const SW_PX = 16;
const SW_GAP = 1;
const SW_STEP = SW_PX + SW_GAP;
const SW_W = SWITCH_BOARD_W * SW_STEP - SW_GAP;
const SW_H = SWITCH_BOARD_H * SW_STEP - SW_GAP;
const SW_HIT = { x: 28 * SW_STEP + SW_PX / 2, y: 20 * SW_STEP + SW_PX / 2 };
const SW_COLLISION_INDEX = 54;

const RULES = [
  { n: '01', rule: '邻居少于 2', verdict: '孤单而死', alive: true, outcome: '死', neighbors: [[1, 1]], count: 1 },
  { n: '02', rule: '邻居是 2 或 3', verdict: '继续存活', alive: true, outcome: '活', neighbors: [[1, 1], [3, 1]], count: 2 },
  { n: '03', rule: '死格子周围正好 3 个', verdict: '诞生', alive: false, outcome: '生', neighbors: [[1, 1], [3, 1], [1, 3]], count: 3 },
  { n: '04', rule: '邻居超过 3', verdict: '拥挤而死', alive: true, outcome: '死', neighbors: [[1, 1], [3, 1], [1, 3], [3, 3]], count: 4 },
];

const RULE_BOARDS: Bitmap[] = RULES.map((r) => {
  const w = 5;
  const h = 5;
  const cells = new Array<number>(w * h).fill(0);
  if (r.alive) cells[2 * w + 2] = 1;
  for (const [x, y] of r.neighbors) cells[y * w + x] = 1;
  return { w, h, cells };
});

const RULE_FRAMES = RULE_BOARDS.map((b, i) => framesOf(`douyin-rule-${i}`, b, 1));
const GLIDER = getPattern('glider');
const GLIDER_FRAME = framesOf('douyin-glider', GLIDER, 1);

const ARRAY_STYLE: Record<string, { pad: number; px: number }> = {
  demux: { pad: 4, px: 8 },
  toggle: { pad: 1, px: 6 },
  memory: { pad: 4, px: 8 },
  loaf: { pad: 4, px: 10 },
};

const ARRAY_ITEMS = CIRCUITS.map((c) => {
  const { pad, px } = ARRAY_STYLE[c.id] ?? { pad: 4, px: 6 };
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
  return { ...c, board, px, gap, frames: framesOf(`douyin-circuit-${c.id}`, board, 90, { wrapX: false, wrapY: false }) };
});

const GATE_CASE: Record<string, number> = { AND: 3, OR: 3, NOT: 0, XOR: 3 };
const GATE_SYMBOL: Record<string, string> = { AND: '∧', OR: '∨', NOT: '¬', XOR: '⊕' };

const Title: React.FC<{ children: ReactNode; size?: number; top?: number }> = ({ children, size = 76, top = 140 }) => (
  <div style={{ position: 'absolute', left: 64, right: 64, top, fontSize: size, fontWeight: 800, letterSpacing: 2, lineHeight: 1.2 }}>
    {children}
  </div>
);

const EyebrowV: React.FC<{ children: ReactNode; top?: number; color?: string }> = ({ children, top = 92, color = C.accent }) => (
  <div style={{ position: 'absolute', left: 64, top, fontSize: 20, letterSpacing: 8, color }}>{children}</div>
);

const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gi = Math.min(SWITCH_FRAMES.length - 1, 20 + Math.floor(frame * 1.25));
  const after = gi >= SW_COLLISION_INDEX;
  const answer = spring({ frame: frame - 28, fps, config: { damping: 16, mass: 0.6 } });
  const flash = interpolate(frame, [26, 29, 33], [0, 0.35, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bottom = interpolate(frame, [50, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <Backdrop>
      <EyebrowV>生命游戏</EyebrowV>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 160, fontSize: 54, fontWeight: 800, lineHeight: 1.35, letterSpacing: 1 }}>
        两个滑翔机撞在一起，
        <br />
        会发生什么？
      </div>
      <div
        style={{
          position: 'absolute',
          left: 64,
          top: 620,
          width: SW_W,
          height: SW_H,
          borderRadius: 20,
          border: `1px solid ${C.line}`,
          background: 'rgba(5,9,14,0.75)',
          overflow: 'hidden',
          boxShadow: '0 0 100px rgba(108,245,210,0.10)',
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0 }}>
          <LifeGrid frames={SWITCH_FRAMES} gi={gi} px={SW_PX} gap={SW_GAP} radius={2} showGrid />
        </div>
        <AbsoluteFill style={{ background: `rgba(108,245,210,${flash})` }} />
        {after && (
          <div
            style={{
              position: 'absolute',
              left: SW_HIT.x,
              top: SW_HIT.y,
              width: 260,
              height: 260,
              marginLeft: -130,
              marginTop: -130,
              borderRadius: '50%',
              border: `1.5px solid ${C.accentSoft}`,
              boxShadow: '0 0 60px rgba(108,245,210,0.25)',
              transform: `scale(${1 + Math.min(1, (frame - 28) / 18) * 1.4})`,
              opacity: Math.max(0, 1 - (frame - 28) / 24),
            }}
          />
        )}
      </div>
      {after && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 880,
            textAlign: 'center',
            opacity: answer,
            transform: `scale(${0.82 + answer * 0.18})`,
            fontSize: 94,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#eafff8',
            textShadow: '0 2px 40px rgba(5,8,12,0.95)',
          }}
        >
          完全消失
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          top: 1460,
          textAlign: 'center',
          opacity: bottom,
          fontSize: 42,
          letterSpacing: 4,
          color: C.accent,
          fontWeight: 700,
        }}
      >
        这不是消失，是一次判断。
      </div>
    </Backdrop>
  );
};

const RulesSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const active = Math.floor(frame / 42) % 4;
  const r = RULES[active];
  return (
    <Backdrop>
      <EyebrowV>它是怎么运转的</EyebrowV>
      <Title top={140} size={82}>它只有三条规则</Title>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 280, fontSize: 26, color: C.dim, lineHeight: 1.6 }}>
        每个格子只有生或死，命运只看身边的 8 个邻居。
      </div>
      <div style={{ position: 'absolute', left: 316, top: 400, display: 'flex', justifyContent: 'center' }}>
        <LifeGrid frames={RULE_FRAMES[active]} gi={0} px={80} gap={12} radius={10} showGrid />
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 980, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RULES.map((x, i) => {
          const on = i === active;
          return (
            <div
              key={x.n}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '18px 24px',
                borderRadius: 16,
                border: `1px solid ${on ? C.accentSoft : 'transparent'}`,
                background: on ? 'rgba(108,245,210,0.09)' : 'rgba(8,13,19,0.5)',
                opacity: on ? 1 : 0.42,
              }}
            >
              <div style={{ fontSize: 26, color: on ? C.accent : C.dim, fontWeight: 800, width: 54 }}>{x.n}</div>
              <div style={{ fontSize: 34, fontWeight: 600 }}>{x.rule}</div>
              <div style={{ marginLeft: 'auto', fontSize: 28, color: on ? C.accent : C.dim }}>{x.verdict}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1600, fontSize: 26, color: C.dim, lineHeight: 1.7 }}>
        {r.count} 个邻居 · 下一代，它会「{r.outcome}」。
      </div>
    </Backdrop>
  );
};

const GliderSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Backdrop>
      <EyebrowV>组件 · 其三</EyebrowV>
      <Title top={150} size={84}>滑翔机</Title>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 270, fontSize: 34, color: C.text, lineHeight: 1.6 }}>
        五格而已。放在那儿不动，它看起来一点也不特别。
      </div>
      <div style={{ position: 'absolute', left: 267, top: 500, opacity: rise }}>
        <div style={{ position: 'absolute', left: -130, top: 130, opacity: 0.12 }}>
          <LifeGrid frames={GLIDER_FRAME} gi={0} px={170} gap={18} radius={14} glow={0.3} />
        </div>
        <div style={{ position: 'absolute', left: -65, top: 65, opacity: 0.28 }}>
          <LifeGrid frames={GLIDER_FRAME} gi={0} px={170} gap={18} radius={14} glow={0.5} />
        </div>
        <LifeGrid frames={GLIDER_FRAME} gi={0} px={170} gap={18} radius={14} glow={0.9} />
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1330, textAlign: 'center', fontSize: 40, fontWeight: 700, color: C.accent }}>
        它会一直朝一个方向走。
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1600, textAlign: 'center', fontSize: 26, color: C.dim }}>
        不靠推动，只靠每一代把自己翻过去。
      </div>
    </Backdrop>
  );
};

const GunSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const gi = Math.min(GUN_FRAMES_V.length - 1, Math.floor(frame * 1.6));
  const ships = Math.floor(gi / 30);
  return (
    <Backdrop>
      <EyebrowV>组件 · 其四</EyebrowV>
      <Title top={140} size={76}>滑翔枪</Title>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 270, fontSize: 36, color: C.text, lineHeight: 1.6 }}>
        一把枪，不发射子弹。
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 430,
          width: 74 * 14 - 1,
          height: 40 * 14 - 1,
          borderRadius: 16,
          border: `1px solid ${C.line}`,
          background: 'rgba(5,9,14,0.78)',
          overflow: 'hidden',
        }}
      >
        <LifeGrid frames={GUN_FRAMES_V} gi={gi} px={13} gap={1} radius={2} showGrid />
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1060, textAlign: 'right' }}>
        <div style={{ fontSize: 84, fontWeight: 900, color: C.accent, lineHeight: 1 }}>
          {ships}
          <span style={{ marginLeft: 10, fontSize: 28, color: C.dim, fontWeight: 400 }}>艘滑翔机</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1220, fontSize: 40, color: C.text, lineHeight: 1.5, textAlign: 'center' }}>
        它每 30 代，生出一艘滑翔机。
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1560, display: 'flex', justifyContent: 'space-between', fontSize: 26, color: C.dim }}>
        <span>周期 30 代</span>
        <span>枪体 36 × 9 格</span>
        <span>产出 ∞</span>
      </div>
    </Backdrop>
  );
};

const SwitchSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gi = Math.min(SWITCH_FRAMES.length - 1, 15 + Math.floor(frame * 0.65));
  const after = gi >= SW_COLLISION_INDEX;
  const post = interpolate(frame, [64, 92], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shake = interpolate(frame, [58, 66], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flash = interpolate(frame, [57, 60, 72], [0, 0.35, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const answer = spring({ frame: frame - 60, fps, config: { damping: 16, mass: 0.6 } });
  const answerFade = interpolate(frame, [100, 122], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const L = [
    { at: 86, text: '它们会精确抵消——像什么都没发生过。' },
    { at: 120, text: '两颗都到，输出 0；只到一颗，输出 1。' },
    { at: 148, text: '碰撞，就是判断。' },
  ];
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 130, fontSize: 52, fontWeight: 800, lineHeight: 1.35 }}>
        两个滑翔机撞在一起，
        <br />
        会发生什么？
      </div>
      <div
        style={{
          position: 'absolute',
          left: 64,
          top: 480,
          width: SW_W,
          height: SW_H,
          borderRadius: 20,
          border: `1px solid ${C.line}`,
          background: 'rgba(5,9,14,0.75)',
          overflow: 'hidden',
          transform: `translate(${Math.sin(frame * 13) * 2.4 * shake}px, ${Math.cos(frame * 17) * 1.6 * shake}px)`,
        }}
      >
        <LifeGrid frames={SWITCH_FRAMES} gi={gi} px={SW_PX} gap={SW_GAP} radius={2} showGrid />
        <AbsoluteFill style={{ background: `rgba(108,245,210,${flash})` }} />
        {after && (
          <div
            style={{
              position: 'absolute',
              left: SW_HIT.x,
              top: SW_HIT.y,
              width: 240,
              height: 240,
              marginLeft: -120,
              marginTop: -120,
              borderRadius: '50%',
              border: `1.5px solid ${C.accentSoft}`,
              boxShadow: '0 0 50px rgba(108,245,210,0.25)',
              transform: `scale(${1 + Math.min(1, (frame - 60) / 20) * 1.3})`,
              opacity: Math.max(0, 1 - (frame - 60) / 26),
            }}
          />
        )}
      </div>
      {after && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 760,
            textAlign: 'center',
            opacity: answer * answerFade,
            transform: `scale(${0.82 + answer * 0.18})`,
            fontSize: 88,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#eafff8',
            textShadow: '0 2px 40px rgba(5,8,12,0.95)',
          }}
        >
          完全消失
        </div>
      )}
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1180, fontSize: 40, lineHeight: 1.6 }}>
        {L.map((l) => {
          const a = interpolate(frame, [l.at, l.at + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const last = frame < 148 ? frame >= l.at : l.at === 148;
          return (
            <div key={l.text} style={{ opacity: last ? a : a * 0.35, color: last ? C.text : C.dim, marginBottom: 16 }}>
              {l.text}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1660, display: 'flex', justifyContent: 'center', gap: 14, opacity: post }}>
        {['A 输入 1', 'B 输入 1', 'Q 输出 0'].map((t) => (
          <div key={t} style={{ padding: '10px 18px', borderRadius: 12, border: `1px solid ${C.line}`, background: 'rgba(8,13,19,0.8)', fontSize: 24 }}>
            {t}
          </div>
        ))}
      </div>
    </Backdrop>
  );
};

const GatesSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const index = Math.min(3, Math.floor(frame / 30));
  const local = frame % 30;
  const demo = GATE_DEMOS[index];
  const caseIdx = GATE_CASE[demo.kind] ?? 0;
  const frames = demo.frames[caseIdx];
  const gi = Math.floor(local * 3.4) % frames.length;
  const appear = 1;
  const step = demo.px + demo.gap;
  return (
    <Backdrop>
      <EyebrowV>逻辑 · 其六</EyebrowV>
      <Title top={140} size={72}>四种门，四种反应</Title>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 280, fontSize: 28, color: C.dim }}>
        都是细胞真的在跑。放大看一张就够。
      </div>
      <div
        style={{
          position: 'absolute',
          left: 90,
          top: 430,
          width: 900,
          height: 1060,
          borderRadius: 24,
          border: `1px solid ${demo.color}55`,
          background: 'rgba(8,13,19,0.86)',
          opacity: appear,
          transform: `translateY(${(1 - appear) * 26}px)`,
          overflow: 'hidden',
          boxShadow: `0 0 80px ${demo.color}14`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '28px 32px 0' }}>
          <div style={{ fontSize: 100, fontWeight: 900, color: demo.color, lineHeight: 1 }}>{GATE_SYMBOL[demo.kind]}</div>
          <div style={{ fontSize: 54, fontWeight: 800 }}>{demo.kind}</div>
          <div style={{ marginLeft: 'auto', fontSize: 20, color: demo.color, border: `1px solid ${demo.color}55`, borderRadius: 999, padding: '4px 12px' }}>
            真实反应
          </div>
        </div>
        <div style={{ height: 640, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              position: 'relative',
              width: demo.crop.w * step - demo.gap,
              height: demo.crop.h * step - demo.gap,
              overflow: 'hidden',
              borderRadius: 10,
            }}
          >
            <div style={{ position: 'absolute', left: -demo.crop.x * step, top: -demo.crop.y * step }}>
              <LifeGrid frames={frames} gi={gi} px={demo.px} gap={demo.gap} radius={1} showGrid />
            </div>
          </div>
        </div>
        <div style={{ padding: '0 32px 26px', fontSize: 30, color: C.text, lineHeight: 1.5 }}>{demo.desc}</div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1580, display: 'flex', justifyContent: 'center', gap: 12 }}>
        {GATE_DEMOS.map((g, i) => (
          <div
            key={g.kind}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${i === index ? g.color : C.line}`,
              color: i === index ? g.color : C.dim,
              fontSize: 20,
              letterSpacing: 1,
            }}
          >
            {g.kind}
          </div>
        ))}
      </div>
    </Backdrop>
  );
};

const ArraySceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const titleIn = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Backdrop>
      <EyebrowV>从门到机器</EyebrowV>
      <Title top={140} size={66}>四台真的在跑的小电路</Title>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 250, fontSize: 26, color: C.dim, opacity: titleIn }}>
        不是符号，是 LifeWiki 上真实搭出来的图案。
      </div>
      <div style={{ position: 'absolute', left: 50, top: 360, display: 'grid', gridTemplateColumns: '480px 480px', gap: 20 }}>
        {ARRAY_ITEMS.map((item, i) => {
          const gi = Math.floor(frame * 0.7 + i * 9) % item.frames.length;
          return (
            <div
              key={item.id}
              style={{
                width: 480,
                height: 480,
                padding: 18,
                borderRadius: 20,
                border: `1px solid ${C.line}`,
                background: 'rgba(8,13,19,0.88)',
                display: 'flex',
                flexDirection: 'column',
                opacity: titleIn,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ fontSize: 30, fontWeight: 800 }}>{item.name}</div>
                <div style={{ fontSize: 14, letterSpacing: 2, color: C.dim }}>{item.en}</div>
                <div style={{ marginLeft: 'auto', fontSize: 12, color: C.accent, border: `1px solid ${C.accentSoft}`, borderRadius: 999, padding: '2px 8px' }}>
                  真实电路
                </div>
              </div>
              <div style={{ flex: 1, marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,9,14,0.7)', borderRadius: 12, overflow: 'hidden' }}>
                <LifeGrid frames={item.frames} gi={gi} px={item.px} gap={item.gap} radius={1} showGrid />
              </div>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.dim }}>
                <span>{item.w} × {item.h} 格</span>
                <span style={{ color: C.accent }}>第 {gi} 代</span>
              </div>
            </div>
          );
        })}
      </div>
    </Backdrop>
  );
};

const TuringSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = interpolate(frame, [0, 240], [1, 1.14], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Backdrop>
      <EyebrowV>四块电路接起来</EyebrowV>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 136, fontSize: 66, fontWeight: 800, color: C.accent }}>是一台机器。</div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 240, display: 'flex', alignItems: 'flex-end', gap: 18 }}>
        <div style={{ fontSize: 80, fontWeight: 900 }}>图灵机</div>
        <div style={{ paddingBottom: 12, fontSize: 18, letterSpacing: 5, color: C.dim }}>2000 · PAUL RENDELL</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 40,
          top: 500,
          width: 1000,
          height: 750,
          borderRadius: 22,
          border: `1px solid ${C.line}`,
          background: '#05090e',
          overflow: 'hidden',
          boxShadow: '0 0 100px rgba(108,245,210,0.12)',
        }}
      >
        <OffthreadVideo
          src={staticFile('clip-turing-live.mp4')}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${cam})` }}
        />
        <div style={{ position: 'absolute', left: 14, top: 14, padding: '4px 10px', borderRadius: 999, background: 'rgba(5,8,12,0.8)', border: `1px solid ${C.accentSoft}`, fontSize: 12, letterSpacing: 2, color: C.accent }}>
          实时演化
        </div>
        <div style={{ position: 'absolute', right: 14, top: 14, width: 170, padding: 5, borderRadius: 10, background: 'rgba(5,8,12,0.8)', border: `1px solid ${C.line}` }}>
          <div style={{ position: 'relative', width: 160, height: 154, overflow: 'hidden', borderRadius: 6 }}>
            <Img src={staticFile('pattern-turing.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} />
            <div
              style={{
                position: 'absolute',
                left: `${(768 / 1714) * 100}%`,
                top: `${(768 / 1647) * 100}%`,
                width: `${(640 / 1714) * 100}%`,
                height: `${(480 / 1647) * 100}%`,
                border: `1.5px solid ${C.accent}`,
              }}
            />
          </div>
        </div>
        <div style={{ position: 'absolute', right: 14, bottom: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(5,8,12,0.8)', border: `1px solid ${C.line}`, fontSize: 13, color: C.accent }}>
          第 {Math.min(269, Math.floor(frame))} 代
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1300, display: 'flex', gap: 30 }}>
        <div>
          <div style={{ fontSize: 24, color: C.dim, letterSpacing: 3 }}>格子</div>
          <div style={{ fontSize: 42, fontWeight: 800, color: C.accent }}>1,714 × 1,647</div>
        </div>
        <div>
          <div style={{ fontSize: 24, color: C.dim, letterSpacing: 3 }}>活细胞</div>
          <div style={{ fontSize: 42, fontWeight: 800, color: C.accent }}>36,549</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1420, fontSize: 30, color: C.text, lineHeight: 1.6 }}>
        这三条规则，能算任何可计算的东西。
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1600, fontSize: 22, color: C.dim }}>
        局部实时演化 · 整机位置见右上小图
      </div>
    </Backdrop>
  );
};

type GrandV = { img?: string; clip?: string; name: string; en: string; stat: string; note: string; credit: string; mode: 'img' | 'clip' };

const GRANDS_V: GrandV[] = [
  { img: 'grand-p59.png', name: 'P59 炮阵', en: 'Period-59 gun array', stat: '8,870 × 7,352 格', note: '一排枪，连成一片大陆', credit: 'LifeWiki', mode: 'img' },
  { img: 'grand-utm.png', name: '通用图灵机', en: 'Universal Turing machine', stat: '12,699 × 12,652 格', note: '一条数据带，绕了半张宇宙', credit: 'Paul Rendell · 2010', mode: 'img' },
  { clip: 'clip-spacefiller-live.mp4', name: '太空填充者', en: 'Spacefiller', stat: '从 200 个细胞长成实心', note: '它把空白，一格一格地填满', credit: 'LifeWiki / Golly', mode: 'clip' },
];

const GrandSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const SEG = 80;
  const XF = 6;
  const index = Math.min(2, Math.floor(frame / SEG));
  const g = GRANDS_V[index];
  const local = frame - index * SEG;
  const z = interpolate(local, [0, SEG], [1.04, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const o = interpolate(local, [0, XF, SEG - XF, SEG], [index === 0 ? 1 : 0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ background: '#05080c', opacity: o, color: C.text, fontFamily: FONT }}>
      <AbsoluteFill style={{ overflow: 'hidden', transform: `scale(${z})` }}>
        {g.mode === 'img' ? (
          <Img src={staticFile(g.img!)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(1.08) brightness(0.95)' }} />
        ) : (
          <OffthreadVideo
            src={staticFile(g.clip!)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '26% 30%' }}
          />
        )}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(5,8,12,0.35) 0%, rgba(5,8,12,0.05) 25%, rgba(5,8,12,0.55) 62%, rgba(5,8,12,0.98) 100%)' }} />
      <div style={{ position: 'absolute', left: 64, top: 116, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderRadius: 999, background: 'rgba(5,8,12,0.62)', border: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 18, letterSpacing: 6, color: C.accent }}>大神们的作品</span>
        <span style={{ fontSize: 16, color: C.dim, letterSpacing: 2 }}>0{index + 1} / 03</span>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 180 }}>
        <div style={{ fontSize: 78, fontWeight: 900, letterSpacing: 2 }}>{g.name}</div>
        <div style={{ marginTop: 6, fontSize: 22, letterSpacing: 4, color: C.accent }}>{g.en}</div>
        <div style={{ marginTop: 16, fontSize: 28, color: C.text, opacity: 0.86 }}>{g.note}</div>
        <div style={{ marginTop: 26, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 36, fontWeight: 800 }}>{g.stat}</span>
          <span style={{ fontSize: 18, color: C.dim }}>{g.credit}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const GOLD = '#ffd9a0';
const OFFWHITE = '#f2ede2';
const PIPS = [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]];

const RandomSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const lines = [
    { at: 8, text: '如果你只想静静的看着混沌演化', size: 40, color: OFFWHITE },
    { at: 34, text: '那不妨投掷一次骰子', size: 40, color: OFFWHITE },
    { at: 60, text: '然后把一切交给时间', size: 44, color: GOLD },
  ];
  const out = interpolate(frame, [128, 152], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dieIn = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const roll = interpolate(frame, [34, 64], [0, 180], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const loopIn = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#04070a', color: OFFWHITE, fontFamily: FONT, overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: loopIn }}>
        <OffthreadVideo src={staticFile('clip-random-loop-vertical.mp4')} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(4,7,10,0.72) 0%, rgba(4,7,10,0.05) 25%, rgba(4,7,10,0.28) 55%, rgba(4,7,10,0.95) 100%)' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(50% 30% at 50% 18%, rgba(255,217,160,0.12), rgba(4,7,10,0) 70%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: dieIn * out }}>
        <div style={{ position: 'absolute', width: 270, height: 270, borderRadius: '50%', border: `1px dashed rgba(255,217,160,0.25)`, transform: `rotate(${frame * 0.2}deg)` }} />
        <div
          style={{
            position: 'relative',
            width: 104,
            height: 104,
            borderRadius: 24,
            border: `1.5px solid ${GOLD}`,
            background: 'linear-gradient(145deg, rgba(24,23,22,0.96), rgba(8,10,13,0.96))',
            boxShadow: '0 0 60px rgba(255,217,160,0.2)',
            transform: `rotate(${roll}deg)`,
          }}
        >
          {PIPS.map(([x, y], i) => (
            <div key={i} style={{ position: 'absolute', left: x, top: y, width: 13, height: 13, marginLeft: -6.5, marginTop: -6.5, borderRadius: 99, background: GOLD, boxShadow: `0 0 14px ${GOLD}aa` }} />
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          top: 586,
          padding: '34px 12px',
          borderRadius: 30,
          textAlign: 'center',
          opacity: out,
          background: 'linear-gradient(180deg, rgba(4,7,10,0.08), rgba(4,7,10,0.66) 22%, rgba(4,7,10,0.66) 78%, rgba(4,7,10,0.08))',
          textShadow: '0 2px 30px rgba(4,7,10,0.98)',
        }}
      >
        {lines.map((l) => {
          const a = interpolate(frame, [l.at, l.at + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={l.text} style={{ marginBottom: 20, opacity: a, transform: `translateY(${(1 - a) * 12}px)`, fontSize: l.size, fontWeight: 300, letterSpacing: 6, color: l.color }}>
              {l.text}
            </div>
          );
        })}
        <div style={{ width: 180, height: 1, margin: '26px auto 0', background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.6 }} />
      </div>
      <div style={{ position: 'absolute', left: 64, top: 80, fontSize: 18, letterSpacing: 10, color: GOLD, opacity: 0.75 * out }}>随机演化</div>
    </AbsoluteFill>
  );
};

const EndingSceneV: React.FC = () => {
  const frame = useCurrentFrame();
  const t = spring({ frame, fps: 30, config: { damping: 18, mass: 0.8 } });
  return (
    <AbsoluteFill style={{ background: '#05080c', fontFamily: FONT, color: C.text, justifyContent: 'center', alignItems: 'center' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(50% 30% at 50% 40%, rgba(108,245,210,0.12), rgba(5,8,12,0) 70%)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, transform: `translateY(${(1 - t) * 16}px)`, opacity: t }}>
        <div style={{ padding: 26, borderRadius: 28, border: `1px solid ${C.line}`, background: 'rgba(8,13,19,0.9)', boxShadow: '0 0 80px rgba(108,245,210,0.14)' }}>
          <LifeGrid frames={GLIDER_FRAME} gi={0} px={54} gap={6} radius={5} glow={0.8} />
        </div>
        <div style={{ fontSize: 92, fontWeight: 900, letterSpacing: 6 }}>生命游戏</div>
        <div style={{ fontSize: 26, color: C.dim, letterSpacing: 3 }}>完整版 · 开源在主页</div>
      </div>
    </AbsoluteFill>
  );
};

type SceneDef = { key: string; dur: number; node: ReactNode };
export const DOUYIN_SCENES: SceneDef[] = [
  { key: 'hook', dur: 120, node: <HookScene /> },
  { key: 'rules', dur: 180, node: <RulesSceneV /> },
  { key: 'glider', dur: 120, node: <GliderSceneV /> },
  { key: 'gun', dur: 180, node: <GunSceneV /> },
  { key: 'switch', dur: 240, node: <SwitchSceneV /> },
  { key: 'gates', dur: 120, node: <GatesSceneV /> },
  { key: 'array', dur: 120, node: <ArraySceneV /> },
  { key: 'turing', dur: 240, node: <TuringSceneV /> },
  { key: 'grand', dur: 240, node: <GrandSceneV /> },
  { key: 'random', dur: 180, node: <RandomSceneV /> },
  { key: 'ending', dur: 60, node: <EndingSceneV /> },
];

export const DOUYIN_TOTAL = DOUYIN_SCENES.reduce((n, s) => n + s.dur, 0);

const Fade: React.FC<{ dur: number; children: ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(1, Math.min(f / 4, (dur - f) / 4));
  return <AbsoluteFill style={{ opacity: Math.max(0, o) }}>{children}</AbsoluteFill>;
};

export const DouyinPromo: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: '#05080c' }}>
      <Audio src={staticFile('music/douyin.mp3')} volume={1} />
      {DOUYIN_SCENES.map((s) => {
        const from = at;
        at += s.dur;
        return (
          <Sequence key={s.key} from={from} durationInFrames={s.dur}>
            <Fade dur={s.dur}>{s.node}</Fade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const DOUYIN_FPS = 30;
