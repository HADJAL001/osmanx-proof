// OSMANX PARTNER 450 — real-deliverable B2B services with single-tier,
// one-time affiliate commissions. No pay-to-recruit, investment, or ROI promise.
import {one,all,run,transaction} from './db.mjs';
import {assert,sha,newId,cleanText,isoAddDays} from './security.mjs';

export const PARTNER450_TARGET=450;
export const PARTNER450_PRODUCTS=Object.freeze([
 Object.freeze({id:'growth_setup_40k',name:'OSMANX Business Setup',nameRu:'Настройка бизнеса OSMANX',currency:'RUB',priceCents:4_000_000,
  reservedDeliveryCents:1_800_000,referralBps:1000,deliverables:['Business needs audit','Workspace onboarding and quote templates','Client approval portal configuration','Staff training and handover report']}),
 Object.freeze({id:'enterprise_setup_200k',name:'OSMANX Enterprise Implementation',nameRu:'Внедрение OSMANX Enterprise',currency:'RUB',priceCents:20_000_000,
  reservedDeliveryCents:10_000_000,referralBps:1000,deliverables:['Workflow discovery and documented scope','Multi-team workspace configuration','Project and client delivery workflows','Administrator training and acceptance report']})
]);
const product=id=>PARTNER450_PRODUCTS.find(p=>p.id===id);
const percentage=(v,bps)=>Math.floor(v*bps/10000);
export function partner450Quote(p){
 assert(p&&PARTNER450_PRODUCTS.includes(p),422,'Unknown product');
 const taxReserve=percentage(p.priceCents,1200),paymentFees=percentage(p.priceCents,300);
 const contribution=p.priceCents-taxReserve-paymentFees-p.reservedDeliveryCents;
 const maxReward=Math.floor(Math.max(0,contribution)*35/100);
 const reward=Math.min(percentage(p.priceCents,p.referralBps),maxReward);
 return {productId:p.id,currency:'RUB',priceCents:p.priceCents,estimatedDeliveryReserveCents:p.reservedDeliveryCents,
  estimatedTaxReserveCents:taxReserve,estimatedProcessingReserveCents:paymentFees,estimatedPreCommissionContributionCents:contribution,
  rewardCents:reward,postRewardContributionCents:contribution-reward,
  disclaimer:'Estimates only; delivery and actual taxes/fees must be verified before any commercial launch.'};
}
const conciseOrder=o=>({id:o.id,orgId:o.org_id,packageId:o.package_id,priceCents:o.amount_cents,currency:o.currency,
 status:o.status,createdAt:o.created_at,paidAt:o.paid_at,deliveryNote:o.delivery_note,deliveryProofHash:o.delivery_proof_hash,
 acceptedAt:o.accepted_at,receiptHash:o.acceptance_receipt_hash,
 refundedCents:o.refunded_cents||0,provider:o.provider||null,testOnly:true});
