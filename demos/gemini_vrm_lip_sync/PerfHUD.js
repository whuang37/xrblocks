/**
 * PerfHUD.js
 *
 * Lightweight debug overlay for measuring rendering cost. Added only when the
 * page is opened with `?debug`. Each frame it reads three.js renderer stats
 * (`renderer.info.render`) plus a rolling FPS and writes them to a fixed DOM
 * box, so optimizations can be compared before/after.
 *
 * `renderer.info` auto-resets after each render, so reading it in update()
 * reports the previous frame's numbers — fine for a coarse gauge.
 */

import * as xb from 'xrblocks';

export class PerfHUD extends xb.Script {
  constructor() {
    super();
    this._el = null;
    this._frames = 0;
    this._accum = 0; // seconds since last FPS sample
    this._fps = 0;
  }

  init() {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      padding: '6px 10px',
      borderRadius: '6px',
      background: 'rgba(20,20,30,0.75)',
      color: '#7affa0',
      font: '12px/1.4 monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '9999',
    });
    el.textContent = 'perf…';
    document.body.appendChild(el);
    this._el = el;
  }

  update() {
    const dt = xb.core.timer.getDelta();
    this._frames++;
    this._accum += dt;

    // Refresh the readout ~4×/second to keep it legible.
    if (this._accum >= 0.25) {
      this._fps = this._frames / this._accum;
      this._frames = 0;
      this._accum = 0;

      const info = xb.core.renderer?.info?.render;
      const calls = info?.calls ?? 0;
      const tris = info?.triangles ?? 0;
      this._el.textContent =
        `fps   ${this._fps.toFixed(0)}\n` +
        `calls ${calls}\n` +
        `tris  ${tris.toLocaleString()}`;
    }
  }

  dispose() {
    this._el?.remove();
    this._el = null;
  }
}
