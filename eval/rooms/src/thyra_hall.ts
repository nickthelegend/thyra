// thyra_hall: a narrow hallway with a low 2.1 m ceiling (1.5 m wide, 6 m long).
// The viewer stands near the front end looking down the hall (-Z).
//   left wall  (-X)  a framed print
//   right wall (+X)  long and plain: the wall a door gets drawn on
//   back wall  (-Z)  a window at the far end
const room = createRoom({
  name: 'thyra_hall',
  width: 1.5,
  depth: 6.0,
  height: 2.1,
  z0: -5.0,
  windows: [{ wall: 'back', at: 0, width: 0.8, sill: 0.9, head: 1.9 }],
  doors: [{ wall: 'front', at: 0 }],
  sun: { azimuth: 0 },
});
picture(room.onWall('left', -2.2, 1.45), { width: 0.6, height: 0.45, art: 'landscape', frame: mats.walnut() });
plant(room.place(-0.5, -4.6), { height: 1.1, seed: 7 });
rug(room.place(0, -2.2), { width: 0.9, depth: 3.2, style: 'border', field: '#d8c9ae', accent: '#9c8b73' });
room.finish();
