/**
 * モデル管理(FR-5)のスロット操作。モデル管理タブ(FR-7)から呼ばれる。
 * 正本: docs/detailed-design/model-mapping-ui.md、UIの正: docs/mockups/control-panel.jsx L805-1179。
 *
 * 担当は **config.model のスロット管理**(一覧・削除・アクティブ選択・モードによる自動切替)。
 * モデルの**取り込み**(model-importer.ts / spriteset-importer.ts)と**感情↔モーション対応の編集**
 * (mapping-service.ts)は別モジュールが担う。**このクラス自体は取り込み経路を持たないため、
 * スロットを増やすことはできない**(責務を分けている理由)。
 *
 * 形式非依存: Live2D/スプライトセットで分岐しない。上限2体・アクティブ解決・削除の手順は
 * **両形式で完全に共通**であり、片方だけの処理を持たない(CLAUDE.md原則4の対称性は
 * 「両形式が同じ経路を通る」ことで保たれる。renderType は表示用に写すだけで判断に使わない)。
 *
 * Electron 非依存に保つ(GUIを伴わない検証のため)。削除後のウィンドウ反映など Electron 側の
 * 副作用は呼び出し元(index.ts)が担う。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ConfigStore } from '../config-store';
import { resolveActiveModel } from './active-model';
import { resolveWithinBase } from '../local-server/safe-path';
import { MAX_MODEL_SLOTS, type ModelManageSnapshot, type ModelSlotView } from '../../shared/model-manage';

export interface ModelServiceDeps {
  configStore: ConfigStore;
  /** userData/models の絶対パス。削除がこの配下に収まることを検証するために使う。 */
  modelsRoot: string;
}

export class ModelService {
  constructor(private readonly deps: ModelServiceDeps) {}

  /**
   * モデル管理タブへ返す現在の状態。**activeModelId は解決結果**(設定値から推測しない)。
   * `warning` は「直前の操作で部分的にしか達成できなかったこと」を載せる枠(通常 null)。
   */
  getSnapshot(warning: string | null = null): ModelManageSnapshot {
    const config = this.deps.configStore.current;
    const slots: ModelSlotView[] = config.model.slots.map((s) => ({
      id: s.id,
      name: s.name,
      renderType: s.renderType,
      ...(s.cubismVersion !== undefined ? { cubismVersion: s.cubismVersion } : {}),
      assignedAdapter: s.assignedAdapter,
    }));
    return {
      slots,
      autoSwitchByMode: config.model.autoSwitchByMode,
      manualActiveId: config.model.manualActiveId,
      activeModelId: resolveActiveModel(config)?.id ?? null,
      activeAdapter: config.activeAdapter,
      warning,
    };
  }

  /**
   * スロットを削除し、インストール済みのモデルファイルも消す。
   *
   * ファイル削除は **userData/models 配下に収まることを検証してから**行う
   * (installedDir は config 由来だが、壊れた/細工された config でアプリ外を消さないため。
   * security.md のパストラバーサル対策と同じ考え方を削除側にも適用する)。
   * 検証に通らない場合はファイルを消さずスロットだけ落とし、警告を残す(消せないものを
   * 「消した」と言わない)。
   */
  deleteModel(id: string): ModelManageSnapshot {
    const config = this.deps.configStore.current;
    const target = config.model.slots.find((s) => s.id === id);
    if (!target) {
      throw new Error('指定されたモデルは見つかりませんでした。');
    }

    // ファイルを消せたかどうかは**UIへ返す**(消せなかったのに「消えた」と見せないため)。
    let warning: string | null = null;
    const dir = resolveWithinBase(this.deps.modelsRoot, target.installedDir);
    if (dir === null) {
      console.warn(
        `[model] installedDir が models ディレクトリの外を指すためファイルは削除しません: ${target.installedDir}`,
      );
      warning =
        '設定からは外しましたが、モデルの保存場所が想定外のためファイルは削除していません。';
    } else {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // ファイルが消せなくても設定上の登録は外す(残骸は残るが、消えた体で残り続けるよりよい)。
        console.warn('[model] モデルファイルの削除に失敗しました:', err);
        warning = '設定からは外しましたが、モデルのファイルを削除できませんでした。';
      }
    }

