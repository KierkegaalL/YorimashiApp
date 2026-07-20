/**
 * オンボーディング(FR-14)。詳細設計の正本: docs/detailed-design/onboarding.md。
 * UIの語彙・配色の正: docs/mockups/control-panel.jsx(モックアップにこの画面は無いため、
 * 既存のトークン=theme.ts と呪紋リングの表現だけを流用し、新しい語彙を持ち込まない)。
 *
 * 4ステップ(ようこそ → モデル → モード → 完了)。C-14 の「4ステップ」を変えないため、
 * **hooks設定はモード選択ステップの中に畳み込む**(onboarding.md 論点3)。
 *
 * 貫く原則: **一度も行き止まりを作らず、未完了の項目について嘘をつかない**。
 *  - どのステップも必須にしない(モデル0体・hooks未設定・mockはいずれも正当な完了状態)
 *  - 完了画面は「完了しました」とだけ出さず、**実測した**状態(OnboardingSnapshot.hooks)を示す
 *
 * Control Panel ウィンドウ内のオーバーレイとして出す(別ウィンドウにしない)。完了時に
 * ホームタブへ遷移するという決定(論点4)が、同一ウィンドウであることを前提にしているため。
 *
 * 形式非依存: Live2D/スプライトセットのどちらにも分岐しない(onboarding.md「形式による分岐に
 * ついて」)。モデルの取り込み処理そのものはモデル管理タブの管轄で、ここは導線を見せるだけ。
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, Copy, FolderOpen, TriangleAlert } from 'lucide-react';

import { useTheme, type Theme } from './theme';
import type { AdapterMode } from './types';
import type { DispatchInstallResult, OnboardingSnapshot } from '../../../shared/onboarding';

type StepId = 'welcome' | 'model' | 'adapter' | 'done';

const STEPS: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: 'welcome', label: 'ようこそ' },
  { id: 'model', label: 'モデル' },
  { id: 'adapter', label: 'モード' },
  { id: 'done', label: '完了' },
];

export interface OnboardingProps {
  /** 完了(スキップ含む)。App がオーバーレイを閉じ、ホームタブへ遷移する。 */
  onFinish: () => void;
  /** モデル管理タブへ送る(完了扱いにしてから遷移する)。 */
  onOpenModelTab: () => void;
  /** アダプタ切替(FR-1)。正本は config なので App 経由で Main へ委譲する。 */
  onSetAdapterMode: (mode: AdapterMode) => void;
}

export function Onboarding({
  onFinish,
  onOpenModelTab,
  onSetAdapterMode,
}: OnboardingProps): React.JSX.Element | null {
  const theme = useTheme();
  const [step, setStep] = useState<StepId>('welcome');
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  /** 完了演出(呪紋リングが一度強く回る)の最中か。演出後に onFinish する。 */
  const [sealing, setSealing] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.yorimashi?.onboarding;
    if (!api) {
      return;
    }
    setSnapshot(await api.get());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 完了として記録し、演出を挟んでからオーバーレイを閉じる。 */
  const finish = (then: () => void): void => {
    setSealing(true);
    const api = window.yorimashi?.onboarding;
    const done = (): void => {
      // 演出(0.9秒)を待ってから遷移する。灯里が「降りてくる」表現(論点4)。
      window.setTimeout(then, 900);
    };
    if (api) {
      void api.complete().then(done, done);
    } else {
      // preload の無い経路(ブラウザでの表示確認など)。記録はできないが行き止まりにしない。
      done();
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: theme.bgBase,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'M PLUS 1 Code', sans-serif",
        color: theme.ink,
        opacity: sealing ? 0 : 1,
        transition: 'opacity 0.5s ease 0.4s',
      }}
    >
      <StepBar theme={theme} current={stepIndex} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px 32px' }}>
        {step === 'welcome' && (
          <WelcomeStep
            theme={theme}
            onNext={() => setStep('model')}
            // スキップは**完了画面へ直行**する(onboarding.md 論点1)。ここで即座に閉じると、
            // 完了画面の最重要の役割であるメニューバーアイコンの告知を一度も見せないまま
            // completed=true が確定し、二度と出せなくなる(既定 clickThrough:true の唯一の逃げ道)。
            onSkip={() => {
              void refresh();
              setStep('done');
            }}
          />
        )}
        {step === 'model' && (
          <ModelStep
            theme={theme}
            modelCount={snapshot?.modelCount ?? 0}
            onNext={() => setStep('adapter')}
          />
        )}
        {step === 'adapter' && (
          <AdapterStep
            theme={theme}
            snapshot={snapshot}
            onSetAdapterMode={onSetAdapterMode}
            onRefresh={refresh}
            onNext={() => {
              void refresh();
              setStep('done');
            }}
          />
        )}
        {step === 'done' && (
          <DoneStep
            theme={theme}
            snapshot={snapshot}
            onFinish={() => finish(onFinish)}
            onOpenModelTab={() => finish(onOpenModelTab)}
            sealing={sealing}
          />
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

function StepBar({ theme, current }: { theme: Theme; current: number }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '14px 28px',
        borderBottom: `1px solid ${theme.line}`,
        background: theme.bgRaised,
      }}
    >
      {STEPS.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: i === current ? 700 : 500,
              color: i === current ? theme.accent : i < current ? theme.inkDim : theme.iconInactive,
            }}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && <ChevronRight size={11} color={theme.iconInactive} />}
        </div>
      ))}
    </div>
  );
}

