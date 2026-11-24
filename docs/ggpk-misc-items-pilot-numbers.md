### Site rows vs game (name match)

| site file | site group | site rows | matched in game | site-only (reason: count) |
|---|---|---:|---:|---|
| currency-data.js | StackableCurrencyItem | 85 | 78 | in game, filtered: no-release-evidence 6, not a BaseItemTypes name 1 |
| currency-data.js | Essence | 81 | 81 | - |
| currency-data.js | SplinterItem | 4 | 4 | - |
| currency-data.js | CatalystItem | 12 | 12 | - |
| items-data.js | stackable-currency | 99 | 92 | in game, filtered: no-release-evidence 7 |
| items-data.js | essence | 126 | 97 | atlas passive node listed on the poe2db page 29 |
| items-data.js | catalysts | 33 | 27 | atlas passive node listed on the poe2db page 2, in game as another class (Body Armours) 4 |
| items-data.js | liquid-emotions | 15 | 13 | atlas passive node listed on the poe2db page 1, unique item (not a base type) 1 |
| items-data.js | splinter | 6 | 4 | atlas passive node listed on the poe2db page 2 |
| items-data.js | incubators | 2 | 1 | atlas passive node listed on the poe2db page 1 |
| items-data.js | omen | 43 | 42 | atlas passive node listed on the poe2db page 1 |
| items-data.js | augment | 315 | 306 | atlas passive node listed on the poe2db page 1, in game, filtered: placeholder-name 8 |
| items-data.js | waystones | 66 | 22 | not a BaseItemTypes name 37, atlas passive node listed on the poe2db page 7 |
| items-data.js | tablet | 17 | 8 | unique item (not a base type) 9 |
| items-data.js | map-fragments | 25 | 11 | in game as another class (Skill Gems) 9, in game, filtered: no-release-evidence 1, atlas passive node listed on the poe2db page 1, unique item (not a base type) 1, in game as another class (Support Gems) 2 |
| items-data.js | pinnacle-keys | 10 | 10 | - |
| items-data.js | vault-keys | 25 | 13 | in game, filtered: no-release-evidence 12 |
| items-data.js | trial-coins | 5 | 5 | - |
| items-data.js | inscribed-ultimatum | 1 | 1 | - |
| items-data.js | relics | 13 | 7 | unique item (not a base type) 6 |

### Game rows vs site (name match)

| game category | game rows | distinct names | on site (misc menus) | on site (other menu) | not on site | has description | has effect lines | has flavour text | has icon path | has stack size |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| augment | 305 | 305 | 304 | 1 | 0 | 190 | 305 | 94 | 305 | 270 |
| currency | 156 | 156 | 142 | 14 | 0 | 136 | 26 | 5 | 156 | 156 |
| essence | 95 | 95 | 95 | 0 | 0 | 95 | 95 | 0 | 95 | 95 |
| fragment | 12 | 12 | 11 | 0 | 1 | 2 | 1 | 11 | 12 | 12 |
| key | 34 | 30 | 33 | 0 | 1 | 1 | 5 | 33 | 34 | 11 |
| omen | 50 | 50 | 49 | 1 | 0 | 49 | 0 | 0 | 50 | 49 |
| relic | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| tablet | 8 | 8 | 8 | 0 | 0 | 0 | 8 | 0 | 8 | 0 |
| uncut-gem | 43 | 42 | 0 | 0 | 43 | 43 | 0 | 0 | 43 | 43 |
| waystone | 16 | 16 | 16 | 0 | 0 | 0 | 0 | 0 | 16 | 0 |

### Field agreement on matched rows

| site group | stack size | description_en | mods (whole row) | site mod lines found word for word in the game text | icon path | required level |
|---|---|---|---|---|---|---|
| StackableCurrencyItem (78) | same 78 | same 59, differs 15, both-empty 4 | same 59, differs 15, both-empty 4 | 59 of 84 | same 78 | - |
| Essence (81) | same 81 | same 81 | same 74, differs 7 | 201 of 210 | same 81 | - |
| SplinterItem (4) | same 4 | both-empty 4 | both-empty 4 | 0 of 0 | same 4 | - |
| CatalystItem (12) | same 12 | same 11, differs 1 | same 11, differs 1 | 11 of 12 | same 12 | - |
| stackable-currency (92) | same 86, site-empty 6 | - | same 76, both-empty 16 | 76 of 76 | same 92 | - |
| essence (97) | same 97 | - | same 95, differs 2 | 273 of 275 | same 97 | - |
| catalysts (27) | same 27 | - | same 27 | 27 of 27 | same 27 | - |
| liquid-emotions (13) | same 13 | - | site-has-more 12, same 1 | 60 of 72 | same 13 | - |
| splinter (4) | same 4 | - | both-empty 4 | 0 of 0 | same 4 | - |
| incubators (1) | same 1 | - | same 1 | 1 of 1 | same 1 | - |
| omen (42) | same 41, both-empty 1 | - | same 41, both-empty 1 | 41 of 41 | same 42 | - |
| augment (306) | same 227, both-empty 35, site-empty 44 | - | game-has-more 240, same 10, differs 56 | 443 of 507 | same 306 | same 243 |
| waystones (22) | same 6, both-empty 16 | - | site-has-more 1, same 5, both-empty 16 | 9 of 10 | same 22 | - |
| tablet (8) | both-empty 8 | - | same 8 | 8 of 8 | same 8 | - |
| map-fragments (11) | site-empty 11 | - | both-empty 9, same 1, game-has-more 1 | 2 of 2 | same 11 | - |
| pinnacle-keys (10) | site-empty 9, same 1 | - | both-empty 10 | 0 of 0 | same 10 | - |
| vault-keys (13) | both-empty 13 | - | both-empty 8, same 5 | 5 of 5 | same 13 | - |
| trial-coins (5) | both-empty 5 | - | both-empty 5 | 0 of 0 | same 5 | - |
| inscribed-ultimatum (1) | both-empty 1 | - | both-empty 1 | 0 of 0 | same 1 | - |
| relics (7) | both-empty 7 | - | both-empty 7 | 0 of 0 | same 7 | - |

