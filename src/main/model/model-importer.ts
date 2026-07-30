/**
 * モデル取り込みのオーケストレーション(FR-5 モデル管理タブ 第2段階a: Live2D)。
 * 列挙・自動マッピング・manifest 生成は live2d-import.ts(Electron非依存)に委譲し、ここは
 * 「フォルダを userData/models/<uuid> へ複製し、config にスロットを足す」流れを受け持つ。
 *
 * **Electron 非依存に保つ**(ダイアログは注入)。コピー・config 更新・列挙はすべて fs と純粋関数で、
 * GUIを伴わない検証ができる(.claude/rules/build-commands.md)。
 *
 * スコープ: **Live2D の「フォルダ」取り込み**(第2段階a)と **「zip」取り込み**(要件定義書
 * 「フォルダ/zipドロップで取り込み(zip-slip対策あり)」)。zip は隔離した一時ディレクトリへ
 * **検証してから展開**(zip-archive.ts)し、モデルルートを見つけてフォルダ取り込みへ合流させる
 * ため、取り込み後の扱いは両者で完全に同じになる。
 *
 * スプライトセットの生成パイプライン(spriteset-pipeline.md)はここに対応物を持たない。この非対称は
 * 形式の性質に由来する正当なもの(自動マッピングは Live2D のみ=model-mapping-ui.md 論点4。
 * スプライトセットは動画から生成するためアーカイブを受け取る導線自体が無い)。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ConfigStore } from '../config-store';
import { ManifestSchema } from '../../shared/manifest';
import { MAX_MODEL_SLOTS } from '../../shared/model-manage';
import type { ModelSlot } from '../../shared/config-schema';
import {
  autoMapLive2d,
  buildLive2dManifest,
  enumerateLive2d,
  findLive2dModelRoot,
} from './live2d-import';
import { extractZipSafely, inspectExtracted, MAX_UNCOMPRESSED_BYTES } from './zip-archive';

/**
 * Live2D の基準解像度の暫定既定値。
 *
 * **⚠️ 発見した設計上の gap(実測)**: character-window.md 案2 は「Live2D の baseResolution は
 * 取り込み時に model3.json から読む」としているが、実測の結果 **model3.json はキャンバス寸法を
 * 持たず**、moc3 から正確に読むには Cubism Core ランタイム(`csmReadCanvasInfo`)が要る。
 * Core は npm に無く現状バンドルもしていないため、**取り込み時に正確なサイズを得られない**。
 * 推測でオフセットを決め打ちしない(constraints.md「推測で書かない」)ため、当面は
 * FALLBACK_BASE_RESOLUTION と同じ 400×400 を入れる。character-window.ts の
 * FALLBACK_BASE_RESOLUTION と同値だが、あちらは electron 依存ファイルにあるため(Electron非依存を
 * 保つ都合で)ここで別途定義する。
 *
 * **決着(2026-07-30)**: 「Renderer が初回ロード後に実サイズを報告する」案で実装した(Cubism Core
 * 導入は見送り。取り込み=このファイルの処理はElectron非依存に保つ都合上、Coreをここへ持ち込みたく
 * ない)。`Live2DRenderer.loadModel()`がIPC(`CharacterReportLive2dSize`)で実測値を送り、
 * `character-window.ts`の`normalizeLive2dBaseResolution()`がこの暫定値を実測ベースの値へ書き換える。
 * この暫定値自体は変更不要(初回描画までの一時的なプレースホルダーとして機能し続ける)。
 */
export const LIVE2D_IMPORT_FALLBACK_BASE_RESOLUTION = { width: 400, height: 400 };

export interface ModelImporterDeps {
  configStore: ConfigStore;
  /** userData/models の絶対パス。 */
  modelsRoot: string;
  /** 取り込むフォルダをネイティブダイアログで選ぶ(キャンセルは null)。Electron を注入する。 */
  chooseModelFolder: () => Promise<string | null>;
  /** 取り込む zip をネイティブダイアログで選ぶ(キャンセルは null)。Electron を注入する。 */
  chooseModelArchive?: () => Promise<string | null>;
  /** スロット id の生成(既定は randomUUID。テストで固定するため注入可能)。 */
  generateId?: () => string;
}

export interface ImportResult {
  /** 取り込みが行われたか(ダイアログのキャンセルは false)。 */
  imported: boolean;
  /** 部分的な問題の申告(idle モーション欠落等)。無ければ null。UIへ返す。 */
  warning: string | null;
}

/** zip のファイル名から拡張子を落としてスロット名にする(空になるときはフォールバック)。 */
function zipDisplayName(zipPath: string): string {
  const base = path.basename(zipPath).replace(/\.zip$/i, '').trim();
  return base.length > 0 ? base : '新しいモデル';
}

export class ModelImporter {
  constructor(private readonly deps: ModelImporterDeps) {}

  /** ネイティブダイアログでフォルダを選ばせ、Live2D モデルとして取り込む。 */
  async importLive2dFromDialog(): Promise<ImportResult> {
    const folder = await this.deps.chooseModelFolder();
    if (folder === null) {
      return { imported: false, warning: null };
    }
    return this.importLive2dFromFolder(folder);
  }

  /** ネイティブダイアログで zip を選ばせ、Live2D モデルとして取り込む。 */
  async importLive2dFromArchiveDialog(): Promise<ImportResult> {
    if (!this.deps.chooseModelArchive) {
      throw new Error('zip 取り込みのダイアログが利用できません。');
    }
    const zipPath = await this.deps.chooseModelArchive();
    if (zipPath === null) {
      return { imported: false, warning: null };
    }
    return this.importLive2dFromZip(zipPath);
  }

