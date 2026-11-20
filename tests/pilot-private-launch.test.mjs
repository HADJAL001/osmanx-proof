import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {privatePilotSettings} from '../scripts/pilot-private-launch.mjs';
const fake={repository:resolve(tmpdir(),'osmanx-code'),home:resolve(tmpdir(),'test-osmanx-home')};
const unsafe=[
 [{HOST:'0.0.0.0'},'HOST'],[{NODE_ENV:'production'},'NODE_ENV'],
 [{PAYMENT_MODE:'sandbox'},'PAYMENT_MODE'],[{PAYMENT_MODE:'stripe_test'},'PAYMENT_MODE'],
 [{PAYOUTS_ENABLED:'1'},'payout'],[{EMAIL_TEST_MODE:'1'},'Email'],
 [{STRIPE_TEST_SECRET_KEY:'sk_test_dummy'},'provider'],[{STRIPE_TEST_WEBHOOK_SECRET:'whsec_dummy'},'provider'],
 [{TRUSTED_PROXY_IPS:'10.10.0.1'},'proxy'],[{PILOT_PORT:'80'},'PILOT_PORT'],
 [{PILOT_DATA_DIR:join(fake.repository,'data')},'Data directory'],
];
for(const [env,msg] of unsafe)test('private pilot blocks '+msg+' '+JSON.stringify(env),()=>{
 assert.throws(()=>privatePilotSettings(env,fake),new RegExp(msg,'i'));
});
test('private pilot settings force all financial and email providers off',()=>{
 const s=privatePilotSettings({PILOT_PORT:'32148'},fake);
 assert.equal(s.env.HOST,'127.0.0.1');assert.equal(s.env.NODE_ENV,'development');
 assert.equal(s.env.PAYMENT_MODE,'disabled');assert.equal(s.env.PAYOUTS_ENABLED,'0');
 assert.equal(s.env.APP_ORIGIN,'http://127.0.0.1:32148');
 assert.equal(s.dir,join(fake.home,'.local','share','osmanx-proof-private'));
});
test('private pilot runs an actual loopback HTTP server with persisted private 0600 secrets',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'osmanx-private-run-'));
 const path=join(dir,'userdata');
 const port=await new Promise((resolvePort,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolvePort(p));});});
 const child=spawn(process.execPath,['scripts/pilot-private-launch.mjs'],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),
  env:{...process.env,PILOT_DATA_DIR:path,PILOT_PORT:String(port),HOST:'127.0.0.1',PAYMENT_MODE:'disabled',PAYOUTS_ENABLED:'0',NODE_ENV:'development',STRIPE_TEST_SECRET_KEY:'',STRIPE_TEST_WEBHOOK_SECRET:'',TRUSTED_PROXY_IPS:''},
  stdio:'ignore'
 });
 try{
  let health=null,ready=null;
  for(let i=0;i<80;i++){
   try{health=await fetch(`http://127.0.0.1:${port}/health`).then(x=>x.json());ready=await fetch(`http://127.0.0.1:${port}/ready`).then(x=>x.json());if(ready.ready)break}catch{}
   await new Promise(r=>setTimeout(r,120));
  }
  assert.equal(health?.ok,true);assert.equal(ready?.ready,true);
  const entry=await fetch(`http://127.0.0.1:${port}/`).then(x=>x.text());
  assert.match(entry,/OSMANX PROOF/);
  assert.equal(statSync(join(path,'pilot-secrets.json')).mode&0o077,0);
  const secret=JSON.parse(readFileSync(join(path,'pilot-secrets.json'),'utf8'));
  assert.match(secret.IP_HASH_SECRET,/^[0-9a-f]{64}$/);
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true});}
});
