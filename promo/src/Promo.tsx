import type { ReactNode } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { TitleScene } from './scenes/Intro';
import { RulesScene } from './scenes/Rules';
import { StillsScene, OscillatorsScene, GliderStaticScene, GunScene, CircuitsScene, InsertScene } from './scenes/Anatomy';
import { OutroScene } from './scenes/Ending';

type SceneDef = { key: string; dur: number; node: ReactNode };

/**
 * 结构：先讲规则，再逐个拆解组件（静物 → 滑翔机 → 滑翔枪 → 逻辑电路），
 * 功能不再单独成段，而是以"实机演示"短片穿插在组件之间。
 */
export const SCENES: SceneDef[] = [
  { key: 'title', dur: 120, node: <TitleScene /> },
  { key: 'rules', dur: 300, node: <RulesScene /> },
  { key: 'stills', dur: 180, node: <StillsScene /> },
  { key: 'osc', dur: 150, node: <OscillatorsScene /> },
  { key: 'glider-static', dur: 120, node: <GliderStaticScene /> },
  {
    key: 'glider-live',
    dur: 270,
    node: (
      <InsertScene
        file="clip-glider.mp4"
        step="接着：把它放进画布"
        caption="选中、落子、按下播放 —— 它自己就走了"
        startFrom={52}
      />
    ),
  },
  { key: 'gun', dur: 240, node: <GunScene /> },
  { key: 'circuits', dur: 300, node: <CircuitsScene /> },
  { key: 'outro', dur: 165, node: <OutroScene /> },
];

export const FPS = 30;
const FADE = 9;

/** 场景之间用 9 帧淡入淡出衔接（不依赖 @remotion/transitions） */
const Fade: React.FC<{ dur: number; children: ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(1, Math.min(f / FADE, (dur - f) / FADE));
  return <AbsoluteFill style={{ opacity: Math.max(0, o) }}>{children}</AbsoluteFill>;
};

export const Promo: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: '#05080c' }}>
      {/* 整片配乐：scripts/make-music.mjs 合成，段落与场景对齐，结尾硬收 */}
      <Audio src={staticFile('music/score.wav')} volume={1} />
      {SCENES.map((s) => {
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

export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + s.dur, 0);