function Heading({ theme, children }: { theme: Theme; children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: theme.ink }}>{children}</h2>
  );
}

function Body({ theme, children }: { theme: Theme; children: React.ReactNode }): React.JSX.Element {
  return (
    <p style={{ margin: '0 0 14px', fontSize: 12, lineHeight: 1.9, color: theme.inkDim }}>{children}</p>
  );
}

function PrimaryButton({
  theme,
  onClick,
  children,
}: {
  theme: Theme;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 18px',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: 'inherit',
        color: '#fff',
        background: theme.accent,
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  theme,
  onClick,
  children,
}: {
  theme: Theme;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        fontSize: 12,
        fontFamily: 'inherit',
        color: theme.inkDim,
        background: 'none',
        border: `1px solid ${theme.line}`,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Actions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 20 }}>{children}</div>;
}

/* ══ ステップ1: ようこそ ═══════════════════════════════════════════════════ */

/**
 * 世界観の読み物にはしない。**UIに実際に出てくる3語**(憑坐・霊力状態・常世灯里)を
 * 通じさせることだけが役割(onboarding.md 論点1)。スキップ可(完了画面へ直行する)。
 */
function WelcomeStep({
  theme,
  onNext,
  onSkip,
}: {
  theme: Theme;
  onNext: () => void;
  onSkip: () => void;
}): React.JSX.Element {
  const terms = [
    { term: '常世灯里(とこよ あかり)', desc: 'このアプリに宿るキャラクターの名前です。' },
    {
      term: '憑坐(よりまし)',
      desc: '灯里の役どころ。あなたの作業に憑いて、代わりに反応する存在です。',
    },
    {
      term: '霊力状態',
      desc: '灯里の今の気分。作業の調子に応じて 静穏(せいおん) → 昂揚(こうよう) / 減衰(げんすい) と移ります。',
    },
  ];

  return (
    <div>
      <Heading theme={theme}>ようこそ</Heading>
      <Body theme={theme}>
        画面に出てくる言葉を3つだけ紹介します。ここを読んでおくと、以降の表示がそのまま読めます。
      </Body>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {terms.map((t) => (
          <div
            key={t.term}
            style={{
              padding: '12px 14px',
              background: theme.bgPanel,
              border: `1px solid ${theme.line}`,
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.accent, marginBottom: 4 }}>
              {t.term}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.8, color: theme.inkDim }}>{t.desc}</div>
          </div>
        ))}
      </div>
      <Actions>
        <PrimaryButton theme={theme} onClick={onNext}>
          次へ
        </PrimaryButton>
        <GhostButton theme={theme} onClick={onSkip}>
          スキップ
        </GhostButton>
      </Actions>
    </div>
  );
}

/* ══ ステップ2: モデル ═════════════════════════════════════════════════════ */

/**
 * **必須にしない**(onboarding.md 論点2)。スプライトセットの生成は外部の動画生成AIサービスを
 * 挟むためアプリの中で一続きに完了できず、必須にすると初回起動が行き止まりになる。
 * この画面の役割は「導線を見せること」であって「完了させること」ではない。
 */
