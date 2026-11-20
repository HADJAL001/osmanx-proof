import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:Promise<{token:string;milestoneId:string}>}){
 const {token,milestoneId}=await params;
 if(!/^[A-Za-z0-9_-]{30,200}$/.test(token)||!/^[A-Za-z0-9_-]{1,128}$/.test(milestoneId))return NextResponse.json({error:'Invalid link'},{status:404});
 const base=process.env.BACKEND_URL||'http://127.0.0.1:3100';
 try{
  const url=new URL(`/api/public/projects/${encodeURIComponent(token)}/milestones/${encodeURIComponent(milestoneId)}/receipt`,base);
  const r=await fetch(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)});
  return new NextResponse(await r.arrayBuffer(),{status:r.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
 }catch{return NextResponse.json({error:'Receipt unavailable'},{status:502,headers:{'cache-control':'no-store'}})}
}
