/**
 * モード設定タブ(FR-7)の Code Adapter セクションの実体(#モデル管理タブ・モード設定タブ)。
 * config.codeAdapter(監視対象パス・ポート番号)と config.emotionEngine.failStreakThreshold の
 * 表示・変更を担う。Chat Adapter 側の chat-adapter.ts と同じく、Renderer からの要求を検証し
 * ConfigStore を通じて永続化する。
 *
 * 正本:
 * - 設定項目: docs/mockups/control-panel.jsx L1183-1193(Code Adapter の Section)
 * - watchedProjectPaths の意味(空=絞り込みなし): src/main/code-adapter/code-adapter.ts
 * - watchedProjectPaths への追加はダイアログ経由に限る不変条件: onboarding-service.ts
 *
 * **設計上の要点(嘘をつかない・反映タイミングを正しく扱う)**:
 * - watchedProjectPaths への**追加は Renderer から任意の配列で行わせない**。ダイアログで選ばれた
 *   パスだけを入れる(addWatchedProject 経由)。dispatch.sh の書き込み先を限定する不変条件を守る。
 * - ポート番号は**起動時にしかバインドされない**ため、変更しても実際に効くのは次回起動時
 *   (getActualPort で実ポートを併記して UI に「再起動後に反映」と示す)。
 * - failStreakThreshold は EmotionEngine が構築時スナップショットを握っているため、config を
 *   書き換えるだけでは反映されない。engine.updateConfig() で live 更新して即座に効かせる。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(EmotionEngine と config を触るだけ)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 *
 * Electron 非依存に保つ(GUIを伴わない検証のため)。ネイティブダイアログ・実ポートの取得は
 * 関数として注入し、このクラス自身は electron を import しない
 * (.claude/rules/build-commands.md「サンドボックスで可能な検証」)。
 */

import path from 'node:path';

import type { ConfigStore } from '../config-store';
import type { EmotionEngine } from '../emotion-engine';
import {
  FAIL_STREAK_MAX,
  FAIL_STREAK_MIN,
  SERVER_PORT_MAX,
  SERVER_PORT_MIN,
  isValidFailStreak,
  isValidPort,
  type CodeSettingsPatch,
  type CodeSettingsSnapshot,
} from '../../shared/code-settings';

export interface CodeAdapterSettingsDeps {
  configStore: ConfigStore;
  engine: EmotionEngine;
  /** 実際に待ち受けているポート(未起動なら null)。設定値と区別して表示するために使う。 */
  getActualPort: () => number | null;
  /**
   * 監視対象プロジェクトをネイティブダイアログで1件追加する(選ばれたパス or キャンセルで null)。
   * **watchedProjectPaths への唯一の入口**(onboarding-service.ts の chooseProject)を注入して再利用する。
   * ここで独自に配列を書き換えると、その不変条件が2箇所に分裂して片方だけ緩む事故になるため、
   * 追加のロジックは持たず既存の入口へ委譲する。
   */
  addWatchedProject: () => Promise<string | null>;
}

/**
 * IPC 経由の未検証ペイロードを CodeSettingsPatch へ検証する(chat-adapter.ts の parseSettingsPatch と同じ役割)。
 * **watchedProjectPaths は受け付けない**(上記の不変条件)。型が合わないキーは例外を投げる
 * (黙って無視すると「保存したのに変わらない」という別の嘘になる)。
 */
export function parseCodeSettingsPatch(patch: unknown): CodeSettingsPatch {
  if (typeof patch !== 'object' || patch === null) {
    throw new Error('設定の指定が不正です。');
  }
  const raw = patch as Record<string, unknown>;
  const result: CodeSettingsPatch = {};
  if (raw['serverPort'] !== undefined) {
    if (typeof raw['serverPort'] !== 'number') {
      throw new Error('ポート番号は数値で指定してください。');
    }
    result.serverPort = raw['serverPort'];
  }
  if (raw['failStreakThreshold'] !== undefined) {
    if (typeof raw['failStreakThreshold'] !== 'number') {
      throw new Error('回数は数値で指定してください。');
    }
    result.failStreakThreshold = raw['failStreakThreshold'];
  }
  return result;
}

