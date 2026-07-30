/**
 * 全体設定タブ(FR-7/FR-10)の実体。config.general(配色テーマ・表示サイズ・クリックスルー・
 * 自動起動)と config.emotionEngine の表示値を扱う。`code-adapter/code-settings.ts` と同じ構造
 * (Renderer からの要求を検証し ConfigStore を通じて永続化し、live 反映が要るものは注入された
 * 関数へ委譲する)。
 *
 * 正本:
 * - 設定項目: docs/mockups/control-panel.jsx L1255-1346(全体設定タブ)
 * - 配色テーマ3モード: 要件定義書 C-15
 * - 表示サイズの範囲: 未決事項C6の決着(shared/general-settings.ts の定数)
 *
 * **設計上の要点(嘘をつかない・反映タイミングを正しく扱う)**:
 * - `autostart` は **これまで config フィールドだけが存在し、OSへの登録処理が一切無かった**
 *   (`git grep setLoginItemSettings` が無所属だった)。トグルを付けるだけでは「ONにしたのに
 *   ログイン時に起動しない」という嘘になるため、ここで実際に `app.setLoginItemSettings()` を
 *   呼ぶ(注入された `setLoginItem`)。あわせて**実際のOS登録状態**を読み(`getLoginItem`)、
 *   config の意思と食い違っていれば UI がそれを表示できるようスナップショットに両方載せる。
 * - `autostartSupported` が false(開発実行=未パッケージ)のときは**登録を試みない**。
 *   macOS のログイン項目は実行中のバイナリのパスを登録するため、未パッケージの Electron を
 *   登録すると `node_modules/electron/dist/Electron.app` が起動するだけで無意味
 *   (それを「有効」と表示するのも嘘になる)。
 * - `displaySize` はウィンドウの物理サイズ(`baseResolution × displaySize`)を決めるため、
 *   config を書くだけでは画面に反映されない。`applyDisplaySize` で live リサイズする
 *   (`failStreakThreshold` を `engine.updateConfig()` で live 反映するのと同じ構図)。
 * - `clickThrough` は **index.ts のモジュール関数 `setClickThrough()`** へ委譲する(注入される
 *   `deps.setClickThrough`)。あれが Tray のチェックボックスと共有する唯一の入口で、
 *   **config 保存(ウィンドウの有無に関わらず必ず) + 実ウィンドウへの適用(あるときだけ)**の
 *   両方を担う。ここで config を直接書くと入口が2つに割れて片方だけ適用漏れになる。
 *   (適用そのものは `CharacterWindow.applyClickThroughSetting()` が持つ。ウィンドウ側に
 *   保存まで持たせるとインスタンス未生成の間に意思が捨てられるため分離した。)
 * - `themeMode` は Renderer が描画に使うだけなので config 保存のみ(Main 側の適用対象が無い)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない。`displaySize` はウィンドウ寸法に
 * 効くが、その計算は両形式共通の `resolveWindowSize()`(character-window.md 論点2で決着)で
 * あり形式で分岐しない。よって対称性チェック(CLAUDE.md原則4)の対象外。
 *
 * Electron 非依存に保つ(GUIを伴わない検証のため)。ログイン項目の読み書き・ウィンドウの
 * リサイズは関数として注入し、このクラス自身は electron を import しない
 * (.claude/rules/build-commands.md「サンドボックスで可能な検証」)。
 */

import type { ConfigStore } from './config-store';
import {
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  isThemeMode,
  isValidDisplaySize,
  type GeneralSettingsPatch,
  type GeneralSettingsSnapshot,
} from '../shared/general-settings';

export interface GeneralSettingsDeps {
  configStore: ConfigStore;
  /**
   * クリックスルーの切替。**index.ts の `setClickThrough()` を渡す**
   * (config保存と実ウィンドウへの適用を持つ唯一の入口。冒頭コメント参照)。
   */
  setClickThrough: (value: boolean) => void;
  /** 表示サイズ変更後にキャラクターウィンドウを実寸へ追従させる。 */
  applyDisplaySize: () => void;
  /** OSのログイン項目に登録されているか。取得できない環境では null を返す。 */
  getLoginItem: () => boolean | null;
  /** OSのログイン項目の登録/解除。`autostartSupported` が false のときは呼ばれない。 */
  setLoginItem: (openAtLogin: boolean) => void;
  /**
   * ログイン項目の登録が実際に機能するか(= パッケージ済みか)。
   * 未パッケージの開発実行では false。
   */
  isAutostartSupported: () => boolean;
}

/**
 * IPC 経由の未検証ペイロードを GeneralSettingsPatch へ検証する
 * (`parseCodeSettingsPatch` と同じ役割)。型・範囲が合わないキーは例外を投げる
 * (黙って無視すると「保存したのに変わらない」という別の嘘になる)。
 */
