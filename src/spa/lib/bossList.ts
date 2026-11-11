// Boss list for /boss, moved out of the old standalone boss.html.
// Bosses with a slug have a detail entry in public/data/boss-data.js.

export type LocalizedText = { vi: string; en: string };

export type BossType =
  | "Optional"
  | "Atlas"
  | "Trial"
  | "Pinnacle"
  | "Ritual"
  | "Delirium"
  | "Breach"
  | "Abyss"
  | "Temple"
  | "Expedition";

export type BossEntry = {
  name: string;
  slug?: string;
  location: string;
  type: BossType;
  note?: LocalizedText;
};

export type BossGroup = {
  id: string;
  label: LocalizedText;
  bosses: BossEntry[];
};

export const bossGroups: BossGroup[] = [
  {
    "id": "optional-act1",
    "label": {
      "vi": "Optional — Act 1",
      "en": "Optional — Act 1"
    },
    "bosses": [
      {
        "name": "The Devourer",
        "slug": "the-devourer",
        "location": "Mud Burrow (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Hoàn thành quest Treacherous Ground",
          "en": "Treacherous Ground quest completion"
        }
      },
      {
        "name": "The Brambleghast",
        "slug": "the-brambleghast",
        "location": "The Grelwood (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Uncut Skill Gem Level 2",
          "en": "Drops: Uncut Skill Gem Level 2"
        }
      },
      {
        "name": "The Crowbell",
        "slug": "the-crowbell",
        "location": "The Hunting Grounds (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Book of Specialization (Weapon Set Passive Points)",
          "en": "Drops: Book of Specialization (Weapon Set Passive Points)"
        }
      },
      {
        "name": "The King in the Mists",
        "slug": "the-king-in-the-mists",
        "location": "Freythorn (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Gembloom Skull, Spirit Skill Gem Level 4",
          "en": "Drops: Gembloom Skull, Spirit Skill Gem Level 4"
        }
      },
      {
        "name": "Candlemass, the Living Rite",
        "slug": "candlemass-the-living-rite",
        "location": "Ogham Manor (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Candlemass' Essence",
          "en": "Drops: Candlemass' Essence"
        }
      },
      {
        "name": "Beira of the Rotten Pack",
        "slug": "beira-of-the-rotten-pack",
        "location": "Clearfell (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Head of the Winter Wolf (+10% Cold Resistance)",
          "en": "Drops: Head of the Winter Wolf (+10% Cold Resistance)"
        }
      },
      {
        "name": "The Rotten Druid",
        "slug": "the-rotten-druid",
        "location": "The Grim Tangle (Act 1)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Uncut Support Gem",
          "en": "Drops: Uncut Support Gem"
        }
      }
    ]
  },
  {
    "id": "optional-act2",
    "label": {
      "vi": "Optional — Act 2",
      "en": "Optional — Act 2"
    },
    "bosses": [
      {
        "name": "Balbala, The Traitor",
        "slug": "balbala-the-traitor",
        "location": "Traitor's Passage (Act 2)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Balbala's Barya (mở khóa Trial of Sekhemas)",
          "en": "Drops: Balbala's Barya (grants Trial of Sekhemas access)"
        }
      },
      {
        "name": "Kabala, Constrictor Queen",
        "slug": "kabala-constrictor-queen",
        "location": "Keth (Act 2)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Book of Specialization",
          "en": "Drops: Book of Specialization"
        }
      }
    ]
  },
  {
    "id": "optional-act3",
    "label": {
      "vi": "Optional — Act 3",
      "en": "Optional — Act 3"
    },
    "bosses": [
      {
        "name": "Mektul, the Forgemaster",
        "slug": "mektul-the-forgemaster",
        "location": "The Molten Vault (Act 3)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: The Hammer of Kamasa",
          "en": "Drops: The Hammer of Kamasa"
        }
      },
      {
        "name": "Ignagduk, the Bog Witch",
        "slug": "ignagduk-the-bog-witch",
        "location": "The Azak Bog (Act 3)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Gemrot Skull, Ignagduk's Ghastly Spear",
          "en": "Drops: Gemrot Skull, Ignagduk's Ghastly Spear"
        }
      },
      {
        "name": "Rootdredge",
        "slug": "rootdredge",
        "location": "Sandswept Marsh (Act 3)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Uncut Skill Gem Level 9",
          "en": "Drops: Uncut Skill Gem Level 9"
        }
      },
      {
        "name": "Mighty Silverfist",
        "slug": "mighty-silverfist",
        "location": "Jungle Ruins (Act 3)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Book of Specialization",
          "en": "Drops: Book of Specialization"
        }
      }
    ]
  },
  {
    "id": "optional-act4",
    "label": {
      "vi": "Optional — Act 4",
      "en": "Optional — Act 4"
    },
    "bosses": [
      {
        "name": "Great White One",
        "slug": "great-white-one",
        "location": "Whakapanu Island (Act 4)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Shark Fin Quest Item",
          "en": "Drops: Shark Fin Quest Item"
        }
      },
      {
        "name": "Captain Hartlin",
        "slug": "captain-hartlin",
        "location": "Journey's End (Act 4)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Verisium Quest Item",
          "en": "Drops: Verisium Quest Item"
        }
      },
      {
        "name": "The Blind Beast",
        "slug": "the-blind-beast",
        "location": "Isle of Kin (Act 4)",
        "type": "Optional",
        "note": {
          "vi": "Rớt: Artificer's Orb",
          "en": "Drops: Artificer's Orb"
        }
      },
      {
        "name": "Yama the White",
        "slug": "yama-the-white",
        "location": "Halls of the Dead (Act 4)",
        "type": "Optional",
        "note": {
          "vi": "Tiến trình quest Trial of the Ancestors",
          "en": "Trial of the Ancestors quest progression"
        }
      }
    ]
  },
  {
    "id": "optional-interlude",
    "label": {
      "vi": "Optional — Interlude",
      "en": "Optional — Interlude"
    },
    "bosses": [
      {
        "name": "Akthi and Anundr",
        "slug": "akthi-and-anundr",
        "location": "The Khari Crossing",
        "type": "Optional",
        "note": {
          "vi": "Hoàn thành side quest Clearing the Way",
          "en": "Clearing the Way side quest completion"
        }
      },
      {
        "name": "Sigbert and Godwin",
        "slug": "sigbert-and-godwin",
        "location": "Holten",
        "type": "Optional",
        "note": {
          "vi": "Nhiều phần thưởng item khác nhau",
          "en": "Various item rewards"
        }
      },
      {
        "name": "Oswin, the Dread Warden",
        "slug": "oswin-the-dread-warden",
        "location": "Wolvenhold",
        "type": "Optional",
        "note": {
          "vi": "Thưởng 2 Weapon Set Passive Points",
          "en": "Two Weapon Set Passive Points"
        }
      },
      {
        "name": "The Abominable Yeti",
        "slug": "the-abominable-yeti",
        "location": "Howling Caves",
        "type": "Optional",
        "note": {
          "vi": "Hoàn thành quest Howling Winds",
          "en": "Howling Winds quest completion"
        }
      }
    ]
  },
  {
    "id": "atlas",
    "label": {
      "vi": "Boss Atlas / Map",
      "en": "Atlas / Map bosses"
    },
    "bosses": [
      {
        "name": "The Pale Angel",
        "slug": "the-pale-angel",
        "location": "Corrupted Nexus",
        "type": "Atlas",
        "note": {
          "vi": "Gặp ngẫu nhiên",
          "en": "Random encounter"
        }
      },
      {
        "name": "The Skittermind",
        "slug": "the-skittermind",
        "location": "Corrupted Nexus",
        "type": "Atlas",
        "note": {
          "vi": "Gặp ngẫu nhiên",
          "en": "Random encounter"
        }
      },
      {
        "name": "The Eater of Flesh",
        "slug": "the-eater-of-flesh",
        "location": "Corrupted Nexus",
        "type": "Atlas",
        "note": {
          "vi": "Gặp trong quest The Cataclysm's Wake",
          "en": "The Cataclysm's Wake quest encounter"
        }
      },
      {
        "name": "The Immured Fury",
        "slug": "the-immured-fury",
        "location": "Cleansed Maps",
        "type": "Atlas",
        "note": {
          "vi": "Spawn ngẫu nhiên trong khu vực cleansed",
          "en": "Random spawn in cleansed areas"
        }
      },
      {
        "name": "Zekoa, the Headcrusher",
        "slug": "zekoa-the-headcrusher",
        "location": "Riverside/Rupture Map",
        "type": "Atlas",
        "note": {
          "vi": "Gặp tùy chọn trong map",
          "en": "Optional map encounter"
        }
      },
      {
        "name": "Manoki, the Chosen",
        "slug": "manoki-the-chosen",
        "location": "The Jade Isles",
        "type": "Atlas",
        "note": {
          "vi": "Rớt: Rakiata's Flow",
          "en": "Drops: Rakiata's Flow"
        }
      },
      {
        "name": "Zahmir, the Blade Sovereign",
        "slug": "zahmir-the-blade-sovereign",
        "location": "Sacred Reservoir",
        "type": "Atlas",
        "note": {
          "vi": "Rớt: Garukhan's Resolve",
          "en": "Drops: Garukhan's Resolve"
        }
      }
    ]
  },
  {
    "id": "trial-sekhemas",
    "label": {
      "vi": "Trial of the Sekhemas",
      "en": "Trial of the Sekhemas"
    },
    "bosses": [
      {
        "name": "Rattlecage, the Earthbreaker",
        "slug": "trial-sekhemas",
        "location": "Trial of the Sekhemas Floor 1",
        "type": "Trial",
        "note": {
          "vi": "Boss Tầng 1",
          "en": "Floor 1 boss"
        }
      },
      {
        "name": "Terracota Sentinels",
        "slug": "trial-sekhemas",
        "location": "Trial of the Sekhemas Floor 2",
        "type": "Trial",
        "note": {
          "vi": "Boss Tầng 2",
          "en": "Floor 2 boss"
        }
      },
      {
        "name": "Ashar, the Sand Mother",
        "slug": "trial-sekhemas",
        "location": "Trial of the Sekhemas Floor 3",
        "type": "Trial",
        "note": {
          "vi": "Boss Tầng 3",
          "en": "Floor 3 boss"
        }
      },
      {
        "name": "Zarokh, the Temporal",
        "slug": "trial-sekhemas",
        "location": "Trial of the Sekhemas Floor 4",
        "type": "Pinnacle",
        "note": {
          "vi": "Cần Djinn Barya với Area Level 75+",
          "en": "Requires Djinn Barya with Area Level 75+"
        }
      }
    ]
  },
  {
    "id": "trial-chaos",
    "label": {
      "vi": "Trial of Chaos",
      "en": "Trial of Chaos"
    },
    "bosses": [
      {
        "name": "Bahlak, the Sky Seer",
        "slug": "trial-chaos",
        "location": "Trial of Chaos",
        "type": "Trial",
        "note": {
          "vi": "Gặp ngẫu nhiên trong trial",
          "en": "Random encounter in trials"
        }
      },
      {
        "name": "Uxmal, the Beastlord",
        "slug": "trial-chaos",
        "location": "Trial of Chaos",
        "type": "Trial",
        "note": {
          "vi": "Gặp ngẫu nhiên trong trial",
          "en": "Random encounter in trials"
        }
      },
      {
        "name": "Chetza, the Feathered Plague",
        "slug": "trial-chaos",
        "location": "Trial of Chaos",
        "type": "Trial",
        "note": {
          "vi": "Gặp ngẫu nhiên trong trial",
          "en": "Random encounter in trials"
        }
      },
      {
        "name": "The Trialmaster",
        "slug": "trial-chaos",
        "location": "Trial of Chaos (10th trial)",
        "type": "Pinnacle",
        "note": {
          "vi": "Cần 3 vật phẩm Fate key",
          "en": "Requires three Fate key items"
        }
      }
    ]
  },
  {
    "id": "ritual",
    "label": {
      "vi": "Ritual",
      "en": "Ritual"
    },
    "bosses": [
      {
        "name": "The King in the Mists (Endgame)",
        "slug": "ritual",
        "location": "Ritual",
        "type": "Ritual",
        "note": {
          "vi": "Vật phẩm \"An Audience with the King\"; quest Legacy of the Maji",
          "en": "\"An Audience with the King\" item; Legacy of the Maji quest"
        }
      },
      {
        "name": "The Bodach",
        "slug": "ritual",
        "location": "Ritual (Caer Tarth)",
        "type": "Pinnacle",
        "note": {
          "vi": "Dùng Head of the King; map Rite of the Nameless; quest Legacy of the Maji",
          "en": "Use Head of the King; Rite of the Nameless maps; Legacy of the Maji quest"
        }
      }
    ]
  },
  {
    "id": "delirium",
    "label": {
      "vi": "Delirium",
      "en": "Delirium"
    },
    "bosses": [
      {
        "name": "Kosis, the Revelation",
        "slug": "delirium",
        "location": "Delirium/Simulacrum",
        "type": "Delirium",
        "note": {
          "vi": "Spawn trong map Delirium hoặc các wave Simulacrum cao",
          "en": "Spawns in Delirium maps or higher Simulacrum waves"
        }
      },
      {
        "name": "Omniphobia, Fear Manifest",
        "slug": "delirium",
        "location": "Delirium/Simulacrum",
        "type": "Delirium",
        "note": {
          "vi": "Spawn trong map Delirium hoặc các wave Simulacrum cao",
          "en": "Spawns in Delirium maps or higher Simulacrum waves"
        }
      },
      {
        "name": "Tangmazu, The Raven Trickster",
        "slug": "delirium",
        "location": "Delirium (Paracosm)",
        "type": "Pinnacle",
        "note": {
          "vi": "Dùng Raven's Reflection tại gương Withered Willow; quest Strange Reflections",
          "en": "Use Raven's Reflection at Withered Willow mirror; Strange Reflections quest"
        }
      }
    ]
  },
  {
    "id": "breach",
    "label": {
      "vi": "Breach",
      "en": "Breach"
    },
    "bosses": [
      {
        "name": "It That Was Tul and Esh",
        "slug": "breach",
        "location": "Hive Colony (Nest of the Lords)",
        "type": "Breach",
        "note": {
          "vi": "Quest Keepers of the Flame",
          "en": "Keepers of the Flame quest"
        }
      },
      {
        "name": "Xesht, We That Are One",
        "slug": "breach",
        "location": "Monastery/Twisted Domain",
        "type": "Pinnacle",
        "note": {
          "vi": "Hoàn thành Hive Colony; quest Keepers of the Flame",
          "en": "Complete Hive Colony; Keepers of the Flame quest"
        }
      }
    ]
  },
  {
    "id": "abyss",
    "label": {
      "vi": "Abyss",
      "en": "Abyss"
    },
    "bosses": [
      {
        "name": "Vandroth, Blackblooded Enslaver",
        "slug": "abyss",
        "location": "Dark Domain",
        "type": "Abyss",
        "note": {
          "vi": "Phong ấn Northern Abyssal Wounds; quest Abyssal Power",
          "en": "Seal Northern Abyssal Wounds; Abyssal Power quest"
        }
      },
      {
        "name": "Tasgul, Swallower of Light",
        "slug": "abyss",
        "location": "Lightless Void",
        "type": "Abyss",
        "note": {
          "vi": "Dọn Eastern Abyssal Wound; quest Abyssal Power",
          "en": "Clear Eastern Abyssal Wound; Abyssal Power quest"
        }
      },
      {
        "name": "Vessel of Kulemak",
        "slug": "abyss",
        "location": "Well of Souls",
        "type": "Pinnacle",
        "note": {
          "vi": "Dùng Kulemak's Invitation; quest Abyssal Power",
          "en": "Use Kulemak's Invitation; Abyssal Power quest"
        }
      }
    ]
  },
  {
    "id": "atziri-temple",
    "label": {
      "vi": "Atziri's Temple",
      "en": "Atziri's Temple"
    },
    "bosses": [
      {
        "name": "Xipocado, Royal Architect",
        "slug": "atziri-temple",
        "location": "Atziri's Temple",
        "type": "Temple",
        "note": {
          "vi": "Cần điều khiển Temple Console; quest Fate of the Vaal",
          "en": "Temple Console manipulation required; Fate of the Vaal quest"
        }
      },
      {
        "name": "Atziri, the Red Queen",
        "slug": "atziri-temple",
        "location": "Atziri's Temple (Royal Access Chamber)",
        "type": "Pinnacle",
        "note": {
          "vi": "Area Level 75+; quest Fate of the Vaal",
          "en": "Area Level 75+; Fate of the Vaal quest"
        }
      }
    ]
  },
  {
    "id": "precursor-fortress",
    "label": {
      "vi": "Precursor Fortress (Pinnacle)",
      "en": "Precursor Fortress (Pinnacle)"
    },
    "bosses": [
      {
        "name": "The Arbiter of Ash",
        "slug": "precursor-fortress",
        "location": "Burning Monolith",
        "type": "Pinnacle",
        "note": {
          "vi": "Cần Crisis Fragments; quest Legacy of the Precursors",
          "en": "Crisis Fragments required; Legacy of the Precursors quest"
        }
      },
      {
        "name": "The Arbiter of Divinity",
        "slug": "precursor-fortress",
        "location": "Origin Tower",
        "type": "Pinnacle",
        "note": {
          "vi": "Cần Origin Spark và Origin Cradle; quest Legacy of the Precursors",
          "en": "Origin Spark and Origin Cradle required; Legacy of the Precursors quest"
        }
      }
    ]
  },
  {
    "id": "expedition",
    "label": {
      "vi": "Expedition",
      "en": "Expedition"
    },
    "bosses": [
      {
        "name": "Styrn, Fallen Knight of Aldur",
        "slug": "expedition",
        "location": "Tomb of the Fallen Knight",
        "type": "Expedition",
        "note": {
          "vi": "Phá lối vào trong các encounter Expedition; quest The Grand Expedition",
          "en": "Destroy entrance in Expedition encounters; The Grand Expedition quest"
        }
      },
      {
        "name": "Medved, the Fallen Seer",
        "slug": "expedition",
        "location": "Ocean Biome",
        "type": "Expedition",
        "note": {
          "vi": "Dùng Medved's Saga với Logbook; quest The Grand Expedition",
          "en": "Use Medved's Saga with Logbook; The Grand Expedition quest"
        }
      },
      {
        "name": "Vorana, Last to Fall",
        "slug": "expedition",
        "location": "Ocean Biome",
        "type": "Expedition",
        "note": {
          "vi": "Dùng Vorana's Saga với Logbook; quest The Grand Expedition",
          "en": "Use Vorana's Saga with Logbook; The Grand Expedition quest"
        }
      },
      {
        "name": "Uhtred, the Stardrinker",
        "slug": "expedition",
        "location": "Ocean Biome",
        "type": "Expedition",
        "note": {
          "vi": "Dùng Uhtred's Saga với Logbook; quest The Grand Expedition",
          "en": "Use Uhtred's Saga with Logbook; The Grand Expedition quest"
        }
      },
      {
        "name": "Olroth, Origin of the Fall",
        "slug": "expedition",
        "location": "Ocean Biome",
        "type": "Expedition",
        "note": {
          "vi": "Dùng Olroth's Saga với Logbook; quest The Grand Expedition",
          "en": "Use Olroth's Saga with Logbook; The Grand Expedition quest"
        }
      },
      {
        "name": "The Aberration",
        "slug": "expedition",
        "location": "Verisium Crater",
        "type": "Pinnacle",
        "note": {
          "vi": "Dùng Triskelion Reforged để xóa rào chắn; quest The Grand Expedition",
          "en": "Use Triskelion Reforged to dispel barrier; The Grand Expedition quest"
        }
      }
    ]
  }
];
