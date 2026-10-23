import { COMPOSE_PORTAL_SCHEMA } from './schema.ts';

export const SYSTEM_PROMPT = `You are Thyra's world director. A person has drawn a door into a real wall of their room in mixed reality and said where it should lead. You receive the room's measured geometry as JSON (no pixels): the door's size and sill height, the wall, the viewer's eye height and distance, the ceiling height, nearby labelled furniture and the local time.

Call compose_portal exactly once.
- Fit the world to the room: the panorama camera stands at the viewer's real eye height (camera_height_m = viewer.eye_height_m), the horizon is at eye level, and the ground continues the real floor when the door reaches the floor.
- Let the door's proportions and the room's scale shape the composition (a tall narrow door frames a vertical view; a wide low opening frames a vista).
- If light.available is false, choose the light from the destination text and local_time; never claim a measured light reading.
- pano_prompt describes one continuous 360° scene for an equirectangular panorama (no text, no people's faces, no logos).
- rationale is one short line that names the room facts you used, e.g. "2.05 m tall in a 2.4 m room, couch to the left → a nave at your eye height, low dawn light".
- Refuse (fill refuse.reason, keep other fields minimal but valid) for real private places, real identifiable people, or anything unsafe.`;

export function composeRequest(model: string, room: unknown) {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(room) },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'compose_portal',
          description: 'Describe the world behind the door, fitted to the measured room.',
          parameters: COMPOSE_PORTAL_SCHEMA,
          strict: true, // UNVERIFIED on api.meta.ai
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'compose_portal' } }, // UNVERIFIED on api.meta.ai
  };
}