export function createPartner450(db,{clock,member,admin,audit,ledgerPair}){
 const date=()=>clock(),write=fn=>transaction(db,fn);
 const lookup=id=>one(db,'SELECT * FROM partner450_orders WHERE id=?',id);
 const payment=id=>one(db,'SELECT * FROM partner450_payments WHERE order_id=?',id);
 function catalog(){return {target:PARTNER450_TARGET,requiresPurchaseToJoin:false,affiliateTiers:1,
  cashPayoutsEnabled:false,productionCheckoutEnabled:false,
  packages:PARTNER450_PRODUCTS.map(p=>({id:p.id,name:p.name,nameRu:p.nameRu,deliverables:p.deliverables,
   ...partner450Quote(p)})),note:'Draft catalogue and TEST integrations only. Real fulfillment, pricing and providers require approval.'};}
 function createOrder(actor,{orgId,packageId}){return write(()=>{
  member(actor,orgId,['owner']);const p=product(packageId);assert(p,422,'Unknown business package');
  const id=newId();run(db,`INSERT INTO partner450_orders(id,buyer_id,org_id,package_id,amount_cents,currency,status,created_at,updated_at)
   VALUES(?,?,?,?,?,'RUB','issued',?,?)`,id,actor,orgId,p.id,p.priceCents,date(),date());
  audit(actor,'partner450.order.issued',id,{orgId,packageId:p.id,amountCents:p.priceCents});
  return conciseOrder(lookup(id));
 });}
 function orderForBuyer(actor,orderId){const o=lookup(orderId);assert(o,404,'Order not found');
  assert(o.buyer_id===actor,403,'Only original buyer may manage an order');member(actor,o.org_id,['owner']);return o;}
 function details(actor,orderId){return conciseOrder(orderForBuyer(actor,orderId));}
 function orders(actor,orgId){member(actor,orgId,['owner','editor','viewer']);return all(db,'SELECT * FROM partner450_orders WHERE org_id=? ORDER BY created_at DESC',orgId)
  .map(o=>conciseOrder(o));}
 function bindTestIntent(actor,orderId,externalId){return write(()=>{
  const o=orderForBuyer(actor,orderId);assert(o.status==='issued',409,'Order already settled');
  assert(/^pi_[A-Za-z0-9_]{6,}$/.test(externalId||''),422,'Stripe TEST intent required');
  const prior=one(db,'SELECT external_id FROM partner450_intents WHERE order_id=?',orderId);
  assert(!prior||prior.external_id===externalId,409,'Conflicting payment intent');
  if(!prior)run(db,'INSERT INTO partner450_intents(order_id,external_id,created_at) VALUES(?,?,?)',orderId,externalId,date());
  audit(actor,'partner450.intent.test.bound',orderId);return {orderId,provider:'STRIPE_TEST',externalId,testOnly:true};
 });}
 const isOrder=id=>!!lookup(id);
 const isPayment=externalId=>!!one(db,'SELECT 1 FROM partner450_payments WHERE external_id=?',externalId);
 function processEvent(event,{sandbox=false}={}){return write(()=>{
  assert(event&&typeof event.id==='string'&&event.id.length>=8&&event.id.length<=180,422,'Invalid event ID');
  assert(['payment.succeeded','payment.refunded'].includes(event.type),422,'Unsupported event type');
  assert(event.provider==='STRIPE_TEST'||(sandbox&&event.provider==='SANDBOX_NO_REAL_MONEY'),403,'Untrusted payment provider');
  const digest=sha(JSON.stringify(event));const previous=one(db,'SELECT digest FROM partner450_events WHERE event_id=?',event.id);
  if(previous){assert(previous.digest===digest,409,'Webhook event collision');return {duplicate:true,testOnly:true};}
  const result=event.type==='payment.succeeded'?paid(event,{sandbox}):refund(event);
  run(db,'INSERT INTO partner450_events(event_id,digest,created_at) VALUES(?,?,?)',event.id,digest,date());
  return {...result,duplicate:false,testOnly:true};
 });}
 function paid(event,{sandbox}){
  const o=lookup(event.invoiceId);assert(o,404,'Business order not found');
  assert(o.status==='issued',409,'Order not payable');
  assert(event.currency==='RUB'&&event.amountCents===o.amount_cents,409,'Payment currency or amount mismatch');
  assert(typeof event.externalId==='string'&&event.externalId.length>=10,422,'Invalid external payment reference');
  if(event.provider==='STRIPE_TEST'){
   assert(!event.checkoutSessionId,409,'Hosted checkout not enabled for partner orders');
   const intent=one(db,'SELECT external_id FROM partner450_intents WHERE order_id=?',o.id);
   assert(intent?.external_id===event.externalId,409,'Payment intent is not bound to this order');
  }else{
   assert(sandbox&&event.externalId.startsWith('sandbox_p450_'),403,'Sandbox source rejected');
  }
  assert(!one(db,'SELECT 1 FROM partner450_payments WHERE external_id=?',event.externalId),409,'Provider reference collision');
  const pid=newId();run(db,`INSERT INTO partner450_payments(id,order_id,provider,external_id,amount_cents,refunded_cents,created_at)
   VALUES(?,?,?,?,?,0,?)`,pid,o.id,event.provider,event.externalId,event.amountCents,date());
  run(db,"UPDATE partner450_orders SET status='paid',paid_at=?,updated_at=? WHERE id=?",date(),date(),o.id);
  const channel=event.provider==='STRIPE_TEST'?'stripe_test':'sandbox';
  ledgerPair(`p450:sale:${pid}`,`partner450_${channel}_receivable`,`partner450_${channel}_sales`,event.amountCents);
  let rewardCents=0;
  const ref=one(db,'SELECT referrer_id FROM referral_attributions WHERE buyer_id=?',o.buyer_id);
  // One commission per independently acquired paying customer, not per package/seat/recruiter tree.
  if(ref&&ref.referrer_id!==o.buyer_id&&!one(db,'SELECT 1 FROM partner450_commissions WHERE buyer_id=?',o.buyer_id)){
   const risk=one(db,"SELECT count(*) AS n FROM fraud_flags WHERE buyer_id=? AND status IN ('open','confirmed')",o.buyer_id);
   const price=partner450Quote(product(o.package_id));rewardCents=price.rewardCents;
   const cid=newId();run(db,`INSERT INTO partner450_commissions(id,order_id,buyer_id,referrer_id,initial_cents,amount_cents,
    status,held_until,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)`,cid,o.id,o.buyer_id,ref.referrer_id,
     rewardCents,rewardCents,isoAddDays(date(),14),date(),date());
   if(rewardCents)ledgerPair(`p450:commission:${cid}`,`partner450_${channel}_marketing_expense`,
    `partner450_${channel}_commission_liability:${ref.referrer_id}`,rewardCents);
   audit(null,'partner450.commission.pending',cid,{orderId:o.id,hasRiskFlags:risk.n>0,amountCents:rewardCents,testOnly:true});
  }
  audit(null,'partner450.payment.test.confirmed',o.id,{provider:event.provider,amountCents:event.amountCents});
  return {orderId:o.id,status:'paid',rewardCents,provider:event.provider};
 }
 function refund(event){
  assert(typeof event.paymentExternalId==='string',422,'Payment reference required');
  const p=one(db,'SELECT * FROM partner450_payments WHERE external_id=?',event.paymentExternalId);
  assert(p&&p.provider===event.provider,404,'Partner payment not found');
  assert(typeof event.externalId==='string'&&event.externalId.length>=8,422,'Invalid refund reference');
  assert(Number.isSafeInteger(event.amountCents)&&event.amountCents>0&&event.amountCents<=p.amount_cents-p.refunded_cents,422,'Excessive refund');
  assert(!one(db,'SELECT 1 FROM partner450_refunds WHERE external_id=?',event.externalId),409,'Refund reference collision');
  const id=newId();run(db,'INSERT INTO partner450_refunds(id,payment_id,external_id,amount_cents,created_at) VALUES(?,?,?,?,?)',id,p.id,event.externalId,event.amountCents,date());
  const nextRefunded=p.refunded_cents+event.amountCents;
  run(db,'UPDATE partner450_payments SET refunded_cents=? WHERE id=?',nextRefunded,p.id);
  run(db,'UPDATE partner450_orders SET status=?,refunded_cents=?,updated_at=? WHERE id=?',
   nextRefunded===p.amount_cents?'refunded':'part_refunded',nextRefunded,date(),p.order_id);
  const channel=p.provider==='STRIPE_TEST'?'stripe_test':'sandbox';
  ledgerPair(`p450:refund:${id}`,`partner450_${channel}_sales`,`partner450_${channel}_receivable`,event.amountCents);
  const cm=one(db,'SELECT * FROM partner450_commissions WHERE order_id=?',p.order_id);
  if(cm){
   const amount=Math.floor(cm.initial_cents*(p.amount_cents-nextRefunded)/p.amount_cents),difference=cm.amount_cents-amount;
   assert(difference>=0,409,'Invalid reward adjustment');
   if(difference)ledgerPair(`p450:commission:reverse:${id}`,`partner450_${channel}_commission_liability:${cm.referrer_id}`,
    `partner450_${channel}_marketing_expense`,difference);
   run(db,'UPDATE partner450_commissions SET amount_cents=?,status=?,updated_at=? WHERE id=?',amount,amount===0?'void':'pending',date(),cm.id);
  }
  audit(null,'partner450.refund.test.recorded',p.order_id,{amountCents:event.amountCents,refundId:id});
  return {orderId:p.order_id,refundId:id,status:nextRefunded===p.amount_cents?'refunded':'part_refunded'};
 }
 function deliver(actor,orderId,{summary,evidenceSha256}){return write(()=>{
  admin(actor);const o=lookup(orderId);assert(o,404,'Order not found');
  assert(o.buyer_id!==actor,403,'Seller may not deliver to own buyer account');
  assert(o.status==='paid',409,'Order not awaiting delivery');
  summary=cleanText(summary,2000);assert(summary.length>=30,422,'Describe the delivered service (30+ characters)');
  assert(/^[0-9a-f]{64}$/.test(evidenceSha256||''),422,'SHA-256 evidence digest required');
  run(db,'UPDATE partner450_orders SET status=?,delivery_note=?,delivery_proof_hash=?,delivered_at=?,updated_at=? WHERE id=?',
   'delivered',summary,evidenceSha256,date(),date(),o.id);
  audit(actor,'partner450.delivery.submitted',o.id,{evidenceSha256});return conciseOrder(lookup(o.id));
 });}
 function accept(actor,orderId,{accepted}){return write(()=>{
  const o=orderForBuyer(actor,orderId);assert(o.status==='delivered',409,'Order not awaiting client approval');
  assert(accepted===true,422,'Explicit delivery acceptance required');
  const acceptedAt=date(),receiptHash=sha([o.id,o.buyer_id,o.package_id,o.delivery_proof_hash,acceptedAt,'client_ack'].join('|'));
  run(db,"UPDATE partner450_orders SET status='accepted',accepted_at=?,acceptance_receipt_hash=?,updated_at=? WHERE id=?",
   acceptedAt,receiptHash,date(),o.id);
  audit(actor,'partner450.delivery.accepted',o.id,{receiptHash,notQualifiedESignature:true});
  return {orderId:o.id,acceptedAt,receiptHash,legalSignature:false};
 });}
 function settle(actor){return write(()=>{
  admin(actor);
  const candidates=all(db,`SELECT c.*,o.status AS order_status,p.refunded_cents,p.provider
   FROM partner450_commissions c JOIN partner450_orders o ON o.id=c.order_id
   JOIN partner450_payments p ON p.order_id=o.id WHERE c.status='pending' AND c.held_until <= ?`,date());
  let settled=0,held=0;
  for(const c of candidates){
   const flags=one(db,"SELECT COUNT(*) AS n FROM fraud_flags WHERE buyer_id=? AND status IN ('open','confirmed')",c.buyer_id).n;
   if(flags||c.order_status!=='accepted'||c.refunded_cents>0||c.amount_cents===0){held++;continue;}
   // Stripe TEST and SANDBOX are simulations. No transfer endpoint exists.
   run(db,"UPDATE partner450_commissions SET status='test_eligible',updated_at=? WHERE id=?",date(),c.id);settled++;
  }
  audit(actor,'partner450.commissions.reviewed',null,{settled,held,source:'TEST_ONLY'});
  return {testEligible:settled,held,cashPayoutsEnabled:false};
 });}
 function wallet(actor){
  const referral=one(db,'SELECT code FROM referral_codes WHERE user_id=?',actor);
  assert(referral,403,'Partner account required');
  const cms=all(db,`SELECT c.id,c.amount_cents,c.status,c.held_until,c.created_at,o.package_id,
   o.status AS delivery_status,p.provider,p.refunded_cents
   FROM partner450_commissions c JOIN partner450_orders o ON o.id=c.order_id
   JOIN partner450_payments p ON p.order_id=o.id WHERE c.referrer_id=? ORDER BY c.created_at DESC`,actor);
  const tot=s=>cms.filter(c=>c.status===s).reduce((n,c)=>n+c.amount_cents,0);
  const completed=cms.filter(c=>c.delivery_status==='accepted'&&c.refunded_cents===0).length;
  return {code:referral.code,target:PARTNER450_TARGET,completedSales:completed,
   progressPercent:Math.min(100,Math.round(completed/PARTNER450_TARGET*10000)/100),
   pendingCents:tot('pending'),testEligibleCents:tot('test_eligible'),
   availableForCashoutCents:0,cashPayoutsEnabled:false,noPurchaseRequired:true,
   rows:cms.map(c=>({id:c.id,packageId:c.package_id,amountCents:c.amount_cents,status:c.status,
    deliveryStatus:c.delivery_status,heldUntil:c.held_until,provider:c.provider,refundedCents:c.refunded_cents,createdAt:c.created_at})),
   notice:'All balances are TEST simulations. No monetary withdrawal is available or implied.'};
 }
 function adminOrders(actor){admin(actor);return all(db,"SELECT * FROM partner450_orders ORDER BY created_at DESC LIMIT 100")
  .map(o=>({id:o.id,packageId:o.package_id,status:o.status,createdAt:o.created_at,priceCents:o.amount_cents,deliveryProofHash:o.delivery_proof_hash}));}
 return {catalog,createOrder,details,orders,orderForBuyer,bindTestIntent,isOrder,isPayment,processEvent,deliver,accept,settle,wallet,adminOrders};
}
