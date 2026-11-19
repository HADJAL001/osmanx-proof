'use strict';
// Client acknowledgement only; never request sensitive details or payment information.
document.addEventListener('submit',async event=>{
 const form=event.target.closest('form[data-milestone]');if(!form)return;
 event.preventDefault();const result=form.querySelector('.result');
 const submitter=event.submitter;const decision=submitter?.dataset.decision;
 const data=new FormData(form);
 const body={name:data.get('name'),message:data.get('message')||'',submissionRevision:Number(data.get('submissionRevision')),
  consent:data.get('consent')==='on',decision};
 if(!body.consent){result.textContent='Consent is required';return}
 const token=location.pathname.split('/')[2],milestoneId=form.dataset.milestone;
 for(const button of form.querySelectorAll('button'))button.disabled=true;
 try{
  const response=await fetch(`/api/public/projects/${encodeURIComponent(token)}/milestones/${encodeURIComponent(milestoneId)}/respond`,
   {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const x=await response.json();if(!response.ok)throw Error(x.error||'Response could not be saved');
  result.textContent='Ответ сохранён / Response recorded';form.querySelector('.actions').remove();
 }catch(e){result.textContent=e.message;for(const button of form.querySelectorAll('button'))button.disabled=false}
});
