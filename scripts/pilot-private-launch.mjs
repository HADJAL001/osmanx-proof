// R7 noncommercial private pilot launcher. This deliberately cannot bind public IPs,
// accept production configuration or enable any payment/payout/email gateway.
import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,statSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join,sep,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const secretName='pilot-secrets.json';
const strong=()=>randomBytes(32).toString('hex');
export function privatePilotSettings(input=process.env,{home=homedir(),repository=root}={}){
 const block=(why)=>{throw new Error('Private pilot refuses unsafe configuration: '+why)};
 if(input.HOST&&!['127.0.0.1','localhost'].includes(input.HOST))block('HOST must be loopback');
 if(input.NODE_ENV==='production')block('NODE_ENV=production requires independent production release approval');
 if(input.PAYMENT_MODE&&input.PAYMENT_MODE!=='disabled')block('PAYMENT_MODE must be disabled');
 if(input.PAYOUTS_ENABLED&&input.PAYOUTS_ENABLED!=='0')block('Real payouts prohibited');
 if(input.STRIPE_TEST_SECRET_KEY||input.STRIPE_TEST_WEBHOOK_SECRET||input.MAIL_DELIVERY_URL||input.MAIL_DELIVERY_SECRET)block('Payment / email providers must be disconnected');
 if(input.EMAIL_TEST_MODE&&input.EMAIL_TEST_MODE!=='0')block('Email test mode forbidden');
 if(input.TRUSTED_PROXY_IPS)block('Trusted proxy cannot be configured in loopback-only mode');
 const port=Number(input.PILOT_PORT??input.PORT??3100);
 if(!Number.isSafeInteger(port)||port<1024||port>65535)block('PILOT_PORT out of valid range');
 const dir=resolve(input.PILOT_DATA_DIR||join(home,'.local','share','osmanx-proof-private'));
 const repo=resolve(repository);
 if(dir===repo||dir.startsWith(repo+sep)||repo.startsWith(dir+sep))block('Data directory must be outside the source-code tree');
 const database=join(dir,'pilot.sqlite');
 return {dir,port,env:{
  NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:`http://127.0.0.1:${port}`,
  DATABASE_PATH:database,PAYMENT_MODE:'disabled',PAYOUTS_ENABLED:'0',EMAIL_TEST_MODE:'0',
  TRUSTED_PROXY_IPS:'',STRIPE_TEST_SECRET_KEY:'',STRIPE_TEST_WEBHOOK_SECRET:'',
  MAIL_DELIVERY_URL:'',MAIL_DELIVERY_SECRET:'',
 }};
}
function readOrCreateSecrets(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const info=statSync(dir);if((info.mode&0o077)!==0){chmodSync(dir,0o700);}
 const path=join(dir,secretName);
 if(!existsSync(path)){
  const data=JSON.stringify({IP_HASH_SECRET:strong(),METRICS_SECRET:strong()})+'\n';
  try{writeFileSync(path,data,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 if((statSync(path).mode&0o077)!==0)throw Error('Private pilot secret permissions are too open (require 0600)');
 const o=JSON.parse(readFileSync(path,'utf8'));
 if(!/^[a-f0-9]{64}$/.test(o.IP_HASH_SECRET)||!/^[a-f0-9]{64}$/.test(o.METRICS_SECRET))throw Error('Private pilot secrets invalid');
 return o;
}
export function launchPrivatePilot(input=process.env){
 const {dir,port,env}=privatePilotSettings(input);
 const secrets=readOrCreateSecrets(dir);
 const child=spawn(process.execPath,[join(root,'src','server.mjs')],{
  cwd:root,env:{...input,...env,...secrets},stdio:'inherit'
 });
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0)});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{if(!child.killed)child.kill(sig)});
 console.log(`OSMANX private test-only pilot at http://127.0.0.1:${port} (no real money; no public listener)`);
 return {child,port,dir};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{launchPrivatePilot();}catch(e){console.error(e.message);process.exitCode=2;}
}
