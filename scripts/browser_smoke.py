"""Browser smoke against local Vite or deployed Vela; API responses are explicitly mocked.

Install playwright + Chromium, then run:
    python scripts/browser_smoke.py http://127.0.0.1:5173
"""

import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.route(
        "**/api/v1/chat/stream",
        lambda route: route.fulfill(
            status=200,
            headers={"content-type": "application/x-ndjson"},
            body='{"delta":"Browser smoke answer"}\n{"done":true}\n',
        ),
    )
    page.route(
        "**/api/v1/images",
        lambda route: route.fulfill(
            status=200,
            headers={"content-type": "application/json"},
            body='{"image":"iVBORw0KGgo=","mime_type":"image/png"}',
        ),
    )
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("button", name="Open chat").click()
    page.get_by_label("Message Vela").fill("Hello")
    page.get_by_role("button", name="Send message").click()
    page.get_by_text("Browser smoke answer").wait_for()
    page.get_by_role("button", name="Images", exact=True).click()
    page.get_by_label("Your idea").fill("A blue vase")
    page.get_by_role("button", name="Generate image").click()
    page.get_by_alt_text("Generated image: A blue vase").wait_for()
    page.get_by_role("button", name="Voice", exact=True).click()
    page.get_by_text("Talk with Vela").wait_for()
    assert page.locator("body").evaluate("el => el.scrollWidth <= window.innerWidth + 1")
    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(BASE, wait_until="networkidle")
    mobile.get_by_role("navigation", name="Mobile navigation").get_by_role("button", name="Chat").click()
    mobile.get_by_label("Message Vela").wait_for()
    assert mobile.locator("body").evaluate("el => el.scrollWidth <= window.innerWidth + 1")
    print("Browser smoke passed: desktop chat, image, voice navigation; mobile navigation and width")
    browser.close()
