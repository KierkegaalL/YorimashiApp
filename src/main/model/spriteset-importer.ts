/**
 * スプライトセット取り込みのオーケストレーション(FR-5 モデル管理タブ 第2段階b: Main側の生成コア)。
 * spriteset-pipeline.md 手順4後段以降: 色キー抜き済みのフレーム列(感情ごと)を受け取り、
 *   1. 感情ごとにアニメーションWebPへエンコード(spriteset-encode.ts)
 *   2. `userData/models/<uuid>/<emotion>.webp` へ書き出し
 *   3. manifest.json(スプライトセット形式・data.md 2.2)を生成・検証して書き出し
 *   4. config へスロットを追加(baseResolution は idle クリップの実寸から)
 * までを受け持つ。
 *
 * **工程分担(正当な非対称)**: デコード(手順4前段=WebCodecs)と色キー抜き(手順4中段=color-key.ts を
 * ImageData 上で)は Renderer 側(secure context 前提)で行い、IPC でフレームが届く。よってここは
 * **キー抜き済みフレームを前提に**エンコード以降だけを担う。IPC/preload/取り込みUI の配線は 2b-2。
 * 本クラスは electron を import せず(注入で完結)、node で直接実行してオフスクリーン検証できる。
 *
 * **Live2D との非対称は正当**: 生成パイプラインはスプライトセット専用で、Live2D(完成済みモデルを
 * フォルダ取り込みするだけ=model-importer.ts)に対応物を持たない(spriteset-pipeline.md / constraints.md)。
 * スロット追加・上限チェック・アクティブ解決といった**形式共通部**は両 importer で同じ扱い。
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ConfigStore } from '../config-store';
import { EMOTION_STATES, FALLBACK_STATE, type EmotionState } from '../../shared/emotions';
import { ManifestSchema, type SpritesetManifest } from '../../shared/manifest';
import { MAX_MODEL_SLOTS } from '../../shared/model-manage';
import type { ModelSlot } from '../../shared/config-schema';
import { encodeAnimatedWebp, type AnimatedWebpOptions, type EncodedFrame } from './spriteset-encode';
import type { ImportResult } from './model-importer';

/**
 * 生成manifestのクリップ既定(loop / returnTo)。data.md 2.2 / lipsync.md の表を写したもの。
 * `loop` は素材の再生方法、`returnTo` は一過性クリップ再生後の戻り先(状態遷移のヒント)。
 * idle / confident / tired / thinking / panic / sleepy は loop:true、
 * happy / proud / worried / curious は loop:false + returnTo:idle。
 */
const CLIP_DEFAULTS: Record<EmotionState, { loop: boolean; returnTo?: EmotionState }> = {
  idle: { loop: true },
  confident: { loop: true },
  tired: { loop: true },
  thinking: { loop: true },
  panic: { loop: true },
  sleepy: { loop: true },
  happy: { loop: false, returnTo: 'idle' },
  proud: { loop: false, returnTo: 'idle' },
  worried: { loop: false, returnTo: 'idle' },
  curious: { loop: false, returnTo: 'idle' },
};

/** 1感情ぶんの入力(色キー抜き済みフレーム列)。Renderer から IPC で届く形(2b-2 で配線)。 */
export interface SpritesetEmotionInput {
  /** エンコード済み静止画フレーム(color-key 適用済み・アルファ付き)。1枚以上。 */
  frames: EncodedFrame[];
  /** 各フレームの表示時間(ms)。frames と同数。 */
  delayMs: number[];
  /** フレームの幅(px)。全感情で一致させること(単一 baseResolution のため)。 */
  width: number;
  /** フレームの高さ(px)。 */
  height: number;
}

/** 感情→入力。idle は必須(C-18)。他は欠けてよく、実行時に idle へフォールバックする。 */
export type SpritesetInputs = Partial<Record<EmotionState, SpritesetEmotionInput>>;

export interface SpritesetImporterDeps {
  configStore: ConfigStore;
  /** userData/models の絶対パス。 */
  modelsRoot: string;
  /** スロット id の生成(既定 randomUUID。テストで固定するため注入可能)。 */
  generateId?: () => string;
  /** エンコーダ(既定 encodeAnimatedWebp。テストで sharp を避けるため注入可能)。 */
  encode?: (frames: EncodedFrame[], options: AnimatedWebpOptions) => Promise<Buffer>;
}

export class SpritesetImporter {
  constructor(private readonly deps: SpritesetImporterDeps) {}

  /**
   * キー抜き済みフレーム(感情ごと)からスプライトセットモデルを取り込む。
   * @param name スロット名(モデルの表示名)。
   * @param inputs 感情→フレーム列。idle 必須。
   */
  async importSpriteset(name: string, inputs: SpritesetInputs): Promise<ImportResult> {
    // 上限チェックを最初に(コピー・エンコードしてから弾かない)。
    if (this.deps.configStore.current.model.slots.length >= MAX_MODEL_SLOTS) {
      throw new Error(`モデルは最大 ${MAX_MODEL_SLOTS} 体までです。追加するには、どれかを削除してください。`);
    }

    // idle 必須(C-18: 全状態のフォールバック先)。
    const idle = inputs[FALLBACK_STATE];
    if (!idle) {
      throw new Error('idle(待機)のクリップは必須です。少なくとも idle の動画を取り込んでください。');
    }
    // baseResolution は idle の実寸。他クリップは同寸でなければ矛盾する(単一 baseResolution のため)。
    const baseResolution = { width: idle.width, height: idle.height };

    const encode = this.deps.encode ?? encodeAnimatedWebp;
    const id = (this.deps.generateId ?? randomUUID)();
    const destDir = path.join(this.deps.modelsRoot, id);

    // 先に全感情をエンコードしてから書き出す(途中失敗で中途半端なフォルダを残さない)。
    const clips: SpritesetManifest['clips'] = {};
    const files: { file: string; buffer: Buffer }[] = [];
    for (const state of EMOTION_STATES) {
      const input = inputs[state];
      if (!input) {
        continue; // 未提供の感情は欠落のまま(実行時 idle へフォールバック)。
      }
      if (input.width !== baseResolution.width || input.height !== baseResolution.height) {
        throw new Error(
          `${state} のフレーム寸法(${input.width}×${input.height})が idle(${baseResolution.width}×${baseResolution.height})と一致しません。全クリップを同じ寸法にしてください。`,
        );
      }
      const clipDefault = CLIP_DEFAULTS[state];
      const buffer = await encode(input.frames, { loop: clipDefault.loop, delayMs: input.delayMs });
      const file = `${state}.webp`;
      files.push({ file, buffer });
      clips[state] = {
        file,
        loop: clipDefault.loop,
        ...(clipDefault.returnTo ? { returnTo: clipDefault.returnTo } : {}),
      };
    }

    const manifest: SpritesetManifest = { renderType: 'spriteset', baseResolution, clips };
    // idle 必須・型を満たすことを書き出し前に確認する。
    ManifestSchema.parse(manifest);

    // ここから書き込み。
    fs.mkdirSync(destDir, { recursive: true });
    for (const { file, buffer } of files) {
      fs.writeFileSync(path.join(destDir, file), buffer);
    }
    fs.writeFileSync(path.join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const slot: ModelSlot = {
      id,
      name,
      renderType: 'spriteset',
      // cubismVersion は Live2D 専用のため付けない(スキーマ上 optional)。
      baseResolution,
      installedDir: id,
      mappingFile: 'manifest.json',
      assignedAdapter: null,
    };
    this.deps.configStore.update((draft) => {
      draft.model.slots.push(slot);
    });

    return { imported: true, warning: null };
  }
}