function ModelStep({
  theme,
  modelCount,
  onNext,
}: {
  theme: Theme;
  modelCount: number;
  onNext: () => void;
}): React.JSX.Element {
  return (
    <div>
      <Heading theme={theme}>灯里の姿を用意する</Heading>
      <Body theme={theme}>
        モデルは2種類の形式から選べます。<strong>いま決めなくてかまいません</strong>
        。あとから「モデル」タブでいつでも追加できます。
      </Body>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* C-16: スプライトセットを標準の入口として先に置く。 */}
        <FormatCard
          theme={theme}
          title="スプライトセット"
          badge="おすすめ"
          desc="静止画1枚から作れます。途中で外部の動画生成サービスを使うため、数分〜数時間かかります(アプリの外での作業になります)。"
          recommended
        />
        <FormatCard
          theme={theme}
          title="Live2D"
          badge="上級者向け"
          desc="お手元にLive2Dモデル(model3.json / moc3)がある場合は、フォルダやzipをドロップするだけで取り込めます。"
        />
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 11.5,
          lineHeight: 1.8,
          color: modelCount > 0 ? theme.mint : theme.inkDim,
        }}
      >
        {modelCount > 0
          ? `導入済みのモデル: ${modelCount}体`
          : 'まだモデルはありません。モデルが無い間、灯里の姿は表示されません。'}
      </div>

      <Actions>
        <PrimaryButton theme={theme} onClick={onNext}>
          次へ
        </PrimaryButton>
        {/*
          この画面からタブへ直行するボタンは置かない(onboarding.md 論点2「この画面の役割は
          導線を見せることであって完了させることではない」)。ここで抜けられるようにすると、
          完了画面のメニューバー告知を見せないまま completed=true が確定しうる(論点4)。
          実際にモデル管理タブへ送るのは完了画面の「モデルを追加する」。
        */}
        <span style={{ fontSize: 11, color: theme.iconInactive }}>
          追加は完了後に「モデル」タブから行えます
        </span>
      </Actions>
    </div>
  );
}