### Site-only names

- **StackableCurrencyItem** - in game, filtered: no-release-evidence (6): Albino Rhoa Feather, Black Scythe Artifact, Broken Circle Artifact, Exotic Coinage, Order Artifact, Sun Artifact
- **StackableCurrencyItem** - not a BaseItemTypes name (1): Vaal Infuser
- **stackable-currency** - in game, filtered: no-release-evidence (7): Albino Rhoa Feather, Black Scythe Artifact, Broken Circle Artifact, Exotic Coinage, Order Artifact, Rogue's Marker, Sun Artifact
- **essence** - atlas passive node listed on the poe2db page (29): Arid Stability, Burst of Energy, Corrupted Lattices, Corruption Areas: Essence Chance, Crystalline Overgrowth, Crystalline Patterns, Crystallised Form, Desert Biome: Essence Chance, Energised Precipitate, Essence Chance, Essence Dowsing, Essence Transference, Essence and Summoning Circle Chance, Flawless Patterns, Greater Pattern, Harmonic Corruption, Imprisoned Monstrosities, Inexplicable Alchemy, Intensifying Energies, Loyal Gatekeepers, Man Trap, Massive Crystals, Monuments in Time, Mysteries of Silence, Mysterious Transference, Rogue Exile and Essence Chance, Shadow of Undeath, Swamp Biome: Essence Chance, Trapped Subordinate
- **catalysts** - atlas passive node listed on the poe2db page (2): Complete Refinement, Enhanced Creation
- **catalysts** - in game as another class (Body Armours) (4): Grasping Mail, Runefather's Grasping Mail, Runeforged Grasping Mail, Runemastered Grasping Mail
- **liquid-emotions** - atlas passive node listed on the poe2db page (1): I know your childhood fears...
- **liquid-emotions** - unique item (not a base type) (1): Strugglescream
- **splinter** - atlas passive node listed on the poe2db page (2): Is this about me... or you?, Scavenge the Remains
- **incubators** - atlas passive node listed on the poe2db page (1): Abyssal Ire
- **omen** - atlas passive node listed on the poe2db page (1): Mysterious Rites
- **augment** - atlas passive node listed on the poe2db page (1): Idolatry
- **augment** - in game, filtered: placeholder-name (8): [DNT-Unused] Rune of Chance, [DNT-Unused] Rune of Confidence, [DNT-Unused] Rune of Confrontation, [DNT-Unused] Rune of Duplication, [DNT-Unused] Rune of Partnership, [DNT-Unused] Rune of Reverberation, [DNT-Unused] Rune of Vital Flame, [DNT-Unused] Rune of Wild Ferocity
- **waystones** - not a BaseItemTypes name (37): Ancient Gateway, Blooming Field, Caer Tarth, Castaway, Crux of Nothingness, Eastern Enigma Chamber, Eastern Gateway, Garukhan's Tomb, Hive Colony, Hive Fortress, Molten Vault, Mournful Cliffside, Obscure Island, Ruins of Kingsmarch, Secluded Temple, Simulacrum of Delusion, Site of the Chosen, Sprawling Jungle, Sunken Pyramid, The Burning Monolith, The Copper Citadel, The Ezomyte Megaliths, The Fractured Lake, The Jade Isles, The Matriarch Halls, The Origin Tower, The Patriarch Halls, The Reliquary Vault, The Silent Cave, The Viridian Wildwood, The Well of Souls, The Withered Willow, Untainted Paradise, Vaults of Kamasa, Western Enigma Chamber, Western Gateway, [DNT-UNUSED] Vastiri Outpost
- **waystones** - atlas passive node listed on the poe2db page (7): Archaeological Interest, Atop the World, Close to the Surface, Competing Explorers, Enigmatic Intensification, Pathkeepers, Valuable Paths
- **tablet** - unique item (not a base type) (9): Clear Skies, Cruel Hegemony, Freedom of Faith, Mastered Domain, Season of the Hunt, The Grand Project, Unforeseen Consequences, Visions of Paradise, Wraeclast Besieged
- **map-fragments** - in game as another class (Skill Gems) (9): Cross Slash, Fragmentation Rounds, Fragments Of The Past, Galvanic Shards, Ice Fragments, Incendiary Shot, Permafrost Bolts, Righteous Descent, Shred
- **map-fragments** - in game, filtered: no-release-evidence (1): Idol of Estazunti
- **map-fragments** - atlas passive node listed on the poe2db page (1): Shattered Questions
- **map-fragments** - unique item (not a base type) (1): The Ordained
- **map-fragments** - in game as another class (Support Gems) (2): Trickster's Shard, Vruun's Aftermath
- **vault-keys** - in game, filtered: no-release-evidence (12): Ancient Reliquary Key, Archive Reliquary Key, Cosmic Reliquary Key, Decaying Reliquary Key, Forgotten Reliquary Key, Oubliette Reliquary Key, Shiny Reliquary Key, Timeworn Reliquary Key, Vaal Reliquary Key, Visceral Reliquary Key, Voidborn Reliquary Key, Zarokh's Reliquary Key
- **relics** - unique item (not a base type) (6): The Burden of Leadership, The Changing Seasons, The Desperate Alliance, The Last Flame, The Peacemaker's Draught, The Remembered Tales

