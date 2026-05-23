import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSkillGemDetailPage,
  parseSkillGemsPage,
  translateSkillDetailLine,
  translateSkillText,
  translateTags
} from "../scripts/skill-gems-lib.mjs";

const sampleHtml = `
<div id="SkillGemsGem">
  <table>
    <tbody>
      <tr data-filters="Attack AoE Melee Strike Boneshatter">
        <td><a class="gem_red" data-hover="https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/abc" href="/us/Boneshatter"><img src="https://cdn.poe2db.tw/image/Boneshatter.webp" alt="BruteBoneshatter"></a></td>
        <td><a class="gem_red" data-hover="https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/abc" href="/us/Boneshatter">Boneshatter</a> (1)
          <div class="gem_tags small"><a data-keyword="Attack">Attack</a>, <a data-keyword="AoESkill">AoE</a>, <a data-keyword="Melee">Melee</a></div>
        </td>
      </tr>
      <tr data-filters="Buff Persistent Fire Herald Herald of Ash">
        <td><a class="gem_blue" data-hover="https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/def" href="/us/Herald_of_Ash"><img src="https://cdn.poe2db.tw/image/Herald.webp" alt="HeraldOfAshSkill"></a></td>
        <td><a class="gem_blue" data-hover="https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/def" href="/us/Herald_of_Ash">Herald of Ash</a> (3)
          <div class="gem_tags small"><a data-keyword="Buff">Buff</a>, <a data-keyword="Persistent">Persistent</a>, <a data-keyword="Fire">Fire</a></div>
        </td>
      </tr>
    </tbody>
  </table>
</div>`;

const sampleDetailHtml = `
<html>
  <head>
    <meta property="og:description" content="Attack enemies with a melee Strike. The Strike will cause a Heavy Stun on enemies that are Primed for Stun. Upon causing a Heavy Stun it will also create a Shockwave, dealing a large amount of damage in an area." />
  </head>
  <body>
    <div class="newItemPopup GemPopup">
      <div class="Stats">
        <div class="property">Tier: 1</div>
        <div class="property">Cost: (9â€”60) Mana</div>
        <div class="requirements">Requires: Level (1â€”90), (4â€”157) Str</div>
        <div class="separator"></div>
        <div class="secDescrText">Attack enemies with a melee Strike.</div>
      </div>
      <div class="hybridHeader gemTabs"><div class="TextGem TitleBar"><span class="ItemType">Initial Strike</span></div></div>
      <div class="Stats">
        <div class="explicitMod">+2 to Melee Strike Range</div>
        <div class="qualityMod">(0â€”30)% increased Attack Speed</div>
      </div>
    </div>
  </body>
</html>`;

test("parseSkillGemsPage extracts stable source records", () => {
  const gems = parseSkillGemsPage(sampleHtml, "https://poe2db.tw/us/Skill_Gems");

  assert.equal(gems.length, 2);
  assert.deepEqual(gems[0], {
    slug: "Boneshatter",
    name: "Boneshatter",
    tier: 1,
    color: "red",
    source_url: "https://poe2db.tw/us/Boneshatter",
    icon_url: "https://cdn.poe2db.tw/image/Boneshatter.webp",
    icon_alt: "BruteBoneshatter",
    hover_url: "https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/abc",
    tags: ["Attack", "AoE", "Melee"],
    source_hash: gems[0].source_hash
  });
  assert.match(gems[0].source_hash, /^[a-f0-9]{64}$/);
});

test("parseSkillGemsPage keeps duplicate source rows as separate variants", () => {
  const duplicateHtml = sampleHtml.replace("</tbody>", `
      <tr data-filters="Buff Persistent Fire Herald Herald of Ash">
        <td><a class="gem_blue" data-hover="https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/ghi" href="/us/Herald_of_Ash"><img src="https://cdn.poe2db.tw/image/Herald2.webp" alt="HeraldOfAshSkill"></a></td>
        <td><a class="gem_blue" data-hover="https://cdn.poe2db.tw/cache2/us/Poe_Data_GemEffects_hover/ghi" href="/us/Herald_of_Ash">Herald of Ash</a> (4)
          <div class="gem_tags small"><a data-keyword="Buff">Buff</a>, <a data-keyword="Persistent">Persistent</a>, <a data-keyword="Fire">Fire</a></div>
        </td>
      </tr>
    </tbody>`);
  const gems = parseSkillGemsPage(duplicateHtml, "https://poe2db.tw/us/Skill_Gems");

  assert.equal(gems.length, 3);
  assert.equal(gems.filter((gem) => gem.name === "Herald of Ash").length, 2);
  assert.ok(gems.some((gem) => gem.slug === "Herald_of_Ash__2"));
});

