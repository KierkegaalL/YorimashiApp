/**
 * Control Panel / 会話ペインが参照する静的カタログ(UIの正: docs/mockups/control-panel.jsx)。
 *
 * この移植段階(#6=FR-15)で使うのは、タブバー(FR-7の骨組み)と会話ペイン入力欄(C-23)ぶんのみ。
 * 各タブの中身が持つカタログ(感情メタ・APIキー手順・モデル一覧等)は、そのタブを移植する
 * 後続タスク(#8/#11/#13 ほか)で追加する。感情の**キー一覧**の単一の情報源は shared/emotions.ts。
 */

import type { LucideIcon } from 'lucide-react';
import { Home, UserRound, ArrowLeftRight, Settings, ScrollText, Scale } from 'lucide-react';

export type TabId = 'home' | 'model' | 'adapter' | 'general' | 'logs' | 'licenses';

export interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

export const TABS: readonly TabDef[] = [
  { id: 'home', label: 'ホーム', icon: Home },
  { id: 'model', label: 'モデル', icon: UserRound },
  { id: 'adapter', label: 'モード', icon: ArrowLeftRight },
  { id: 'general', label: '設定', icon: Settings },
  { id: 'logs', label: 'ログ', icon: ScrollText },
  { id: 'licenses', label: '権利', icon: Scale },
];

/**
 * 会話ペイン入力欄のスラッシュコマンド(C-23。chat-pane.md 論点7)。
 * 設定・アダプタ操作へのショートカットであり agentic ではない。/model は real 時のみ有効。
 */
export interface SlashCommand {
  cmd: string;
  label: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { cmd: '/clear', label: '会話をクリア' },
  { cmd: '/mock', label: 'mockモードにする' },
  { cmd: '/real', label: 'realモードにする' },
  { cmd: '/code', label: 'Code Adapterへ切替' },
  { cmd: '/panel', label: '設定を開く' },
  { cmd: '/model', label: '応答モデル選択(real時のみ)' },
];

/**
 * @参照(C-23)。ユーザーが明示選択する限定的な文脈参照で、ツール呼び出しではない。
 * 参照対象はアプリ管理の固定対象に限り、本文文字列から任意パスを解決しない(security.md 6章)。
 */
export interface AtReference {
  key: 'logs' | 'model' | 'settings';
  label: string;
}

export const AT_REFERENCES: readonly AtReference[] = [
  { key: 'logs', label: '作業ログ(直近hooks)' },
  { key: 'model', label: '表示中のモデル' },
  { key: 'settings', label: '設定' },
];

/** real 時の応答モデル選択(C-23。将来 config.chatAdapter.model に保存。mock は固定返答のため無効)。 */
export interface ResponseModel {
  id: string;
  label: string;
}

/**
 * APIキーの取得手順(FR-3。chat-adapter-errors.md 論点5。UIの正: モックアップ `API_KEY_STEPS`)。
 *
 * **401を待たずに常設で見せる**のがこの案内の趣旨。論点5は「realへ切り替えた時点で
 * (キーが間違っていると発覚する前に)見えるようにする」と定めており、失敗後の事後対応
 * (401→worried+「モード設定を開く」)を置き換えるものではない。両者は併存する。
 *
 * **OAuthでの「Claudeにサインイン」は提供しない**(論点5)。AnthropicはMessages APIに対して
 * 第三者アプリ向けの公開OAuth連携を提供しておらず、Claude Code CLIのログインは公式ツール
 * 専用の内部機構であるため。だから摩擦を減らす方向(手順の常設)で対応している。
 */
export const API_KEY_STEPS: readonly string[] = [
  'Anthropicアカウントでログイン(未登録ならこの画面から新規登録)',
  '左メニューの「API Keys」→「Create Key」を選ぶ',
  '発行された sk-ant- から始まるキーをコピーする',
  '上の「APIキー」欄に貼り付ける',
];

/** 上の手順で開く先。**アプリ内では開かず**、既存の setWindowOpenHandler 経由で外部ブラウザへ渡す。 */
export const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

export const RESPONSE_MODELS: readonly ResponseModel[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];
