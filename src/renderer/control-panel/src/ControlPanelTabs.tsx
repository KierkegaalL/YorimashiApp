/**
 * Control Panel(FR-7。6タブ)。UIの正: docs/mockups/control-panel.jsx。
 *
 * #6(FR-15 会話ペイン)で **タブバーの骨組み** を置き、各タブの中身はそれぞれの機能実装
 * タスクで移植する。移植済みは **ログ(FR-11/#11)** のみで、残りは正直なプレースホルダを出す
 * (モデル一覧・生成ウィザード等を先に捏造しない)。
 *
 * ここに骨組み(タブ選択 + 中身のディスパッチ)を先に用意しておくことで、後続タスクは
 * 該当タブのプレースホルダを実内容へ差し替えるだけで済む(シェルを作り直さない)。
 */

import { useTheme } from './theme';
import { TABS, type TabId } from './catalog';
import { LogsTab } from './LogsTab';
import { AdapterTab } from './AdapterTab';
import { RightsTab } from './RightsTab';
import { ModelTab } from './ModelTab';

/** 各タブの中身は後続タスクで差し込む。それまでは正直なプレースホルダを出す(偽データを置かない)。 */
function TabPlaceholder({ label }: { label: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        textAlign: 'center',
        padding: '48px 16px',
        fontFamily: "'M PLUS 1 Code', sans-serif",
        color: theme.iconInactive,
        lineHeight: 1.7,
      }}
    >
      <span style={{ fontSize: 13, color: theme.inkDim, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 12 }}>この設定は準備中です。</span>
    </div>
  );
}

export interface ControlPanelTabsProps {
  /** 選択中タブ。折りたたみでアンマウントされても保持されるよう App が持つ。 */
  tab: TabId;
  onSelectTab: (tab: TabId) => void;
}

export function ControlPanelTabs({ tab, onSelectTab }: ControlPanelTabsProps): React.JSX.Element {
  const theme = useTheme();
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── タブバー ───────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${theme.line}`, background: theme.bgBase }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onSelectTab(t.id)}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '10px 4px 9px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                borderBottom: active ? `2px solid ${theme.accent}` : '2px solid transparent',
              }}
            >
              <Icon size={17} color={active ? theme.accent : theme.iconInactive} strokeWidth={1.8} />
              <span
                style={{
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 10.5,
                  color: active ? theme.ink : theme.iconInactive,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── コンテンツ領域(移植済みのタブから順に差し替える) ───────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 16px 40px' }}>
        {tab === 'logs' ? (
          <LogsTab />
        ) : tab === 'adapter' ? (
          <AdapterTab />
        ) : tab === 'licenses' ? (
          <RightsTab />
        ) : tab === 'model' ? (
          <ModelTab />
        ) : (
          <TabPlaceholder label={activeTab.label} />
        )}
      </div>
    </div>
  );
}
