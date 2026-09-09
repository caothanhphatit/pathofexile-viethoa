"""Visual/interaction smoke test on the mock server; no game or account actions."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output = Path(__file__).parent
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('window.setInterval = () => 1;')
    page.goto('http://127.0.0.1:8876',wait_until='networkidle')
    page.wait_for_function("document.getElementById('tickLabel').textContent === '42'")
    expect(page.locator('body')).to_have_css('background-color','rgb(245, 241, 231)')
    expect(page.locator('.nav-icon svg')).to_have_count(14)
    header = page.locator('#acc-auto .nav-accordion-header')
    header.focus(); page.keyboard.press('Enter')
    expect(header).to_have_attribute('aria-expanded','false')
    page.keyboard.press('Enter')
    expect(header).to_have_attribute('aria-expanded','true')
    for size in [(1440,1000),(1140,800),(960,640)]:
        page.set_viewport_size({'width':size[0],'height':size[1]})
        for tab in page.locator('.nav-item').all():
            tab.click()
            expect(page.locator('.tab-pane.active .page-heading h1')).to_be_visible()
            assert page.evaluate('''() => {
                const viewport=document.querySelector('.tab-viewport');
                return viewport.scrollWidth <= viewport.clientWidth+1 && document.body.scrollWidth <= innerWidth;
            }'''), f'Horizontal overflow at {size}: {tab.inner_text()}'
        page.locator('[onclick="navTab(\'tab-home\', this)"]').click()
        page.screenshot(path=str(output/f'cream-home-{size[0]}.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    for tab_id in ['tab-client-mgr','tab-movement','tab-smoother','tab-keybinds']:
        page.locator(f'[onclick="navTab(\'{tab_id}\', this)"]').click()
        page.screenshot(path=str(output/f'cream-{tab_id}.png'))
    # Check primary text and semantic palette contrast on the warm surfaces.
    checks = page.evaluate('''() => {
      const css=getComputedStyle(document.documentElement), ctx=document.createElement('canvas').getContext('2d');
      const rgb=v=>{ctx.fillStyle=v; const h=ctx.fillStyle; return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);};
      const lum=v=>rgb(v).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
      const result=[];
      for(const fg of ['--text','--sub','--dim','--green','--red','--cyan','--amber']) for(const bg of ['--bg0','--bg-card']) {
        const a=lum(css.getPropertyValue(fg).trim()),b=lum(css.getPropertyValue(bg).trim());
        result.push({fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
      }
      return result;
    }''')
    assert all(c['ratio']>=4.5 for c in checks), checks
    assert not errors, errors
    print('PASS: cream theme, 14 pages × 3 sizes, keyboard accordion, text contrast; no horizontal overflow')
    browser.close()
