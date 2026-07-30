/**
 * モード設定タブ(FR-7)。UIの正: docs/mockups/control-panel.jsx L1181-1251。
 *  - Code Adapter セクション … 監視対象パス・ポート番号・連続失敗しきい値(L1183-1193)
 *  - Chat Adapter セクション … 動作モード・応答モデル・APIキー(L1195-1251)
 * 正本: chat-adapter-errors.md 論点5(APIキー取得の案内)、要件定義書 C-08(既定はmock)、
 *       shared/code-settings.ts(監視対象パスの入口の限定)。
 *
 * **2つのセクションは独立して読み込む**(CodeAdapterSection / ChatAdapterSection)。片方の
 * IPC 取得が失敗しても、もう片方は表示できるようにするため、共通の早期 return で全体を
 * 落とさない(各セクションが自分の loading/error を持つ)。
 *
 * **APIキーの扱い**(security.md 5章):
 *  - Main から降りてくるのは `hasApiKey` と**末尾4文字**だけで、キー本体は決して来ない。
 *  - よってこの画面は「保存済みのキーを編集する」ことができない。できるのは
 *    **入れ替える(新しいキーを入力して保存する)**か**消す**かのどちらか。
 *  - 入力中の値は `type="password"` で伏せる(画面共有・スクリーンショット対策)。
 *
 * **監視対象パスの扱い**(shared/code-settings.ts / onboarding-service.ts):
 *  - 追加はネイティブダイアログ経由(chooseProject)に限る。Renderer から任意のパスを配列へ
 *    書かせない(dispatch.sh の書き込み先を利用者の明示選択に限定する不変条件)。削除は安全。
 *
 * **反映タイミング**(嘘をつかない):
 *  - ポート番号は起動時にしかバインドされないため、変更は再起動後に反映される旨を明示する。
 *  - 連続失敗しきい値は Main 側で EmotionEngine を live 更新するため即座に効く。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(EmotionEngine・config の設定であって
 * キャラ描画に触れない)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FolderPlus, Trash2 } from 'lucide-react';

import { useTheme } from './theme';
import { ErrorNotice, Placeholder, Row, Section, Switch, TextInput } from './panel-ui';
import { ANTHROPIC_CONSOLE_URL, API_KEY_STEPS, RESPONSE_MODELS } from './catalog';
import type { ChatSettingsSnapshot } from '../../../shared/chat';
import type { CodeSettingsPatch, CodeSettingsSnapshot } from '../../../shared/code-settings';
import {
  FAIL_STREAK_MAX,
  FAIL_STREAK_MIN,
  SERVER_PORT_MAX,
  SERVER_PORT_MIN,
  isValidFailStreak,
  isValidPort,
} from '../../../shared/code-settings';

export function AdapterTab(): React.JSX.Element {
  // モックアップの並び(Code Adapter → Chat Adapter)に従う。各セクションは独立に読み込む。
  return (
    <>
      <CodeAdapterSection />
      <ChatAdapterSection />
    </>
  );
}

// ── Code Adapter セクション ─────────────────────────────────────────────

/** フルパスから末尾のフォルダ名を取り出す(ラベル用。パス全体は sub に出す)。macOSのみ対応。 */
function folderName(fullPath: string): string {
  const trimmed = fullPath.replace(/\/+$/, '');
  const name = trimmed.split('/').pop();
  return name && name.length > 0 ? name : fullPath;
}

