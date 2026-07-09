import { readFileSync, writeFileSync } from 'node:fs';

const htmlPath = new URL('../../public/boss.html', import.meta.url);
let html = readFileSync(htmlPath, 'utf8');

const replacements = {
  // Breach
  'slug: "it-that-was-tul-and-esh"': 'slug: "breach"',
  'slug: "xesht-we-that-are-one"': 'slug: "breach"',
  // Delirium
  'slug: "kosis-the-revelation"': 'slug: "delirium"',
  'slug: "omniphobia-fear-manifest"': 'slug: "delirium"',
  'slug: "tangmazu-the-raven-trickster"': 'slug: "delirium"',
  // Abyss
  'slug: "vandroth-blackblooded-enslaver"': 'slug: "abyss"',
  'slug: "tasgul-swallower-of-light"': 'slug: "abyss"',
  'slug: "vessel-of-kulemak"': 'slug: "abyss"',
  // Trial of Sekhemas
  'slug: "rattlecage-the-earthbreaker"': 'slug: "trial-sekhemas"',
  'slug: "terracota-sentinels"': 'slug: "trial-sekhemas"',
  'slug: "ashar-the-sand-mother"': 'slug: "trial-sekhemas"',
  'slug: "zarokh-the-temporal"': 'slug: "trial-sekhemas"',
  // Trial of Chaos
  'slug: "bahlak-the-sky-seer"': 'slug: "trial-chaos"',
  'slug: "uxmal-the-beastlord"': 'slug: "trial-chaos"',
  'slug: "chetza-the-feathered-plague"': 'slug: "trial-chaos"',
  'slug: "the-trialmaster"': 'slug: "trial-chaos"',
  // Expedition
  'slug: "styrn-fallen-knight-of-aldur"': 'slug: "expedition"',
  'slug: "medved-the-fallen-seer"': 'slug: "expedition"',
  'slug: "vorana-last-to-fall"': 'slug: "expedition"',
  'slug: "uhtred-the-stardrinker"': 'slug: "expedition"',
  'slug: "olroth-origin-of-the-fall"': 'slug: "expedition"',
  'slug: "the-aberration"': 'slug: "expedition"',
  // Atziri's Temple
  'slug: "xipocado-royal-architect"': 'slug: "atziri-temple"',
  'slug: "atziri-the-red-queen"': 'slug: "atziri-temple"',
  // Precursor Fortress
  'slug: "the-arbiter-of-ash"': 'slug: "precursor-fortress"',
  'slug: "the-arbiter-of-divinity"': 'slug: "precursor-fortress"'
};

let count = 0;
for (const [from, to] of Object.entries(replacements)) {
  if (html.includes(from)) {
    html = html.replace(from, to);
    count++;
  }
}

writeFileSync(htmlPath, html);
console.log(`Updated ${count} boss slug mappings in boss.html!`);
