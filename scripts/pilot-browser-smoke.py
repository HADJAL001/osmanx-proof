"""Real Chromium smoke on disposable TEST-only local app; no external network or customer data.

Run after `python -m pip install playwright` and `python -m playwright install chromium`.
Never points to staging/production. Captures synthetic screenshots and JSON evidence.
"""
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('OSMANX_SCREENSHOTS', str(ROOT / '.pilot-browser-qa'))).resolve()
OUT.mkdir(parents=True, exist_ok=True)


def await_health(url, process):
    for _ in range(80):
        if process.poll() is not None:
            raise RuntimeError(f'Local test server exited with {process.returncode}')
        try:
            with urllib.request.urlopen(url + '/ready', timeout=2) as response:
                data = json.load(response)
                if response.status == 200 and data.get('ready') is True:
                    return
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError('Private test server did not become ready')


def exercise(browser, url, name, viewport, mobile):
    from playwright.sync_api import expect

    context = browser.new_context(viewport=viewport, is_mobile=mobile, locale='ru-RU')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    result = {'viewport': name, 'checks': [], 'browserErrors': errors}

    def mark(label):
        result['checks'].append(label)

    try:
        page.goto(url + '/', wait_until='networkidle', timeout=25_000)
        expect(page.locator('#authForm input[name="email"]')).to_be_visible()
        expect(page.locator('#authForm input[name="password"]')).to_be_visible()
        mark('anonymous-account-form')
        page.screenshot(path=str(OUT / f'{name}-login.png'), full_page=True)

        stamp = secrets.token_hex(7)
        page.locator('#authForm input[name="name"]').fill('Тестовый предприниматель')
        page.locator('#authForm input[name="email"]').fill(f'qa-{stamp}@example.test')
        page.locator('#authForm input[name="password"]').fill('A-test-only-password-2026!')
        page.locator('#authForm button[type="submit"]').click()
        expect(page.locator('button[data-section="quotes"]').first).to_be_attached(timeout=20_000)
        expect(page.locator('.app')).to_be_visible()
        mark('account-created-and-workspace-visible')
        page.screenshot(path=str(OUT / f'{name}-workspace.png'), full_page=True)

        nav = page.locator('.mobile-nav [data-section="quotes"]' if mobile else '.sidebar [data-section="quotes"]')
        nav.click()
        expect(page.locator('button[data-action="newquote"]').first).to_be_visible()
        page.locator('button[data-action="newquote"]').first.click()
        expect(page.locator('#quoteForm input[name="title"]')).to_be_visible()
        page.locator('#quoteForm input[name="title"]').fill('Проверочная услуга B2B')
        page.locator('#quoteForm input[name="clientName"]').fill('Тестовый заказчик')
        page.locator('#quoteForm input[name="desc"]').fill('Анализ текущего процесса')
        page.locator('#quoteForm input[name="qty"]').fill('1')
        page.locator('#quoteForm input[name="price"]').fill('40000')
        page.locator('#quoteForm input[name="cost"]').fill('18000')
        expect(page.locator('#prevMargin')).to_contain_text('55.0%', timeout=7_000)
        page.locator('#quoteForm button[type="submit"]').click()
        expect(page.locator('table.table')).to_contain_text('Проверочная услуга B2B', timeout=15_000)
        mark('price-cost-margin-and-saved-quote')
        page.screenshot(path=str(OUT / f'{name}-quotes.png'), full_page=True)

        billing = page.locator('.mobile-nav [data-section="billing"]' if mobile else '.sidebar [data-section="billing"]')
        billing.click()
        expect(page.locator('body')).to_contain_text('Без платежей', timeout=15_000)
        # The account has no access to live payment buttons in disabled mode.
        if page.locator('button[data-action="p450demo"]').count():
            raise AssertionError('TEST payment simulator must not appear in disabled mode')
        mark('no-live-money-controls')
        if mobile:
            overflow = page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')
            if overflow:
                raise AssertionError('Mobile horizontal overflow detected')
            mark('mobile-responsive-width')
        page.screenshot(path=str(OUT / f'{name}-billing.png'), full_page=True)
        if errors:
            raise AssertionError('JavaScript page errors: ' + '; '.join(errors[:5]))
        mark('no-unhandled-js-errors')
        result['passed'] = True
        return result
    finally:
        context.close()


def main():
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory(prefix='osmanx-private-browser-') as home:
        env = dict(os.environ)
        env.update({
            'NODE_ENV':'development',
            'PAYMENT_MODE':'disabled',
            'PAYOUTS_ENABLED':'0',
            'HOST':'127.0.0.1',
            'PORT':'32147',
            'APP_ORIGIN':'http://127.0.0.1:32147',
            'DATABASE_PATH':str(Path(home)/'pilot-only.sqlite'),
            'IP_HASH_SECRET':secrets.token_hex(32),
            'METRICS_SECRET':secrets.token_hex(32),
        })
        log = OUT / 'server.log'
        with log.open('wb') as output:
            process = subprocess.Popen(['node','src/server.mjs'],cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT)
            try:
                await_health('http://127.0.0.1:32147',process)
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True,args=['--no-sandbox'])
                    try:
                        results = [
                            exercise(browser,'http://127.0.0.1:32147','desktop',{'width':1440,'height':900},False),
                            exercise(browser,'http://127.0.0.1:32147','mobile',{'width':390,'height':844},True),
                        ]
                    finally:
                        browser.close()
                report={'suite':'OSMANX_R7_REAL_BROWSER_PILOT_SMOKE','status':'PASS',
                        'externalMoney':False,'productionTouched':False,'results':results}
                (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
                print(json.dumps({'status':'PASS','viewports':len(results),'checks':sum(len(x['checks']) for x in results)},ensure_ascii=False))
            except Exception as error:
                report={'suite':'OSMANX_R7_REAL_BROWSER_PILOT_SMOKE','status':'FAIL',
                        'reason':str(error),'externalMoney':False,'productionTouched':False}
                (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
                raise
            finally:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill()

if __name__=='__main__':
    main()
