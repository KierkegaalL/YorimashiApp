/**
 * ログタブ(FR-11)の「エクスポート」「消去」をネイティブダイアログ付きで実行する層。
 *
 * HookEventLog(記録・保持・仮名化)と分けているのは、**記録側を Electron 非依存に保つ**ため。
 * 記録は hooks の受信経路(サンドボックスからでも検証できる純粋なファイル操作)であり、
 * ダイアログはここにしか無い。#10 の OnboardingService と同じ考え方。
 *
 * 消去は取り消せないので**必ずネイティブの確認ダイアログを通す**。既定ボタンは「やめる」。
 */

import fs from 'node:fs';
import { dialog, type BrowserWindow } from 'electron';

import type { HookEventLog } from './hook-event-log';
import type { HookLogClearResult, HookLogExportResult } from '../../shared/hook-log';

export interface LogActionsDeps {
  log: HookEventLog;
  /** ダイアログの親ウィンドウ(Control Panel)。 */
  getParentWindow: () => BrowserWindow | null;
}

export class LogActions {
  constructor(private readonly deps: LogActionsDeps) {}

  /**
   * 共有用に仮名化したJSONLを保存する。**元のログは変更しない**(要件4.11)。
   * 0件のときはファイルを作らない(中身の無いファイルを渡さない)。
   */
  async export(): Promise<HookLogExportResult> {
    let body: string;
    let entryCount: number;
    try {
      ({ body, entryCount } = this.deps.log.buildMaskedExport());
    } catch (err) {
      return { status: 'failed', message: toMessage(err) };
    }
    if (entryCount === 0) {
      return { status: 'empty' };
    }

    const parent = this.deps.getParentWindow();
    const options: Electron.SaveDialogOptions = {
      title: 'hooks イベントログを書き出す(共有用・パスをマスク)',
      defaultPath: defaultExportFileName(),
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { status: 'canceled' };
    }

    try {
      // 書き出し先は利用者が選んだ共有用ファイル。0600に締めない(共有が目的のため)。
      fs.writeFileSync(result.filePath, body, 'utf-8');
      return { status: 'saved', path: result.filePath, entryCount };
    } catch (err) {
      return { status: 'failed', message: toMessage(err) };
    }
  }

  /** 確認ダイアログを出してからログを消去する。 */
  async clear(): Promise<HookLogClearResult> {
    const parent = this.deps.getParentWindow();
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['やめる', '消去する'],
      defaultId: 0,
      cancelId: 0,
      message: 'hooks イベントログを消去しますか?',
      detail: '記録済みのイベントがすべて消えます。この操作は取り消せません。',
    };
    const answer = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (answer.response !== 1) {
      return { status: 'canceled' };
    }

    try {
      return { status: 'cleared', removedCount: this.deps.log.clear() };
    } catch (err) {
      return { status: 'failed', message: toMessage(err) };
    }
  }
}

/** `hook-events-2026-07-20.jsonl` のような既定ファイル名。 */
function defaultExportFileName(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `hook-events-${stamp}.jsonl`;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
