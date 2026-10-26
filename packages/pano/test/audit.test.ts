import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzePanorama, choosePanoMode, seamFix } from '../src/index.ts';
it('uses inclusive seam/horizon thresholds and aspect precedence without mutating input pixels',()=>{
 const data=new Uint8Array(readFileSync(new URL('./fixtures/misty_pines_cropped_256x128.rgba',import.meta.url))),copy=data.slice(),img={data,width:256,height:128};const a=analyzePanorama(img);
 expect(choosePanoMode({...a,aspect:2,horizon_offset:.05,seam_delta_e:6,inner_delta_e:2})).toBe('equirect');expect(choosePanoMode({...a,aspect:1.5,seam_delta_e:100})).toBe('cylinder');seamFix(img,64,.08);expect(data).toEqual(copy);
});