test("translation helpers cover detail text and tags while preserving technical terms", () => {
  assert.equal(
    translateSkillText("Attack enemies with a melee Strike. The Strike will cause a Heavy Stun."),
    "Tấn công kẻ địch bằng melee Strike. Strike sẽ gây Heavy Stun."
  );
  assert.deepEqual(
    translateTags(["Physical", "Ammunition", "Meta", "Totem", "Chaos", "Persistent", "Staged"]),
    ["Physical", "Ammunition", "Meta", "Totem", "Chaos", "Persistent", "Staged"]
  );
});

test("translateSkillText covers full card summaries without English sentence fragments", () => {
  assert.equal(
    translateSkillText("Consume charges from your Mana Flask to throw a flask that explodes, dealing Physical Attack damage in an area. The thrown flask Consumes Poison on Hit to cause an acidic burst."),
    "Tiêu hao Charge từ Mana Flask để ném một flask phát nổ, gây Physical Attack Damage diện rộng. Flask được ném sẽ Consume Poison khi Hit để kích hoạt một vụ nổ acid."
  );
  assert.equal(
    translateSkillText("Each of your Totems will summon an Ancestral Spirit Minion to fight for you. If the Totem that summoned the Minion dies then the Ancestral Spirit will too."),
    "Mỗi Totem của bạn sẽ summon một Ancestral Spirit Minion để chiến đấu cho bạn. Nếu Totem đã summon Minion đó chết, Ancestral Spirit cũng sẽ chết theo."
  );
  assert.equal(
    translateSkillText("Load your Crossbow with a clip of bolts that can be fired rapidly and Break enemy Armour. Using this Skill again reloads the clip."),
    "Nạp Crossbow của bạn bằng một băng bolt có thể bắn liên tục và Break Armour của kẻ địch. Dùng lại Skill này để reload băng đạn."
  );
  assert.equal(
    translateSkillText("Strike with your Axe."),
    "Đánh bằng Axe của bạn."
  );
});

test("translateSkillText covers later tier skill summaries naturally", () => {
  assert.equal(
    translateSkillText("Deploy a Ballista Totem that rains down a salvo of Pinning, Maiming bolts."),
    "Triển khai một Ballista Totem bắn mưa loạt bolt gây hiệu ứng Pinning và Maiming."
  );
  assert.equal(
    translateSkillText("Channel to charge up before firing off a burning arrow. At maximum stages, the arrow will create a Detonating explosion at the end of its flight."),
    "Channel để tích tụ năng lượng trước khi bắn một arrow rực cháy. Ở stages tối đa, arrow sẽ tạo ra một vụ nổ Detonating khi kết thúc đường bay."
  );
  assert.equal(
    translateSkillText("Rain a storm of flaming bolts over the targeted area. Can Consume all three types of Elemental Infusion, creating a much larger storm when Fire-Infused, causing lightning bolts when Lightning-Infused, and raining ice bolts when Cold-Infused."),
    "Gọi xuống một cơn bão bolt lửa trên vùng chỉ định. Có thể Consume cả 3 loại Elemental Infusion: tạo ra bão lớn hơn nhiều khi Fire-Infused, gọi lightning bolts khi Lightning-Infused, và trút mưa ice bolts khi Cold-Infused."
  );
  assert.equal(
    translateSkillText("While active, you gain powerful Buffs based on your active Charges. However, maintaining the Buff Consumes Charges every few seconds."),
    "Khi đang active, bạn nhận được các Buffs mạnh mẽ dựa trên các Charges đang kích hoạt. Tuy nhiên, duy trì Buff này sẽ Consume các Charges mỗi vài giây."
  );
});

test("translateSkillText keeps only short technical terms in conjure summaries", () => {
  const rootboundFissure = translateSkillText("Conjures a rootbound fissure that crawls forward, damaging enemies in its path. While the fissure persists, vines lash out from it and attach to nearby enemies, damaging and Slowing them.");

  assert.equal(
    rootboundFissure,
    "Tạo một khe nứt bám rễ bò về phía trước, gây Damage lên kẻ địch trên đường đi. Khi khe nứt còn tồn tại, dây leo quất ra từ đó và bám vào kẻ địch gần đó, gây Damage và Slow chúng."
  );
  assert.doesNotMatch(rootboundFissure, /\bConjures\b|\bin its path\b|\bWhile the fissure persists\b|\bnearby enemies\b/i);

  const icyProjectiles = translateSkillText("Conjures a number of icy Projectiles that launch towards the target. Projectiles that Hit a Chilled or Frozen target create chunks of ice that deal additional damage on impacting the ground. Consumes a Cold Infusion if possible to cause each Projectile to lodge into the enemy then explode.");

  assert.equal(
    icyProjectiles,
    "Tạo nhiều Projectile băng phóng về phía mục tiêu. Projectile Hit mục tiêu Chilled hoặc Frozen sẽ tạo mảnh băng gây thêm Damage khi va xuống đất. Nếu có thể, Consume Cold Infusion để mỗi Projectile cắm vào kẻ địch rồi phát nổ."
  );
  assert.doesNotMatch(icyProjectiles, /\bConjures\b|\btowards the target\b|\bchunks of ice\b|\blodge into\b/i);
});

