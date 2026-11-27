/**
 * Controls help: shows the layout for what is plugged in. A connected gamepad is identified as Xbox-style or
 * PlayStation-style from its id (vendor / name) and shown with that pad's own button symbols; with no pad,
 * the keyboard (and touch) controls are shown.
 */
export type PadKind = 'xbox' | 'playstation' | 'generic' | null;

export function detectPad(): { kind: PadKind; name: string } {
  const pads = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
  if (!pads.length) return { kind: null, name: '' };
  const id = pads[0].id.toLowerCase();
  // Sony vendor id 054c, or the names DualShock / DualSense / "Wireless Controller" use.
  if (/054c|playstation|dualshock|dualsense|wireless controller|ps[345]/.test(id)) return { kind: 'playstation', name: pads[0].id };
  // Microsoft vendor id 045e, or XInput.
  if (/045e|xbox|xinput/.test(id)) return { kind: 'xbox', name: pads[0].id };
  return { kind: 'generic', name: pads[0].id };
}

type Btn = 'south' | 'east' | 'west' | 'north';

/** Face-button badge with the pad's own symbol (inline SVG, so it stays crisp at any size). */
function face(kind: PadKind, b: Btn): string {
  if (kind === 'playstation') {
    const shapes: Record<Btn, [string, string, string]> = {
      south: ['#7cb2ff', 'Cross', '<path d="M7.5 7.5 L16.5 16.5 M16.5 7.5 L7.5 16.5" stroke-width="2.4" stroke-linecap="round"/>'],
      east: ['#ff6b6b', 'Circle', '<circle cx="12" cy="12" r="5.2" fill="none" stroke-width="2.3"/>'],
      west: ['#ff8de0', 'Square', '<rect x="7.2" y="7.2" width="9.6" height="9.6" fill="none" stroke-width="2.2"/>'],
      north: ['#4fe3b0', 'Triangle', '<path d="M12 6.6 L17.4 16 L6.6 16 Z" fill="none" stroke-width="2.2" stroke-linejoin="round"/>'],
    };
    const [col, label, shape] = shapes[b];
    return `<svg class="pad-btn" viewBox="0 0 24 24" role="img" aria-label="${label}"><circle cx="12" cy="12" r="11" fill="#14141c" stroke="#3a3a48"/><g stroke="${col}">${shape}</g></svg>`;
  }
  const xb: Record<Btn, [string, string]> = { south: ['A', '#5ad94e'], east: ['B', '#ff5a52'], west: ['X', '#4aa3ff'], north: ['Y', '#ffd23a'] };
  const [letter, col] = xb[b];
  return `<svg class="pad-btn" viewBox="0 0 24 24" role="img" aria-label="${letter}"><circle cx="12" cy="12" r="11" fill="#14141c" stroke="${col}" stroke-width="1.4"/><text x="12" y="16.3" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="12" fill="${col}">${letter}</text></svg>`;
}

const pill = (t: string) => `<span class="pad-pill">${t}</span>`;
const key = (t: string) => `<span class="key-cap">${t}</span>`;
const row = (action: string, inputs: string, hot = false) => `<div class="ctl-row${hot ? ' hot' : ''}"><span class="ctl-act">${action}</span><span class="ctl-in">${inputs}</span></div>`;

/** `only`: 'touch' = phone / tablet without a pad, just the touch controls; 'keys' = no touch section. */
export function controlsHtml(only?: 'touch' | 'keys'): string {
  const touchOnly = only === 'touch';
  const { kind, name } = detectPad();
  const touch = `<div class="ctl-head"${touchOnly ? '' : ' style="margin-top:12px"'}>Touch</div>
      ${row('Steer', '◀ ▶ buttons bottom-left (or the stick / tilting the phone: Options › Touch)')}
      ${row('Gas / brake', 'gas is automatic (Options › Touch › Auto gas); hold BRAKE bottom-right to slow down')}
      ${row('Drift', 'hold DRIFT while steering', true)}
      ${row('Boost', 'BOOST button', true)}`;
  if (!kind && touchOnly) return touch;
  if (!kind) {
    return `<div class="ctl-head">Keyboard <span class="ctl-note">(plug in a controller and press a button to see its layout)</span></div>
      ${row('Accelerate', `${key('↑')} ${key('W')}`)}
      ${row('Brake / reverse', `${key('↓')} ${key('S')}`)}
      ${row('Steer', `${key('←')} ${key('→')} &nbsp;${key('A')} ${key('D')}`)}
      ${row('Drift', `${key('SPACE')} + steer`, true)}
      ${row('Boost', key('SHIFT'), true)}
      ${row('Pause', key('ESC'))}
      ${row('Camera', key('C'))}
      ${row('Mute / next song', `${key('M')} ${key('N')}`)}
      ${only === 'keys' ? '' : touch}`;
  }
  const ps = kind === 'playstation';
  const L1 = pill(ps ? 'L1' : 'LB'), R1 = pill(ps ? 'R1' : 'RB'), L2 = pill(ps ? 'L2' : 'LT'), R2 = pill(ps ? 'R2' : 'RT');
  const title = ps ? 'PlayStation controller' : kind === 'xbox' ? 'Xbox controller' : 'Gamepad';
  const safe = name.replace(/[<>&"]/g, '').slice(0, 60);
  return `<div class="ctl-head">${title} <span class="ctl-note">${safe}</span></div>
    ${row('Accelerate', `${R2} ${face(kind, 'south')}`)}
    ${row('Brake / reverse', `${L2} ${face(kind, 'east')}`)}
    ${row('Steer', `${pill('Left stick')} ${pill('D-pad')}`)}
    ${row('Drift', `${face(kind, 'west')} ${R1} + steer`, true)}
    ${row('Boost', `${face(kind, 'north')} ${L1}`, true)}
    ${row('Pause', pill(ps ? 'OPTIONS' : 'MENU'))}`;
}
