import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildGgpkSkillsData,
  formatGgpkSkillsDataScript
} from "../scripts/game-extract/ggpk-skills-web-runtime.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, filename), "utf8");

const version = {
  id: "3",
  version_key: "ggpk_full:fixture",
  source_kind: "ggpk_full",
  source_label: "GGPK full extracted catalog",
  extract_hash: "extract-hash",
  source_hash: "source-hash",
  created_at: "2026-05-25T16:46:20.274Z",
  summary_json: {
    entities: { by_type: { active_skill: 2 } },
    assets: { by_kind: { image: 1, video: 1 } }
  }
};

const activeSkill = {
  entity_type: "active_skill",
  entity_key: "acidic_concoction",
  display_name: "Acidic Concoction",
  source_table: "activeskills",
  source_hash: "skill-hash",
  normalized_json: {
    id: "acidic_concoction",
    name: "Acidic Concoction",
    description: "Consume charges from your Mana [Flask] to throw a flask and [Poison|Poison] on [HitDamage|Hit].",
    short_description: "Consume Mana [Flask] charges to throw a flask.",
    website_description: "",
    icon: "Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
    video: "Art/Videos/SkillExamples/AcidicConcoction.bk2",
    granted_effect: "AcidicConcoctionPlayer",
    is_gem: true,
    stats: ["base_poison_damage_+%"]
  }
};

test("GGPK skills web data keeps active skill, asset, video, and source metadata", () => {
  const data = buildGgpkSkillsData({
    version,
    entities: [
      activeSkill,
      {
        entity_type: "active_skill",
        entity_key: "internal_empty_skill",
        display_name: "internal_empty_skill",
        source_table: "activeskills",
        source_hash: "empty-hash",
        normalized_json: {
          id: "internal_empty_skill",
          name: "",
          description: "",
          icon: "",
          video: "",
          is_gem: true,
          stats: []
        }
      }
    ],
    assets: [
      {
        asset_key: "asset:Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        kind: "image",
        logical_path: "Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        source_path: "Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        local_path: "",
        status: "referenced"
      },
      {
        asset_key: "asset:Art/Videos/SkillExamples/AcidicConcoction.bk2",
        kind: "video",
        logical_path: "Art/Videos/SkillExamples/AcidicConcoction.bk2",
        source_path: "Art/Videos/SkillExamples/AcidicConcoction.bk2",
        local_path: "",
        status: "referenced"
      }
    ],
    entityAssets: [
      {
        entity_type: "active_skill",
        entity_key: "acidic_concoction",
        asset_key: "asset:Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        relation_type: "uses_icon"
      },
      {
        entity_type: "active_skill",
        entity_key: "acidic_concoction",
        asset_key: "asset:Art/Videos/SkillExamples/AcidicConcoction.bk2",
        relation_type: "uses_video"
      }
    ],
    relations: [
      {
        from_entity_type: "active_skill",
        from_entity_key: "acidic_concoction",
        relation_type: "grants_effect",
        to_entity_type: "granted_effect",
        to_entity_key: "AcidicConcoctionPlayer"
      }
    ]
  });

  assert.equal(data.source.extract_version_id, "3");
  assert.equal(data.source.source_kind, "ggpk_full");
  assert.equal(data.total, 1);
  assert.deepEqual(data.counts, {
    active_skill_raw: 2,
    active_skill_exported: 1,
    with_icon: 1,
    with_video: 1,
    is_gem: 1
  });
  assert.equal(data.skills[0].slug, "acidic_concoction");
  assert.equal(data.skills[0].description, "Consume charges from your Mana Flask to throw a flask and Poison on Hit.");
  assert.equal(data.skills[0].short_description, "Consume Mana Flask charges to throw a flask.");
  assert.equal(data.skills[0].icon_asset.kind, "image");
  assert.equal(data.skills[0].video_asset.kind, "video");
  assert.equal(data.skills[0].icon_url, "");
  assert.equal(data.skills[0].video_url, "");
  assert.equal(data.skills[0].source_category_key, "activeskills");
  assert.equal(data.skills[0].source_category, "Active Skills");
  assert.deepEqual(data.skills[0].categories, ["Active Skills", "Flask", "Gem"]);
  assert.equal(data.skills[0].relations[0].to, "AcidicConcoctionPlayer");
  assert.equal(data.skills[0].stats[0], "base_poison_damage_+%");
});

