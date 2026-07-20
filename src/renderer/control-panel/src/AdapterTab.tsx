/**
 * モード設定タブ(FR-7)の **Chat Adapter セクション**(#12)。
 * UIの正: docs/mockups/control-panel.jsx L1195-1251(Chat Adapter の Section)。
 * 正本: chat-adapter-errors.md 論点5(APIキー取得の案内)、要件定義書 C-08(既定はmock)。
 *
 * **このタブは #12 では Chat Adapter セクションだけを実装する**。同じタブに置かれる
 * Code Adapter セクション(監視対象パス・ポート番号・連続失敗のしきい値。モックアップ
 * L1183-1193)は別タスクの範囲であり、ここで中途半端に作らない。**偽の値を描かない**ため、
 * 未実装であることを正直に示すプレースホルダを置く(#6 で右ペインに対して立てた方針と同じ)。
 *
 * **APIキーの扱い**(security.md 5章):
 *  - Main から降りてくるのは `hasApiKey` と**末尾4文字**だけで、キー本体は決して来ない。
 *  - よってこの画面は「保存済みのキーを編集する」ことができない。できるのは
 *    **入れ替える(新しいキーを入力して保存する)**か**消す**かのどちらか。
 *    編集できるように見せると、実際には空文字で上書きしてしまう事故になる。
 *  - 入力中の値は `type="password"` で伏せる(画面共有・スクリーンショット対策)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(Chat Adapter の設定であって
 * キャラ描画に触れない)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

import { useTheme } from './theme';
import { Row, Section, Switch, TextInput } from './panel-ui';
import { ANTHROPIC_CONSOLE_URL, API_KEY_STEPS, RESPONSE_MODELS } from './catalog';
import type { ChatSettingsSnapshot } from '../../../shared/chat';

export function AdapterTab(): React.JSX.Element {
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
        title="Code Adapter"
        hint="監視対象パス・ポート番号・しきい値の編集はこのタブの後続タスクで実装します。"
      >
        {/* **未実装を未実装として示す**。モックアップの値(~/dev/kotokoro-diary・8765・3)を
            そのまま描くと、設定できるように見えて実際には何も反映されない画面になる。 */}
        <Row label="未実装" sub="現在の設定値の表示・編集はまだできません" last />
      </Section>

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

function Placeholder({ text }: { text: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        fontFamily: "'M PLUS 1 Code', sans-serif",
        fontSize: 13,
        color: theme.inkDim,
        padding: 16,
      }}
    >
      {text}
    </div>
  );
}

function ErrorNotice({ message }: { message: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: 12,
        borderRadius: 10,
        background: theme.sealRedTagSoft,
        border: `1px solid ${theme.line}`,
      }}
    >
      <AlertTriangle size={15} color={theme.sealRed} style={{ flexShrink: 0, marginTop: 1 }} />
      <span
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 12,
          color: theme.warnText,
          lineHeight: 1.6,
        }}
      >
        {message}
      </span>
    </div>
  );
}
