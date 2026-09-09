const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8766/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    renderRuntimeHud(
      [{
        id: 2,
        label: 'Client phụ',
        flavor: 'Standalone',
        char1_name: 'Culler',
        char1_role: 'Follower',
        char2_name: 'Looter',
        char2_role: 'Follower',
        input_mode: 'dual_controller',
      }],
      [{
        instance_id: 2,
        account_profile_id: 2,
        status: 'bound',
        is_main: false,
        binding: { pid: 24680 },
        process: {},
      }],
      false,
      {
        virtual_controllers: [
          { target: 'P3', xinput_slot: 1 },
          { target: 'P4', xinput_slot: 3 },
        ],
      },
    );
  });
  const text = await page.locator('.runtime-controller-map').textContent();
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  for (const expected of [
    'PID 24680 · Chọn trong game',
    'P3 → Xbox Controller #1',
    'P4 → Xbox Controller #3',
  ]) {
    if (!text.includes(expected)) throw new Error(`Missing "${expected}" in ${JSON.stringify(text)}`);
  }
  console.log(text.replace(/\n/g, ' | '));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
