import { useEffect } from 'react';

/**
 * キャラクターウィンドウのドラッグ移動と右クリックメニュー(FR-6 / character-window.md 論点3)。
 *
 * `-webkit-app-region: drag` は右クリックメニューと衝突するため使わず、mousedown→mousemove を
 * 自前で追跡して絶対座標をMainへ送る。クリックスルーON(既定)の間はウィンドウがクリックを
 * 受け取らない(mousemoveのみ forward される)ため、ここが発火するのはユーザーが意図的に
 * クリックスルーをOFFにした「今キャラクターを操作している」場面に限られる。
 *
 * 形式非依存: ここはウィンドウ操作のみでモデル描画に一切触れない。CharacterRenderer(#5)は
 * このフックをそのまま再利用する(Live2D/スプライトセットのどちらでも同じ操作系)。
 */
export function useCharacterWindowControls(): void {
  useEffect(() => {
    // preload が無い経路(ブラウザから /character を直接開いた場合。environments.md)では
    // ウィンドウ操作自体が成立しないため、リスナーを張らずに何もしない。
    const api = window.yorimashi?.character;
    if (!api) {
      return;
    }

    let buttonDown = false;
    let dragging = false;
    let origin: { x: number; y: number } | null = null;
    let startScreenX = 0;
    let startScreenY = 0;

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) {
        return; // 左ボタンのみドラッグ開始
      }
      buttonDown = true;
      startScreenX = e.screenX;
      startScreenY = e.screenY;
      // beginDrag は非同期(IPC invoke)。解決までの間にボタンを離す素早いクリックがありうるため、
      // 解決時点で「まだ押されているか(buttonDown)」を再確認してからドラッグを確定する。
      // これを怠ると、離した後に dragging=true が残り、次の mousemove でウィンドウが暴れる。
      void api.beginDrag().then((pos) => {
        if (pos && buttonDown) {
          origin = pos;
          dragging = true;
        }
      });
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!dragging || !origin) {
        return;
      }
      api.dragMove({
        x: origin.x + (e.screenX - startScreenX),
        y: origin.y + (e.screenY - startScreenY),
      });
    };

    const endDrag = (): void => {
      buttonDown = false;
      if (dragging) {
        api.endDrag();
      }
      dragging = false;
      origin = null;
    };

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      api.requestContextMenu();
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}
