import { one, all, run, transaction } from './db.mjs';
import { token, sha, newId, isoAddDays, cleanText, assert } from './security.mjs';

// R5 workflow is independent of Stripe and referrals. A customer may use it without referrals.
export function createWorkflow(db,{member,audit,clock}){
 const stamp=()=>clock();
 const write=fn=>transaction(db,fn);
 const projectFor=(actor,projectId,allowed=['owner','editor','viewer'])=>{
  const p=one(db,'SELECT * FROM work_projects WHERE id=?',projectId);
  assert(p,404,'Project not found');member(actor,p.org_id,allowed);return p;
 };
 const milestoneFor=(actor,projectId,milestoneId,allowed=['owner','editor','viewer'])=>{
  const p=projectFor(actor,projectId,allowed);
  const m=one(db,'SELECT * FROM work_milestones WHERE project_id=? AND id=?',projectId,milestoneId);
  assert(m,404,'Milestone not found');return {p,m};
 };
 const listMilestones=projectId=>all(db,`SELECT m.id,m.position,m.title,m.description,m.due_at AS dueAt,m.status,m.version,
  m.created_at AS createdAt,m.updated_at AS updatedAt,
  s.revision AS submittedRevision,s.summary AS submittedSummary,s.content_hash AS contentHash,s.created_at AS submittedAt,
  r.decision AS clientDecision,r.responder_name AS responderName,r.message AS clientMessage,r.created_at AS respondedAt
  FROM work_milestones m LEFT JOIN work_submissions s ON s.id=(SELECT id FROM work_submissions
    WHERE milestone_id=m.id ORDER BY revision DESC LIMIT 1)
  LEFT JOIN work_client_responses r ON r.milestone_id=m.id AND r.submission_revision=s.revision
  WHERE m.project_id=? ORDER BY m.position`,projectId);
 const serial=p=>{
  const milestones=listMilestones(p.id);
  const total=milestones.length,accepted=milestones.filter(m=>m.status==='accepted').length;
  return {id:p.id,orgId:p.org_id,quoteId:p.quote_id,title:p.title,clientName:p.client_name,
   quoteRevision:p.quote_revision,totalCents:p.total_cents,status:p.status,
   createdAt:p.created_at,updatedAt:p.updated_at,milestones,progress:{accepted,total,percentage:total?Math.round(accepted*100/total):0}};
 };
 function launch(actor,quoteId){return write(()=>{
  const q=one(db,'SELECT * FROM quotes WHERE id=?',quoteId);
  assert(q,404,'Quote not found');member(actor,q.org_id,['owner','editor']);
  assert(q.status==='accepted',409,'Only accepted quotes can start a project','QUOTE_NOT_ACCEPTED');
  const accepted=one(db,`SELECT r.id,r.revision FROM quote_responses r JOIN quote_versions v ON v.quote_id=r.quote_id
   WHERE r.quote_id=? AND r.decision='accepted' AND r.revision=v.revision`,quoteId);
  assert(accepted,409,'Client acceptance is required; manual status is not sufficient','CLIENT_ACCEPTANCE_REQUIRED');
  assert(!one(db,'SELECT id FROM work_projects WHERE quote_id=?',quoteId),409,'Project already launched','ALREADY_LAUNCHED');
  const items=all(db,'SELECT qty,unit_price_cents,unit_cost_cents FROM quote_items WHERE quote_id=?',quoteId);
  let subtotal=0;for(const item of items)subtotal+=item.qty*item.unit_price_cents;
  const discounted=subtotal-q.discount_cents;
  const tax=Math.round(discounted*q.tax_bps/10000);
  const total=discounted+tax;
  assert(Number.isSafeInteger(total)&&total>=0,422,'Invalid quote total');
  const id=newId();run(db,`INSERT INTO work_projects(id,org_id,quote_id,quote_revision,accepted_response_id,title,client_name,total_cents,created_by,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,id,q.org_id,q.id,accepted.revision,accepted.id,q.title,q.client_name,total,actor,stamp(),stamp());
  audit(actor,'work.project.started',id,{quoteId,acceptanceId:accepted.id,quoteRevision:accepted.revision});
  return serial(one(db,'SELECT * FROM work_projects WHERE id=?',id));
 });}
 function list(actor,orgId){member(actor,orgId);return all(db,`SELECT p.id,p.quote_id AS quoteId,p.title,p.client_name AS clientName,p.total_cents AS totalCents,p.status,p.updated_at AS updatedAt,
 (SELECT count(*) FROM work_milestones m WHERE m.project_id=p.id) AS milestoneCount,
 (SELECT count(*) FROM work_milestones m WHERE m.project_id=p.id AND m.status='accepted') AS acceptedCount
 FROM work_projects p WHERE p.org_id=? ORDER BY p.updated_at DESC LIMIT 200`,orgId);}
 function details(actor,projectId){return serial(projectFor(actor,projectId));}
 function createMilestone(actor,projectId,data){return write(()=>{
  const p=projectFor(actor,projectId,['owner','editor']);assert(p.status==='active',409,'Project is not active');
  const title=cleanText(data?.title,140),description=cleanText(data?.description,1500);
  assert(title.length>=2,422,'Milestone title required');
  const dueAt=data?.dueAt||null;
  assert(dueAt===null||(typeof dueAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(dueAt)&&!Number.isNaN(Date.parse(dueAt))),422,'Valid ISO dueAt required');
  const pos=one(db,'SELECT COALESCE(MAX(position),0) AS n FROM work_milestones WHERE project_id=?',projectId).n+1;
  assert(pos<=50,422,'Maximum 50 milestones per project');
  const id=newId();run(db,`INSERT INTO work_milestones(id,project_id,position,title,description,due_at,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?)`,id,projectId,pos,title,description,dueAt,stamp(),stamp());
  run(db,'UPDATE work_projects SET updated_at=? WHERE id=?',stamp(),projectId);
  audit(actor,'work.milestone.created',id,{projectId,position:pos});return serial(p);
 });}
 function updateMilestone(actor,projectId,milestoneId,data){return write(()=>{
  const {p,m}=milestoneFor(actor,projectId,milestoneId,['owner','editor']);
  assert(p.status==='active'&&['planned','in_progress','changes_requested'].includes(m.status),409,'Milestone locked after submission');
  assert(Number.isSafeInteger(data?.expectedVersion)&&data.expectedVersion===m.version,409,'Milestone changed; reload before editing','STALE_MILESTONE');
  const title=cleanText(data.title,140),description=cleanText(data.description,1500);
  assert(title.length>=2,422,'Milestone title required');
  const dueAt=data.dueAt||null;
  assert(dueAt===null||(typeof dueAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(dueAt)&&!Number.isNaN(Date.parse(dueAt))),422,'Valid dueAt required');
  run(db,'UPDATE work_milestones SET title=?,description=?,due_at=?,version=version+1,updated_at=? WHERE id=?',title,description,dueAt,stamp(),milestoneId);
  audit(actor,'work.milestone.updated',milestoneId,{projectId,expectedVersion:m.version});
  return serial(p);
 });}
 function submitMilestone(actor,projectId,milestoneId,body){return write(()=>{
  const {p,m}=milestoneFor(actor,projectId,milestoneId,['owner','editor']);
  assert(p.status==='active'&&['planned','in_progress','changes_requested'].includes(m.status),409,'Milestone is not available for submission');
  const summary=cleanText(body?.summary,2000);assert(summary.length>=10,422,'Submission summary must describe delivered work');
  const revision=one(db,'SELECT COALESCE(MAX(revision),0) AS n FROM work_submissions WHERE milestone_id=?',milestoneId).n+1;
  const contentHash=sha(JSON.stringify({milestoneId,revision,title:m.title,summary}));
  run(db,'INSERT INTO work_submissions(id,milestone_id,revision,summary,content_hash,submitted_by,created_at) VALUES(?,?,?,?,?,?,?)',newId(),milestoneId,revision,summary,contentHash,actor,stamp());
  run(db,"UPDATE work_milestones SET status='submitted',version=version+1,updated_at=? WHERE id=?",stamp(),milestoneId);
  audit(actor,'work.milestone.submitted',milestoneId,{projectId,revision,contentHash});return serial(p);
 });}
 function share(actor,projectId){return write(()=>{
  const p=projectFor(actor,projectId,['owner','editor']);
  run(db,'UPDATE work_client_shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL',stamp(),p.id);
  const raw=token(),id=newId(),expiresAt=isoAddDays(stamp(),30);
  run(db,'INSERT INTO work_client_shares(id,project_id,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)',id,p.id,sha(raw),expiresAt,actor,stamp());
  audit(actor,'work.client_share.created',p.id,{shareId:id,expiresAt});return {token:raw,shareId:id,expiresAt};
 });}
 function revoke(actor,projectId,shareId){return write(()=>{
  projectFor(actor,projectId,['owner','editor']);
  const item=one(db,'SELECT revoked_at FROM work_client_shares WHERE id=? AND project_id=?',shareId,projectId);
  assert(item&&!item.revoked_at,404,'Active share not found');
  run(db,'UPDATE work_client_shares SET revoked_at=? WHERE id=?',stamp(),shareId);
  audit(actor,'work.client_share.revoked',projectId,{shareId});return {revoked:true};
 });}
 const validShare=raw=>{
  assert(typeof raw==='string'&&raw.length>=30&&raw.length<=256,404,'Client link unavailable');
  const share=one(db,'SELECT * FROM work_client_shares WHERE token_hash=?',sha(raw));
  assert(share&&!share.revoked_at&&share.expires_at>stamp(),404,'Client link unavailable');
  return share;
 };
 function publicDetails(raw){
  const share=validShare(raw),p=one(db,'SELECT * FROM work_projects WHERE id=?',share.project_id);
  const milestones=listMilestones(p.id).map(m=>({id:m.id,title:m.title,description:m.description,dueAt:m.dueAt,
   status:m.status,submittedRevision:m.submittedRevision,submittedSummary:m.submittedSummary,
   clientDecision:m.clientDecision,clientMessage:m.clientMessage}));
  return {id:p.id,title:p.title,clientName:p.client_name,status:p.status,milestones,
   expiresAt:share.expires_at,notice:'Token-based acknowledgement only; not a verified electronic signature'};
 }
 function respond(raw,milestoneId,body,fingerprintHash=''){return write(()=>{
  const share=validShare(raw),p=one(db,'SELECT * FROM work_projects WHERE id=?',share.project_id);
  assert(p.status==='active',409,'Project is not open for approval');
  const m=one(db,'SELECT * FROM work_milestones WHERE id=? AND project_id=?',milestoneId,p.id);
  assert(m&&m.status==='submitted',409,'Milestone is not awaiting a client response');
  const s=one(db,'SELECT * FROM work_submissions WHERE milestone_id=? ORDER BY revision DESC LIMIT 1',milestoneId);
  assert(s&&body?.submissionRevision===s.revision,409,'The submitted version changed','STALE_SUBMISSION');
  const decision=body.decision,name=cleanText(body.name,120),message=cleanText(body.message,1600);
  assert(body.consent===true&&['accepted','changes_requested'].includes(decision)&&name.length>=2,422,'Explicit client response required');
  if(decision==='changes_requested')assert(message.length>=5,422,'Describe the requested changes');
  const id=newId();run(db,`INSERT INTO work_client_responses(id,milestone_id,submission_revision,share_id,decision,responder_name,message,fingerprint_hash,created_at)
   VALUES(?,?,?,?,?,?,?,?,?)`,id,milestoneId,s.revision,share.id,decision,name,message,fingerprintHash||null,stamp());
  run(db,'UPDATE work_milestones SET status=?,version=version+1,updated_at=? WHERE id=?',decision==='accepted'?'accepted':'changes_requested',stamp(),milestoneId);
  const outstanding=one(db,"SELECT COUNT(*) AS n FROM work_milestones WHERE project_id=? AND status!='accepted'",p.id).n;
  const total=one(db,'SELECT COUNT(*) AS n FROM work_milestones WHERE project_id=?',p.id).n;
  if(total>0&&outstanding===0)run(db,"UPDATE work_projects SET status='completed',updated_at=? WHERE id=?",stamp(),p.id);
  else run(db,'UPDATE work_projects SET updated_at=? WHERE id=?',stamp(),p.id);
  audit(null,'work.milestone.client_response',milestoneId,{projectId:p.id,revision:s.revision,decision,submissionHash:s.content_hash});
  return {responseId:id,decision,submissionRevision:s.revision,projectCompleted:total>0&&outstanding===0,
   notice:'Response recorded by link holder; identity not independently verified'};
 });}
 function metrics(actor,orgId){member(actor,orgId);
  const values=one(db,`SELECT COUNT(*) AS projects,COALESCE(SUM(total_cents),0) AS contractedValueCents,
   COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed,
   COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) AS active
   FROM work_projects WHERE org_id=?`,orgId);
  const counts=one(db,`SELECT COUNT(*) AS milestones,COALESCE(SUM(CASE WHEN m.status='accepted' THEN 1 ELSE 0 END),0) AS accepted
   FROM work_milestones m JOIN work_projects p ON p.id=m.project_id WHERE p.org_id=?`,orgId);
  return {...values,...counts,completionRate:counts.milestones?Math.round(counts.accepted*100/counts.milestones):0,
   disclaimer:'Contracted proposal value is not recognized revenue or cash received'};
 }
 function exportRows(actor,orgId){member(actor,orgId,['owner','editor']);return all(db,`SELECT p.id,p.title,p.client_name,p.status,p.total_cents,p.updated_at,
  COUNT(m.id) AS milestones,COALESCE(SUM(CASE WHEN m.status='accepted' THEN 1 ELSE 0 END),0) AS accepted
  FROM work_projects p LEFT JOIN work_milestones m ON m.project_id=p.id
  WHERE p.org_id=? GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 5000`,orgId);}
 return {launch,list,details,createMilestone,updateMilestone,submitMilestone,share,revoke,publicDetails,respond,metrics,exportRows};
}
