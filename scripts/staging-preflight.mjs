import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function preflight(env=process.env){
 const errors=[];
 if(Number(process.versions.node.split('.')[0])<22)errors.push('Node.js >= 22 required');
 if(env.NODE_ENV!=='production')errors.push('NODE_ENV=production required');
 if(!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(env.APP_ORIGIN||''))errors.push('APP_ORIGIN must be a public HTTPS origin');
 if((env.IP_HASH_SECRET||'').length<32)errors.push('IP_HASH_SECRET must be >=32 chars');
 if((env.METRICS_SECRET||'').length<32)errors.push('METRICS_SECRET must be >=32 chars');
 if((env.PAYMENT_MODE||'disabled')!=='disabled')errors.push('Payments must remain disabled in staging until approved');
 if(env.EMAIL_TEST_MODE==='1')errors.push('EMAIL_TEST_MODE forbidden for staging');
 if(env.STRIPE_TEST_SECRET_KEY||env.STRIPE_TEST_WEBHOOK_SECRET)errors.push('Do not expose test provider credentials to disabled staging');
 return {ok:errors.length===0,errors,release:'R4',realPayments:false,realPayouts:false};
}
if(process.argv[1]?.endsWith('staging-preflight.mjs')){
 const result=preflight();console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
