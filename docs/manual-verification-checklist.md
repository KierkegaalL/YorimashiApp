# 実機確認 手順・チェックリスト

> Claude Code(このサンドボックス環境)はElectronのGUIを起動できないため、本チェックリストの項目はすべて**ユーザーが手動で実施**する(.claude/rules/constraints.md「実機能確認の制約」)。着手は保留中(2026-07-30時点)。実施したら、結果を[Memory.md](../Memory.md)へ実測値・報告として記録すること。

## 0. 前提・起動方法

- **`npm run dev` では Live2D 描画の実機確認ができない**: character HTML が Vite dev server から読まれ、ローカルサーバーがHTMLへ注入するはずのアクティブモデル情報が届かない(`src/renderer/public/cubism-runtime/README.md`「既知の dev 制約」参照)。Live2D を含む確認は必ず `npm run build && npm run preview` で行う。
- Cubism外部ランタイム(`live2dcubismcore.min.js` / `live2d.min.js`)を `src/renderer/public/cubism-runtime/` に配置しておくこと(`.gitignore`対象・各自ライセンス同意の上でLive2D公式から取得。同ディレクトリのREADME参照)。未配置だと「ランタイム未導入」の正直なエラー表示に留まり、Live2D描画自体を確認できない。
- `dev-assets/live2d/` にCubism 2/4いずれかのモデル一式、可能であれば両方を配置しておくと網羅的に確認できる。

```bash
npm run build && npm run preview
```

## 1. 基本起動・ウィンドウ確認(FR-6, FR-7)

- [ ] Tray アイコンが表示される
- [ ] Tray メニューから Control Panel を開ける
- [ ] Control Panel: 左に会話ペイン(FR-15)・右に6タブ(ホーム/モデル/モード/設定/ログ/権利)のレイアウトが `docs/mockups/control-panel.jsx` と一致する
- [ ] キャラクターウィンドウが透過・枠なし・最前面で表示される
- [ ] キャラクターウィンドウのクリックスルーが `config.general.clickThrough` の設定どおりに機能する(有効時は下のウィンドウを直接操作できる)
- [ ] キャラクターウィンドウの位置がアプリ再起動後も保持される(`windowPosition`)
- [ ] 会話ペインの折りたたみ/展開が機能し、状態が再起動後も保持される(`controlPanelCollapsed`)

## 2. Live2D / スプライトセット表示確認(FR-5)

対称性チェック(CLAUDE.md原則4)のとおり、**両形式を必ず確認する**。

- [ ] Live2D モデルをフォルダ取り込みできる(取り込み後、Control Panelのモデル管理タブに表示される)
- [ ] Live2D モデルを zip 取り込みできる
- [ ] スプライトセットモデルを動画から生成・取り込みできる(idle必須の動画1本で最低限確認)
- [ ] 取り込んだモデルがキャラクターウィンドウに正しいアスペクト比・サイズで表示される(はみ出し・極端な余白が無い)
- [ ] `displaySize` スライダーで両形式ともサイズが追従する
- [ ] 全10状態(idle/confident/tired/thinking/happy/proud/worried/panic/curious/sleepy)を意図的に発火させ、両形式で正しいモーション/クリップが再生される
- [ ] Live2D: 口・目・(モデルにあれば)リボン等、パーツの重なり順が正しく描画される(続報1〜11で修正した描画バグの最終回帰確認)
- [ ] モデル上限(2体)に達した状態で3体目の取り込みを試み、日本語の上限エラーが出て中断される(Live2D・スプライトセット両方で確認)

## 3. 非機能要件の実測(constraints.md)

目安値: 常駐時CPU 待機1〜2%・Reaction再生中10%未満、メモリ200MB前後、無操作時fps低下(60→15)。

