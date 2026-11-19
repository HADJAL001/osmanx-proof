// R4 optional outbound transport to an operator-approved email delivery service.
// No dependency on a third-party SDK and no test token leaks to the user API.
import {createHmac} from 'node:crypto';
import {assert,HttpError} from './security.mjs';
export async function deliverVerificationEmail({url,secret,email,token,fetchFn=fetch,timeoutMs=8000}){
 let endpoint;try{endpoint=new URL(url)}catch{}
 assert(endpoint?.protocol==='https:'&&endpoint.username===''&&endpoint.password===''
  &&!['localhost','127.0.0.1','::1'].includes(endpoint.hostname)
  &&/^[a-z0-9.-]+$/i.test(endpoint.hostname),503,'Verified mail transport must use a trusted HTTPS endpoint');
 assert(typeof secret==='string'&&secret.length>=32,503,'Mail signing secret unavailable');
 assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&typeof token==='string'&&token.length>=30,422,'Invalid mail challenge');
 const payload=JSON.stringify({kind:'verify-email',email,token,expiresMinutes:30,project:'OSMANX PROOF'});
 const sig=createHmac('sha256',secret).update(payload).digest('hex');
 let response;try{response=await fetchFn(endpoint.href,{method:'POST',headers:{'content-type':'application/json','x-proof-signature':'sha256='+sig},body:payload,signal:AbortSignal.timeout(timeoutMs),redirect:'error'});}
 catch{throw new HttpError(502,'Mail delivery provider unavailable','MAIL_PROVIDER')}
 assert(response.status===202||response.status===200,502,'Mail delivery was not accepted','MAIL_PROVIDER');
 return {delivered:true,method:'APPROVED_MAIL_PROVIDER'};
}
