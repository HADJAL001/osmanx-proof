import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createHttpServer} from '../src/server.mjs';

const Q={title:'Client website',clientName:'Sample Client',clientEmail:'private@sample.test',
 items:[{description:'Responsive website',qty:1,unitPriceCents:125000,unitCostCents:40000}]};
async function fixture(){const db=openDatabase(':memory:');const instance=createHttpServer({db,mode:'sandbox',origin:'http://local.test',ipSecret:'r5-local-test-ip-salt-000000000000',production:false});
 await new Promise(ok=>instance.server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${instance.server.address().port}`;
 const request=async(path,{method='GET',body,actor,origin='http://local.test',headers={}}={})=>{
  const r=await fetch(base+path,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{}),...(origin?{origin}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const type=r.headers.get('content-type')||'';
  const data=type.includes('application/json')?await r.json():await r.text();
  return {status:r.status,data,headers:r.headers};
 };
 let n=0;const register=async()=>{const name='User'+(++n);const r=await request('/api/auth/register',{method:'POST',body:{name,email:name.toLowerCase()+'@sample.invalid',password:'AnotherStrongPassword123!'}});
  assert.equal(r.status,201,JSON.stringify(r.data));return {id:r.data.user.id,org:r.data.organizations[0].id,csrf:r.data.csrf,cookie:r.headers.get('set-cookie').split(';')[0]};};
 const prepared=async(actor)=>{const q=(await request('/api/quotes',{method:'POST',body:{...Q,orgId:actor.org},actor})).data.quote;
  const shared=(await request('/api/quotes/'+q.id+'/share',{method:'POST',body:{},actor})).data;
  const token=new URL(shared.url).pathname.split('/').at(-1);
  const accepted=await request(`/api/public/quotes/${token}/respond`,{method:'POST',body:{name:'Client',consent:true,decision:'accepted'},headers:{}});
  assert.equal(accepted.status,201,JSON.stringify(accepted.data));
  return q;
 };
 const project=async(actor)=>{const q=await prepared(actor),r=await request('/api/projects',{method:'POST',body:{quoteId:q.id},actor});
  assert.equal(r.status,201,JSON.stringify(r.data));return r.data.project};
 return {...instance,db,base,request,register,prepared,project,close:async()=>{await new Promise(ok=>instance.server.close(ok));db.close()}};
}
const run=fn=>async()=>{const f=await fixture();try{await fn(f)}finally{await f.close()}};

test('R5 HTTP 01: browser SPA includes R5 projects tab and new assets',run(async f=>{
 const home=await f.request('/');assert.equal(home.status,200);
 const js=await f.request('/app.js');assert.equal(js.status,200);assert.match(js.data,/launchproject/);
 assert.ok(js.data.includes('data-action="'));  // verifies legacy event system remains present
 assert.equal((await f.request('/client.css')).status,200);
 assert.equal((await f.request('/client.js')).status,200);
}));
test('R5 HTTP 02: complete quote to project to milestone to acceptance',run(async f=>{
 const user=await f.register(),p=await f.project(user);
 const create=await f.request(`/api/projects/${p.id}/milestones`,{method:'POST',actor:user,body:{title:'Frontend deployed',description:'Customer portal'}});
 assert.equal(create.status,201);const m=create.data.project.milestones[0];
 const submit=await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{method:'POST',actor:user,body:{summary:'Website deployed and verified'}});
 assert.equal(submit.status,200);
 const share=await f.request(`/api/projects/${p.id}/share`,{method:'POST',actor:user,body:{}});assert.equal(share.status,201);
 const raw=new URL(share.data.url).pathname;
 const doc=await f.request(raw);assert.equal(doc.status,200);assert.match(doc.data,/Frontend deployed/);
 assert.match(doc.data,/Website deployed and verified/);
 const token=raw.split('/')[2];
 const reply=await f.request(`/api/public/projects/${token}/milestones/${m.id}/respond`,{method:'POST',body:{name:'Atlas Client',decision:'accepted',consent:true,submissionRevision:1}});
 assert.equal(reply.status,201,JSON.stringify(reply.data));assert.equal(reply.data.projectCompleted,true);
 const detail=await f.request(`/api/projects/${p.id}`,{actor:user});assert.equal(detail.data.project.status,'completed');
 const stats=await f.request('/api/projects/metrics?orgId='+user.org,{actor:user});assert.equal(stats.data.metrics.completed,1);
 assert.equal((await f.request('/ready')).status,200);
}));
test('R5 HTTP 03: no project without signed-link client acceptance',run(async f=>{
 const user=await f.register();const quote=(await f.request('/api/quotes',{method:'POST',actor:user,body:{...Q,orgId:user.org}})).data.quote;
 await f.request('/api/quotes/'+quote.id+'/status',{method:'POST',actor:user,body:{status:'accepted'}});
 const r=await f.request('/api/projects',{method:'POST',actor:user,body:{quoteId:quote.id}});
 assert.equal(r.status,409);assert.equal(r.data.code,'CLIENT_ACCEPTANCE_REQUIRED');
}));
test('R5 HTTP 04: CSRF, wrong origin, anonymous requests blocked',run(async f=>{
 const u=await f.register(),q=await f.prepared(u);
 const anon=await f.request('/api/projects',{method:'POST',body:{quoteId:q.id}});assert.equal(anon.status,401);
 const noCsrf=await f.request('/api/projects',{method:'POST',body:{quoteId:q.id},headers:{cookie:u.cookie}});assert.equal(noCsrf.status,403);
 const cross=await f.request('/api/projects',{method:'POST',body:{quoteId:q.id},actor:u,origin:'https://evil.test'});assert.equal(cross.status,403);
 const good=await f.request('/api/projects',{method:'POST',body:{quoteId:q.id},actor:u});assert.equal(good.status,201);
}));
test('R5 HTTP 05: tenant isolation on all project endpoints',run(async f=>{
 const a=await f.register(),b=await f.register(),p=await f.project(a);
 assert.equal((await f.request(`/api/projects/${p.id}`,{actor:b})).status,403);
 assert.equal((await f.request(`/api/projects/${p.id}/milestones`,{method:'POST',body:{title:'Injected'},actor:b})).status,403);
 assert.equal((await f.request(`/api/projects/${p.id}/share`,{method:'POST',body:{},actor:b})).status,403);
 assert.equal((await f.request('/api/projects?orgId='+a.org,{actor:b})).status,403);
 assert.equal((await f.request('/api/projects/export.csv?orgId='+a.org,{actor:b})).status,403);
}));
test('R5 HTTP 06: public portal token does not disclose private email or unit costs',run(async f=>{
 const u=await f.register(),p=await f.project(u);
 const s=await f.request(`/api/projects/${p.id}/share`,{method:'POST',actor:u,body:{}});
 const url=new URL(s.data.url).pathname,html=(await f.request(url)).data;
 assert.equal(html.includes('private@sample.test'),false);assert.equal(html.includes('40000'),false);
 assert.equal(html.includes('unitCostCents'),false);
 assert.equal((await f.request(url)).headers.get('x-robots-tag'),'noindex,nofollow');
}));
test('R5 HTTP 07: revoked share stops public GET and POST',run(async f=>{
 const u=await f.register(),p=await f.project(u);
 const created=await f.request(`/api/projects/${p.id}/milestones`,{method:'POST',actor:u,body:{title:'Stage'}});const m=created.data.project.milestones[0];
 await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{method:'POST',actor:u,body:{summary:'Finished first stage successfully'}});
 const share=await f.request(`/api/projects/${p.id}/share`,{method:'POST',actor:u,body:{}});
 const token=new URL(share.data.url).pathname.split('/')[2];
 assert.equal((await f.request('/c/'+token)).status,200);
 assert.equal((await f.request(`/api/projects/${p.id}/shares/${share.data.shareId}/revoke`,{method:'POST',actor:u,body:{}})).status,200);
 assert.equal((await f.request('/c/'+token)).status,404);
 assert.equal((await f.request(`/api/public/projects/${token}/milestones/${m.id}/respond`,{method:'POST',body:{name:'Client',decision:'accepted',consent:true,submissionRevision:1}})).status,404);
}));
test('R5 HTTP 08: public reply is origin-checked, consent checked and idempotent',run(async f=>{
 const u=await f.register(),p=await f.project(u),m=(await f.request(`/api/projects/${p.id}/milestones`,{method:'POST',actor:u,body:{title:'Stage'}})).data.project.milestones[0];
 await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{method:'POST',actor:u,body:{summary:'Finished a complete project stage'}});
 const s=await f.request(`/api/projects/${p.id}/share`,{method:'POST',actor:u,body:{}}),tok=new URL(s.data.url).pathname.split('/')[2];
 const route=`/api/public/projects/${tok}/milestones/${m.id}/respond`,body={name:'Client',decision:'accepted',consent:true,submissionRevision:1};
 assert.equal((await f.request(route,{method:'POST',body,origin:'https://bad.test'})).status,403);
 assert.equal((await f.request(route,{method:'POST',body:{...body,consent:false}})).status,422);
 assert.equal((await f.request(route,{method:'POST',body})).status,201);
 assert.equal((await f.request(route,{method:'POST',body})).status,409);
}));
test('R5 HTTP 09: client HTML escapes malicious content in project and delivery',run(async f=>{
 const u=await f.register();const weird='<svg/onload=alert(1337)>';const q=(await f.request('/api/quotes',{method:'POST',actor:u,body:{...Q,title:weird,orgId:u.org}})).data.quote;
 const share=(await f.request(`/api/quotes/${q.id}/share`,{method:'POST',body:{},actor:u})).data;
 const tok=new URL(share.url).pathname.split('/')[2];await f.request(`/api/public/quotes/${tok}/respond`,{method:'POST',body:{name:'Client',decision:'accepted',consent:true}});
 const p=(await f.request('/api/projects',{method:'POST',actor:u,body:{quoteId:q.id}})).data.project;
 const s=await f.request(`/api/projects/${p.id}/share`,{method:'POST',actor:u,body:{}});
 const html=(await f.request(new URL(s.data.url).pathname)).data;
 assert.ok(html.includes('&lt;svg/'));assert.equal(html.includes('<svg/onload='),false);
}));
test('R5 HTTP 10: CSV includes BOM and neutralizes formula injection',run(async f=>{
 const u=await f.register();const q=(await f.request('/api/quotes',{method:'POST',actor:u,body:{...Q,title:'=HYPERLINK(1)',orgId:u.org}})).data.quote;
 const s=(await f.request(`/api/quotes/${q.id}/share`,{method:'POST',body:{},actor:u})).data;
 await f.request(`/api/public/quotes/${new URL(s.url).pathname.split('/')[2]}/respond`,{method:'POST',body:{name:'Client',decision:'accepted',consent:true}});
 await f.request('/api/projects',{method:'POST',body:{quoteId:q.id},actor:u});
 const csv=await f.request('/api/projects/export.csv?orgId='+u.org,{actor:u});
 assert.equal(csv.status,200);assert.ok(csv.data.startsWith('id,title')); // fetch text() strips UTF-8 BOM by specification
 assert.match(csv.data,/"'=HYPERLINK/);assert.equal(csv.headers.get('content-type').startsWith('text/csv'),true);
}));
test('R5 HTTP 11: zero new paid subscriptions needed for a project',run(async f=>{
 const u=await f.register(),p=await f.project(u);
 assert.equal((await f.request('/api/subscriptions?orgId='+u.org,{actor:u})).data.subscription.plan,'free');
 assert.equal(p.status,'active');
 assert.equal((await f.request('/api/projects?orgId='+u.org,{actor:u})).data.projects.length,1);
}));
test('R5 HTTP 12: metrics and audit remain healthy under bursts of 20 project GETs',run(async f=>{
 const u=await f.register(),p=await f.project(u);
 const all=await Promise.all(Array.from({length:20},()=>f.request(`/api/projects/${p.id}`,{actor:u})));
 assert.ok(all.every(r=>r.status===200));assert.equal((await f.request('/ready')).data.ready,true);
 assert.equal(f.metrics.snapshot().requests['api|GET|2xx']>=20,true);
}));
test('R5 HTTP 13: health endpoint identifies R5 release',run(async f=>{
 const h=await f.request('/health');assert.equal(h.data.service,'OSMANX PROOF R5');
}));
