from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


out = Path(__file__).resolve().parent / "dashboard-review.png"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    page_errors = []
    commands = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: page_errors.append(str(err)))
    page.on("request", lambda req: commands.append(req.post_data) if req.url.endswith("/api/command") else None)

    page.goto("http://127.0.0.1:8876", wait_until="domcontentloaded")
    network_idle = True
    try:
        page.wait_for_load_state("networkidle", timeout=2500)
    except PlaywrightTimeoutError:
        network_idle = False

    page.wait_for_function("document.getElementById('tickLabel').textContent === '42'")
    assert page.locator("#statusLabel").inner_text() == "TẠM DỪNG"
    assert page.locator("#areaLabel").inner_text() == "Review Area"
    assert page.locator("#feedBox img").count() == 0
    assert page.locator("#feedBox script").count() == 0
    assert "<script>alert(2)</script>" in page.locator("#feedBox").inner_text()

    page.locator("#tog-follow").evaluate("el => el.closest('label').click()")
    page.wait_for_timeout(300)
    assert any('"command":"toggle"' in (c or "") and '"key":"follow"' in (c or "") for c in commands)

    page.locator(".nav-item").filter(has_text="Nhặt Đồ").first.click()
    assert page.locator("#tab-pickup").evaluate("el => el.classList.contains('active')")
    page.screenshot(path=str(out), full_page=True)

    print(f"network_idle={network_idle}")
    print(f"console_errors={console_errors}")
    print(f"page_errors={page_errors}")
    print(f"commands={commands}")
    print(f"screenshot={out}")
    browser.close()
