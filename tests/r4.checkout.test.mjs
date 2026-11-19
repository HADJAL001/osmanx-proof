import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {createHttpServer} from '../src/server.mjs';
import {createStripeTestCheckout,verifyStripeTestSettlement,mapStripeTestEvent} from '../src/stripe-test.mjs';
const secret='whsec_testing_r4_checkout_signature_123456';
const key='sk_test_for_local_stub_only_123456';
const sign=raw=>{const t=Math.floor(Date.now()/1000);return `t=${t},v1=${createHmac('sha256',secret).update(t+'.'+raw).digest('hex')}`};
const success=(inv,id='evt_r4_checkout_paid_0001',sess='cs_test_proof001')=>({id,type:'checkout.session.completed',livemode:false,data:{object:{object:'checkout.session',id:sess,client_reference_id:inv.id,metadata:{osx_invoice_id:inv.id},payment_intent:'pi_r4_paid001',currency:'rub',amount_total:inv.total_cents,payment_status:'paid'}}});
async function fixture({refund=0}={}){
 const db=openDatabase(':memory:');
 const fetchFn=async(url,opt)=>{
  if(String(url).includes('/checkout/sessions'))return {ok:true,json:async()=>({id:'cs_test_proof001',url:'https://checkout.stripe.com/c/pay/cs_test_proof001',livemode:false,amount_total:Number(opt.body.get('line_items[0][price_data][unit_amount]')),currency:'rub',client_reference_id:opt.body.get('client_reference_id')})};
  if(String(url).includes('/payment_intents/'))return {ok:true,json:async()=>({id:'pi_r4_paid001',livemode:false,status:'succeeded',amount_received:129000,currency:'rub'})};
  if(String(url).includes('/refunds?'))return {ok:true,json:async()=>({data:refund?[{id:'re_r4_refund_01',payment_intent:'pi_r4_paid001',amount:refund,currency:'rub',status:'succeeded'}]:[],has_more:false})};
  throw Error('Unexpected fake provider URL: '+url);
 };
 const app=createHttpServer({db,mode:'stripe_test',stripeWebhookSecret:secret,stripeSecretKey:key,stripeFetch:fetchFn,origin:'https://proof.test',production:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 const send=async(path,{method='GET',body,sess,headers={}}={})=>{
  const r=await fetch(base+path,{method,headers:{origin:'https://proof.test',...(body?{'content-type':'application/json'}:{}),...(sess?{cookie:sess.cookie,'x-csrf-token':sess.csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const reg=await send('/api/auth/register',{method:'POST',body:{name:'R4 Owner',email:'r4-owner@example.test',password:'long_password_45678'}});
 const owner={id:reg.data.user.id,org:reg.data.organizations[0].id,cookie:reg.cookie,csrf:reg.data.csrf};
 const invoice=async()=> (await send('/api/invoices',{method:'POST',body:{orgId:owner.org},sess:owner})).data.invoice;
 const webhook=async(ev)=>{const raw=JSON.stringify(ev),r=await fetch(base+'/api/webhooks/stripe-test',{method:'POST',headers:{'stripe-signature':sign(raw)},body:raw});return {status:r.status,data:await r.json()}};
 return {db,app,base,owner,send,invoice,webhook,close:async()=>{await new Promise(r=>app.server.close(r));db.close()}};
}
test('R4 CHECKOUT 01: hosted checkout never collects card data and uses invoice idempotency',async()=>{
 const invoice={id:'invoice_r4_001',status:'issued',total_cents:123000,currency:'RUB'};let called;
 const result=await createStripeTestCheckout(invoice,{secretKey:key,origin:'https://proof.test',fetchFn:async(u,o)=>{called={u,o};return {ok:true,json:async()=>({id:'cs_test_001',url:'https://checkout.stripe.com/c/pay/cs_test_001',livemode:false,amount_total:123000,currency:'rub',client_reference_id:invoice.id})}}});
 assert.equal(result.testOnly,true);assert.equal(result.amountCents,123000);assert.equal(called.o.body.get('mode'),'payment');
 assert.equal(called.o.body.get('payment_intent_data[metadata][osx_invoice_id]'),invoice.id);
 assert.equal(called.o.headers['idempotency-key'],'proof-r4-checkout-'+invoice.id);
 assert.equal(called.o.body.get('success_url'),'https://proof.test/app?checkout=success');
});
test('R4 CHECKOUT 02: rejects live secret, spoofed checkout URL and wrong amount',async()=>{
 const inv={id:'invoice_1',status:'issued',total_cents:12300,currency:'RUB'};
 await assert.rejects(()=>createStripeTestCheckout(inv,{secretKey:'sk_live_never_allowed',origin:'https://proof.test'}),e=>e.status===503);
 for(const bad of [{url:'https://checkout.stripe.com.evil.org/c/pay/test',amount_total:12300},{url:'https://checkout.stripe.com/c/pay/cs_test_one',amount_total:12301}])
 await assert.rejects(()=>createStripeTestCheckout(inv,{secretKey:key,origin:'https://proof.test',fetchFn:async()=>({ok:true,json:async()=>({id:'cs_test_one',livemode:false,client_reference_id:inv.id,currency:'rub',...bad})})}),e=>e.status===502);
});
test('R4 CHECKOUT 03: unpaid checkout event is ignored',()=>{
 const inv={id:'invoice_one',total_cents:1234};const ev=success(inv);ev.data.object.payment_status='unpaid';assert.equal(mapStripeTestEvent(ev),null);
});
test('R4 CHECKOUT 04: a signed unregistered checkout cannot credit an invoice',async()=>{
 const f=await fixture();try{const inv=await f.invoice(),r=await f.webhook(success(inv));assert.equal(r.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0)}finally{await f.close()}
});
test('R4 CHECKOUT 05: bound signed checkout books payment only once across event IDs',async()=>{
 const f=await fixture();try{const inv=await f.invoice();const checkout=await f.send('/api/billing/stripe-test/checkout',{method:'POST',body:{invoiceId:inv.id},sess:f.owner});
 assert.equal(checkout.status,200);assert.equal(checkout.data.checkout.testOnly,true);
 const one=await f.webhook(success(inv));const two=await f.webhook(success(inv,'evt_r4_checkout_paid_0002'));
 assert.equal(one.status,200);assert.equal(two.status,200);assert.equal(two.data.duplicate,true);
 assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,1);assert.equal(f.app.svc.verifyLedger().ok,true);
 }finally{await f.close()}
});
test('R4 CHECKOUT 06: wrong checkout session is rejected',async()=>{
 const f=await fixture();try{const inv=await f.invoice();await f.send('/api/billing/stripe-test/checkout',{method:'POST',body:{invoiceId:inv.id},sess:f.owner});
 assert.equal((await f.webhook(success(inv,'evt_r4_wrong_sess_01','cs_test_wrong'))).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
 }finally{await f.close()}
});
test('R4 CHECKOUT 07: another user cannot create a hosted checkout for someone else',async()=>{
 const f=await fixture();try{const inv=await f.invoice();const r=await f.send('/api/auth/register',{method:'POST',body:{name:'Wrong Owner',email:'other_r4@example.test',password:'long_password_9876'}});
 const other={cookie:r.cookie,csrf:r.data.csrf};assert.equal((await f.send('/api/billing/stripe-test/checkout',{method:'POST',body:{invoiceId:inv.id},sess:other})).status,404);
 }finally{await f.close()}
});
test('R4 CHECKOUT 08: full refund is idempotent even with another signed event ID',async()=>{
 const f=await fixture();try{const inv=await f.invoice();await f.send('/api/billing/stripe-test/checkout',{method:'POST',body:{invoiceId:inv.id},sess:f.owner});await f.webhook(success(inv));
 const refund=(id)=>({id,type:'refund.updated',livemode:false,data:{object:{object:'refund',id:'re_r4_fully_refunded',status:'succeeded',payment_intent:'pi_r4_paid001',amount:inv.total_cents,currency:'rub'}}});
 assert.equal((await f.webhook(refund('evt_r4_ref_001'))).status,200);
 assert.equal((await f.webhook(refund('evt_r4_ref_002'))).status,200);
 assert.equal(f.db.prepare('SELECT count(*) n FROM refunds').get().n,1);
 assert.equal(f.app.svc.verifyLedger().ok,true);
 }finally{await f.close()}
});
test('R4 CHECKOUT 09: an independently checked test provider report is read-only',async()=>{
 const f=await fixture();try{const inv=await f.invoice();await f.send('/api/billing/stripe-test/checkout',{method:'POST',body:{invoiceId:inv.id},sess:f.owner});await f.webhook(success(inv));
 f.app.svc.setAdmin('r4-owner@example.test');
 const r=await f.send('/api/admin/provider/stripe-test/verify',{method:'POST',body:{paymentExternalId:'pi_r4_paid001'},sess:f.owner});
 assert.equal(r.status,200);assert.equal(r.data.verification.matches,true);assert.equal(r.data.verification.readOnly,true);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM provider_verification_reports').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
 }finally{await f.close()}
});
test('R4 CHECKOUT 10: remote refund disagreement is flagged, never silently repaired',async()=>{
 const f=await fixture({refund:10000});try{const inv=await f.invoice();await f.send('/api/billing/stripe-test/checkout',{method:'POST',body:{invoiceId:inv.id},sess:f.owner});await f.webhook(success(inv));
 f.app.svc.setAdmin('r4-owner@example.test');const r=await f.send('/api/admin/provider/stripe-test/verify',{method:'POST',body:{paymentExternalId:'pi_r4_paid001'},sess:f.owner});
 assert.equal(r.status,200);assert.equal(r.data.verification.matches,false);assert.equal(r.data.verification.providerRefundedCents,10000);
 assert.equal(f.db.prepare('SELECT refunded_cents FROM payments').get().refunded_cents,0);
 }finally{await f.close()}
});
test('R4 CHECKOUT 11: provider reconciliation refuses paginated, incomplete refund evidence',async()=>{
 await assert.rejects(()=>verifyStripeTestSettlement({provider:'STRIPE_TEST',external_id:'pi_safe',invoice_id:'inv',amount_cents:100,refunded_cents:0},{secretKey:key,fetchFn:async url=>({ok:true,json:async()=>String(url).includes('payment_intents')?{id:'pi_safe',livemode:false,status:'succeeded',currency:'rub',amount_received:100}:{data:[],has_more:true}})}),e=>e.status===502);
});