test("translateSkillText preserves rarity terms in skill summaries", () => {
  assert.equal(
    translateSkillText("While active, uses fragments of armour scavenged from enemies to bolster your own. Fully Breaking an enemy's Armour grants you stacks of Scavenged Plating for a duration based on the enemy's rarity, and you gain Armour and Thorns per stack. Normal enemies grant 1 stack, Magic enemies grant 2 stacks, Rare enemies grant 5 stacks and Unique enemies grant 10 stacks."),
    "Khi đang active, sử dụng các mảnh giáp thu được từ kẻ địch để gia cố cho chính bạn. Break hoàn toàn Armour của một kẻ địch sẽ cấp cho bạn các stack Scavenged Plating với thời lượng dựa trên Rarity của kẻ địch đó, giúp bạn nhận thêm Armour và Thorns ứng với mỗi stack. Kẻ địch Normal cấp 1 stack, kẻ địch Magic cấp 2 stack, kẻ địch Rare cấp 5 stack và kẻ địch Unique cấp 10 stack."
  );
  assert.equal(
    translateSkillText("While active, causes you to deal more Hit damage to Rare and Unique enemies the longer you've been fighting them, and gain Culling Strike against them once you've been fighting them for long enough."),
    "Khi đang active, khiến bạn gây thêm nhiều Hit Damage hơn lên các kẻ địch Rare và Unique theo thời gian bạn giao chiến với chúng, và nhận được Culling Strike lên chúng khi đã giao chiến đủ lâu."
  );
});

test("translateSkillDetailLine translates stat lines while preserving POE terms", () => {
  assert.equal(
    translateSkillDetailLine("Buff grants (40â€”59)% more Damage with the affected Element"),
    "Buff cấp (40â€”59)% more Damage với Element đang được ảnh hưởng"
  );
  assert.equal(
    translateSkillDetailLine("Additional Effects From Quality:"),
    "Hiệu ứng thêm từ Quality:"
  );
  assert.equal(
    translateSkillDetailLine("Converts 80% of Physical damage to Cold damage"),
    "Chuyển 80% Physical Damage thành Cold Damage"
  );
  assert.equal(
    translateSkillDetailLine("Consumes Freeze on Non-Unique enemies to deal 250% more Damage"),
    "Consume Freeze trên kẻ địch Non-Unique để gây 250% more Damage"
  );
  assert.equal(
    translateSkillDetailLine("Normal and Magic monsters grant 1 Power Charge Rare monsters grant 2 Power Charges Unique monsters grant 3 Power Charges"),
    "Normal và Magic monster cấp 1 Power Charge. Rare monster cấp 2 Power Charges. Unique monster cấp 3 Power Charges"
  );
  assert.equal(
    translateSkillDetailLine("You have Culling Strike against Rare and Unique enemies that have been in your Presence for a total of at least (31â€”40) seconds"),
    "Bạn có Culling Strike lên kẻ địch Rare và Unique đã ở trong Presence của bạn tổng cộng ít nhất (31â€”40) giây"
  );
  assert.equal(
    translateSkillDetailLine("You deal 1% more Hit Damage to Rare and Unique enemies for every 2 seconds they have ever been in your Presence, up to (40â€”59)%"),
    "Bạn gây 1% more Hit Damage lên kẻ địch Rare và Unique cho mỗi 2 giây chúng từng ở trong Presence của bạn, tối đa (40â€”59)%"
  );
});

test("translateSkillDetailLine cleans common generated stat-line fragments", () => {
  assert.equal(
    translateSkillDetailLine("Deals (1—11) to (10—216) Lightning Damage"),
    "Gây (1—11) đến (10—216) Lightning Damage"
  );
  assert.equal(
    translateSkillDetailLine("Consumes 5 Charges from your Mana Flask"),
    "Consume 5 Charges từ Mana Flask của bạn"
  );
  assert.equal(
    translateSkillDetailLine("Fires (12—16) Projectiles in a circle"),
    "Bắn (12—16) Projectiles theo vòng tròn"
  );
  assert.equal(
    translateSkillDetailLine("Projectiles fired at the same time can Hit the same target no more than once every 0.66 seconds"),
    "Các Projectile bắn cùng lúc chỉ có thể Hit cùng một mục tiêu tối đa một lần mỗi 0.66 giây"
  );
  assert.equal(
    translateSkillDetailLine("Supported Skills fire Projectiles in a circle"),
    "Skill được Support bắn Projectiles theo vòng tròn"
  );
  assert.equal(
    translateSkillDetailLine("Has 10 maximum Energy per 0.1 seconds of base cast time of Socketed Spells"),
    "Có 10 Energy tối đa cho mỗi 0.1 giây Cast Time cơ bản của Socketed Spells"
  );
  assert.equal(
    translateSkillDetailLine("Minions from this skill have 1% increased Attack Speed per 3 of your Dexterity"),
    "Minions từ Skill này có 1% increased Attack Speed cho mỗi 3 Dexterity của bạn"
  );
});

