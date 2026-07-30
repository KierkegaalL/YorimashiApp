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

/** クレジット残高不足のエラー(issue #16)で開く先。上と同じ機構(setWindowOpenHandler)で外部ブラウザへ渡す。 */
export const ANTHROPIC_BILLING_URL = 'https://console.anthropic.com/settings/billing';

export const RESPONSE_MODELS: readonly ResponseModel[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

/**
 * モデル1件の「形式由来の補足」表示文。**モデルタブとホームタブが同じ文言を出すため**ここに置く。
 *
 * モックアップ(`docs/mockups/control-panel.jsx`)はここに `version`(「3/10クリップ・変換済み」等)
 * を出しているが、あれはデモ用の固定文字列で実際の `ModelSlotView` に対応するフィールドが無い。
 * 代わりに形式から言えることだけを出す(Live2D は Cubism 版、スプライトセットは版の概念を
 * 持たないため別の語)。**両形式に同じものを無理に書かない**非対称だが、形式の性質に由来する
 * ため正当(constraints.md)。
 *
 * 以前は ModelTab.tsx と HomeTab.tsx に同一実装が複製されていた(片方だけ直す事故を避けるため
 * 集約した。`panel-ui.tsx` の Placeholder/ErrorNotice と同じ理由)。
 */
export function formatModelDetail(slot: {
  renderType: 'live2d' | 'spriteset';
  cubismVersion?: 'cubism2' | 'cubism4';
}): string {
  if (slot.renderType !== 'live2d') {
    return 'WebPクリップ';
  }
  if (slot.cubismVersion === 'cubism2') {
    return 'Cubism 2';
  }
  return slot.cubismVersion === 'cubism4' ? 'Cubism 4 / 5' : 'Cubism 版不明';
}
