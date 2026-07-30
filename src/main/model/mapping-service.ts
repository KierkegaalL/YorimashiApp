/**
 * 感情↔モーション/クリップ対応の編集(FR-5 モデル管理タブ 第3段階 Track A)。
 * 正本: docs/detailed-design/model-mapping-ui.md(論点2=Live2Dの選択UI / 論点3=削除導線 /
 *       論点4=自動マッピング)、UIの正: docs/mockups/control-panel.jsx L1098-1177。
 *
 * マッピングの**正本は各モデルの manifest.json**(CLAUDE.md原則3)。編集はすべて
 * `userData/models/<installedDir>/manifest.json` の読み書きで完結し、config.json には複製しない。
 * config はスロットの一覧(installedDir 等)を持つだけで、感情↔対応は持たない。
 *
 * **Electron 非依存に保つ**(fs と純粋関数・共有スキーマのみ)。編集後にキャラクターウィンドウへ
 * 反映する副作用(アクティブモデルなら再読込)は呼び出し元(index.ts)が担う(ModelService と同じ分担)。
 *
 * 形式の非対称(正当): Live2D は候補(モーション/表情名)から選び、自動マッピングを持つ(論点2・4)。
 * スプライトセットは候補の概念が無く、編集は差し替え(Track B)と削除(このTrack A)。この差は
 * 形式の性質に由来する(生成フローがクリップを感情ごとに1:1で作る)。**上限・パス検証・manifest 検証
 * といった形式共通の骨格は両分岐で同じ経路を通す**(片方だけの分岐を持たない)。
 */

import fs from 'node:fs';

import type { ConfigStore } from '../config-store';
import { EMOTION_STATES, FALLBACK_STATE, type EmotionState } from '../../shared/emotions';
import {
  ManifestSchema,
  type Live2dManifest,
  type Manifest,
  type SpritesetManifest,
} from '../../shared/manifest';
import type {
  Live2dEntryPatch,
  Live2dMappingDetail,
  Live2dMappingEntry,
  ModelMappingDetail,
  SpritesetMappingDetail,
  SpritesetMappingEntry,
} from '../../shared/model-mapping';
import type { CharacterBootstrapModel } from '../../shared/bootstrap';
import type { ModelSlot } from '../../shared/config-schema';
import { resolveWithinBase } from '../local-server/safe-path';
import { autoMapLive2d, autoMapLive2dState, enumerateLive2d } from './live2d-import';
import { encodeAnimatedWebp, type AnimatedWebpOptions, type EncodedFrame } from './spriteset-encode';
import { CLIP_DEFAULTS, type SpritesetEmotionInput } from './spriteset-importer';

export interface MappingServiceDeps {
  configStore: ConfigStore;
  /** userData/models の絶対パス。読み書きがこの配下に収まることを検証するために使う。 */
  modelsRoot: string;
  /**
   * アニメーションWebPエンコーダ(既定 encodeAnimatedWebp)。差し替え(setSpritesetClip)で使う。
   * SpritesetImporter と同じく、テストで sharp を避けるため注入可能にする。
   */
  encode?: (frames: EncodedFrame[], options: AnimatedWebpOptions) => Promise<Buffer>;
}

export class MappingService {
  constructor(private readonly deps: MappingServiceDeps) {}

