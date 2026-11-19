// Ephemeral HTTP acceptance: no external services, money, or disk persistence.
import {openDatabase} from '../src/db.mjs';
import {createHttpServer} from '../src/server.mjs';
import {randomBytes} from 'node:crypto';
const db=openDatabase(':memory:');
const app=createHttpServer({db,mode:'sandbox',origin:'http://osx-qa.invalid',ipSecret:'r5-acceptance-constant-for-sandbox-only-0000000',production:false});
const report={suite:'R5-HTTP-PROJECT-ACCEPTANCE',environment:'ephemeral-sqlite-and-local-http',liveMoney:false,realBrowser:false,realPostgres:false,checks:[]};
const check=(condition,label)=>{if(!condition)throw Error('FAIL: '+label);report.checks.push(label)};
let addr;
try{
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));addr=`http://127.0.0.1:${app.server.address().port}`;
 let cookie='',csrf='';
 const request=async(path,method='GET',body)=>{
  const headers={'origin':'http://osx-qa.invalid',...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie,'x-csrf-token':csrf}:{})};
  const res=await fetch(addr+path,{method,headers,body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 };
 check((await request('/health')).status===200,'server-health');
 const registration=await request('/api/auth/register','POST',{
  name:'Release Check',email:'staging-'+randomBytes(6).toString('hex')+'@qa.invalid',password:'QA-Dummy-Password-1234'});
 check(registration.status===201,'sandbox-signup');cookie=registration.cookie.split(';')[0];csrf=registration.data.csrf;
 const org=registration.data.organizations[0].id;
 const q=await request('/api/quotes','POST',{orgId:org,title:'Pilot Project',clientName:'Sample Client',items:[{description:'Site delivery',qty:1,unitPriceCents:150000,unitCostCents:30000}]});
 check(q.status===201,'quote-created');
 const shared=await request('/api/quotes/'+q.data.quote.id+'/share','POST',{});
 check(shared.status===201,'proposal-client-link');
 const quoteToken=new URL(shared.data.url).pathname.split('/')[2];
 const ack=await request('/api/public/quotes/'+quoteToken+'/respond','POST',{decision:'accepted',name:'Sample Client',consent:true});
 check(ack.status===201,'customer-accepted-quote');
 const launch=await request('/api/projects','POST',{quoteId:q.data.quote.id});
 check(launch.status===201,'accepted-quote-to-project');const id=launch.data.project.id;
 const milestone=await request('/api/projects/'+id+'/milestones','POST',{title:'Delivery review'});
 check(milestone.status===201,'delivery-milestone');const mid=milestone.data.project.milestones[0].id;
 const submission=await request(`/api/projects/${id}/milestones/${mid}/submit`,'POST',{summary:'Delivered and tested milestone'});
 check(submission.status===200,'proof-of-work-submission');
 const clientShare=await request('/api/projects/'+id+'/share','POST',{});
 check(clientShare.status===201,'client-portal-access');
 const clientToken=new URL(clientShare.data.url).pathname.split('/')[2];
 const reply=await request(`/api/public/projects/${clientToken}/milestones/${mid}/respond`,'POST',{
  name:'Sample Client',decision:'accepted',consent:true,submissionRevision:1});
 check(reply.status===201&&reply.data.projectCompleted,'client-accepted-delivery');
 const repeated=await request(`/api/public/projects/${clientToken}/milestones/${mid}/respond`,'POST',{
  name:'Sample Client',decision:'accepted',consent:true,submissionRevision:1});
 check(repeated.status===409,'duplicate-answer-blocked');
 const metrics=await request(`/api/projects/metrics?orgId=${org}`);
 check(metrics.status===200&&metrics.data.metrics.completed===1,'scoped-analytics');
 check((await request('/ready')).data.ready,'audit-and-ledger-ready');
 check(app.svc.verifyAudit().ok&&app.svc.verifyLedger().ok,'financial-and-audit-integrity');
 report.result='PASS';report.count=report.checks.length;console.log(JSON.stringify(report,null,2));
}catch(err){report.result='FAIL';report.error=String(err.message);console.error(JSON.stringify(report,null,2));process.exitCode=1}
finally{await new Promise(r=>app.server.close(r));db.close()}
