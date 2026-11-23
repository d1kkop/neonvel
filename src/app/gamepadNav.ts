/**
 * Gamepad in the menus: the menus only listen to the keyboard, so the pad is turned into key presses.
 * D-pad / left stick = arrow keys (held = repeat), A = select (clicks the focused button), B = back,
 * START = pause in a race / back in the menus. The events carry only `key` (no `code`), so the driving
 * input (which reads `code`) never sees them: in a race the pad drives through Input.poll().
 */
export interface GamepadNavHooks {
  /** True while a race is running and not paused (pad drives, menus are closed). */
  driving(): boolean;
  /** START in a race. */
  pause(): void;
}

const REPEAT_DELAY = 380;
const REPEAT_EVERY = 140;

export function startGamepadNav(h: GamepadNavHooks): void {
  const held = new Map<string, number>(); // name -> next repeat time (ms), present while held

  const send = (key: string) => {
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  const select = () => {
    const el = document.activeElement as HTMLElement | null;
    const ui = document.getElementById('ui');
    if (el && el !== document.body && ui?.contains(el)) el.click();
    else send('Enter'); // nothing focused yet: unlocks the title screen / focuses the first button
  };

  window.setInterval(() => {
    const pads = navigator.getGamepads?.() ?? [];
    let up = false, down = false, left = false, right = false, a = false, b = false, start = false;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      up ||= !!p.buttons[12]?.pressed || ay < -0.55;
      down ||= !!p.buttons[13]?.pressed || ay > 0.55;
      left ||= !!p.buttons[14]?.pressed || ax < -0.55;
      right ||= !!p.buttons[15]?.pressed || ax > 0.55;
      a ||= !!p.buttons[0]?.pressed;
      b ||= !!p.buttons[1]?.pressed;
      start ||= !!p.buttons[9]?.pressed;
    }
    const now = performance.now();
    const driving = h.driving();
    const edge = (name: string, down: boolean, act: () => void, repeat = false) => {
      if (!down) { held.delete(name); return; }
      const next = held.get(name);
      if (next === undefined) {
        held.set(name, now + REPEAT_DELAY);
        act();
      } else if (repeat && now >= next) {
        held.set(name, now + REPEAT_EVERY);
        act();
      }
    };
    edge('start', start, () => (driving ? h.pause() : send('Escape')));
    if (driving) {
      // Keep the edge state current so a button held into the menu does not fire at once.
      for (const [n, d] of [['up', up], ['down', down], ['left', left], ['right', right], ['a', a], ['b', b]] as const) {
        if (d) held.set(n, Infinity); else held.delete(n);
      }
      return;
    }
    edge('up', up, () => send('ArrowUp'), true);
    edge('down', down, () => send('ArrowDown'), true);
    edge('left', left, () => send('ArrowLeft'), true);
    edge('right', right, () => send('ArrowRight'), true);
    edge('a', a, select);
    edge('b', b, () => send('Escape'));
  }, 30);
}