### Game-only names (released by the rule, not on the site at all)

- **fragment** (1): Breachstone
- **key** (1): Expedition Logbook
- **uncut-gem** (43): Uncut Skill Gem (Level 1), Uncut Skill Gem (Level 1), Uncut Skill Gem (Level 10), Uncut Skill Gem (Level 11), Uncut Skill Gem (Level 12), Uncut Skill Gem (Level 13), Uncut Skill Gem (Level 14), Uncut Skill Gem (Level 15), Uncut Skill Gem (Level 16), Uncut Skill Gem (Level 17), Uncut Skill Gem (Level 18), Uncut Skill Gem (Level 19), Uncut Skill Gem (Level 2), Uncut Skill Gem (Level 20), Uncut Skill Gem (Level 3), Uncut Skill Gem (Level 4), Uncut Skill Gem (Level 5), Uncut Skill Gem (Level 6), Uncut Skill Gem (Level 7), Uncut Skill Gem (Level 8), Uncut Skill Gem (Level 9), Uncut Spirit Gem (Level 10), Uncut Spirit Gem (Level 11), Uncut Spirit Gem (Level 12), Uncut Spirit Gem (Level 13), Uncut Spirit Gem (Level 14), Uncut Spirit Gem (Level 15), Uncut Spirit Gem (Level 16), Uncut Spirit Gem (Level 17), Uncut Spirit Gem (Level 18), Uncut Spirit Gem (Level 19), Uncut Spirit Gem (Level 20), Uncut Spirit Gem (Level 4), Uncut Spirit Gem (Level 5), Uncut Spirit Gem (Level 6), Uncut Spirit Gem (Level 7), Uncut Spirit Gem (Level 8), Uncut Spirit Gem (Level 9), Uncut Support Gem (Level 1), Uncut Support Gem (Level 2), Uncut Support Gem (Level 3), Uncut Support Gem (Level 4), Uncut Support Gem (Level 5)

### Examples of differences (up to 10 per kind)

#### StackableCurrencyItem - description:differs

- Ancient Infuser
  - site: "Modifies a Precursor Tablet unpredictably"
  - game: "Modifies a Tablet unpredictably and Corrupts it"
- Concentrated Liquid Fear
  - site: "Players in Area are 22% Delirious Rare Monsters have a 25% chance to have an additional Modifier"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Concentrated Liquid Isolation
  - site: "Players in Area are 50% Delirious"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Concentrated Liquid Suffering
  - site: "Players in Area are 25% Delirious Unique Monsters have 1 additional Rare Modifier"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Diluted Liquid Greed
  - site: "Players in Area are 10% Delirious 8% increased Rarity of Items found in this Area"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Diluted Liquid Guilt
  - site: "Players in Area are 9% Delirious 8% increased Pack size"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Diluted Liquid Ire
  - site: "Players in Area are 7% Delirious 20% increased number of Magic Monsters"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Liquid Despair
  - site: "30% increased Stack size of Simulacrum Splinters found in Area Players in Area are 20% Delirious"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Liquid Disgust
  - site: "Players in Area are 18% Delirious 30% increased Precursor Tablets found in Area"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"
- Liquid Envy
  - site: "Players in Area are 15% Delirious 30% increased Waystones found in Area"
  - game: "Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier"

#### StackableCurrencyItem - mods:differs

- Ancient Infuser
  - site: ["Modifies a Precursor Tablet unpredictably"]
  - game: ["Modifies a Tablet unpredictably and Corrupts it"]
- Concentrated Liquid Fear
  - site: ["Players in Area are 22% Delirious Rare Monsters have a 25% chance to have an additional Modifier","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: (10—20)% increased Warcry Speed","Sapphire Suffix: (10—20)% increased Critical Spell Damage Bonus","Emerald Suffix: (10—20)% increased Critical Damage Bonus for Attack Damage"]
