/**
 * compose_portal: the one tool Muse Spark (or Wonder) must call. Strict:
 * unknown fields are an error, never silently dropped.
 */
export interface PortalPlan {
  refuse?: { reason: string };
  title: string;
  pano_prompt: string;
  camera_height_m: number;
  horizon: 'eye-level';
  ground: { kind: string; material: string };
  time_of_day: string;
  palette: [string, string, string];
  frame_trim: { style: string; hex: string };
  ambient_spill: { hex: string; intensity: number };
  rationale: string;
}

const HEX = '^#[0-9a-fA-F]{6}$';

export const COMPOSE_PORTAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'pano_prompt', 'camera_height_m', 'horizon', 'ground', 'time_of_day', 'palette', 'frame_trim', 'ambient_spill', 'rationale'],
  properties: {
    refuse: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: { reason: { type: 'string' } },
    },
    title: { type: 'string', description: 'Short name of the place, at most 6 words.' },
    pano_prompt: { type: 'string', description: 'Image prompt for the 360° panorama, fitted to the room.' },
    camera_height_m: { type: 'number', description: "The viewer's real eye height from the room summary." },
    horizon: { type: 'string', enum: ['eye-level'] },
    ground: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'material'],
      properties: { kind: { type: 'string' }, material: { type: 'string' } },
    },
    time_of_day: { type: 'string' },
    palette: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', pattern: HEX } },
    frame_trim: {
      type: 'object',
      additionalProperties: false,
      required: ['style', 'hex'],
      properties: { style: { type: 'string' }, hex: { type: 'string', pattern: HEX } },
    },
    ambient_spill: {
      type: 'object',
      additionalProperties: false,
      required: ['hex', 'intensity'],
      properties: { hex: { type: 'string', pattern: HEX }, intensity: { type: 'number', minimum: 0, maximum: 1 } },
    },
    rationale: { type: 'string', description: 'One line: how the room shaped the world.' },
  },
} as const;

type Schema = { type?: string; required?: readonly string[]; properties?: Record<string, Schema>; additionalProperties?: boolean; enum?: readonly string[]; pattern?: string; minItems?: number; maxItems?: number; items?: Schema; minimum?: number; maximum?: number };

/** Validates a value against the subset of JSON Schema used above. Returns error paths. */
export function validate(value: unknown, schema: Schema = COMPOSE_PORTAL_SCHEMA as Schema, path = '$'): string[] {
  const errs: string[] = [];
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected object`];
      const obj = value as Record<string, unknown>;
      for (const r of schema.required ?? []) if (!(r in obj)) errs.push(`${path}.${r}: required`);
      for (const [k, v] of Object.entries(obj)) {
        const sub = schema.properties?.[k];
        if (!sub) {
          if (schema.additionalProperties === false) errs.push(`${path}.${k}: unknown field`);
          continue;
        }
        errs.push(...validate(v, sub, `${path}.${k}`));
      }
      return errs;
    }
    case 'array': {
      if (!Array.isArray(value)) return [`${path}: expected array`];
      if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: too few items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: too many items`);
      value.forEach((v, i) => schema.items && errs.push(...validate(v, schema.items, `${path}[${i}]`)));
      return errs;
    }
    case 'string':
      if (typeof value !== 'string') return [`${path}: expected string`];
      if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not one of ${schema.enum.join(', ')}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: bad format`);
      return errs;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: expected number`];
      if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: above ${schema.maximum}`);
      return errs;
    default:
      return errs;
  }
}

/** The pano prompt always carries the panorama contract (spec), whatever Spark wrote. */
export function panoPrompt(plan: Pick<PortalPlan, 'pano_prompt' | 'camera_height_m'>): string {
  const h = plan.camera_height_m.toFixed(2);
  return `${plan.pano_prompt.trim()}\n\nequirectangular 360° panorama, 2:1, horizon exactly at the vertical centre, camera at ${h} m, seamless left and right edges`;
}

/** Minimal structural check of a room summary coming from a client. */
export function validateRoom(room: unknown): string[] {
  if (typeof room !== 'object' || room === null) return ['room: expected object'];
  const r = room as Record<string, unknown>;
  const errs: string[] = [];
  for (const k of ['portal', 'viewer', 'room', 'light', 'local_time', 'destination_text']) if (!(k in r)) errs.push(`room.${k}: required`);
  if (JSON.stringify(room).length > 8_000) errs.push('room: too large');
  return errs;
}
