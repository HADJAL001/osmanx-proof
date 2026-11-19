import { timingSafeEqual } from 'node:crypto';
export function secureMetricsToken(given,secret){
 if(typeof given!=='string'||typeof secret!=='string'||secret.length<32)return false;
 const supplied=given.startsWith('Bearer ')?given.slice(7):'';
 const a=Buffer.from(supplied),b=Buffer.from(secret);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function createMetrics(){
 const started=process.hrtime.bigint(), counters=new Map(), latency=new Map();
 function observe(method,path,status,elapsedMs){
  // Do not index route URLs with user IDs or public tokens. Fixed route class only.
  const route=path.startsWith('/api/')?'api':path.startsWith('/s/')?'public_quote':path.startsWith('/ops/')?'ops':path==='/ready'?'ready':path==='/health'?'health':'static';
  const methodClass=['GET','POST','PATCH','PUT','DELETE'].includes(method)?method:'OTHER';const group=`${route}|${methodClass}|${Math.floor(status/100)}xx`;
  counters.set(group,(counters.get(group)||0)+1);const hist=latency.get(group)||{count:0,total:0};hist.count++;hist.total+=Math.round(elapsedMs*1000)/1000;latency.set(group,hist);
 }
 function snapshot(){return {uptimeSeconds:Number(process.hrtime.bigint()-started)/1e9,requests:Object.fromEntries(counters),averageLatencyMs:Object.fromEntries([...latency].map(([k,v])=>[k,v.total/v.count]))}}
 function prometheus(){
  const x=snapshot(),lines=['# HELP osx_uptime_seconds Process uptime seconds','# TYPE osx_uptime_seconds gauge',`osx_uptime_seconds ${x.uptimeSeconds.toFixed(3)}`,'# HELP osx_requests_total HTTP responses by broad route class','# TYPE osx_requests_total counter'];
  for(const [group,n] of counters){const [route,method,status]=group.split('|');lines.push(`osx_requests_total{route="${route}",method="${method}",status="${status}"} ${n}`)}
  return lines.join('\n')+'\n';
 }
 return {observe,snapshot,prometheus};
}
