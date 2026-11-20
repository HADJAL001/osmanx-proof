import { randomBytes } from 'node:crypto';
import { one,all,run,transaction } from './db.mjs';
import { newId, token, sha, now, passwordHash, verifyPassword, isoAddDays, isoAddMonths, cleanText, assert, HttpError } from './security.mjs';
import { quoteMath, invoicePrice, calculateReward, PRO_PRICE_CENTS, ledgerBalanced } from './finance.mjs';
import { createWorkflow } from './workflow.mjs';
import { createEvidence } from './evidence.mjs';

export function createServices(db, options={}) {
 const clock=options.clock||now;
 const date=()=>clock();
 const write=fn=>transaction(db,fn);
 const userById=(id)=>one(db,'SELECT id,email,display_name,locale,is_admin,created_at FROM users WHERE id=?',id);
 const member=(userId,orgId,allowed=['owner','editor','viewer'])=>{
  const m=one(db,'SELECT role FROM memberships WHERE user_id=? AND org_id=?',userId,orgId);
  assert(m&&allowed.includes(m.role),403,'Access denied','FORBIDDEN'); return m.role;
 };
 const admin=(userId)=>{let u=one(db,'SELECT is_admin FROM users WHERE id=?',userId);assert(u?.is_admin===1,403,'Administrator required','FORBIDDEN')};
 function audit(actor,action,entity,metadata={}) {
  const prev=one(db,'SELECT event_hash FROM audit_events ORDER BY seq DESC LIMIT 1')?.event_hash||'GENESIS';
  const id=newId(), createdAt=date(), json=JSON.stringify(metadata);
  const hash=sha([prev,id,actor||'',action,entity||'',json,createdAt].join('|'));
  run(db,'INSERT INTO audit_events(id,actor_user_id,action,entity_id,metadata_json,prev_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?)',id,actor||null,action,entity||null,json,prev,hash,createdAt);
  return hash;
 }
 function verifyAudit() {
  let prev='GENESIS', checked=0;
  for(const e of all(db,'SELECT * FROM audit_events ORDER BY seq')) {
   const expected=sha([prev,e.id,e.actor_user_id||'',e.action,e.entity_id||'',e.metadata_json,e.created_at].join('|'));
   if(e.prev_hash!==prev||e.event_hash!==expected) return {ok:false,checked,failedSeq:e.seq};
   prev=e.event_hash;checked++;
  }
  return {ok:true,checked,lastHash:prev};
 }
 function postEntries(sourceKey,entries) {
  assert(ledgerBalanced(entries),500,'Unbalanced ledger transaction','LEDGER_ERROR');
  assert(!one(db,'SELECT id FROM ledger_transactions WHERE source_key=?',sourceKey),409,'Duplicate ledger source');
  const id=newId();run(db,'INSERT INTO ledger_transactions(id,source_key,created_at) VALUES(?,?,?)',id,sourceKey,date());
  for(const e of entries)run(db,'INSERT INTO ledger_entries(id,transaction_id,account,debit_cents,credit_cents) VALUES(?,?,?,?,?)',newId(),id,e.account,e.debitCents,e.creditCents);
  return id;
 }
 function ledgerPair(source,debit,credit,amount){
  if(amount===0)return;
  postEntries(source,[{account:debit,debitCents:amount,creditCents:0},{account:credit,debitCents:0,creditCents:amount}]);
 }
 function verifyLedger(){
  const rows=all(db,`SELECT t.id,t.source_key,COALESCE(SUM(e.debit_cents),0) AS debits,COALESCE(SUM(e.credit_cents),0) AS credits,COUNT(e.id) AS n
    FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.id GROUP BY t.id`);
  const bad=rows.filter(r=>r.debits!==r.credits||r.n<2);return {ok:bad.length===0,transactions:rows.length,unbalanced:bad};
 }
 function orgs(userId){return all(db,'SELECT o.id,o.name,m.role,s.plan,s.active_until FROM organizations o JOIN memberships m ON m.org_id=o.id LEFT JOIN subscriptions s ON s.org_id=o.id WHERE m.user_id=? ORDER BY o.created_at',userId);}
 function isPro(orgId){const s=one(db,'SELECT plan,active_until FROM subscriptions WHERE org_id=?',orgId);return s?.plan==='pro'&&s.active_until>date();}
 function makeOrg(userId,name){
  const orgId=newId();run(db,'INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)',orgId,cleanText(name,100)||'Workspace',date());
  run(db,'INSERT INTO memberships(user_id,org_id,role,created_at) VALUES(?,?,?,?)',userId,orgId,'owner',date());
  run(db,'INSERT INTO subscriptions(org_id,plan,updated_at) VALUES(?,?,?)',orgId,'free',date());
  audit(userId,'org.created',orgId);return orgId;
 }
 function createUser({email,password,name,referralCode='',ipHash=null}){
  email=String(email||'').trim().toLowerCase(); name=cleanText(name,80);
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254,422,'Valid email required');
  assert(typeof password==='string'&&password.length>=10&&password.length<=128,422,'Password must be 10–128 characters');
  assert(name.length>=2,422,'Name too short');
  return write(()=>{
   assert(!one(db,'SELECT id FROM users WHERE email=?',email),409,'Email is already registered','CONFLICT');
   const ref=referralCode?one(db,`SELECT r.user_id,u.signup_ip_hash FROM referral_codes r JOIN users u ON u.id=r.user_id WHERE r.code=?`,String(referralCode).toUpperCase()):null;
   if(referralCode)assert(ref,422,'Referral code not found');
   const id=newId(), inviteCode=randomBytes(6).toString('hex').toUpperCase();
   run(db,'INSERT INTO users(id,email,display_name,password_hash,signup_ip_hash,referred_by,created_at) VALUES(?,?,?,?,?,?,?)',id,email,name,passwordHash(password),ipHash,ref?.user_id||null,date());
   run(db,'INSERT INTO referral_codes(user_id,code,created_at) VALUES(?,?,?)',id,inviteCode,date());
   if(ref){
    run(db,'INSERT INTO referral_attributions(buyer_id,referrer_id,code,created_at) VALUES(?,?,?,?)',id,ref.user_id,String(referralCode).toUpperCase(),date());
    if(ipHash&&ref.signup_ip_hash&&ipHash===ref.signup_ip_hash){
     run(db,'INSERT INTO fraud_flags(id,buyer_id,referrer_id,kind,reason,created_at) VALUES(?,?,?,?,?,?)',newId(),id,ref.user_id,'shared_signup_network','Same network at registration; manual review required before release of rewards',date());
    }
   }
   const orgId=makeOrg(id,`${name} / Workspace`);audit(id,'user.registered',id,{usedReferral:!!ref});
   return {user:userById(id),orgId};
  });
 }
 function authenticate(email,password){
  const user=one(db,'SELECT * FROM users WHERE email=?',String(email||'').trim().toLowerCase());
  assert(user&&verifyPassword(String(password||''),user.password_hash),401,'Invalid email or password','UNAUTHORIZED');return userById(user.id);
 }
 function createSession(userId){return write(()=>{
  const secret=token(),csrf=token();
  run(db,'INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)',sha(secret),userId,csrf,isoAddDays(date(),Number(options.sessionDays||7)),date());
  audit(userId,'auth.login',userId);return {secret,csrf};
 });}
 function getSession(secret){
  if(!secret||secret.length>200)return null;
  const s=one(db,'SELECT * FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?',sha(secret),date());
  if(!s)return null;return {user:userById(s.user_id),csrf:s.csrf_token,tokenHash:s.token_hash};
 }
 function revokeSession(secret,userId){return write(()=>{run(db,'UPDATE sessions SET revoked_at=? WHERE token_hash=? AND user_id=?',date(),sha(secret),userId);audit(userId,'auth.logout',userId)})}
 function setLocale(userId,locale){return write(()=>{
  assert(['ru','en'].includes(locale),422,'Unsupported locale');
  run(db,'UPDATE users SET locale=? WHERE id=?',locale,userId);
  audit(userId,'user.locale',userId,{locale});return userById(userId);
 });}
 function createOrganization(userId,name){return write(()=>makeOrg(userId,name));}
 function invite(userId,orgId,email,role){return write(()=>{
  member(userId,orgId,['owner']);email=String(email||'').trim().toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),422,'Invalid invite email');
  assert(['editor','viewer'].includes(role),422,'Invalid role');
  const raw=token(),id=newId();run(db,'INSERT INTO invitations(id,org_id,email,role,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',id,orgId,email,role,sha(raw),isoAddDays(date(),7),userId,date());audit(userId,'org.invitation',id,{orgId,role});
  return {token:raw,expiresAt:isoAddDays(date(),7),role,email};
 });}
 function acceptInvite(userId,raw){return write(()=>{
  const i=one(db,'SELECT * FROM invitations WHERE token_hash=?',sha(String(raw||'')));
  const u=one(db,'SELECT email FROM users WHERE id=?',userId);
  assert(i&&i.expires_at>date()&&!i.accepted_at&&i.email===u?.email,403,'Invalid or expired invite');
  assert(!one(db,'SELECT 1 FROM memberships WHERE user_id=? AND org_id=?',userId,i.org_id),409,'Already a member');
  run(db,'INSERT INTO memberships(user_id,org_id,role,created_at) VALUES(?,?,?,?)',userId,i.org_id,i.role,date());
  run(db,'UPDATE invitations SET accepted_at=? WHERE id=?',date(),i.id);audit(userId,'org.invitation.accepted',i.id);return {orgId:i.org_id,role:i.role};
 });}
 function normalizeQuote(body){
  const title=cleanText(body.title,140), clientName=cleanText(body.clientName,140), clientEmail=cleanText(body.clientEmail,254);
  assert(title.length>=2,422,'Title required');
  assert(!clientEmail||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail),422,'Invalid client email');
  const discountCents=body.discountCents??0,taxBps=body.taxBps??0;
  const math=quoteMath(body.items,discountCents,taxBps);
  return {title,clientName,clientEmail,discountCents,taxBps,math};
 }
 function insertQuoteItems(quoteId,items){
  for(const x of items)run(db,'INSERT INTO quote_items(id,quote_id,description,qty,unit_price_cents,unit_cost_cents,position) VALUES(?,?,?,?,?,?,?)',newId(),quoteId,x.description,x.qty,x.unitPriceCents,x.unitCostCents,x.position);
 }
 function getQuoteRaw(quoteId){
  const q=one(db,'SELECT * FROM quotes WHERE id=?',quoteId);assert(q,404,'Quote not found');
  const items=all(db,'SELECT description,qty,unit_price_cents,unit_cost_cents FROM quote_items WHERE quote_id=? ORDER BY position',quoteId).map(x=>({description:x.description,qty:x.qty,unitPriceCents:x.unit_price_cents,unitCostCents:x.unit_cost_cents}));
  const revision=one(db,'SELECT revision FROM quote_versions WHERE quote_id=?',quoteId)?.revision||1;
  const responses=all(db,'SELECT revision,decision,responder_name,message,created_at FROM quote_responses WHERE quote_id=? ORDER BY created_at DESC LIMIT 20',quoteId).map(r=>({revision:r.revision,decision:r.decision,responderName:r.responder_name,message:r.message,createdAt:r.created_at}));
  return {id:q.id,orgId:q.org_id,title:q.title,clientName:q.client_name,clientEmail:q.client_email,status:q.status,revision,responses,createdAt:q.created_at,updatedAt:q.updated_at,math:quoteMath(items,q.discount_cents,q.tax_bps),items,discountCents:q.discount_cents,taxBps:q.tax_bps};
 }
 function getQuote(userId,id){const q=one(db,'SELECT org_id FROM quotes WHERE id=?',id);assert(q,404,'Quote not found');member(userId,q.org_id);return getQuoteRaw(id)}
 function listQuotes(userId,orgId){member(userId,orgId);return all(db,'SELECT id,title,client_name,status,updated_at FROM quotes WHERE org_id=? ORDER BY updated_at DESC LIMIT 200',orgId);}
 function createQuote(userId,orgId,body){return write(()=>{
  member(userId,orgId,['owner','editor']);
  if(!isPro(orgId)){
   // Quota follows the owning account across free workspaces: creating a new
   // organization must not reset the free allowance.
   const owner=one(db,"SELECT user_id FROM memberships WHERE org_id=? AND role='owner' LIMIT 1",orgId);
   const count=one(db,`SELECT COUNT(*) AS n FROM quotes q
     JOIN memberships m ON m.org_id=q.org_id AND m.role='owner'
     WHERE m.user_id=? AND q.created_at>=?`,owner.user_id,new Date(date().slice(0,7)+'-01T00:00:00.000Z').toISOString()).n;
   assert(count<3,402,'Free plan allows 3 quotes per account per month; upgrade to Pro','FREE_LIMIT');
  }
  const q=normalizeQuote(body),id=newId();
  run(db,'INSERT INTO quotes(id,org_id,created_by,title,client_name,client_email,discount_cents,tax_bps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,orgId,userId,q.title,q.clientName,q.clientEmail,q.discountCents,q.taxBps,date(),date());
  insertQuoteItems(id,q.math.lines);run(db,'INSERT INTO quote_versions(quote_id,revision) VALUES(?,1)',id);audit(userId,'quote.created',id,{orgId,totalCents:q.math.totalCents});return getQuoteRaw(id);
 });}
 function updateQuote(userId,id,body){return write(()=>{
  const old=getQuote(userId,id);member(userId,old.orgId,['owner','editor']);
  assert(old.status!=='accepted'&&old.status!=='cancelled',409,'Accepted/cancelled quotes are immutable');
  if(body.expectedRevision!==undefined)assert(body.expectedRevision===old.revision,409,'Quote has been changed since it was loaded','STALE_QUOTE');
  const q=normalizeQuote(body);
  run(db,`UPDATE quotes SET title=?,client_name=?,client_email=?,discount_cents=?,tax_bps=?,status='draft',updated_at=? WHERE id=?`,q.title,q.clientName,q.clientEmail,q.discountCents,q.taxBps,date(),id);
  run(db,'DELETE FROM quote_items WHERE quote_id=?',id);insertQuoteItems(id,q.math.lines);
  run(db,'INSERT OR IGNORE INTO quote_versions(quote_id,revision) VALUES(?,1)',id);
  run(db,'UPDATE quote_versions SET revision=revision+1 WHERE quote_id=?',id);
  run(db,'UPDATE quote_share_versions SET revoked_at=? WHERE quote_id=? AND revoked_at IS NULL',date(),id);
  audit(userId,'quote.updated',id,{revision:old.revision+1,totalCents:q.math.totalCents,priorSharesRevoked:true});return getQuoteRaw(id);
 });}
 function quoteStatus(userId,id,status){return write(()=>{
  const q=getQuote(userId,id);member(userId,q.orgId,['owner','editor']);
  assert(['sent','accepted','cancelled'].includes(status),422,'Invalid status');
  assert(!['accepted','cancelled'].includes(q.status),409,'Final quote is immutable');
  run(db,'UPDATE quotes SET status=?,updated_at=? WHERE id=?',status,date(),id);audit(userId,'quote.status',id,{from:q.status,to:status});return getQuoteRaw(id);
 });}
 function shareQuote(userId,id){return write(()=>{
  const q=getQuote(userId,id);member(userId,q.orgId,['owner','editor']);
  assert(q.status!=='accepted'&&q.status!=='cancelled',409,'Final proposal cannot be shared for approval');
  run(db,'UPDATE quote_share_versions SET revoked_at=? WHERE quote_id=? AND revoked_at IS NULL',date(),id);
  const raw=token(),shareId=newId(),fingerprint=quoteSnapshot(q);
  run(db,'INSERT INTO quote_shares(id,quote_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)',shareId,id,sha(raw),isoAddDays(date(),14),date());
  run(db,'INSERT INTO quote_share_versions(share_id,quote_id,revision,snapshot_hash) VALUES(?,?,?,?)',shareId,id,q.revision,fingerprint);
  run(db,"UPDATE quotes SET status='sent',updated_at=? WHERE id=?",date(),id);
  audit(userId,'quote.shared',id,{expiresDays:14,revision:q.revision,shareId,snapshotHash:fingerprint});return {token:raw,expiresAt:isoAddDays(date(),14)};
 });}
 function quoteSnapshot(q){
  return sha(JSON.stringify({id:q.id,revision:q.revision,title:q.title,clientName:q.clientName,
    items:q.items.map(i=>({description:i.description,qty:i.qty,unitPriceCents:i.unitPriceCents})),
    discountCents:q.discountCents,taxBps:q.taxBps,totalCents:q.math.totalCents}));
 }
 function shareRecord(raw){
  assert(typeof raw==='string'&&raw.length>=30&&raw.length<=256,404,'Share link invalid');
  const share=one(db,`SELECT s.id,s.quote_id,s.expires_at,v.revision,v.snapshot_hash,v.revoked_at
   FROM quote_shares s JOIN quote_share_versions v ON v.share_id=s.id WHERE s.token_hash=?`,sha(raw));
  assert(share&&share.expires_at>date()&&!share.revoked_at,404,'Share link invalid or expired');
  const q=getQuoteRaw(share.quote_id);
  assert(q.revision===share.revision&&quoteSnapshot(q)===share.snapshot_hash&&q.status==='sent',409,'This proposal version is no longer open for approval','QUOTE_STALE');
  return {share,q};
 }
 function quoteByShare(raw){
  const {q}=shareRecord(raw);
  // Do not expose unit costs, profitability, internal IDs, or customer email in public response.
  const {subtotalCents,discountCents,taxBps,taxCents,totalCents}=q.math;
  const math={subtotalCents,discountCents,taxBps,taxCents,totalCents};
  return {...q,clientEmail:'',orgId:undefined,responses:undefined,items:q.items.map(({unitCostCents,...line})=>line),math};
 }
 function respondToQuote(raw,body,fingerprintHash='') {return write(()=>{
  assert(body&&typeof body==='object'&&body.consent===true,422,'Explicit consent required');
  assert(['accepted','changes_requested'].includes(body.decision),422,'Invalid decision');
  const responder=cleanText(body.name,120),message=cleanText(body.message,1600);
  assert(responder.length>=2,422,'Name is required');
  if(body.decision==='changes_requested')assert(message.length>=5,422,'Explain requested changes');
  const {share,q}=shareRecord(raw);
  assert(!one(db,'SELECT id FROM quote_responses WHERE share_id=?',share.id),409,'Response already recorded');
  const id=newId();run(db,`INSERT INTO quote_responses(id,share_id,quote_id,revision,snapshot_hash,decision,responder_name,message,fingerprint_hash,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?)`,id,share.id,q.id,q.revision,share.snapshot_hash,body.decision,responder,message,fingerprintHash||null,date());
  run(db,'UPDATE quote_share_versions SET revoked_at=? WHERE share_id=?',date(),share.id);
  if(body.decision==='accepted')run(db,"UPDATE quotes SET status='accepted',updated_at=? WHERE id=?",date(),q.id);
  audit(null,'quote.client_response',q.id,{responseId:id,decision:body.decision,revision:q.revision,snapshotHash:share.snapshot_hash});
  return {responseId:id,decision:body.decision,revision:q.revision,recordedAt:date(),notice:'Token-based acknowledgement; not verified legal electronic signature'};
 });}
 function createInvoice(userId,orgId){return write(()=>{
  member(userId,orgId,['owner']);
  const prefs=one(db,'SELECT renewal_state FROM subscription_preferences WHERE org_id=?',orgId);
  assert(prefs?.renewal_state!=='stopped',409,'Subscription stopped; resume before purchasing another month','SUBSCRIPTION_STOPPED');
  const pending=one(db,`SELECT i.* FROM invoices i LEFT JOIN invoice_voids v ON v.invoice_id=i.id
   WHERE i.user_id=? AND i.org_id=? AND i.status='issued' AND v.invoice_id IS NULL ORDER BY i.created_at DESC LIMIT 1`,userId,orgId);
  if(pending)return pending;
  const firstPaid=!one(db,`SELECT 1 FROM invoices i JOIN payments p ON p.invoice_id=i.id WHERE i.user_id=? LIMIT 1`,userId);
  const usedDiscount=one(db,`SELECT 1 FROM invoices i LEFT JOIN invoice_voids v ON v.invoice_id=i.id WHERE i.user_id=? AND i.discount_cents>0 AND v.invoice_id IS NULL LIMIT 1`,userId);
  const ref=one(db,'SELECT 1 FROM referral_attributions WHERE buyer_id=?',userId);
  const p=invoicePrice(!!ref&&firstPaid&&!usedDiscount),id=newId();
  run(db,'INSERT INTO invoices(id,user_id,org_id,plan,list_amount_cents,discount_cents,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)',id,userId,orgId,'pro',p.listAmountCents,p.discountCents,p.totalCents,date());
  audit(userId,'invoice.created',id,{orgId,amountCents:p.totalCents});return one(db,'SELECT * FROM invoices WHERE id=?',id);
 });}
 function invoices(userId,orgId){member(userId,orgId);return all(db,`SELECT i.id,i.plan,i.total_cents,i.discount_cents,
   CASE WHEN v.invoice_id IS NOT NULL THEN 'void' ELSE i.status END AS status,i.created_at,i.paid_at
   FROM invoices i LEFT JOIN invoice_voids v ON v.invoice_id=i.id WHERE i.org_id=? ORDER BY i.created_at DESC LIMIT 40`,orgId);}
 function subscriptionDetails(userId,orgId){
  member(userId,orgId);
  const sub=one(db,'SELECT plan,active_until,updated_at FROM subscriptions WHERE org_id=?',orgId);
  const prefs=one(db,'SELECT * FROM subscription_preferences WHERE org_id=?',orgId);
  return {orgId,plan:sub?.plan||'free',activeUntil:sub?.active_until||null,
   renewalState:prefs?.renewal_state||'manual',cancelledAt:prefs?.cancelled_at||null,
   renewalMode:'MANUAL_ONLY',autoChargeEnabled:false,
   note:'No recurring billing integration: paying future invoices always requires an explicit new authorization'};
 }
 function changeSubscription(userId,orgId,action){return write(()=>{
  member(userId,orgId,['owner']);assert(['cancel','resume'].includes(action),422,'Unknown subscription action');
  const prefs=one(db,'SELECT renewal_state FROM subscription_preferences WHERE org_id=?',orgId);
  const state=action==='cancel'?'stopped':'manual';
  assert((prefs?.renewal_state||'manual')!==state,409,'Subscription preference is already in this state');
  run(db,`INSERT INTO subscription_preferences(org_id,renewal_state,cancelled_at,resumed_at,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET renewal_state=excluded.renewal_state,
    cancelled_at=excluded.cancelled_at,resumed_at=excluded.resumed_at,updated_at=excluded.updated_at`,
    orgId,state,action==='cancel'?date():null,action==='resume'?date():null,date());
  let voided=0;
  if(action==='cancel'){
   const issued=all(db,`SELECT i.id FROM invoices i LEFT JOIN invoice_voids v ON v.invoice_id=i.id
    WHERE i.org_id=? AND i.status='issued' AND v.invoice_id IS NULL`,orgId);
   for(const i of issued){run(db,'INSERT INTO invoice_voids(invoice_id,reason,voided_at,actor_id) VALUES(?,?,?,?)',i.id,'subscription_cancelled',date(),userId);voided++;}
  }
  audit(userId,'subscription.'+action,orgId,{state,voidedInvoices:voided});return subscriptionDetails(userId,orgId);
 });}
 function recomputeSubscription(orgId){
  const rows=all(db,`SELECT i.paid_at,i.status FROM invoices i WHERE i.org_id=? AND i.status IN ('paid','part_refunded') ORDER BY i.paid_at,i.id`,orgId);
  let until=null;
  for(const r of rows){const starting=until&&until>r.paid_at?until:r.paid_at;until=isoAddMonths(starting,1);}
  const plan=until&&until>date()?'pro':'free';
  run(db,'UPDATE subscriptions SET plan=?,active_until=?,updated_at=? WHERE org_id=?',plan,until,date(),orgId);
 }
 function addFraudFlag(buyerId,referrerId,kind,reason){
  const existing=one(db,`SELECT id,status FROM fraud_flags WHERE buyer_id=? AND referrer_id=? AND kind=? AND status IN ('open','confirmed')`,buyerId,referrerId,kind);
  if(existing)return existing.id;
  const id=newId();run(db,'INSERT INTO fraud_flags(id,buyer_id,referrer_id,kind,reason,created_at) VALUES(?,?,?,?,?,?)',id,buyerId,referrerId,kind,reason,date());
  // Previously payable rewards must not be approved when a new risk signal appears.
  const rewards=all(db,"SELECT * FROM referral_rewards WHERE buyer_id=? AND status='payable'",buyerId);
  for(const r of rewards){run(db,"UPDATE referral_rewards SET status='pending',updated_at=? WHERE id=?",date(),r.id);reconcilePayoutReservations(r.referrer_id);}
  audit(null,'fraud.flag.generated',id,{buyerId,kind});return id;
 }
 function assessReferralRisk(buyerId,referrerId){
  const buyer=one(db,'SELECT signup_ip_hash FROM users WHERE id=?',buyerId);
  assert(buyer&&one(db,'SELECT id FROM users WHERE id=?',referrerId),404,'User not found');
  const signals=[];
  if(buyerId===referrerId)signals.push(['self_referral','Buyer and referrer have identical identity']);
  const sameOrg=one(db,`SELECT 1 FROM memberships b JOIN memberships r ON r.org_id=b.org_id
     WHERE b.user_id=? AND r.user_id=? LIMIT 1`,buyerId,referrerId);
  if(sameOrg)signals.push(['shared_organization','Buyer and referrer belong to the same organization']);
  const ref=one(db,'SELECT signup_ip_hash FROM users WHERE id=?',referrerId);
  if(buyer.signup_ip_hash&&ref?.signup_ip_hash&&buyer.signup_ip_hash===ref.signup_ip_hash)
   signals.push(['shared_signup_network','Buyer and referrer registered from the same network']);
  const cluster=buyer.signup_ip_hash?one(db,'SELECT COUNT(*) AS n FROM users WHERE signup_ip_hash=?',buyer.signup_ip_hash)?.n||0:0;
  if(cluster>=4)signals.push(['network_cluster','Four or more accounts share a signup network']);
  const ids=[];for(const [kind,reason] of signals)ids.push(addFraudFlag(buyerId,referrerId,kind,reason));
  const flags=all(db,"SELECT id,kind,status FROM fraud_flags WHERE buyer_id=? AND status IN ('open','confirmed')",buyerId);
  return {buyerId,referrerId,flags,signals:signals.map(([kind])=>kind),flagIds:ids,
    releaseBlocked:flags.length>0,confirmedFraud:flags.some(f=>f.status==='confirmed')};
 }
 function recheckReferral(actor,buyerId){return write(()=>{
  admin(actor);const rel=one(db,'SELECT referrer_id FROM referral_attributions WHERE buyer_id=?',buyerId);
  assert(rel,404,'Referral attribution not found');const result=assessReferralRisk(buyerId,rel.referrer_id);
  audit(actor,'fraud.manual_recheck',buyerId,{signalCount:result.signals.length});return result;
 });}
 function recordCheckoutSession(userId,invoiceId,session){return write(()=>{
  const invoice=one(db,'SELECT * FROM invoices WHERE id=? AND user_id=?',invoiceId,userId);
  assert(invoice&&!one(db,'SELECT 1 FROM invoice_voids WHERE invoice_id=?',invoiceId),404,'Invoice not payable');
  member(userId,invoice.org_id,['owner']);
  assert(invoice.status==='issued'&&invoice.total_cents===session.amountCents&&session.provider==='STRIPE_TEST',409,'Checkout invoice mismatch');
  const existing=one(db,'SELECT session_id FROM checkout_sessions WHERE invoice_id=?',invoiceId);
  assert(!existing||existing.session_id===session.sessionId,409,'Conflicting checkout session','CHECKOUT_COLLISION');
  if(!existing){run(db,'INSERT INTO checkout_sessions(invoice_id,session_id,provider,created_at) VALUES(?,?,?,?)',invoiceId,session.sessionId,'STRIPE_TEST',date());
   audit(userId,'checkout.test.created',invoiceId,{sessionId:session.sessionId});}
  return {invoiceId,sessionId:session.sessionId,testOnly:true};
 });}
 function recordProviderVerification(actor,paymentExternalId,report){return write(()=>{
  admin(actor);
  const payment=one(db,'SELECT * FROM payments WHERE external_id=? AND provider=?',paymentExternalId,'STRIPE_TEST');
  assert(payment,404,'Payment not found');
  assert(report?.externalId===payment.external_id&&report.invoiceId===payment.invoice_id
   &&report.amountCents===payment.amount_cents&&report.localRefundedCents===payment.refunded_cents,409,'Local payment changed during verification');
  const id=newId(),json=JSON.stringify(report),evidenceHash=sha(json);
  run(db,'INSERT INTO provider_verification_reports(id,payment_id,evidence_hash,matches,result_json,verified_by,created_at) VALUES(?,?,?,?,?,?,?)',id,payment.id,evidenceHash,report.matches?1:0,json,actor,date());
  audit(actor,'provider.test.verified',payment.id,{reportId:id,matches:report.matches,evidenceHash});
  return {reportId:id,...report};
 });}
 function processPaymentEvent(event){
  assert(event&&typeof event==='object'&&typeof event.id==='string'&&event.id.length>=8&&event.id.length<200,422,'Invalid event ID');
  assert(['payment.succeeded','payment.refunded'].includes(event.type),422,'Unsupported payment event');
  const digest=sha(JSON.stringify(event));
  return write(()=>{
   const existing=one(db,'SELECT digest FROM webhook_events WHERE event_id=?',event.id);
   if(existing){assert(existing.digest===digest,409,'Webhook event ID collision');return {duplicate:true};}
   const result=event.type==='payment.succeeded'?paid(event):refunded(event);
   run(db,'INSERT INTO webhook_events(event_id,digest,processed_at) VALUES(?,?,?)',event.id,digest,date());
   return {duplicate:false,...result};
  });
 }
 function paid(event){
  assert(typeof event.invoiceId==='string'&&typeof event.externalId==='string'&&event.externalId.length>5,422,'Invalid payment reference');
  const i=one(db,'SELECT * FROM invoices WHERE id=?',event.invoiceId);assert(i,404,'Invoice not found');
  if(event.provider==='STRIPE_TEST'){
   const intent=one(db,'SELECT external_id FROM provider_intents WHERE invoice_id=?',event.invoiceId);
   const checkout=one(db,'SELECT session_id FROM checkout_sessions WHERE invoice_id=?',event.invoiceId);
   assert(intent||checkout,409,'Unregistered test provider payment','PROVIDER_BINDING');
   if(event.checkoutSessionId)assert(checkout?.session_id===event.checkoutSessionId,409,'Checkout session mismatch','PROVIDER_BINDING');
   if(intent)assert(intent.external_id===event.externalId||!!checkout,409,'Provider intent mismatch','PROVIDER_BINDING');
  }

  const priorPay=one(db,'SELECT * FROM payments WHERE external_id=?',event.externalId);
  if(priorPay){assert(priorPay.invoice_id===i.id&&priorPay.amount_cents===event.amountCents&&priorPay.provider===event.provider,409,'Payment reference collision');return {paymentId:priorPay.id,invoiceId:i.id,duplicate:true};}
  assert(i.status==='issued'&&!one(db,'SELECT 1 FROM invoice_voids WHERE invoice_id=?',i.id),409,'Invoice is no longer payable');
  assert(event.amountCents===i.total_cents&&event.currency==='RUB',422,'Amount or currency mismatch');
  assert(!one(db,'SELECT id FROM payments WHERE external_id=?',event.externalId),409,'Duplicate provider payment');
  const prior=one(db,'SELECT 1 FROM invoices i JOIN payments p ON p.invoice_id=i.id WHERE i.user_id=? LIMIT 1',i.user_id);
  const pid=newId();run(db,'INSERT INTO payments(id,invoice_id,provider,external_id,amount_cents,paid_at) VALUES(?,?,?,?,?,?)',pid,i.id,cleanText(event.provider,40)||'unspecified',event.externalId,event.amountCents,date());
  run(db,"UPDATE invoices SET status='paid',paid_at=? WHERE id=?",date(),i.id);
  ledgerPair(`payment:${pid}`,'payment_clearing','subscription_sales',i.total_cents);
  recomputeSubscription(i.org_id);
  const referral=one(db,'SELECT * FROM referral_attributions WHERE buyer_id=?',i.user_id);
  if(referral&&!prior&&referral.referrer_id!==i.user_id){
   const risk=assessReferralRisk(i.user_id,referral.referrer_id);
   const amount=risk.confirmedFraud?0:calculateReward(i.total_cents);
   if(amount>0){
    const rid=newId();run(db,'INSERT INTO referral_rewards(id,payment_id,referrer_id,buyer_id,original_cents,amount_cents,status,held_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',rid,pid,referral.referrer_id,i.user_id,amount,amount,'pending',isoAddDays(date(),14),date(),date());
    ledgerPair(`reward:${rid}`,'referral_marketing_expense',`referral_liability:${referral.referrer_id}`,amount);
    audit(null,'referral.reward.created',rid,{paymentId:pid,amountCents:amount});
   }
  }
  audit(null,'payment.received',pid,{invoiceId:i.id,amountCents:i.total_cents});return {paymentId:pid,invoiceId:i.id};
 }
 function refunded(event){
  assert(typeof event.paymentExternalId==='string'&&typeof event.externalId==='string'&&event.externalId.length>5,422,'Invalid refund reference');
  assert(Number.isSafeInteger(event.amountCents)&&event.amountCents>0,422,'Invalid refund amount');
  const p=one(db,'SELECT * FROM payments WHERE external_id=?',event.paymentExternalId);assert(p,404,'Payment not found');
  if(event.provider)assert(event.provider===p.provider,409,'Provider mismatch on refund');
  const already=one(db,'SELECT id,payment_id,amount_cents FROM refunds WHERE external_id=?',event.externalId);
  if(already){
   assert(already.payment_id===p.id&&already.amount_cents===event.amountCents,409,'Refund external ID collision');
   return {refundId:already.id,status:'already_processed',duplicate:true};
  }
  assert(p.refunded_cents+event.amountCents<=p.amount_cents,409,'Refund exceeds payment');
  const id=newId(),total=p.refunded_cents+event.amountCents;
  run(db,'INSERT INTO refunds(id,payment_id,external_id,amount_cents,created_at) VALUES(?,?,?,?,?)',id,p.id,event.externalId,event.amountCents,date());
  run(db,'UPDATE payments SET refunded_cents=? WHERE id=?',total,p.id);
  const status=total===p.amount_cents?'refunded':'part_refunded';
  run(db,'UPDATE invoices SET status=? WHERE id=?',status,p.invoice_id);
  ledgerPair(`refund:${id}`,'subscription_sales','payment_clearing',event.amountCents);
  const r=one(db,'SELECT * FROM referral_rewards WHERE payment_id=?',p.id);
  if(r&&r.status!=='paid'){
   const next=calculateReward(p.amount_cents-total),diff=r.amount_cents-next;
   if(diff>0){ledgerPair(`reward.reversal:${id}`,`referral_liability:${r.referrer_id}`,'referral_marketing_expense',diff);run(db,'UPDATE referral_rewards SET amount_cents=?,status=?,updated_at=? WHERE id=?',next,next===0?'void':'pending',date(),r.id);reconcilePayoutReservations(r.referrer_id);}
  }
  const i=one(db,'SELECT org_id FROM invoices WHERE id=?',p.invoice_id);recomputeSubscription(i.org_id);
  audit(null,'payment.refunded',id,{paymentId:p.id,amountCents:event.amountCents});return {refundId:id,status};
 }
 function reconcilePayoutReservations(referrerId){
  const payable=one(db,"SELECT COALESCE(SUM(amount_cents),0) AS n FROM referral_rewards WHERE referrer_id=? AND status='payable'",referrerId).n;
  const requests=all(db,"SELECT id,amount_cents FROM payout_requests WHERE user_id=? AND status IN ('requested','approved') ORDER BY created_at DESC",referrerId);
  let reserved=requests.reduce((n,x)=>n+x.amount_cents,0);
  for(const request of requests){
   if(reserved<=payable)break;
   run(db,"UPDATE payout_requests SET status='rejected',updated_at=? WHERE id=?",date(),request.id);
   run(db,"UPDATE payout_preparations SET status='revoked',revoked_at=? WHERE request_id=? AND status='prepared'",date(),request.id);
   run(db,'UPDATE payout_export_leases SET revoked_at=? WHERE request_id=? AND revoked_at IS NULL',date(),request.id);
   audit(null,'payout.reservation.revoked',request.id,{reason:'Reward liability reduced after refund or fraud review'});
   reserved-=request.amount_cents;
  }
 }
 function rewards(userId){
  const code=one(db,'SELECT code FROM referral_codes WHERE user_id=?',userId)?.code;
  const rows=all(db,'SELECT id,buyer_id,amount_cents,status,held_until,created_at FROM referral_rewards WHERE referrer_id=? ORDER BY created_at DESC',userId);
  const total=rows.filter(r=>r.status!=='void').reduce((s,x)=>s+x.amount_cents,0);
  const payable=rows.filter(r=>r.status==='payable').reduce((s,x)=>s+x.amount_cents,0);
  const reserved=one(db,"SELECT COALESCE(SUM(amount_cents),0) AS n FROM payout_requests WHERE user_id=? AND status IN ('requested','approved')",userId).n;
  return {code,totalCents:total,payableCents:payable,availableCents:Math.max(0,payable-reserved),pendingCents:rows.filter(r=>r.status==='pending').reduce((s,x)=>s+x.amount_cents,0),rows};
 }
 function settleRewards(actorId){return write(()=>{
  admin(actorId);
  const eligible=all(db,`SELECT r.id FROM referral_rewards r WHERE r.status='pending' AND r.held_until<=? AND NOT EXISTS
   (SELECT 1 FROM fraud_flags f WHERE f.buyer_id=r.buyer_id AND f.status IN ('open','confirmed'))`,date());
  for(const r of eligible)run(db,"UPDATE referral_rewards SET status='payable',updated_at=? WHERE id=?",date(),r.id);
  audit(actorId,'referral.rewards.settled',null,{count:eligible.length});return {settled:eligible.length};
 });}
 function requestPayout(userId,amount){return write(()=>{
  assert(Number.isSafeInteger(amount)&&amount>=10000,422,'Minimum request is 100 RUB');
  const wallet=rewards(userId);assert(amount<=wallet.availableCents,422,'Insufficient payable rewards');
  const id=newId();run(db,'INSERT INTO payout_requests(id,user_id,amount_cents,created_at,updated_at) VALUES(?,?,?,?,?)',id,userId,amount,date(),date());
  audit(userId,'payout.requested',id,{amount});return {id,status:'requested',warning:'No payout provider configured; this is a request, not a transfer'};
 });}
 function reviewPayout(actor,id,status){return write(()=>{
  admin(actor);assert(['approved','rejected'].includes(status),422,'Only approval or rejection supported');
  const p=one(db,'SELECT * FROM payout_requests WHERE id=?',id);assert(p&&p.status==='requested',409,'Request not pending');
  run(db,'UPDATE payout_requests SET status=?,updated_at=? WHERE id=?',status,date(),id);
  if(status==='approved')run(db,'INSERT INTO payout_review_authors(request_id,reviewer_id,reviewed_at) VALUES(?,?,?)',id,actor,date());
  audit(actor,'payout.reviewed',id,{status});return {id,status,warning:'No actual payment was sent'};
 });}
 function payoutRequests(userId){return all(db,'SELECT id,amount_cents,status,created_at FROM payout_requests WHERE user_id=? ORDER BY created_at DESC',userId)}
 function createDispute(userId,orgId,subject,detail){return write(()=>{
  member(userId,orgId);subject=cleanText(subject,140);detail=cleanText(detail,3000);
  assert(subject.length>=4&&detail.length>=10,422,'Subject and detail required');
  const id=newId();run(db,'INSERT INTO disputes(id,user_id,org_id,subject,detail,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,userId,orgId,subject,detail,date(),date());audit(userId,'dispute.created',id);return {id,status:'open'};
 });}
 function disputes(userId,orgId){member(userId,orgId);return all(db,'SELECT id,subject,detail,status,resolution,created_at FROM disputes WHERE org_id=? ORDER BY created_at DESC',orgId);}
 function reviewDispute(actor,id,status,resolution){return write(()=>{
  admin(actor);assert(['resolved','rejected'].includes(status),422,'Invalid case resolution');
  const d=one(db,'SELECT id FROM disputes WHERE id=? AND status=?',id,'open');assert(d,409,'Dispute is not open');
  resolution=cleanText(resolution,2000);assert(resolution.length>=5,422,'Resolution is required');
  run(db,'UPDATE disputes SET status=?,resolution=?,updated_at=? WHERE id=?',status,resolution,date(),id);audit(actor,'dispute.reviewed',id,{status});return {id,status};
 });}
 function reviewFraud(actor,id,status){return write(()=>{
  admin(actor);assert(['cleared','confirmed'].includes(status),422,'Invalid fraud decision');
  const f=one(db,'SELECT * FROM fraud_flags WHERE id=? AND status=?',id,'open');assert(f,409,'Flag not open');
  run(db,'UPDATE fraud_flags SET status=?,reviewed_by=?,reviewed_at=? WHERE id=?',status,actor,date(),id);
  if(status==='confirmed'){
   const rows=all(db,"SELECT * FROM referral_rewards WHERE buyer_id=? AND status IN ('pending','payable')",f.buyer_id);
   for(const r of rows){
    if(r.amount_cents)ledgerPair(`fraud.reversal:${r.id}`,`referral_liability:${r.referrer_id}`,'referral_marketing_expense',r.amount_cents);
    run(db,"UPDATE referral_rewards SET amount_cents=0,status='void',updated_at=? WHERE id=?",date(),r.id);
    reconcilePayoutReservations(r.referrer_id);
   }
  }
  audit(actor,'fraud.reviewed',id,{status});return {id,status};
 });}
 function reconcileSettlements(actor,body){return write(()=>{
  admin(actor);assert(body&&typeof body==='object',422,'Reconciliation report required');
  const provider=cleanText(body.provider,50),reportId=cleanText(body.reportId,100);
  assert(/^[A-Za-z0-9_.-]{2,50}$/.test(provider),422,'Provider is required');
  assert(/^[A-Za-z0-9_.:-]{6,100}$/.test(reportId),422,'Report ID invalid');
  const rows=body.rows;assert(Array.isArray(rows)&&rows.length<=2000,422,'Max 2000 settlement entries');
  const keys=new Set();
  const items=rows.map(r=>{
   assert(r&&typeof r.externalId==='string'&&r.externalId.length>=6&&r.externalId.length<=200,422,'Invalid external payment ID');
   assert(Number.isSafeInteger(r.amountCents)&&r.amountCents>0&&Number.isSafeInteger(r.refundedCents)&&r.refundedCents>=0&&r.refundedCents<=r.amountCents,422,'Invalid settlement amounts');
   assert(!keys.has(r.externalId),422,'Duplicate external payment in settlement report');keys.add(r.externalId);
   return {externalId:r.externalId,amountCents:r.amountCents,refundedCents:r.refundedCents};
  }).sort((a,b)=>a.externalId.localeCompare(b.externalId));
  const digest=sha(JSON.stringify({provider,reportId,items,complete:body.complete===true}));
  const old=one(db,'SELECT id,digest,result_json FROM settlement_reports WHERE provider=? AND provider_report_id=?',provider,reportId);
  if(old){assert(old.digest===digest,409,'Report ID was reused with different content','REPORT_COLLISION');return {...JSON.parse(old.result_json),duplicate:true};}
  const local=all(db,`SELECT external_id,amount_cents,refunded_cents FROM payments WHERE provider=?`,provider);
  const byLocal=new Map(local.map(x=>[x.external_id,x]));const mismatches=[];
  for(const r of items){
   const l=byLocal.get(r.externalId);
   if(!l)mismatches.push({type:'missing_in_local',externalId:r.externalId});
   else if(l.amount_cents!==r.amountCents||l.refunded_cents!==r.refundedCents)
    mismatches.push({type:'amount_mismatch',externalId:r.externalId,localCents:l.amount_cents,reportCents:r.amountCents,localRefundedCents:l.refunded_cents,reportRefundedCents:r.refundedCents});
  }
  // A settlement report covers only its supplied IDs unless explicitly marked complete.
  if(body.complete===true){for(const l of local)if(!keys.has(l.external_id))mismatches.push({type:'missing_in_report',externalId:l.external_id});}
  const result={provider,reportId,rows:items.length,localPayments:local.length,complete:body.complete===true,
   matched:items.length-mismatches.filter(m=>m.type!=='missing_in_report').length,mismatchCount:mismatches.length,mismatches,source:'operator_supplied_unverified_report'};
  const id=newId();run(db,`INSERT INTO settlement_reports(id,provider,provider_report_id,digest,row_count,mismatch_count,result_json,created_by,created_at)
   VALUES(?,?,?,?,?,?,?,?,?)`,id,provider,reportId,digest,items.length,mismatches.length,JSON.stringify(result),actor,date());
  audit(actor,'payment.settlement.reconciled',id,{provider,reportId,mismatchCount:mismatches.length,complete:body.complete===true});return {...result,duplicate:false};
 });}
 function settlementReports(actor){admin(actor);return all(db,`SELECT id,provider,provider_report_id,row_count,mismatch_count,created_at FROM settlement_reports ORDER BY created_at DESC LIMIT 100`);}

 function taxAttestation(userId,{country,taxpayerType,confirmed}={}){return write(()=>{
  assert(confirmed===true&&typeof country==='string'&&/^[A-Z]{2}$/.test(country)
   &&['individual','business'].includes(taxpayerType),422,'Valid tax declaration and explicit confirmation required');
  const existing=one(db,'SELECT country,taxpayer_type FROM payout_tax_attestations WHERE user_id=?',userId);
  // Changing declaration invalidates any unused export; a revoked lease can never be reissued.
  if(existing&&(existing.country!==country||existing.taxpayer_type!==taxpayerType)){
   run(db,'UPDATE payout_export_leases SET revoked_at=? WHERE request_id IN (SELECT id FROM payout_requests WHERE user_id=?) AND revoked_at IS NULL',date(),userId);
  }
  run(db,`INSERT INTO payout_tax_attestations(user_id,country,taxpayer_type,declared_at) VALUES(?,?,?,?)
   ON CONFLICT(user_id) DO UPDATE SET country=excluded.country,taxpayer_type=excluded.taxpayer_type,declared_at=excluded.declared_at`,userId,country,taxpayerType,date());
  audit(userId,'payout.tax.attested',userId,{country,taxpayerType,changed:!!existing});
  return {declared:true,country,taxpayerType,notice:'Self-declaration only; external tax verification and lawful payout setup remain required'};
 });}
 function acceptPayoutTerms(userId,{version,accepted}={}){return write(()=>{
  assert(version==='DRAFT_R4'&&accepted===true,422,'Explicit acceptance of current payout terms required');
  run(db,'INSERT OR IGNORE INTO legal_acceptances(user_id,document,version,accepted_at) VALUES(?,?,?,?)',userId,'payout_vendor_terms',version,date());
  audit(userId,'payout.vendor_terms.accepted',userId,{version});return {accepted:true,version,draft:true};
 });}
 function issuePayoutExport(actor,requestId){return write(()=>{
  admin(actor);const p=one(db,'SELECT * FROM payout_requests WHERE id=?',requestId);
  assert(p?.status==='approved',409,'Payout request not approved');
  const prep=one(db,'SELECT * FROM payout_preparations WHERE request_id=?',requestId);
  const first=one(db,'SELECT reviewer_id FROM payout_review_authors WHERE request_id=?',requestId);
  assert(!one(db,'SELECT 1 FROM payout_export_leases WHERE request_id=?',requestId),409,'Export lease already issued; revoked exports cannot be reissued');
  assert(prep?.status==='prepared',409,'Prepared payout is not active');
  assert(prep.second_reviewer_id!==actor&&first?.reviewer_id!==actor&&p.user_id!==actor,403,'Independent third reviewer required');
  const tax=one(db,'SELECT country,taxpayer_type FROM payout_tax_attestations WHERE user_id=?',p.user_id);
  const consent=one(db,"SELECT 1 FROM legal_acceptances WHERE user_id=? AND document='payout_vendor_terms' AND version='DRAFT_R4'",p.user_id);
  assert(tax&&consent,409,'Tax and vendor contract declarations missing','COMPLIANCE_HOLD');
  const checked=complianceStatus(p.user_id);
  assert(checked.emailVerified&&checked.identityStatus==='approved'&&checked.termsAccepted,409,'Prior compliance no longer valid');
  const flag=one(db,`SELECT 1 FROM fraud_flags f JOIN referral_rewards r ON r.buyer_id=f.buyer_id
    WHERE r.referrer_id=? AND f.status IN ('open','confirmed')`,p.user_id);
  assert(!flag,409,'Risk holds prevent export');
  const raw=token(),expiresAt=new Date(Date.parse(date())+15*60*1000).toISOString();
  run(db,'INSERT INTO payout_export_leases(request_id,issued_by,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?)',requestId,actor,sha(raw),date(),expiresAt);
  audit(actor,'payout.export.issued',requestId,{expiresAt,transferEnabled:false,taxCountry:tax.country});
  return {requestId,readToken:raw,expiresAt,nonPayable:true,notice:'Administrative export only; never authorizes or performs a transfer'};
 });}
 function readPayoutExport(actor,requestId,readToken){return write(()=>{
  admin(actor);assert(typeof readToken==='string'&&readToken.length>=30,403,'Invalid export token');
  const x=one(db,'SELECT * FROM payout_export_leases WHERE request_id=? AND token_hash=?',requestId,sha(readToken));
  assert(x&&!x.revoked_at&&!x.consumed_at&&x.expires_at>date(),403,'Lease expired, revoked, consumed or invalid');
  const prep=one(db,'SELECT * FROM payout_preparations WHERE request_id=?',requestId);
  const p=one(db,'SELECT * FROM payout_requests WHERE id=?',requestId);
  assert(prep?.status==='prepared'&&p?.status==='approved',409,'Prepared payout no longer valid');
  const declaration=one(db,'SELECT country,taxpayer_type FROM payout_tax_attestations WHERE user_id=?',p.user_id);
  assert(declaration,409,'Tax declaration missing');
  run(db,'UPDATE payout_export_leases SET consumed_at=? WHERE request_id=?',date(),requestId);
  audit(actor,'payout.export.consumed',requestId,{batchId:prep.batch_id,realTransfer:false});
  return {requestId,batchId:prep.batch_id,digest:prep.digest,recipientId:p.user_id,
   amountCents:p.amount_cents,currency:'RUB',taxCountry:declaration.country,
   taxpayerType:declaration.taxpayer_type,realTransfer:false,bankDetailsIncluded:false,
   draftTerms:true,notice:'This metadata is NOT a bank transfer instruction'};
 });}
 function revokePayoutExport(actor,requestId){return write(()=>{
  admin(actor);const x=one(db,'SELECT * FROM payout_export_leases WHERE request_id=?',requestId);
  assert(x,404,'Export lease not found');
  assert(!x.revoked_at,409,'Export already revoked');
  run(db,'UPDATE payout_export_leases SET revoked_at=? WHERE request_id=?',date(),requestId);
  run(db,"UPDATE payout_preparations SET status='revoked',revoked_at=? WHERE request_id=? AND status='prepared'",date(),requestId);
  audit(actor,'payout.export.revoked',requestId,{permanent:true});
  return {revoked:true,permanent:true};
 });}
 function verificationChallenge(userId,{testMode=false,deliveryMode=false}={}){return write(()=>{
  const prior=one(db,'SELECT verified_at FROM email_challenges WHERE user_id=?',userId);
  if(prior?.verified_at)return {verified:true,alreadyVerified:true};
  assert(testMode===true||deliveryMode===true,503,'Email delivery is not configured; verification disabled','EMAIL_DELIVERY_DISABLED');
  const raw=token();const expiresAt=deliveryMode?new Date(Date.parse(date())+30*60*1000).toISOString():isoAddDays(date(),1);
  run(db,`INSERT INTO email_challenges(user_id,token_hash,expires_at,issued_at,verified_at)
   VALUES(?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,issued_at=excluded.issued_at,verified_at=NULL`,userId,sha(raw),expiresAt,date());
  audit(userId,'email.challenge.created',userId,{testOnly:true});
  return testMode?{testToken:raw,expiresAt,delivery:'LOCAL_TEST_ONLY'}:{transportToken:raw,expiresAt,delivery:'OUTBOUND_PENDING'};
 });}
 function confirmEmailChallenge(raw){return write(()=>{
  assert(typeof raw==='string'&&raw.length<=200,422,'Invalid verification token');
  const item=one(db,'SELECT * FROM email_challenges WHERE token_hash=?',sha(raw));
  assert(item&&item.expires_at>date()&&!item.verified_at,403,'Expired or used verification token','INVALID_TOKEN');
  run(db,'UPDATE email_challenges SET verified_at=? WHERE user_id=?',date(),item.user_id);
  audit(item.user_id,'email.challenge.verified',item.user_id);return {verified:true};
 });}
 function acceptLegalTerms(userId,{document,version,accepted}={}){return write(()=>{
  assert(accepted===true&&document==='referral_terms'&&version==='2026-11',422,'Current legal document and consent required');
  run(db,'INSERT OR IGNORE INTO legal_acceptances(user_id,document,version,accepted_at) VALUES(?,?,?,?)',userId,document,version,date());
  audit(userId,'legal.accepted',userId,{document,version});return {document,version,accepted:true};
 });}
 function requestIdentityReview(userId){return write(()=>{
  const previous=one(db,'SELECT status FROM identity_reviews WHERE user_id=?',userId);
  assert(!previous||previous.status==='rejected',409,'Identity review already exists');
  run(db,`INSERT INTO identity_reviews(user_id,status,created_at) VALUES(?,'requested',?)
    ON CONFLICT(user_id) DO UPDATE SET status='requested',created_at=excluded.created_at,reviewed_by=NULL,reviewed_at=NULL`,userId,date());
  audit(userId,'identity.review.requested',userId);return {status:'requested',notice:'Manual review only; no independent identity provider is connected'};
 });}
 function reviewIdentity(actor,target,status){return write(()=>{
  admin(actor);assert(['approved','rejected'].includes(status),422,'Invalid review');
  assert(actor!==target,403,'Cannot approve own identity');
  const item=one(db,'SELECT status FROM identity_reviews WHERE user_id=?',target);
  assert(item?.status==='requested',409,'Identity review not pending');
  run(db,'UPDATE identity_reviews SET status=?,reviewed_by=?,reviewed_at=? WHERE user_id=?',status,actor,date(),target);
  audit(actor,'identity.review.decided',target,{status});return {userId:target,status,verification:'MANUAL_REVIEW_ONLY'};
 });}
 function complianceStatus(userId){
  const challenge=one(db,'SELECT verified_at FROM email_challenges WHERE user_id=?',userId);
  const identity=one(db,'SELECT status FROM identity_reviews WHERE user_id=?',userId);
  const consent=one(db,"SELECT accepted_at FROM legal_acceptances WHERE user_id=? AND document='referral_terms' AND version='2026-11'",userId);
  const tax=one(db,'SELECT country,taxpayer_type FROM payout_tax_attestations WHERE user_id=?',userId);
  const vendor=one(db,"SELECT 1 FROM legal_acceptances WHERE user_id=? AND document='payout_vendor_terms' AND version='DRAFT_R4'",userId);
  return {emailVerified:!!challenge?.verified_at,identityStatus:identity?.status||'not_requested',termsAccepted:!!consent,
   taxDeclared:!!tax,taxCountry:tax?.country||null,vendorTermsAccepted:!!vendor,realPayoutsEnabled:false};
 }
 function preparePayout(actor,requestId){return write(()=>{
  admin(actor);
  const p=one(db,'SELECT * FROM payout_requests WHERE id=?',requestId);
  assert(p?.status==='approved',409,'Payout not approved');
  const prev=one(db,'SELECT reviewer_id FROM payout_review_authors WHERE request_id=?',requestId);
  assert(prev&&prev.reviewer_id!==actor&&p.user_id!==actor&&prev.reviewer_id!==p.user_id,403,'Two independent external reviewers required');
  assert(!one(db,'SELECT 1 FROM payout_preparations WHERE request_id=?',requestId),409,'Already prepared');
  const status=complianceStatus(p.user_id);
  assert(status.emailVerified&&status.identityStatus==='approved'&&status.termsAccepted,409,'Payout compliance prerequisites missing','COMPLIANCE_HOLD');
  const flagged=one(db,`SELECT 1 FROM referral_rewards r JOIN fraud_flags f ON f.buyer_id=r.buyer_id
    WHERE r.referrer_id=? AND r.status!='void' AND f.status IN ('open','confirmed') LIMIT 1`,p.user_id);
  assert(!flagged,409,'Referral risk not resolved','FRAUD_HOLD');
  const id=newId();const payload={batchId:id,requestId,recipientId:p.user_id,amountCents:p.amount_cents,currency:'RUB',realTransfer:false};
  const hash=sha(JSON.stringify(payload));
  run(db,'INSERT INTO payout_preparations(request_id,second_reviewer_id,batch_id,digest,created_at) VALUES(?,?,?,?,?)',requestId,actor,id,hash,date());
  audit(actor,'payout.manually_prepared',requestId,{batchId:id,digest:hash});return {...payload,digest:hash,notice:'Prepared ONLY. No bank details and no transfer; requires lawful external settlement workflow'};
 });}
 function privacyRequest(userId,kind){return write(()=>{
  assert(['access','erasure'].includes(kind),422,'Invalid privacy request');
  const open=one(db,'SELECT id FROM privacy_requests WHERE user_id=? AND kind=? AND status=?',userId,kind,'open');
  if(open)return {id:open.id,kind,status:'open',duplicate:true};
  const id=newId();run(db,'INSERT INTO privacy_requests(id,user_id,kind,status,created_at) VALUES(?,?,?,?,?)',id,userId,kind,'open',date());
  audit(userId,'privacy.requested',id,{kind});return {id,kind,status:'open',notice:'Manual fulfillment after statutory retention checks'};
 });}
 function selfDataExport(userId){
  const u=userById(userId);assert(u,404,'User missing');
  return {user:u,organizations:orgs(userId),referralCode:one(db,'SELECT code FROM referral_codes WHERE user_id=?',userId)?.code,
    legalAcceptances:all(db,'SELECT document,version,accepted_at FROM legal_acceptances WHERE user_id=?',userId),
    privacyRequests:all(db,'SELECT id,kind,status,created_at FROM privacy_requests WHERE user_id=?',userId),
    payouts:payoutRequests(userId),warnings:['Financial and audit records may be retained under applicable legal obligations']};
 }
 function adminDashboard(userId){admin(userId);
  const count=(table)=>one(db,`SELECT count(*) AS n FROM ${table}`).n;
  return {users:count('users'),organizations:count('organizations'),quotes:count('quotes'),payments:count('payments'),openFraud:one(db,"SELECT count(*) AS n FROM fraud_flags WHERE status='open'").n,openDisputes:one(db,"SELECT count(*) AS n FROM disputes WHERE status='open'").n,requestedPayouts:one(db,"SELECT count(*) AS n FROM payout_requests WHERE status='requested'").n,audit:verifyAudit(),ledger:verifyLedger()};
 }
 function adminLists(userId){admin(userId);return {fraud:all(db,"SELECT id,buyer_id,referrer_id,kind,reason,created_at FROM fraud_flags WHERE status='open' ORDER BY created_at DESC LIMIT 100"),disputes:all(db,"SELECT id,user_id,subject,detail,status,created_at FROM disputes WHERE status='open' ORDER BY created_at DESC LIMIT 100"),payouts:all(db,"SELECT id,user_id,amount_cents,status,created_at FROM payout_requests WHERE status='requested' ORDER BY created_at DESC LIMIT 100")};}
 function auditRecent(userId,limit=50){admin(userId);return all(db,'SELECT seq,actor_user_id,action,entity_id,created_at,event_hash FROM audit_events ORDER BY seq DESC LIMIT ?',Math.min(100,Math.max(1,limit)))}
 function setAdmin(email){return write(()=>{
  const u=one(db,'SELECT id FROM users WHERE email=?',email.toLowerCase());assert(u,404,'Admin user not registered');run(db,'UPDATE users SET is_admin=1 WHERE id=?',u.id);audit(u.id,'admin.enabled',u.id);return u.id;
 });}
 const evidence=createEvidence(db,{member,admin,audit,clock:date,dir:options.evidenceDir,key:options.evidenceKey,scannerSecret:options.scannerSecret});
 const workflow=createWorkflow(db,{member,audit,clock:date,evidence});
 return {workflow,evidence,db,clock,member,admin,orgs,isPro,setLocale,createUser,authenticate,createSession,getSession,revokeSession,createOrganization,invite,acceptInvite,createQuote,updateQuote,quoteStatus,shareQuote,quoteByShare,respondToQuote,getQuote,listQuotes,createInvoice,invoices,subscriptionDetails,changeSubscription,processPaymentEvent,recordCheckoutSession,recordProviderVerification,reconcileSettlements,settlementReports,rewards,settleRewards,requestPayout,reviewPayout,payoutRequests,createDispute,disputes,reviewDispute,reviewFraud,recheckReferral,assessReferralRisk,adminDashboard,adminLists,auditRecent,verifyAudit,verifyLedger,setAdmin,verificationChallenge,confirmEmailChallenge,acceptLegalTerms,acceptPayoutTerms,taxAttestation,issuePayoutExport,readPayoutExport,revokePayoutExport,requestIdentityReview,reviewIdentity,complianceStatus,preparePayout,privacyRequest,selfDataExport};
}
