/**
 * 配色テーマ(FR-7 / UIの正: docs/mockups/control-panel.jsx L31-69)。
 *
 * 「将来ユーザーが配色テーマを切り替えられる」前提で、全ての色を THEMES に集約する
 * (直書きhexをコンポーネントに持たない)。現時点の実装は2案:
 *   - light「白望(はくぼう)」: 白和紙・お札のような明るいトーン
 *   - dark 「漆黒(しっこく)」: 電脳オカルト×HUD の暗いトーン
 *
 * Mood(緩やかな気分。FR-4)に応じて呪紋リングの霊力の色・回転速度が変わる。moods は
 * MoodState(idle/confident/tired)でキー付けし、shared/emotions.ts の3状態と対称に保つ
 * (Record<MoodState> によりTypeScriptが3キー欠落を検出する)。
 */

import { createContext, useContext } from 'react';

import type { MoodState } from '../../../shared/emotions';

/** 1つのMoodぶんの見た目(呪紋リングの色・残光・回転速度)。 */
export interface MoodStyle {
  label: string;
  color: string;
  glow: string;
  /** 呪紋リングの基準回転秒。小さいほど速い(霊力が満ちているほど速い)。 */
  speed: number;
}

/** テーマ1案ぶんの全トークン。 */
export interface Theme {
  label: string;
  swatchBg: string;
  swatchAccent: string;
  bgBase: string;
  bgPanel: string;
  bgRaised: string;
  line: string;
  accent: string;
  accentTag: string;
  mint: string;
  mintTag: string;
  sealRed: string;
  sealRedTagSoft: string;
  sealRedTag: string;
  warnText: string;
  ink: string;
  inkDim: string;
  iconInactive: string;
  disabledText: string;
  sliderTrack: string;
  dashedBorder: string;
  labelMuted: string;
  moods: Record<MoodState, MoodStyle>;
}

/** 実装済みの配色テーマ名。 */
export type ThemeName = 'light' | 'dark';
// NOTE: ユーザーが選べるテーマモード(ThemeName | 'system')は FR-7 設定タブで手動切替を
// 実装する際に追加する。#6(FR-15) は OS 追従のみのため、未使用の型はここに置かない。

export const THEMES: Record<ThemeName, Theme> = {
  light: {
    label: '白望(はくぼう)',
    swatchBg: '#F5F3FA',
    swatchAccent: '#7C4FE0',
    bgBase: '#F5F3FA',
    bgPanel: '#FFFFFF',
    bgRaised: '#EFEBF9',
    line: '#E3DEF2',
    accent: '#7C4FE0',
    accentTag: 'rgba(124,79,224,0.16)',
    mint: '#12A585',
    mintTag: 'rgba(18,165,133,0.14)',
    sealRed: '#C7333D',
    sealRedTagSoft: 'rgba(199,51,61,0.10)',
    sealRedTag: 'rgba(199,51,61,0.14)',
    warnText: '#A13340',
    ink: '#211C33',
    inkDim: '#726C8C',
    iconInactive: '#A39DBE',
    disabledText: '#B5AFC7',
    sliderTrack: '#DAD5EA',
    dashedBorder: '#D0CAE4',
    labelMuted: '#635E85',
    moods: {
      idle: { label: '静穏(せいおん)', color: '#635E85', glow: '#E4DFF7', speed: 6 },
      confident: { label: '昂揚(こうよう)', color: '#7C4FE0', glow: '#D9C7FF', speed: 3.5 },
      tired: { label: '減衰(げんすい)', color: '#8A5F6D', glow: '#F2DEE3', speed: 8 },
    },
  },
  dark: {
    label: '漆黒(しっこく)',
    swatchBg: '#0A0A12',
    swatchAccent: '#B58AFF',
    bgBase: '#0A0A12',
    bgPanel: '#15151F',
    bgRaised: '#1E1E2C',
    line: '#2B2B3D',
    accent: '#B58AFF',
    accentTag: 'rgba(181,138,255,0.14)',
    mint: '#5FE0C0',
    mintTag: 'rgba(95,224,192,0.14)',
    sealRed: '#E14B4B',
    sealRedTagSoft: 'rgba(225,75,75,0.12)',
    sealRedTag: 'rgba(225,75,75,0.14)',
    warnText: '#F0A8A8',
    ink: '#EDEAF7',
    inkDim: '#8B87A3',
    iconInactive: '#5A5770',
    disabledText: '#4A4760',
    sliderTrack: '#3E3B45',
    dashedBorder: '#3A3750',
    labelMuted: '#6F6C90',
    moods: {
      idle: { label: '静穏(せいおん)', color: '#6F6C90', glow: '#2E2B45', speed: 6 },
      confident: { label: '昂揚(こうよう)', color: '#B58AFF', glow: '#6B4FA0', speed: 3.5 },
      tired: { label: '減衰(げんすい)', color: '#8C6B7A', glow: '#3D2B36', speed: 8 },
    },
  },
};

const ThemeCtx = createContext<Theme>(THEMES.light);

/** Provider は App が持つ。子コンポーネントはこのフックで現在のテーマを読む。 */
export const ThemeProvider = ThemeCtx.Provider;
export const useTheme = (): Theme => useContext(ThemeCtx);
