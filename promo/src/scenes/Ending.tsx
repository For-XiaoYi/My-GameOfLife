import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Backdrop, Chip, Eyebrow, Heading, Rise } from '../components/ui';
import { C } from '../theme';

const STEPS = [
  { file: 'shot-gen-200.png', gen: '第 200 代', note: '枪已经吐出好几艘滑翔机' },
  { file: 'shot-gen-120.png', gen: '第 120 代', note: '往回拖，一刻都不会少' },
  { file: 'shot-gen-40.png', gen: '第 40 代', note: '刚才没看清的那一瞬，还在' },
] as const;

const SEG = 78;

export const TimeTravelScene: React.FC = () => {
  const frame = useCurrentFrame();
  const idx = Math.min(STEPS.length - 1, Math.floor(frame / SEG));
  const cur = STEPS[idx];

  // 进度条：随时间往回走
  const progress = interpolate(frame, [0, SEG * STEPS.length], [0.66, 0.16], { extrapolateRight: 'clamp' });

  return (
    <Backdrop grid={false}>
      {/* 三层截图交叉淡入 */}
      {STEPS.map((s, i) => {
        const start = i * SEG;
        const o = interpolate(
          frame,
          [start - 10, start + 6, start + SEG - 8, start + SEG + 6],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
        const zoom = interpolate(frame, [start, start + SEG], [1.06, 1.13]);
        return (
          <AbsoluteFill key={s.file} style={{ opacity: o }}>
            <Img
              src={staticFile(s.file)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                transform: `scale(${zoom})`,
                filter: 'brightness(1.1)',
              }}
            />
          </AbsoluteFill>
        );
      })}

      {/* 左侧压暗，保证标题可读 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to right, rgba(5,8,12,0.86) 0%, rgba(5,8,12,0.54) 30%, rgba(5,8,12,0.14) 58%, rgba(5,8,12,0.02) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,8,12,0.8) 0%, rgba(5,8,12,0.05) 20%, rgba(5,8,12,0.05) 58%, rgba(5,8,12,0.9) 100%)',
        }}
      />

      <AbsoluteFill style={{ padding: '96px 110px', justifyContent: 'space-between' }}>
        <Rise delay={4}>
          <Eyebrow>时间回溯</Eyebrow>
          <Heading size={60}>
            生命游戏算不回去，<br />所以我们把每一步都记了下来
          </Heading>
        </Rise>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 22 }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: C.accent }}>{cur.gen}</div>
            <div style={{ fontSize: 24, color: C.text }}>{cur.note}</div>
          </div>

          {/* 时间轴 */}
          <div style={{ position: 'relative', height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.12)' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: 10,
                width: `${progress * 100}%`,
                borderRadius: 999,
                background: `linear-gradient(to right, rgba(108,245,210,0.25), ${C.accent})`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${progress * 100}%`,
                top: '50%',
                width: 26,
                height: 26,
                marginLeft: -13,
                marginTop: -13,
                borderRadius: 999,
                background: C.accent,
                boxShadow: `0 0 24px ${C.accentSoft}`,
              }}
            />
            {STEPS.map((s, i) => (
              <div
                key={s.gen}
                style={{
                  position: 'absolute',
                  left: `${(0.66 - i * 0.24) * 100}%`,
                  top: 26,
                  transform: 'translateX(-50%)',
                  fontSize: 17,
                  color: C.dim,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.gen}
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const inA = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const outA = interpolate(frame, [140, 165], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const settle = interpolate(frame, [0, 40], [1.06, 1], { extrapolateRight: 'clamp' });

  return (
    <Backdrop>
      <AbsoluteFill
        style={{
          opacity: inA * outA,
          justifyContent: 'center',
          alignItems: 'center',
          transform: `scale(${settle})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <GliderMark />
          <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: 4 }}>生命游戏</div>
        </div>

        <div style={{ marginTop: 26, fontSize: 32, color: C.text, letterSpacing: 4 }}>
          三条规则，一个可以玩很久的宇宙
        </div>

        <div style={{ marginTop: 54, display: 'flex', gap: 14 }}>
          <Chip>网页即开</Chip>
          <Chip>单文件带走</Chip>
          <Chip>手机也能摸</Chip>
        </div>

        <div
          style={{
            marginTop: 66,
            fontSize: 24,
            color: C.dim,
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: '12px 26px',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          for-xiaoyi.github.io/My-GameOfLife
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** 用 5×5 的格子拼一个滑翔机当 logo */
const MARK = [
  [0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0],
  [1, 1, 1, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
];

const GliderMark: React.FC = () => {
  const px = 26;
  const gap = 6;
  return (
    <div style={{ position: 'relative', width: 5 * (px + gap), height: 5 * (px + gap) }}>
      {MARK.flatMap((row, y) =>
        row.map((v, x) =>
          v ? (
            <div
              key={`${x}-${y}`}
              style={{
                position: 'absolute',
                left: x * (px + gap),
                top: y * (px + gap),
                width: px,
                height: px,
                borderRadius: 3,
                background: C.accent,
                boxShadow: `0 0 16px ${C.accentSoft}`,
              }}
            />
          ) : null,
        ),
      )}
    </div>
  );
};
