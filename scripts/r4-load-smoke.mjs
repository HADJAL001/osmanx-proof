// Local concurrency / rate-limit / consistency test. No external destination allowed.
import {createHttpServer} from '../src/server.mjs';
import {openDatabase} from '../src/db.mjs';
export async function runLoadSmoke({concurrency=80}={}){
 if(!Number.isInteger(concurrency)||concurrency<2||concurrency>200)throw Error('Concurrency out of range');
 const db=openDatabase(':memory:');const app=createHttpServer({db,mode:'disabled',origin:'http://proof.test',production:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port;
 try{
  const begun=Date.now();const probes=await Promise.all(Array.from({length:concurrency},()=>fetch(`http://127.0.0.1:${port}/health`).then(r=>r.status)));
  if(probes.some(x=>x!==200))throw Error('Health under concurrency failed');
  const logins=await Promise.all(Array.from({length:25},()=>fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',
   headers:{origin:'http://proof.test','content-type':'application/json'},body:JSON.stringify({email:'nobody@invalid.example',password:'invalid'})}).then(r=>r.status)));
  if(!logins.includes(429))throw Error('Login abuse rate limit inactive');
  const ready=await fetch(`http://127.0.0.1:${port}/ready`).then(r=>r.json());
  if(!ready.ready)throw Error('Readiness failed after concurrency');
  return {ok:true,concurrency,health200:probes.length,blockedLogin429:logins.filter(x=>x===429).length,
   durationMs:Date.now()-begun,ledgerOk:ready.ledgerOk,auditOk:ready.auditOk};
 }finally{await new Promise(r=>app.server.close(r));db.close()}
}
if(process.argv[1]?.endsWith('r4-load-smoke.mjs'))runLoadSmoke().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exitCode=1});
