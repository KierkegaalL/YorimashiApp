/**
 * 権利情報タブ(FR-12)が Main から受け取る、**config に由来する動的な値**の共有契約。
 * OSS 一覧・フォント・持ち込みモデル注意・Anthropic 注記はビルド時定数(oss-licenses.ts)や
 * 静的テキストで足りるが、Live2D の利用区分だけは config.distribution を根拠にするため IPC で取る。
 *
 * **ハードコードで利用区分を断定しない**(constraints.md「アプリが自分の状態について嘘をつかない」)。
 * `live2dCommercialLicense` は config.distribution にある実在のフィールドで、これを反映することで
 * 「個人利用(無償)」/「商用ライセンス設定済み」を config の正に従って表示する。
 *
 * 形式非依存の契約だが、内容は Live2D 形式にのみ関係する(スプライトセットには Live2D の
 * 利用区分に相当する概念が無い。要件定義書 9章「この確認は Live2D 形式のモデルにのみ関係し、
 * スプライトセット形式には及ばない」)。この非対称は形式の性質に由来する正当なもの。
 */
export interface RightsSnapshot {
  /**
   * Live2D Cubism の商用ライセンスを取得済みか(config.distribution.live2dCommercialLicense)。
   * false(既定)なら個人利用(無償)区分として表示する。
   */
  live2dCommercialLicense: boolean;
}
