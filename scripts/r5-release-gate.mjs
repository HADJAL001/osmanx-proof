// Refuse production until an external CI runner has produced verifiable evidence.
import {isIP} from 'node:net';
const long=s=>typeof s==='string'&&s.length>=32;
const truth=v=>v===true;
export function evaluateR5Gate(env=process.env,evidence={}){
 const failures=[];const requireIt=(condition,message)=>{if(!condition)failures.push(message)};
 requireIt(env.NODE_ENV==='production','NODE_ENV must be production');
 requireIt(/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(env.APP_ORIGIN||''),'Public HTTPS origin required');
 requireIt(env.PAYMENT_MODE==='disabled','Unreviewed payments must be disabled');
 requireIt(env.PAYOUTS_ENABLED!=='1','Real payouts must remain disabled');
 requireIt(env.EMAIL_TEST_MODE!=='1','Test-only emails are not allowed');
 requireIt(!env.STRIPE_TEST_SECRET_KEY&&!env.STRIPE_TEST_WEBHOOK_SECRET,'Stripe test secrets not allowed on public staging');
 requireIt(long(env.METRICS_SECRET)&&long(env.IP_HASH_SECRET),'Strong independent operational secrets required');
 requireIt(env.DATABASE_BACKEND==='postgres','SQLite runtime is not production approved');
 requireIt(typeof env.DATABASE_URL==='string'&&/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL),'Real PostgreSQL connection required');
 requireIt(env.TLS_TERMINATION_VERIFIED==='1','TLS termination confirmation missing');
 requireIt(!!env.OFFSITE_BACKUP_DESTINATION,'Encrypted offsite backups required');
 let backupKey;try{backupKey=Buffer.from(env.BACKUP_ENCRYPTION_KEY||'','base64')}catch{backupKey=Buffer.alloc(0)}
 requireIt(backupKey.length===32,'256-bit encrypted backup key required');
 requireIt(typeof env.TRUSTED_PROXY_IPS==='string'&&env.TRUSTED_PROXY_IPS.split(',').some(x=>isIP(x.trim())),'Trusted upstream proxy allowlist required');
 for(const [key,message] of Object.entries({
  nodeTestsPassed:'Current backend tests not verified',nextProductionBuildPassed:'Next.js production build not verified',
  browserE2EPassed:'Real browser E2E not verified',postgresRlSVerified:'Live PostgreSQL tenant policies not verified',
  postgresParityVerified:'Live PostgreSQL data content parity not verified',encryptedRestorePassed:'Encrypted restore not verified',
  stripeTestReconciliationPassed:'Independent TEST provider reconciliation not verified',
  securityReviewPassed:'External security review not verified',legalReviewPassed:'Legal review not verified',
  deploymentSmokePassed:'TLS staging deployment smoke not verified'}))requireIt(truth(evidence[key]),message);
 requireIt(/^[a-f0-9]{40}$/.test(evidence.commitSha||''),'Immutable full commit SHA required');
 return {release:'R5',eligible:failures.length===0,failures,realPayments:false,realPayouts:false};
}
if(process.argv[1]?.endsWith('r5-release-gate.mjs')){
 const result=evaluateR5Gate();console.log(JSON.stringify(result,null,2));if(!result.eligible)process.exitCode=1;
}