  /**
   * 指定モデルの現在のマッピングを、編集画面が要る形で返す。
   * Live2D はモデル定義ファイルから候補(モーション/表情名)を**再列挙**して同梱する
   * (取り込み時に列挙したものと同じ。config には保存せず表示のたびに列挙し直す)。
   */
  getDetail(modelId: string): ModelMappingDetail {
    const { slot, modelDir } = this.resolveModelDir(modelId);
    const manifest = this.readManifest(modelDir, slot.mappingFile);

    if (manifest.renderType === 'live2d') {
      const { motions, expressions } = enumerateLive2d(modelDir);
      const entries: Live2dMappingEntry[] = EMOTION_STATES.map((state) => {
        const entry = manifest.emotionMap[state];
        return { state, motion: entry?.motion ?? null, expression: entry?.expression ?? null };
      });
      const detail: Live2dMappingDetail = {
        renderType: 'live2d',
        modelId,
        motions,
        expressions,
        entries,
        warning: idleMissingWarning(entries),
      };
      return detail;
    }

    const entries: SpritesetMappingEntry[] = EMOTION_STATES.map((state) => {
      const clip = manifest.clips[state];
      return {
        state,
        mapped: clip !== undefined,
        loop: clip?.loop ?? false,
        // returnTo は manifest スキーマ上 z.string()(EmotionState に絞っていない)。手動編集や
        // バージョン差で全10状態外の文字列が入りうるため、EMOTION_STATES で検証してから型を確定する
        // (Renderer 由来を parseXxx で検証するのと同じ姿勢を、manifest 由来にも適用する)。
        returnTo: toEmotionStateOrNull(clip?.returnTo),
      };
    });
    const detail: SpritesetMappingDetail = { renderType: 'spriteset', modelId, entries };
    return detail;
  }

  /**
   * Live2D の1状態の motion/expression を設定する。両方 null かつ idle 以外なら**未割当に戻す**
   * (emotionMap からキーを外す。実行時は idle へフォールバック。C-18)。idle は必ずキーを残す。
   *
   * **候補に含まれることを検証する**(論点2 の select は候補から選ばせるが、Renderer 由来の値を
   * そのまま manifest へ書かない。細工された IPC で存在しないモーション名を保存させない)。
   */
  setLive2dEntry(modelId: string, state: EmotionState, patch: Live2dEntryPatch): ModelMappingDetail {
    const { slot, modelDir } = this.resolveModelDir(modelId);
    const manifest = this.readManifest(modelDir, slot.mappingFile);
    if (manifest.renderType !== 'live2d') {
      throw new Error('このモデルは Live2D ではないため、モーション/表情の割り当てはできません。');
    }
    const { motions, expressions } = enumerateLive2d(modelDir);
    if (patch.motion !== null && !motions.includes(patch.motion)) {
      throw new Error('指定されたモーションはこのモデルに存在しません。');
    }
    if (patch.expression !== null && !expressions.includes(patch.expression)) {
      throw new Error('指定された表情はこのモデルに存在しません。');
    }

    const emotionMap = { ...manifest.emotionMap };
    if (patch.motion === null && patch.expression === null && state !== FALLBACK_STATE) {
      delete emotionMap[state]; // 未割当に戻す(idle へフォールバック)
    } else {
      emotionMap[state] = { motion: patch.motion, expression: patch.expression };
    }
    const next: Live2dManifest = { ...manifest, emotionMap };
    this.writeManifest(modelDir, slot.mappingFile, next);
    return this.getDetail(modelId);
  }

  /**
   * Live2D の1状態を自動検出でやり直す(論点2「自動に戻す」)。取り込み時の一括自動マッピングと
   * 同じ pickBest を通すため、状態単位のやり直しと Section 単位のやり直しで結果が食い違わない。
   */
  autoRestoreState(modelId: string, state: EmotionState): ModelMappingDetail {
    const { slot, modelDir } = this.resolveModelDir(modelId);
    const manifest = this.readManifest(modelDir, slot.mappingFile);
    if (manifest.renderType !== 'live2d') {
      throw new Error('自動割り当ては Live2D モデルのみで使えます。');
    }
    const { motions, expressions } = enumerateLive2d(modelDir);
    const auto = autoMapLive2dState(state, motions, expressions);
    // 検証・書き込み経路を一本化するため setLive2dEntry を通す(auto の候補は列挙由来なので必ず通る)。
    return this.setLive2dEntry(modelId, state, auto);
  }

