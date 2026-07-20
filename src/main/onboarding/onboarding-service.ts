/**
 * オンボーディング(FR-14)の Main 側サービス。
 * 詳細設計の正本: docs/detailed-design/onboarding.md。
 *
 * 担うのは Renderer にできない3つだけ:
 *  1. 監視するプロジェクトをネイティブのディレクトリ選択で選ばせる
 *  2. そのプロジェクトへ `dispatch.sh` を配置する
 *  3. hooks設定が実際に済んでいるかを**ディスクを見て**判定する
 *
 * **書き込むのは dispatch.sh だけ。** `.claude/settings.json` は利用者の既存ファイルであり、
 * 既にhooksが設定されている可能性がある。上書きは既存設定の破壊になるため、アプリは
 * コピー用テキストを提示するに留める(onboarding.md 論点3 / hooks-settings.ts)。
 *
 * > **注意**: ここで書き込むのは**アプリの利用者側のプロジェクト**の `.claude/` であり、
 * > このリポジトリ自身の開発用hooksとは別物(CLAUDE.md)。書き込み先は「利用者が
 * > ネイティブダイアログで自ら選んだディレクトリ」に限定する(下記 isWatchedProject)。
 *
 * 形式非依存: オンボーディングは Live2D/スプライトセットのどちらにも分岐しない
 * (onboarding.md「形式による分岐について」)。モデル取り込み自体はモデル管理タブの管轄で、
 * この画面は導線を見せるだけなので、対称性チェック(CLAUDE.md 原則4)の対象外。
 */

import fs from 'node:fs';
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';

import type { ConfigStore } from '../config-store';
import { buildDispatchScript } from '../code-adapter/dispatch-script';
import { buildHooksSettingsSnippet, DISPATCH_SCRIPT_REL_PATH } from '../code-adapter/hooks-settings';
import type {
  DispatchInstallResult,
  OnboardingHooksProbe,
  OnboardingSnapshot,
} from '../../shared/onboarding';

/** 利用者プロジェクト側の settings.json(**このリポジトリのものではない**)。 */
const USER_SETTINGS_REL_PATH = '.claude/settings.json';

export interface OnboardingServiceDeps {
  configStore: ConfigStore;
  /** アプリの userData ディレクトリ。dispatch.sh に埋め込む(秘密ではない)。 */
  userDataDir: string;
  /** ディレクトリ選択ダイアログの親ウィンドウ(Control Panel)。 */
  getParentWindow: () => BrowserWindow | null;
}

export class OnboardingService {
  private readonly deps: OnboardingServiceDeps;

  constructor(deps: OnboardingServiceDeps) {
    this.deps = deps;
  }

  /** 画面描画に必要な現在の状態。hooks の項目はすべてディスクの実測値。 */
  getSnapshot(): OnboardingSnapshot {
    const config = this.deps.configStore.current;
    return {
      completed: config.onboarding.completed,
      activeAdapter: config.activeAdapter,
      chatMode: config.chatAdapter.mode,
      modelCount: config.model.slots.length,
      hooks: config.codeAdapter.watchedProjectPaths.map((p) => this.probeProject(p)),
      settingsSnippet: this.getSettingsSnippet(),
      dispatchScriptRelPath: DISPATCH_SCRIPT_REL_PATH,
    };
  }

  /**
   * 貼り付け用の hooks 設定だけを返す(クリップボードへのコピー用)。
   * `getSnapshot()` は監視対象すべてに同期I/Oのプローブを走らせるため、
   * 文字列が欲しいだけの経路では使わない。
   */
  getSettingsSnippet(): string {
    return buildHooksSettingsSnippet();
  }

