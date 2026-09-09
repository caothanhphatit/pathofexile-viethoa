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
  const expected = await page.evaluate(async () => {
    const response = await fetch('/api/state', {
      headers: { 'X-Api-Token': window.__API_TOKEN__ || '' },
    });
    if (!response.ok) throw new Error(`State request failed: ${response.status}`);
    const snapshot = await response.json();
    return {
      stop: String(snapshot.config.stop_distance),
      stopLabel: `${snapshot.config.stop_distance} bước`,
      sprint: String(snapshot.config.catch_up_distance),
      sprintLabel: `${snapshot.config.catch_up_distance} bước`,
      follow: Boolean(snapshot.settings.follow),
      prioritize: Boolean(snapshot.config.prioritize_catchup),
    };
  });
  await page.waitForFunction(expectedState => {
    const stop = document.querySelector('#follow-stop-distance');
    const sprint = document.querySelector('#follow-sprint-distance');
    return stop?.value === expectedState.stop && sprint?.value === expectedState.sprint;
  }, expected);

  const state = await page.evaluate(() => ({
    stop: document.querySelector('#follow-stop-distance')?.value,
    stopLabel: document.querySelector('#val-stop-dist')?.textContent,
    sprint: document.querySelector('#follow-sprint-distance')?.value,
    sprintLabel: document.querySelector('#val-sprint-dist')?.textContent,
    follow: document.querySelector('#tog-follow')?.checked,
    prioritize: document.querySelector('#tog-prio-catch')?.checked,
  }));
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  if (JSON.stringify(state) !== JSON.stringify(expected)) {
    throw new Error(`Follow UI does not match snapshot: expected ${JSON.stringify(expected)}, got ${JSON.stringify(state)}`);
  }
  console.log(JSON.stringify(state));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