  /**
   * Live2D の全10状態を自動検出でやり直す(論点2 Section 単位「自動割り当てをやり直す」)。
   * 取り込み時と同じ autoMapLive2d で emotionMap を作り直す(手動修正はすべて上書きされる。
   * 確認ダイアログは UI 側=MappingEditor が担う)。
   */
  autoRestoreAll(modelId: string): ModelMappingDetail {
    const { slot, modelDir } = this.resolveModelDir(modelId);
    const manifest = this.readManifest(modelDir, slot.mappingFile);
    if (manifest.renderType !== 'live2d') {
      throw new Error('自動割り当ては Live2D モデルのみで使えます。');
    }
    const { motions, expressions } = enumerateLive2d(modelDir);
    const { emotionMap } = autoMapLive2d(motions, expressions);
    const next: Live2dManifest = { ...manifest, emotionMap };
    this.writeManifest(modelDir, slot.mappingFile, next);
    return this.getDetail(modelId);
  }

  /**
   * スプライトセットのクリップを削除する(未割当に戻す。論点3)。manifest の clips からキーを外し、
   * WebP ファイル実体も消す。**idle は削除できない**(C-18: 全状態のフォールバック先)。
   *
   * 手順は「manifest を先に書き換えてからファイルを消す」。逆(先にファイル削除)にすると、
   * manifest の書き込みが失敗したときに「参照はあるのに実体が無い」壊れた状態になりうる。
   * ファイルが消せなくても manifest から参照は外れている(実行時は idle へフォールバックして
   * 破綻しない)ので、残骸は best-effort で消す(console.warn のみ。利用者に見える意味の
   * 削除=「未割当に戻す」は成立している)。
   */
  deleteSpritesetClip(modelId: string, state: EmotionState): ModelMappingDetail {
    if (state === FALLBACK_STATE) {
      throw new Error('idle(待機)は削除できません(全状態のフォールバック先のため必須です)。');
    }
    const { slot, modelDir } = this.resolveModelDir(modelId);
    const manifest = this.readManifest(modelDir, slot.mappingFile);
    if (manifest.renderType !== 'spriteset') {
      throw new Error('このモデルはスプライトセットではないため、クリップの削除はできません。');
    }
    const clip = manifest.clips[state];
    if (clip === undefined) {
      return this.getDetail(modelId); // 既に未割当(冪等)
    }

    const clips = { ...manifest.clips };
    delete clips[state];
    const next: SpritesetManifest = { ...manifest, clips };
    this.writeManifest(modelDir, slot.mappingFile, next);

    // manifest から参照が外れた後にファイル実体を消す(モデルフォルダ内に収まることを検証)。
    const filePath = resolveWithinBase(modelDir, clip.file);
    if (filePath === null) {
      console.warn(`[mapping] クリップファイルが models 配下の外を指すため削除しません: ${clip.file}`);
    } else {
      try {
        fs.rmSync(filePath, { force: true });
      } catch (err) {
        console.warn('[mapping] クリップファイルの削除に失敗しました(参照は外れています):', err);
      }
    }
    return this.getDetail(modelId);
  }

