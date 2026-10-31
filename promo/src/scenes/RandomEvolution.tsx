import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT } from '../theme';

/**
 * 随机演化（v9）
 * 三句话 + 一颗骰子 + 一圈光晕；随后切进回环模式的连续拉远镜头：
 * 从细胞特写一直拉到整张世界 + 环面重复区域，最后接结尾。
 * 不再出现任何界面操作录制。
 */

const GOLD = '#ffd9a0';
const OFFWHITE = '#f2ede2';

const PIPS = [
  [30, 30],
  [70, 30],
  [50, 50],
  [30, 70],
  [70, 70],
];

const STARS = Array.from({ length: 30 }, (_, i) => ({
  x: (i * 137 + 61) % 1920,
  y: (i * 241 + 37) % 1080,
  r: i % 7 === 0 ? 2.2 : 1.2,
  warm: i % 5 === 0,
  ph: i * 0.7,
}));

const diePips = (
  <>
    {PIPS.map(([x, y], i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: 13,
          height: 13,
          marginLeft: -6.5,
          marginTop: -6.5,
          borderRadius: 99,
          background: GOLD,
          boxShadow: `0 0 14px ${GOLD}aa`,
        }}
      />
    ))}
  </>
);

export const RandomEvolutionScene: React.FC = () => {
  const frame = useCurrentFrame();

  // 三句话
  const line1 = interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const line2 = interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const line3 = interpolate(frame, [70, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const poemOut = interpolate(frame, [118, 145], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dieIn = interpolate(frame, [0, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dieRoll = interpolate(frame, [40, 78], [0, 200], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dieToss = Math.sin(Math.min(1, Math.max(0, (frame - 40) / 38)) * Math.PI) * -36;
  const ringRot = frame * 0.18;
  const clipIn = interpolate(frame, [126, 152], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#04070a', color: OFFWHITE, fontFamily: FONT, overflow: 'hidden' }}>
      {/* 神性的底光：金色光晕 + 星点 + 一圈轨道 */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(42% 46% at 50% 30%, rgba(255,217,160,0.12) 0%, rgba(255,217,160,0.03) 42%, rgba(4,7,10,0) 72%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(255,217,160,0.035) 0%, rgba(4,7,10,0) 22%, rgba(4,7,10,0) 76%, rgba(4,7,10,0.82) 100%)',
        }}
      />
      {STARS.map((s, i) => {
        const tw = 0.35 + 0.65 * ((Math.sin(frame / 18 + s.ph) + 1) / 2);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: s.x,
              top: s.y,
              width: s.r,
              height: s.r,
              borderRadius: 99,
              background: s.warm ? GOLD : C.accent,
              opacity: tw * 0.55,
              boxShadow: `0 0 8px ${s.warm ? 'rgba(255,217,160,0.5)' : 'rgba(108,245,210,0.45)'}`,
            }}
          />
        );
      })}

      {/* 骰子与光环 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 168,
          height: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: dieIn * poemOut,
          zIndex: 5,
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: '50%',
            border: `1px dashed rgba(255,217,160,0.22)`,
            transform: `rotate(${ringRot}deg)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 238,
            height: 238,
            borderRadius: '50%',
            border: `1px solid rgba(108,245,210,0.13)`,
            transform: `rotate(${-ringRot * 0.6}deg)`,
          }}
        />
        <div
          style={{
            position: 'relative',
            width: 100,
            height: 100,
            borderRadius: 24,
            border: `1.5px solid rgba(255,217,160,0.85)`,
            background: 'linear-gradient(145deg, rgba(24,23,22,0.96), rgba(8,10,13,0.96))',
            boxShadow: `0 0 70px rgba(255,217,160,0.22), inset 0 0 22px rgba(255,217,160,0.08)`,
            transform: `translateY(${dieToss}px) rotate(${dieRoll}deg)`,
          }}
        >
          {diePips}
        </div>
      </div>

      {/* 三句话：一句一句出现，整首停下来 */}
      <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 5 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 470,
            textAlign: 'center',
            opacity: poemOut,
            textShadow: '0 2px 34px rgba(4,7,10,0.98), 0 0 18px rgba(4,7,10,0.9)',
          }}
        >
          <div
            style={{
              opacity: line1,
              transform: `translateY(${(1 - line1) * 14}px)`,
              fontSize: 52,
              fontWeight: 300,
              letterSpacing: 9,
              color: OFFWHITE,
            }}
          >
            如果你只想静静的看着混沌演化
          </div>
          <div
            style={{
              marginTop: 22,
              opacity: line2,
              transform: `translateY(${(1 - line2) * 14}px)`,
              fontSize: 52,
              fontWeight: 300,
              letterSpacing: 9,
              color: OFFWHITE,
            }}
          >
            那不妨投掷一次骰子
          </div>
          <div
            style={{
              marginTop: 22,
              opacity: line3,
              transform: `translateY(${(1 - line3) * 14}px)`,
              fontSize: 56,
              fontWeight: 400,
              letterSpacing: 10,
              color: GOLD,
            }}
          >
            然后把一切交给时间
          </div>
          <div
            style={{
              width: 220,
              height: 1,
              margin: '30px auto 0',
              background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
              opacity: line3 * 0.6,
            }}
          />
        </div>
      </AbsoluteFill>

      {/* 回环拉远：从细胞特写一直拉到整张世界 + 环面重复 */}
      <Sequence from={126} durationInFrames={294}>
        <AbsoluteFill style={{ opacity: clipIn }}>
          <OffthreadVideo
            src={staticFile('clip-random-loop.mp4')}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <AbsoluteFill
            style={{
              background:
                'radial-gradient(120% 90% at 50% 50%, rgba(4,7,10,0) 52%, rgba(4,7,10,0.58) 100%)',
            }}
          />
          <AbsoluteFill
            style={{
              background:
                'linear-gradient(180deg, rgba(4,7,10,0.78) 0%, rgba(4,7,10,0.06) 26%, rgba(4,7,10,0.04) 62%, rgba(4,7,10,0.7) 100%)',
            }}
          />
        </AbsoluteFill>
      </Sequence>

      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 84,
          zIndex: 5,
          fontSize: 16,
          letterSpacing: 10,
          color: GOLD,
          opacity: 0.7 * poemOut,
        }}
      >
        随机演化
      </div>
    </AbsoluteFill>
  );
};
