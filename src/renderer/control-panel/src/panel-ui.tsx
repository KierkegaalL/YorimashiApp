/**
 * Control Panel(FR-7)の各タブが共通で使う表示プリミティブ。
 * UIの正: docs/mockups/control-panel.jsx L160-211(Section / Row)。
 *
 * ここに切り出す理由: モックアップでは6タブすべてが同じ `Section` / `Row` を使う。
 * 最初に移植するタブ(#11 ログ)の中に閉じ込めると、次のタブ(#13 権利ほか)で必ず複製される。
 * 見た目の定義が2箇所に分裂すると、片方だけ直す事故が起きる。
 */

import type { ReactNode } from 'react';

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