test("translateSkillDetailLine localizes generated stat glue in detail pages", () => {
  assert.equal(
    translateSkillDetailLine("Requires: Level (1—90), (4—86) Str, (4—86) Dex"),
    "Yêu cầu: Cấp (1—90), (4—86) Str, (4—86) Dex"
  );
  assert.equal(
    translateSkillDetailLine("Attack Speed: 85% of base"),
    "Attack Speed: 85% tốc độ cơ bản"
  );
  assert.equal(
    translateSkillDetailLine("Attack Damage: (70—185)% of base"),
    "Attack Damage: (70—185)% sát thương cơ bản"
  );
  assert.equal(
    translateSkillDetailLine("Projectile Speed: 12 metres per Second"),
    "Projectile Speed: 12 mét/giây"
  );
  assert.equal(
    translateSkillDetailLine("(7—196) to (11—294) base Physical Damage"),
    "(7—196) đến (11—294) Physical Damage cơ bản"
  );
  assert.equal(
    translateSkillDetailLine("Explosion radius is 1.8 metres"),
    "Vụ nổ có bán kính 1.8 mét"
  );
  assert.equal(
    translateSkillDetailLine("Burst radius is 1.5 metres"),
    "Burst có bán kính 1.5 mét"
  );
  assert.equal(
    translateSkillDetailLine("Debuff deals 100% more Damage for each time it has spread, up to 300%"),
    "Debuff gây 100% more Damage cho mỗi lần đã lan, tối đa 300%"
  );
  assert.equal(
    translateSkillDetailLine("50% more Damage with Hits for Shockwaves originating from a Unique enemy"),
    "50% more Damage với Hits cho Shockwave phát ra từ kẻ địch Unique"
  );
});

