import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.mjs';
import { createServices } from '../src/services.mjs';
import { exportSqliteForPostgres, verifySnapshot, replayToFreshSQLite } from '../migration/sqlite-pg.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const quote={title:'Landing site',clientName:'Atlas Coffee',clientEmail:'client@atlas.test',
 items:[{description:'Premium site',qty:1,unitPriceCents:990000,unitCostCents:230000}]};
const future='2026-12-31T23:59:59.000Z';
function fixture(){let time='2026-11-20T12:00:00.000Z';const db=openDatabase(':memory:');
 const svc=createServices(db,{clock:()=>time});
 const make=(name)=>{const {user,orgId}=svc.createUser({name,email:`${name}@test.invalid`,password:'VerySecurePassword123!'});return {userId:user.id,orgId}};
 const a=make('alice'),b=make('bob');
 const accepted=(user=a)=>{
  const q=svc.createQuote(user.userId,user.orgId,quote);
  const s=svc.shareQuote(user.userId,q.id);
  svc.respondToQuote(s.token,{decision:'accepted',consent:true,name:'Client Full Name'});
  return q;
 };
 const launched=()=>svc.workflow.launch(a.userId,accepted().id);
 return {db,svc,a,b,accepted,launched,setTime:x=>time=x,close:()=>db.close()};
}
const withDb=fn=>async()=>{const x=fixture();try{await fn(x)}finally{x.close()}};

