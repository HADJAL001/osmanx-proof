import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db.mjs';
import { createServices } from '../src/services.mjs';
import { makeBackup, verifyBackup, restoreBackup } from '../src/ops.mjs';
test('R2 OPS 01: online SQLite backup verified with hash, ledger and audit, restores to new destination',async()=>{
 const root=mkdtempSync(join(tmpdir(),'proof-r2-'));const original=join(root,'live.db'),snapshot=join(root,'backup.db'),restored=join(root,'restored.db');
 try{const db=openDatabase(original),svc=createServices(db);const a=svc.createUser({name:'Alice',email:'alice@sample.org',password:'longPassword123!'});const inv=svc.createInvoice(a.user.id,a.orgId);svc.processPaymentEvent({id:'event987654321',type:'payment.succeeded',provider:'sandbox',invoiceId:inv.id,externalId:'external-r2-123456',amountCents:inv.total_cents,currency:'RUB'});
  const result=await makeBackup(db,snapshot);assert.equal(result.ok,true);assert.equal(result.audit.ok,true);assert.equal(result.ledger.ok,true);assert.equal(verifyBackup(snapshot).sha256,result.sha256);db.close();
  const restoredR=restoreBackup(snapshot,restored);assert.equal(restoredR.verified,true);const reopened=openDatabase(restored);const rows=reopened.prepare('SELECT COUNT(*) AS n FROM users').get();assert.equal(rows.n,1);assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM payments').get().n,1);reopened.close();
  assert.throws(()=>restoreBackup(snapshot,restored),/exists/);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('R2 OPS 02: changed backup bytes are rejected before restoration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'proof-r2-tamper-'));try{
  const db=openDatabase(':memory:');const backup=join(root,'proof.db');await makeBackup(db,backup);db.close();
  const raw=readFileSync(backup);raw[800]=raw[800]^1;writeFileSync(backup,raw);assert.throws(()=>verifyBackup(backup));assert.throws(()=>restoreBackup(backup,join(root,'out.db')));assert.equal(existsSync(join(root,'out.db')),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('R2 OPS 03: backup does not overwrite an existing file',async()=>{
 const root=mkdtempSync(join(tmpdir(),'proof-r2-overwrite-'));try{const db=openDatabase(':memory:');const location=join(root,'proof.db');await makeBackup(db,location);await assert.rejects(()=>makeBackup(db,location),/exists/);db.close();}finally{rmSync(root,{recursive:true,force:true})}
});
