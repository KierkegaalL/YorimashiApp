/**
 * Live2Dモデル取り込みの中核(FR-5 モデル管理タブ 第2段階a)。
 * 正本: docs/detailed-design/model-mapping-ui.md(列挙元の表・自動マッピングのアルゴリズム)、
 *       docs/data.md 2.1(live2d の manifest 構造)、docs/security.md 7章(パス検証)。
 *
 * このモジュールは **Electron 非依存**(fs と純粋関数のみ)。ダイアログ・コピー・config 更新は
 * 呼び出し元(model-importer.ts)が担う。列挙・自動マッピング・manifest 生成は
 * dev-assets の実モデル(Shizuku=Cubism2 / Haru=Cubism4)でオフスクリーン検証できる。
 *
 * 形式非依存ではない(このモジュールは **Live2D 専用**)。スプライトセットの取り込みは
 * 生成パイプライン(spriteset-pipeline.md)が対応物で、構造が全く異なるため別モジュールになる。
 * この非対称は形式の性質に由来する正当なもの(model-mapping-ui.md 論点4「自動マッピングは
 * Live2D のみ」)。
 */

import fs from 'node:fs';
import path from 'node:path';

import { EMOTION_STATES, FALLBACK_STATE, type EmotionState } from '../../shared/emotions';
import type { Live2dManifest } from '../../shared/manifest';
import { resolveWithinBase } from '../local-server/safe-path';

// ── 列挙 ────────────────────────────────────────────────

export interface Live2dEnumeration {
  cubismVersion: 'cubism2' | 'cubism4';
  /** モデル定義ファイル名(modelDir 相対。cubism4: *.model3.json / cubism2: *.model.json)。 */
  modelFile: string;
  /** モーショングループ名(自動マッピングの motion 候補)。 */
  motions: string[];
  /** 表情名(自動マッピングの expression 候補。cubism4 は Name、cubism2 は name)。 */
  expressions: string[];
}

/**
 * モデルフォルダを列挙する。cubism4(*.model3.json)を優先し、無ければ cubism2(*.model.json)。
 * どちらも無ければ throw。**モデル定義が参照するレンダリング必須アセットが自身のフォルダ内に
 * 閉じていることを検証**し、`../` 等でフォルダ外へ逸脱するものがあれば拒否する
 * (security.md の `GET /models/*` パス検証と対になる入口側の検証)。
 *
 * 音声(Sound)・DisplayInfo・UserData は v1 のレンダリングで使わず、公式サンプル Haru 自身が
 * Sound で兄弟フォルダ `../shizuku/sounds/` を相対参照する実例がある(A2 で発見)。これらを
 * 検証対象に含めると正当な公式モデルを弾いてしまうため、**検証対象はレンダリング必須アセット
 * (moc/textures/physics/pose/expressions/motions)に限る**。逸脱する Sound 等はコピー対象の
 * フォルダ外なので複製されず、実行時に pixi-live2d-display が warn で握りつぶす(害が無い)。
 */
export function enumerateLive2d(modelDir: string): Live2dEnumeration {
  const entries = fs.readdirSync(modelDir);
  const model3 = entries.find((f) => f.toLowerCase().endsWith('.model3.json'));
  // '.model3.json' で終わる名前が '.model.json' で終わることはない(末尾文字列が別)ので、
  // 単純に '.model.json' で判定してよい(cubism4を先に見ているため取り違えも起きない)。
  const model2 = entries.find((f) => f.toLowerCase().endsWith('.model.json'));

  if (model3) {
    return enumerateCubism4(modelDir, model3);
  }
  if (model2) {
    return enumerateCubism2(modelDir, model2);
  }
  throw new Error(
    'Live2Dモデルの定義ファイル(*.model3.json または *.model.json)が見つかりませんでした。',
  );
}