- Concentrated Liquid Isolation
  - site: ["Players in Area are 50% Delirious","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: +1% to Maximum Fire Resistance","Sapphire Suffix: +1% to Maximum Cold Resistance","Emerald Suffix: +1% to Maximum Lightning Resistance","Diamond Suffix: +1% to Maximum Chaos Resistance"]
- Concentrated Liquid Suffering
  - site: ["Players in Area are 25% Delirious Unique Monsters have 1 additional Rare Modifier","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: +(1—2) to Maximum Rage","Sapphire Prefix: (4—6)% increased Area of Effect","Emerald Suffix: (1—2)% increased Movement Speed"]
- Diluted Liquid Greed
  - site: ["Players in Area are 10% Delirious 8% increased Rarity of Items found in this Area","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Global Physical Damage","Sapphire Prefix: (7—13)% increased Chaos Damage","Emerald Prefix: (5—15)% increased Elemental Damage"]
- Diluted Liquid Guilt
  - site: ["Players in Area are 9% Delirious 8% increased Pack size","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Fire Damage","Sapphire Prefix: (5—15)% increased Cold Damage","Emerald Prefix: (5—15)% increased Lightning Damage"]
- Diluted Liquid Ire
  - site: ["Players in Area are 7% Delirious 20% increased number of Magic Monsters","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (10—20)% increased Armour","Sapphire Prefix: (10—20)% increased maximum Energy Shield","Emerald Prefix: (10—20)% increased Evasion Rating"]
- Liquid Despair
  - site: ["30% increased Stack size of Simulacrum Splinters found in Area Players in Area are 20% Delirious","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: Gain 1 Rage on Melee Hit","Sapphire Suffix: (5—15)% increased Critical Hit Chance for Spells","Emerald Suffix: (6—16)% increased Critical Hit Chance for Attacks"]
- Liquid Disgust
  - site: ["Players in Area are 18% Delirious 30% increased Precursor Tablets found in Area","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: (5—10)% increased Life Regeneration rate","Sapphire Suffix: Recover (1—2)% of maximum Mana on Kill","Emerald Suffix: Recover (1—2)% of maximum Life on Kill"]
- Liquid Envy
  - site: ["Players in Area are 15% Delirious 30% increased Waystones found in Area","Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: (4—6)% of Skill Mana Costs Converted to Life Costs","Sapphire Prefix: (5—15)% increased Spell Damage","Emerald Suffix: (3—5)% increased Cooldown Recovery Rate"]

#### Essence - mods:differs

- Essence of Enhancement
  - site: ["Upgrades a Magic item to a Rare item, adding a guaranteed modifier","Armour: (56—67)% increased Armour, Evasion or Energy Shield"]
  - game: ["Upgrades a Magic item to a Rare item, adding a guaranteed modifier","Armour: (56—67)% increased Armour, Evasion and Energy Shield"]
- Essence of Horror
  - site: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Gloves or Boots: 60% increased effect of Socketed Items"]
  - game: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Gloves or Boots: 60% increased effect of Socketed Augment Items"]
- Essence of Hysteria
  - site: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Helmet: +1 to Level of all Minion Skills","Body Armour: (64—97) to (97—145) Physical Thorns damage","Gloves: (25—29)% increased Critical Damage Bonus","Boots: 30% increased Movement Speed","Ring: (50—59)% increased Mana Regeneration Rate","Amulet: (19—21)% of Damage taken Recouped as Life","Belt: +(254—304) to Stun Threshold","Shield: (20—24)% increased Block chance","Quiver: (43—50)% increased Damage with Bow Skills","Focus: (41—45)% increased Energy Shield Recharge Rate"]
  - game: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Helmet: +1 to Level of all Minion Skills","Body Armour: (64—97) to (98—145) Physical Thorns damage","Gloves: (25—29)% increased Critical Damage Bonus","Boots: 30% increased Movement Speed","Ring: (50—59)% increased Mana Regeneration Rate","Amulet: (19—21)% of Damage taken Recouped as Life","Belt: +(254—304) to Stun Threshold","Shield: (20—24)% increased Block chance","Quiver: (43—50)% increased Damage with Bow Skills","Focus: (20—23)% increased Energy Shield Recharge Rate"]
- Greater Essence of Enhancement
  - site: ["Upgrades a Magic item to a Rare item, adding a guaranteed modifier","Armour: (68—79)% increased Armour, Evasion or Energy Shield"]
  - game: ["Upgrades a Magic item to a Rare item, adding a guaranteed modifier","Armour: (68—79)% increased Armour, Evasion and Energy Shield"]
- Lesser Essence of Enhancement
  - site: ["Upgrades a Magic item to a Rare item, adding a guaranteed modifier","Armour: (27—42)% increased Armour, Evasion or Energy Shield"]
  - game: ["Upgrades a Magic item to a Rare item, adding a guaranteed modifier","Armour: (27—42)% increased Armour, Evasion and Energy Shield"]