- [ ] アクティビティモニタ等で、キャラクターウィンドウ待機時のCPU使用率が1〜2%程度であることを確認
- [ ] Reaction(happy/panic等)再生中のCPU使用率が10%未満であることを確認
- [ ] 常駐時のメモリ使用量が200MB前後であることを確認
- [ ] 無操作を数分継続し、描画フレームレートが概ね60fpsから15fps程度へ落ちることを確認(devtoolsのPerformanceタブ、または目視での滑らかさの変化)
- [ ] **Live2Dモデルの切替(Control Panelから別モデルへ何度も切り替える)を10回程度繰り返し、メモリ使用量が単調増加し続けないことを確認**(`Live2DRenderer.destroy()`のテクスチャキャッシュリーク修正〈2026-07-30〉の効果測定。増加し続ける場合は回帰の疑いあり。**スプライトセット側は対象外**: `SpriteSetRenderer`は`<img>`要素のみでPixiJSのテクスチャキャッシュに触れないため、同種のリークが構造的に発生しない)

## 4. 2026-07-30 バグ監査で修正した項目の実機確認

いずれも `fix/post-merge-bug-audit`(PR #24)で修正済み。静的検証(typecheck/build/reviewer)は完了しているが、GUI越しの実地確認はまだ。

- [ ] **config.json 破損時の起動継続**: `userData/config.json` を書き込み不可(例: `chmod 000`)にした状態でアプリを起動し、クラッシュせず既定値で起動を継続することを確認(config-store.ts の persist() 例外処理統一)
- [ ] **フォルダ取り込みのシンボリックリンク拒否**: 外部ファイルを指すシンボリックリンクを含むフォルダを作り、Live2Dのフォルダ取り込みで拒否されることを確認(zip取り込みとの対称性修正)
- [ ] **スプライトセット取り込みの上限再チェック**: モデルが既に2体ある状態でスプライトセット取り込みを試み、エラー後に `userData/models/` へ孤児ディレクトリが残っていないことを確認
- [ ] **idle警告のUI表示**: モデル管理タブでLive2DモデルのidleのモーションをUIから未割当に戻し、警告文が表示されることを確認(MappingEditor.tsx)
- [ ] **Onboardingのエラー表示**: hooks設定でフォルダ選択やdispatch.sh配置を失敗させられる状況(例: 権限の無いディレクトリ)を作り、エラーメッセージが画面に表示されることを確認(以前は無反応だった)
- [ ] **ローカルサーバーのポート競合時ログ**: `config.codeAdapter.serverPort` を既に使用中のポートに設定してアプリを再起動し、正常にフォールバックしつつ`console.error`に無関係な"unexpected server error"ログが出ないことを確認(要開発者コンソール確認)

## 5. オンボーディング確認(FR-14)

- [ ] 初回起動(または `onboarding.completed` を false に戻した状態)で「ようこそ→モデル→モード→完了」の4ステップが表示される
- [ ] 各ステップをスキップしても完了扱いになる(onboarding.md「全ステップが必須ではない」)
- [ ] Code Adapter選択時、hooks設定セクションでプロジェクトフォルダ選択・dispatch.sh配置・`.claude/settings.json`スニペットのコピーができる

## 6. hooks連携(Code Adapter)の実機確認(FR-2)

- [ ] オンボーディングまたはモード設定タブから監視プロジェクトを追加し、`dispatch.sh` が配置される
- [ ] 追加したプロジェクトの `.claude/settings.json` に案内どおりのhooks設定を追記し、実際にClaude Codeで操作してキャラクターが反応する(EmotionEngineの状態が変化する)ことを確認
- [ ] `dispatch.sh` がローカルサーバー未起動でも `exit 0` で無害に終わることを確認(可用性NFR)

## 7. Chat Adapter realモードの実機確認(FR-3) — **課金操作につき要注意**

> real接続はAPIキーを消費する。テストは最小限の往復に留める。

- [ ] モード設定タブでrealへ切替え、Anthropic APIキーを設定できる
- [ ] 会話ペインで送信すると実際にAPI応答が返る(ストリーミング表示を含む)
- [ ] `/model` コマンドで応答モデル(Opus/Sonnet/Haiku)を切り替えられる
- [ ] APIキー未設定・不正・レート制限等のエラー時、mockへの**自動フォールバックが起きず**、エラーが正直に表示されることを確認(constraints.md「アプリが自分の状態について嘘をつかない」)
- [ ] 確認後、既定の `mock` へ戻す(誤って課金が発生し続けないように)