function FormatCard({
  theme,
  title,
  badge,
  desc,
  recommended = false,
}: {
  theme: Theme;
  title: string;
  badge: string;
  desc: string;
  recommended?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: theme.bgPanel,
        border: `1px solid ${recommended ? theme.accent : theme.line}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.ink }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 999,
            color: recommended ? theme.accent : theme.inkDim,
            background: recommended ? theme.accentTag : 'transparent',
            border: recommended ? 'none' : `1px solid ${theme.line}`,
          }}
        >
          {badge}
        </span>
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.8, color: theme.inkDim }}>{desc}</div>
    </div>
  );
}

/* ══ ステップ3: モード(+ hooks設定を畳み込む) ═════════════════════════════ */

/**
 * 初期値は **Code Adapter**(onboarding.md 論点3)。アプリの存在理由がClaude Codeの作業実況に
 * あるため。ただしCodeを選んだだけでは灯里は永久に無反応なので、**同じ画面にhooks設定を出す**。
 * これが4ステップという構成を変えずに穴を塞ぐための畳み込み。
 */
function AdapterStep({
  theme,
  snapshot,
  onSetAdapterMode,
  onRefresh,
  onNext,
}: {
  theme: Theme;
  snapshot: OnboardingSnapshot | null;
  onSetAdapterMode: (mode: AdapterMode) => void;
  onRefresh: () => Promise<void>;
  onNext: () => void;
}): React.JSX.Element {
  /**
   * 選択の見た目。**正本は config(Main)** なので snapshot に従うが、`setConfig` は
   * fire-and-forget の `send` で、この画面は `onConfigChanged` を購読していない。
   * snapshot だけを見ると、押しても選択枠が動かず hooks 設定の開閉も起きない
   * (＝操作に対する視覚的な反応が無い)。そこで押した値を楽観的に保持し、
   * `onRefresh()` で届いた config の値が来たらそちらへ収束させる。
   */
  const [pendingAdapter, setPendingAdapter] = useState<AdapterMode | null>(null);
  const confirmed: AdapterMode = snapshot?.activeAdapter ?? 'code';
  const active: AdapterMode = pendingAdapter ?? confirmed;

  // config 側が押した値に追いついたら、楽観値を捨てて正本へ戻す(Tray等からの
  // 外部変更をこの画面が握り潰さないようにするため)。
  useEffect(() => {
    if (pendingAdapter !== null && confirmed === pendingAdapter) {
      setPendingAdapter(null);
    }
  }, [confirmed, pendingAdapter]);

  const selectAdapter = (mode: AdapterMode): void => {
    setPendingAdapter(mode);
    onSetAdapterMode(mode);
    void onRefresh();
  };

  return (
    <div>
      <Heading theme={theme}>灯里が何に反応するかを選ぶ</Heading>
      <Body theme={theme}>
        あとから「ホーム」タブでいつでも切り替えられます。ここで決めるのは入口だけです。
      </Body>

      <div style={{ display: 'flex', gap: 10 }}>
        <AdapterCard
          theme={theme}
          selected={active === 'code'}
          title="Code Adapter"
          desc="Claude Code での作業に反応します(このアプリの主目的)。"
          onClick={() => selectAdapter('code')}
        />
        <AdapterCard
          theme={theme}
          selected={active === 'chat'}
          title="Chat Adapter"
          desc="会話ペインでの対話に反応します。設定なしですぐ試せます。"
          onClick={() => selectAdapter('chat')}
        />
      </div>

      {active === 'code' ? (
        <HooksSetup theme={theme} snapshot={snapshot} onRefresh={onRefresh} />
      ) : (
        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            border: `1px solid ${theme.line}`,
            borderRadius: 8,
            background: theme.bgPanel,
            fontSize: 11.5,
            lineHeight: 1.8,
            color: theme.inkDim,
          }}
        >
          いまは <strong>mock(固定返答)</strong> で動きます。料金はかかりません。実際に Claude
          と話すには API キーの設定が必要です(「モード」タブ)。
        </div>
      )}

      <Actions>
        <PrimaryButton theme={theme} onClick={onNext}>
          次へ
        </PrimaryButton>
        {active === 'code' && (
          <span style={{ fontSize: 11, color: theme.iconInactive }}>
            設定はあとからでもかまいません
          </span>
        )}
      </Actions>
    </div>
  );
}

function AdapterCard({
  theme,
  selected,
  title,
  desc,
  onClick,
}: {
  theme: Theme;
  selected: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 8,
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: selected ? theme.accentTag : theme.bgPanel,
        border: `1px solid ${selected ? theme.accent : theme.line}`,
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          marginBottom: 5,
          color: selected ? theme.accent : theme.ink,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.8, color: theme.inkDim }}>{desc}</div>
    </button>
  );
}

/**
 * hooks設定(Code Adapter を選んだときだけ展開)。
 *
 * アプリが行うのは **dispatch.sh の配置まで**。`.claude/settings.json` は利用者の既存ファイルで、
 * 既にhooksが設定されている可能性があるため**上書きせず、コピー用に提示するだけ**にする
 * (onboarding.md 論点3)。
 */
function HooksSetup({
  theme,
  snapshot,
  onRefresh,
}: {
  theme: Theme;
  snapshot: OnboardingSnapshot | null;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** プロジェクトごとの直近の配置結果(成功も失敗もそのまま出す)。 */
  const [installResults, setInstallResults] = useState<Record<string, DispatchInstallResult>>({});

  const api = window.yorimashi?.onboarding;
  const projects = snapshot?.hooks ?? [];

  const chooseProject = async (): Promise<void> => {
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      await api.chooseProject();
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const install = async (projectPath: string, overwrite: boolean): Promise<void> => {
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.installDispatchScript(projectPath, overwrite);
      setInstallResults((prev) => ({ ...prev, [projectPath]: result }));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const copySnippet = async (): Promise<void> => {
    if (!api) {
      return;
    }
    await api.copySettingsSnippet();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 8,
          background: theme.sealRedTagSoft,
          border: `1px solid ${theme.line}`,
          fontSize: 11.5,
          lineHeight: 1.8,
          color: theme.warnText,
          marginBottom: 14,
        }}
      >
        Code Adapter は、選んだだけでは反応しません。Claude Code 側から知らせを送るための設定が
        必要です。ここで済ませられます(あとからでもかまいません)。
      </div>

      {/* ── 1. 監視するプロジェクト ─────────────────────────── */}
      <SetupSection theme={theme} step={1} title="監視するプロジェクトを選ぶ">
        <button
          onClick={() => void chooseProject()}
          disabled={busy || !api}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 12px',
            fontSize: 11.5,
            fontFamily: 'inherit',
            color: theme.ink,
            background: theme.bgRaised,
            border: `1px solid ${theme.line}`,
            borderRadius: 6,
            cursor: busy || !api ? 'default' : 'pointer',
            opacity: busy || !api ? 0.6 : 1,
          }}
        >
          <FolderOpen size={13} color={theme.accent} />
          フォルダを選ぶ…
        </button>

        {projects.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: theme.iconInactive }}>
            まだ選ばれていません。
          </div>
        )}

        {projects.map((p) => {
          const result = installResults[p.projectPath];
          return (
            <div
              key={p.projectPath}
              style={{
                marginTop: 10,
                padding: '10px 12px',
                background: theme.bgPanel,
                border: `1px solid ${theme.line}`,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'ui-monospace, monospace',
                  color: theme.ink,
                  wordBreak: 'break-all',
                  marginBottom: 8,
                }}
              >
                {p.projectPath}
              </div>

              {/* 実測した状態だけを出す(推測で「設定済み」と言わない)。 */}
              <StatusLine
                theme={theme}
                ok={p.dispatchScriptPlaced}
                okText={`${snapshot?.dispatchScriptRelPath ?? 'dispatch.sh'} を配置済み`}
                ngText={`${snapshot?.dispatchScriptRelPath ?? 'dispatch.sh'} は未配置`}
              />
              <StatusLine
                theme={theme}
                ok={p.settingsReferencesDispatch}
                unknown={p.probeError !== null}
                okText=".claude/settings.json に hooks 設定あり"
                ngText={
                  p.settingsExists
                    ? '.claude/settings.json に hooks 設定が見つかりません'
                    : '.claude/settings.json がまだありません'
                }
                unknownText={p.probeError ?? ''}
              />

              <button
                onClick={() => void install(p.projectPath, false)}
                disabled={busy || !api}
                style={{
                  marginTop: 8,
                  padding: '6px 11px',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  color: theme.accent,
                  background: theme.accentTag,
                  border: 'none',
                  borderRadius: 6,
                  cursor: busy || !api ? 'default' : 'pointer',
                  opacity: busy || !api ? 0.6 : 1,
                }}
              >
                dispatch.sh を配置する
              </button>

              {result && <InstallResultLine theme={theme} result={result} onOverwrite={() => void install(p.projectPath, true)} />}
            </div>
          );
        })}
      </SetupSection>

      {/* ── 2. settings.json への追記(コピーのみ・書き込まない) ── */}
      <SetupSection theme={theme} step={2} title=".claude/settings.json に追記する">
        <div style={{ fontSize: 11.5, lineHeight: 1.8, color: theme.inkDim, marginBottom: 8 }}>
          この内容を、プロジェクトの <code>.claude/settings.json</code> に追記してください。
          <strong>アプリはこのファイルを書き換えません</strong>
          (すでにお使いの hooks 設定を壊さないためです)。
        </div>
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            maxHeight: 180,
            overflow: 'auto',
            background: theme.bgPanel,
            border: `1px solid ${theme.line}`,
            borderRadius: 8,
            fontSize: 10.5,
            lineHeight: 1.7,
            fontFamily: 'ui-monospace, monospace',
            color: theme.ink,
          }}
        >
          {snapshot?.settingsSnippet ?? ''}
        </pre>
        <button
          onClick={() => void copySnippet()}
          disabled={!api}
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 11px',
            fontSize: 11,
            fontFamily: 'inherit',
            color: copied ? theme.mint : theme.ink,
            background: theme.bgRaised,
            border: `1px solid ${theme.line}`,
            borderRadius: 6,
            cursor: api ? 'pointer' : 'default',
            opacity: api ? 1 : 0.6,
          }}
        >
          {copied ? <Check size={13} color={theme.mint} /> : <Copy size={13} color={theme.inkDim} />}
          {copied ? 'コピーしました' : 'コピーする'}
        </button>
      </SetupSection>
    </div>
  );
}

function SetupSection({
  theme,
  step,
  title,
  children,
}: {
  theme: Theme;
  step: number;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: theme.accent,
            background: theme.accentTag,
          }}
        >
          {step}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.ink }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/** 実測結果の1行。`unknown` は「調べられなかった」を false と区別して示すために持つ。 */
function StatusLine({
  theme,
  ok,
  unknown = false,
  okText,
  ngText,
  unknownText = '',
}: {
  theme: Theme;
  ok: boolean;
  unknown?: boolean;
  okText: string;
  ngText: string;
  unknownText?: string;
}): React.JSX.Element {
  const color = unknown ? theme.warnText : ok ? theme.mint : theme.iconInactive;
  const text = unknown ? unknownText : ok ? okText : ngText;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color, lineHeight: 1.9 }}>
      {unknown ? <TriangleAlert size={12} /> : ok ? <Check size={12} /> : <span style={{ width: 12 }}>—</span>}
      <span>{text}</span>
    </div>
  );
}

/** 配置結果。失敗も既存差異もそのまま表示する(黙って上書き・黙って成功扱いにしない)。 */
function InstallResultLine({
  theme,
  result,
  onOverwrite,
}: {
  theme: Theme;
  result: DispatchInstallResult;
  onOverwrite: () => void;
}): React.JSX.Element {
  if (result.status === 'exists-differs') {
    return (
      <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.8, color: theme.warnText }}>
        すでに別の内容の dispatch.sh があります。手を加えている可能性があるため、上書きしていません。
        <button
          onClick={onOverwrite}
          style={{
            marginLeft: 8,
            padding: '3px 9px',
            fontSize: 10.5,
            fontFamily: 'inherit',
            color: theme.sealRed,
            background: theme.sealRedTag,
            border: 'none',
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          上書きする
        </button>
      </div>
    );
  }
  if (result.status === 'failed') {
    return (
      <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.8, color: theme.warnText }}>
        配置できませんでした: {result.message}
      </div>
    );
  }
  if (result.status === 'rejected-unknown-project') {
    return (
      <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.8, color: theme.warnText }}>
        このフォルダは監視対象として登録されていないため、書き込みませんでした。
      </div>
    );
  }
  const label =
    result.status === 'created'
      ? '配置しました'
      : result.status === 'updated'
        ? '最新の内容に更新しました'
        : 'すでに最新です';
  return (
    <div style={{ marginTop: 8, fontSize: 11, color: theme.mint }}>
      {label}: {result.path}
    </div>
  );
}

/* ══ ステップ4: 完了 ═══════════════════════════════════════════════════════ */

/**
 * 「完了しました」とだけ出さない(onboarding.md 論点4)。実際に何が設定され、何が残って
 * いるかを示す。**アプリが自分の状態について嘘をつかない**(constraints.md)。
 *
 * もう一つの役割が**メニューバーアイコンの告知**。`general.clickThrough` の既定は true で、
 * 初回起動時の灯里はクリックを一切受け取らない。C-19 のメニューバーアイコンはその唯一の
 * 逃げ道であり、存在を知らせなければ対策として機能しない。
 */
function DoneStep({
  theme,
  snapshot,
  onFinish,
  onOpenModelTab,
  sealing,
}: {
  theme: Theme;
  snapshot: OnboardingSnapshot | null;
  onFinish: () => void;
  onOpenModelTab: () => void;
  sealing: boolean;
}): React.JSX.Element {
  const modelCount = snapshot?.modelCount ?? 0;
  const adapter = snapshot?.activeAdapter ?? 'code';
  const chatMode = snapshot?.chatMode ?? 'mock';
  const projects = snapshot?.hooks ?? [];
  // 「設定済み」と言えるのは、スクリプトが置かれ**かつ** settings.json が参照している場合だけ。
  const hooksReady = projects.some((p) => p.dispatchScriptPlaced && p.settingsReferencesDispatch);

  const notes: string[] = [];
  if (modelCount === 0) {
    notes.push('モデルを追加すると灯里が現れます(いまは姿がないため表示しません)。');
  }
  if (adapter === 'code' && !hooksReady) {
    notes.push('hooks の設定が終わるまで、灯里は Claude Code の作業に反応しません。');
  }
  if (adapter === 'chat' && chatMode === 'mock') {
    notes.push(
      '今はモック(固定返答)で動いています。実際に Claude と話すには API キーの設定が必要です。',
    );
  }

  return (
    <div>
      {/* 呪紋リング。完了時に一度強く回る(既存の seal-spin / breathe を流用。新規アセットなし)。 */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 18px' }}>
        <SealRing theme={theme} sealing={sealing} />
      </div>

      <Heading theme={theme}>{notes.length === 0 ? '準備ができました' : 'ひとまず完了です'}</Heading>

      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {notes.map((n) => (
            <div
              key={n}
              style={{
                display: 'flex',
                gap: 8,
                padding: '10px 12px',
                background: theme.bgPanel,
                border: `1px solid ${theme.line}`,
                borderRadius: 8,
                fontSize: 11.5,
                lineHeight: 1.8,
                color: theme.inkDim,
              }}
            >
              <TriangleAlert size={13} color={theme.warnText} style={{ flexShrink: 0, marginTop: 3 }} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── メニューバーアイコンの告知(完了画面の最重要の役割) ── */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 8,
          background: theme.accentTag,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: theme.accent, marginBottom: 8 }}>
          操作はメニューバーのアイコンから
        </div>
        <MenuBarDiagram theme={theme} />
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.9, color: theme.inkDim }}>
          <li>灯里はクリックを通り抜けます(裏のウィンドウをそのまま操作できます)。</li>
          <li>設定・表示切替は画面上端のメニューバーアイコンから行います。</li>
          <li>クリックスルーを切ると、灯里をドラッグで動かせます。</li>
        </ul>
      </div>

      <Actions>
        <PrimaryButton theme={theme} onClick={onFinish}>
          はじめる
        </PrimaryButton>
        {modelCount === 0 && (
          <GhostButton theme={theme} onClick={onOpenModelTab}>
            モデルを追加する
          </GhostButton>
        )}
      </Actions>
    </div>
  );
}

/**
 * 呪紋リング(basic-design.md 4.3 のシグネチャモーション)。完了時に回転を一気に速め、
 * 残光を膨らませる。App.tsx が定義済みの `seal-spin` / `breathe` を使うため新規アセットは不要
 * (onboarding.md 実装時TODO)。
 */
function SealRing({ theme, sealing }: { theme: Theme; sealing: boolean }): React.JSX.Element {
  const mood = theme.moods.idle;
  return (
    <div style={{ position: 'relative', width: 84, height: 84 }}>
      <div
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: '50%',
          background: mood.glow,
          filter: 'blur(10px)',
          animation: `breathe ${sealing ? 0.9 : mood.speed}s ease-in-out infinite`,
          opacity: sealing ? 1 : 0.6,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `1.5px solid ${theme.accent}`,
          borderTopColor: 'transparent',
          borderRightColor: 'transparent',
          animation: `seal-spin ${sealing ? 0.5 : mood.speed * 3}s linear infinite`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 12,
          borderRadius: '50%',
          border: `1px solid ${mood.color}`,
          borderBottomColor: 'transparent',
          animation: `seal-spin-reverse ${sealing ? 0.7 : mood.speed * 4.5}s linear infinite`,
        }}
      />
    </div>
  );
}

/**
 * メニューバーアイコンの位置を図示する(onboarding.md 実装時TODO)。
 * 画像アセットを作らずインラインSVGで描く(配布物を増やさず、配色テーマにも追従できる)。
 */
function MenuBarDiagram({ theme }: { theme: Theme }): React.JSX.Element {
  return (
    <svg viewBox="0 0 260 46" width="100%" height="46" role="img" aria-label="画面上端のメニューバー右側にヨリマシのアイコンが並ぶ図">
      {/* 画面 */}
      <rect x="1" y="1" width="258" height="44" rx="4" fill={theme.bgPanel} stroke={theme.line} />
      {/* メニューバー */}
      <rect x="1" y="1" width="258" height="13" rx="4" fill={theme.bgRaised} />
      <line x1="1" y1="14" x2="259" y2="14" stroke={theme.line} />
      {/* 右側の常駐アイコン群 */}
      {[196, 210, 224].map((x) => (
        <circle key={x} cx={x} cy="7.5" r="2.4" fill={theme.iconInactive} />
      ))}
      {/* ヨリマシのアイコン(強調) */}
      <circle cx="240" cy="7.5" r="4.6" fill="none" stroke={theme.accent} strokeWidth="1.4" />
      <circle cx="240" cy="7.5" r="1.6" fill={theme.accent} />
      <path d="M240 16 L240 26" stroke={theme.accent} strokeWidth="1" strokeDasharray="2 2" />
      <text x="236" y="35" fontSize="7" fill={theme.accent} textAnchor="middle" fontFamily="sans-serif">
        ここ
      </text>
    </svg>
  );
}