  /**
   * zip を Live2D モデルとして取り込む(ダイアログ非依存。テストの入口でもある)。
   *
   * **隔離した一時ディレクトリへ検証してから展開**し(zip-archive.ts が zip-slip とシンボリックリンクを
   * 拒否する。security.md 6章)、モデル定義のあるディレクトリを見つけてから
   * `importLive2dFromFolder` へ合流する。**取り込み後の扱いはフォルダ取り込みと完全に同じ**になり、
   * 列挙・自動マッピング・manifest 検証・パス逸脱検証が二重に実装されない。
   *
   * スロット名は**zip のファイル名(拡張子なし)**を使う。一時ディレクトリ名(`yorimashi-model-XXXX`)が
   * そのままモデル名になるのを避けるため。
   */
  async importLive2dFromZip(zipPath: string): Promise<ImportResult> {
    // 上限チェックを最初に行う(展開してから弾かない)。
    if (this.deps.configStore.current.model.slots.length >= MAX_MODEL_SLOTS) {
      throw new Error(`モデルは最大 ${MAX_MODEL_SLOTS} 体までです。追加するには、どれかを削除してください。`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yorimashi-model-'));
    try {
      await extractZipSafely(zipPath, tmpDir);
      const modelRoot = findLive2dModelRoot(tmpDir);
      // extractZipSafely が展開直後(tmpDir全体)に既にシンボリックリンク・サイズ検査を
      // 済ませているため、importLive2dFromFolder 側での再検査は省略する(同じツリーの二重走査を
      // 避ける。reviewer指摘・2026-07-30)。
      return this.importLive2dFromFolder(modelRoot, zipDisplayName(zipPath), { skipSymlinkCheck: true });
    } finally {
      // 成否によらず一時ディレクトリを消す(userData ではなく OS の temp だが、残す理由が無い)。
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * 指定フォルダを Live2D モデルとして取り込む(ダイアログ非依存。テストの入口でもある)。
   * 列挙 → 自動マッピング → manifest 検証 → userData/models/<uuid> へ複製 → config へスロット追加。
   *
   * @param displayName スロット名の上書き。省略時はフォルダ名。zip 取り込みでは
   *   一時ディレクトリ名が入らないよう zip のファイル名を渡す。
   * @param options.skipSymlinkCheck 呼び出し元(zip取り込み)が展開直後に既に
   *   シンボリックリンク・サイズ検査を済ませている場合に true。フォルダ取り込みの直接呼び出し
   *   (ダイアログ経由)では常に false(検査する)。
   */
  importLive2dFromFolder(
    srcDir: string,
    displayName?: string,
    options?: { skipSymlinkCheck?: boolean },
  ): ImportResult {
    // 上限チェックを最初に行う(コピーしてから弾かない)。
    if (this.deps.configStore.current.model.slots.length >= MAX_MODEL_SLOTS) {
      throw new Error(`モデルは最大 ${MAX_MODEL_SLOTS} 体までです。追加するには、どれかを削除してください。`);
    }

    if (!options?.skipSymlinkCheck) {
      // シンボリックリンク対策(zip-archive.ts の inspectExtracted を共用。security.md 6章)。
      // 「フォルダ」取り込みは fs.cpSync で複製するだけの経路のため、この検査が無いと外部を指す
      // シンボリックリンクがそのまま複製され、複製後に /models/* 配信(stat() がリンクを辿る)
      // 経由で外部ファイルが読まれうる(zip取り込みとの非対称・reviewer指摘で発覚。2026-07-30)。
      // UnsafeArchiveError は Error のサブクラスなので、そのまま呼び出し元(IPCハンドラ)へ
      // 素通しして問題ない(message はそのままUIへ出せる日本語)。
      const srcBytes = inspectExtracted(srcDir);
      if (srcBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new Error(
          `モデルのサイズが大きすぎます(${Math.round(srcBytes / 1024 / 1024)}MB)。取り込みを中止しました。`,
        );
      }
    }

    // 列挙(パス逸脱の検証を含む)→ 自動マッピング → manifest。
    const enumeration = enumerateLive2d(srcDir);
    const autoMap = autoMapLive2d(enumeration.motions, enumeration.expressions);
    const manifest = buildLive2dManifest(enumeration, autoMap);
    // 生成した manifest がスキーマ(idle 必須等)を満たすことを確認してから書き出す。
    ManifestSchema.parse(manifest);

    // userData/models/<uuid> へフォルダごと複製する。src の外を参照するファイル(Haru の Sound 等)は
    // src 配下に無いので複製されない(enumerate 側でレンダリング必須アセットの逸脱は既に弾いている)。
    const id = (this.deps.generateId ?? randomUUID)();
    const destDir = path.join(this.deps.modelsRoot, id);
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(srcDir, destDir, { recursive: true });

    // manifest.json を書き出す(既存の同名があっても、アプリが解釈する正本はこちら)。
    fs.writeFileSync(path.join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // config へスロットを追加する。
    const slot: ModelSlot = {
      id,
      name: displayName ?? path.basename(srcDir),
      renderType: 'live2d',
      cubismVersion: enumeration.cubismVersion,
      baseResolution: LIVE2D_IMPORT_FALLBACK_BASE_RESOLUTION,
      installedDir: id,
      mappingFile: 'manifest.json',
      assignedAdapter: null,
    };
    this.deps.configStore.update((draft) => {
      draft.model.slots.push(slot);
    });

    // idle モーションが無いモデルは、モーション終了後のフォールバック先が無く固まりうる
    // (lipsync.md「尽きたときの挙動」)。取り込み自体は通すが、UIへ注意を返す。
    const warning = autoMap.idleMotionMissing
      ? '取り込みました。ただし idle(待機)に対応するモーションが自動検出できませんでした。モデル管理タブで割り当ててください。'
      : null;
    return { imported: true, warning };
  }
}
