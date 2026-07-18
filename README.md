# ヨリマシ.App

macOS向けのデスクトップ常駐アプリです。Claude Codeでの作業実況とClaudeとのチャット対話に、憑坐(よりまし)キャラクター「常世灯里」が感情豊かに反応しながら伴走します。

## 用途

- **Claude Codeの作業実況**: `PreToolUse`/`PostToolUse`等のhooksイベントを受け取り、ツールの実行・失敗・待機状況に応じてキャラクターが反応する(Code Adapter)。
- **Claudeとの雑談相手**: コントロールパネル内の会話ペインから、Claude(Anthropic API)と直接チャットできる(Chat Adapter)。動作確認用に課金なしで使える`mock`モードと、実際にAPIへ接続する`real`モードを切り替えられる。
- 開発者自身のClaude Code活用基盤(ハーネスエンジニアリング)の一環として作られている。

## 主な機能

- **感情表現(EmotionEngine)**: 気分(idle/confident/tired)と反応(thinking/happy/proud/worried/panic/curious/sleepy)、計10状態でキャラクターが表情を変える。
- **モデル管理**: Live2D(上級者向け・Cubism 2/4/5対応)とスプライトセット(標準の入口・画像1枚からAI生成アシストで作成可能)の2形式に対応。最大2体まで登録し、Code/Chatで自動切替もできる。
- **キャラクター表示ウィンドウ**: 透過・枠なし・常時最前面でデスクトップに常駐し、クリックスルーにも対応。
- **コントロールパネル**: 会話ペイン(左)+ホーム/モデル管理/モード設定/全体設定/ログ/権利情報の6タブ(右)で構成。
- **セキュリティ**: ローカルサーバーは127.0.0.1限定バインド・全リクエストにトークン認証必須。
- **オンボーディング**: 初回起動時にキャラクター紹介 → モデル導入の案内 → モード選択の順で使い始めをガイドする。

## 技術スタック

- **デスクトップアプリ**: Electron + TypeScript + React + Vite
- **Live2D描画**: PixiJS(v6系固定) + pixi-live2d-display(Cubism 2/4/5両対応)
- **設定バリデーション**: Zod(`schemaVersion`によるマイグレーション対応)
- **ローカルサーバー**: Node.js(http + ws)、127.0.0.1限定バインド + トークン認証
- **Chat Adapter**: `@anthropic-ai/sdk`(公式SDK)をMainプロセスで使用
- **対応OS**: macOSのみ(v1)

## ドキュメント

要件定義・基本設計は [Notion](https://app.notion.com/p/39ecd5c5312e81eda7bff0c1463a2747) が正本です。

- [要件定義書](https://app.notion.com/p/39ecd5c5312e81c19947f4905c032181)
- [基本設計書](https://app.notion.com/p/39fcd5c5312e811b938ff35e04246436)

リポジトリ内の [docs/requirements.md](docs/requirements.md) / [docs/basic-design.md](docs/basic-design.md) はそのミラーです。詳細設計は [docs/detailed-design/](docs/detailed-design/) を参照してください。
