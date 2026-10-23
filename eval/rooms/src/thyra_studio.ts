// thyra_studio: a small studio with a plain 3.6 × 2.4 m back wall above a couch.
// Ground truth for the e2e: back wall 3.6 m wide, ceiling 2.4 m, floor 3.6 × 4.2 m.
//   back wall  (-Z)  couch, floor lamp to its right, coffee table in front
//   left wall  (-X)  window
//   front wall (+Z)  door
const room = createRoom({
  name: 'thyra_studio',
  width: 3.6,
  depth: 4.2,
  height: 2.4,
  z0: -2.6,
  windows: [{ wall: 'left', at: -0.9, width: 1.2, sill: 0.8, head: 2.1 }],
  doors: [{ wall: 'front', at: 0.9 }],
  sun: { azimuth: 25 },
});
sofa(room.against('back', -0.2, 0.92), { width: 2.0, color: '#6f7a80', pillows: ['#c8a46a', '#e8e2d5'] });
floorLamp(room.place(1.35, -2.25));
table(room.place(-0.2, -1.45), { width: 1.0, depth: 0.55, height: 0.42, top: mats.walnut() });
rug(room.place(-0.2, -1.3), { width: 2.2, depth: 1.6, style: 'border', field: '#e2d8c6', accent: '#8f8576' });
plant(room.place(-1.5, 1.1), { height: 1.3, seed: 3 });
room.finish();
