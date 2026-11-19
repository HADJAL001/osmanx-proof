import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function GET(){
 const backend=process.env.BACKEND_URL||'http://127.0.0.1:3100';
 try{const res=await fetch(new URL('/print.js',backend),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(res.status!==200)return new NextResponse('Asset unavailable',{status:502});
  return new NextResponse(await res.arrayBuffer(),{status:200,headers:{'content-type':'text/javascript; charset=utf-8',
   'cache-control':'private,no-store','x-content-type-options':'nosniff'}});
 }catch{return new NextResponse('Asset unavailable',{status:502})}
}
