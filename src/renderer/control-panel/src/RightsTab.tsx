/**
 * 権利情報タブ(FR-12)。UIの正: docs/mockups/control-panel.jsx L1394-1451。
 * 正本: 要件定義書 4.12 / 9章、確定事項 C-10(個人利用段階から常設)・C-11(現在は個人利用(無償))。
 *
 * 表示する6区分:
 *  1. Live2D Cubism(Live2D形式のみ) … 利用区分 + 配布前の判定フロー要確認
 *  2. 外部動画生成AIサービス(スプライトセット用) … ToS 注意
 *  3. 使用しているOSS … ビルド時生成の oss-licenses.ts を出す
 *  4. フォント … SIL OFL 1.1
 *  5. 追加したモデルについて … 持ち込みモデルの著作権注意
 *  6. Claude / Anthropic API … 利用規約の注記
 *
 * **嘘をつかない(constraints.md)ためのモックアップからの意図的な逸脱**:
 *  - Live2D の「現在の利用区分」は config.distribution.live2dCommercialLicense を反映して出す
 *    (ハードコードで「個人利用」と断定しない)。読めない経路(preload不在)では断定せず
 *    「確認できません」と出す。
 *  - **外部動画生成AIサービスの「現在の利用区分」バッジは出さない**。アプリは利用者が Pika/Canva 等を
 *    どの料金枠で使ったかを知り得ない。知らない状態を「個人利用(無償枠)」と断定するのは嘘になるため、
 *    区分の断定をやめ、利用規約を各自で確認するよう促す注意書きに置き換える。
 *  - OSS 一覧はモックアップが6件をハードコードしているが、**実際に配布される依存**
 *    (dependencies + electron)から自動生成した実体を出す(react-dom / ws / @anthropic-ai/sdk も含む)。
 *
 * 形式非依存だが内容に非対称がある(正当): Live2D の利用区分は Live2D 形式にのみ関係し、
 * スプライトセットには相当概念が無い(要件定義書 9章)。逆に外部動画生成AIサービスは
 * スプライトセット生成に関係し Live2D には無い。**両形式ぶんのセクションを対で用意している**
 * ため、対称性は保たれている(片方だけ書いていない)。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { useTheme } from './theme';
import { Row, Section } from './panel-ui';
import { OSS_LICENSES } from '../../../shared/oss-licenses';
import type { RightsSnapshot } from '../../../shared/rights';

export function RightsTab(): React.JSX.Element {
  const theme = useTheme();
  const [rights, setRights] = useState<RightsSnapshot | null>(null);
  const [rightsError, setRightsError] = useState(false);

  useEffect(() => {
    const api = window.yorimashi?.rights;
    if (!api) {
      // preload が無い経路(ブラウザから /panel を直接開いた場合)。利用区分は読めない。
      setRightsError(true);
      return;
    }
    let cancelled = false;
    void api
      .get()
      .then((s) => {
        if (!cancelled) {
          setRights(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRightsError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Section
        title="Live2D Cubism(Live2D形式のみ)"
        hint="配布する場合、AI/チャットボットのインターフェースとしての利用に該当するため、公開前にLive2D社の判定フローを確認する必要があります。この確認はLive2D形式のモデルにのみ関係し、スプライトセット形式には及びません。"
      >
        <Row label="現在の利用区分">
          <Live2dLicenseBadge rights={rights} error={rightsError} />
        </Row>
        {/* モックアップ(L1406-1408)どおり sub は付けない(判定フローの説明は Section の hint が担う)。 */}
        <Row label="配布時の要確認事項" last>
          <AlertTriangle size={15} color={theme.sealRed} />
        </Row>
      </Section>

      <Section
        title="外部動画生成AIサービス(スプライトセット用)"
        hint="Pika・Canva等の無料枠は一般的に個人利用限定です。配布時は各サービスの利用規約(商用利用可否)を確認してください。生成物の著作権・利用範囲もサービスごとに異なるため、選択・利用はご自身の責任で行ってください。"
      >
        {/* モックアップは「現在の利用区分: 個人利用(無償枠)」を出すが、アプリは利用者がどの料金枠で
            生成したかを知り得ない。知らない区分を断定せず、確認を促す注意書きに置き換える(冒頭参照)。 */}
        <Row
          label="商用利用の可否はサービスごとに異なります"
          sub="生成物の著作権・利用範囲もご自身で確認してください"
          last
        />
      </Section>

      <Section
        title="使用しているオープンソースソフトウェア"
        hint="配布物に含まれる依存(package.json)から、ビルド時に自動生成しています。"
      >
        {OSS_LICENSES.map((lib, i) => (
          <Row key={lib.name} label={lib.name} last={i === OSS_LICENSES.length - 1}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11.5,
                color: theme.inkDim,
              }}
            >
              {lib.license}
            </span>
          </Row>
        ))}
      </Section>

      <Section title="フォント">
        <Row
          label="Zen Antique / M PLUS 1 Code / JetBrains Mono"
          sub="SIL Open Font License 1.1"
          last
        />
      </Section>

      <Section title="追加したモデルについて">
        <Row
          label="著作権は作成者に帰属します"
          sub="ご自身が利用権限を持つモデルのみ追加してください"
          last
        />
      </Section>

      <Section title="Claude / Anthropic API">
        <Row
          label="ご自身のAPIキーで呼び出します"
          sub="Anthropicの利用規約が適用されます"
          last
        />
      </Section>
    </>
  );
}

/** Live2D の利用区分バッジ。config.distribution.live2dCommercialLicense を反映する(断定しない)。 */
function Live2dLicenseBadge({
  rights,
  error,
}: {
  rights: RightsSnapshot | null;
  error: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  // 読めなかった場合は「個人利用」と断定せず、確認できない旨を出す(嘘をつかない)。
  if (error) {
    return <PlainBadge text="確認できません" color={theme.inkDim} background={theme.bgRaised} />;
  }
  if (rights === null) {
    return <PlainBadge text="確認中…" color={theme.inkDim} background={theme.bgRaised} />;
  }
  return rights.live2dCommercialLicense ? (
    <PlainBadge text="商用ライセンス設定済み" color={theme.accent} background={theme.accentTag} />
  ) : (
    <PlainBadge text="個人利用(無償)" color={theme.mint} background={theme.mintTag} />
  );
}

function PlainBadge({
  text,
  color,
  background,
}: {
  text: string;
  color: string;
  background: string;
}): React.JSX.Element {
  return (
    <span
      style={{
        fontFamily: "'M PLUS 1 Code', sans-serif",
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 999,
        color,
        background,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