test('R5 01: accepted customer response is required for project launch',withDb(({svc,a})=>{
 const q=svc.createQuote(a.userId,a.orgId,quote);svc.quoteStatus(a.userId,q.id,'accepted');
 assert.throws(()=>svc.workflow.launch(a.userId,q.id),e=>e.code==='CLIENT_ACCEPTANCE_REQUIRED');
}));
test('R5 02: quote acceptance launches exactly one immutable project',withDb(({svc,a,accepted})=>{
 const q=accepted(),p=svc.workflow.launch(a.userId,q.id);
 assert.equal(p.title,quote.title);assert.equal(p.totalCents,990000);assert.equal(p.progress.percentage,0);
 assert.throws(()=>svc.workflow.launch(a.userId,q.id),/already launched/i);
 assert.equal(svc.workflow.list(a.userId,a.orgId).length,1);
}));
test('R5 03: cannot start a draft or merely sent quote',withDb(({svc,a})=>{
 const q=svc.createQuote(a.userId,a.orgId,quote);
 assert.throws(()=>svc.workflow.launch(a.userId,q.id),/accepted/);
 svc.shareQuote(a.userId,q.id);
 assert.throws(()=>svc.workflow.launch(a.userId,q.id),/accepted/);
}));
test('R5 04: viewer, outside tenant and editor access differentiated',withDb(({svc,a,b,launched})=>{
 const p=launched();assert.throws(()=>svc.workflow.details(b.userId,p.id),e=>e.status===403);
 assert.throws(()=>svc.workflow.createMilestone(b.userId,p.id,{title:'Cross tenant'}),e=>e.status===403);
 const invited=svc.invite(a.userId,a.orgId,'bob@test.invalid','viewer');svc.acceptInvite(b.userId,invited.token);
 assert.equal(svc.workflow.details(b.userId,p.id).id,p.id);
 assert.throws(()=>svc.workflow.createMilestone(b.userId,p.id,{title:'Viewer edit'}),e=>e.status===403);
 assert.throws(()=>svc.workflow.share(b.userId,p.id),e=>e.status===403);
}));
test('R5 05: milestone sorting and max 50 limit',withDb(({svc,a,launched})=>{
 const p=launched();for(let k=0;k<50;k++)svc.workflow.createMilestone(a.userId,p.id,{title:'Milestone '+k});
 const all=svc.workflow.details(a.userId,p.id).milestones;
 assert.equal(all.length,50);assert.equal(all[0].position,1);assert.equal(all.at(-1).position,50);
 assert.throws(()=>svc.workflow.createMilestone(a.userId,p.id,{title:'Extra milestone'}),/Maximum 50/);
}));
test('R5 06: rejects invalid milestone title and date',withDb(({svc,a,launched})=>{
 const p=launched();assert.throws(()=>svc.workflow.createMilestone(a.userId,p.id,{title:'a'}),/title/i);
 assert.throws(()=>svc.workflow.createMilestone(a.userId,p.id,{title:'OK',dueAt:'yesterday'}),/ISO/);
 assert.equal(svc.workflow.createMilestone(a.userId,p.id,{title:'Valid',dueAt:future}).milestones[0].dueAt,future);
}));
test('R5 07: optimistic version prevents stale editors overwriting changes',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Ship landing'});
 const m=p.milestones[0];svc.workflow.updateMilestone(a.userId,p.id,m.id,{title:'New title',description:'Detail',expectedVersion:1});
 assert.throws(()=>svc.workflow.updateMilestone(a.userId,p.id,m.id,{title:'Bad',expectedVersion:1}),e=>e.code==='STALE_MILESTONE');
 assert.equal(svc.workflow.details(a.userId,p.id).milestones[0].title,'New title');
}));
test('R5 08: evidence submission has stable revision and checksum',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Ship landing'}),m=p.milestones[0];
 const result=svc.workflow.submitMilestone(a.userId,p.id,m.id,{summary:'Design and deploy complete'});
 assert.equal(result.milestones[0].status,'submitted');assert.equal(result.milestones[0].submittedRevision,1);
 assert.match(result.milestones[0].contentHash,/^[a-f0-9]{64}$/);
 assert.throws(()=>svc.workflow.submitMilestone(a.userId,p.id,m.id,{summary:'Try again with changed text'}),/not available/);
}));
test('R5 09: client tokens hashed and portal omits costs',withDb(({svc,a,launched,db})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Design'});
 const share=svc.workflow.share(a.userId,p.id);const publicP=svc.workflow.publicDetails(share.token);
 assert.equal(publicP.clientName,quote.clientName);
 assert.equal(JSON.stringify(publicP).includes('unit_cost_cents'),false);
 assert.equal(JSON.stringify(publicP).includes('230000'),false);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_client_shares WHERE token_hash=?').get(share.token).n,0);
 assert.throws(()=>svc.workflow.publicDetails('wrong'),e=>e.status===404);
}));
test('R5 10: rotating and revoking client portal links',withDb(({svc,a,launched})=>{
 const p=launched(),one=svc.workflow.share(a.userId,p.id),two=svc.workflow.share(a.userId,p.id);
 assert.throws(()=>svc.workflow.publicDetails(one.token),e=>e.status===404);
 assert.equal(svc.workflow.publicDetails(two.token).id,p.id);
 assert.deepEqual(svc.workflow.revoke(a.userId,p.id,two.shareId),{revoked:true});
 assert.throws(()=>svc.workflow.publicDetails(two.token),e=>e.status===404);
 assert.throws(()=>svc.workflow.revoke(a.userId,p.id,two.shareId),e=>e.status===404);
}));
test('R5 11: expired links fail closed',withDb(({svc,a,launched,setTime})=>{
 const p=launched(),s=svc.workflow.share(a.userId,p.id);
 setTime('2027-01-01T00:00:00.000Z');
 assert.throws(()=>svc.workflow.publicDetails(s.token),e=>e.status===404);
}));
test('R5 12: client cannot approve a milestone not yet submitted',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Deliver'}),s=svc.workflow.share(a.userId,p.id);
 assert.throws(()=>svc.workflow.respond(s.token,p.milestones[0].id,{consent:true,name:'Client',decision:'accepted',submissionRevision:1}),/not awaiting/);
}));
test('R5 13: client response needs consent and exact submission revision',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Deliver'}),m=p.milestones[0];
 svc.workflow.submitMilestone(a.userId,p.id,m.id,{summary:'Delivery is complete'});
 const s=svc.workflow.share(a.userId,p.id);
 assert.throws(()=>svc.workflow.respond(s.token,m.id,{consent:false,name:'Client',decision:'accepted',submissionRevision:1}),/Explicit/);
 assert.throws(()=>svc.workflow.respond(s.token,m.id,{consent:true,name:'Client',decision:'accepted',submissionRevision:2}),e=>e.code==='STALE_SUBMISSION');
 assert.equal(svc.workflow.details(a.userId,p.id).milestones[0].status,'submitted');
}));
test('R5 14: changes requested, revisions, acceptance, project completion',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Deliver'}),m=p.milestones[0];
 svc.workflow.submitMilestone(a.userId,p.id,m.id,{summary:'Delivery version first'});
 const s=svc.workflow.share(a.userId,p.id);
 const r=svc.workflow.respond(s.token,m.id,{consent:true,name:'Client',decision:'changes_requested',message:'Please improve the header',submissionRevision:1});
 assert.equal(r.decision,'changes_requested');assert.equal(svc.workflow.details(a.userId,p.id).status,'active');
 svc.workflow.submitMilestone(a.userId,p.id,m.id,{summary:'Delivery version two updated header'});
 const r2=svc.workflow.respond(s.token,m.id,{consent:true,name:'Client',decision:'accepted',submissionRevision:2});
 assert.equal(r2.projectCompleted,true);
 assert.equal(svc.workflow.details(a.userId,p.id).progress.percentage,100);
 assert.equal(svc.workflow.details(a.userId,p.id).status,'completed');
 assert.throws(()=>svc.workflow.createMilestone(a.userId,p.id,{title:'Late work'}),/not active/);
}));
test('R5 15: submission response cannot be replayed',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Deliver'}),m=p.milestones[0];
 svc.workflow.submitMilestone(a.userId,p.id,m.id,{summary:'Finished client delivery'});const s=svc.workflow.share(a.userId,p.id);
 const body={consent:true,name:'Client',decision:'accepted',submissionRevision:1};svc.workflow.respond(s.token,m.id,body);
 assert.throws(()=>svc.workflow.respond(s.token,m.id,body),e=>e.status===409);
}));
test('R5 16: invalid project/milestone cross-tenant IDs cannot be combined',withDb(({svc,a,b,accepted})=>{
 const pa=svc.workflow.launch(a.userId,accepted(a).id);
 const pb=svc.workflow.launch(b.userId,accepted(b).id);
 const mb=svc.workflow.createMilestone(b.userId,pb.id,{title:'Other work'}).milestones[0];
 assert.throws(()=>svc.workflow.submitMilestone(a.userId,pa.id,mb.id,{summary:'Attempt to mutate the other tenant'}),e=>e.status===404);
}));
test('R5 17: aggregate metrics are organization-scoped, no revenue inference',withDb(({svc,a,b,accepted})=>{
 svc.workflow.launch(a.userId,accepted(a).id);
 assert.equal(svc.workflow.metrics(a.userId,a.orgId).projects,1);
 assert.equal(svc.workflow.metrics(b.userId,b.orgId).projects,0);
 assert.match(svc.workflow.metrics(a.userId,a.orgId).disclaimer,/not recognized revenue/);
 assert.throws(()=>svc.workflow.metrics(b.userId,a.orgId),e=>e.status===403);
}));
test('R5 18: CSV read restriction and export record cap',withDb(({svc,a,b,launched})=>{
 launched();assert.equal(svc.workflow.exportRows(a.userId,a.orgId).length,1);
 assert.throws(()=>svc.workflow.exportRows(b.userId,a.orgId),e=>e.status===403);
}));
test('R5 19: full audit/ledger remain intact after workflow',withDb(({svc,a,launched})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Phase 1'});
 svc.workflow.submitMilestone(a.userId,p.id,p.milestones[0].id,{summary:'Documented delivery'});
 assert.equal(svc.verifyAudit().ok,true);assert.equal(svc.verifyLedger().ok,true);
}));
test('R5 20: R5 source snapshot can replay all new tables into fresh SQLite',withDb(({svc,a,launched,db})=>{
 const p=svc.workflow.createMilestone(a.userId,launched().id,{title:'Phase 1'});
 const s=svc.workflow.share(a.userId,p.id);
 svc.workflow.submitMilestone(a.userId,p.id,p.milestones[0].id,{summary:'Finished final layout'});
 svc.workflow.respond(s.token,p.milestones[0].id,{name:'Client',consent:true,decision:'accepted',submissionRevision:1});
 const dir=mkdtempSync(join(tmpdir(),'osx-proof-r5-')),out=join(dir,'snapshot'),dest=join(dir,'restore.sqlite');
 try{
  exportSqliteForPostgres(db,out);assert.ok(verifySnapshot(out).result.length>0);
  const result=replayToFreshSQLite(out,dest,new URL('../db/schema.sql',import.meta.url).pathname);
  assert.equal(result.ok,true);
 }finally{rmSync(dir,{recursive:true,force:true})}
}));
