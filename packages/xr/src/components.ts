import { createComponent, defineComponents, Types } from '@iwsdk/core';

/**
 * One door cut into a wall. Mirrors the portal's live state so the emulator
 * e2e (`iwsdk ecs query`) can assert it without reaching into page globals.
 */
export const Portal = createComponent('Portal', {
  /** P-01, P-02, ... */
  tag: { type: Types.String, default: '' },
  /** framed -> planning -> painting -> open | error */
  state: { type: Types.String, default: 'framed' },
  planeId: { type: Types.String, default: '' },
  widthM: { type: Types.Float32, default: 0 },
  heightM: { type: Types.Float32, default: 0 },
  /** Max distance of the 4 corners from the wall plane (m). */
  offPlaneM: { type: Types.Float32, default: 0 },
  destination: { type: Types.String, default: '' },
  /** muse-image-1.0 | user-upload | cc0-sample */
  source: { type: Types.String, default: '' },
  panoMode: { type: Types.String, default: '' },
  /** room | entering | inside | exiting */
  stepMode: { type: Types.String, default: 'room' },
  stencilRef: { type: Types.Int8, default: 0 },
});

export default defineComponents([Portal]);