function CodeAdapterSection(): React.JSX.Element {
  const theme = useTheme();
  const [settings, setSettings] = useState<CodeSettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 入力中のポート/しきい値。確定(onBlur)まで settings へ反映しない。 */
  const [portDraft, setPortDraft] = useState('');
  const [streakDraft, setStreakDraft] = useState('');

  useEffect(() => {
    const api = window.yorimashi?.codeAdapter;
    if (!api) {
      // preload が無い経路(ブラウザから /panel を直接開いた場合。environments.md)。
      setError('この画面からは設定を読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    void api
      .getSettings()
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setPortDraft(String(s.serverPort));
          setStreakDraft(String(s.failStreakThreshold));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '設定を読み込めませんでした。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** ポート/しきい値の更新。成功なら settings と入力欄を更新後の値で同期し直す。 */
  const applySettings = async (patch: CodeSettingsPatch): Promise<boolean> => {
    const api = window.yorimashi?.codeAdapter;
    if (!api) {
      return false;
    }
    try {
      const next = await api.setSettings(patch);
      setSettings(next);
      setPortDraft(String(next.serverPort));
      setStreakDraft(String(next.failStreakThreshold));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定を保存できませんでした。');
      return false;
    }
  };

  const chooseProject = async (): Promise<void> => {
    const api = window.yorimashi?.codeAdapter;
    if (!api) {
      return;
    }
    try {
      setSettings(await api.chooseProject());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォルダを追加できませんでした。');
    }
  };

  const removeProject = async (projectPath: string): Promise<void> => {
    const api = window.yorimashi?.codeAdapter;
    if (!api) {
      return;
    }
    try {
      setSettings(await api.removeProject(projectPath));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォルダを外せませんでした。');
    }
  };

  if (settings === null) {
    return error !== null ? <ErrorNotice message={error} /> : <Placeholder text="読み込んでいます…" />;
  }

  /** onBlur で確定。範囲外・空欄は保存せず、入力欄を最後に有効だった値へ戻してエラーを出す。 */
  const commitPort = (): void => {
    const trimmed = portDraft.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !isValidPort(n)) {
      setError(`ポート番号は ${SERVER_PORT_MIN}〜${SERVER_PORT_MAX} の整数で入力してください。`);
      setPortDraft(String(settings.serverPort));
      return;
    }
    if (n === settings.serverPort) {
      // 数値として等価でも表記が違う入力(例: "08765" / "8765.0")は正規形へ揃える。
      // applySettings 成功時が常に String(next.serverPort) で揃えるのと非対称にしない。
      setPortDraft(String(settings.serverPort));
      return; // 変化なし
    }
    void applySettings({ serverPort: n }).then((ok) => {
      if (!ok) {
        setPortDraft(String(settings.serverPort));
      }
    });
  };

  const commitStreak = (): void => {
    const trimmed = streakDraft.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !isValidFailStreak(n)) {
      setError(`回数は ${FAIL_STREAK_MIN}〜${FAIL_STREAK_MAX} の整数で入力してください。`);
      setStreakDraft(String(settings.failStreakThreshold));
      return;
    }
    if (n === settings.failStreakThreshold) {
      setStreakDraft(String(settings.failStreakThreshold)); // 上と同じ理由で正規形へ揃える
      return;
    }
    void applySettings({ failStreakThreshold: n }).then((ok) => {
      if (!ok) {
        setStreakDraft(String(settings.failStreakThreshold));
      }
    });
  };

  const watched = settings.watchedProjectPaths;
  const portSub =
    settings.actualPort !== null
      ? `現在 ${settings.actualPort} 番で待ち受け中。変更は再起動後に反映されます。`
      : 'サーバーは起動していません。変更は次回の起動時に反映されます。';

  return (
    <>
      <Section
        title="Code Adapter"
        hint="灯里が反応する対象です。監視対象を絞ると、選んだフォルダ以下での作業だけに反応します。"
      >
        {/*
          モックアップ(L1183-1187)は監視対象パスを単一Row + ChevronRight の静的表示にしているが、
          config.codeAdapter.watchedProjectPaths は**配列**(空=絞り込みなし。code-adapter.ts)で、
          モックの単一パスはその一例にすぎない。複数登録・個別削除・追加を実際に扱えるよう
          リストUIへ拡張する(モックにない要素の追加はこの正当性による)。
        */}
        {watched.length === 0 ? (
          <Row label="監視対象パス" sub="すべてのプロジェクトに反応します(絞り込みなし)">
            <AddFolderButton onClick={() => void chooseProject()} />
          </Row>
        ) : (
          <>
            {watched.map((p) => (
              <Row key={p} label={folderName(p)} sub={p}>
                <button
                  onClick={() => void removeProject(p)}
                  aria-label={`${folderName(p)}を監視対象から外す`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={14} color={theme.iconInactive} />
                </button>
              </Row>
            ))}
            <Row label="監視対象を追加" sub="選んだフォルダ以下の作業だけに反応するようになります">
              <AddFolderButton onClick={() => void chooseProject()} />
            </Row>
          </>
        )}

        <Row label="ポート番号" sub={portSub}>
          <TextInput
            value={portDraft}
            onChange={setPortDraft}
            onBlur={commitPort}
            mono
            width={92}
          />
        </Row>

        <Row
          label="連続失敗で焦り始める回数"
          sub="この回数だけ続けて失敗すると、灯里が「疲れ」の気分になります"
          last
        >
          <TextInput
            value={streakDraft}
            onChange={setStreakDraft}
            onBlur={commitStreak}
            mono
            width={64}
          />
        </Row>
      </Section>

      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}

function AddFolderButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  const theme = useTheme();
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: 'transparent',
        border: `1px solid ${theme.line}`,
        borderRadius: 999,
        padding: '5px 11px',
        color: theme.ink,
        fontFamily: "'M PLUS 1 Code', sans-serif",
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <FolderPlus size={13} /> 追加
    </button>
  );
}

// ── Chat Adapter セクション ─────────────────────────────────────────────

function ChatAdapterSection(): React.JSX.Element {
  const theme = useTheme();
  const [settings, setSettings] = useState<ChatSettingsSnapshot | null>(null);
  /** 入力中の新しいキー。**保存済みのキーはここへ入らない**(Mainから降りてこないため)。 */
  const [keyDraft, setKeyDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.yorimashi?.chat;
    if (!api) {
      // preload が無い経路(ブラウザから /panel を直接開いた場合。environments.md)。
      // 設定は読めない。**それらしい既定値を描かない**(嘘をつかない)。
      setError('この画面からは設定を読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    const reload = (): void => {
      void api
        .getSettings()
        .then((s) => {
          if (!cancelled) {
            setSettings(s);
          }
        })
        .catch((err: unknown) => {
          // then側と対称にガードする(reviewer #12 3周目 指摘・軽微)。
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '設定を読み込めませんでした。');
          }
        });
    };
    reload();
    // **会話ペイン(左)とこのタブ(右)は同一ウィンドウ内に常時併存する**(折りたたみ時を除く)。
    // 会話ペインの `/mock`・`/real`・`/model` チップは `ChatConfigSet` 経由でMainのconfigを
    // 直接更新するため、購読していないとこのタブの表示だけが古いまま残り、「もうrealなのに
    // mockの表示のまま」のような食い違いが起きる(reviewer #12 2周目 指摘1)。
    // `ChatConfigChanged` は `hasApiKey`/`apiKeyTail` を運ばないため、差分適用ではなく
    // `getSettings()` で**取り直す**(表示は常にMainのconfigが正)。
    const unsubscribe = api.onConfigChanged(reload);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /**
   * 戻り値は**成否**(reviewer #12 2周目 指摘2)。呼び出し側はこれを見て後始末を分岐する
   * (例: APIキー保存時、失敗しても入力欄を空にしない。以前は常にresolveするPromiseに
   * `.then`をぶら下げていたため、保存失敗時も打ち込んだキーが消えてしまっていた)。
   */
  const apply = async (
    patch: Parameters<NonNullable<typeof window.yorimashi>['chat']['setSettings']>[0],
  ): Promise<boolean> => {
    const api = window.yorimashi?.chat;
    if (!api) {
      return false;
    }
    try {
      setSettings(await api.setSettings(patch));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定を保存できませんでした。');
      return false;
    }
  };

  if (error !== null && settings === null) {
    return <ErrorNotice message={error} />;
  }
  if (settings === null) {
    return <Placeholder text="読み込んでいます…" />;
  }

  const isReal = settings.mode === 'real';

  return (
    <>
      <Section
        title="Chat Adapter"
        hint={
          isReal
            ? 'realでは送信のたびにAnthropic APIへ実接続します。接続に失敗しても、モックの固定返答で代用することはありません。'
            : 'mockは固定の返答を返すモードです。APIの利用料はかかりません。'
        }
      >
        <Row
          label="動作モード"
          sub={
            isReal
              ? 'Anthropic API に実際に接続します'
              : '固定の返答でコストをかけずに確認できます'
          }
        >
          <Switch
            checked={isReal}
            warn={isReal}
            onChange={(next) => void apply({ mode: next ? 'real' : 'mock' })}
          />
        </Row>

        <Row
          label="応答モデル"
          sub={isReal ? undefined : 'mockでは使いません'}
          last={!isReal && !settings.hasApiKey}
        >
          <select
            value={settings.model}
            disabled={!isReal}
            onChange={(e) => void apply({ model: e.target.value })}
            style={{
              background: isReal ? theme.bgRaised : theme.bgPanel,
              border: `1px solid ${theme.line}`,
              borderRadius: 8,
              padding: '7px 10px',
              color: isReal ? theme.ink : theme.disabledText,
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 13,
              outline: 'none',
            }}
          >
            {RESPONSE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="APIキー"
          sub={
            settings.hasApiKey
              ? `設定済み(末尾 ${settings.apiKeyTail})。新しいキーを入力すると入れ替わります`
              : isReal
                ? '未設定です。realでの送信には必要です'
                : 'mockでは不要です'
          }
          last={!isReal}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TextInput
              value={keyDraft}
              onChange={setKeyDraft}
              placeholder={isReal ? 'sk-ant-...' : 'モックでは不要'}
              disabled={!isReal}
              mono
              secret
              width={160}
            />
            <button
              disabled={!isReal || keyDraft.trim().length === 0}
              onClick={() => {
                void apply({ apiKey: keyDraft }).then((ok) => {
                  // **保存が成功したときだけ**入力欄を空にする。失敗時も消すと、
                  // ユーザーはエラーの原因を確かめる間もなく打ち直しを強いられる。
                  if (ok) {
                    setKeyDraft('');
                  }
                });
              }}
              style={{
                border: `1px solid ${theme.line}`,
                borderRadius: 8,
                background: theme.bgRaised,
                padding: '7px 10px',
                cursor: !isReal || keyDraft.trim().length === 0 ? 'default' : 'pointer',
                opacity: !isReal || keyDraft.trim().length === 0 ? 0.45 : 1,
                color: theme.ink,
                fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 12,
              }}
            >
              保存
            </button>
            {settings.hasApiKey && (
              <button
                onClick={() => void apply({ apiKey: '' })}
                style={{
                  border: `1px solid ${theme.sealRed}`,
                  borderRadius: 8,
                  background: 'transparent',
                  padding: '7px 10px',
                  cursor: 'pointer',
                  color: theme.warnText,
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 12,
                }}
              >
                削除
              </button>
            )}
          </div>
        </Row>

        {/* APIキーの取得手順。**realを選んだ時点で、401を待たずに見せる**(論点5)。 */}
        {isReal && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 16px',
              background: theme.bgRaised,
              borderTop: `1px solid ${theme.line}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: theme.inkDim,
                  letterSpacing: '0.02em',
                }}
              >
                APIキーの取得方法
              </span>
              <button
                // 素朴な window.open で既存の setWindowOpenHandler(src/main/control-panel-window.ts)に乗る。
                // Mainが shell.openExternal へリダイレクトし、Electronウィンドウは乗っ取らせない。
                // **専用のpreload IPCは新設しない**(論点5の実装TODOどおり、既存機構で足りた)。
                onClick={() => window.open(ANTHROPIC_CONSOLE_URL)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'transparent',
                  border: `1px solid ${theme.accent}`,
                  borderRadius: 999,
                  padding: '4px 10px',
                  color: theme.accent,
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <ExternalLink size={11} /> console.anthropic.com を開く
              </button>
            </div>
            {API_KEY_STEPS.map((step, i) => (
              <div key={step} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: `1px solid ${theme.accent}`,
                    color: theme.accent,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9.5,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 1,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    fontFamily: "'M PLUS 1 Code', sans-serif",
                    fontSize: 12,
                    color: theme.ink,
                    lineHeight: 1.6,
                  }}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 課金の注意(C-08: realへの切替が唯一の課金トリガー)。 */}
        {isReal && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              padding: '12px 16px',
              background: theme.sealRedTagSoft,
              borderTop: `1px solid ${theme.line}`,
            }}
          >
            <AlertTriangle
              size={15}
              color={theme.sealRed}
              style={{ flexShrink: 0, marginTop: 1 }}
            />
            <span
              style={{
                fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 12,
                color: theme.warnText,
                lineHeight: 1.6,
              }}
            >
              本番モードでは会話のたびに API 利用料がかかります。動作確認だけならモックのままで十分です。
            </span>
          </div>
        )}
      </Section>

      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}
