import {NextRequest,NextResponse} from 'next/server';
import {safeReviewToken} from '../../../../../../../../lib/proxy-policy.mjs';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,{params}:{params:Promise<{token:string;milestoneId:string}>}){
 const {token,milestoneId}=await params;
 if(!safeReviewToken(token)||! /^[A-Za-z0-9_-]{1,128}$/.test(milestoneId))return NextResponse.json({error:'Invalid link'},{status:404});
 const clientOrigin=new URL(req.url).origin;
 if(req.headers.get('origin')&&req.headers.get('origin')!==clientOrigin)return NextResponse.json({error:'Cross-origin request rejected'},{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'JSON required'},{status:415});
 const raw=await req.arrayBuffer();if(raw.byteLength>8192)return NextResponse.json({error:'Request too large'},{status:413});
 try{
  const backend=process.env.BACKEND_URL||'http://127.0.0.1:3100';
  const res=await fetch(new URL(`/api/public/projects/${encodeURIComponent(token)}/milestones/${encodeURIComponent(milestoneId)}/respond`,backend),{
   method:'POST',headers:{origin:process.env.APP_ORIGIN||clientOrigin,'content-type':'application/json'},
   body:raw,cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});
  return new NextResponse(await res.arrayBuffer(),{status:res.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Backend unavailable'},{status:502})}
}
