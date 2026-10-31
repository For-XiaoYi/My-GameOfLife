import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { C, FONT } from '../theme';

/**
 * 随机演化（v8 重做）
 * 黑底 → 标题 → 点击「随机」的小裁切 → 确认弹窗 → 淡入满屏细胞慢慢演化。
 * 动作时刻来自 record-clips.mjs 打印的 marks：
 * random 2.085s / confirm 3.722s；录屏 30fps。
 */

const CLIP = 'clip-random.mp4';
const CARD_W = 760;
const CARD_H = 430;

const CropCard: React.FC<{
  startFrom: number;
  targetX: number;
  targetY: number;
  zoom: number;
  label: string;
  clickFrame: number;
  ringX: number;
  ringY: number;
}> = ({ startFrom, targetX, targetY, zoom, label, clickFrame, ringX, ringY }) => {
  const frame = useCurrentFrame();
  const local = frame;
  const appear = interpolate(local, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring = interpolate(local, [clickFrame, clickFrame + 3, clickFrame + 14], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ringScale = interpolate(local, [clickFrame, clickFrame + 14], [0.6, 1.7], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const tx = CARD_W / 2 - targetX * zoom;
  const ty = (CARD_H - 54) / 2 - targetY * zoom;

  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 18,
        border: `1px solid ${C.accentSoft}`,
        background: 'rgba(8,13,19,0.96)',
        boxShadow: '0 26px 90px rgba(0,0,0,0.55), 0 0 60px rgba(108,245,210,0.10)',
        opacity: appear,
        transform: `translateY(${(1 - appear) * 18}px)`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 54,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 99, background: C.accent, boxShadow: `0 0 10px ${C.accent}` }} />
        <div style={{ fontSize: 17, color: C.text, letterSpacing: 1 }}>{label}</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: C.dim, letterSpacing: 2 }}>REAL UI · 实录</div>
      </div>

      <div style={{ position: 'relative', width: CARD_W, height: CARD_H - 54, overflow: 'hidden', background: '#05080c' }}>
        <OffthreadVideo
          src={staticFile(CLIP)}
          muted
          startFrom={startFrom}
          style={{
            position: 'absolute',
            width: 1920,
            height: 1080,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: '0 0',
            filter: 'brightness(1.12) contrast(1.03)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: ringX,
            top: ringY,
            width: 80,
            height: 80,
            marginLeft: -40,
            marginTop: -40,
            borderRadius: '50%',
            border: `2px solid ${C.accent}`,
            boxShadow: `0 0 24px ${C.accentSoft}`,
            opacity: ring,
            transform: `scale(${ringScale})`,
          }}
        />
      </div>
    </div>
  );
};

export const RandomEvolutionScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleIn = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleOut = interpolate(frame, [44, 56], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const line1 = interpolate(frame, [56, 66, 96, 106], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const line2 = interpolate(frame, [100, 112, 160, 172], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fullIn = interpolate(frame, [150, 180], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cardOut = interpolate(frame, [150, 160], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, fontFamily: FONT, overflow: 'hidden' }}>
      {/* 标题：黑底，先只给标题 */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: titleIn * titleOut }}>
        <div style={{ fontSize: 17, letterSpacing: 10, color: C.accent }}>组件 · 随机</div>
        <div style={{ marginTop: 22, fontSize: 88, fontWeight: 800, letterSpacing: 6, color: '#eafff8' }}>随机演化</div>
        <div style={{ marginTop: 18, fontSize: 24, color: C.dim, letterSpacing: 2 }}>不设计，也是一种设计</div>
      </AbsoluteFill>

      {/* 两个动作特写 */}
      <AbsoluteFill style={{ opacity: cardOut }}>
        <Sequence from={56} durationInFrames={16}>
          <div style={{ position: 'absolute', left: 1010, top: 300 }}>
            <CropCard
              startFrom={56}
              targetX={215}
              targetY={1052}
              zoom={2.0}
              label="点击「随机」"
              clickFrame={6}
              ringX={CARD_W / 2}
              ringY={(CARD_H - 54) / 2}
            />
          </div>
        </Sequence>
        <Sequence from={72} durationInFrames={88}>
          <div style={{ position: 'absolute', left: 1010, top: 300 }}>
            <CropCard
              startFrom={72}
              targetX={960}
              targetY={540}
              zoom={1.45}
              label="确认覆盖当前图案"
              clickFrame={40}
              ringX={CARD_W / 2 + (1150 - 960) * 1.45}
              ringY={(CARD_H - 54) / 2 + (550 - 540) * 1.45}
            />
          </div>
        </Sequence>
      </AbsoluteFill>

      {/* 两句话 */}
      <AbsoluteFill style={{ padding: '0 120px', justifyContent: 'center' }}>
        <div style={{ width: 760, position: 'relative', height: 260 }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              opacity: line1,
              transform: `translateY(${(1 - line1) * 16}px)`,
              textShadow: '0 2px 26px rgba(5,8,12,0.98)',
            }}
          >
            <div style={{ fontSize: 17, letterSpacing: 8, color: C.accent }}>退一步</div>
            <div style={{ marginTop: 16, fontSize: 56, fontWeight: 700, letterSpacing: 2, color: '#eafff8' }}>那不妨掷出骰子</div>
            <div style={{ marginTop: 12, fontSize: 22, color: C.dim }}>把选择，交给随机数。</div>
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              opacity: line2,
              transform: `translateY(${(1 - line2) * 16}px)`,
              textShadow: '0 2px 26px rgba(5,8,12,0.98)',
            }}
          >
            <div style={{ fontSize: 17, letterSpacing: 8, color: C.accent }}>接下来</div>
            <div style={{ marginTop: 16, fontSize: 56, fontWeight: 700, letterSpacing: 2, color: '#eafff8' }}>然后把一切交给时间</div>
            <div style={{ marginTop: 12, fontSize: 22, color: C.dim }}>这一次，不预设结局。</div>
          </div>
        </div>
      </AbsoluteFill>

      {/* 满屏细胞：裁掉顶部工具栏、右侧图案库和底部播放条 */}
      <AbsoluteFill style={{ opacity: fullIn, background: '#05080c' }}>
        <OffthreadVideo
          src={staticFile(CLIP)}
          muted
          startFrom={168}
          playbackRate={0.75}
          style={{
            position: 'absolute',
            width: 1920,
            height: 1080,
            transform: 'translate(-73px, -63px) scale(1.207)',
            transformOrigin: '0 0',
            filter: 'brightness(1.08) contrast(1.04)',
          }}
        />
        <AbsoluteFill
          style={{
            background:
              'radial-gradient(110% 80% at 50% 50%, rgba(5,8,12,0) 55%, rgba(5,8,12,0.55) 100%)',
          }}
        />
      </AbsoluteFill>

      {/* 点击声：和两次点击同步 */}
      <Sequence from={62} durationInFrames={12}>
        <Audio src={staticFile('sfx/click.wav')} volume={0.65} />
      </Sequence>
      <Sequence from={112} durationInFrames={12}>
        <Audio src={staticFile('sfx/click.wav')} volume={0.7} />
      </Sequence>
    </AbsoluteFill>
  );
};
