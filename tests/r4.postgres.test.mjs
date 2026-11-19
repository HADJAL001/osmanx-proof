import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/db.mjs';
import {createServices} from '../src/services.mjs';
import {verifySnapshot,exportSqliteForPostgres,importIntoPostgres} from '../migration/sqlite-pg.mjs';
const root=fileURLToPath(new URL('../db/postgres/',import.meta.url));
function fixture(){
 const temp=mkdtempSync(join(tmpdir(),'proof-r4-pg-')),db=openDatabase(':memory:'),svc=createServices(db);
 const owner=svc.createUser({name:'Alice Test',email:'alice-r4-pg@example.test',password:'correct-long-password-123'});
 const q=svc.createQuote(owner.user.id,owner.orgId,{title:'Postgres import test',clientName:'Customer',items:[{description:'Design service',qty:2,unitPriceCents:13500,unitCostCents:7000}]});
 svc.createInvoice(owner.user.id,owner.orgId);
 const path=join(temp,'export');exportSqliteForPostgres(db,path);
 return {db,svc,owner,q,temp,path,close:()=>{db.close();rmSync(temp,{recursive:true,force:true})}};
}
function pgFake({alter}={}){
 const command=[],tableRows=new Map();let committed=false,rolledBack=false;
 return {command,tableRows,get committed(){return committed},get rolledBack(){return rolledBack},async query(sql,values){
  command.push(sql);
  if(sql==='BEGIN')return {rows:[]};
  if(sql==='COMMIT'){committed=true;return {rows:[]}};
  if(sql==='ROLLBACK'){rolledBack=true;return {rows:[]}};
  if(sql.startsWith('SELECT setval('))return {rows:[{setval:1}]};
  const ins=/^INSERT INTO "([a-z0-9_]+)" \(([^)]+)\) VALUES/.exec(sql);
  if(ins){const cols=ins[2].match(/"([a-z_][a-z0-9_]*)"/g).map(x=>x.slice(1,-1));const row=Object.fromEntries(cols.map((c,i)=>[c,values[i]]));
   if(!tableRows.has(ins[1]))tableRows.set(ins[1],[]);tableRows.get(ins[1]).push(row);return {rowCount:1,rows:[]}}
  const sel=/^SELECT (.+) FROM "([a-z0-9_]+)" ORDER BY "([a-z0-9_]+)"$/.exec(sql);
  if(sel){const name=sel[2],key=sel[3];let rows=(tableRows.get(name)||[]).map(x=>({...x}));rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
   if(name==='audit_events')rows=rows.map(x=>({...x,seq:String(x.seq)}));
   if(alter)rows=alter(name,rows);
   return {rows}
  }
  throw Error('Unexpected SQL in fake PG client: '+sql);
 }};
}
test('R4 POSTGRES 01: verified export knows exact expected R4 table inventory',()=>{const f=fixture();try{
 const snapshot=verifySnapshot(f.path);assert.equal(snapshot.result.length,snapshot.manifest.tables.length);
 for(const name of ['users','payout_tax_attestations','checkout_sessions','provider_verification_reports','payout_export_leases'])
 assert.ok(snapshot.manifest.tables.some(x=>x.name===name));
 }finally{f.close()}
});
test('R4 POSTGRES 02: recomputed checksums cannot bypass table/column allowlisting',()=>{const f=fixture();try{
 const manifestPath=join(f.path,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 manifest.tables[0].columns=['injected_column'];manifest.tablesDigest=createHash('sha256').update(JSON.stringify(manifest.tables)).digest('hex');
 writeFileSync(manifestPath,JSON.stringify(manifest));assert.throws(()=>verifySnapshot(f.path),/schema inventory mismatch/);
 }finally{f.close()}
});
test('R4 POSTGRES 03: missing table is rejected even with recalculated manifest index digest',()=>{const f=fixture();try{
 const manifestPath=join(f.path,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 manifest.tables.pop();manifest.tablesDigest=createHash('sha256').update(JSON.stringify(manifest.tables)).digest('hex');
 writeFileSync(manifestPath,JSON.stringify(manifest));assert.throws(()=>verifySnapshot(f.path),/table inventory mismatch/);
 }finally{f.close()}
});
test('R4 POSTGRES 04: importer verifies every field before commit on fake PG protocol',async()=>{const f=fixture();try{
 const client=pgFake();const result=await importIntoPostgres(f.path,{client});
 assert.equal(result.ok,true);assert.equal(result.verifiedContent,true);assert.equal(client.committed,true);assert.equal(client.rolledBack,false);
 assert.ok(client.command.some(q=>q.startsWith('SELECT "id"')));
 }finally{f.close()}
});
test('R4 POSTGRES 05: same row counts but altered money cause a rollback',async()=>{const f=fixture();try{
 const client=pgFake({alter:(name,rows)=>name==='invoices'&&rows.length?rows.map((r,i)=>i===0?{...r,total_cents:r.total_cents+1}:r):rows});
 await assert.rejects(()=>importIntoPostgres(f.path,{client}),/content mismatch: invoices/);
 assert.equal(client.committed,false);assert.equal(client.rolledBack,true);
 }finally{f.close()}
});
test('R4 POSTGRES 06: equal count with altered organization owner is caught',async()=>{const f=fixture();try{
 const client=pgFake({alter:(name,rows)=>name==='memberships'&&rows.length?rows.map(r=>({...r,user_id:'wrong-user'})):rows});
 await assert.rejects(()=>importIntoPostgres(f.path,{client}),/content mismatch: memberships/);
 assert.equal(client.rolledBack,true);
 }finally{f.close()}
});
test('R4 POSTGRES 07: RLS migration makes non-owner runtime role read/write minimal',()=>{
 const sql=readFileSync(join(root,'004_app_role_hardening.sql'),'utf8');
 assert.match(sql,/CREATE ROLE proof_app NOLOGIN NOBYPASSRLS/);
 for(const name of ['organizations','memberships','quotes','quote_items','invoices','checkout_sessions'])
 assert.match(sql,new RegExp('ALTER TABLE '+name+' FORCE ROW LEVEL SECURITY'));
 assert.match(sql,/DROP POLICY IF EXISTS quote_member_write/);
 assert.match(sql,/CREATE POLICY quote_insert/);assert.match(sql,/created_by=proof.actor_id\(\)/);
 assert.doesNotMatch(sql,/GRANT (ALL|UPDATE|DELETE) ON (payments|payout_requests)/);
});
test('R4 POSTGRES 08: live role matrix smoke exercises other-tenant and missing-actor rejection',()=>{
 const sql=readFileSync(join(root,'005_role_matrix_smoke.sql'),'utf8');
 for(const marker of ['cross-tenant insertion','unauthenticated_zero','alice_sees_one','bob_sees_one','SET LOCAL ROLE proof_app'])assert.ok(sql.includes(marker));
});