function enumerateCubism4(modelDir: string, modelFile: string): Live2dEnumeration {
  const def = readJson(path.join(modelDir, modelFile));
  const fr = (def.FileReferences ?? {}) as Record<string, unknown>;

  const motions = Object.keys((fr.Motions as Record<string, unknown>) ?? {});
  const expressions = asArray(fr.Expressions)
    .map((e) => (typeof e?.Name === 'string' ? e.Name : null))
    .filter((n): n is string => n !== null);

  // 検証対象(レンダリング必須): Moc / Textures / Physics / Pose / Expressions[].File / Motions[*][].File。
  const paths: string[] = [];
  if (typeof fr.Moc === 'string') paths.push(fr.Moc);
  for (const t of asStringArray(fr.Textures)) paths.push(t);
  if (typeof fr.Physics === 'string') paths.push(fr.Physics);
  if (typeof fr.Pose === 'string') paths.push(fr.Pose);
  for (const e of asArray(fr.Expressions)) if (typeof e?.File === 'string') paths.push(e.File);
  for (const group of Object.values((fr.Motions as Record<string, unknown>) ?? {})) {
    for (const m of asArray(group)) if (typeof m?.File === 'string') paths.push(m.File);
  }
  assertPathsWithin(modelDir, modelFile, paths);

  return { cubismVersion: 'cubism4', modelFile, motions, expressions };
}

function enumerateCubism2(modelDir: string, modelFile: string): Live2dEnumeration {
  const def = readJson(path.join(modelDir, modelFile));

  const motions = Object.keys((def.motions as Record<string, unknown>) ?? {});
  const expressions = asArray(def.expressions)
    .map((e) => (typeof e?.name === 'string' ? e.name : null))
    .filter((n): n is string => n !== null);

  // 検証対象(レンダリング必須): model(moc) / textures / physics / pose / expressions[].file / motions[*][].file。
  const paths: string[] = [];
  if (typeof def.model === 'string') paths.push(def.model);
  for (const t of asStringArray(def.textures)) paths.push(t);
  if (typeof def.physics === 'string') paths.push(def.physics);
  if (typeof def.pose === 'string') paths.push(def.pose);
  for (const e of asArray(def.expressions)) if (typeof e?.file === 'string') paths.push(e.file);
  for (const group of Object.values((def.motions as Record<string, unknown>) ?? {})) {
    for (const m of asArray(group)) if (typeof m?.file === 'string') paths.push(m.file);
  }
  assertPathsWithin(modelDir, modelFile, paths);

  return { cubismVersion: 'cubism2', modelFile, motions, expressions };
}

/** 参照パス群が modelDir 配下に収まることを確認する。逸脱が1つでもあれば throw。 */
function assertPathsWithin(modelDir: string, modelFile: string, refPaths: string[]): void {
  for (const ref of refPaths) {
    if (resolveWithinBase(modelDir, ref) === null) {
      throw new Error(
        `モデル定義(${modelFile})がフォルダ外のファイルを参照しています: ${ref}。安全のため取り込みを中止しました。`,
      );
    }
  }
}

// ── 自動マッピング(model-mapping-ui.md 論点4。Live2D のみ) ──────────────────

/** 比較用に名前を正規化する。'exp_smile_soft.exp3.json' -> 'smilesoft'(model-mapping-ui.md)。 */
export function normalizeName(name: string): string {
  return name
    .replace(/\.(exp3\.json|motion3\.json|mtn|json)$/i, '') // 拡張子
    .toLowerCase()
    .replace(/^exp[_-]?/, '') // 表情名の慣用プレフィックス
    .replace(/[^a-z0-9぀-ヿ一-鿿]/g, ''); // 記号・空白を除去(ひらがな/カタカナ/漢字は残す)
}

/**
 * 同義語辞書(model-mapping-ui.md 論点4)。**この辞書は正本のコピーであり、片方だけ変えない**
 * (辞書を書き換える場合は model-mapping-ui.md 論点4 も更新する)。
 */