test("translateSkillDetailLine covers recurring later-tier dirty detail lines", () => {
  assert.equal(
    translateSkillDetailLine("Deals Damage every 0.25 seconds"),
    "Gây Damage mỗi 0.25 giây"
  );
  assert.equal(
    translateSkillDetailLine("5% more Damage for each previous Ember fired in sequence"),
    "5% more Damage cho mỗi Ember đã bắn trước đó trong chuỗi"
  );
  assert.equal(
    translateSkillDetailLine("Enemies Hit receive Electrocution buildup from Lightning damage for 4 second duration"),
    "Kẻ địch bị Hit nhận Electrocution buildup từ Lightning Damage trong 4 giây"
  );
  assert.equal(
    translateSkillDetailLine("Curse does not apply to enemies above level (0—20)"),
    "Curse không áp dụng lên kẻ địch trên cấp (0—20)"
  );
  assert.equal(
    translateSkillDetailLine("Marked enemy becomes Frozen when Hit while Primed for Freeze"),
    "Kẻ địch bị Mark trở thành Frozen khi bị Hit trong lúc Primed for Freeze"
  );
  assert.equal(
    translateSkillDetailLine("Generates 100% of Monster Power as Glory for this Skill on Hitting with an Attack"),
    "Tạo 100% Monster Power thành Glory cho Skill này khi Hit bằng Attack"
  );
  assert.equal(
    translateSkillDetailLine("Rage cost is ignored for first 2.5 seconds of Channelling"),
    "Bỏ qua Rage cost trong 2.5 giây đầu của Channelling"
  );
  assert.equal(
    translateSkillDetailLine("Revived Skeletons are immune to Damage for (0—3) seconds after being Revived"),
    "Revived Skeletons miễn nhiễm Damage trong (0—3) giây sau khi được Revive"
  );
  assert.equal(
    translateSkillDetailLine("Triggers Navira's Calming when Commanded to use a Skill, granting nearby Allies (10—67)% increased Mana Regeneration for 4 seconds"),
    "Trigger Navira's Calming khi được Command dùng Skill, cấp cho Allies gần đó (10—67)% increased Mana Regeneration trong 4 giây"
  );
  assert.equal(
    translateSkillDetailLine("Projectile Chains 3 additional times on first hitting a Shocked or Electrocuted enemy, releasing a Shockwave on each Hit"),
    "Projectile Chain thêm 3 lần khi Hit đầu tiên vào kẻ địch Shocked hoặc Electrocuted, release Shockwave trên mỗi Hit"
  );
  assert.equal(
    translateSkillDetailLine("Wall Segments have (36—12714) maximum Life"),
    "Wall Segments có (36—12714) Life tối đa"
  );
  assert.equal(
    translateSkillDetailLine("+2 to Melee Strike Range"),
    "+2 Melee Strike Range"
  );
  assert.equal(
    translateSkillDetailLine("6 to 8 Added Physical Damage per 15 Armour on Shield"),
    "6 đến 8 Added Physical Damage mỗi 15 Armour trên Shield"
  );
  assert.equal(
    translateSkillDetailLine("Ignites as though dealing (5—181) to (8—271) Fire Damage"),
    "Ignite như thể gây (5—181) đến (8—271) Fire Damage"
  );
  assert.equal(
    translateSkillDetailLine("Aura grants +278 to maximum Total Energy Shield"),
    "Aura cấp +278 Total Energy Shield tối đa"
  );
  assert.equal(
    translateSkillDetailLine("Chills enemies in your Presence as though dealing (26—888) to (39—1332) Cold Damage"),
    "Chill kẻ địch trong Presence của bạn như thể gây (26—888) đến (39—1332) Cold Damage"
  );
  assert.equal(
    translateSkillDetailLine("Shield Bash deals 3 to 4 Physical Damage per 5 Armour on Shield"),
    "Shield Bash gây 3 đến 4 Physical Damage mỗi 5 Armour trên Shield"
  );
  assert.equal(
    translateSkillDetailLine("Empowered Attacks deal (4—121) to (5—186) additional Cold Damage"),
    "Empowered Attacks gây (4—121) đến (5—186) thêm Cold Damage"
  );
  assert.equal(
    translateSkillDetailLine("+(0—1.5) seconds to Corrupted Blood duration"),
    "+(0—1.5) giây thời lượng Corrupted Blood"
  );
  assert.equal(
    translateSkillDetailLine("(300—585)% more Magnitude of Chill inflicted"),
    "(300—585)% more Magnitude của Chill đã inflict"
  );
  assert.equal(
    translateSkillDetailLine("Poisons enemies as though Hitting them"),
    "Poison kẻ địch như thể Hit chúng"
  );
  assert.equal(
    translateSkillDetailLine("Pins enemies as though dealing 50% more Damage"),
    "Pin kẻ địch như thể gây 50% more Damage"
  );
  assert.equal(
    translateSkillDetailLine("80% less damage if destroyed within 0.5 seconds by something other than you"),
    "80% less Damage nếu bị phá hủy trong 0.5 giây bởi thứ không phải bạn"
  );
  assert.equal(
    translateSkillDetailLine("Corrupted Blood deals 2% of slain Enemy's maximum Life as Physical damage per second"),
    "Corrupted Blood gây Physical Damage mỗi giây bằng 2% Life tối đa của kẻ địch bị hạ"
  );
  assert.equal(
    translateSkillDetailLine("Stored Poison adds up to 1.5 metres to base explosion radius"),
    "Stored Poison thêm tối đa 1.5 mét vào bán kính nổ cơ bản"
  );
  assert.equal(
    translateSkillDetailLine("Does not Hit, but Poisons enemies as though Hitting them"),
    "Không Hit, nhưng Poison kẻ địch như thể Hit chúng"
  );
  assert.equal(
    translateSkillDetailLine("Pustules store expected damage of Poisons inflicted on them"),
    "Pustules lưu Damage dự kiến của Poisons đã inflict lên chúng"
  );
  assert.equal(
    translateSkillDetailLine("+0.2 metres to wave length for each wave in the Sequence"),
    "+0.2 mét chiều dài wave cho mỗi wave trong Sequence"
  );
});