- Perfect Essence of Battle
  - site: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","One Handed Melee Weapon or Bow: +3 to Level of all Attack Skills","Two Handed Melee Weapon or Crossbow: +5 to Level of all Attack Skills"]
  - game: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","One Handed Melee Weapon or Bow: +2 to Level of all Attack Skills","Two Handed Melee Weapon or Crossbow: +3 to Level of all Attack Skills"]
- Perfect Essence of Enhancement
  - site: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Amulet: (20—30)% increased Global Defences"]
  - game: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Amulet: (20—30)% increased Global Armour, Evasion and Energy Shield"]

#### CatalystItem - description:differs

- Carapace Catalyst
  - site: "Adds quality that enhances Defence modifiers on a ring or amulet Replaces other quality types"
  - game: "Adds quality that enhances Armour, Evasion and Energy Shield modifiers on a ring or amulet\nReplaces other quality types"

#### CatalystItem - mods:differs

- Carapace Catalyst
  - site: ["Adds quality that enhances Defence modifiers on a ring or amulet Replaces other quality types"]
  - game: ["Adds quality that enhances Armour, Evasion and Energy Shield modifiers on a ring or amulet\nReplaces other quality types"]

#### stackable-currency - stack_size:site-empty

- Revered Starlit Ore
  - site: null
  - game: 1
- Shattered Triskelion
  - site: null
  - game: 1
- Starlit Ore
  - site: null
  - game: 1
- Venerable Starlit Ore
  - site: null
  - game: 1
- Veridical Starlit Ore
  - site: null
  - game: 1
- Warding Starlit Ore
  - site: null
  - game: 1

#### essence - mods:differs

- Cyclonic Alloy
  - site: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Body Armour: (15—30)% reduced Slowing Potency of Debuffs on You","Boots: (15—19)% increased Skill Effect Duration","Gloves: (20—25)% increased Duration of Damaging Ailments on Enemies","Helmet: (35—42)% increased Archon Buff duration"]
  - game: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Body Armour: (30—15)% reduced Slowing Potency of Debuffs on You","Boots: (15—19)% increased Skill Effect Duration","Gloves: (20—25)% increased Duration of Damaging Ailments on Enemies","Helmet: (35—42)% increased Archon Buff duration"]
- Transcendent Alloy
  - site: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Staff: (39—47)% increased Cast Speed Gain (11—16)% of Elemental Damage as Extra Cold Damage","Focus or Wand: (26—31)% increased Cast Speed Gain (7—11)% of Elemental Damage as Extra Cold Damage","Martial Weapon: (15—20)% increased Physical Damage +(7—10) to all Attributes"]
  - game: ["Removes a random modifier and augments a Rare item with a new guaranteed modifier","Staff: (39—47)% increased Cast Speed\nGain (11—16)% of Elemental Damage as Extra Cold Damage","Focus or Wand: (26—31)% increased Cast Speed\nGain (7—11)% of Elemental Damage as Extra Cold Damage","Martial Weapon: +(7—10) to all Attributes\n(15—20)% increased Physical Damage"]

#### liquid-emotions - mods:site-has-more

