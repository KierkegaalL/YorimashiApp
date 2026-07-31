# リリース対応チェックリスト(配布フェーズ)

> **着手前に配布方針をユーザーへ確認すること**(CLAUDE.md「次の大きな区切りは配布フェーズの設計判断」)。本チェックリストは現状把握(2026-07-30時点のコード・docs調査)に基づく洗い出しであり、各項目の実施順序・要否は方針確定後に決める。着手時のモデル方針は依頼内容で判断(新規作成=Opus 4.8 / 既存ファイルへの修整=Sonnet 5)。

## 現状(未着手であることの根拠)

- `package.json` に `build`(electron-builder設定)キーが無い。`electron-builder`(26.15.3)は devDependency に入っているだけ
- `config.distribution.macSigningIdentity` / `macNotarize` は config-schema 上に器があるだけで、既定値(`null` / `false`)のまま読み書きする実装が無い(署名・notarize処理そのものが未実装)
- `.github/workflows/ci.yml` は typecheck・build・OSSライセンス鮮度チェックのみ。パッケージング/リリース用のワークフローは意図的に未整備(「動かないCDを置かない」判断。git-workflow.md)
- Cubism外部ランタイムの配布物への同梱方法は `src/renderer/public/cubism-runtime/README.md` に「未決事項として残る」と明記されたまま

## 1. electron-builder 設定

- [ ] `appId` / `productName` / `copyright` 等の基本メタデータを決定
- [ ] `mac` ターゲット設定(dmg / zip 等、配布形態を決定)
- [ ] アプリアイコン(`.icns`)を用意する(現状リポジトリに無い)
- [ ] `files` / `extraResources` を設定し、**`dev-assets/` が配布物に絶対に含まれないことを確認**(`.gitignore`対象だが、electron-builderの`files`パターンは`.gitignore`を自動では見ないため個別に除外設定が要る)
- [ ] `node_modules` 内の `gh-pages`(`pixi-live2d-display` が誤って `dependencies` に含む。prototype pollutionの既知脆弱性。実行時には使われないが物理的に `node_modules` に入る)が、electron-builder のファイル選定で確実に除外されることを確認(`environments.md`「PixiJSのバージョン方針」既知TODO)
- [ ] ビルド後、実際に生成された `.app` / `.dmg` の中身を展開して上記2点を目視確認する

## 2. Cubism外部ランタイムの同梱

> **スプライトセット側に対応項目は無い(正当な非対称)**: スプライトセットは`<img>`によるブラウザネイティブのアニメーションWebP再生のみで完結し、Live2Dのような外部ランタイム(Cubism SDK)を必要としない(`environments.md`「PixiJSのバージョン方針」、`load-cubism-runtime.ts`冒頭コメント参照)。よって本節の同梱作業はLive2D専用でよい。

- [ ] Live2D Cubism SDK for Web のライセンス条項を確認し、`live2dcubismcore.min.js`(必要なら `live2d.min.js` も)を配布物へ同梱してよいか判断する
- [ ] 同梱可能と判断した場合、`src/renderer/public/cubism-runtime/` 経由(通常のViteビルド出力に含める)か `extraResources` を使うかを決め、実装する
- [ ] 同梱しない方針にする場合、利用者が自分でランタイムを配置する手順(オンボーディング or ドキュメント)を用意する。現状の「ランタイム未導入」時のエラー表示(`cubism-runtime.ts`)がその場合の唯一の案内になるため、文言がその運用に耐えるか確認する
- [ ] `config.distribution.live2dCommercialLicense`(権利情報タブに表示される、Live2D Cubismの商用ライセンス取得有無のフラグ)の運用方法を決める(現状は既定`false`で、UIから設定する導線があるか確認)

## 3. 署名・notarize

- [ ] Apple Developer Program のアカウント・証明書を用意する(Developer ID Application証明書)
- [ ] `macSigningIdentity` を実際にelectron-builderの署名設定へ配線する実装を追加する
- [ ] notarize(`macNotarize`)を有効にする場合、`notarytool` 用のApple ID・App用パスワード(またはApp Store Connect API key)をCI/ローカルでどう安全に扱うか(secrets管理)を決める。**config.jsonにAPIキー等の機密を書かない**(config.jsonは0600だが配布物には含めない設計を維持する)
- [ ] Hardened Runtime・entitlements(必要な場合)を設定する
- [ ] 署名済みビルドを別のMacで実際に開き、Gatekeeperで警告なく起動できることを確認

## 4. CD(パッケージング/リリース)ワークフロー整備

- [ ] 配布方針(手動リリース or タグpushでの自動ビルド)を決める(要件定義書: 配布は手動更新のみ・自動アップデート機構は配布フェーズで検討、と既に決まっている)
- [ ] `.github/workflows/` に release 用ワークフローを追加する場合、既存の `ci.yml`(`macos-latest`固定・Node版数は`.nvmrc`が単一の情報源)の方針を踏襲する
- [ ] 生成したビルド成果物をどこに置くか(GitHub Releases 等)を決める
- [ ] リリースnoteの作成方法・粒度を決める

## 5. 依存関係・セキュリティの最終確認

- [ ] `npm audit` を実行し、重大な脆弱性が無いことを確認
- [ ] `npm run generate:licenses` を実行し、`src/shared/oss-licenses.ts` に差分が無いことを確認(CIの鮮度チェックと同じ基準)
- [ ] `.token` / `config.json` 等、userData配下の機密ファイルが配布物自体には含まれないこと(当然だが実際のビルド成果物で再確認)

## 6. 自動アップデート・その他

- [ ] 要件定義書10章のとおり、自動アップデート機構はv1スコープ外であることを維持するか、方針変更するかを確認する
- [ ] 対応OS(macOSのみ・C-01)の表記をリリースノート・README等に明記する

## 7. リリースビルドの動作確認

- [ ] リリース設定確定後、[実機確認チェックリスト](manual-verification-checklist.md)を**開発ビルド(`npm run preview`)ではなくelectron-builderが生成した実際の配布物**に対しても一通り実施する(パッケージングによる差異—リソースパスの解決、署名によるサンドボックス挙動の変化等—は開発ビルドでは検出できない)
