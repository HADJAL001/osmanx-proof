import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {createServices} from '../src/services.mjs';
import {createHttpServer} from '../src/server.mjs';
import {scanAttestation,MAX_EVIDENCE_BYTES} from '../src/evidence.mjs';

const KEY='12'.repeat(32),SCAN='scanner-independent-hmac-key-1234567890ABCDEFGHI';
const Q={title:'Website delivery R6',clientName:'Example Client',clientEmail:'customer@test.invalid',items:[{description:'Website',qty:1,unitPriceCents:120000,unitCostCents:40000}]};
const txt=Buffer.from('R6: independently testable proof of delivered work.');
const makeBody=(raw=txt)=>({fileName:'proof.txt',mime:'text/plain',contentBase64:raw.toString('base64')});
async function fixture({vaultKey=KEY,scanKey=SCAN}={}){
 const temp=mkdtempSync(join(tmpdir(),'osx-r6-evidence-'));
 const db=openDatabase(':memory:');
 const instance=createHttpServer({db,mode:'sandbox',origin:'http://proof.test',production:false,evidenceKey:vaultKey,scannerSecret:scanKey,evidenceDir:temp,ipSecret:'0123456789abcdef'.repeat(4)});
 await new Promise(ok=>instance.server.listen(0,'127.0.0.1',ok));
 const base=`http://127.0.0.1:${instance.server.address().port}`;
 let index=0;
 async function request(path,{actor,method='GET',body,origin='http://proof.test'}={}){
  const r=await fetch(base+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(origin?{origin}:{}),...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const mime=r.headers.get('content-type')||'';
  const content=mime.startsWith('application/json')?await r.json():await r.arrayBuffer();
  return {status:r.status,body:content,headers:r.headers};
 }
 const register=async()=>{
  const email=`evidence-${++index}@test.invalid`;
  const r=await request('/api/auth/register',{method:'POST',body:{name:'Evidence Tester',email,password:'Secure123456987Password!'}});
  assert.equal(r.status,201,JSON.stringify(r.body));
  return {id:r.body.user.id,email,org:r.body.organizations[0].id,csrf:r.body.csrf,cookie:r.headers.get('set-cookie').split(';')[0]};
 };
 const project=async actor=>{
  const q=(await request('/api/quotes',{method:'POST',actor,body:{...Q,orgId:actor.org}})).body.quote;
  const s=(await request(`/api/quotes/${q.id}/share`,{method:'POST',actor,body:{}})).body;
  const tok=s.url.split('/').at(-1);
  assert.equal((await request(`/api/public/quotes/${tok}/respond`,{method:'POST',body:{name:'External Client',decision:'accepted',consent:true}})).status,201);
  const p=(await request('/api/projects',{method:'POST',actor,body:{quoteId:q.id}})).body.project;
  const m=(await request(`/api/projects/${p.id}/milestones`,{method:'POST',actor,body:{title:'Final delivery'}})).body.project.milestones[0];
  return {p,m};
 };
 const upload=async(actor,p,m,data=makeBody())=>request(`/api/projects/${p.id}/milestones/${m.id}/evidence`,{actor,method:'POST',body:data});
 const scan=async(actor,id,digest,verdict='clean',engine='independent-scanner-v1')=>request(`/api/admin/evidence/${id}/scan`,{actor,method:'POST',body:{verdict,engine,attestation:scanAttestation(SCAN,{id,digest,verdict,engine})}});
 const share=async(actor,p)=>{
  const r=await request(`/api/projects/${p.id}/share`,{actor,method:'POST',body:{}});
  return {token:r.body.url.split('/').at(-1),id:r.body.shareId};
 };
 return {temp,db,svc:instance.svc,base,request,register,project,upload,scan,share,
  async close(){await new Promise(ok=>instance.server.close(ok));db.close();rmSync(temp,{recursive:true,force:true})}};
}
const scenario=fn=>async()=>{const f=await fixture();try{await fn(f)}finally{await f.close()}};

test('R6 01: encrypted file is quarantined; no raw bytes stored on disk',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 const r=await f.upload(a,p,m);assert.equal(r.status,201,JSON.stringify(r.body));
 const evidence=r.body.evidence;assert.equal(evidence.status,'quarantined');
 const stored=readFileSync(join(f.temp,evidence.id+'.vault'));
 assert.notEqual(stored.subarray(0,txt.length).toString(),txt.toString());
 assert.equal(stored.length,txt.length+28);
 const download=await f.request(`/api/projects/${p.id}/evidence/${evidence.id}`,{actor:a});assert.equal(download.status,403);
 assert.equal((await f.request('/ready')).status,200);
}));
test('R6 02: content type sniffing, extension and canonical base64',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 assert.equal((await f.upload(a,p,m,{...makeBody(),mime:'application/pdf'})).status,415);
 assert.equal((await f.upload(a,p,m,{...makeBody(),fileName:'proof.exe'})).status,415);
 assert.equal((await f.upload(a,p,m,{...makeBody(),contentBase64:'not-base64%'})).status,422);
 assert.equal((await f.upload(a,p,m,makeBody(Buffer.from([0,1,2,3])))).status,415);
 assert.equal((await f.upload(a,p,m,{...makeBody(),fileName:'proof.svg'})).status,415);
}));
test('R6 03: no scan without independent signed attestation',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),r=await f.upload(a,p,m);
 const id=r.body.evidence.id,digest=r.body.evidence.sha256;
 const fake=await f.request(`/api/admin/evidence/${id}/scan`,{actor:a,method:'POST',body:{verdict:'clean',engine:'good-scanner',attestation:'0'.repeat(64)}});
 assert.equal(fake.status,403);
 f.svc.setAdmin(a.email);
 const bad=await f.request(`/api/admin/evidence/${id}/scan`,{actor:a,method:'POST',body:{verdict:'clean',engine:'good-scanner',attestation:'f'.repeat(64)}});
 assert.equal(bad.status,403);
 assert.equal((await f.scan(a,id,digest)).status,200);
 assert.equal((await f.scan(a,id,digest)).status,409);
}));
test('R6 04: admin can quarantine-reject, but rejected evidence cannot be delivered',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);f.svc.setAdmin(a.email);
 const r=await f.upload(a,p,m);assert.equal((await f.scan(a,r.body.evidence.id,r.body.evidence.sha256,'infected')).status,200);
 const s=await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'Project is complete and verified',evidenceIds:[r.body.evidence.id]}});
 assert.equal(s.status,409);
 assert.equal((await f.request(`/api/projects/${p.id}/evidence/${r.body.evidence.id}`,{actor:a})).status,403);
}));
test('R6 05: clear -> submit -> public download -> accepted receipt',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),r=await f.upload(a,p,m),e=r.body.evidence;
 f.svc.setAdmin(a.email);assert.equal((await f.scan(a,e.id,e.sha256)).status,200);
 const s=await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'Website completed successfully',evidenceIds:[e.id]}});
 assert.equal(s.status,200,JSON.stringify(s.body));
 const shared=await f.share(a,p);const path=`/api/public/projects/${shared.token}/evidence/${e.id}`;
 const dl=await f.request(path,{origin:null});assert.equal(dl.status,200);assert.equal(Buffer.from(dl.body).toString(),txt.toString());
 assert.match(dl.headers.get('content-disposition'),/attachment; filename=/);assert.equal(dl.headers.get('cache-control'),'private, no-store');
 const html=await f.request(`/c/${shared.token}`);assert.equal(html.status,200);
 assert.match(Buffer.from(html.body).toString(),new RegExp(e.id));
 assert.equal((await f.request(`/api/public/projects/${shared.token}/milestones/${m.id}/receipt`)).status,404);
 assert.equal((await f.request(`/api/public/projects/${shared.token}/milestones/${m.id}/respond`,{method:'POST',body:{name:'Customer',decision:'accepted',submissionRevision:1,consent:true}})).status,201);
 const receipt=await f.request(`/api/public/projects/${shared.token}/milestones/${m.id}/receipt`);
 assert.equal(receipt.status,200);assert.equal(receipt.body.verified,true);
 assert.deepEqual(receipt.body.receipt.attachments,[{id:e.id,sha256:e.sha256,size:e.size}]);
 assert.equal((await f.request(`/api/projects/${p.id}/milestones/${m.id}/receipt`,{actor:a})).status,200);
}));
test('R6 06: cross-organization, unauthenticated and CSRF writes are blocked',scenario(async f=>{
 const a=await f.register(),b=await f.register(),{p,m}=await f.project(a);
 const path=`/api/projects/${p.id}/milestones/${m.id}/evidence`;
 assert.equal((await f.request(path,{method:'POST',body:makeBody()})).status,401);
 assert.equal((await f.request(path,{actor:b,method:'POST',body:makeBody()})).status,403);
 assert.equal((await f.request(path,{actor:a,method:'POST',body:makeBody(),origin:'https://attacker.test'})).status,403);
 assert.equal((await f.request(path,{actor:b})).status,403);
}));
test('R6 07: stale and wrong project client links do not disclose evidence',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;f.svc.setAdmin(a.email);await f.scan(a,e.id,e.sha256);
 await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'Completed all agreed tasks',evidenceIds:[e.id]}});
 const original=await f.share(a,p),newShare=await f.share(a,p);
 assert.equal((await f.request(`/api/public/projects/${original.token}/evidence/${e.id}`)).status,404);
 assert.equal((await f.request(`/api/public/projects/${newShare.token}/evidence/${e.id}`)).status,200);
 const b=await f.register(),other=await f.project(b),otherShare=await f.share(b,other.p);
 assert.equal((await f.request(`/api/public/projects/${otherShare.token}/evidence/${e.id}`)).status,404);
 assert.equal((await f.request(`/api/public/projects/${newShare.token}/evidence/not-real`)).status,404);
}));
test('R6 08: revoking cleared evidence removes client and internal read access',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;f.svc.setAdmin(a.email);await f.scan(a,e.id,e.sha256);
 const s=await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'Finished agreed website tasks',evidenceIds:[e.id]}});assert.equal(s.status,200);
 const shared=await f.share(a,p),link=`/api/public/projects/${shared.token}/evidence/${e.id}`;
 assert.equal((await f.request(link)).status,200);
 assert.equal((await f.request(`/api/projects/${p.id}/evidence/${e.id}`,{actor:a,method:'POST',body:{reason:'Security incident: content may be invalid'}})).status,200);
 assert.equal((await f.request(link)).status,404);
 assert.equal((await f.request(`/api/projects/${p.id}/evidence/${e.id}`,{actor:a})).status,403);
 assert.equal(f.svc.verifyAudit().ok,true);
}));
test('R6 09: tamper detection fails closed, including malicious symlinks',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;f.svc.setAdmin(a.email);await f.scan(a,e.id,e.sha256);
 const file=join(f.temp,e.id+'.vault'),raw=readFileSync(file);raw[32]^=0x10;writeFileSync(file,raw);
 assert.equal((await f.request(`/api/projects/${p.id}/evidence/${e.id}`,{actor:a})).status,409);
 unlinkSync(file);symlinkSync('/etc/passwd',file);
 assert.equal((await f.request(`/api/projects/${p.id}/evidence/${e.id}`,{actor:a})).status,409);
}));
test('R6 10: no R6 vault key means upload is disabled, not plain-text fallback',async()=>{
 const f=await fixture({vaultKey:''});try{const a=await f.register(),{p,m}=await f.project(a);const r=await f.upload(a,p,m);assert.equal(r.status,503);assert.equal(existsSync(f.temp),true)}finally{await f.close()}
});
test('R6 11: bound evidence cannot be changed during revision without re-scanning',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;f.svc.setAdmin(a.email);await f.scan(a,e.id,e.sha256);
 await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'First delivery with attachment',evidenceIds:[e.id]}});
 const share=await f.share(a,p);await f.request(`/api/public/projects/${share.token}/milestones/${m.id}/respond`,{method:'POST',body:{name:'Client',decision:'changes_requested',message:'Please revise the final graphics',consent:true,submissionRevision:1}});
 const newEvidence=(await f.upload(a,p,m)).body.evidence;
 assert.equal((await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'Second revision of work completed',evidenceIds:[newEvidence.id]}})).status,409);
 assert.equal((await f.request(`/api/public/projects/${share.token}/evidence/${e.id}`)).status,404);
}));
test('R6 12: valid text content upper bound and corrupt large payload are refused',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 assert.equal((await f.upload(a,p,m,makeBody(Buffer.alloc(MAX_EVIDENCE_BYTES+1,65)))).status,413);
 const r=await f.upload(a,p,m,{fileName:'notes.txt',mime:'text/plain',contentBase64:'AA=='});assert.equal(r.status,415);
}));

