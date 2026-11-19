"""Offline Chromium visual checks using mock presentation data.
Does not replace real server-backed browser acceptance testing.
"""
import asyncio, json, pathlib
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).parent.parent
OUT=ROOT/'qa'
CSS=(ROOT/'public/styles.css').read_text()
JS=(ROOT/'public/app.js').read_text().split('\n(async()=>{try{await loadMe();')[0]

async def main():
 results={'type':'offline_visual_mock','screenshots':[],'browserErrors':[],'remarks':'Chromium blocks network navigation in this runtime; live HTTP behavior is tested separately using Node tests.'}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
  page.on('pageerror',lambda error:results['browserErrors'].append(str(error)))
  await page.set_content('<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>'+CSS+'</style></head><body><div id="root"></div><script>'+JS+'</script></body></html>')
  await page.evaluate('render()')
  async def shot(file):
   await page.wait_for_timeout(450)
   await page.screenshot(path=str(OUT/file),full_page=True)
   results['screenshots'].append(file)
  await shot('visual_01_auth.png')
  await page.evaluate('''() => {
    state.me={authenticated:true,isDemo:true,paymentMode:'sandbox',proPriceCents:129000,user:{id:'DEMO-USER',display_name:'Демонстрационный аккаунт',email:'demo@example.com',is_admin:1,locale:'ru'},organizations:[{id:'ORG',name:'ATLAS STUDIO',role:'owner',plan:'pro',active_until:'2026-12-19T15:00:00.000Z'}],csrf:'test'};
    state.orgId='ORG';state.section='overview';state.cache={quotes:[{id:'Q1',title:'Корпоративный сайт Atlas',client_name:'Atlas Studio',status:'sent',updated_at:'2026-11-19T16:00:00.000Z'},{id:'Q2',title:'Консультация и UX-аудит',client_name:'Nova Labs',status:'accepted',updated_at:'2026-11-17T16:00:00.000Z'}],invoices:[{id:'INV',total_cents:129000,status:'paid',created_at:'2026-11-18T16:00:00.000Z'}],referrals:{totalCents:11610,pendingCents:11610,payableCents:0,availableCents:0,rows:[],code:'PROOF2026',referralUrl:'https://example.test/?ref=PROOF2026'},disputes:[]};
    render();
  }''')
  await shot('visual_02_dashboard.png')
  await page.evaluate('''() => {state.section='quotes';state.editingQuote={};render()}''')
  await shot('visual_03_proposal_editor.png')
  await page.evaluate('''() => {state.section='billing';state.editingQuote=null;state.cache.invoices=[{id:'INV-TEST',total_cents:129000,discount_cents:0,status:'paid',created_at:'2026-11-18T16:00:00.000Z'}];render()}''')
  await shot('visual_04_billing.png')
  await page.evaluate('''() => {state.section='referrals';render()}''')
  await shot('visual_05_referrals.png')
  await page.set_viewport_size({'width':390,'height':844})
  await page.evaluate('''() => {state.section='overview';render()}''')
  await shot('visual_06_mobile_overview.png')
  await page.evaluate('''() => {state.section='quotes';state.editingQuote={};render()}''')
  await shot('visual_07_mobile_editor.png')
  await browser.close()
 (OUT/'visual_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print(json.dumps(results,ensure_ascii=False,indent=2))
 if results['browserErrors']: raise SystemExit('Browser JS errors detected')

if __name__=='__main__':asyncio.run(main())
