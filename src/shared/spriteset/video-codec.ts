/**
 * 取り込む動画のコーデック判定(FR-5 / spriteset-pipeline.md 論点3)。手順4前段のデコードは Chromium の
 * WebCodecs で行うが、Electron 43.1.1 の**実測**で H.265(hvc1/hev1)だけが `no` だった:
 *
 * | コーデック | 判定 |            | コーデック | 判定 |
 * |---|---|                        |---|---|
 * | mp4 / H.264 (avc1) | probably |  | webm / VP9 | probably |
 * | webm / VP8 | probably |         | webm / AV1 | probably |
 * | mp4 / H.265 (hvc1) | **no** |
 *
 * 外部の動画生成AI(Pika・Canva等)の出力は実質 H.264 mp4 か VP9 webm なので H.265非対応は実害が無い。
 * 取り込み時に弾き、ユーザーへ再エンコードを促す。
 *
 * **この関数は実測表を写した早期フィルタ**であり、**最終判断は実行時の `VideoDecoder.isConfigSupported`**
 * (Renderer/WebCodecs、2b-2で実装)に委ねる。ここで supported を返しても、その環境でデコードできるとは
 * 限らない(あくまでメッセージ用の事前判定)。純粋関数なのでオフスクリーンで検証できる。
 */

/** 非対応と分かっているコーデック。ユーザー向けメッセージに使う。 */
export type UnsupportedReason = 'h265';

export interface CodecSupport {
  supported: boolean;
  /** 非対応の理由(supported=false のときのみ)。 */
  reason?: UnsupportedReason;
}

/**
 * WebCodecs のコーデック文字列(例: `avc1.42E01E` / `vp09.00.10.08` / `hev1.1.6.L93.B0`)を実測表で分類する。
 * 大文字小文字は無視。未知の文字列は「弾かない」(supported=true)— 実行時の isConfigSupported が最終判断するため、
 * ここで未知を落とすと将来対応コーデックを誤って拒否しかねない(安全側に倒す=事前フィルタでは通す)。
 */
export function classifyVideoCodec(codec: string): CodecSupport {
  const c = codec.trim().toLowerCase();
  // H.265 / HEVC は実測で non-supported(hvc1 / hev1)。
  if (c.startsWith('hvc1') || c.startsWith('hev1') || c.startsWith('hevc')) {
    return { supported: false, reason: 'h265' };
  }
  // H.264(avc1/avc3) / VP8(vp8,vp08) / VP9(vp9,vp09) / AV1(av01) は実測で supported。
  // それ以外(未知)は事前フィルタでは通し、実行時の isConfigSupported に委ねる。
  return { supported: true };
}

/** UI表示用の日本語理由。 */
export function unsupportedCodecMessage(reason: UnsupportedReason): string {
  switch (reason) {
    case 'h265':
      return 'この動画は H.265(HEVC)で、取り込みに対応していません。H.264(mp4)か VP9(webm)へ再エンコードしてください。';
  }
}
