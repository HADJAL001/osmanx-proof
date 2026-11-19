import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {createServices} from '../src/services.mjs';
const prior=new URL('./fixtures/schema_r3.sql',import.meta.url);
function oldDb(){const dir=mkdtempSync(join(tmpdir(),'proof-old-r3-')),name=join(dir,'old.sqlite');let db=new DatabaseSync(name);db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(prior,'utf8'));return {dir,name,db,cleanup:()=>rmSync(dir,{recursive:true,force:true})}}
test('R4 UPGRADE 01: R3 users, quotes and invoices survive additive R4 schema',()=>{
 const f=oldDb();try{
  const svc=createServices(f.db),u=svc.createUser({name:'Historic User',email:'historic@proof.example',password:'good-old-password-123'});
  const quote=svc.createQuote(u.user.id,u.orgId,{title:'Historic Quote',clientName:'Legacy Client',items:[{description:'Old line',qty:1,unitPriceCents:100000,unitCostCents:25000}]});
  const invoice=svc.createInvoice(u.user.id,u.orgId);const hash=svc.verifyAudit().lastHash;
  f.db.close();f.db=openDatabase(f.name);const upgraded=createServices(f.db);
  assert.equal(upgraded.getQuote(u.user.id,quote.id).title,'Historic Quote');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices WHERE id=?').get(invoice.id).n,1);
  assert.equal(upgraded.verifyAudit().lastHash,hash);
  assert.equal(upgraded.taxAttestation(u.user.id,{country:'RU',taxpayerType:'individual',confirmed:true}).declared,true);
 }finally{f.db.close();f.cleanup()}
});
test('R4 UPGRADE 02: old shared proposal remains bound to its original version after schema upgrade',()=>{
 const f=oldDb();try{let svc=createServices(f.db);const u=svc.createUser({name:'Old Specialist',email:'oldshare@proof.example',password:'good-old-password-456'});
 const quote=svc.createQuote(u.user.id,u.orgId,{title:'Old proposal',clientName:'Client',items:[{description:'Work',qty:1,unitPriceCents:99000,unitCostCents:32000}]});
 const share=svc.shareQuote(u.user.id,quote.id);f.db.close();f.db=openDatabase(f.name);svc=createServices(f.db);
 assert.equal(svc.quoteByShare(share.token).title,'Old proposal');
 assert.equal(svc.respondToQuote(share.token,{name:'Client Name',decision:'accepted',consent:true}).decision,'accepted');
 assert.equal(svc.verifyAudit().ok,true);
 }finally{f.db.close();f.cleanup()}
});
