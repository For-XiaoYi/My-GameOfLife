import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, Chip, Eyebrow } from '../components/ui';
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
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,8,12,0.82), rgba(5,8,12,0.55) 45%, rgba(5,8,12,0.9))',
        }}
      />

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 24}px)`,
            textAlign: 'center',
          }}
        >
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
          四条规则，半个多世纪不熄的宇宙
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