test("translateSkillText covers late-tier summaries without word-by-word residue", () => {
  const rapidShot = translateSkillText("Load your Crossbow with a large clip of heated bolts. Heat builds up on your Crossbow as you fire them, and reaching maximum Heat will prevent you from firing or reloading these bolts for a short time. However, other Skills can Consume Heat for extra benefits. Using this Skill again reloads the clip.");
  assert.equal(
    rapidShot,
    "Nạp Crossbow bằng một clip lớn các bolt nung nóng. Heat tích tụ trên Crossbow khi bạn bắn chúng; đạt Heat tối đa sẽ ngăn bạn bắn hoặc reload các bolt này trong thời gian ngắn. Tuy nhiên, Skills khác có thể Consume Heat để nhận thêm lợi ích. Dùng lại Skill này để reload clip."
  );
  assert.doesNotMatch(rapidShot, /\blarge clip\b|\bHeat builds up\b|\bfire them\b|\bbenefits\b/i);

  const plasmaBlast = translateSkillText("Load your Crossbow with unstable bolts that require a lengthy charging period to fire but deal devastating damage, Pierce through enemies, and explode upon hitting terrain. Additional Projectiles are fired in a spread, unlike other Crossbow Skills.");
  assert.equal(
    plasmaBlast,
    "Nạp Crossbow bằng bolt bất ổn định, cần thời gian charge dài trước khi bắn nhưng gây Damage cực lớn, Pierce xuyên kẻ địch và phát nổ khi chạm địa hình. Các Projectile bổ sung được bắn tỏa ra, khác với các Crossbow Skills khác."
  );
  assert.doesNotMatch(plasmaBlast, /\bunstable bolts that require\b|\blengthy charging period\b|\bAdditional Projectiles are fired\b|\bunlike\b/i);

  const shieldWall = translateSkillText("Ram your Shield into the ground, throwing up a wall of earth. Enemies can attack your wall segments, and your Slams, Warcries, and Shield Charge will instantly shatter them all. The segments explode when shattered, damaging enemies in front of and around them.");
  assert.equal(
    shieldWall,
    "Đập Shield xuống đất, dựng lên một tường đất. Kẻ địch có thể tấn công các đoạn tường; Slams, Warcries và Shield Charge của bạn sẽ lập tức shatter toàn bộ chúng. Các đoạn tường phát nổ khi bị shatter, gây Damage lên kẻ địch phía trước và xung quanh."
  );
  assert.doesNotMatch(shieldWall, /\bthrowing up\b|\bwall segments\b|\bfront of and around\b/i);
});

test("translateSkillText and detail lines clean remaining production-facing residue", () => {
  const rapidAssault = translateSkillText("Perform a series of six rapid stabs. The final stab inflicts Bleeding and leaves a spearhead stuck in the target, Maiming them for a duration. Detonator Skills will cause the stuck spearheads to explode, dealing further damage to the target and other nearby enemies.");
  assert.equal(
    rapidAssault,
    "Thực hiện chuỗi 6 cú đâm nhanh. Cú đâm cuối gây Bleeding và để lại một Spearhead cắm trong mục tiêu, Maim chúng trong một thời lượng. Detonator Skills sẽ kích nổ các Spearhead đang cắm, gây thêm Damage lên mục tiêu và kẻ địch gần đó."
  );
  assert.doesNotMatch(rapidAssault, /\bseries of\b|\brapid stabs\b|\bfinal stab inflicts\b|\bstuck\b|\bfurther damage\b/i);

  assert.equal(
    translateSkillDetailLine("20% more Corrupted Blood infliction Area of Effect per Blood Boil on slain Enemy"),
    "20% more Area of Effect khi áp dụng Corrupted Blood cho mỗi Blood Boil trên kẻ địch bị hạ"
  );
  assert.equal(
    translateSkillDetailLine("Inflicts a stack of Corrupted Blood on targets within 1.5 metres per Blood Boil on slain Enemy"),
    "Áp dụng một stack Corrupted Blood lên mục tiêu trong phạm vi 1.5 mét cho mỗi Blood Boil trên kẻ địch bị hạ"
  );
  assert.equal(
    translateSkillDetailLine("Deals +15% of exploded enemy's Blood Loss as unscalable Physical Attack Damage"),
    "Gây Physical Attack Damage không scale bằng +15% Blood Loss của kẻ địch đã phát nổ"
  );
  assert.equal(
    translateSkillDetailLine("Magma Spray radius is 2.8 metres"),
    "Luồng Magma có bán kính 2.8 mét"
  );
  assert.equal(
    translateSkillDetailLine("Oil spray radius is 2.1 metres"),
    "Vệt Oil có bán kính 2.1 mét"
  );
  assert.equal(
    translateSkillDetailLine("Damage and Oil spray radius is (2—2.6) metres"),
    "Damage và vệt Oil có bán kính (2—2.6) mét"
  );
  assert.equal(
    translateSkillDetailLine("Empowered Attacks Repeat +2 times, and a further +1 time per Frenzy Charge consumed"),
    "Empowered Attacks Repeat +2 lần, thêm +1 lần nữa cho mỗi Frenzy Charge đã Consume"
  );
  assert.equal(
    translateSkillDetailLine("Remnants created by Supported Skills can be collected from (0—38)% further away"),
    "Remnants được tạo bởi Supported Skills có thể nhặt từ xa hơn (0—38)%"
  );
  assert.equal(
    translateSkillDetailLine("Illusions have 1% of your maximum Life"),
    "Illusions có 1% Life tối đa của bạn"
  );
  assert.equal(
    translateSkillDetailLine("(9.15—12) second delay between Visage"),
    "(9.15—12) giây trễ giữa các Visage"
  );
  assert.equal(
    translateSkillDetailLine("25% increased Visage frequency per Spell Visages could cast"),
    "25% increased tần suất Visage cho mỗi Spell mà Visage có thể cast"
  );
  assert.equal(
    translateSkillDetailLine("40% chance to inflict Bleeding on Hit"),
    "40% chance gây Bleeding khi Hit"
  );
  assert.equal(
    translateSkillDetailLine("Cast Time: 0.75 sec"),
    "Cast Time: 0.75 giây"
  );
  assert.equal(
    translateSkillDetailLine("Limit 5 Spearheads stuck in each Target"),
    "Giới hạn 5 Spearheads cắm trong mỗi mục tiêu"
  );
  assert.equal(
    translateSkillDetailLine("Once Ignited, Oil Ground adds 100% of this Attack's Fire Damage as unscalable Damage to the Ignite"),
    "Sau khi bị Ignited, Oil Ground thêm 100% Fire Damage của Attack này thành Damage không scale cho Ignite"
  );
});