    this.deps.configStore.update((draft) => {
      draft.model.slots = draft.model.slots.filter((s) => s.id !== id);
      // 選択中だったモデルを消したら選択も外す(存在しない id を残さない)。
      if (draft.model.manualActiveId === id) {
        draft.model.manualActiveId = null;
      }
      // 2体未満になったら自動切替は成立しないので落とす。残したままにすると、後でモデルを
      // 足して2体に戻った瞬間に**利用者が意識しないまま自動切替が復活**し、しかも新しい
      // スロットは未割当なので resolveActiveModel が3で一致せず4へ落ちる(意図しない挙動)。
      if (draft.model.slots.length < MAX_MODEL_SLOTS) {
        draft.model.autoSwitchByMode = false;
      }
    });
    return this.getSnapshot(warning);
  }

  /**
   * モードによる自動切替の ON/OFF。
   *
   * ON にする際、2体の `assignedAdapter` が code/chat の対になっていなければ
   * **先頭を code・次を chat として割り当てる**。割当が無いまま ON にすると
   * `resolveActiveModel` が該当なしでフォールバックし、「切り替わらない自動切替」になるため
   * (正本に初期割当の指定が無いので、ここで決めて明記する)。
   */
  setAutoSwitch(enabled: boolean): ModelManageSnapshot {
    this.deps.configStore.update((draft) => {
      draft.model.autoSwitchByMode = enabled;
      if (enabled && draft.model.slots.length === MAX_MODEL_SLOTS) {
        const assigned = draft.model.slots.map((s) => s.assignedAdapter);
        const isValidPair =
          (assigned[0] === 'code' && assigned[1] === 'chat') ||
          (assigned[0] === 'chat' && assigned[1] === 'code');
        if (!isValidPair) {
          draft.model.slots[0]!.assignedAdapter = 'code';
          draft.model.slots[1]!.assignedAdapter = 'chat';
        }
      }
    });
    return this.getSnapshot();
  }

  /** 自動切替オフ時に使うモデルを選ぶ(存在しない id は受け付けない)。 */
  setManualActive(id: string): ModelManageSnapshot {
    const exists = this.deps.configStore.current.model.slots.some((s) => s.id === id);
    if (!exists) {
      throw new Error('指定されたモデルは見つかりませんでした。');
    }
    this.deps.configStore.update((draft) => {
      draft.model.manualActiveId = id;
    });
    return this.getSnapshot();
  }

  /**
   * Code / Chat の担当を入れ替える(モックアップの「入れ替える」)。
   * 2体そろっていない場合は何もしない(入れ替える相手が無い)。
   */
  swapAssignment(): ModelManageSnapshot {
    this.deps.configStore.update((draft) => {
      if (draft.model.slots.length !== MAX_MODEL_SLOTS) {
        return;
      }
      const [a, b] = draft.model.slots;
      const swapped = a!.assignedAdapter;
      a!.assignedAdapter = b!.assignedAdapter;
      b!.assignedAdapter = swapped;
      // 片方でも未割当だった場合は対にならないので、割り当て直す(setAutoSwitch と同じ規則)。
      if (a!.assignedAdapter === null || b!.assignedAdapter === null) {
        a!.assignedAdapter = 'code';
        b!.assignedAdapter = 'chat';
      }
    });
    return this.getSnapshot();
  }
}

/** 削除・選択のIPCペイロード(モデルid)を検証する。 */
export function parseModelId(payload: unknown): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('モデルが指定されていません。');
  }
  return payload;
}

/** 相対パスの解決に使う(テスト・呼び出し元が modelsRoot を組み立てる際の共通化)。 */
export function modelsRootOf(userDataDir: string): string {
  return path.join(userDataDir, 'models');
}
