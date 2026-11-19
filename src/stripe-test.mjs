// Native Stripe test-mode boundary. No Stripe SDK or credentials needed for the signed fixture tests.
// NEVER use live secrets or livemode events here.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { assert, HttpError } from './security.mjs';
const equalsHex=(given,expected)=>{
 if(!/^[a-f0-9]{64}$/i.test(given||''))return false;
 return timingSafeEqual(Buffer.from(given,'hex'),Buffer.from(expected,'hex'));
};
export function verifyStripeSignature(raw,header,secret,now=Date.now()){
 assert(typeof raw==='string'&&Buffer.byteLength(raw)<=256*1024,413,'Webhook too large');
 assert(typeof secret==='string'&&secret.startsWith('whsec_')&&secret.length>=20,503,'Stripe test webhook secret unavailable');
 const fragments=String(header||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.split('='));
 const ts=fragments.find(x=>x[0]==='t')?.[1];
 const signatures=fragments.filter(x=>x[0]==='v1').map(x=>x.slice(1).join('='));
 assert(/^\d{10}$/.test(ts||'')&&Math.abs(now/1000-Number(ts))<=300,401,'Stripe signature time invalid','STRIPE_SIGNATURE');
 const expected=createHmac('sha256',secret).update(ts+'.'+raw).digest('hex');
 assert(signatures.some(sig=>equalsHex(sig,expected)),401,'Stripe signature invalid','STRIPE_SIGNATURE');
 return true;
}
export function mapStripeTestEvent(event){
 assert(event?.livemode===false&&typeof event?.id==='string'&&event.id.startsWith('evt_'),422,'Only Stripe test-mode events accepted');
 const obj=event.data?.object;
 assert(obj&&typeof obj==='object',422,'Stripe object required');
 if(event.type==='payment_intent.succeeded'){
  assert(obj.object==='payment_intent'&&obj.status==='succeeded'&&typeof obj.id==='string'&&obj.id.startsWith('pi_'),422,'Invalid payment intent');
  assert(obj.currency==='rub'&&Number.isSafeInteger(obj.amount_received)&&obj.amount_received>0,422,'Invalid settlement amount or currency');
  assert(typeof obj.metadata?.osx_invoice_id==='string'&&obj.metadata.osx_invoice_id.length<=100,422,'Missing invoice mapping');
  return {id:event.id,type:'payment.succeeded',provider:'STRIPE_TEST',invoiceId:obj.metadata.osx_invoice_id,externalId:obj.id,amountCents:obj.amount_received,currency:'RUB'};
 }
 if((event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded')&&obj.object==='checkout.session'){
  // Do not count incomplete, unpaid or delayed checkout sessions as paid.
  if(obj.payment_status!=='paid')return null;
  assert(/^cs_test_[A-Za-z0-9_]+$/.test(obj.id||'')&&typeof obj.payment_intent==='string'&&obj.payment_intent.startsWith('pi_')
   &&obj.currency==='rub'&&Number.isSafeInteger(obj.amount_total)&&obj.amount_total>0
   &&obj.client_reference_id===obj.metadata?.osx_invoice_id,422,'Invalid completed checkout');
  return {id:event.id,type:'payment.succeeded',provider:'STRIPE_TEST',invoiceId:obj.client_reference_id,
   externalId:obj.payment_intent,amountCents:obj.amount_total,currency:'RUB',checkoutSessionId:obj.id};
 }
 if(event.type==='refund.updated'&&obj.object==='refund'&&obj.status==='succeeded'){
  assert(typeof obj.payment_intent==='string'&&obj.payment_intent.startsWith('pi_')&&typeof obj.id==='string'&&obj.id.startsWith('re_'),422,'Invalid refund mapping');
  assert(Number.isSafeInteger(obj.amount)&&obj.amount>0&&obj.currency==='rub',422,'Invalid refund amount');
  return {id:event.id,type:'payment.refunded',provider:'STRIPE_TEST',paymentExternalId:obj.payment_intent,externalId:obj.id,amountCents:obj.amount};
 }
 // Other event types may be safely acknowledged without affecting the ledger.
 return null;
}
export async function createStripeTestIntent(invoice,{secretKey,fetchFn=fetch,timeoutMs=10000}={}){
 assert(typeof secretKey==='string'&&/^sk_test_[A-Za-z0-9_-]+$/.test(secretKey)&&secretKey.length>=16,503,'Stripe test key unavailable');
 assert(invoice&&invoice.status==='issued'&&Number.isSafeInteger(invoice.total_cents)&&invoice.total_cents>0,409,'Invoice not payable');
 assert(invoice.currency==='RUB',422,'Unsupported payment currency');
 const params=new URLSearchParams({amount:String(invoice.total_cents),currency:'rub',description:`OSMANX PROOF invoice ${invoice.id}`,'metadata[osx_invoice_id]':invoice.id,'automatic_payment_methods[enabled]':'true'});
 const signal=AbortSignal.timeout(timeoutMs);
 let response;
 try{response=await fetchFn('https://api.stripe.com/v1/payment_intents',{method:'POST',headers:{authorization:`Bearer ${secretKey}`,'content-type':'application/x-www-form-urlencoded','idempotency-key':`proof-r3-invoice-${invoice.id}`},body:params,signal});}
 catch(e){throw new HttpError(502,'Stripe test provider unavailable','PROVIDER_UNAVAILABLE')}
 let result;try{result=await response.json()}catch{throw new HttpError(502,'Invalid provider response','PROVIDER_RESPONSE')}
 assert(response.ok&&result?.livemode===false&&result?.id?.startsWith('pi_')&&result?.amount===invoice.total_cents&&result?.currency==='rub'&&result?.metadata?.osx_invoice_id===invoice.id&&typeof result.client_secret==='string',502,'Stripe test intent response invalid','PROVIDER_RESPONSE');
 return {provider:'STRIPE_TEST',intentId:result.id,clientSecret:result.client_secret,amountCents:result.amount,currency:'RUB',testOnly:true};
}


// R4: hosted checkout, no card collection or live-mode SDK. Creation never books a payment.
export async function createStripeTestCheckout(invoice,{secretKey,fetchFn=fetch,origin,timeoutMs=10000}={}){
 assert(typeof secretKey==='string'&&/^sk_test_[A-Za-z0-9_-]{8,}$/.test(secretKey),503,'Test provider key unavailable');
 assert(invoice?.status==='issued'&&Number.isSafeInteger(invoice.total_cents)&&invoice.total_cents>0&&invoice.currency==='RUB',409,'Invoice not payable');
 assert(typeof origin==='string'&&(/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(origin)||/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)),422,'Trusted checkout origin required');
 const body=new URLSearchParams({mode:'payment',client_reference_id:invoice.id,
  success_url:`${origin}/app?checkout=success`,cancel_url:`${origin}/app?checkout=cancelled`,
  'line_items[0][price_data][currency]':'rub','line_items[0][price_data][unit_amount]':String(invoice.total_cents),
  'line_items[0][price_data][product_data][name]':'OSMANX PROOF Pro — 1 month',
  'line_items[0][quantity]':'1','metadata[osx_invoice_id]':invoice.id,
  'payment_intent_data[metadata][osx_invoice_id]':invoice.id});
 let response;
 try{response=await fetchFn('https://api.stripe.com/v1/checkout/sessions',{method:'POST',
  headers:{authorization:`Bearer ${secretKey}`,'content-type':'application/x-www-form-urlencoded',
   'idempotency-key':`proof-r4-checkout-${invoice.id}`},body,signal:AbortSignal.timeout(timeoutMs)});
 }catch{throw new HttpError(502,'Test checkout provider unavailable','PROVIDER_UNAVAILABLE')}
 let result;try{result=await response.json()}catch{throw new HttpError(502,'Invalid checkout response','PROVIDER_RESPONSE')}
 let url;try{url=new URL(result?.url)}catch{}
 assert(response.ok&&result?.livemode===false&&/^cs_test_[A-Za-z0-9_]+$/.test(result?.id||'')
  &&url?.protocol==='https:'&&url.hostname==='checkout.stripe.com'&&url.username===''&&url.password===''
  &&result.amount_total===invoice.total_cents&&result.currency==='rub'&&result.client_reference_id===invoice.id,
  502,'Untrusted checkout result','PROVIDER_RESPONSE');
 return {provider:'STRIPE_TEST',sessionId:result.id,url:url.toString(),amountCents:invoice.total_cents,currency:'RUB',testOnly:true};
}

