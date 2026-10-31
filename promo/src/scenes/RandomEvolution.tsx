import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT } from '../theme';

// 裁切关键帧：整屏录屏太“平”，这里用镜头推拉把操作切成几个特写
// 裁切要“先到位，再点”，否则观众看不到点击的那一刻。
// 时间按录制脚本打的动作点换算（片段以 1.15 倍速播放）：
// 随机 2.09s→54 帧、确认 3.72s→97、不限速 6.49s→169、播放 8.02s→209。
const KEYS = [
  { f: 0, z: 1.55, x: 900, y: 500 },
  { f: 30, z: 1.55, x: 900, y: 500 },
  { f: 46, z: 2.6, x: 215, y: 1052 },
  { f: 60, z: 2.6, x: 215, y: 1052 },
  { f: 80, z: 2.15, x: 960, y: 540 },
  { f: 125, z: 2.15, x: 960, y: 540 },
  { f: 140, z: 1.28, x: 900, y: 500 },
  { f: 160, z: 1.28, x: 900, y: 500 },
  { f: 168, z: 2.4, x: 951, y: 1052 },
  { f: 182, z: 2.4, x: 951, y: 1052 },
  { f: 202, z: 2.2, x: 76, y: 1052 },
  { f: 215, z: 2.2, x: 76, y: 1052 },
  { f: 230, z: 1.28, x: 900, y: 500 },
  { f: 300, z: 1.28, x: 900, y: 500 },
  { f: 420, z: 1.22, x: 900, y: 500 },
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export const RandomEvolutionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const frames = KEYS.map((k) => k.f);
  const z = interpolate(frame, frames, KEYS.map((k) => k.z), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const x = interpolate(frame, frames, KEYS.map((k) => k.x), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(frame, frames, KEYS.map((k) => k.y), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // 取景不能越过视频边缘，否则会露出黑边
  const tx = clamp(960 - x * z, 1920 - 1920 * z, 0);
  const ty = clamp(540 - y * z, 1080 - 1080 * z, 0);

  const t1 = interpolate(frame, [14, 32, 58, 70], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const t2 = interpolate(frame, [236, 262], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, fontFamily: FONT, overflow: 'hidden' }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <OffthreadVideo
          src={staticFile('clip-random.mp4')}
          muted
          playbackRate={1.15}
          style={{
            width: 1920,
            height: 1080,
            transform: `translate(${tx}px, ${ty}px) scale(${z})`,
            transformOrigin: '0 0',
            filter: 'brightness(1.06) contrast(1.03)',
          }}
        />
      </AbsoluteFill>

      {/* 压暗上下，文字才站得住 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(5,8,12,0.72) 0%, rgba(5,8,12,0.05) 26%, rgba(5,8,12,0.05) 54%, rgba(5,8,12,0.9) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(120% 90% at 50% 50%, rgba(5,8,12,0) 50%, rgba(5,8,12,0.55) 100%)',
        }}
      />

      <AbsoluteFill style={{ padding: '84px 96px', justifyContent: 'flex-start' }}>
        <div
          style={{
            opacity: t1,
            transform: `translateY(${(1 - t1) * 14}px)`,
            textShadow: '0 2px 26px rgba(5,8,12,0.98), 0 0 10px rgba(5,8,12,0.9)',
          }}
        >
          <div style={{ fontSize: 17, letterSpacing: 8, color: C.accent }}>退一步</div>
          <div style={{ marginTop: 14, fontSize: 44, fontWeight: 700, letterSpacing: 2 }}>
            如果你只想静静地看着他们演化
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ padding: '0 96px 84px', justifyContent: 'flex-end', alignItems: 'center' }}>
        <div
          style={{
            opacity: t2,
            transform: `translateY(${(1 - t2) * 16}px)`,
            textAlign: 'center',
            textShadow: '0 2px 26px rgba(5,8,12,0.98), 0 0 10px rgba(5,8,12,0.9)',
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: 3 }}>那不妨掷出骰子，</div>
          <div style={{ marginTop: 8, fontSize: 40, color: C.accent, letterSpacing: 4 }}>把一切交给时间</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
