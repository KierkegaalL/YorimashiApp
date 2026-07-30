/**
 * 全体設定タブ(FR-7/FR-10)。UIの正: docs/mockups/control-panel.jsx L1255-1346。
 *  - 配色テーマ … light/dark/system の3枚のスウォッチカード(L1257-1314。要件定義書 C-15)
 *  - 表示 … キャラのサイズ(スライダー)・クリックスルー(L1316-1329)
 *  - 起動 … ログイン時の自動起動(L1331-1335)
 *  - 気分の変化 … リアクション持続・sleepyまでの時間(L1337-1344。**表示のみ**)
 *
 * 正本: shared/general-settings.ts(検証規則と契約)、main/general-settings.ts(適用先)。
 *
 * **反映タイミングと「嘘をつかない」**:
 *  - 配色テーマは即座に効く(このウィンドウの描画のみ)。シェル(App)が同じ通知を購読しており、
 *    ここで変えると画面全体の配色が変わる。
 *  - キャラのサイズはキャラクターウィンドウの物理サイズ(`baseResolution × displaySize`)を
 *    変えるため Main がリサイズする。**スライダー操作中は送らず、離した時(onPointerUp相当の
 *    onChangeCommitted)に確定する**。ドラッグ中に毎フレーム送るとウィンドウのリサイズが
 *    連打され、config への書き込みも大量に走る。
 *  - 自動起動は**OSのログイン項目へ実際に登録する**。ただし開発実行(未パッケージ)では
 *    登録が機能しないため、その旨を明示して**トグル自体を無効化する**(押せるのに効かない、
 *    という状態を作らない)。config の意思と実際の登録状態がずれていれば注意書きを出す。
 *  - 「気分の変化」の2項目はモックアップが素の数値表示にしているため編集UIを足さない
 *    (足すならUIの正本=モックアップ側から変える)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(config の設定値のみを扱う。
 * キャラのサイズはウィンドウ寸法に効くが、その計算は両形式共通の `resolveWindowSize()` で
 * 形式で分岐しない=character-window.md 論点2の決着)。よって対称性チェック
 * (CLAUDE.md原則4)の対象外。
 *
 * **⚠️ ウィンドウ寸法の計算(このタブが担当)は共通だが、その中でのキャラクターの見た目の
 * 占有率はLive2D限定で異なる(2026-07-30、shared/general-settings.ts の DISPLAY_SIZE_MAX
 * コメント参照)**。このタブ・`resolveWindowSize()`側は変更不要(スライダーが操作する`displaySize`
 * の意味・範囲は不変)。
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Monitor } from 'lucide-react';

import { THEMES, useTheme } from './theme';
import { ErrorNotice, Placeholder, Row, Section, Switch } from './panel-ui';
import {
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  THEME_MODES,
  type GeneralSettingsPatch,
  type GeneralSettingsSnapshot,
  type ThemeMode,
} from '../../../shared/general-settings';

/** 0.2〜1.0 ↔ 20〜100(%)。モックアップのスライダーは百分率で出す(L1319-1323)。 */
const toPercent = (ratio: number): number => Math.round(ratio * 100);
const fromPercent = (percent: number): number => percent / 100;