// Independent test-provider read-only reconciliation. Never modifies subscription or ledger.
export async function verifyStripeTestSettlement(payment,{secretKey,fetchFn=fetch,timeoutMs=10000}={}){
 assert(typeof secretKey==='string'&&/^sk_test_[A-Za-z0-9_-]{8,}$/.test(secretKey),503,'Test key unavailable');
 assert(payment?.provider==='STRIPE_TEST'&&/^pi_[A-Za-z0-9_]+$/.test(payment.external_id||''),422,'Stripe test payment required');
 const call=async(url)=>{
  let response;try{response=await fetchFn(url,{headers:{authorization:`Bearer ${secretKey}`},signal:AbortSignal.timeout(timeoutMs)})}catch{throw new HttpError(502,'Provider reconciliation unavailable','PROVIDER_UNAVAILABLE')}
  let data;try{data=await response.json()}catch{throw new HttpError(502,'Provider response invalid','PROVIDER_RESPONSE')}
  assert(response.ok&&data?.livemode!==true,502,'Provider verification rejected','PROVIDER_RESPONSE');return data;
 };
 const intent=await call('https://api.stripe.com/v1/payment_intents/'+encodeURIComponent(payment.external_id));
 const report=await call('https://api.stripe.com/v1/refunds?payment_intent='+encodeURIComponent(payment.external_id)+'&limit=100');
 assert(intent.livemode===false&&intent.id===payment.external_id&&intent.currency==='rub'&&
  Number.isSafeInteger(intent.amount_received)&&Array.isArray(report.data)&&report.has_more===false,
  502,'Unverifiable provider evidence','PROVIDER_RESPONSE');
 const refunds=report.data.filter(r=>r.status==='succeeded');
 assert(refunds.every(r=>r.payment_intent===payment.external_id&&r.currency==='rub'&&Number.isSafeInteger(r.amount)&&r.amount>0),502,'Refund evidence invalid','PROVIDER_RESPONSE');
 const remoteRefunded=refunds.reduce((n,r)=>n+r.amount,0);
 const remotePaid=intent.status==='succeeded'&&intent.amount_received===payment.amount_cents;
 const matches=remotePaid&&remoteRefunded===payment.refunded_cents;
 return {provider:'STRIPE_TEST',externalId:payment.external_id,invoiceId:payment.invoice_id,
  amountCents:payment.amount_cents,localRefundedCents:payment.refunded_cents,
  providerAmountCents:intent.amount_received,providerRefundedCents:remoteRefunded,
  refundCount:refunds.length,matches,readOnly:true,testOnly:true};
}
