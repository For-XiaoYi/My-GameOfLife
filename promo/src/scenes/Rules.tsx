import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, Eyebrow, Heading } from '../components/ui';
import { C } from '../theme';

/**
 * 规则演示：5×5 方阵，逐条演示四条规则。
 * 每一段都是「数邻居 → 判定 → 中心格真的发生生死变化」，
 * 死亡会缩小并炸成碎片，诞生会从无到有弹出并扩散光环，存活则稳定脉动。
 */

const PHASE_DUR = 80;
const JUDGE = 32;

type Verdict = 'lonely' | 'live' | 'born' | 'crowded';

type Phase = {
  rule: string;
  verdict: Verdict;
  count: number;
  /** 除中心格以外点亮的邻居坐标（5×5 网格里） */
  neighbors: [number, number][];
  centerAlive: boolean;
};

const PHASES: Phase[] = [
  {
    rule: '邻居少于 2 —— 孤单而死',
    verdict: 'lonely',
    count: 1,
    centerAlive: true,
    neighbors: [[1, 1]],
  },
  {
    rule: '邻居是 2 或 3 —— 继续存活',
    verdict: 'live',
    count: 2,
    centerAlive: true,
    neighbors: [
      [1, 1],
      [3, 1],
    ],
  },
  {
    rule: '死格子周围正好 3 个 —— 诞生',
    verdict: 'born',
    count: 3,
    centerAlive: false,
    neighbors: [
      [1, 1],
      [3, 1],
      [1, 3],
    ],
  },
  {
    rule: '邻居超过 3 —— 拥挤而死',
    verdict: 'crowded',
    count: 4,
    centerAlive: true,
    neighbors: [
      [1, 1],
      [3, 1],
      [1, 3],
      [3, 3],
    ],
  },
];

const VERDICT: Record<Verdict, { glyph: string; color: string; title: string; note: string }> = {
  lonely: { glyph: '死', color: '#ff6b6b', title: '孤单而死', note: '身边只剩 1 个同伴' },
  live: { glyph: '活', color: '#6cf5d2', title: '继续存活', note: '2 个邻居，不多不少' },
  born: { glyph: '生', color: '#9bff9b', title: '凭空诞生', note: '周围正好 3 个活细胞' },
  crowded: { glyph: '死', color: '#ff6b6b', title: '拥挤而死', note: '4 个邻居，挤不下' },
};

const PX = 104;
const GAP = 16;
const STEP = PX + GAP;
const BOARD = STEP * 5 - GAP;
const CX = STEP * 2 + PX / 2;
const CY = STEP * 2 + PX / 2;

