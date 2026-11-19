
'use strict';
(()=>{
 const token=decodeURIComponent(location.pathname.replace(/^\/s\//,''));
 const el=id=>document.getElementById(id);
 let busy=false;
 async function reply(decision){
  if(busy)return;
  const name=el('respond-name').value.trim(),message=el('respond-message').value.trim();
  const feedback=el('respond-feedback');
  if(name.length<2||!el('respond-consent').checked||(decision==='changes_requested'&&message.length<5)){
   feedback.textContent='Укажите имя, подтвердите согласие и поясните необходимые изменения / Please complete the fields.';return;
  }
  busy=true;feedback.textContent='Сохранение / Saving…';
  try{
   const r=await fetch('/api/public/quotes/'+encodeURIComponent(token)+'/respond',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,message,decision,consent:true})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Server error');
   feedback.textContent=decision==='accepted'?'Ответ принят. Спасибо. / Response recorded.':'Запрос изменений сохранён. / Changes requested.';
   el('respond-accept').disabled=true;el('respond-changes').disabled=true;
  }catch(e){feedback.textContent=e.message;busy=false;}
 }
 el('respond-accept')?.addEventListener('click',()=>reply('accepted'));
 el('respond-changes')?.addEventListener('click',()=>reply('changes_requested'));
})();
