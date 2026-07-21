/**
 * 「いまどのモデルスロットを描画対象にするか」の解決(FR-5)。
 *
 * **Electron 非依存の純粋関数として切り出してある**。キャラクターウィンドウ(character-window.ts、
 * BrowserWindow/screen を使う)とモデル管理(model/model-service.ts)の**両方が同じ判定を使う**必要が
 * あり、片方に置くともう片方が electron を巻き込む。GUIを伴わない検証もこの単位で行える
 * (.claude/rules/build-commands.md「サンドボックスで可能な検証」)。
 *
 * 形式非依存: Live2D/スプライトセットで分岐しない(どちらのスロットも同じ規則で選ぶ)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import type { AppConfig, ModelSlot } from '../../shared/config-schema';

/**
 * config から今アクティブなモデルスロットを1つ選ぶ。
 *
 * 解決順(UIの正 docs/mockups/control-panel.jsx L809-811 と一致させる):
 *  1. スロット0体 → null
 *  2. スロット1体 → **常にそれ**(1体しか無いならモードに関わらず出す)
 *  3. 2体 + autoSwitchByMode → `assignedAdapter === config.activeAdapter` のスロット
 *  4. それ以外 → manualActiveId 一致、無ければ先頭スロット
 *
 * **autoSwitchByMode を見るのは必須**(モデル管理タブがこの設定を触れるようにした以上、
 * ここが無視すると「モードで自動切替をONにしたのに切り替わらない」= アプリが自分の状態について
 * 嘘をつくことになる。constraints.md)。3で該当が見つからない場合(割当が片方だけ等)は
 * 黙って別モデルを出さず 4 のフォールバックへ落とす。
 */
export function resolveActiveModel(config: AppConfig): ModelSlot | null {
  const { slots, manualActiveId, autoSwitchByMode } = config.model;
  if (slots.length === 0) {
    return null;
  }
  if (slots.length === 1) {
    return slots[0] ?? null;
  }
  if (autoSwitchByMode) {
    const matched = slots.find((s) => s.assignedAdapter === config.activeAdapter);
    if (matched) {
      return matched;
    }
  }
  if (manualActiveId) {
    const found = slots.find((s) => s.id === manualActiveId);
    if (found) {
      return found;
    }
  }
  return slots[0] ?? null;
}
