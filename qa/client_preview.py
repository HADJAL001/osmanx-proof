"""Offline visual rendering of real server-generated customer approval HTML, not a live browser E2E."""
import pathlib,json,urllib.request,time,asyncio,os
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).parent.parent
BASE=os.environ.get('PROOF_BASE','http://127.0.0.1:3100')
ORIGIN=os.environ.get('APP_ORIGIN',BASE)
def request(path,body=None,cookie=None,csrf=None):
    headers={'Origin':ORIGIN}
    if body is not None:headers['Content-Type']='application/json'
    if cookie:headers['Cookie']=cookie
    if csrf:headers['x-csrf-token']=csrf
    req=urllib.request.Request(BASE+path,headers=headers,data=None if body is None else json.dumps(body).encode(),method='GET' if body is None else 'POST')
    with urllib.request.urlopen(req,timeout=5) as res:return res.read().decode(),dict(res.headers)
async def main():
    n=int(time.time()*1000)
    raw,headers=request('/api/auth/register',{'name':'Design Studio','email':f'design_{n}@example.org','password':'SuperStrongPass2026!'})
    reg=json.loads(raw);cookie=next(v for k,v in headers.items() if k.lower()=='set-cookie').split(';')[0];org=reg['organizations'][0]['id'];csrf=reg['csrf']
    payload={'orgId':org,'title':'Разработка корпоративного сайта','clientName':'Atlas Studio','items':[{'description':'Дизайн и разработка','qty':1,'unitPriceCents':14000000,'unitCostCents':6000000},{'description':'Поддержка после запуска','qty':2,'unitPriceCents':1500000,'unitCostCents':350000}],'discountCents':1000000,'taxBps':0}
    raw,_=request('/api/quotes',payload,cookie,csrf);qid=json.loads(raw)['quote']['id']
    raw,_=request('/api/quotes/'+qid+'/share',{},cookie,csrf);url=json.loads(raw)['url'];token=url.split('/s/')[1]
    html,_=request('/s/'+token);css=(ROOT/'public/print.css').read_text()
    html=html.replace('<link rel="stylesheet" href="/print.css">','<style>'+css+'</style>')
    html=html.replace('<script defer src="/print.js"></script>','').replace('<script defer src="/review.js"></script>','')
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=await browser.new_page(viewport={'width':1000,'height':900})
        await page.set_content(html)
        await page.screenshot(path=str(ROOT/'qa/visual_08_client_approval_desktop.png'),full_page=True)
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path=str(ROOT/'qa/visual_09_client_approval_mobile.png'),full_page=True)
        await browser.close()
    print(json.dumps({'visual':'client approval HTML rendered offline','files':['qa/visual_08_client_approval_desktop.png','qa/visual_09_client_approval_mobile.png'],'live_clicks':False},ensure_ascii=False))
if __name__=='__main__':asyncio.run(main())