/** 中心格：根据判定结果做生/死/活三种动画 */
const CenterCell: React.FC<{ local: number; phase: Phase }> = ({ local, phase }) => {
  const { fps } = useVideoConfig();
  const t = local - JUDGE;
  const v = VERDICT[phase.verdict];
  const base = {
    position: 'absolute' as const,
    left: STEP * 2,
    top: STEP * 2,
    width: PX,
    height: PX,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 30,
    fontWeight: 800,
  };

  // 判定之前：活细胞是实心的，死格子是虚线的问号
  if (t < 0) {
    return phase.centerAlive ? (
      <div
        style={{
          ...base,
          background: `rgba(108,245,210,${0.62 + 0.14 * Math.sin(local / 5)})`,
          boxShadow: `0 0 26px rgba(108,245,210,0.5)`,
          border: '1px solid rgba(255,255,255,0.25)',
          color: 'rgba(5,8,12,0.75)',
        }}
      >
        活
      </div>
    ) : (
      <div
        style={{
          ...base,
          background: 'rgba(255,255,255,0.03)',
          border: '2px dashed rgba(140,190,210,0.45)',
          color: 'rgba(140,190,210,0.75)',
        }}
      >
        ?
      </div>
    );
  }

  if (phase.verdict === 'born') {
    // 从无到有：弹簧回弹 + 光环扩散
    const pop = spring({ frame: t, fps, config: { damping: 11, mass: 0.45, stiffness: 190 } });
    const ring = interpolate(t, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
    return (
      <>
        <div
          style={{
            ...base,
            background: 'rgba(155,255,155,0.95)',
            boxShadow: `0 0 ${30 + 40 * (1 - ring)}px rgba(155,255,155,${0.9 - ring * 0.6})`,
            border: '1px solid rgba(255,255,255,0.7)',
            color: 'rgba(5,20,12,0.85)',
            transform: `scale(${pop})`,
          }}
        >
          生
        </div>
        {[0, 1].map((k) => {
          const r = interpolate(t - k * 7, [0, 28], [0, 1], { extrapolateRight: 'clamp' });
          const s = PX + 96 * r;
          return (
            <div
              key={k}
              style={{
                position: 'absolute',
                left: CX - s / 2,
                top: CY - s / 2,
                width: s,
                height: s,
                borderRadius: 18 + 26 * r,
                border: `2px solid rgba(155,255,155,${0.6 * (1 - r)})`,
                opacity: r > 0 && r < 1 ? 1 : 0,
              }}
            />
          );
        })}
        <div
          style={{
            position: 'absolute',
            left: STEP * 2,
            top: STEP * 2,
            width: PX,
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            color: '#9bff9b',
            textShadow: '0 0 18px rgba(155,255,155,0.6)',
            transform: `translateY(${interpolate(t, [2, 30], [10, -104], { extrapolateRight: 'clamp' })}px)`,
            opacity: interpolate(t, [2, 10, 26, 34], [0, 1, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          +1
        </div>
      </>
    );
  }

  if (phase.verdict === 'live') {
    // 存活：轻轻一跳，然后稳定呼吸
    const hop = interpolate(t, [0, 8, 20], [1, 1.14, 1], { extrapolateRight: 'clamp' });
    const breathe = 1 + 0.05 * Math.sin(Math.max(0, t) / 6);
    return (
      <div
        style={{
          ...base,
          background: `rgba(108,245,210,${0.62 + 0.16 * breathe})`,
          boxShadow: `0 0 ${30 * breathe}px rgba(108,245,210,0.55)`,
          border: '1px solid rgba(255,255,255,0.3)',
          color: 'rgba(5,8,12,0.8)',
          transform: `scale(${hop * breathe})`,
        }}
      >
        活
      </div>
    );
  }

  // 两种死亡：塌缩 + 褪色 + 碎成几块
  const dieT = interpolate(t, [0, 22], [0, 1], { extrapolateRight: 'clamp' });
  const shards = [
    { a: -135, d: 110 },
    { a: -90, d: 96 },
    { a: -45, d: 104 },
    { a: 45, d: 108 },
    { a: 90, d: 92 },
    { a: 135, d: 116 },
    { a: 0, d: 78 },
    { a: 180, d: 82 },
  ];
  return (
    <>
      <div
        style={{
          ...base,
          background: `rgba(${Math.round(108 + 147 * dieT)},${Math.round(245 - 130 * dieT)},${Math.round(
            210 - 100 * dieT,
          )},${0.62 - 0.62 * dieT})`,
          border: `1px solid rgba(255,120,120,${0.5 * (1 - dieT)})`,
          boxShadow: `0 0 ${30 * (1 - dieT)}px rgba(255,107,107,0.5)`,
          color: `rgba(5,8,12,${0.8 * (1 - dieT)})`,
          transform: `scale(${1 - 0.94 * dieT})`,
        }}
      >
        活
      </div>
      {shards.map((s, i) => {
        const p = interpolate(t, [2 + i, 22 + i], [0, 1], { extrapolateRight: 'clamp' });
        const rad = (s.a * Math.PI) / 180;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: CX - 8,
              top: CY - 8,
              width: 16,
              height: 16,
              borderRadius: 3,
              background: `rgba(255,${Math.round(140 - 60 * p)},${Math.round(120 - 60 * p)},${0.85 * (1 - p)})`,
              transform: `translate(${Math.cos(rad) * s.d * p}px, ${Math.sin(rad) * s.d * p}px) rotate(${p * 220}deg) scale(${1 - 0.6 * p})`,
              opacity: p > 0 ? 1 : 0,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: STEP * 2,
          top: STEP * 2,
          width: PX,
          height: PX,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 46,
          fontWeight: 300,
          color: `rgba(255,107,107,${interpolate(t, [8, 22], [0, 0.95], { extrapolateRight: 'clamp' })})`,
        }}
      >
        ×
      </div>
    </>
  );
};

export const RulesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const index = Math.min(PHASES.length - 1, Math.floor(frame / PHASE_DUR));
  const phase = PHASES[index];
  const local = frame - index * PHASE_DUR;
  const v = VERDICT[phase.verdict];

  const neighborIn = (i: number) =>
    spring({ frame: local - 4 - i * 4, fps, config: { damping: 14, mass: 0.5, stiffness: 170 } });

  const judgeIn = spring({ frame: local - JUDGE, fps, config: { damping: 200 } });
  const countIn = spring({ frame: local - 8, fps, config: { damping: 200 } });

  return (
    <>
      {/* 四条规则的判定瞬间：死/生/活各一个合成音效（单独一层，和配乐分开） */}
      {PHASES.map((p, i) => {
        const file = p.verdict === 'born' ? 'birth' : p.verdict === 'live' ? 'tick' : 'death';
        const volume = p.verdict === 'born' ? 0.5 : p.verdict === 'live' ? 0.18 : 0.48;
        return (
          <Sequence key={p.verdict} from={i * PHASE_DUR + JUDGE + 2} durationInFrames={18}>
            <Audio src={staticFile(`sfx/${file}.wav`)} volume={volume} />
          </Sequence>
        );
      })}
      <Backdrop>
      <AbsoluteFill style={{ padding: '0 116px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 84, alignItems: 'center' }}>
          {/* 左：标题 + 四条规则 */}
          <div style={{ width: 820 }}>
            <Eyebrow>它是怎么运转的</Eyebrow>
            <Heading size={56}>
              每个格子只有生或死，
              <br />
              命运只看身边的 8 个邻居
            </Heading>

            <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {PHASES.map((p, i) => {
                const active = i === index;
                const s = spring({ frame: frame - 20 - i * 7, fps, config: { damping: 200 } });
                const vv = VERDICT[p.verdict];
                return (
                  <div
                    key={p.rule}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      opacity: s * (active ? 1 : 0.42),
                      transform: `translateX(${(1 - s) * -20 + (active ? 8 : 0)}px)`,
                      padding: '15px 18px',
                      borderRadius: 14,
                      border: `1px solid ${active ? `${vv.color}66` : 'transparent'}`,
                      background: active ? `${vv.color}14` : 'transparent',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 17,
                        fontWeight: 800,
                        color: active ? '#05100e' : C.dim,
                        background: active ? vv.color : 'rgba(255,255,255,0.06)',
                      }}
                    >
                      {i + 1}
                    </div>
                    <div style={{ fontSize: 26, color: active ? C.text : C.dim }}>{p.rule}</div>
                    {active && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          bottom: 0,
                          height: 2,
                          width: `${(local / PHASE_DUR) * 100}%`,
                          background: vv.color,
                          opacity: 0.6,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 34, fontSize: 20, color: C.dim, lineHeight: 1.7, maxWidth: 720 }}>
              就这四条。没有总设计师，也没有随机数 —— 所有秩序都是它们一代代筛出来的。
            </div>
          </div>

          {/* 右：方阵 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div
                style={{
                  padding: '6px 16px',
                  borderRadius: 999,
                  fontSize: 19,
                  letterSpacing: 2,
                  color: local < JUDGE ? C.accent : v.color,
                  border: `1px solid ${local < JUDGE ? C.accentSoft : `${v.color}88`}`,
                  background: local < JUDGE ? 'rgba(108,245,210,0.08)' : `${v.color}18`,
                }}
              >
                {local < JUDGE ? '这一代' : '下一代'}
              </div>
              <div style={{ fontSize: 21, color: C.dim, letterSpacing: 1 }}>
                周围{' '}
                <b style={{ color: v.color }}>
                  {Math.min(
                    phase.count,
                    Math.round(interpolate(local, [4, 24], [0, phase.count], { extrapolateRight: 'clamp' })),
                  )}
                </b>{' '}
                个活细胞
              </div>
            </div>

            <div
              style={{
                position: 'relative',
                width: BOARD,
                height: BOARD,
                padding: 10,
                margin: -10,
              }}
            >
              {/* 邻居连线：强调"只看这 8 个" */}
              {phase.neighbors.map(([nx, ny], i) => {
                const s = neighborIn(i);
                const x1 = STEP * 2 + PX / 2;
                const y1 = STEP * 2 + PX / 2;
                const x2 = nx * STEP + PX / 2;
                const y2 = ny * STEP + PX / 2;
                return (
                  <svg
                    key={`l${i}`}
                    style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
                    width={BOARD}
                    height={BOARD}
                  >
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x1 + (x2 - x1) * s}
                      y2={y1 + (y2 - y1) * s}
                      stroke="rgba(108,245,210,0.28)"
                      strokeWidth={1.5}
                      strokeDasharray="5 7"
                    />
                  </svg>
                );
              })}

              {Array.from({ length: 25 }).map((_, i) => {
                const x = i % 5;
                const y = Math.floor(i / 5);
                if (x === 2 && y === 2) return null;
                const ni = phase.neighbors.findIndex(([nx, ny]) => nx === x && ny === y);
                const isNeighbor = ni >= 0;
                const appear = isNeighbor ? neighborIn(ni) : 0;
                const age = Math.max(0, local - 4 - ni * 4);

                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: x * STEP,
                      top: y * STEP,
                      width: PX,
                      height: PX,
                      borderRadius: 14,
                      background: isNeighbor
                        ? `rgba(108,245,210,${0.3 + 0.1 * Math.sin(Math.max(0, age) / 8)})`
                        : 'rgba(255,255,255,0.035)',
                      border: `1px solid ${
                        isNeighbor ? 'rgba(108,245,210,0.55)' : 'rgba(120,200,220,0.12)'
                      }`,
                      transform: `scale(${isNeighbor ? 0.72 + 0.28 * appear : 1})`,
                      opacity: isNeighbor ? Math.min(1, 0.25 + appear) : 1,
                      boxShadow: isNeighbor && age < 10 ? `0 0 24px rgba(108,245,210,${0.5 * (1 - age / 10)})` : 'none',
                    }}
                  />
                );
              })}

              <CenterCell local={local} phase={phase} />
            </div>

            {/* 判定结果 */}
            <div
              style={{
                marginTop: 30,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                opacity: Math.max(0, judgeIn),
                transform: `translateY(${(1 - Math.max(0, judgeIn)) * 14}px)`,
              }}
            >
              <div
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 20,
                  background: `${v.color}1f`,
                  border: `2px solid ${v.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 40,
                  fontWeight: 800,
                  color: v.color,
                  boxShadow: `0 0 34px ${v.color}44`,
                }}
              >
                {v.glyph}
              </div>
              <div>
                <div style={{ fontSize: 38, fontWeight: 700, color: v.color, lineHeight: 1.1 }}>{v.title}</div>
                <div style={{ fontSize: 22, color: C.dim, marginTop: 6 }}>{v.note}</div>
              </div>
            </div>

            <div style={{ marginTop: 22, display: 'flex', gap: 18, opacity: Math.max(0, countIn) * 0.9 }}>
              {[
                { c: 'rgba(108,245,210,0.85)', t: '活细胞' },
                { c: 'rgba(255,255,255,0.08)', t: '空格子' },
                { c: v.color, t: '判定结果' },
              ].map((l) => (
                <div key={l.t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, color: C.dim }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: l.c, border: `1px solid ${C.line}` }} />
                  {l.t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>
      </Backdrop>
    </>
  );
};
