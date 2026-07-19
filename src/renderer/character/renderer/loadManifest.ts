/**
 * モデルの manifest.json を取得して検証する(FR-5)。`/models/*` はヘッダ認証(security.md)のため、
 * `<img>` と違い fetch でトークンヘッダを載せて取得できる。Zodで検証し、不正なら例外を投げる
 * (アプリが自分の状態について嘘をつかない: 壊れた対応表で黙って描画しない)。
 */

import { ManifestSchema, type Manifest } from '../../../shared/manifest';

export async function loadManifest(
  assetBaseUrl: string,
  mappingFile: string,
  token: string,
): Promise<Manifest> {
  const res = await fetch(`${assetBaseUrl}/${mappingFile}`, {
    headers: { 'X-App-Token': token },
  });
  if (!res.ok) {
    throw new Error(`manifest の取得に失敗しました: ${mappingFile} (HTTP ${res.status})`);
  }
  const json: unknown = await res.json();
  return ManifestSchema.parse(json);
}
