import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { LifeGrid } from '../components/LifeGrid';
import { Backdrop, Eyebrow, Heading, Rise } from '../components/ui';
import { C, FONT } from '../theme';
import { framesOf, getPattern, padBitmap, placeBitmap } from '../lib/life';

/** 三个图案并排：滑翔机 / 脉冲星 / 高斯帕滑翔机枪 */
const CARDS = [
  {
    id: 'glider',
    tag: '飞船',
    desc: '每 4 代整体斜移一格，永不消散',
    px: 30,
    gap: 6,
    gps: 0.25,
    gens: 16,
    width: 400,
    board: (bm: ReturnType<typeof getPattern>) => padBitmap(bm, 2),
  },
  {
    id: 'pulsar',
    tag: '振荡子',
    desc: '13×13 的节拍器，三步一个来回',
    px: 16,
    gap: 3,
    gps: 0.2,
    gens: 12,
    width: 400,
    board: (bm: ReturnType<typeof getPattern>) => padBitmap(bm, 1),
  },
  {
    id: 'gosperglidergun',
    tag: '枪',
    desc: '每 30 代吐出一艘滑翔机，能一直造下去',
    px: 12,
    gap: 2,
    gps: 0.3,
    gens: 96,
    width: 700,
    board: (bm: ReturnType<typeof getPattern>) => placeBitmap(bm, 46, 30, 2, 2),
  },
] as const;

export const PatternsScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '104px 112px' }}>
        <Rise delay={0}>
          <Eyebrow>涌现</Eyebrow>
          <Heading>给它一个初始形状，它就开始自己活着</Heading>
        </Rise>

        <div style={{ display: 'flex', gap: 34, marginTop: 62, alignItems: 'flex-start' }}>
          {CARDS.map((card, i) => {
            const pat = getPattern(card.id);
            const bm = card.board(pat);
            const frames = framesOf(card.id + '-p', bm, card.gens);
            const gi = Math.floor(frame * card.gps) % frames.length;
            const appear = interpolate(frame, [i * 18, i * 18 + 20], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });

            return (
              <div
                key={card.id}
                style={{
                  opacity: appear,
                  transform: `translateY(${(1 - appear) * 28}px)`,
                  width: card.width,
                  padding: 26,
                  borderRadius: 20,
                  border: `1px solid ${C.line}`,
                  background: 'rgba(10,16,23,0.72)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                  <div style={{ fontSize: 34, fontWeight: 700 }}>{pat.name}</div>
                  <div
                    style={{
                      fontSize: 18,
                      color: C.accent,
                      border: `1px solid ${C.accentSoft}`,
                      borderRadius: 999,
                      padding: '3px 12px',
                    }}
                  >
                    {card.tag}
                  </div>
                </div>

                <div
                  style={{
                    height: 420,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 14,
                    background: 'rgba(5,10,14,0.75)',
                    overflow: 'hidden',
                  }}
                >
                  <LifeGrid frames={frames} gi={gi} px={card.px} gap={card.gap} radius={i === 2 ? 2 : 3} showGrid />
                </div>

                <div style={{ fontSize: 21, color: C.dim, lineHeight: 1.6 }}>{card.desc}</div>
              </div>
            );
          })}
        </div>

        <Rise delay={54} style={{ marginTop: 46 }}>
          <div style={{ fontSize: 24, color: C.dim }}>
            这些都不是程序里写死的动画 —— 每一格只知道自己周围有几个邻居。
          </div>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

/**
 * 功能演示：三段真实界面操作录像（scripts/record-promo.mjs 录制），
 * 不再是静态截图 —— 光标移动、点选、面板弹出都是真的。
 */
const CLIPS = [
  {
    file: 'clip-pan.mp4',
    eyebrow: '一百万格的画布',
    title: '拖拽、缩放，视线想去哪儿就去哪儿',
    desc: '1024×1024 的环形世界，滚轮缩放、拖拽平移，一千万格也不掉帧',
    rate: 1.15,
    startFrom: 0,
  },
  {
    file: 'clip-library.mp4',
    eyebrow: '图案库',
    title: '选中、预览、一点就摆上去',
    desc: '二十种预设按类别排好，摆之前先看幽灵预览，落下去就能自己跑',
    rate: 1.25,
    startFrom: 6,
  },
  {
    file: 'clip-snapshot.mp4',
    eyebrow: '时刻 · 存档',
    title: '把当前这一代，收进库里',
    desc: '一键存成快照，随时载入；也可以把一段演化录成可回放的片段',
    rate: 1.25,
    startFrom: 8,
  },
] as const;

const SEG = 180;

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const idx = Math.min(CLIPS.length - 1, Math.floor(frame / SEG));
  const local = frame - idx * SEG;
  const clip = CLIPS[idx];

  const fadeIn = interpolate(local, [0, 11], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(local, [SEG - 11, SEG], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);
  const textIn = spring({ frame: local - 5, fps, config: { damping: 200, mass: 0.7 } });

  return (
    <AbsoluteFill style={{ background: '#05080c', color: C.text, fontFamily: FONT }}>
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo
          src={staticFile(clip.file)}
          muted
          startFrom={clip.startFrom}
          playbackRate={clip.rate}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(1.18) contrast(1.05) saturate(1.06)',
          }}
        />
      </AbsoluteFill>

      {/* 顶部 + 左侧压暗：文字可读，同时不挡住画面中央的弹窗 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(5,8,12,0.96) 0%, rgba(5,8,12,0.82) 16%, rgba(5,8,12,0.34) 30%, rgba(5,8,12,0) 42%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, rgba(5,8,12,0.92) 0%, rgba(5,8,12,0.66) 16%, rgba(5,8,12,0.18) 30%, rgba(5,8,12,0) 40%)',
        }}
      />
      <AbsoluteFill
        style={{
          background: 'linear-gradient(0deg, rgba(5,8,12,0.86) 0%, rgba(5,8,12,0) 24%)',
        }}
      />

      <AbsoluteFill style={{ padding: '92px 104px', justifyContent: 'space-between' }}>
        <div
          style={{
            maxWidth: 900,
            opacity: textIn,
            transform: `translateX(${(1 - textIn) * -28}px)`,
          }}
        >
          <Eyebrow>{clip.eyebrow}</Eyebrow>
          <Heading size={50}>{clip.title}</Heading>
          <div style={{ marginTop: 22, fontSize: 24, color: C.text, lineHeight: 1.65, opacity: 0.9, maxWidth: 760 }}>
            {clip.desc}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {CLIPS.map((c2, i) => (
            <div
              key={c2.file}
              style={{
                width: i === idx ? 46 : 12,
                height: 12,
                borderRadius: 999,
                background: i === idx ? C.accent : 'rgba(255,255,255,0.22)',
                boxShadow: i === idx ? `0 0 18px ${C.accentSoft}` : 'none',
              }}
            />
          ))}
          <div
            style={{
              marginLeft: 14,
              fontSize: 19,
              letterSpacing: 2,
              color: C.dim,
              border: `1px solid ${C.line}`,
              borderRadius: 999,
              padding: '6px 16px',
            }}
          >
            真实界面操作
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