test("GGPK skills web data only uses app-owned stored asset URLs", () => {
  const data = buildGgpkSkillsData({
    version,
    entities: [activeSkill],
    assets: [
      {
        asset_key: "asset:Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        kind: "image",
        logical_path: "Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        metadata_json: {
          public_url: "https://assets.poeviethoa.net/ggpk/assets/image/rangerbrewconcoctionpoisonskill.webp",
          storage_provider: "r2",
          storage_key: "ggpk/assets/image/rangerbrewconcoctionpoisonskill.webp"
        }
      },
      {
        asset_key: "asset:Art/Videos/SkillExamples/AcidicConcoction.bk2",
        kind: "video",
        logical_path: "Art/Videos/SkillExamples/AcidicConcoction.bk2",
        metadata_json: {
          public_url: "https://assets.poeviethoa.net/ggpk/assets/video/acidicconcoction.webm",
          storage_provider: "r2",
          storage_key: "ggpk/assets/video/acidicconcoction.webm"
        }
      },
      {
        asset_key: "asset:Art/2DArt/SkillIcons/PoeDbLeak.dds",
        kind: "image",
        logical_path: "Art/2DArt/SkillIcons/PoeDbLeak.dds",
        metadata_json: {
          public_url: "https://cdn.poe2db.tw/image/Art/2DArt/SkillIcons/PoeDbLeak.webp"
        }
      }
    ],
    entityAssets: [
      {
        entity_type: "active_skill",
        entity_key: "acidic_concoction",
        asset_key: "asset:Art/2DArt/SkillIcons/RangerBrewConcoctionPoisonSkill.dds",
        relation_type: "uses_icon"
      },
      {
        entity_type: "active_skill",
        entity_key: "acidic_concoction",
        asset_key: "asset:Art/Videos/SkillExamples/AcidicConcoction.bk2",
        relation_type: "uses_video"
      }
    ]
  });

  assert.equal(data.skills[0].icon_url, "https://assets.poeviethoa.net/ggpk/assets/image/rangerbrewconcoctionpoisonskill.webp");
  assert.equal(data.skills[0].video_url, "https://assets.poeviethoa.net/ggpk/assets/video/acidicconcoction.webm");
  assert.equal(data.skills[0].icon_asset.storage_provider, "r2");
  assert.doesNotMatch(formatGgpkSkillsDataScript(data), /poe2db/i);
});

test("GGPK skills data script exposes a browser global", () => {
  const data = buildGgpkSkillsData({ version, entities: [activeSkill] });
  const script = formatGgpkSkillsDataScript(data);

  assert.match(script, /^window\.POE2_GGPK_SKILLS = /);
  assert.match(script, /"source_kind": "ggpk_full"/);
  assert.match(script, /;\n$/);
});

test("GGPK skills page and local route consume the GGPK data export", async () => {
  const [page, routes, server] = await Promise.all([
    readProjectFile("public/ggpk_skills.html"),
    readProjectFile("public/app-routes.js"),
    readProjectFile("scripts/serve-static.mjs")
  ]);

  assert.match(page, /<script src="data\/ggpk-skills-data\.js"><\/script>/);
  assert.match(page, /window\.POE2_GGPK_SKILLS/);
  assert.match(page, /id="ggpkSkillGrid"/);
  assert.match(page, /id="ggpkSkillSearch"/);
  assert.match(page, /src="\$\{escapeHtml\(skill\.icon_url\)\}"/);
  assert.match(page, /id="ggpkModalCategories"/);
  assert.match(page, /skill\.categories/);
  assert.doesNotMatch(page, /poe2db/i);
  assert.doesNotMatch(page, /Icon asset/);
  assert.doesNotMatch(page, /Video asset/);
  assert.doesNotMatch(page, /Source row/);
  assert.doesNotMatch(page, /ggpkModalIconPath/);
  assert.doesNotMatch(page, /ggpkModalVideoPath/);
  assert.doesNotMatch(page, /ggpkModalSource/);
  assert.match(routes, /ggpkskills:\s*{[\s\S]*?href:\s*"\/ggpk-skills"/);
  assert.match(routes, /ggpkskills:\s*{[\s\S]*?navParent:\s*"lookup"/);
  assert.match(server, /\["\/ggpk-skills", "\/index\.html"\]/);
});

test("GGPK skill detail modal exposes indexed skill videos", async () => {
  const [page, runtime] = await Promise.all([
    readProjectFile("public/ggpk_skills.html"),
    readProjectFile("scripts/game-extract/ggpk-skills-web-runtime.mjs")
  ]);

  assert.match(page, /id="ggpkModalVideoPanel"/);
  assert.match(page, /id="ggpkModalVideoPlayer"[\s\S]*controls/);
  assert.match(page, /id="ggpkModalVideoStatus"/);
  assert.match(page, /const playableVideoUrl = \(skill\) =>/);
  assert.match(page, /modalVideoPanel\.classList\.toggle\("hidden", !playableVideo\)/);
  assert.match(page, /modalVideoPlayer\.src = playableVideo/);
  assert.match(page, /skill\.video_url/);
  assert.doesNotMatch(runtime, /poe2db/i);
  assert.doesNotMatch(runtime, /SkillTutorials/);
});
