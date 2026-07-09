import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const getJson = (url) => {
  try {
    const raw = execFileSync("curl", ["-sS", "-m", "15", "-A", UA, url]).toString("utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to fetch JSON from ${url}:`, e.message);
    return null;
  }
};

console.log("Fetching index state...");
const indexState = getJson("https://poe.ninja/poe2/api/data/index-state");
if (!indexState) {
  console.error("Could not fetch index state.");
  process.exit(1);
}

const activeLeague = indexState.economyLeagues.find(l => l.indexed) || indexState.economyLeagues[0];
console.log(`Active economy league: ${activeLeague.name} (${activeLeague.url})`);

const prices = {};

// Fetch Currencies
console.log("Fetching currency prices...");
const currencyData = getJson(`https://poe.ninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(activeLeague.name)}&type=Currency`);

if (currencyData) {
  const itemsMap = {};
  const allItems = currencyData.items || (currencyData.core && currencyData.core.items) || [];
  for (const item of allItems) {
    itemsMap[item.id] = item.name;
  }

  // Divine Orb is the base/primary currency in the API (primaryValue = 1)
  prices["Divine Orb"] = {
    divine: 1,
    chaos: null
  };

  if (currencyData.lines) {
    for (const line of currencyData.lines) {
      const name = itemsMap[line.id];
      if (name && line.primaryValue) {
        prices[name] = {
          divine: line.primaryValue,
          chaos: null
        };
      }
    }
  }

  // Find chaos price in divine
  const chaosPriceInDivine = prices["Chaos Orb"] ? prices["Chaos Orb"].divine : null;
  if (chaosPriceInDivine) {
    const divinePriceInChaos = 1 / chaosPriceInDivine;
    prices["Divine Orb"].chaos = Math.round(divinePriceInChaos * 100) / 100;

    for (const [name, p] of Object.entries(prices)) {
      if (name !== "Divine Orb") {
        p.chaos = Math.round((p.divine / chaosPriceInDivine) * 100) / 100;
      }
    }
  }
}

// Fetch Stash Items (Weapons, Armours, Accessories)
const types = ["UniqueWeapons", "UniqueArmours", "UniqueAccessories"];
for (const type of types) {
  console.log(`Fetching item prices for ${type}...`);
  const itemData = getJson(`https://poe.ninja/poe2/api/economy/stash/current/item/overview?league=${activeLeague.url}&type=${type}`);
  if (itemData) {
    const itemsMap = {};
    const allItems = itemData.items || [];
    for (const item of allItems) {
      itemsMap[item.id] = item.name;
    }
    if (itemData.lines) {
      for (const line of itemData.lines) {
        const name = itemsMap[line.id] || line.name;
        if (name && line.chaosValue) {
          prices[name] = {
            chaos: line.chaosValue,
            divine: line.divineValue || (line.chaosValue / (prices["Divine Orb"] ? prices["Divine Orb"].chaos : 1))
          };
        }
      }
    }
  }
}

// Fallback prices for major boss unique items since poe.ninja has no stash API yet in PoE2
const uniqueFallbacks = {
  "Temporalis Silk Robe": { chaos: 15, divine: 1.8 },
  "Sandstorm Visage Chain Tiara": { chaos: 80, divine: 9.8 },
  "Djinn Barya": { chaos: 5, divine: 0.6 },
  "Sekhema's Resolve Ring": { chaos: 10, divine: 1.2 },
  "Mahuxotl's Machination (Omen Crest Shield)": { chaos: 120, divine: 14.8 },
  "Zerphi's Genesis (Heavy Belt)": { chaos: 150, divine: 18.5 },
  "Hateforge (Moulded Mitts)": { chaos: 200, divine: 24.6 },
  "Atziri's Acuity": { chaos: 300, divine: 37.0 },
  "Rakiata's Flow": { chaos: 50, divine: 6.2 },
  "Starforge": { chaos: 250, divine: 30.8 },
  "Precursor's Emblem (Ruby Ring)": { chaos: 40, divine: 4.9 },
  "Vessel of Kulemak (Serpentine Staff)": { chaos: 60, divine: 7.4 },
  "The Surrender (Omen Crest Shield)": { chaos: 70, divine: 8.6 },
  "The Last Flame Incense Relic": { chaos: 30, divine: 3.7 },
  "The Desperate Alliance Vase Relic": { chaos: 20, divine: 2.5 },
  "The Changing Seasons Seal Relic": { chaos: 25, divine: 3.1 },
  "The Burden of Leadership Tapestry Relic": { chaos: 35, divine: 4.3 }
};

for (const [name, p] of Object.entries(uniqueFallbacks)) {
  if (!prices[name]) {
    prices[name] = p;
  }
}

writeFileSync(
  new URL('../../public/data/poe-prices.js', import.meta.url),
  `// poe.ninja pricing for PoE2. Auto-generated.\nwindow.POE2_PRICES = ${JSON.stringify(prices, null, 2)};\n`
);

console.log(`Saved ${Object.keys(prices).length} pricing entries to public/data/poe-prices.js!`);
