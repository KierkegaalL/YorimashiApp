/**
 * オンボーディング(FR-14)で Main ↔ Renderer が受け渡す型。
 * 詳細設計の正本は docs/detailed-design/onboarding.md。
 *
 * 貫く原則(同ドキュメント): **一度も行き止まりを作らず、未完了の項目について嘘をつかない**。
 * そのため完了画面は「完了しました」とだけ出さず、実際に何が設定され何が残っているかを示す。
 * この型が持つフィールドは、その判断に必要な**実測値**(ディスクを見た結果)であって、
 * 「たぶん設定できたはず」という推定値ではない。
 */

import type { ChatConfigSnapshot } from './chat';

/** FR-1 のアダプタ / Chat のモード。union を二重定義せず既存スナップショットから導出する。 */
export type OnboardingAdapter = ChatConfigSnapshot['activeAdapter'];
export type OnboardingChatMode = ChatConfigSnapshot['chatMode'];

/**
 * 監視対象プロジェクト1件のhooks設定状況。**ディスクを見た結果**を返す。
 *
 * `dispatchScriptPlaced` と `settingsReferencesDispatch` を分けているのは、
 * アプリが行えるのは前者(dispatch.shの配置)だけで、後者(`.claude/settings.json` への
 * 追記)は利用者が手で行うため。両方を「hooks設定済み」と一括りにすると、
 * スクリプトを置いただけの状態を「設定済み」と誤って申告することになる。
 */
export interface OnboardingHooksProbe {
  projectPath: string;
  /** `<project>/.claude/hooks/dispatch.sh` が存在し、実行可能か。 */
  dispatchScriptPlaced: boolean;
  /** `<project>/.claude/settings.json` が存在するか。 */
  settingsExists: boolean;
  /** その settings.json に dispatch.sh を呼ぶ hook が書かれているか。 */
  settingsReferencesDispatch: boolean;
  /**
   * 調べられなかった理由(権限不足・JSON破損等)。null 以外のとき、上の真偽値は
   * 「確認できなかった」を意味する。**分からないことを false と偽らない**ために持つ。
   */
  probeError: string | null;
}

/** オンボーディング画面が描画に必要とする現在の状態。 */
export interface OnboardingSnapshot {
  completed: boolean;
  activeAdapter: OnboardingAdapter;
  chatMode: OnboardingChatMode;
  /** 導入済みモデル数(0体は正当な状態。onboarding.md 論点2)。 */
  modelCount: number;
  /** config.codeAdapter.watchedProjectPaths と、各パスのhooks設定状況。 */
  hooks: OnboardingHooksProbe[];
  /** `.claude/settings.json` へ貼り付けてもらう hooks 設定(コピー用)。 */
  settingsSnippet: string;
  /** dispatch.sh のプロジェクト内相対パス(画面の説明文に出す)。 */
  dispatchScriptRelPath: string;
}

/**
 * dispatch.sh 配置の結果。
 *
 * `exists-differs` を独立させているのは、利用者が手を入れた可能性のあるファイルを
 * 黙って上書きしないため。上書きは明示的な再要求(overwrite: true)でのみ行う。
 */
export type DispatchInstallResult =
  | { status: 'created'; path: string }
  | { status: 'updated'; path: string }
  | { status: 'unchanged'; path: string }
  | { status: 'exists-differs'; path: string }
  | { status: 'rejected-unknown-project'; path: string }
  | { status: 'failed'; path: string; message: string };
