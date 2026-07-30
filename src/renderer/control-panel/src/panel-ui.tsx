/**
 * Control Panel(FR-7)の各タブが共通で使う表示プリミティブ。
 * UIの正: docs/mockups/control-panel.jsx L160-211(Section / Row)。
 *
 * ここに切り出す理由: モックアップでは6タブすべてが同じ `Section` / `Row` を使う。
 * 最初に移植するタブ(#11 ログ)の中に閉じ込めると、次のタブ(#13 権利ほか)で必ず複製される。
 * 見た目の定義が2箇所に分裂すると、片方だけ直す事故が起きる。
 */

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { useTheme } from './theme';

export interface SectionProps {
  title: string;
  children: ReactNode;
  /** 枠の下に出る補足文(モックアップの `hint`)。 */
  hint?: ReactNode;
}

/** 見出し + 角丸の枠。中身は Row を並べる。 */
export function Section({ title, children, hint }: SectionProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: theme.inkDim,
          textTransform: 'uppercase',
          marginBottom: 10,
          paddingLeft: 2,
        }}
      >
        <span
          style={{ display: 'inline-block', width: 3, height: 11, background: theme.sealRed, opacity: 0.7 }}
        />
        {title}
      </div>
      <div
        style={{
          background: theme.bgPanel,
          border: `1px solid ${theme.line}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: "'M PLUS 1 Code', sans-serif",
            fontSize: 12,
            color: theme.inkDim,
            marginTop: 8,
            paddingLeft: 2,
            lineHeight: 1.6,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export interface RowProps {
  label: ReactNode;
  /** ラベルの下の小さい行(時刻・ツール名など)。 */
  sub?: ReactNode;
  children?: ReactNode;
  /** 最終行は下罫線を引かない。 */
  last?: boolean;
}

/** 左にラベル(+補足)、右に任意の操作/表示を置く1行。 */
export function Row({ label, sub, children, last }: RowProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        borderBottom: last ? 'none' : `1px solid ${theme.line}`,
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'M PLUS 1 Code', sans-serif",
            fontSize: 14,
            color: theme.ink,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        {sub && (
          <div
            style={{
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 12,
              color: theme.inkDim,
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export interface PanelButtonProps {
  onClick: () => void;
  children: ReactNode;
  /** 目立たせない見た目(モックアップの2つ目のボタン)。 */
  subdued?: boolean;
  disabled?: boolean;
}

/** 幅いっぱいのボタン(モックアップ L1369-1385)。 */
export function PanelButton({
  onClick,
  children,
  subdued,
  disabled,
}: PanelButtonProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: 12,
        borderRadius: 12,
        cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${theme.line}`,
        background: subdued ? theme.bgPanel : theme.bgRaised,
        color: disabled ? theme.disabledText : subdued ? theme.inkDim : theme.ink,
        fontFamily: "'M PLUS 1 Code', sans-serif",
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

/**
 * 読み込み中・未取得を正直に伝える1行(偽の既定値を描かないための表示)。
 *
 * `ErrorNotice` とともに、AdapterTab / ModelTab / MappingEditor に**同一の実装が3つ複製されて
 * いた**ものをここへ寄せた(全体設定・ホームタブで4つ目・5つ目になるため)。冒頭コメントの
 * 「見た目の定義が2箇所に分裂すると、片方だけ直す事故が起きる」がそのまま当てはまる。
 */
export function Placeholder({ text }: { text: string }): React.JSX.Element {
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

/** 失敗・注意を朱色で伝える枠(取得失敗や部分的失敗を隠さずに出す)。 */
export function ErrorNotice({ message }: { message: string }): React.JSX.Element {
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
        marginBottom: 28,
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

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 注意を促す色にする(モックアップ: realへの切替は課金が発生するため朱色)。 */
  warn?: boolean;
  disabled?: boolean;
}

/** ON/OFFトグル(モックアップ L138-157)。 */
export function Switch({ checked, onChange, warn, disabled }: SwitchProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        position: 'relative',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
        background: checked ? (warn ? theme.sealRed : theme.accent) : theme.sliderTrack,
        transition: 'background 0.2s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: theme.ink,
          transition: 'left 0.2s ease',
        }}
      />
    </button>
  );
}

export interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 等幅にする(キー・ポート番号など)。 */
  mono?: boolean;
  /** 入力値を伏せる(APIキー。画面共有・スクリーンショットからの漏洩を避ける)。 */
  secret?: boolean;
  onBlur?: () => void;
  width?: number;
}

/** 1行テキスト入力(モックアップ L213-230)。 */
export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
  secret,
  onBlur,
  width = 140,
}: TextInputProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      type={secret === true ? 'password' : 'text'}
      // パスワードマネージャの自動補完対象にしない(APIキーはユーザーのログイン情報ではない)。
      autoComplete={secret === true ? 'off' : undefined}
      spellCheck={false}
      style={{
        background: disabled ? theme.bgPanel : theme.bgRaised,
        border: `1px solid ${theme.line}`,
        borderRadius: 8,
        padding: '7px 10px',
        color: disabled ? theme.disabledText : theme.ink,
        fontSize: 13,
        width,
        fontFamily: mono === true ? "'JetBrains Mono', monospace" : "'M PLUS 1 Code', sans-serif",
        outline: 'none',
      }}
    />
  );
}
