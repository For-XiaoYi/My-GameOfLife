import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop, Chip } from '../components/ui';
import { C } from '../theme';

/** 用 5×5 的格子拼一个滑翔机 */
const MARK = [
  [0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0],
  [1, 1, 1, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
];
const CELLS = [
  { x: 1, y: 0 },
  { x: 2, y: 1 },
  { x: 0, y: 2 },
  { x: 1, y: 2 },
  { x: 2, y: 2 },
];

const GliderMark: React.FC<{
  px: number;
  gap: number;
  left: number;
  top: number;
  reveal?: (i: number) => number;
  glow?: number;
}> = ({ px, gap, left, top, reveal, glow = 0.5 }) => {
  const w = 5 * (px + gap) - gap;
  const liveW = 3 * (px + gap) - gap;
  return (
    <div style={{ position: 'absolute', left, top, width: w, height: w }}>
      <div
        style={{
          position: 'absolute',
          left: -px * 0.4,
          top: -px * 0.4,
          width: liveW + px * 0.8,
          height: liveW + px * 0.8,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(108,245,210,${0.13 * glow}) 0%, rgba(108,245,210,0) 68%)`,
        }}
      />
      {CELLS.map((c, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: c.x * (px + gap),
            top: c.y * (px + gap),
            width: px,
            height: px,
            borderRadius: Math.max(3, px * 0.1),
            background: C.accent,
            opacity: reveal ? reveal(i) : 1,
            boxShadow: `0 0 ${Math.max(10, px * 0.35)}px rgba(108,245,210,0.55)`,
          }}
        />
      ))}
    </div>
  );
};

/** GitHub 的 Octocat 剪影（内联 SVG，不引外链） */
const GithubMark: React.FC<{ size: number; color?: string }> = ({ size, color = C.text }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill={color}
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    />
  </svg>
);

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const t = interpolate(frame, [46, 96], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  const bigPx = 140;
  const bigGap = 14;
  // 居中要看“活的 3×3 滑翔机”，不是 5×5 的空画布
  const bigLive = 3 * (bigPx + bigGap) - bigGap;
  const bigLeft = 960 - bigLive / 2;
  const bigTop = 540 - bigLive / 2;

  const px = bigPx + (26 - bigPx) * t;
  const gap = bigGap + (6 - bigGap) * t;
  const finalLeft = 682;
  const finalTop = 412;
  const left = bigLeft + (finalLeft - bigLeft) * t;
  const top = bigTop + (finalTop - bigTop) * t;
  const liveW = 3 * (px + gap) - gap;

  const titleIn = interpolate(frame, [64, 98], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const subIn = interpolate(frame, [96, 122], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const chipsIn = interpolate(frame, [112, 138], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ghIn = interpolate(frame, [126, 152], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const siteIn = interpolate(frame, [142, 168], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const reveal = (i: number) =>
    interpolate(frame, [4 + i * 5, 12 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const glow = interpolate(frame, [30, 60], [0.8, 1.0]);

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: appear }}>
        {/* 大图标先单独出现，再缩到字标旁边 */}
        <GliderMark px={px} gap={gap} left={left} top={top} reveal={(i) => (frame < 46 ? reveal(i) : 1)} glow={glow} />

        {/* 字标：等滑翔机落位后淡入 */}
        <div
          style={{
            position: 'absolute',
            left: left + liveW + 26,
            top: top + (liveW - 119) / 2,
            fontSize: 108,
            fontWeight: 800,
            letterSpacing: 4,
            lineHeight: 1.1,
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 12}px)`,
          }}
        >
          生命游戏
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 556,
            textAlign: 'center',
            fontSize: 32,
            letterSpacing: 4,
            color: C.text,
            opacity: subIn,
            transform: `translateY(${(1 - subIn) * 12}px)`,
          }}
        >
          四条规则，一个可以玩很久的宇宙
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 622,
            display: 'flex',
            justifyContent: 'center',
            gap: 14,
            opacity: chipsIn,
          }}
        >
          <Chip>网页即开</Chip>
          <Chip>单文件带走</Chip>
          <Chip>手机也能摸</Chip>
        </div>

        {/* GitHub：图标 + 仓库地址 + 开源说明 */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 694,
            display: 'flex',
            justifyContent: 'center',
            opacity: ghIn,
            transform: `translateY(${(1 - ghIn) * 12}px)`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '14px 26px',
              borderRadius: 999,
              border: `1px solid ${C.accentSoft}`,
              background: 'rgba(108,245,210,0.06)',
              boxShadow: '0 0 60px rgba(108,245,210,0.10)',
            }}
          >
            <GithubMark size={34} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: 1 }}>
                github.com/For-XiaoYi/My-GameOfLife
              </div>
              <div style={{ marginTop: 2, fontSize: 14, color: C.dim, letterSpacing: 3 }}>
                开源 · 欢迎 Star
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 784,
            display: 'flex',
            justifyContent: 'center',
            opacity: siteIn,
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: C.dim,
              border: `1px solid ${C.line}`,
              borderRadius: 999,
              padding: '8px 22px',
              letterSpacing: 2,
            }}
          >
            for-xiaoyi.github.io/My-GameOfLife
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
