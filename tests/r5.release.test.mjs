import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateR5Gate} from '../scripts/r5-release-gate.mjs';
const root=new URL('../',import.meta.url);
const file=p=>readFileSync(new URL(p,root),'utf8');

test('R5 RELEASE 01: empty environment fails closed',()=>{
 const g=evaluateR5Gate({},{});assert.equal(g.eligible,false);assert.ok(g.failures.length>10);
});
test('R5 RELEASE 02: false evidence blocks deployment',()=>{
 const g=evaluateR5Gate({NODE_ENV:'production',PAYMENT_MODE:'disabled',PAYOUTS_ENABLED:'0'},{});
 assert.equal(g.eligible,false);assert.ok(g.failures.includes('Live PostgreSQL tenant policies not verified'));
});
test('R5 RELEASE 03: SQL migration includes tenant-only RLS policy for projects',()=>{
 const sql=file('db/postgres/006_workflow.sql');
 assert.match(sql,/ALTER TABLE work_projects FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/ALTER TABLE work_milestones FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/proof\.actor_id\(\)/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|INSERT|UPDATE|DELETE) ON work_projects/i);
});
test('R5 RELEASE 04: no authenticated SQL read grant for token hashes',()=>{
 const sql=file('db/postgres/006_workflow.sql');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS work_client_shares/);
 assert.doesNotMatch(sql,/GRANT SELECT ON work_client_shares/);
});
test('R5 RELEASE 05: Next proxy permits only allowlisted authenticated API paths',async()=>{
 const {safeAuthenticatedRelayPath}=await import('../web-next/lib/proxy-policy.mjs');
 assert.equal(safeAuthenticatedRelayPath(['projects','p','milestones','m','submit']),true);
 assert.equal(safeAuthenticatedRelayPath(['public','projects','abc']),false);
 assert.equal(safeAuthenticatedRelayPath(['..','projects']),false);
});
test('R5 RELEASE 06: public Next route rejects unknown tokens and cross origin',()=>{
 const code=file('web-next/app/api/public/projects/[token]/milestones/[milestoneId]/respond/route.ts');
 assert.match(code,/safeReviewToken\(token\)/);assert.match(code,/Cross-origin request rejected/);
 assert.match(code,/byteLength>8192/);
});
test('R5 RELEASE 07: new PostgreSQL policy smoke checks both tenants and unauthenticated',()=>{
 const sql=file('db/postgres/007_workflow_rls_smoke.sql');
 for(const s of ['u_alice','u_bob','anonymous_cannot_see_work','work_projects','work_milestones'])assert.ok(sql.includes(s));
});
test('R5 RELEASE 08: deployment script runs the new live PG tests',()=>{
 const script=file('deploy/r5-postgres-test.sh');
 assert.ok(script.includes('006_workflow.sql'));assert.ok(script.includes('007_workflow_rls_smoke.sql'));
});
test('R5 RELEASE 09: no runtime payout gateway or live payment mode activated',()=>{
 const code=file('src/server.mjs');assert.match(code,/Sandbox and Stripe TEST payments are forbidden in production/);
 const gate=file('scripts/r5-release-gate.mjs');assert.match(gate,/PAYOUTS_ENABLED/);
});
test('R5 RELEASE 10: SQL export keeps new tables on schema inventory',async()=>{
 const {openDatabase}=await import('../src/db.mjs');const db=openDatabase(':memory:');
 try{for(const name of ['work_projects','work_milestones','work_submissions','work_client_shares','work_client_responses']){
  const row=db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);assert.ok(row,`Missing ${name}`);
 }}finally{db.close()}
});