  /**
   * 監視するプロジェクトをネイティブダイアログで選ばせ、watchedProjectPaths へ追加する。
   * キャンセルなら null。**このダイアログだけが watchedProjectPaths の入口**であり、
   * dispatch.sh の書き込み先を利用者の明示選択に限定する根拠になっている。
   */
  async chooseProject(): Promise<string | null> {
    const parent = this.deps.getParentWindow();
    const options: Electron.OpenDialogOptions = {
      title: '監視するプロジェクトを選ぶ',
      message: 'Claude Code で作業するプロジェクトのフォルダを選んでください。',
      properties: ['openDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);

    const picked = result.canceled ? undefined : result.filePaths[0];
    if (picked === undefined) {
      return null;
    }
    const resolved = path.resolve(picked);

    this.deps.configStore.update((draft) => {
      const already = draft.codeAdapter.watchedProjectPaths.some(
        (p) => path.resolve(p) === resolved,
      );
      if (!already) {
        draft.codeAdapter.watchedProjectPaths.push(resolved);
      }
    });
    return resolved;
  }

  /**
   * `<project>/.claude/hooks/dispatch.sh` を配置する。
   *
   * 既存ファイルの内容が異なる場合は `exists-differs` を返して**書き込まない**。
   * 利用者が手を入れている可能性があり、黙って潰さないため。上書きは overwrite: true の
   * 明示的な再要求でのみ行う。
   */
  installDispatchScript(projectPath: string, overwrite = false): DispatchInstallResult {
    const resolvedProject = path.resolve(projectPath);
    const target = path.join(resolvedProject, DISPATCH_SCRIPT_REL_PATH);

    // 書き込み先は「利用者がダイアログで選んだプロジェクト」に限る。Renderer から
    // 任意のパスを渡されても書き込まない(このリポジトリ自身の .claude/ を含む)。
    if (!this.isWatchedProject(resolvedProject)) {
      return { status: 'rejected-unknown-project', path: target };
    }

    const contents = buildDispatchScript(this.deps.userDataDir);

    try {
      const existing = readFileOrNull(target);
      if (existing !== null) {
        if (existing === contents) {
          // 既に同じ内容。パーミッションだけ整えて終わる(手動コピーで実行権が
          // 落ちている場合に、内容が同じという理由で壊れたままにしないため)。
          fs.chmodSync(target, 0o755);
          return { status: 'unchanged', path: target };
        }
        if (!overwrite) {
          return { status: 'exists-differs', path: target };
        }
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      // 実行可能にする。hooks は Claude Code がこのパスを直接実行するため、
      // 実行権が無いと設定どおりでも黙って何も起きない。
      fs.writeFileSync(target, contents, { mode: 0o755 });
      fs.chmodSync(target, 0o755);
      return { status: existing === null ? 'created' : 'updated', path: target };
    } catch (err) {
      return {
        status: 'failed',
        path: target,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * オンボーディングを完了として記録する(スキップ経由でも呼ぶ)。
   * 設定内容から推測できない情報なので config に明示的に持つ(config-schema.ts の注記)。
   */
  complete(): void {
    this.deps.configStore.update((draft) => {
      draft.onboarding.completed = true;
      draft.onboarding.completedAt = new Date().toISOString();
    });
  }

  /** 指定パスが監視対象として登録済みか(ディレクトリ境界ではなく完全一致で判定する)。 */
  private isWatchedProject(resolvedProject: string): boolean {
    return this.deps.configStore.current.codeAdapter.watchedProjectPaths.some(
      (p) => path.resolve(p) === resolvedProject,
    );
  }

  /**
   * プロジェクトのhooks設定状況を調べる。
   *
   * アプリが自力で確認できるのはここまで:
   *  - dispatch.sh が置かれ、**実行可能か**
   *  - settings.json が dispatch.sh を呼ぶ hook を持つか
   * 完了画面はこの実測値だけを根拠に表示する(推測で「設定済み」と言わない)。
   */
  private probeProject(projectPath: string): OnboardingHooksProbe {
    const resolved = path.resolve(projectPath);
    const scriptPath = path.join(resolved, DISPATCH_SCRIPT_REL_PATH);
    const settingsPath = path.join(resolved, USER_SETTINGS_REL_PATH);

    const probe: OnboardingHooksProbe = {
      projectPath: resolved,
      dispatchScriptPlaced: false,
      settingsExists: false,
      settingsReferencesDispatch: false,
      probeError: null,
    };

    try {
      const stat = fs.statSync(scriptPath);
      // 実行権が無ければ「置かれている」と言えない(Claude Codeが実行できない)。
      probe.dispatchScriptPlaced = stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      probe.dispatchScriptPlaced = false; // 未配置。異常ではない
    }

    const settings = readFileOrNull(settingsPath);
    if (settings === null) {
      return probe; // settings.json が無い = 未設定。これも異常ではない
    }
    probe.settingsExists = true;

    try {
      const parsed: unknown = JSON.parse(settings);
      probe.settingsReferencesDispatch = referencesDispatchScript(parsed);
    } catch {
      // 解析できない = 設定されているか**判定できない**。false と断定せず理由を返す
      // (「未設定」と表示すると、実際には設定済みの利用者に嘘をつくことになる)。
      probe.probeError = 'settings.json を解析できませんでした(JSONの形式を確認してください)';
    }
    return probe;
  }
}

/** 読めなければ null(存在しない・権限が無い を区別せず「読めない」として扱う)。 */
function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * settings.json の hooks に dispatch.sh を呼ぶコマンドがあるか。
 *
 * 構造を厳密に辿らず、`hooks` 配下の文字列を再帰的に走査して判定する。Claude Code の
 * hooks 設定は matcher の有無などで形が揺れるうえ、利用者が案内と違う書き方
 * (絶対パス・ラッパー経由)をしていても「設定済み」と認めるべきだから。
 */
function referencesDispatchScript(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null) {
    return false;
  }
  const hooks = (settings as Record<string, unknown>)['hooks'];
  return containsDispatchReference(hooks);
}

function containsDispatchReference(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('dispatch.sh');
  }
  if (Array.isArray(value)) {
    return value.some(containsDispatchReference);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(containsDispatchReference);
  }
  return false;
}