export class CodeAdapterSettings {
  constructor(private readonly deps: CodeAdapterSettingsDeps) {}

  /** モード設定タブへ返す現在値(設定値と実ポートを区別して返す)。 */
  getSnapshot(): CodeSettingsSnapshot {
    const config = this.deps.configStore.current;
    return {
      // 配列はコピーして返す(呼び出し側が握っている config を書き換えられないように)。
      watchedProjectPaths: [...config.codeAdapter.watchedProjectPaths],
      serverPort: config.codeAdapter.serverPort,
      actualPort: this.deps.getActualPort(),
      failStreakThreshold: config.emotionEngine.failStreakThreshold,
    };
  }

  /**
   * 監視対象プロジェクトをネイティブダイアログで追加する。
   * 追加そのものは注入された入口(addWatchedProject)が config を更新するため、ここでは
   * 更新後のスナップショットを返すだけ。キャンセル時は何も変わらないスナップショットが返る。
   */
  async chooseProject(): Promise<CodeSettingsSnapshot> {
    await this.deps.addWatchedProject();
    return this.getSnapshot();
  }

  /**
   * 監視対象プロジェクトを1件外す。**削除は安全**(監視範囲を狭めるだけで、どこかへの
   * 書き込み権限を与えない)ため、Renderer から特定パス指定で受け付けてよい。
   * ディレクトリ境界ではなく resolve 後の完全一致で消す(追加時も resolve 済みのため)。
   */
  removeProject(projectPath: string): CodeSettingsSnapshot {
    const target = path.resolve(projectPath);
    this.deps.configStore.update((draft) => {
      draft.codeAdapter.watchedProjectPaths = draft.codeAdapter.watchedProjectPaths.filter(
        (p) => path.resolve(p) !== target,
      );
    });
    return this.getSnapshot();
  }

  /**
   * ポート番号・連続失敗しきい値を更新する。範囲外は config へ書かず例外を投げる
   * (config-schema.ts は serverPort/failStreakThreshold に範囲を持たないため、境界で検証する。
   * スキーマ側へ範囲を足すと data.md / basic-design.md の同期が必要になり本タスクの範囲を越える)。
   */
  updateSettings(patch: CodeSettingsPatch): CodeSettingsSnapshot {
    if (patch.serverPort !== undefined && !isValidPort(patch.serverPort)) {
      throw new Error(
        `ポート番号は ${SERVER_PORT_MIN}〜${SERVER_PORT_MAX} の整数で指定してください。`,
      );
    }
    if (patch.failStreakThreshold !== undefined && !isValidFailStreak(patch.failStreakThreshold)) {
      throw new Error(`回数は ${FAIL_STREAK_MIN}〜${FAIL_STREAK_MAX} の整数で指定してください。`);
    }

    const thresholdChanged = patch.failStreakThreshold !== undefined;
    this.deps.configStore.update((draft) => {
      if (patch.serverPort !== undefined) {
        draft.codeAdapter.serverPort = patch.serverPort;
      }
      if (patch.failStreakThreshold !== undefined) {
        draft.emotionEngine.failStreakThreshold = patch.failStreakThreshold;
      }
    });

    // failStreakThreshold は EmotionEngine の構築時スナップショットに握られているため、
    // config を書き換えただけでは反映されない。live 更新で即座に効かせる(冒頭コメント参照)。
    // ポートは起動時バインドのため live 更新の対象外(UIで「再起動後に反映」と示す)。
    if (thresholdChanged) {
      this.deps.engine.updateConfig(this.deps.configStore.current.emotionEngine);
    }
    return this.getSnapshot();
  }
}