export function parseGeneralSettingsPatch(patch: unknown): GeneralSettingsPatch {
  if (typeof patch !== 'object' || patch === null) {
    throw new Error('設定の指定が不正です。');
  }
  const raw = patch as Record<string, unknown>;
  const result: GeneralSettingsPatch = {};
  if (raw['themeMode'] !== undefined) {
    if (!isThemeMode(raw['themeMode'])) {
      throw new Error('配色テーマの指定が不正です。');
    }
    result.themeMode = raw['themeMode'];
  }
  if (raw['displaySize'] !== undefined) {
    if (typeof raw['displaySize'] !== 'number') {
      throw new Error('表示サイズは数値で指定してください。');
    }
    result.displaySize = raw['displaySize'];
  }
  if (raw['clickThrough'] !== undefined) {
    if (typeof raw['clickThrough'] !== 'boolean') {
      throw new Error('クリックスルーの指定が不正です。');
    }
    result.clickThrough = raw['clickThrough'];
  }
  if (raw['autostart'] !== undefined) {
    if (typeof raw['autostart'] !== 'boolean') {
      throw new Error('自動起動の指定が不正です。');
    }
    result.autostart = raw['autostart'];
  }
  return result;
}

export class GeneralSettings {
  constructor(private readonly deps: GeneralSettingsDeps) {}

  /** 全体設定タブへ返す現在値(config の意思と実際のOS登録状態を区別して返す)。 */
  getSnapshot(): GeneralSettingsSnapshot {
    const config = this.deps.configStore.current;
    const supported = this.deps.isAutostartSupported();
    return {
      themeMode: config.general.themeMode,
      displaySize: config.general.displaySize,
      clickThrough: config.general.clickThrough,
      autostart: config.general.autostart,
      // 未対応環境では OS 状態を問い合わせない(意味のある答えが返らないため null)。
      autostartRegistered: supported ? this.deps.getLoginItem() : null,
      autostartSupported: supported,
      reactionDurationMs: config.emotionEngine.reactionDurationMs,
      idleTimeoutMs: config.emotionEngine.idleTimeoutMs,
    };
  }

  /**
   * 起動時に config.general.autostart を OS のログイン項目へ同期する。
   *
   * config が正で、OS 側の登録状態はその写しとして扱う。前回の起動で
   * 未対応環境(開発実行)だった・システム設定から直接外された等でずれうるため、
   * **起動のたびに一度だけ揃える**。未対応環境では何もしない。
   */
  syncAutostartOnStartup(): void {
    if (!this.deps.isAutostartSupported()) {
      return;
    }
    const desired = this.deps.configStore.current.general.autostart;
    if (this.deps.getLoginItem() !== desired) {
      this.deps.setLoginItem(desired);
    }
  }

  /**
   * 設定を更新する。範囲外は config へ書かず例外を投げる。
   * live 反映が要るもの(表示サイズ・クリックスルー・自動起動)はそれぞれの適用先へ委譲する。
   */
  updateSettings(patch: GeneralSettingsPatch): GeneralSettingsSnapshot {
    if (patch.displaySize !== undefined && !isValidDisplaySize(patch.displaySize)) {
      throw new Error(
        `表示サイズは ${Math.round(DISPLAY_SIZE_MIN * 100)}〜${Math.round(
          DISPLAY_SIZE_MAX * 100,
        )}% の範囲で指定してください。`,
      );
    }

    // clickThrough は config を直接書かず既存の入口へ渡す(冒頭コメント参照)。
    if (patch.clickThrough !== undefined) {
      this.deps.setClickThrough(patch.clickThrough);
    }

    const sizeChanged =
      patch.displaySize !== undefined &&
      patch.displaySize !== this.deps.configStore.current.general.displaySize;

    this.deps.configStore.update((draft) => {
      if (patch.themeMode !== undefined) {
        draft.general.themeMode = patch.themeMode;
      }
      if (patch.displaySize !== undefined) {
        draft.general.displaySize = patch.displaySize;
      }
      if (patch.autostart !== undefined) {
        draft.general.autostart = patch.autostart;
      }
    });

    // 表示サイズはウィンドウの物理サイズを決めるため、config だけでは画面に反映されない。
    if (sizeChanged) {
      this.deps.applyDisplaySize();
    }

    // 自動起動は**OSへ実際に登録/解除する**(config だけ書くと嘘になる)。
    // 未対応環境(開発実行)では登録を試みない。UI側は autostartSupported を見て断り書きを出す。
    if (patch.autostart !== undefined && this.deps.isAutostartSupported()) {
      this.deps.setLoginItem(patch.autostart);
    }

    return this.getSnapshot();
  }
}
