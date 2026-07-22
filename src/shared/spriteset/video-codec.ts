/**
 * 取り込む動画が再生・デコードできるかの判定(FR-5 / spriteset-pipeline.md 論点3)。
 *
 * ## ⚠️ 実測による訂正(2026-07-22)
 *
 * 論点3の表は mp4/H.265(hvc1) を **`no`** としていたが、**本プロジェクトの実環境
 * (Electron 43.1.1 / macOS arm64)で実測したところ H.265 も再生・デコードできる**:
 *
 * | コーデック | `VideoDecoder.isConfigSupported` | `canPlayType` |
 * |---|---|---|
 * | H.264(avc1) / VP8 / VP9 / AV1 | true | probably |
 * | **H.265(hvc1 / hev1)** | **true** | **probably** |
 *
 * (Apple Silicon の macOS は HEVC のハードウェアデコードを持ち、Chromium がそれを露出する。)
 *
 * そのため**コーデック名のハードコードした許可/拒否リストは持たない**。持てば、実際には
 * 再生できる動画を「非対応です」と拒否することになり、アプリが自分の状態について嘘をつく
 * (constraints.md)。判定は**実際に読み込めたかどうか**という実地の結果だけを根拠にする。
 *
 * ## 実際の判定方法
 *
 * デコードは `HTMLVideoElement`(Chromium の demux + decode)で行うため、判定は
 * 「メタデータを読めたか / 寸法が取れたか」に尽きる(`decode-video.ts`)。この関数群は
 * その**失敗をユーザーへ説明する文言**だけを受け持つ。
 *
 * なお `VideoDecoder`(WebCodecs)は**コンテナのデムックスを行わない**ため、mp4/webm の
 * ファイルをそのまま渡してもデコードできない(実測: `An EncodedVideoChunk was marked as
 * type 'key' but wasn't a key frame`)。デムューサを別途抱える代わりに HTMLVideoElement を
 * 使う判断の根拠もここにある。論点3の「Chromium 内蔵コーデックで賄い ffmpeg を同梱しない」
 * という結論自体は維持される(使う API が VideoDecoder ではないだけ)。
 */

/** 動画の読み込みに失敗した理由。実地の失敗だけを表し、コーデック名からの推測はしない。 */
export type VideoLoadFailure =
  /** メタデータを読めなかった(壊れている / このEnvironmentが扱えない形式)。 */
  | 'unreadable'
  /** 読めたが映像トラックの寸法が取れなかった(音声のみ等)。 */
  | 'no-video-track';

/** 読み込み失敗をユーザーへ説明する文言。次の一手(再エンコード)まで示す。 */
export function videoLoadFailureMessage(failure: VideoLoadFailure, fileName: string): string {
  switch (failure) {
    case 'unreadable':
      return `「${fileName}」を読み込めませんでした。ファイルが壊れているか、この環境で扱えない形式です。H.264(mp4)か VP9(webm)へ再エンコードして試してください。`;
    case 'no-video-track':
      return `「${fileName}」に映像トラックが見つかりませんでした(音声だけのファイルかもしれません)。動画ファイルを選んでください。`;
  }
}
