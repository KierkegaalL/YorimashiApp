/**
 * config.json の永続化ストア(FR-10)。スキーマの正本は src/shared/config-schema.ts
 * (= docs/data.md 1章)。本モジュールは「ディスク↔検証済みAppConfig」の入出力のみを担う。
 *
 * 方針:
 * - ロード時は JSON パース → マイグレーション → Zod 検証 の順。欠けたフィールドは
 *   スキーマの `.default()`/`.prefault()` が補完する(config-schema.ts の実測メモ参照)。
 * - ファイルが無ければ既定値(createDefaultConfig())を書き出して起動する。
 * - 破損(パース不能・検証不能・未知のschemaVersion)時は、元ファイルを退避してから
 *   既定値で起動し、警告をログに残す。**黙ってフォールバックせず、退避先を明示する**
 *   (constraints.md「アプリが自分の状態について嘘をつかない」)。
 * - 書き込みは一時ファイル + rename でアトミックに行う(書き込み途中のクラッシュで
 *   config.json を空/半端にしない)。
 * - パーミッションは 0600。config.json は real 時に `chatAdapter.anthropicApiKey` を
 *   保持しうるため、`.token`・logs(いずれも0600。data.md 3章)と同じ扱いにする。
 *
 * 形式非依存: モデルスロット(live2d/spriteset)の中身を解釈せずそのまま永続化するだけで、
 * 形式による分岐を持たない。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import fs from 'node:fs';
import path from 'node:path';

import { AppConfigSchema, createDefaultConfig, type AppConfig } from '../shared/config-schema';
import { tryChmod600 } from './fs-permissions';

export const CONFIG_FILENAME = 'config.json';

/**
 * 現行スキーマの schemaVersion。config-schema.ts の `schemaVersion: z.literal(N)` と
 * 一致させること。スキーマを上げる際は MIGRATIONS にも移行関数を追加する。
 */
export const CURRENT_SCHEMA_VERSION = 1;

/** 生JSON(検証前)。マイグレーションはこの型の上で行う。 */
type RawConfig = Record<string, unknown>;

/**
 * 段階マイグレーション。MIGRATIONS[i] は schemaVersion i の生configを i+1 へ変換する。
 * v1 が最初のスキーマのため、現時点では空(=マイグレーション不要)。
 * 将来スキーマを v2 に上げる際は、v1→v2 の変換を MIGRATIONS[1] として追加する。
 */
const MIGRATIONS: Array<(raw: RawConfig) => RawConfig> = [];

/**
 * 生configの schemaVersion を現行まで引き上げる。
 * - 現行と同じ: そのまま返す(Zod検証は呼び出し側で行う)。
 * - 現行未満: 該当する移行関数を順に適用する。
 * - 現行超過(未知の新しい形式): 破損扱いにするため例外を投げる
 *   (古いアプリで新しいconfigを黙って上書きし、データを失わせない)。
 */
function migrate(raw: RawConfig): RawConfig {
  const rawVersion = raw['schemaVersion'];
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1) {
    throw new Error(`schemaVersion が不正です: ${JSON.stringify(rawVersion)}`);
  }
  if (rawVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `config.json のバージョン(${rawVersion})がこのアプリの対応バージョン(${CURRENT_SCHEMA_VERSION})より新しいため読み込めません`,
    );
  }

  let migrated = raw;
  for (let v = rawVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      throw new Error(`schemaVersion ${v} → ${v + 1} のマイグレーションが未定義です`);
    }
    migrated = step(migrated);
  }
  return migrated;
}

/**
 * config.json の読み書きを担うストア。Mainプロセスの起動時に load() で一度生成し、
 * 以降は current で参照、update() で変更を永続化する。
 */
export class ConfigStore {
  private readonly filePath: string;
  private config: AppConfig;

  private constructor(filePath: string, config: AppConfig) {
    this.filePath = filePath;
    this.config = config;
  }

