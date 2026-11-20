import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const COLUMNS=Object.freeze(['lead_id','channel','qualified','proposal_sent','proposal_accepted','paid_confirmed','delivered','client_accepted','refund_cents','price_cents','delivery_cents','tax_cents','fees_cents','partner_commission_cents','test_only']);
function csvRows(src){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<src.length;i++){const c=src[i];if(quoted){if(c==='"'&&src[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else{if(c==='"'&&cell==='')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;}}if(quoted)throw Error('Unclosed CSV quote');if(cell!==''||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows.filter(r=>!(r.length===1&&!r[0].trim()));}
function yes(v,label){if(v==='1')return true;if(v==='0')return false;throw Error('Invalid boolean 0/1 for '+label);}
function cents(v,label){const n=Number(v);if(!/^\d+$/.test(v)||!Number.isSafeInteger(n))throw Error('Invalid cents: '+label);return n;}
export function analyzeCsv(text){const rows=csvRows(text.replace(/^\ufeff/,''));if(!rows.length)throw Error('Empty CSV');if(rows[0].join(',')!==COLUMNS.join(','))throw Error('Strict anonymized CSV header required');
 const ids=new Set();const samples=[];
 for(const [i,vals] of rows.slice(1).entries()){
  if(vals.length!==COLUMNS.length)throw Error('Wrong column count in row '+(i+2));const r=Object.fromEntries(COLUMNS.map((n,j)=>[n,vals[j]]));
  if(!/^[A-Za-z0-9_-]{5,64}$/.test(r.lead_id)||ids.has(r.lead_id))throw Error('Missing or duplicated anonymous ID');ids.add(r.lead_id);
  if(!/^[A-Za-z0-9 _,\/-]{2,40}$/.test(r.channel))throw Error('Invalid channel (no personal data)');
  for(const k of COLUMNS.slice(2,8).concat(['test_only']))r[k]=yes(r[k],k);
  for(const k of COLUMNS.slice(8,14))r[k]=cents(r[k],k);
  const chain=['qualified','proposal_sent','proposal_accepted','paid_confirmed','delivered','client_accepted'];
  for(let n=1;n<chain.length;n++)if(r[chain[n]]&&!r[chain[n-1]])throw Error('Impossible funnel transition in row '+(i+2));
  if(r.paid_confirmed&&r.price_cents===0)throw Error('Paid order without price');
  if(!r.paid_confirmed&&[r.refund_cents,r.price_cents,r.delivery_cents,r.tax_cents,r.fees_cents,r.partner_commission_cents].some(x=>x!==0))throw Error('Unpaid lead contains money values');
  if(r.refund_cents>r.price_cents)throw Error('Refund larger than price');
  if(r.partner_commission_cents>Math.floor((r.price_cents-r.refund_cents)*0.10))throw Error('Commission exceeds R7 10% ceiling');
  samples.push(r);
 }
 const live=samples.filter(r=>!r.test_only),trial=samples.filter(r=>r.test_only);const paid=live.filter(r=>r.paid_confirmed),accepted=live.filter(r=>r.client_accepted);
 const gross=paid.reduce((s,r)=>s+r.price_cents,0),refund=paid.reduce((s,r)=>s+r.refund_cents,0);
 const cost=paid.reduce((s,r)=>s+r.delivery_cents+r.tax_cents+r.fees_cents+r.partner_commission_cents,0);
 const summary={format:'OSMANX_PILOT_AGGREGATES_V1',source:'self-reported anonymous CSV, not provider-verified',liveLeads:live.length,testLeadsExcluded:trial.length,
  qualified:live.filter(r=>r.qualified).length,proposals:live.filter(r=>r.proposal_sent).length,
  proposalAcceptances:live.filter(r=>r.proposal_accepted).length,paidOrders:paid.length,delivered:live.filter(r=>r.delivered).length,clientAccepted:accepted.length,
  grossPaidCents:gross,refundCents:refund,trackedCostsCents:cost,estimatedContributionCents:gross-refund-cost,
  qualifiedToPaidRate:live.filter(r=>r.qualified).length?paid.length/live.filter(r=>r.qualified).length:null,
  paymentsVerifiedExternally:false,realMerchantLedgerReconciled:false,privacy:'No raw lead identifiers are emitted'};
 return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const file=process.argv[2];if(!file)throw Error('Use: node scripts/pilot-metrics.mjs file.csv');console.log(JSON.stringify(analyzeCsv(readFileSync(file,'utf8')),null,2));}
 catch(e){console.error('Metrics rejected:',e.message);process.exitCode=2;}
}
