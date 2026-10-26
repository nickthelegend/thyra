import { it, expect } from 'vitest';
import { wallFrame, rayWall, buildRoomSummary, badges } from '../src/index.ts';
import { backWall } from './fixtures.ts';
it('empty wall polygons have finite zero bounds and parallel rays miss',()=>{
 const f=wallFrame({...backWall,polygon:[]},[0,1.6,0]);expect(f.bounds).toEqual({u0:0,u1:0,v0:0,v1:0});expect(rayWall(wallFrame(backWall,[0,1.6,0]),[0,1.6,0],[1,0,0])).toBeNull();
});
it('summary caps nearby objects at eight and sorts the measured distances',()=>{
 const s=buildRoomSummary({frame:wallFrame(backWall,[0,1.6,0]),rect:{u0:-.6,u1:.6,v0:-1.35,v1:.7},head:[0,1.6,0],floorY:0,ceilingY:2.7,floorArea:29,objects:Array.from({length:12},(_,i)=>({label:`object-${i}`,center:[i*.1,1,-2] as [number,number,number],dims:[.1,.1,.1] as [number,number,number]})),now:new Date(),destination:'actual geometry test'});expect(s.room.objects).toHaveLength(8);expect(s.room.objects.map(o=>o.distance_m)).toEqual(s.room.objects.map(o=>o.distance_m).sort((a,b)=>a-b));expect(s.light).toEqual({available:false});
});
it('missing models report not reported instead of ready',()=>{
 const s={budget:{spent_usd_today:0,cap_usd:5}} as Parameters<typeof badges>[0];expect(badges(s).every(b=>b.text.includes('not reported'))).toBe(true);
});