  /**
   * userDataDir配下の config.json をロードする。
   * 無ければ既定値を書き出し、破損していれば退避して既定値で復旧する。
   */
  static load(userDataDir: string): ConfigStore {
    const filePath = path.join(userDataDir, CONFIG_FILENAME);

    let contents: string;
    try {
      contents = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // 未作成 → 既定値を書き出して起動する。
      const store = new ConfigStore(filePath, createDefaultConfig());
      store.persist();
      return store;
    }

    let config: AppConfig;
    try {
      const raw: unknown = JSON.parse(contents);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('config.json がオブジェクトではありません');
      }
      const migrated = migrate(raw as RawConfig);
      config = AppConfigSchema.parse(migrated);
    } catch (err) {
      // パース不能・検証不能・未知バージョン。元ファイルを退避し既定値で復旧する。
      // **単一フィールドの範囲違反でも全設定が初期化される**(displaySize等、値の範囲を
      // 狭めるスキーマ変更をするたびにこの経路が発火しやすくなる。model-mapping-ui.md
      // 「検出した不整合」1の決着で displaySize を 0.1-2.0→0.2-1.0 に狭めた際に指摘された)。
      // 現状は影響が小さい(displaySizeを直接編集できるUIがまだ無いため実際には起きない)が、
      // 将来UIが増えて手動編集や外部ツールでの書き換えが起きうるようになったら、
      // フィールド単位でのフォールバック(壊れたキーだけ既定値に差し替える)を検討する。
      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(filePath, backupPath);
        console.error(
          `[config] config.json を読み込めませんでした。${path.basename(backupPath)} へ退避し既定値で起動します:`,
          err,
        );
      } catch (renameErr) {
        console.error('[config] 破損した config.json の退避に失敗しました:', renameErr);
      }
      const store = new ConfigStore(filePath, createDefaultConfig());
      store.persist();
      return store;
    }

    // ここに来た時点で config は有効。マイグレーションや既定値補完で内容が変わっている
    // 可能性があるため、正規形を書き戻して次回以降の読み込みを安定させる。
    // これは純粋なI/O処理であり「破損」ではないため、失敗しても退避・リセットはしない
    // (一過性のI/Oエラーで有効な設定を壊さない。上のcatchと区別する)。
    const store = new ConfigStore(filePath, config);
    try {
      store.persist();
    } catch (persistErr) {
      console.error(
        '[config] 正規化書き戻しに失敗しました(設定は有効なため起動を継続します):',
        persistErr,
      );
    }
    return store;
  }

  /** 現在の検証済み config(不変とみなして扱う。変更は update() 経由で行う)。 */
  get current(): AppConfig {
    return this.config;
  }

  /**
   * config を変更して永続化する。draft は現在の config の深いコピーで、mutate 内で
   * 自由に書き換えてよい。変更後は Zod で再検証してからアトミックに書き込む。
   * 検証に失敗した場合は例外を投げ、ディスクと保持中の config は変更しない。
   */
  update(mutate: (draft: AppConfig) => void): AppConfig {
    const draft = structuredClone(this.config);
    mutate(draft);
    const validated = AppConfigSchema.parse(draft);

    // 先にディスクへ書き込み、成功した場合のみメモリを確定させる。書き込みが失敗したら
    // メモリ上のconfigは元に戻す(current とディスクの乖離を防ぐ)。
    const previous = this.config;
    this.config = validated;
    try {
      this.persist();
    } catch (err) {
      this.config = previous;
      throw err;
    }
    return validated;
  }

  /** 現在の config を config.json へアトミック(tmp + rename)に書き込む。 */
  private persist(): void {
    const json = `${JSON.stringify(this.config, null, 2)}\n`;
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, json, { mode: 0o600 });
    tryChmod600(tmpPath);
    // rename は同一ファイルシステム上でアトミック。既存の config.json を置き換える。
    fs.renameSync(tmpPath, this.filePath);
    tryChmod600(this.filePath);
  }
}
