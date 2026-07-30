/**
 * Control Panel(FR-7。6タブ)。UIの正: docs/mockups/control-panel.jsx。
 *
 * #6(FR-15 会話ペイン)で **タブバーの骨組み** を置き、各タブの中身はそれぞれの機能実装
 * タスクで移植した。**6タブすべて移植済み**(ホーム=FR-1/FR-2 / モデル=FR-5 /
 * モード=FR-1・FR-3 / 全体設定=FR-7・FR-10 / ログ=FR-11 / 権利=FR-12)。
 *
 * ここに骨組み(タブ選択 + 中身のディスパッチ)を先に用意しておいたことで、各タスクは
 * 該当タブのプレースホルダを実内容へ差し替えるだけで済んだ(シェルを作り直していない)。
 */

import { useTheme } from './theme';
import { TABS, type TabId } from './catalog';
import { LogsTab } from './LogsTab';
import { AdapterTab } from './AdapterTab';
import { RightsTab } from './RightsTab';
import { ModelTab } from './ModelTab';
import { HomeTab } from './HomeTab';
import { GeneralTab } from './GeneralTab';
import type { AdapterMode } from './types';

export interface ControlPanelTabsProps {
  /** 選択中タブ。折りたたみでアンマウントされても保持されるよう App が持つ。 */
  tab: TabId;
  onSelectTab: (tab: TabId) => void;
  /**
   * ホームタブのアダプタ切替(FR-1)。**App が持つ config の写しを渡す**
   * (ここで再購読すると Renderer 内に情報源が2つでき、会話ペインや Tray からの切替で
   * どちらかが古くなる)。
   */
  adapterMode: AdapterMode;
  onSetAdapterMode: (mode: AdapterMode) => void;
}

export function ControlPanelTabs({
  tab,
  onSelectTab,
  adapterMode,
  onSetAdapterMode,
}: ControlPanelTabsProps): React.JSX.Element {
  const theme = useTheme();

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

      {/* ── コンテンツ領域(6タブすべて移植済み) ───────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 16px 40px' }}>
        {tab === 'logs' ? (
          <LogsTab />
        ) : tab === 'adapter' ? (
          <AdapterTab />
        ) : tab === 'licenses' ? (
          <RightsTab />
        ) : tab === 'model' ? (
          <ModelTab />
        ) : tab === 'general' ? (
          <GeneralTab />
        ) : (
          <HomeTab
            adapterMode={adapterMode}
            onSetAdapterMode={onSetAdapterMode}
            onOpenModelTab={() => onSelectTab('model')}
          />
        )}
      </div>
    </div>
  );
}