/** ミリ秒を「3.0秒」「5分」の形にする(モックアップ L1339/L1342 の表記に合わせる)。 */
function formatDuration(ms: number): string {
  if (ms >= 60000) {
    const minutes = ms / 60000;
    // 割り切れないときだけ小数第1位まで出す(5分 / 5.5分)。
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}分`;
  }
  return `${(ms / 1000).toFixed(1)}秒`;
}

export function GeneralTab(): React.JSX.Element {
  const theme = useTheme();
  const [settings, setSettings] = useState<GeneralSettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * スライダーのつまみ位置(%)。ドラッグ中は settings へ反映せずここだけを動かし、
   * 離した時に確定する(冒頭コメント参照)。null = 保存済みの値をそのまま使う。
   */
  const [sizeDraft, setSizeDraft] = useState<number | null>(null);
  /** 直近に受け取った保存済みの表示サイズ。変更通知が表示サイズ由来かの判定に使う。 */
  const lastDisplaySize = useRef<number | null>(null);

  useEffect(() => {
    const api = window.yorimashi?.general;
    if (!api) {
      // preload が無い経路(ブラウザから /panel を直接開いた場合。environments.md)。
      // **それらしい既定値を描かない**(嘘をつかない)。
      setError('この画面からは設定を読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    void api
      .getSettings()
      .then((s) => {
        if (!cancelled) {
          lastDisplaySize.current = s.displaySize;
          setSettings(s);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '設定を読み込めませんでした。');
        }
      });
    // クリックスルーは**メニューバー(Tray)からも切り替わる**(FR-6/C-19)。購読しないと
    // このタブのトグルだけが古い値のまま残る(AdapterTab が ChatConfigChanged を購読するのと同じ理由)。
    const unsubscribe = api.onChanged((snapshot) => {
      if (cancelled) {
        return;
      }
      // **表示サイズが実際に変わったときだけ**下書きを捨てる。この通知はクリックスルー等の
      // 別項目の変更でも飛んでくるため、無条件に捨てるとキー操作中の未確定値が
      // 無関係な変更で消えてしまう。比較は ref で行う(setState の更新関数の中で
      // 別の setState を呼ぶと、StrictMode の二重呼び出しで副作用が重複する)。
      if (lastDisplaySize.current !== snapshot.displaySize) {
        setSizeDraft(null);
      }
      lastDisplaySize.current = snapshot.displaySize;
      setSettings(snapshot);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const apply = async (patch: GeneralSettingsPatch): Promise<void> => {
    const api = window.yorimashi?.general;
    if (!api) {
      return;
    }
    try {
      setSettings(await api.setSettings(patch));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定を保存できませんでした。');
    }
  };

  if (settings === null) {
    return error !== null ? <ErrorNotice message={error} /> : <Placeholder text="読み込んでいます…" />;
  }

  const sizePercent = sizeDraft ?? toPercent(settings.displaySize);
  // config の意思とOSの実登録状態のずれ(システム設定から直接外された等)。
  const autostartMismatch =
    settings.autostartSupported &&
    settings.autostartRegistered !== null &&
    settings.autostartRegistered !== settings.autostart;

  return (
    <>
      <Section
        title="配色テーマ"
        hint={
          settings.themeMode === 'system'
            ? `OSの配色設定に連動しています(現在: ${theme.label}として表示中)`
            : '「システムに合わせる」を選ぶと、OSのライト/ダーク設定に自動追従します。'
        }
      >
        <div style={{ display: 'flex', gap: 8, padding: '14px 16px' }}>
          {THEME_MODES.map((mode) => (
            <ThemeSwatch
              key={mode}
              mode={mode}
              active={settings.themeMode === mode}
              onSelect={() => void apply({ themeMode: mode })}
            />
          ))}
        </div>
      </Section>

      <Section title="表示">
        <Row label="キャラのサイズ">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={toPercent(DISPLAY_SIZE_MIN)}
              max={toPercent(DISPLAY_SIZE_MAX)}
              value={sizePercent}
              onChange={(e) => setSizeDraft(Number(e.target.value))}
              // ドラッグを離した時・キー操作を終えた時に確定する(冒頭コメント参照)。
              // onChange で送るとリサイズとconfig書き込みが連打される。
              onPointerUp={() => {
                if (sizeDraft !== null) {
                  void apply({ displaySize: fromPercent(sizeDraft) }).finally(() =>
                    setSizeDraft(null),
                  );
                }
              }}
              onKeyUp={() => {
                if (sizeDraft !== null) {
                  void apply({ displaySize: fromPercent(sizeDraft) }).finally(() =>
                    setSizeDraft(null),
                  );
                }
              }}
              style={{ width: 90 }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: theme.inkDim,
                width: 32,
              }}
            >
              {sizePercent}%
            </span>
          </div>
        </Row>
        <Row label="裏の操作をそのまま通す" sub="キャラ以外の場所はクリックスルー" last>
          <Switch
            checked={settings.clickThrough}
            onChange={(next) => void apply({ clickThrough: next })}
          />
        </Row>
      </Section>

      <Section
        title="起動"
        hint={
          settings.autostartSupported
            ? undefined
            : // 開発実行では登録しても意味が無い(node_modules内のElectronが登録される)。
              // 「押せるのに効かない」を避けるためトグルを無効化し、理由を明示する。
              '開発中のビルドでは、この設定はOSへ登録されません(パッケージ済みのアプリでのみ有効です)。'
        }
      >
        <Row label="ログイン時に自動で起動する" sub={autostartMismatch ? autostartMismatchNote(settings) : undefined} last>
          <Switch
            checked={settings.autostart}
            disabled={!settings.autostartSupported}
            onChange={(next) => void apply({ autostart: next })}
          />
        </Row>
      </Section>

      {/* モックアップ(L1337-1344)どおり**表示のみ**。編集UIは正本に無いので足さない。 */}
      <Section title="気分の変化" hint="反応がどれくらいの速さで元の気分に戻るかを調整します。">
        <Row label="リアクションの持続時間">
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: theme.ink }}>
            {formatDuration(settings.reactionDurationMs)}
          </span>
        </Row>
        <Row label="無操作でうとうとし始めるまで" last>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: theme.ink }}>
            {formatDuration(settings.idleTimeoutMs)}
          </span>
        </Row>
      </Section>

      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}

/** config の意思とOSの実登録状態がずれている旨の注記(隠さず出す)。 */
function autostartMismatchNote(settings: GeneralSettingsSnapshot): string {
  return settings.autostartRegistered === true
    ? 'OS側にはログイン項目として登録されたままです(設定を切り替え直すと揃います)'
    : 'OS側のログイン項目が外れています(設定を切り替え直すと揃います)';
}

/**
 * 配色テーマ1枚ぶんのスウォッチカード(モックアップ L1272-1310)。
 * `system` は半分ずつの斜めグラデーション + モニタアイコンで「OSに合わせる」を表す。
 */
function ThemeSwatch({
  mode,
  active,
  onSelect,
}: {
  mode: ThemeMode;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const isSystem = mode === 'system';
  // system 以外は**そのテーマ自身の色**でカードを塗る(選ぶ前に見た目が分かる)。
  const own = isSystem ? null : THEMES[mode];
  const cardBg = own ? own.bgBase : theme.bgPanel;
  const labelColor = own ? own.ink : theme.ink;

  return (
    <button
      onClick={onSelect}
      style={{
        flex: 1,
        cursor: 'pointer',
        borderRadius: 12,
        padding: 10,
        border: active ? `2px solid ${theme.accent}` : `1px solid ${theme.line}`,
        background: cardBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        position: 'relative',
      }}
    >
      {active && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: theme.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Check size={11} color={cardBg} strokeWidth={3} />
        </div>
      )}
      {isSystem ? (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${THEMES.light.bgBase} 50%, ${THEMES.dark.bgBase} 50%)`,
            border: `1px solid ${theme.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Monitor size={14} color={theme.ink} strokeWidth={1.8} />
        </div>
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: own?.swatchAccent,
          }}
        />
      )}
      <span
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 11,
          fontWeight: 600,
          color: labelColor,
          textAlign: 'center',
          lineHeight: 1.3,
          whiteSpace: 'pre-line',
        }}
      >
        {isSystem ? 'システムに\n合わせる' : own?.label}
      </span>
    </button>
  );
}