test("translateSkillText covers mixed-English skill summaries without corrupting Vietnamese words", () => {
  assert.equal(
    translateSkillText("Launch a large ball of Fire which explodes on impact. The explosion Consumes a Fire Infusion if possible to launch a ring of smaller firebolts."),
    "Phóng một quả cầu Fire lớn phát nổ khi va chạm. Nếu có thể, vụ nổ Consume Fire Infusion để phóng một vòng các firebolt nhỏ hơn."
  );
  assert.equal(
    translateSkillText("Shapeshift into a demon, vastly boosting the power of your Spells. You gain Demonflame every second you remain in demon form, causing your Life to be lost at an ever-increasing rate. Maximum 10 Demonflame. Revert to human form if you reach 1 Life, use a Skill that isn't a Spell, or reactivate this Skill."),
    "Biến hình thành demon, tăng mạnh sức mạnh Spells của bạn. Bạn nhận Demonflame mỗi giây khi duy trì dạng demon, khiến Life bị mất với tốc độ ngày càng tăng. Tối đa 10 Demonflame. Trở về dạng người nếu bạn còn 1 Life, dùng Skill không phải Spell, hoặc kích hoạt lại Skill này."
  );
  const spark = translateSkillText("Launch a spray of sparking Projectiles that travel erratically along the ground until they hit an enemy or expire. Consumes a Cold Infusion if possible to fire many sparks in a circle.");
  assert.equal(
    spark,
    "Phóng một loạt Projectile tia lửa bay ngẫu nhiên dọc theo mặt đất cho đến khi chúng Hit kẻ địch hoặc hết thời lượng. Nếu có thể, Consume Cold Infusion để bắn ra nhiều tia lửa theo một vòng tròn."
  );
  assert.doesNotMatch(spark, /củmột|đểàn|tối đmột|\bspray of\b|\bProjectiles that travel\b/i);
});

test("translateSkillText removes leaked English it/its from production summaries", () => {
  const dirtyPronouns = /\b(it|its|itself)\b/i;
  const cases = new Map([
    [
      "Manifest a copy of your main hand Melee Martial Weapon as an immortal Companion to fight by your side. In addition to its standard Strikes, the Manifested Weapon gains an additional Attack depending on its weapon type.",
      "Manifest một bản sao Melee Martial Weapon tay chính của bạn dưới dạng Companion bất tử chiến đấu cạnh bạn. Ngoài các Strike cơ bản, Manifested Weapon nhận thêm một Attack tùy theo loại weapon."
    ],
    [
      "Place a Sigil on the ground, providing a powerful Spell Damage Buff to you and Allies while standing in it. The Buff becomes more powerful the more mana you spend while standing in the Sigil.",
      "Đặt một Sigil lên mặt đất, cấp Spell Damage Buff mạnh cho bạn và Allies khi đứng trong vùng Sigil. Buff mạnh hơn theo lượng Mana bạn tiêu khi đứng trong Sigil."
    ],
    [
      "Whip up a twister with a flick of your Spear. The twister moves forward erratically, Blinding and repeatedly Hitting enemies within. If a twister touches a Whirlwind from your other skills, it Consumes the Whirlwind to create additional twisters that deal more damage. Passing over Elemental Ground Surfaces or Consuming an elemental Whirlwind will grant twisters extra damage of that element.",
      "Tạo một twister bằng cú vung Spear của bạn. Twister di chuyển thất thường về phía trước, Blind và liên tục Hit kẻ địch trong phạm vi. Nếu twister chạm Whirlwind từ Skill khác của bạn, twister Consume Whirlwind đó để tạo thêm các twister gây nhiều Damage hơn. Khi đi qua Elemental Ground Surface hoặc Consume Whirlwind elemental, twister nhận thêm Damage thuộc element đó."
    ],
    [
      "Create a storm that sucks in enemies and deals Physical damage over time. A Tornado that overlaps an Elemental Ground Surface absorbs that surface's Debuff, applying it to enemies inside the Tornado and causing the Tornado to deal extra damage of that element.",
      "Tạo một storm hút kẻ địch vào trong và gây Physical Damage theo thời gian. Tornado chồng lên Elemental Ground Surface sẽ hấp thụ Debuff của surface đó, áp dụng Debuff lên kẻ địch bên trong Tornado và khiến Tornado gây thêm Damage thuộc element đó."
    ],
    [
      "Gouge molten rock from the ground and fling it at the target. The Projectile explodes on collision, damaging enemies and scattering shrapnel in a cone behind it.",
      "Khoét đá nóng chảy từ mặt đất và phóng vào mục tiêu. Projectile phát nổ khi va chạm, gây Damage lên kẻ địch và bắn mảnh văng theo hình nón phía sau."
    ]
  ]);

  for (const [source, expected] of cases) {
    const translated = translateSkillText(source);
    assert.equal(translated, expected);
    assert.doesNotMatch(translated, dirtyPronouns, source);
  }
});