export const SYNONYMS: Record<EmotionState, string[]> = {
  idle: ['idle', 'normal', 'neutral', 'default', 'wait', '待機', '通常'],
  confident: ['confident', 'smilesoft', 'softsmile', 'fine', '自信', '昂揚'],
  tired: ['tired', 'weary', 'exhausted', 'down', '疲', '減衰'],
  thinking: ['thinking', 'think', 'thought', '考'],
  happy: ['happy', 'smile', 'joy', 'laugh', 'fun', '笑', '喜'],
  proud: ['proud', 'pride', 'boast', '得意', '誇'],
  worried: ['worried', 'worry', 'sad', 'sorrow', 'trouble', '困', '悲', '心配'],
  panic: ['panic', 'surprise', 'surprised', 'shock', '驚', '慌'],
  curious: ['curious', 'question', 'wonder', 'interest', '疑問', '興味'],
  sleepy: ['sleepy', 'sleep', 'doze', 'yawn', '眠', '寝'],
};

/** 候補名がその状態にどれだけ合致するか。0なら不一致。完全一致=1000、それ以外は一致した同義語の長さ。 */
export function scoreCandidate(state: EmotionState, candidate: string): number {
  const n = normalizeName(candidate);
  if (n === state) {
    return 1000; // 完全一致が最優先
  }
  let best = 0;
  for (const syn of SYNONYMS[state]) {
    if (n.includes(syn)) {
      best = Math.max(best, syn.length); // 長い語ほど具体的
    }
  }
  return best;
}

/**
 * 候補名の配列から、各状態の最良候補を選ぶ。スコア0は null(未割当)。同点はファイル内の
 * 出現順で先勝ち(結果を決定的にする。同じモデルを2度取り込んで違う結果にしない)。
 */
function pickBest(state: EmotionState, candidates: string[]): string | null {
  let bestName: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreCandidate(state, c);
    if (s > bestScore) {
      bestScore = s;
      bestName = c;
    }
  }
  return bestScore > 0 ? bestName : null;
}

export interface AutoMapResult {
  emotionMap: Live2dManifest['emotionMap'];
  /** idle にモーションが割り当たらなかった(実行時のフォールバック先が固まりうる。要注意)。 */
  idleMotionMissing: boolean;
}

/**
 * モーション候補・表情候補から全10状態の emotionMap を自動生成する(model-mapping-ui.md 論点4)。
 *
 * - 各状態は motion/expression をそれぞれ独立に最良候補で埋める。両方 null の状態は emotionMap に
 *   入れない(partialRecord。未割当は実行時に idle へフォールバックする。C-18)。
 * - **idle は必ず emotionMap に含める**(C-18: idle は必須で他状態のフォールバック先)。idle が
 *   両方 null でも空エントリを置く。idle のモーションが無い場合は `idleMotionMissing` を立てて呼び出し元へ伝える。
 */
export function autoMapLive2d(motions: string[], expressions: string[]): AutoMapResult {
  const emotionMap: Live2dManifest['emotionMap'] = {};
  for (const state of EMOTION_STATES) {
    const motion = pickBest(state, motions);
    const expression = pickBest(state, expressions);
    if (motion !== null || expression !== null) {
      emotionMap[state] = { motion, expression };
    }
  }
  // idle は必須。自動マッピングで埋まらなければ空エントリを置く(C-18)。
  if (emotionMap[FALLBACK_STATE] === undefined) {
    emotionMap[FALLBACK_STATE] = { motion: null, expression: null };
  }
  return {
    emotionMap,
    idleMotionMissing: (emotionMap[FALLBACK_STATE]?.motion ?? null) === null,
  };
}

/** 列挙 + 自動マッピングから Live2dManifest を組み立てる。 */
export function buildLive2dManifest(enumeration: Live2dEnumeration, autoMap: AutoMapResult): Live2dManifest {
  return {
    renderType: 'live2d',
    cubismVersion: enumeration.cubismVersion,
    modelFile: enumeration.modelFile,
    emotionMap: autoMap.emotionMap,
  };
}

// ── 小さなヘルパ ─────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${path.basename(filePath)} がオブジェクトではありません。`);
  }
  return raw as Record<string, unknown>;
}

/** unknown を「Nameやfile等のプロパティを持つオブジェクトの配列」として安全に走査する。 */
function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value.filter((v) => typeof v === 'object' && v !== null) as Array<Record<string, unknown>>) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
