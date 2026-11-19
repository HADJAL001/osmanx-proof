import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function GET(){
 const base=process.env.BACKEND_URL||'http://127.0.0.1:3100';
 try{
  const response=await fetch(new URL('/client.js',base),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return new NextResponse('Unavailable',{status:502});
  return new NextResponse(await response.arrayBuffer(),{status:200,headers:{'content-type':'text/javascript; charset=utf-8','x-content-type-options':'nosniff','cache-control':'no-store'}});
 }catch{return new NextResponse('Backend unavailable',{status:502})}
}
