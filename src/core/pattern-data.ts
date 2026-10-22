/**
 * 图案库数据，由 `node scripts/gen-patterns.mjs` 从 tools/patterns/*.rle 生成。
 * 数据来源：LifeWiki（conwaylife.com）的标准 RLE。请勿手改本文件。
 */

import type { PatternCategory } from './patterns.ts';

export interface PatternEntry {
  id: string;
  name: string;
  en: string;
  category: PatternCategory;
  rows: string[];
  period: number | null;
  move: [number, number] | null;
}

export const PATTERN_ENTRIES: PatternEntry[] = [
  {
    id: "block",
    name: "方块",
    en: "Block",
    category: "静物",
    rows: [
      "OO",
      "OO",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "beehive",
    name: "蜂巢",
    en: "Beehive",
    category: "静物",
    rows: [
      ".OO.",
      "O..O",
      ".OO.",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "loaf",
    name: "面包",
    en: "Loaf",
    category: "静物",
    rows: [
      ".OO.",
      "O..O",
      ".O.O",
      "..O.",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "boat",
    name: "小船",
    en: "Boat",
    category: "静物",
    rows: [
      "OO.",
      "O.O",
      ".O.",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "tub",
    name: "浴缸",
    en: "Tub",
    category: "静物",
    rows: [
      ".O.",
      "O.O",
      ".O.",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "pond",
    name: "池塘",
    en: "Pond",
    category: "静物",
    rows: [
      ".OO.",
      "O..O",
      "O..O",
      ".OO.",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "ship",
    name: "大船",
    en: "Ship",
    category: "静物",
    rows: [
      "OO.",
      "O.O",
      ".OO",
    ],
    period: 1,
    move: [0, 0],
  },
  {
    id: "blinker",
    name: "闪光灯",
    en: "Blinker",
    category: "振荡子",
    rows: [
      "OOO",
    ],
    period: 2,
    move: [0, 0],
  },
  {
    id: "toad",
    name: "蟾蜍",
    en: "Toad",
    category: "振荡子",
    rows: [
      ".OOO",
      "OOO.",
    ],
    period: 2,
    move: [0, 0],
  },
  {
    id: "beacon",
    name: "灯塔",
    en: "Beacon",
    category: "振荡子",
    rows: [
      "OO..",
      "O...",
      "...O",
      "..OO",
    ],
    period: 2,
    move: [0, 0],
  },
  {
    id: "pulsar",
    name: "脉冲星",
    en: "Pulsar",
    category: "振荡子",
    rows: [
      "..OOO...OOO..",
      ".............",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      "..OOO...OOO..",
      ".............",
      "..OOO...OOO..",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      ".............",
      "..OOO...OOO..",
    ],
    period: 3,
    move: [0, 0],
  },
  {
    id: "pentadecathlon",
    name: "十五面体",
    en: "Pentadecathlon",
    category: "振荡子",
    rows: [
      "..O....O..",
      "OO.OOOO.OO",
      "..O....O..",
    ],
    period: 15,
    move: [0, 0],
  },
  {
    id: "glider",
    name: "滑翔机",
    en: "Glider",
    category: "飞船",
    rows: [
      ".O.",
      "..O",
      "OOO",
    ],
    period: 4,
    move: [1, 1],
  },
  {
    id: "lwss",
    name: "轻型飞船",
    en: "Lightweight Spaceship",
    category: "飞船",
    rows: [
      ".O..O",
      "O....",
      "O...O",
      "OOOO.",
    ],
    period: 4,
    move: [-2, 0],
  },
  {
    id: "mwss",
    name: "中型飞船",
    en: "Middleweight Spaceship",
    category: "飞船",
    rows: [
      "...O..",
      ".O...O",
      "O.....",
      "O....O",
      "OOOOO.",
    ],
    period: 4,
    move: [-2, 0],
  },
  {
    id: "hwss",
    name: "重型飞船",
    en: "Heavyweight Spaceship",
    category: "飞船",
    rows: [
      "...OO..",
      ".O....O",
      "O......",
      "O.....O",
      "OOOOOO.",
    ],
    period: 4,
    move: [-2, 0],
  },
  {
    id: "gosperglidergun",
    name: "高斯帕滑翔机枪",
    en: "Gosper Glider Gun",
    category: "枪",
    rows: [
      "........................O...........",
      "......................O.O...........",
      "............OO......OO............OO",
      "...........O...O....OO............OO",
      "OO........O.....O...OO..............",
      "OO........O...O.OO....O.O...........",
      "..........O.....O.......O...........",
      "...........O...O....................",
      "............OO......................",
    ],
    period: 30,
    move: null,
  },
  {
    id: "rpentomino",
    name: "R 五连块",
    en: "R-pentomino",
    category: "长寿者",
    rows: [
      ".OO",
      "OO.",
      ".O.",
    ],
    period: null,
    move: null,
  },
  {
    id: "acorn",
    name: "橡果",
    en: "Acorn",
    category: "长寿者",
    rows: [
      ".O.....",
      "...O...",
      "OO..OOO",
    ],
    period: null,
    move: null,
  },
  {
    id: "diehard",
    name: "顽固者",
    en: "Diehard",
    category: "长寿者",
    rows: [
      "......O.",
      "OO......",
      ".O...OOO",
    ],
    period: null,
    move: null,
  },
];
