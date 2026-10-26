import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RateLimiter, Budget } from '../src/limits.ts';
import { RunStore } from '../src/runs.ts';
import { redact } from '../src/meta.ts';

describe('audit boundaries without transport replacements', () => {
 it('keeps independent IP windows and resets exactly at one minute', () => {
  const l=new RateLimiter(2);expect(l.allow('a',0)).toBe(true);expect(l.allow('a',1)).toBe(true);expect(l.allow('a',2)).toBe(false);expect(l.allow('b',2)).toBe(true);expect(l.allow('a',59999)).toBe(false);expect(l.allow('a',60000)).toBe(true);
 });
 it('persists six-decimal budget spend and ignores an older UTC day', () => {
  const dir=mkdtempSync(join(tmpdir(),'thyra-budget-audit-'));
  try {writeFileSync(join(dir,'budget-2000-01-01.json'),'{"spent_usd":99}');const b=new Budget(dir,.5);expect(b.spentToday()).toBe(0);b.add(.12345678);expect(b.spentToday()).toBe(.123457);b.add(.376543);expect(new Budget(dir,.5).exhausted()).toBe(true);expect(JSON.parse(readFileSync(join(dir,`budget-${new Date().toISOString().slice(0,10)}.json`),'utf8')).spent_usd).toBe(.5);} finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('redacts every sentinel occurrence without a credential', () => {
  expect(redact('audit-sentinel / audit-sentinel','audit-sentinel')).toBe('[redacted] / [redacted]');expect(redact('plain',undefined)).toBe('plain');
 });
 it('rejects traversal IDs, lists UUID records only and deletes referenced files', () => {
  const dir=mkdtempSync(join(tmpdir(),'thyra-store-audit-'));
  try {const s=new RunStore(dir),r=s.create({room:{},destination:'store audit'});expect(s.get('../outside')).toBeNull();expect(s.get('invalid')).toBeNull();writeFileSync(join(dir,'budget-2000-01-01.json'),'{"spent_usd":0}');writeFileSync(join(dir,'other.json'),'{}');expect(s.list().map(x=>x.id)).toEqual([r.id]);const image=`${r.id}.jpg`;writeFileSync(join(dir,image),'actual local file for deletion');r.image={source:'user-upload',stamp:'Your image, not generated',file:image,model:null,request_id:null,latency_ms:null,width:null,height:null,format:null,sample_id:null,web_tools:false};s.save(r);expect(s.delete(r.id)).toBe(true);expect(existsSync(join(dir,image))).toBe(false);expect(s.get(r.id)).toBeNull();}finally{rmSync(dir,{recursive:true,force:true});}
 });
});
