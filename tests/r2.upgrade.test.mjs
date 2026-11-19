import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/db.mjs';
import { createServices } from '../src/services.mjs';
import { sha, passwordHash } from '../src/security.mjs';
test('R2 UPGRADE 01: opening an existing R1 database retains users, quotes and payments',()=>{
 const root=mkdtempSync(join(tmpdir(),'proof-r1-upgrade-')),file=join(root,'old.sqlite');
 const t='2026-11-19T09:00:00.000Z';const id='user-old-123',org='org-old-456',quote='quote-old-789';
 try{
  const db=new DatabaseSync(file);
  db.exec(readFileSync(new URL('./fixtures/schema_r1.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,'legacy@example.org','Legacy User',passwordHash('LegacyStrongPass22!'),t);
  db.prepare('INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)').run(org,'Legacy Org',t);
  db.prepare('INSERT INTO memberships(user_id,org_id,role,created_at) VALUES(?,?,?,?)').run(id,org,'owner',t);
  db.prepare('INSERT INTO subscriptions(org_id,plan,updated_at) VALUES(?,?,?)').run(org,'free',t);
  db.prepare('INSERT INTO quotes(id,org_id,created_by,title,client_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(quote,org,id,'Legacy Proposal','Buyer',t,t);
  db.prepare('INSERT INTO quote_items(id,quote_id,description,qty,unit_price_cents,unit_cost_cents,position) VALUES(?,?,?,?,?,?,?)').run('line-old',quote,'Old work',2,7000,2000,1);
  db.prepare('INSERT INTO referral_codes(user_id,code,created_at) VALUES(?,?,?)').run(id,'LEGACY_CODE',t);
  db.prepare('INSERT INTO quote_shares(id,quote_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').run('old-share',quote,sha('old-r1-token12345'),'2099-01-01T00:00:00.000Z',t);
  db.close();
  const upgraded=openDatabase(file);const svc=createServices(upgraded,{clock:()=>t});
  assert.equal(svc.authenticate('legacy@example.org','LegacyStrongPass22!').id,id);
  assert.equal(svc.getQuote(id,quote).math.totalCents,14000);
  assert.equal(svc.getQuote(id,quote).revision,1);
  assert.throws(()=>svc.quoteByShare('old-r1-token12345'),e=>e.status===404);
  const share=svc.shareQuote(id,quote);assert.equal(svc.quoteByShare(share.token).math.totalCents,14000);
  assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
  assert.equal(svc.verifyAudit().ok,true);upgraded.close();
 }finally{rmSync(root,{recursive:true,force:true})}
});