- Concentrated Liquid Fear
  - site: ["Players in Area are 22% Delirious Rare Monsters have a 25% Surpassing chance to have an additional Modifier","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Suffix: (10—20)% increased Warcry Speed","Sapphire Suffix: (10—20)% increased Critical Spell Damage Bonus","Emerald Suffix: (10—20)% increased Critical Damage Bonus for Attack Damage"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: (10—20)% increased Warcry Speed","Sapphire Suffix: (10—20)% increased Critical Spell Damage Bonus","Emerald Suffix: (10—20)% increased Critical Damage Bonus for Attack Damage"]
- Concentrated Liquid Isolation
  - site: ["Players in Area are 50% Delirious","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Suffix: +1% to Maximum Fire Resistance","Sapphire Suffix: +1% to Maximum Cold Resistance","Emerald Suffix: +1% to Maximum Lightning Resistance","Diamond Suffix: +1% to Maximum Chaos Resistance"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: +1% to Maximum Fire Resistance","Sapphire Suffix: +1% to Maximum Cold Resistance","Emerald Suffix: +1% to Maximum Lightning Resistance","Diamond Suffix: +1% to Maximum Chaos Resistance"]
- Concentrated Liquid Suffering
  - site: ["Players in Area are 25% Delirious Unique Monsters have 1 additional Rare Modifiers","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Prefix: +(1—2) to Maximum Rage","Sapphire Prefix: (4—6)% increased Area of Effect","Emerald Suffix: (1—2)% increased Movement Speed"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: +(1—2) to Maximum Rage","Sapphire Prefix: (4—6)% increased Area of Effect","Emerald Suffix: (1—2)% increased Movement Speed"]
- Diluted Liquid Greed
  - site: ["Players in Area are 10% Delirious map item drop rarity +% [8]","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Global Physical Damage","Sapphire Prefix: (7—13)% increased Chaos Damage","Emerald Prefix: (5—15)% increased Elemental Damage"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Global Physical Damage","Sapphire Prefix: (7—13)% increased Chaos Damage","Emerald Prefix: (5—15)% increased Elemental Damage"]
- Diluted Liquid Guilt
  - site: ["Players in Area are 9% Delirious 8% increased Pack size","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Fire Damage","Sapphire Prefix: (5—15)% increased Cold Damage","Emerald Prefix: (5—15)% increased Lightning Damage"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Fire Damage","Sapphire Prefix: (5—15)% increased Cold Damage","Emerald Prefix: (5—15)% increased Lightning Damage"]
- Diluted Liquid Ire
  - site: ["Players in Area are 7% Delirious 20% increased number of Magic Monsters","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Prefix: (10—20)% increased Armour","Sapphire Prefix: (10—20)% increased maximum Energy Shield","Emerald Prefix: (10—20)% increased Evasion Rating"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (10—20)% increased Armour","Sapphire Prefix: (10—20)% increased maximum Energy Shield","Emerald Prefix: (10—20)% increased Evasion Rating"]
- Liquid Despair
  - site: ["30% increased Stack size of Simulacrum Splinters found in Area Players in Area are 20% Delirious","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Suffix: Gain 1 Rage on Melee Hit","Sapphire Suffix: (5—15)% increased Critical Hit Chance for Spells","Emerald Suffix: (6—16)% increased Critical Hit Chance for Attacks"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: Gain 1 Rage on Melee Hit","Sapphire Suffix: (5—15)% increased Critical Hit Chance for Spells","Emerald Suffix: (6—16)% increased Critical Hit Chance for Attacks"]
- Liquid Disgust
  - site: ["Players in Area are 18% Delirious 30% increased Tablets found in Area","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Suffix: (5—10)% increased Life Regeneration rate","Sapphire Suffix: Recover (1—2)% of maximum Mana on Kill","Emerald Suffix: Recover (1—2)% of maximum Life on Kill"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: (5—10)% increased Life Regeneration rate","Sapphire Suffix: Recover (1—2)% of maximum Mana on Kill","Emerald Suffix: Recover (1—2)% of maximum Life on Kill"]
- Liquid Paranoia
  - site: ["Players in Area are 12% Delirious 15% increased number of Rare Monsters","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Attack Damage","Sapphire Suffix: (2—4)% increased Cast Speed","Emerald Suffix: (2—4)% increased Attack Speed"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: (5—15)% increased Attack Damage","Sapphire Suffix: (2—4)% increased Cast Speed","Emerald Suffix: (2—4)% increased Attack Speed"]
- Potent Liquid Contempt
  - site: ["Players in Area are 50% Delirious","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Prefix: +1 Suffix Modifier allowed","Ruby Suffix: +1 Prefix Modifier allowed","Sapphire Prefix: +1 Suffix Modifier allowed","Sapphire Suffix: +1 Prefix Modifier allowed","Emerald Prefix: +1 Suffix Modifier allowed","Emerald Suffix: +1 Prefix Modifier allowed","Diamond Prefix: +1 Suffix Modifier allowed","Diamond Suffix: +1 Prefix Modifier allowed"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Prefix: +1 Suffix Modifier allowed","Ruby Suffix: +1 Prefix Modifier allowed","Sapphire Prefix: +1 Suffix Modifier allowed","Sapphire Suffix: +1 Prefix Modifier allowed","Emerald Prefix: +1 Suffix Modifier allowed","Emerald Suffix: +1 Prefix Modifier allowed","Diamond Prefix: +1 Suffix Modifier allowed","Diamond Suffix: +1 Prefix Modifier allowed"]

#### augment - mods:game-has-more

- Adept Rune
  - site: ["All Equipment: +9 to Dexterity"]
  - game: ["Place into an empty Augment Socket in any Equipment to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","All Equipment: +9 to Dexterity","Martial Weapon (Bonded): Adds 6 to 10 Physical Damage to Attacks\nAdds 1 to 16 Lightning damage to Attacks","Wand or Staff (Bonded): +80 to Evasion Rating","Armour (Bonded): +20 to maximum Life\n+20 to maximum Mana"]
- Aldur's Legacy
  - site: ["All Equipment: When socketed into a Unique Kalguuran or Ezomyte item, destroys the item to create a Rune imbued with that item's power"]
  - game: ["Place into an empty Augment Socket in any non-Corrupted Kalguuran or Ezomyte Unique to destroy that Unique and create a new Rune.","All Equipment: When socketed into a Unique Kalguuran or Ezomyte item, destroys the item to create a Rune imbued with that item's power"]
- Amanamu's Gaze
  - site: ["Helmets: Remove a Damaging Ailment when you use a Command Skill","Body Armours: +2 to Armour per 1 Spirit","Boots: 1% increased Movement Speed per 15 Spirit, up to a maximum of 40% Other Modifiers to Movement Speed except for Sprinting do not apply"]
  - game: ["Helmets: Remove a Damaging Ailment when you use a Command Skill","Body Armours: +2 to Armour per 1 Spirit","Boots: 1% increased Movement Speed per 15 Spirit, up to a maximum of 40%\nOther Modifiers to Movement Speed except for Sprinting do not apply","Place into an empty Augment Socket in an Armour to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items."]
- Ancient Rune of Animosity
  - site: ["Talismans: Gain 2 Druidic Prowess when you Heavy Stun a Rare or Unique Enemy"]
  - game: ["Place into an empty Augment Socket in a Talisman to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Talismans: Gain 2 Druidic Prowess when you Heavy Stun a Rare or Unique Enemy","Talismans (Bonded): 40% increased Stun Buildup"]
- Ancient Rune of Control
  - site: ["Quarterstaves: 50% increased Immobilisation buildup"]
  - game: ["Place into an empty Augment Socket in a  Quarterstaff to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Quarterstaves: 50% increased Immobilisation buildup","Quarterstaves (Bonded): 30% increased Damage against Immobilised Enemies"]
- Ancient Rune of Decay
  - site: ["Wands: 25% increased Withered Magnitude"]
  - game: ["Place into an empty Augment Socket in a Wand to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Wands: 25% increased Withered Magnitude","Wands (Bonded): 15% chance that when Volatility on you explodes, you regain an equivalent amount of Volatility"]
- Ancient Rune of Detonation
  - site: ["Crossbows: Grenades have 10% chance to activate a second time"]
  - game: ["Place into an empty Augment Socket in a Crossbow to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Crossbows: Grenades have 10% chance to activate a second time","Crossbows (Bonded): 40% increased Crossbow Reload Speed"]
- Ancient Rune of Discovery
  - site: ["Staves: 30% chance to create an additional Remnant"]
  - game: ["Place into an empty Augment Socket in a Staff to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Staves: 30% chance to create an additional Remnant","Staves (Bonded): +1 to maximum number of Elemental Infusions"]
- Ancient Rune of Dueling
  - site: ["Bucklers: 30% increased Parried Debuff Magnitude"]
  - game: ["Place into an empty Augment Socket in a Buckler to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Bucklers: 30% increased Parried Debuff Magnitude","Bucklers (Bonded): 15% increased Block chance"]
- Ancient Rune of Prowess
  - site: ["Spears: 30% chance when you gain a Charge to gain an additional Charge"]
  - game: ["Place into an empty Augment Socket in a Spear to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Spears: 30% chance when you gain a Charge to gain an additional Charge","Spears (Bonded): 30% increased Endurance, Frenzy and Power Charge Duration"]

#### augment - mods:differs

- Astrid's Creativity
  - site: ["All Equipment: Can have 1 additional Crafted Modifiers"]
  - game: ["Place into an empty Augment Socket in any Equipment to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","All Equipment: Can have 1 additional Crafted Modifier"]
- Atziri's Soul Core of Alacrity
  - site: ["Socket-bound","Gloves: 1% increased Skill Speed for each Corrupted Item Equipped, Corrupting will always result in change"]
  - game: ["Place into an empty Augment Socket in a pair of Gloves to apply its effect to that item. Once socketed it cannot be retrieved or replaced.","Gloves: Corrupting will always result in change\n1% increased Skill Speed for each Corrupted Item Equipped"]
- Atziri's Soul Core of Devotion
  - site: ["Socket-bound","Helmets: 1% increased Spirit for each Corrupted Item Equipped, Corrupting will always result in change"]
  - game: ["Place into an empty Augment Socket in a Helmet to apply its effect to that item. Once socketed it cannot be retrieved or replaced.","Helmets: Corrupting will always result in change\n1% increased Spirit for each Corrupted Item Equipped"]
- Atziri's Soul Core of Inoculation
  - site: ["Socket-bound","Boots: +2% to Chaos Resistance for each Corrupted Item Equipped, Corrupting will always result in change"]
  - game: ["Place into an empty Augment Socket in a pair of Boots to apply its effect to that item. Once socketed it cannot be retrieved or replaced.","Boots: Corrupting will always result in change\n+2% to Chaos Resistance for each Corrupted Item Equipped"]
- Atziri's Soul Core of Vitality
  - site: ["Socket-bound","Body Armours: 1% increased Maximum Life for each Corrupted Item Equipped, Corrupting will always result in change"]
  - game: ["Place into an empty Augment Socket in a Body Armour to apply its effect to that item. Once socketed it cannot be retrieved or replaced.","Body Armours: Corrupting will always result in change\n1% increased Maximum Life for each Corrupted Item Equipped"]
- Betrayal of Aldur
  - site: ["Socket-bound","Weapon: Transforms all Fire, Cold and Lightning modifiers on the item into equivalent Chaos modifiers"]
  - game: ["Place into an empty Augment Socket in a Rare Weapon to apply its effect to that item. Transforms modifiers upon socketing, further added modifiers will not be transformed. Once socketed it cannot be retrieved or replaced.","Weapon: Transforms all Fire, Cold and Lightning modifiers on the item into equivalent Chaos modifiers","Weapon (Bonded): 25% increased Chaos Damage","Forged by the Betrayal of Aldur"]
- Breath of Aldur
  - site: ["Socket-bound","Weapon: When socketed, transforms all Fire and Lightning modifiers to equivalent Cold modifiers"]
  - game: ["Place into an empty Augment Socket in a Rare Weapon to apply its effect to that item. Transforms modifiers upon socketing, further added modifiers will not be transformed. Once socketed it cannot be retrieved or replaced.","Weapon: When socketed, transforms all Fire and Lightning modifiers to equivalent Cold modifiers","Weapon (Bonded): 25% increased Cold Damage","Forged by the Breath of Aldur"]
- Countess Seske's Rune of Archery
  - site: ["Bows: Bow Attacks fire 1 additional Arrows"]
  - game: ["Place into an empty Augment Socket in a Bow to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Bows: Bow Attacks fire an additional Arrow","Bows (Bonded): 20% increased Projectile Speed"]
- Fox Idol
  - site: ["Body Armours: Idols socketed in this item gain the benefits of their Bonded modifiers, display additional socketable mods for idols [1]","Sceptres: 50% increased Presence Area of Effect"]
  - game: ["Place into an empty Augment Socket in a Body Armour or Sceptre to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.","Body Armours: Idols socketed in this item gain the benefits of their Bonded modifiers","Body Armours (Bonded): +5% to Quality of all Skills","Sceptres: 50% increased Presence Area of Effect","Sceptres (Bonded): Minions have 30% increased Area of Effect"]
- Guatelitzi's Thesis
  - site: ["Helmets: Gain Armour equal to 35% of Life Lost from Hits in the past 8 seconds","Body Armours: 10% of Physical Damage prevented Recouped as Life","Boots: Lose 5% of maximum Life per second while Sprinting, 25% increased Movement Speed while Sprinting"]
  - game: ["Helmets: Gain Armour equal to 35% of Life Lost from Hits in the past 8 seconds","Body Armours: 10% of Physical Damage prevented Recouped as Life","Boots: Lose 5% of maximum Life per second while Sprinting\n25% increased Movement Speed while Sprinting","Place into an empty Augment Socket in an Armour to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items."]

#### augment - stack_size:site-empty

- Legacy of A Worthy Foe
  - site: null
  - game: 1
- Legacy of Adonia's Ego
  - site: null
  - game: 1
- Legacy of Alkem Eira
  - site: null
  - game: 1
- Legacy of Ashrend
  - site: null
  - game: 1
- Legacy of Blackbraid
  - site: null
  - game: 1
- Legacy of Brain Rattler
  - site: null
  - game: 1
- Legacy of Bramblejack
  - site: null
  - game: 1
- Legacy of Bristleboar
  - site: null
  - game: 1
- Legacy of Brynhand's Mark
  - site: null
  - game: 1
- Legacy of Bushwhack
  - site: null
  - game: 1

#### waystones - mods:site-has-more

- Liquid Envy
  - site: ["Players in Area are 15% Delirious 30% increased Waystones found in Area","Removes a random modifer and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier","Ruby Suffix: (4—6)% of Skill Mana Costs Converted to Life Costs","Sapphire Prefix: (5—15)% increased Spell Damage","Emerald Suffix: (3—5)% increased Cooldown Recovery Rate"]
  - game: ["Removes a random modifer and Augments a Rare Basic Jewel with a\nnew guaranteed Crafted modifier","Ruby Suffix: (4—6)% of Skill Mana Costs Converted to Life Costs","Sapphire Prefix: (5—15)% increased Spell Damage","Emerald Suffix: (3—5)% increased Cooldown Recovery Rate"]

#### map-fragments - stack_size:site-empty

- An Audience with the King
  - site: null
  - game: 1
- Breachlord Sac
  - site: null
  - game: 1
- Cowardly Fate
  - site: null
  - game: 1
- Deadly Fate
  - site: null
  - game: 1
- Head of the King
  - site: null
  - game: 1
- Kulemak's Invitation
  - site: null
  - game: 1
- Raven's Reflection
  - site: null
  - game: 1
- Sacred Bloom
  - site: null
  - game: 1
- Simulacrum
  - site: null
  - game: 1
- The Triskelion Reforged
  - site: null
  - game: 1

#### map-fragments - mods:game-has-more

- Simulacrum
  - site: ["Adds the Simulacrum to a Map"]
  - game: ["Adds the Simulacrum to a Map","5% increased Quantity of Items found in Map"]

#### pinnacle-keys - stack_size:site-empty

- Ancient Crisis Fragment
  - site: null
  - game: 1
- Faded Crisis Fragment
  - site: null
  - game: 1
- Origin Core
  - site: null
  - game: 1
- Origin Cradle
  - site: null
  - game: 1
- Origin Spark
  - site: null
  - game: 1
- Primary Calamity Fragment
  - site: null
  - game: 1
- Secondary Calamity Fragment
  - site: null
  - game: 1
- Tertiary Calamity Fragment
  - site: null
  - game: 1
- Weathered Crisis Fragment
  - site: null
  - game: 1
