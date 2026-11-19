import {NextRequest,NextResponse} from 'next/server';
import {safeReviewToken} from '../../../../../../lib/proxy-policy.mjs';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 if(!safeReviewToken(token))return NextResponse.json({error:'Invalid token'},{status:404});
 const publicOrigin=new URL(req.url).origin;
 const origin=req.headers.get('origin');
 if(origin&&origin!==publicOrigin)return NextResponse.json({error:'Cross-site request rejected'},{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'JSON required'},{status:415});
 const raw=await req.arrayBuffer();
 if(raw.byteLength>8192)return NextResponse.json({error:'Request too large'},{status:413});
 const backend=process.env.BACKEND_URL||'http://127.0.0.1:3100';
 try{
  const res=await fetch(new URL('/api/public/quotes/'+encodeURIComponent(token)+'/respond',backend),{
   method:'POST',headers:{'origin':process.env.APP_ORIGIN||publicOrigin,'content-type':'application/json'},
   body:raw,cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});
  return new NextResponse(await res.arrayBuffer(),{status:res.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
 }catch{return NextResponse.json({error:'Backend unavailable'},{status:502})}
}
