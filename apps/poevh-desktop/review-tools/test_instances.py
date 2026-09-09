"""UI regression: mock HTTP + real dashboard. Rust tests cover real API validation.

No game or sidecar is launched.
"""
import json
import io
from PIL import Image, ImageDraw
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors, commands = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("request", lambda req: commands.append(json.loads(req.post_data)) if req.url.endswith("/api/command") else None)
    # Poll deterministically, allowing a true networkidle wait.
    page.add_init_script("window.setInterval = (fn) => { window.reviewPoll = fn; return 1; };")
    page.goto("http://127.0.0.1:8876", wait_until="networkidle")
    page.wait_for_function("document.getElementById('tickLabel').textContent === '42'")
    page.evaluate("navTab('tab-client-mgr', document.querySelector('[onclick*=\"tab-client-mgr\"]'))")
    expect(page.locator("#instance-profile-list .card")).to_have_count(3)
    # Fixture order is 3,1,2: profile bindings must still use IDs.
    expect(page.locator("#instance-flavor-1")).to_have_value("Steam")
    expect(page.locator("#instance-flavor-2")).to_have_value("Standalone")
    expect(page.locator("#instance-flavor-3")).to_have_value("Standalone")
    expect(page.locator("#instance-note-2")).to_contain_text("Chưa gắn PID")
    expect(page.locator("#c2-fps")).to_have_text("--")

    label = '<img src=x onerror=alert(1)> Instance 2'
    page.locator("#instance-label-2").fill(label)
    page.locator("#instance-exe-2").fill(r"D:\Two\PathOfExile.exe")
    page.evaluate("pollState()")
    expect(page.locator("#instance-label-2")).to_have_value(label)
    page.locator('button[data-instance-id="2"]').click()
    expect(page.locator("#instance-command-status")).to_contain_text("Đã lưu profile #2")
    assert commands[-1]["instance_id"] == 2
    assert commands[-1]["value"]["exe_path"] == r"D:\Two\PathOfExile.exe"
    assert page.locator("#instance-profile-list img").count() == 0
    page.locator("#instance-enabled-3").uncheck()
    expect(page.locator("#instance-note-3")).to_contain_text("Profile tắt")
    expect(page.locator("#instance-enabled-2")).to_be_checked()

    page.evaluate("navTab('tab-smoother', document.querySelector('[onclick*=\"tab-smoother\"]'))")
    expect(page.locator("#instance-graphics-warning")).to_contain_text("CHƯA áp dụng")
    page.locator("#instance-graphics-select").select_option("2")
    page.locator("#instance-bg-fps").fill("10")
    page.locator("#instance-bg-fps").press("Tab")
    expect(page.locator("#instance-graphics-status")).to_contain_text("Đã lưu bản nháp cho #2")
    page.locator("#instance-graphics-select").select_option("3")
    expect(page.locator("#instance-bg-fps")).to_have_value("60")
    expect(page.locator("#instance-black-screen")).not_to_be_checked()
    page.locator("#instance-graphics-select").select_option("2")
    expect(page.locator("#instance-bg-fps")).to_have_value("10")
    expect(page.locator("#instance-black-screen")).to_be_checked()
    assert all(not str(c.get("key", "")).startswith("smoother_") for c in commands)
    page.screenshot(path=str(Path(__file__).with_name("instance-graphics-review.png")), full_page=True)

    # Failed saves must be visible, not silently reported as success.
    page.evaluate("navTab('tab-client-mgr', document.querySelector('[onclick*=\"tab-client-mgr\"]'))")
    page.route("**/api/command", lambda route: route.fulfill(status=400, content_type="application/json", body='{"error":"test rejection"}'))
    page.locator("#instance-label-2").fill("Failed draft")
    page.locator('button[data-instance-id="2"]').click()
    expect(page.locator("#instance-command-status")).to_contain_text("test rejection")
    page.unroute("**/api/command")
    page.reload(wait_until="networkidle")
    expect(page.locator("#instance-label-2")).to_have_value(label)
    page.evaluate("navTab('tab-client-mgr', document.querySelector('[onclick*=\"tab-client-mgr\"]'))")
    expect(page.locator("#instance-enabled-3")).not_to_be_checked()
    page.locator("#scan-instances").click()
    expect(page.locator("#instance-processes-status")).to_contain_text("3 process")
    page.locator("#instance-pid-2").select_option(f"2002:{2002:016x}")
    page.locator("#instance-bind-2").click()
    expect(page.locator("#instance-note-2")).to_contain_text("Đã gắn PID (OS)")
    expect(page.locator("#instance-note-2")).to_contain_text("CPU 12.5%")
    expect(page.locator("#instance-note-2")).to_contain_text("RAM 100.0 MB")
    page.locator("#instance-enabled-3").check()
    page.locator("#instance-pid-3").select_option(f"2002:{2002:016x}")
    page.locator("#instance-bind-3").click()
    expect(page.locator("#instance-command-status")).to_contain_text("already assigned")
    page.locator("#instance-pid-3").select_option(f"3003:{3003:016x}")
    page.locator("#instance-bind-3").click()
    expect(page.locator("#instance-note-3")).to_contain_text("PID 3003")
    page.locator("#instance-main-3").click()
    expect(page.locator("#instance-card-3 h3")).to_contain_text("MAIN")
    page.locator("#instance-unbind-2").click()
    expect(page.locator("#instance-note-2")).to_contain_text("Chưa gắn PID")
    page.locator("#add-instance").click()
    expect(page.locator("#instance-profile-list .card")).to_have_count(4)
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#instance-remove-4").click()
    expect(page.locator("#instance-profile-list .card")).to_have_count(3)
    page.screenshot(path=str(Path(__file__).with_name("instance-manager-review.png")), full_page=True)
    # Credentials use a dedicated endpoint; this test uses dummy data intercepted
    # in the browser. No real vault/account/game is touched or logged.
    expect(page.locator("#instance-email-1")).to_be_disabled()
    expect(page.locator("#instance-password-2")).to_have_attribute("type", "password")
    expect(page.locator("#instance-account-login-2")).to_be_disabled()
    credential_calls = []
    fixture = page.evaluate("async () => await (await fetch('/api/state', {headers:{'X-Api-Token':window.__API_TOKEN__}})).json()")

    def credential_reply(route):
        payload = route.request.post_data_json
        assert payload["instance_id"] == 2
        assert route.request.headers.get("x-api-token")
        credential_calls.append(payload["action"])
        profile = next(p for p in fixture["settings"]["multi_client"]["clients"] if p["id"] == 2)
        profile["has_credentials"] = payload["action"] == "save"
        profile["email_masked"] = "f***@***" if profile["has_credentials"] else ""
        route.fulfill(status=200, content_type="application/json", body=json.dumps(fixture))

    page.route("**/api/credentials", credential_reply)
    page.locator("#instance-email-2").fill("fixture@example.invalid")
    page.locator("#instance-password-2").fill("dummy-fixture-not-real")
    page.locator("#instance-account-save-2").click()
    expect(page.locator("#instance-command-status")).to_contain_text("Đã lưu trong Windows")
    expect(page.locator("#instance-password-2")).to_have_value("")
    expect(page.locator("#instance-email-2")).to_have_value("")
    expect(page.locator("#instance-account-status-2")).to_contain_text("f***@***")
    expect(page.locator("#instance-account-save-2")).to_be_disabled()
    expect(page.locator("#instance-account-launch-login-2")).to_be_enabled()
    login_calls = []

    def login_reply(route):
        payload = route.request.post_data_json
        assert payload == {"instance_id": 2, "launch": True, "confirmed": True}
        login_calls.append(payload["instance_id"])
        route.fulfill(status=409, content_type="application/json", body='{"error":"fixture login not executed"}')

    page.route("**/api/standalone-login", login_reply)
    page.once("dialog", lambda dialog: dialog.dismiss())
    page.locator("#instance-account-launch-login-2").click()
    assert not login_calls
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#instance-account-launch-login-2").click()
    expect(page.locator("#instance-command-status")).to_contain_text("fixture login not executed")
    assert login_calls == [2]
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#instance-account-delete-2").click()
    expect(page.locator("#instance-command-status")).to_contain_text("Đã xóa thông tin")
    assert credential_calls == ["save", "delete"]
    assert all("password" not in json.dumps(c) for c in commands)
    # Calibration image stays in browser memory. Only normalized points are posted.
    expect(page.locator('#instance-calibrate-1')).to_be_disabled()
    calibration_calls = []
    def calibration_reply(route):
        payload = route.request.post_data_json
        assert payload['instance_id'] == 2 and payload['confirmed'] is True
        assert set(payload) == {'instance_id','confirmed','calibration'}
        assert route.request.headers.get('x-api-token')
        calibration_calls.append(payload['calibration'])
        profile = next(p for p in fixture['settings']['multi_client']['clients'] if p['id'] == 2)
        profile['login_calibration'] = payload['calibration']
        route.fulfill(status=200,content_type='application/json',body=json.dumps(fixture))
    page.route('**/api/login-calibration', calibration_reply)
    page.locator('#instance-calibrate-2').click()
    expect(page.locator('#login-calibration-dialog')).to_be_visible()
    expect(page.locator('#calibration-save')).to_be_disabled()
    page.locator('#calibration-file').set_input_files({'name':'invalid.txt','mimeType':'text/plain','buffer':b'not an image'})
    expect(page.locator('#calibration-status')).to_contain_text('PNG/JPEG')
    image = Image.new('RGB',(1000,1000),'#121826')
    draw = ImageDraw.Draw(image)
    draw.rectangle((380,630,620,670),outline='#aa9955',width=2)
    draw.rectangle((380,700,620,740),outline='#aa9955',width=2)
    draw.rectangle((380,830,620,890),fill='#801020')
    buffer = io.BytesIO(); image.save(buffer,format='PNG')
    page.locator('#calibration-file').set_input_files({'name':'synthetic-empty-form.png','mimeType':'image/png','buffer':buffer.getvalue()})
    expect(page.locator('#calibration-status')).to_contain_text('1000 × 1000')
    canvas = page.locator('#calibration-canvas')
    box = canvas.bounding_box()
    content = canvas.evaluate('(c) => ({width:c.clientWidth,height:c.clientHeight})')
    canvas.click(position={'x':content['width']*.5,'y':content['height']*.65})
    assert abs(float(page.locator('#calibration-point-0-0').input_value())-50) < .15
    for i, pair in enumerate([(50,65),(50,72),(50,86)]):
        for axis, value in enumerate(pair):
            page.locator(f'#calibration-point-{i}-{axis}').fill(str(value))
    expect(page.locator('#calibration-save')).to_be_disabled()
    page.locator('#calibration-confirm').check()
    expect(page.locator('#calibration-save')).to_be_enabled()
    # Invalid/reversed/outside coordinates cannot be saved through the UI.
    page.locator('#calibration-point-0-0').fill('99')
    page.locator('#calibration-confirm').check()
    expect(page.locator('#calibration-save')).to_be_disabled()
    page.locator('#calibration-point-0-0').fill('50')
    page.locator('#calibration-confirm').check()
    page.locator('#login-calibration-dialog').screenshot(path=str(Path(__file__).with_name('login-calibration-review.png')))
    page.locator('#calibration-save').click()
    expect(page.locator('#login-calibration-dialog')).not_to_be_visible()
    expect(page.locator('#instance-account-status-2')).to_contain_text('Có điểm hiệu chỉnh')
    assert calibration_calls[0] == {'version':1,'capture_width':1000,'capture_height':1000,'email':[.5,.65],'password':[.5,.72],'submit':[.5,.86]}
    page.locator('#instance-calibrate-2').click()
    expect(page.locator('#calibration-canvas')).not_to_be_visible()
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#calibration-clear').click()
    expect(page.locator('#instance-account-status-2')).to_contain_text('Tự tìm bằng pixel')
    assert calibration_calls[-1] is None
    page.locator("#instance-card-2").screenshot(path=str(Path(__file__).with_name("standalone-login-review.png")))
    unexpected = [e for e in errors if "400 (Bad Request)" not in e and "409 (Conflict)" not in e]
    assert not unexpected, unexpected
    print(f"PASS: instance/credential regressions + pixel calibration image/points/validation/save/clear; {len(commands)} commands; no game launched")
    browser.close()
