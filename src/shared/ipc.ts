/**
 * MainとRenderer(preload)が共有するIPCチャンネル名。
 * 文字列リテラルを両側に散らすとタイポで沈黙する不具合になるため、ここを単一の情報源にする。
 *
 * キャラクターウィンドウのドラッグ移動(character-window.md 論点3「ドラッグ移動の実装方式」):
 * `-webkit-app-region: drag` は右クリックメニューと衝突するため採用せず、Renderer側で
 * mousedown→mousemove を検知し、算出した絶対座標をMainへ送って win.setPosition() で追従させる。
 */

export const IPC = {
  /** invoke: ドラッグ開始。Mainが現在のウィンドウ左上座標 {x,y} を返す。 */
  CharacterBeginDrag: 'character:begin-drag',
  /** send: ドラッグ中の目標座標 {x,y}(スクリーン座標)。Mainが setPosition する。 */
  CharacterDragMove: 'character:drag-move',
  /** send: ドラッグ終了。Mainが windowPosition をデバウンス保存する。 */
  CharacterEndDrag: 'character:end-drag',
  /** send: クリックスルーOFF時の右クリック。Mainが共通メニューをカーソル位置に表示する。 */
  CharacterContextMenu: 'character:context-menu',

  /**
   * send: 折りたたみの切替要求。Mainが BrowserWindow の幅を 976⇄576 に変更し config へ保存する。
   * **ウィンドウ幅の変更はMainにしかできない**ため、Renderer側でCSS幅を変える実装にはしない
   * (chat-pane.md 論点1「内部レイアウトの再フローではなくウィンドウ自体を縮小する」)。
   */
  ControlPanelSetCollapsed: 'control-panel:set-collapsed',
} as const;

/**
 * Control Panel の初期折りたたみ状態を Main → preload へ**同期的に**渡すための起動引数
 * (`webPreferences.additionalArguments`)。`--yorimashi-collapsed=true|false` の形で入る。
 *
 * IPC(非同期)で読むと、Mainが保存値どおりの幅(576px)で生成したウィンドウに、応答が届くまで
 * 展開レイアウト(Control Panel 400px + タブ16px)が一瞬描画されうる。preload は初回描画より前に
 * 走るため、起動引数なら**最初のフレームから正しい状態**で描ける。
 * sandbox:true のpreloadでも `process.argv` から読めることは実測で確認済み。
 */
export const CONTROL_PANEL_COLLAPSED_ARG = '--yorimashi-collapsed=';

/** character:drag-move / character:begin-drag(戻り値)で運ぶ座標。 */
export interface WindowPoint {
  x: number;
  y: number;
}
