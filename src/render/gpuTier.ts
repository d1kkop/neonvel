/** Same test as Renderer.isMobile (kept here so the renderer can import this file). */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

export type GpuTier = 'low' | 'medium' | 'high';

export interface GpuInfo {
  tier: GpuTier;
  /** The GPU name the browser reports (may be generic when the browser hides it). */
  renderer: string;
  /** Why this tier was picked (shown in Options). */
  reason: string;
}

let cached: GpuInfo | null = null;

/**
 * Guesses how strong the graphics hardware is, to pick the starting quality. Browsers do not reveal VRAM, so it
 * goes by the GPU name (integrated Intel / AMD laptop chips / phone GPUs vs. desktop cards), the system memory
 * (navigator.deviceMemory) and the largest texture the GPU accepts. The dynamic resolution then fine-tunes it
 * while playing.
 */
export function detectGpu(): GpuInfo {
  if (cached) return cached;
  let renderer = 'unknown';
  let maxTex = 4096;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* keep the defaults */ }
  const r = renderer.toLowerCase();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const pick = (tier: GpuTier, reason: string): GpuInfo => {
    // Little memory lowers it one step (never straight to low): privacy browsers (Brave) report a made-up, often low
    // navigator.deviceMemory, which used to put strong PCs on Low (0.75x resolution).
    if (mem <= 4 && tier === 'high' && !/dedicated|arc/i.test(reason)) return { tier: 'medium', renderer, reason: `${reason}, ${mem} GB memory` };
    if (maxTex < 8192 && tier === 'high') return { tier: 'medium', renderer, reason: `${reason}, small texture limit` };
    return { tier, renderer, reason };
  };
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(r)) cached = pick('low', 'no hardware graphics');
  else if (isMobile) cached = pick('low', 'phone / tablet');
  else if (/nvidia|geforce|quadro|rtx|gtx/.test(r)) cached = pick(/\bmx ?\d{3}\b|\bmx\d/.test(r) ? 'medium' : 'high', /\bmx/.test(r) ? 'NVIDIA laptop chip' : 'dedicated NVIDIA GPU');
  else if (/intel/.test(r)) cached = /arc/.test(r) ? pick('high', 'Intel Arc GPU') : pick(/iris/.test(r) ? 'medium' : 'low', 'integrated Intel graphics');
  else if (/radeon|amd/.test(r)) {
    // Desktop cards are named "RX ..." / "Pro ..."; laptop chips just "Radeon(TM) Graphics" / "Vega" / "680M".
    const dedicated = /\brx ?\d|radeon pro|vii|r9 /.test(r) && !/\d{3}m\b/.test(r);
    cached = dedicated ? pick('high', 'dedicated AMD GPU') : pick('medium', 'integrated AMD graphics');
  } else if (/apple/.test(r)) cached = pick(/pro|max|ultra/.test(r) ? 'high' : 'medium', 'Apple GPU');
  else if (/adreno|mali|powervr|immortalis|xclipse/.test(r)) cached = pick('low', 'phone GPU');
  else cached = pick('medium', 'unknown GPU');
  return cached;
}