  /**
   * スプライトセットの1クリップを**差し替え/新規設定**する(論点3「変更」)。色キー抜き済みフレーム
   * (Renderer がデコードして渡す。取り込みと同じ経路)からアニメーションWebPを作り、`<state>.webp`
   * へ書いて manifest の clips[state] を更新する。未割当だった状態にも設定できる(「要設定」の解消)。
   *
   * **idle も差し替えできる**(削除とは異なる。C-18 が禁じるのは「idle を消して未割当にする」ことで、
   * idle の中身を別の動画へ替えるのは必須クリップを保ったままなので許される)。
   *
   * **寸法は既存の baseResolution と一致必須**。スプライトセットは単一 baseResolution 前提(1枚の
   * idle 実寸で全クリップが揃う。spriteset-importer.ts)で、寸法違いを混ぜると他クリップと矛盾する。
   * baseResolution を差し替えで動かすと他の全クリップが不整合になるため、動かさず**一致を強制する**
   * (別解像度にしたいなら作り直す。character-window.md の baseResolution 決着と整合)。
   *
   * `loop`/`returnTo` は素材ではなく**状態の性質**(CLIP_DEFAULTS)。差し替えでは再生の意味を変えないため、
   * 既存クリップがあればその値を保ち(手動編集の尊重)、新規なら CLIP_DEFAULTS[state] を使う。
   *
   * 書き込み順は削除と**逆**(先にファイル、後で manifest)。どちらも「manifest の参照に実体が伴わない
   * 状態を作らない」ための順序で、削除は参照を先に外し(失敗時は孤児ファイル=無害)、設定は実体を
   * 先に置く(manifest 書き込みが失敗しても、参照が増えていないので孤児ファイルが残るだけ=無害)。
   */
  async setSpritesetClip(
    modelId: string,
    state: EmotionState,
    input: SpritesetEmotionInput,
  ): Promise<ModelMappingDetail> {
    const { slot, modelDir } = this.resolveModelDir(modelId);
    const manifest = this.readManifest(modelDir, slot.mappingFile);
    if (manifest.renderType !== 'spriteset') {
      throw new Error('このモデルはスプライトセットではないため、クリップの差し替えはできません。');
    }
    const { width: baseW, height: baseH } = manifest.baseResolution;
    if (input.width !== baseW || input.height !== baseH) {
      throw new Error(
        `動画の寸法(${input.width}×${input.height})がこのモデルの基準解像度(${baseW}×${baseH})と一致しません。` +
          '同じ寸法の動画を使うか、別解像度にするならモデルを作り直してください。',
      );
    }

    // 既存クリップがあれば loop/returnTo とファイル名を引き継ぐ(手動編集を尊重・孤児を作らない)。
    const existing = manifest.clips[state];
    const clipDefault = CLIP_DEFAULTS[state];
    const loop = existing?.loop ?? clipDefault.loop;
    const returnTo = existing?.returnTo ?? clipDefault.returnTo;
    const file = existing?.file ?? `${state}.webp`;

    const filePath = resolveWithinBase(modelDir, file);
    if (filePath === null) {
      throw new Error('クリップファイルの場所が想定外のため書き込めません。');
    }

    const encode = this.deps.encode ?? encodeAnimatedWebp;
    const buffer = await encode(input.frames, { loop, delayMs: input.delayMs });

    // 先にファイル実体を書く(上の順序コメント参照)。
    fs.writeFileSync(filePath, buffer);

    const clips = { ...manifest.clips };
    clips[state] = { file, loop, ...(returnTo ? { returnTo } : {}) };
    const next: SpritesetManifest = { ...manifest, clips };
    this.writeManifest(modelDir, slot.mappingFile, next);
    return this.getDetail(modelId);
  }

  /**
   * プレビュー描画(Track C / 論点1)用に、対象モデルの配信情報を返す。他のマッピング系IPCと同じ
   * `resolveModelDir` を通す(モデル存在・パス検証・エラーメッセージを一本化。index.ts に slot 検索を
   * 重複させない)。installedDir/mappingFile はキャラクターウィンドウの bootstrap と同じ最小情報。
   */
  getPreviewContext(modelId: string): CharacterBootstrapModel {
    const { slot } = this.resolveModelDir(modelId);
    return { installedDir: slot.installedDir, mappingFile: slot.mappingFile };
  }

  // ── 内部ヘルパ ─────────────────────────────────────

  /** モデルフォルダの絶対パスを、models 配下に収まることを検証しつつ得る。 */
  private resolveModelDir(modelId: string): { slot: ModelSlot; modelDir: string } {
    const slot = this.deps.configStore.current.model.slots.find((s) => s.id === modelId);
    if (!slot) {
      throw new Error('指定されたモデルは見つかりませんでした。');
    }
    const modelDir = resolveWithinBase(this.deps.modelsRoot, slot.installedDir);
    if (modelDir === null) {
      throw new Error('モデルの保存場所が想定外のため操作できません。');
    }
    return { slot, modelDir };
  }

