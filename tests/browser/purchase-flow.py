"""Browser regressions for the purchase wizard; all external services are mocked.
Run: python tests/browser/purchase-flow.py
Requires Node 24, Python playwright, and Chromium (system or playwright-installed).
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PORT = os.environ.get('PURCHASE_TEST_PORT', '4173')
ORIGIN = 'http://127.0.0.1:' + PORT
PADDLE = """window.Paddle={Environment:{set(){}},Initialize(c){window.testCallback=c.eventCallback},Checkout:{open(){window.testOpens=(window.testOpens||0)+1}}};"""
TURNSTILE = """window.turnstile={render(selector,config){const element=document.querySelector(selector);if(!element.getClientRects().length)throw Error('Verification rendered in a hidden step');window.testTurnstile=config;setTimeout(()=>config.callback('synthetic-proof'),10);return 0},reset(){setTimeout(()=>window.testTurnstile.callback('synthetic-proof'),10)}};"""


def screenshot(page, name):
    folder = os.environ.get("PURCHASE_TEST_SCREENSHOTS")
    if folder:
        target = Path(folder)
        target.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(target / (name + "-" + str(page.viewport_size["width"]) + ".png")), full_page=True)


def mock_providers(page):
    page.route('https://cdn.paddle.com/**', lambda r: r.fulfill(content_type='application/javascript', body=PADDLE))
    page.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(content_type='application/javascript', body=TURNSTILE))


def download_key(page, button):
    with page.expect_download() as result:
        page.get_by_role('button', name=button, exact=True).click()
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'synthetic-key.txt'
        result.value.save_as(target)
        assert len(target.read_text()) == 43


def checkout_test(browser, width, dark):
    context = browser.new_context(viewport={'width': width, 'height': 900}, color_scheme='dark' if dark else 'light')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    mock_providers(page)
    attempts = []
    active = [False]
    page.route('**/api/supporter/checkout', lambda r: r.continue_() if r.request.method == 'GET' else (attempts.append(r.request.headers.get('authorization')), r.fulfill(json={'transaction_id': 'txn_' + 'a' * 26})))
    page.route('**/api/supporter/entitlement', lambda r: r.fulfill(status=200 if active[0] else 403, json={'entitlement': 'synthetic-token'} if active[0] else {'error': 'Purchase not active'}))
    page.goto(ORIGIN + '/api/supporter/checkout?_ptxn=ignored&success=true')
    expect(page.locator('#key-step')).to_be_visible()
    expect(page.locator('#pay-step')).to_be_hidden()
    expect(page.locator('#save-confirmation')).to_be_hidden()
    assert page.url == ORIGIN + '/api/supporter/checkout'
    assert page.evaluate('window.testOpens || 0') == 0
    screenshot(page, 'checkout-key-' + ('dark' if dark else 'light'))
    original = page.locator('#recovery').input_value()
    download_key(page, 'Save purchase key')
    page.get_by_role('checkbox', name='I have saved my purchase key.', exact=True).check()
    expect(page.locator('#pay-step')).to_be_visible()
    expect(page.get_by_role('button', name='Continue to payment', exact=True)).to_be_enabled()
    page.get_by_role('button', name='Back to purchase key', exact=True).click()
    expect(page.locator('#key-step')).to_be_visible()
    page.get_by_role('button', name='Continue with saved key', exact=True).click()
    expect(page.locator('#pay-step')).to_be_visible()
    screenshot(page, 'checkout-payment-' + ('dark' if dark else 'light'))
    page.get_by_role('button', name='Continue to payment', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Finish your test payment')
    assert len(attempts) == 1 and attempts[0] == 'Bearer ' + original
    # A browser success callback is never sufficient to show ownership.
    page.evaluate("window.testCallback({name:'checkout.completed'})")
    expect(page.locator('#done-step')).to_be_hidden()
    active[0] = True
    page.get_by_role('button', name='Check purchase', exact=True).click()
    expect(page.get_by_role('heading', name='Purchase confirmed', exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    screenshot(page, 'checkout-confirmed-' + ('dark' if dark else 'light'))
    page.reload()
    assert page.locator('#recovery').input_value() == original
    expect(page.locator('#key-step')).to_be_visible()
    expect(page.locator('#pay-step')).to_be_hidden()
    assert not errors, errors
    context.close()


def recovery_test(browser, width, outcome):
    context = browser.new_context(viewport={'width': width, 'height': 900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    mock_providers(page)
    requests, redemptions = [], []
    page.route('**/api/supporter/recovery', lambda r: r.continue_() if r.request.method == 'GET' else (requests.append(json.loads(r.request.post_data)), r.fulfill(status=202, json={'queued': True})))
    def redeem(route):
        redemptions.append(json.loads(route.request.post_data))
        if outcome == 'interrupted':
            route.abort()
        else:
            route.fulfill(status=200 if outcome == 'success' else 403, json={})
    page.route('**/api/supporter/recovery/redeem', redeem)
    page.goto(ORIGIN + '/api/supporter/recovery')
    expect(page.locator('#email-step')).to_be_visible()
    expect(page.locator('#verify-step')).to_be_hidden()
    expect(page.locator('#key-step')).to_be_hidden()
    screenshot(page, 'recovery-email-' + outcome)
    expect(page.get_by_role('button', name='Send recovery email', exact=True)).to_be_enabled()
    page.get_by_role('textbox', name='Purchase email', exact=True).fill('tester@example.test')
    page.get_by_role('textbox', name='Purchase email', exact=True).press('Enter')
    expect(page.locator('#verify-step')).to_be_visible()
    screenshot(page, 'recovery-code-' + outcome)
    assert requests == [{'email': 'tester@example.test'}]
    page.get_by_role('textbox', name='Code from your email', exact=True).fill('too short')
    page.get_by_role('button', name='Continue', exact=True).click()
    assert not redemptions
    expect(page.get_by_role('status')).to_contain_text('full code')
    page.get_by_role('textbox', name='Code from your email', exact=True).fill('c' * 43)
    page.get_by_role('textbox', name='Code from your email', exact=True).press('Enter')
    expect(page.locator('#key-step')).to_be_visible()
    expect(page.get_by_role('button', name='Restore purchase', exact=True)).to_be_hidden()
    screenshot(page, 'recovery-key-' + outcome)
    download_key(page, 'Save new purchase key')
    page.get_by_role('checkbox', name='I have saved my new purchase key.', exact=True).check()
    page.get_by_role('button', name='Restore purchase', exact=True).click()
    if outcome == 'success':
        expect(page.get_by_role('heading', name="You're all set", exact=True)).to_be_visible()
        assert page.evaluate("sessionStorage.getItem('actua-sandbox-recovery')") == redemptions[0]['recovery_code']
        assert page.evaluate("sessionStorage.getItem('actua-sandbox-replacement')") is None
    else:
        expect(page.locator('#interrupted')).to_be_visible()
        expect(page.locator('#done-step')).to_be_hidden()
        assert page.evaluate("sessionStorage.getItem('actua-sandbox-replacement')") == redemptions[0]['recovery_code']
        if outcome == 'expired':
            expect(page.locator('#verify-step')).to_be_visible()
            page.get_by_role('button', name='Need another email?', exact=True).click()
            expect(page.locator('#email-step')).to_be_visible()
    assert len(redemptions) == 1
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    context.close()


server = subprocess.Popen(['node', 'tests/browser/purchase-server.mjs'], cwd=ROOT, stdout=subprocess.PIPE, text=True)
try:
    assert server.stdout.readline().strip() == 'ready'
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
        for width in [390, 1280]:
            for dark in [False, True]:
                checkout_test(browser, width, dark)
            for outcome in ['success', 'expired', 'interrupted']:
                recovery_test(browser, width, outcome)
        browser.close()
    print('10 browser journeys passed: mobile/desktop, light/dark checkout, recovery success/expiry/interruption; providers mocked.')
finally:
    server.terminate()
    server.wait(timeout=5)