test('R6 13: quarantine queue and encrypted vault verification require administrator role',scenario(async f=>{
 const a=await f.register(),b=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;
 assert.equal((await f.request('/api/admin/evidence/quarantine',{actor:a})).status,403);
 assert.equal((await f.request('/api/admin/evidence/integrity',{actor:a})).status,403);
 f.svc.setAdmin(b.email);
 const queue=await f.request('/api/admin/evidence/quarantine?limit=5',{actor:b});
 assert.equal(queue.status,200);assert.equal(queue.body.queue.length,1);assert.equal(queue.body.queue[0].id,e.id);
 assert.equal((await f.request('/api/admin/evidence/quarantine?limit=101',{actor:b})).status,422);
 const integrity=await f.request('/api/admin/evidence/integrity',{actor:b});
 assert.equal(integrity.status,200);assert.equal(integrity.body.verified,1);
 assert.equal((await f.request('/api/admin/evidence/integrity',{actor:b})).status,200);
 assert.equal((await f.request('/api/admin/evidence/integrity',{actor:b})).status,429);
}));
test('R6 14: JPG and PNG uploads use detected MIME rather than user filename',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('R6 image data')]);
 const jpg=Buffer.concat([Buffer.from([255,216,255]),Buffer.from('R6 image data')]);
 const first=await f.upload(a,p,m,{fileName:'preview.png',mime:'image/png',contentBase64:png.toString('base64')});
 const second=await f.upload(a,p,m,{fileName:'photo.jpeg',mime:'image/jpeg',contentBase64:jpg.toString('base64')});
 assert.equal(first.status,201);assert.equal(second.status,201);
 assert.equal(first.body.evidence.mime,'image/png');assert.equal(second.body.evidence.mime,'image/jpeg');
 assert.equal((await f.upload(a,p,m,{fileName:'tricked.png',mime:'image/png',contentBase64:jpg.toString('base64')})).status,415);
}));
test('R6 15: acceptance receipt is bound to its immutable JSON and attachment manifest',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;
 f.svc.setAdmin(a.email);await f.scan(a,e.id,e.sha256);
 await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'Ready for client acceptance',evidenceIds:[e.id]}});
 const share=await f.share(a,p);
 await f.request(`/api/public/projects/${share.token}/milestones/${m.id}/respond`,{method:'POST',body:{name:'Client',decision:'accepted',consent:true,submissionRevision:1}});
 assert.equal((await f.request(`/api/projects/${p.id}/milestones/${m.id}/receipt`,{actor:a})).status,200);
 f.db.prepare("UPDATE work_acceptance_receipts SET receipt_json='{}' WHERE project_id=?").run(p.id);
 assert.equal((await f.request(`/api/projects/${p.id}/milestones/${m.id}/receipt`,{actor:a})).status,409);
}));
test('R6 16: filename traversal and control sequences cannot leak into download headers',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 const e=(await f.upload(a,p,m,{...makeBody(),fileName:'../../path/to/final proof.txt'})).body.evidence;
 assert.equal(e.fileName,'final proof.txt');f.svc.setAdmin(a.email);await f.scan(a,e.id,e.sha256);
 const dl=await f.request(`/api/projects/${p.id}/evidence/${e.id}`,{actor:a});
 assert.equal(dl.status,200);assert.equal(dl.headers.get('content-disposition'),'attachment; filename="final_proof.txt"');
 assert.equal(dl.headers.get('x-content-type-options'),'nosniff');
}));
test('R6 17: scanner key is mandatory even for administrator',async()=>{
 const f=await fixture({scanKey:''});try{
  const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;
  f.svc.setAdmin(a.email);assert.equal((await f.scan(a,e.id,e.sha256)).status,503);
 }finally{await f.close()}
});
test('R6 18: uploads are locked once a submission is awaiting response',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 await f.request(`/api/projects/${p.id}/milestones/${m.id}/submit`,{actor:a,method:'POST',body:{summary:'First complete client draft submitted'}});
 assert.equal((await f.upload(a,p,m)).status,409);
}));
test('R6 19: evidence cap is enforced within a single milestone',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a);
 for(let i=0;i<15;i++){const r=await f.upload(a,p,m,{...makeBody(),fileName:`test-${i}.txt`});assert.equal(r.status,201)}
 assert.equal((await f.upload(a,p,m)).status,409);
 assert.equal((await f.request(`/api/projects/${p.id}/milestones/${m.id}/evidence`,{actor:a})).body.evidence.length,15);
}));
test('R6 20: no plaintext attachment is stored in SQLite tables or audit metadata',scenario(async f=>{
 const a=await f.register(),{p,m}=await f.project(a),e=(await f.upload(a,p,m)).body.evidence;
 const row=f.db.prepare('SELECT * FROM work_evidence WHERE id=?').get(e.id);
 assert.equal(JSON.stringify(row).includes(txt.toString()),false);
 const audits=f.db.prepare("SELECT metadata_json FROM audit_events WHERE action='work.evidence.uploaded'").all();
 assert.equal(audits.length,1);assert.equal(audits[0].metadata_json.includes(txt.toString()),false);
}));