  /** manifest.json を読み、スキーマ検証して返す(idle 必須等をここでも担保)。 */
  private readManifest(modelDir: string, mappingFile: string): Manifest {
    const manifestPath = resolveWithinBase(modelDir, mappingFile);
    if (manifestPath === null) {
      throw new Error('マッピングファイルの場所が想定外のため読み込めません。');
    }
    const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return ManifestSchema.parse(raw);
  }

  /**
   * manifest.json を検証してから**原子的に**書き込む(tmp + rename)。既存の有効な manifest を
   * 上書きするため、途中でクラッシュしても壊れた JSON を残さない(ConfigStore と同じ方針)。
   */
  private writeManifest(modelDir: string, mappingFile: string, manifest: Manifest): void {
    ManifestSchema.parse(manifest); // idle 必須・型を書き込み前に確認する
    const manifestPath = resolveWithinBase(modelDir, mappingFile);
    if (manifestPath === null) {
      throw new Error('マッピングファイルの場所が想定外のため書き込めません。');
    }
    const tmp = `${manifestPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(tmp, manifestPath);
  }
}

/**
 * idle(待機)にモーションの割り当てが無いかを見て、警告文を返す(無ければ null)。expression の
 * 有無は判定に含めない(下の実装コメント参照)。`getDetail`(表示)・`setLive2dEntry`/
 * `autoRestoreState`/`autoRestoreAll`(すべて最後に `getDetail` を通す)のいずれの経路でも
 * 同じ判定になる単一の関数にする(取り込み時 `model-importer.ts` の `idleMotionMissing` 警告と
 * 同じ懸念を、編集後にも一貫して検知する)。
 */
function idleMissingWarning(entries: Live2dMappingEntry[]): string | null {
  const idle = entries.find((e) => e.state === FALLBACK_STATE);
  // motion のみで判定する(expression の有無は問わない)。Live2DRenderer.applyState() は
  // motion が無ければ再生自体を行わず直前のポーズのまま固まる(expressionだけでは動かない)ため、
  // 取り込み時の autoMapLive2d の idleMotionMissing 判定(live2d-import.ts、motionのみを見る)と
  // 同じ条件にする必要がある(reviewer指摘・2026-07-30。以前は motion/expression 両方 null を
  // 要求しており、motion だけ null な組み合わせでの警告漏れがあった)。
  if (idle && idle.motion === null) {
    return 'idle(待機)に対応するモーションが割り当てられていません。モーション終了後の待機表示が固まる可能性があります。';
  }
  return null;
}

/** 文字列が全10状態のいずれかなら EmotionState、そうでなければ null(未知の returnTo を握り潰す)。 */
function toEmotionStateOrNull(value: unknown): EmotionState | null {
  return typeof value === 'string' && (EMOTION_STATES as readonly string[]).includes(value)
    ? (value as EmotionState)
    : null;
}

// ── IPC ペイロード検証(parseModelId と同じ役割。Renderer 由来を信じない) ──────────

/** 感情状態キーの検証(全10状態のいずれか)。 */
export function parseEmotionState(payload: unknown): EmotionState {
  if (typeof payload === 'string' && (EMOTION_STATES as readonly string[]).includes(payload)) {
    return payload as EmotionState;
  }
  throw new Error('感情の指定が不正です。');
}

/** Live2D の1状態パッチ(motion/expression とも文字列か null)を検証する。 */
export function parseLive2dEntryPatch(payload: unknown): Live2dEntryPatch {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('割り当ての指定が不正です。');
  }
  const { motion, expression } = payload as { motion?: unknown; expression?: unknown };
  const check = (v: unknown, label: string): string | null => {
    if (v === null || v === undefined) {
      return null;
    }
    if (typeof v === 'string') {
      return v;
    }
    throw new Error(`${label}の指定が不正です。`);
  };
  return { motion: check(motion, 'モーション'), expression: check(expression, '表情') };
}
