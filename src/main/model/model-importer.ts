/**
 * モデル取り込みのオーケストレーション(FR-5 モデル管理タブ 第2段階a: Live2D)。
 * 列挙・自動マッピング・manifest 生成は live2d-import.ts(Electron非依存)に委譲し、ここは
 * 「フォルダを userData/models/<uuid> へ複製し、config にスロットを足す」流れを受け持つ。
 *
 * **Electron 非依存に保つ**(ダイアログは注入)。コピー・config 更新・列挙はすべて fs と純粋関数で、
 * GUIを伴わない検証ができる(.claude/rules/build-commands.md)。
 *
 * スコープ(第2段階a): **Live2D の「フォルダ」取り込み**。zip 取り込みと、スプライトセットの
 * 生成パイプライン(spriteset-pipeline.md)は後続。この非対称は形式の性質に由来する正当なもの
 * (自動マッピングは Live2D のみ。model-mapping-ui.md 論点4)。
 */

import fs from 'node:fs';
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
} from './live2d-import';

/**
 * Live2D の基準解像度の暫定既定値。
 *
 * **⚠️ 発見した設計上の gap(実測)**: character-window.md 案2 は「Live2D の baseResolution は
 * 取り込み時に model3.json から読む」としているが、実測の結果 **model3.json はキャンバス寸法を
 * 持たず**、moc3 から正確に読むには Cubism Core ランタイム(`csmReadCanvasInfo`)が要る。
 * Core は npm に無く現状バンドルもしていないため、**取り込み時に正確なサイズを得られない**。
 * 推測でオフセットを決め打ちしない(constraints.md「推測で書かない」)ため、当面は
 * FALLBACK_BASE_RESOLUTION と同じ 400×400 を入れる。正確なサイズの取得(Renderer が初回ロード後に
 * 実サイズを報告する、または Cubism Core を導入する)は別タスクで詰める。character-window.ts の
 * FALLBACK_BASE_RESOLUTION と同値だが、あちらは electron 依存ファイルにあるため(Electron非依存を
 * 保つ都合で)ここで別途定義する。
 */
export const LIVE2D_IMPORT_FALLBACK_BASE_RESOLUTION = { width: 400, height: 400 };

export interface ModelImporterDeps {
  configStore: ConfigStore;
  /** userData/models の絶対パス。 */
  modelsRoot: string;
  /** 取り込むフォルダをネイティブダイアログで選ぶ(キャンセルは null)。Electron を注入する。 */
  chooseModelFolder: () => Promise<string | null>;
  /** スロット id の生成(既定は randomUUID。テストで固定するため注入可能)。 */
  generateId?: () => string;
}

export interface ImportResult {
  /** 取り込みが行われたか(ダイアログのキャンセルは false)。 */
  imported: boolean;
  /** 部分的な問題の申告(idle モーション欠落等)。無ければ null。UIへ返す。 */
  warning: string | null;
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

  /**
   * 指定フォルダを Live2D モデルとして取り込む(ダイアログ非依存。テストの入口でもある)。
   * 列挙 → 自動マッピング → manifest 検証 → userData/models/<uuid> へ複製 → config へスロット追加。
   */
  importLive2dFromFolder(srcDir: string): ImportResult {
    // 上限チェックを最初に行う(コピーしてから弾かない)。
    if (this.deps.configStore.current.model.slots.length >= MAX_MODEL_SLOTS) {
      throw new Error(`モデルは最大 ${MAX_MODEL_SLOTS} 体までです。追加するには、どれかを削除してください。`);
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
      name: path.basename(srcDir),
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
