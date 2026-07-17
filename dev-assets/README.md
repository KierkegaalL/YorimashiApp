# dev-assets/ — 開発・検証専用アセット

このディレクトリは `.gitignore` 対象。配布物には絶対に含めない（CLAUDE.md / constraints.md）。

## live2d/

Live2Dモデル（Cubism 2 または 4/5形式）の開発用資材を置く。
ちびキャラメーカー等で出力したモデル一式を、取得したフォルダ構成のまま配置する。

期待する構成の例（Cubism 4/5）:

```
dev-assets/live2d/<モデル名>/
 ├─ <モデル名>.model3.json
 ├─ <モデル名>.moc3
 ├─ <モデル名>.physics3.json         (あれば)
 ├─ motions/*.motion3.json
 ├─ expressions/*.exp3.json
 └─ textures/*.png
```

Cubism 2形式の場合は `.model.json` / `.moc` / `motions/*.mtn` / `expressions/*.json` が対応物。

配置後、`docs/detailed-design/model-mapping-ui.md` と `docs/detailed-design/lipsync.md` に
残っている「未検証」項目（Cubism 2/4の列挙構造、持続中にモーションが尽きたときの挙動）を
実モデルで検証する。
