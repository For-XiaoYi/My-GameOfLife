import type { ReactNode } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { TitleScene } from './scenes/Intro';
import { RulesScene } from './scenes/Rules';
import {
  StillsScene,
  OscillatorsScene,
  GliderStaticScene,
  GunScene,
  GunTeaserScene,
  InsertScene,
} from './scenes/Anatomy';
import { SwitchScene } from './scenes/Switch';
import {
  BlackCaptionScene,
  GatesScene,
  GateArrayScene,
  TuringMachineScene,
  GrandStructuresScene,
} from './scenes/Computing';
import { RandomEvolutionScene } from './scenes/RandomEvolution';
import { OutroScene } from './scenes/Ending';

type SceneDef = { key: string; dur: number; node: ReactNode };

/**
 * v7 结构：规则 → 组件（静物 / 振荡子 / 滑翔机 / 滑翔枪 / 开关）→ 黑屏提问
 * → 逻辑门 → 门阵列 → 图灵机 → 宏大结构 → 随机演化 → 结尾。
 * 前 56 秒的场景时长与 v6 一致；56 秒后是新增章节。
 */
export const SCENES: SceneDef[] = [
  { key: 'title', dur: 120, node: <TitleScene /> },
  { key: 'rules', dur: 300, node: <RulesScene /> },
  { key: 'stills', dur: 180, node: <StillsScene /> },
  { key: 'osc', dur: 150, node: <OscillatorsScene /> },
  { key: 'glider-static', dur: 120, node: <GliderStaticScene /> },
  {
    key: 'glider-live',
    dur: 208,
    node: (
      <InsertScene
        file="clip-glider.mp4"
        step="接着：把它放进画布"
        caption="选中、落子、按下播放 —— 它自己就走了"
        startFrom={52}
      />
    ),
  },
  { key: 'gun-teaser', dur: 62, node: <GunTeaserScene /> },
  { key: 'gun', dur: 240, node: <GunScene /> },
  { key: 'switch', dur: 300, node: <SwitchScene /> },
  { key: 'black-caption', dur: 90, node: <BlackCaptionScene /> },
  { key: 'gates', dur: 300, node: <GatesScene /> },
  { key: 'array', dur: 180, node: <GateArrayScene /> },
  { key: 'turing', dur: 270, node: <TuringMachineScene /> },
  { key: 'grand', dur: 450, node: <GrandStructuresScene /> },
  { key: 'random', dur: 420, node: <RandomEvolutionScene /> },
  { key: 'outro', dur: 360, node: <OutroScene /> },
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
      <Audio src={staticFile('music/score.mp3')} volume={1} />
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