test("translateSkillDetailLine removes leaked English it/its from production stat lines", () => {
  const dirtyPronouns = /\b(it|its|itself)\b/i;
  const cases = new Map([
    [
      "Explodes after enemy is dealt damage equal to 200% of its Ailment Threshold",
      "Phát nổ sau khi kẻ địch nhận Damage bằng 200% Ailment Threshold của mục tiêu"
    ],
    [
      "Marked target takes 3% increased damage for each of its enemies within 6 metres of it, up to 45%",
      "Mục tiêu bị Mark nhận 3% increased Damage cho mỗi kẻ địch của mục tiêu trong phạm vi 6 mét, tối đa 45%"
    ],
    [
      "This Attack is Triggered by Fortifying Cry and counts as Empowered by it",
      "Attack này được Trigger bởi Fortifying Cry và được tính là Empowered bởi Fortifying Cry"
    ]
  ]);

  for (const [source, expected] of cases) {
    const translated = translateSkillDetailLine(source);
    assert.equal(translated, expected);
    assert.doesNotMatch(translated, dirtyPronouns, source);
  }
});

test("translateSkillDetailLine cleans production stat-line English glue", () => {
  const cases = new Map([
    [
      "Gains a Stage when you Spend a total of 50% of your Maximum Mana while in Area",
      "Nhận một Stage khi bạn tiêu tổng cộng 50% Mana tối đa trong vùng"
    ],
    [
      "Elemental Damage from Hits is taken from the Barrier before your Life, Mana or Energy Shield Barrier can take Elemental Damage up to 30% of your Armour and Evasion Rating",
      "Elemental Damage từ Hits được Barrier nhận trước Life, Mana hoặc Energy Shield của bạn. Barrier có thể nhận Elemental Damage tối đa 30% Armour và Evasion Rating của bạn"
    ],
    [
      "Oasis grants (30—80)% of damage taken Recouped as Life",
      "Oasis cấp Recoup (30—80)% Damage nhận vào dưới dạng Life"
    ],
    [
      "(15—34)% of recovery from your Flasks is also granted to Allies in your Presence",
      "(15—34)% recovery từ Flasks của bạn cũng cấp cho Allies trong Presence của bạn"
    ]
  ]);

  const dirtyGlue = /\b(taken|Spend a total|your Maximum|granted to|Damage taken)\b/i;
  for (const [source, expected] of cases) {
    const translated = translateSkillDetailLine(source);
    assert.equal(translated, expected);
    assert.doesNotMatch(translated, dirtyGlue, source);
  }
});

test("parseSkillGemDetailPage extracts summary, requirements, and detail sections", () => {
  const detail = parseSkillGemDetailPage(sampleDetailHtml);

  assert.match(detail.summary_en, /Attack enemies with a melee Strike/);
  assert.equal("summary_vi" in detail, false);
  assert.deepEqual(detail.properties, ["Tier: 1", "Cost: (9â€”60) Mana"]);
  assert.deepEqual(detail.requirements, ["Requires: Level (1â€”90), (4â€”157) Str"]);
  assert.deepEqual(detail.sections, [{
    title: "Initial Strike",
    lines: ["+2 to Melee Strike Range", "(0â€”30)% increased Attack Speed"]
  }]);
  assert.match(detail.source_hash, /^[a-f0-9]{64}$/);
});
