import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { Backdrop, Chip, Eyebrow, Heading, Rise } from '../components/ui';
import { C, FONT } from '../theme';

/** 开场：背景是一片真的演化汤，标题压在上面 */
export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = interpolate(frame, [0, 150], [1.16, 1.02]);
  const dim = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  const titleIn = spring({ frame: frame - 14, fps, config: { damping: 200, mass: 0.8 } });
  const subIn = spring({ frame: frame - 34, fps, config: { damping: 200, mass: 0.8 } });
  const lineIn = spring({ frame: frame - 58, fps, config: { damping: 200 } });

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: dim * 0.62 }}>
        <Img
          src={staticFile('bg-soup.png')}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale})`,
            filter: 'blur(1.5px) saturate(1.1)',
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(5,8,12,0.82), rgba(5,8,12,0.55) 45%, rgba(5,8,12,0.9))' }} />

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ opacity: titleIn, transform: `translateY(${(1 - titleIn) * 24}px)`, textAlign: 'center' }}>
          <Eyebrow>Conway&rsquo;s Game of Life · 1970</Eyebrow>
          <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: 2, lineHeight: 1, fontFamily: FONT }}>
            生命游戏
          </div>
        </div>

        <div
          style={{
            opacity: subIn,
            transform: `translateY(${(1 - subIn) * 20}px)`,
            marginTop: 34,
            fontSize: 42,
            color: C.text,
            letterSpacing: 6,
          }}
        >
          三条规则，五十年不熄的宇宙
        </div>

        <div style={{ opacity: lineIn, marginTop: 60, display: 'flex', gap: 14 }}>
          <Chip>零个玩家</Chip>
          <Chip>100 万个格子</Chip>
          <Chip>全是涌现出来的</Chip>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ── 规则演示：5×5 小方阵，一格格亮起来 ──────────────────────────────────
type Phase = {
  from: number;
  rule: string;
  count: string;
  verdict: 'die' | 'live' | 'born';
  /** 除中心格以外点亮的邻居坐标（5×5 网格里） */
  neighbors: [number, number][];
  centerAlive: boolean;
};

const PHASES: Phase[] = [
  {
    from: 0,
    rule: '邻居少于 2 —— 孤单而死',
    count: '1 个邻居',
    verdict: 'die',
    centerAlive: true,
    neighbors: [[1, 1]],
  },
  {
    from: 78,
    rule: '邻居是 2 或 3 —— 继续存活',
    count: '2 个邻居',
    verdict: 'live',
    centerAlive: true,
    neighbors: [
      [1, 1],
      [3, 1],
    ],
  },
  {
    from: 156,
    rule: '死格子周围正好 3 个 —— 诞生',
    count: '3 个邻居',
    verdict: 'born',
    centerAlive: false,
    neighbors: [
      [1, 1],
      [3, 1],
      [1, 3],
    ],
  },
  {
    from: 234,
    rule: '邻居超过 3 —— 拥挤而死',
    count: '4 个邻居',
    verdict: 'die',
    centerAlive: true,
    neighbors: [
      [1, 1],
      [3, 1],
      [1, 3],
      [3, 3],
    ],
  },
];

const RULES = [
  '邻居少于 2，孤单而死',
  '邻居是 2 或 3，继续存活',
  '死格子周围正好 3 个，就会诞生',
  '邻居超过 3，拥挤而死',
];

export const RulesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = [...PHASES].reverse().find((p) => frame >= p.from) ?? PHASES[0];
  const local = frame - phase.from;
  const phaseIndex = PHASES.indexOf(phase);

  const px = 74;
  const gap = 12;
  const step = px + gap;
  const boardW = step * 5 - gap;

  const verdictColor =
    phase.verdict === 'die' ? '#ff8a8a' : phase.verdict === 'born' ? C.accent : '#9ef7e0';
  const verdictText =
    phase.verdict === 'die' ? '这一格会死' : phase.verdict === 'born' ? '这一格会出生' : '这一格活下去';

  const verdictIn = spring({ frame: local - 20, fps, config: { damping: 200 } });
  const centerPulse = 0.5 + 0.5 * Math.sin(local / 6);

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '110px 120px' }}>
        <div style={{ display: 'flex', gap: 80 }}>
          {/* 左：规则表 */}
          <div style={{ width: 860, paddingTop: 40 }}>
            <Rise delay={0}>
              <Eyebrow>它是怎么运转的</Eyebrow>
              <Heading size={60}>
                每个格子只有生或死，<br />命运只看身边的 8 个邻居
              </Heading>
            </Rise>

            <div style={{ marginTop: 54, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {RULES.map((text, i) => {
                const active = i === phaseIndex;
                const s = spring({ frame: frame - 24 - i * 8, fps, config: { damping: 200 } });
                return (
                  <div
                    key={text}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      opacity: s * (active ? 1 : 0.42),
                      transform: `translateX(${(1 - s) * -18}px)`,
                      padding: '14px 18px',
                      borderRadius: 14,
                      border: `1px solid ${active ? 'rgba(108,245,210,0.45)' : 'transparent'}`,
                      background: active ? 'rgba(108,245,210,0.09)' : 'transparent',
                      transition: 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: active ? C.accent : C.dim,
                        boxShadow: active ? `0 0 14px ${C.accent}` : 'none',
                      }}
                    />
                    <div style={{ fontSize: 27, color: active ? C.text : C.dim }}>{text}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 46, fontSize: 21, color: C.dim, lineHeight: 1.7, maxWidth: 700 }}>
              没有总设计师，也没有随机数。所有秩序都是这四条规则一代代筛出来的。
            </div>
          </div>

          {/* 右：5×5 方阵 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 20 }}>
            <div style={{ fontSize: 22, color: C.dim, marginBottom: 16, letterSpacing: 2 }}>中心格的 8 个邻居</div>
            <div style={{ position: 'relative', width: boardW, height: boardW }}>
              {Array.from({ length: 25 }).map((_, i) => {
                const x = i % 5;
                const y = Math.floor(i / 5);
                const isCenter = x === 2 && y === 2;
                const isNeighbor = phase.neighbors.some(([nx, ny]) => nx === x && ny === y);
                const appear = isNeighbor ? spring({ frame: local - 4 - i * 0.6, fps, config: { damping: 200 } }) : 0;
                const alive = isCenter ? phase.centerAlive : isNeighbor;

                let bg = 'rgba(255,255,255,0.06)';
                if (alive && isCenter) bg = `rgba(108,245,210,${0.6 + 0.35 * centerPulse})`;
                else if (alive) bg = 'rgba(108,245,210,0.34)';

                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: x * step,
                      top: y * step,
                      width: px,
                      height: px,
                      borderRadius: 12,
                      background: bg,
                      border: `1px solid ${
                        isNeighbor && appear > 0.3
                          ? 'rgba(108,245,210,0.5)'
                          : isCenter
                            ? 'rgba(255,255,255,0.18)'
                            : C.line
                      }`,
                      opacity: isNeighbor ? 0.35 + 0.65 * appear : 1,
                      boxShadow: alive && isCenter ? `0 0 ${18 + 18 * centerPulse}px rgba(108,245,210,0.45)` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      color: 'rgba(5,8,12,0.85)',
                      fontWeight: 700,
                    }}
                  >
                    {isCenter ? '?' : ''}
                  </div>
                );
              })}
            </div>

            {/* 判定 */}
            <div
              style={{
                marginTop: 30,
                opacity: verdictIn,
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <span style={{ fontSize: 30, color: verdictColor, fontWeight: 700 }}>{phase.count}</span>
              <span style={{ fontSize: 30, color: C.dim }}>→</span>
              <span style={{ fontSize: 30, color: verdictColor, fontWeight: 700 }}>{verdictText}</span>
            </div>

            <div
              style={{
                marginTop: 22,
                fontSize: 22,
                color: C.dim,
                textAlign: 'center',
                maxWidth: 470,
                lineHeight: 1.6,
              }}
            >
              亮起的格子是活细胞，中间的「?」是这一代要判定的那一格。
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
