//! Robust item parser for Path of Exile 2 clipboard item data.
//!
//! Handles standard PoE2 clipboard format separated by '--------'.

use anyhow::{anyhow, Result};
use poe2_types::trade::{ItemMod, ItemRarity, ModType, PoeItem};

/// Parse a raw clipboard string from Path of Exile 2 into a structured PoeItem.
pub fn parse_poe2_item(raw: &str) -> Result<PoeItem> {
    // Win32 clipboard payloads commonly use CRLF; normalize before parsing
    // so section separators and modifier lines are handled identically.
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(
            "Văn bản vật phẩm trống. Hãy copy (Ctrl+C) vật phẩm trong game."
        ));
    }

    // Split on separator lines instead of an exact byte sequence. Game
    // clients can emit extra whitespace around the eight dashes.
    let mut sections: Vec<Vec<&str>> = Vec::new();
    let mut current = Vec::new();
    for line in trimmed.lines() {
        let line = line.trim();
        if line.len() >= 4 && line.chars().all(|ch| ch == '-') {
            if !current.is_empty() {
                sections.push(std::mem::take(&mut current));
            }
        } else if !line.is_empty() {
            current.push(line);
        }
    }
    if !current.is_empty() {
        sections.push(current);
    }

    if sections.is_empty() {
        return Err(anyhow!(
            "Định dạng văn bản không hợp lệ (thiếu dấu phân cách '--------')."
        ));
    }

    let mut item = PoeItem {
        raw_text: trimmed.to_string(),
        ..Default::default()
    };

    // Header section is usually Section 0
    let header = &sections[0];
    let mut header_idx = 0;

    for line in header {
        if let Some(val) = line.strip_prefix("Item Class:") {
            item.item_class = val.trim().to_string();
            header_idx += 1;
        } else if let Some(val) = line.strip_prefix("Rarity:") {
            item.rarity = ItemRarity::parse_label(val);
            header_idx += 1;
        }
    }

    // Name and Base type
    let remaining_header: Vec<&str> = header[header_idx..].to_vec();
    match remaining_header.len() {
        0 => {}
        1 => {
            item.name = remaining_header[0].to_string();
            item.base_type = remaining_header[0].to_string();
        }
        2.. => {
            item.name = remaining_header[0].to_string();
            item.base_type = remaining_header[1].to_string();
        }
    }

    // If Rarity is Currency or Waystone, adjust if not set
    if item.item_class.contains("Currency") {
        item.rarity = ItemRarity::Currency;
    } else if item.item_class.contains("Waystone") {
        item.rarity = ItemRarity::Waystone;
    } else if item.item_class.contains("Gem") {
        item.rarity = ItemRarity::Gem;
    }

    // Process remaining sections
    for sec in sections.iter().skip(1) {
        // PoE2's current clipboard format may place metadata and explicit
        // modifiers in the same section; process both line classes.
        process_meta_section(sec, &mut item);
        if item.rarity == ItemRarity::Unique && is_flavour_section(sec) {
            continue;
        }
        process_mod_section(sec, &mut item);
    }

    Ok(item)
}

fn is_flavour_section(lines: &[&str]) -> bool {
    let meaningful: Vec<&str> = lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
    let Some(last) = meaningful.last() else {
        return false;
    };

    // A unique stat block can be followed by a quoted sentence in the same
    // section. Numeric magnitudes make it a real stat block, so let the
    // per-mod guard below remove only the prose lines instead of dropping the
    // entire section.
    if meaningful
        .iter()
        .any(|line| !ItemMod::new(*line, ModType::Explicit).values.is_empty())
    {
        return false;
    }

    // GGG puts unique lore in its own dashed section. A prose paragraph ends
    // in a period; quoted multi-line flavour text is also unambiguously prose
    // even when the closing quote follows the period.
    last.trim_end_matches('"').trim_end().ends_with('.')
        || meaningful
            .iter()
            .all(|line| line.starts_with('"') || line.ends_with('"') || line.ends_with('.'))
}

/// Unique-item lore is not a searchable modifier. Current PoE2 clipboard
/// payloads commonly emit it as all-caps prose (sometimes split over several
/// lines), while real unique properties use normal sentence casing or contain
/// a numeric magnitude. Keep this predicate deliberately conservative so
/// non-numeric gameplay properties such as "Cannot be Stunned" remain visible.
fn is_unique_flavour_line(line: &str) -> bool {
    let trimmed = line.trim().trim_start_matches("## ").trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.starts_with('"') || trimmed.ends_with('"') {
        return true;
    }

    let has_digit = trimmed.chars().any(|ch| ch.is_ascii_digit());
    let letters: String = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphabetic())
        .collect();
    let all_caps = !letters.is_empty() && letters.chars().all(|ch| ch.is_ascii_uppercase());
    let gameplay_prefix = trimmed.to_ascii_lowercase();
    let gameplay_prefix = gameplay_prefix.as_str();
    let known_gameplay = [
        "grants ",
        "gain ",
        "gains ",
        "allies ",
        "you ",
        "your ",
        "while ",
        "when ",
        "cannot ",
        "counts as ",
        "attacks ",
        "spells ",
    ];

    all_caps
        && !has_digit
        && !known_gameplay
            .iter()
            .any(|prefix| gameplay_prefix.starts_with(prefix))
}

fn process_meta_section(lines: &[&str], item: &mut PoeItem) -> bool {
    let mut matched = false;

    for line in lines {
        let line = line.strip_prefix("## ").unwrap_or(line);
        if line.starts_with("Armour:") {
            if let Some(num) = parse_first_u32(line) {
                item.armour = num;
                matched = true;
            }
        } else if line.starts_with("Evasion Rating:") || line.starts_with("Evasion:") {
            if let Some(num) = parse_first_u32(line) {
                item.evasion = num;
                matched = true;
            }
        } else if line.starts_with("Energy Shield:") {
            if let Some(num) = parse_first_u32(line) {
                item.energy_shield = num;
                matched = true;
            }
        } else if line.starts_with("Spirit:") {
            if let Some(num) = parse_first_u32(line) {
                item.spirit = num;
                matched = true;
            }
        } else if line.starts_with("Quality:") {
            if let Some(num) = parse_first_u32(line) {
                item.quality = num;
                matched = true;
            }
        } else if line.starts_with("Item Level:") {
            if let Some(num) = parse_first_u32(line) {
                item.item_level = num;
                matched = true;
            }
        } else if line.starts_with("Waystone Tier:") || line.starts_with("Map Tier:") {
            if let Some(num) = parse_first_u32(line) {
                item.waystone_tier = Some(num);
                matched = true;
            }
        } else if line.starts_with("Sockets:") {
            let s = line.trim_start_matches("Sockets:").trim();
            item.sockets = Some(s.to_string());
            matched = true;
        } else if line.starts_with("Level:") && lines.iter().any(|l| l.contains("Requirements")) {
            if let Some(num) = parse_first_u32(line) {
                item.requirements_level = num;
                matched = true;
            }
            item.requirements.push(line.to_string());
        } else if (line.starts_with("Str:") || line.starts_with("Dex:") || line.starts_with("Int:"))
            && lines.iter().any(|l| l.contains("Requirements"))
        {
            item.requirements.push(line.to_string());
            matched = true;
        } else if line == "Corrupted" {
            item.corrupted = true;
            matched = true;
        } else if line == "Unidentified" {
            item.unidentified = true;
            matched = true;
        } else if line == "Mirrored" {
            item.mirrored = true;
            matched = true;
        } else if line.starts_with("Requires:") {
            if let Some(num) = parse_first_u32(line) {
                item.requirements_level = num;
            }
            item.requirements.push(line.to_string());
            matched = true;
        } else if line.starts_with("Requirements:") {
            matched = true;
        }
    }

    matched
}

fn is_mod_line_continuation(prev: &str, next: &str) -> bool {
    let p = prev.trim();
    let n = next.trim();
    if p.is_empty() || n.is_empty() {
        return false;
    }

    // 1. Punctuation at end of prev line: comma, colon, dash/hyphen
    if p.ends_with(',')
        || p.ends_with(':')
        || p.ends_with('—')
        || p.ends_with('–')
        || p.ends_with('-')
    {
        return true;
    }

    // 2. Dangling words / prepositions / conjunctions at end of prev line
    let p_lower = p.to_ascii_lowercase();
    for suffix in [
        " equal to",
        " up to",
        " starts after",
        " total of",
        " dealing a",
        " dealing a tenth of",
        " chance to not",
        " to alternately",
        " if you've",
        " if you",
        " when you",
        " while you",
        " while raised",
        " while shapeshifted",
        " per second to",
        " in tribute to",
        " for each",
        " transformed to",
        " apply to",
        " per",
        " total",
    ] {
        if p_lower.ends_with(suffix) {
            return true;
        }
    }

    // Check last token in prev line
    if let Some(last_token) = p_lower.split_whitespace().last() {
        let clean_last = last_token.trim_matches(|c: char| !c.is_alphanumeric());
        const DANGLING_LAST_WORDS: &[&str] = &[
            "you", "your", "youve", "not", "also", "count", "when", "while", "if", "with", "for",
            "by", "as", "in", "on", "at", "from", "is", "are", "than", "their", "its", "to", "of",
            "an", "a", "and", "or", "per", "every", "total", "during", "without", "between",
            "into", "after",
        ];
        if DANGLING_LAST_WORDS.contains(&clean_last) {
            return true;
        }
    }

    // 3. Next line starts with lowercase ASCII letter (e.g. "without being...", "as being...", "expend...")
    let clean_next = n.trim_start_matches("## ").trim();
    if clean_next
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase())
    {
        return true;
    }

    // 4. Next line starts with continuation keywords or phrases
    let n_lower = clean_next.to_ascii_lowercase();

    // Check "# use remaining" or "X use remaining"
    if n_lower.contains("use remaining") || n_lower.contains("uses remaining") {
        return true;
    }

    const CONTINUATION_PREFIXES: &[&str] = &[
        "without being",
        "as being",
        "do not apply",
        "does not apply",
        "cannot be",
        "can only be",
        "recently",
        "during effect",
        "while stationary",
        "while affected",
        "while you are",
        "while raised",
        "while shapeshifted",
        "while not on",
        "when you",
        "after killing",
        "for each",
        "up to a maximum",
        "to a total of",
        "also apply to",
        "apply to",
        "against",
        "no more than once",
        "take ",
        "passives in radius",
        "desecration makes this item unstable",
        "anaemia allows",
        "other modifiers to",
        "your other modifiers to",
        "recovery from",
        "non-unique life flasks",
        "modifiers gained this way",
        "remove all",
        "lose all",
        "spells fire projectiles in a circle",
        "rampage",
        "breaches remain open",
        "unarmed attacks that would use",
        "completing the tower makes all nearby maps accessible",
        "every second strike skill you use while shapeshifted",
        "deflected no hits recently",
        "strength requirements of equipped armour items",
    ];

    for prefix in CONTINUATION_PREFIXES {
        if n_lower.starts_with(prefix) {
            return true;
        }
    }

    // 5. Explicit multiline templates
    if p_lower.contains("passives in radius of") && n_lower.contains("without being connected") {
        return true;
    }
    if p_lower.contains("alternating every") && n_lower.starts_with("take") {
        return true;
    }
    if p_lower.starts_with("damage over time bypasses your energy shield") {
        return true;
    }

    false
}

fn parse_tier_from_header(s: &str) -> Option<u32> {
    if let Some(idx) = s.to_ascii_lowercase().find("tier:") {
        let after = &s[idx + 5..];
        parse_first_u32(after)
    } else {
        None
    }
}

fn process_mod_section(lines: &[&str], item: &mut PoeItem) {
    // Separate into blocks by { ... } if advanced mod description lines exist
    let mut candidate_blocks: Vec<(Option<String>, Vec<&str>)> = Vec::new();
    let mut current_block: Vec<&str> = Vec::new();
    let mut current_tier: Option<String> = None;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("## Requires:")
            || trimmed.starts_with("## Sockets:")
            || trimmed.starts_with("## Item Level:")
            || trimmed.starts_with("Requires:")
            || trimmed.starts_with("Requirements:")
            || trimmed.starts_with("Item Class:")
            || trimmed.starts_with("Rarity:")
            || trimmed.starts_with("Quality:")
            || trimmed.starts_with("Armour:")
            || trimmed.starts_with("Evasion")
            || trimmed.starts_with("Energy Shield:")
            || trimmed.starts_with("Spirit:")
            || trimmed.starts_with("Sockets:")
            || trimmed.starts_with("Waystone Tier:")
            || trimmed.starts_with("Level:")
            || trimmed.starts_with("Str:")
            || trimmed.starts_with("Dex:")
            || trimmed.starts_with("Int:")
            || trimmed.starts_with("Item Level:")
            || trimmed == "Corrupted"
            || trimmed == "Unidentified"
            || trimmed == "Mirrored"
        {
            continue;
        }

        // { Prefix/Suffix Modifier ... } acts as an affix delimiter
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if !current_block.is_empty() {
                candidate_blocks.push((current_tier.take(), std::mem::take(&mut current_block)));
            }
            let lower = trimmed.to_ascii_lowercase();
            let is_prefix = lower.contains("prefix modifier");
            let is_suffix = lower.contains("suffix modifier");
            if is_prefix || is_suffix {
                let tag = if is_prefix { "P" } else { "S" };
                let tier_num = parse_tier_from_header(trimmed).unwrap_or(1);
                current_tier = Some(format!("{}{}", tag, tier_num));
            }
            continue;
        }

        current_block.push(trimmed);
    }
    if !current_block.is_empty() {
        candidate_blocks.push((current_tier.take(), current_block));
    }

    for (tier, block) in candidate_blocks {
        let mut grouped_mods: Vec<Vec<&str>> = Vec::new();
        let mut current_group: Vec<&str> = Vec::new();

        for line in block {
            if current_group.is_empty() {
                current_group.push(line);
            } else {
                let last_line = *current_group.last().unwrap();
                if is_mod_line_continuation(last_line, line) {
                    current_group.push(line);
                } else {
                    grouped_mods.push(std::mem::take(&mut current_group));
                    current_group.push(line);
                }
            }
        }
        if !current_group.is_empty() {
            grouped_mods.push(current_group);
        }

        for group in grouped_mods {
            let mut has_rune = false;
            let mut has_implicit = false;
            let mut clean_lines = Vec::new();

            for l in &group {
                let lower = l.to_ascii_lowercase();
                if lower.contains("(rune)") {
                    has_rune = true;
                }
                if l.ends_with("(implicit)") {
                    has_implicit = true;
                }
                let cleaned = l
                    .trim_start_matches("## ")
                    .trim_end_matches("(implicit)")
                    .trim_end_matches("(rune)")
                    .trim();
                if !(item.rarity == ItemRarity::Unique && is_unique_flavour_line(cleaned))
                    && !cleaned.is_empty()
                {
                    clean_lines.push(cleaned);
                }
            }

            if clean_lines.is_empty() {
                continue;
            }

            // Unique clipboard payloads append flavour/lore lines after the
            // real stat lines. They are display text, not searchable mods;
            // unique modifiers in current PoE2 all carry at least one numeric
            // magnitude (including skill levels and percentages). Keeping
            // this guard scoped to uniques avoids changing Waystone/rare
            // multiline parsing semantics.
            let joined_text = clean_lines.join("\n");
            if item.rarity == ItemRarity::Unique
                && ItemMod::new(joined_text.clone(), ModType::Explicit)
                    .values
                    .is_empty()
            {
                continue;
            }

            let mod_type = if item.rarity == ItemRarity::Waystone {
                ModType::Monster
            } else if has_rune {
                ModType::Rune
            } else if has_implicit {
                ModType::Implicit
            } else {
                ModType::Explicit
            };

            let mut item_mod = ItemMod::new(joined_text, mod_type);
            item_mod.tier = tier.clone();
            item.mods.push(item_mod);
        }
    }
}

fn parse_first_u32(s: &str) -> Option<u32> {
    let mut num_str = String::new();
    let mut found_digit = false;

    for ch in s.chars() {
        if ch.is_ascii_digit() {
            num_str.push(ch);
            found_digit = true;
        } else if found_digit {
            break;
        }
    }

    num_str.parse::<u32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rare_boots() {
        let raw = r#"Item Class: Boots
Rarity: Rare
Doom Tread
Iron Greaves
--------
Armour: 142 (augmented)
--------
Requirements:
Level: 65
Str: 110
--------
Sockets: S S
--------
Item Level: 78
--------
+35% to Fire Resistance
+28% to Lightning Resistance
+25% increased Movement Speed
+72 to maximum Life
--------
Corrupted"#;

        let item = parse_poe2_item(raw).expect("Must parse rare boots");
        assert_eq!(item.item_class, "Boots");
        assert_eq!(item.rarity, ItemRarity::Rare);
        assert_eq!(item.name, "Doom Tread");
        assert_eq!(item.base_type, "Iron Greaves");
        assert_eq!(item.armour, 142);
        assert_eq!(item.item_level, 78);
        assert_eq!(item.requirements_level, 65);
        assert_eq!(item.requirements, vec!["Level: 65", "Str: 110"]);
        assert!(item.corrupted);
        assert_eq!(item.mods.len(), 4);
        assert_eq!(item.mods[0].text, "+35% to Fire Resistance");
        assert_eq!(item.mods[0].values, vec![35.0]);
    }

    #[test]
    fn test_parse_waystone() {
        let raw = r#"Item Class: Waystones
Rarity: Rare
Waystone (Tier 15)
--------
Item Level: 80
Waystone Tier: 15
--------
Monsters have 40% increased Area of Effect
15% increased Pack Size
20% increased Quantity of Items Found"#;

        let item = parse_poe2_item(raw).expect("Must parse waystone");
        assert_eq!(item.rarity, ItemRarity::Waystone);
        assert_eq!(item.waystone_tier, Some(15));
        assert_eq!(item.mods.len(), 3);
    }

    #[test]
    fn test_parse_currency() {
        let raw = r#"Item Class: Stackable Currency
Rarity: Currency
Exalted Orb
--------
Stack Size: 1/20
--------
Enchants a rare item with a new random modifier"#;

        let item = parse_poe2_item(raw).expect("Must parse currency");
        assert_eq!(item.rarity, ItemRarity::Currency);
        assert_eq!(item.name, "Exalted Orb");
    }

    #[test]
    fn test_parse_windows_clipboard_crlf_preserves_mods() {
        let raw = "Item Class: Boots\r\nRarity: Rare\r\nDoom Tread\r\nIron Greaves\r\n--------\r\nItem Level: 78\r\n--------\r\n+35% to Fire Resistance\r\n+72 to maximum Life";
        let item = parse_poe2_item(raw).expect("CRLF clipboard should parse");
        assert_eq!(item.mods.len(), 2);
        assert_eq!(item.mods[0].text, "+35% to Fire Resistance");
    }

    #[test]
    fn test_parse_current_poe2_markdown_clipboard() {
        let raw = "Item Class: Body Armours\r\nRarity: Rare\r\nHonour Salvation\r\nMantled Mail\r\n------------\r\nQuality: +20% (augmented)\r\nArmour: 555 (augmented)\r\nEvasion Rating: 497 (augmented)\r\n-------------------------------\r\n## Requires: Level 56, 48 Str, 48 Dex\r\n## Sockets: S S\r\n## Item Level: 81\r\n## +120 to maximum Life (rune)\r\n{ Prefix Modifier \"Vigorous\" (Tier: 3) — Life }\r\n+177(175-189) to maximum Life\r\n{ Suffix Modifier \"of the Ice\" (Tier: 2) — Elemental, Cold, Resistance }\r\n+36(36-40)% to Cold Resistance";
        let item = parse_poe2_item(raw).expect("PoE2 markdown clipboard should parse");
        assert_eq!(
            item.requirements,
            vec!["Requires: Level 56, 48 Str, 48 Dex"]
        );
        assert!(
            item.mods.len() >= 3,
            "expected mods, got {}",
            item.mods.len()
        );
    }

    #[test]
    fn unique_clipboard_excludes_flavor_text_and_keeps_base_spirit() {
        let raw = r#"Item Class: Sceptres
Rarity: Unique
Guiding Palm of the Eye
Shrine Sceptre
--------
Spirit: 100
--------
Grants Skill: Level 18 Purity of Ice
Gain 25% of Damage as Extra Cold Damage
Allies in your Presence deal 17 (15-23) more Damage
50% of your Base Life Regeneration is Granted to Allies
+28 (20-30) to Intelligence
25% increased Light Radius
Grants Effect of Guided Freezing Shrine
"WITH PIERCING EYES, YOU SAW THROUGH THE"
"UNDULATING AS ONE, YOU GLORIOUSLY COVER"
"BUT... I CAN BEAR YOU NO LONGER.""#;

        let item = parse_poe2_item(raw).expect("unique clipboard should parse");
        assert_eq!(item.spirit, 100);
        assert_eq!(item.mods.len(), 6);
        assert!(item
            .mods
            .iter()
            .all(|modifier| !modifier.text.contains("PIERCING")
                && !modifier.text.contains("GLORIOUSLY")
                && !modifier.text.contains("BEAR YOU")));
    }

    #[test]
    fn unique_clipboard_excludes_unquoted_all_caps_flavor_lines() {
        let raw = r#"Item Class: Gloves
Rarity: Unique
Forgotten Warden
Primal Markings
--------
Item Level: 81
--------
36% increased Armour, Evasion and Energy Shield
Grants Skill: Level 18 Spirit Vessel
A GIFT FROM THE DRAÍOCHT, LOST IN DARKNESS
THE BRONZE HUMS. THE CLOTH SIGHS.
LIVING PIECES OF HER, YEARNING TO EXIST.
+20 to Dexterity"#;

        let item = parse_poe2_item(raw).expect("unique clipboard should parse");
        assert_eq!(item.mods.len(), 3);
        assert!(item.mods.iter().all(|modifier| {
            !modifier.text.contains("DRAÍOCHT")
                && !modifier.text.contains("BRONZE HUMS")
                && !modifier.text.contains("LIVING PIECES")
        }));
    }

    #[test]
    fn test_parse_multiline_modifier_unsegmented() {
        let raw = r#"Item Class: Amulets
Rarity: Unique
Aul's Uprising
Onyx Amulet
--------
Item Level: 85
--------
Damage over Time bypasses your Energy Shield
While not on Full Life, Sacrifice 10% of maximum Mana per Second to Recover that much Life
+35% to Fire Resistance"#;

        let item = parse_poe2_item(raw).expect("Must parse multiline item");
        assert_eq!(item.mods.len(), 2);
        assert_eq!(
            item.mods[0].text,
            "Damage over Time bypasses your Energy Shield\nWhile not on Full Life, Sacrifice 10% of maximum Mana per Second to Recover that much Life"
        );
        assert_eq!(item.mods[0].values, vec![10.0]);
        assert_eq!(item.mods[1].text, "+35% to Fire Resistance");
    }

    #[test]
    fn test_parse_dangling_word_multiline() {
        let raw = r#"Item Class: Rings
Rarity: Unique
Party Ring
Gold Ring
--------
Item Level: 80
--------
When a Party Member in your Presence Casts a Spell, you
Sacrifice 10% of Mana and they Leech that Mana
+25% to Lightning Resistance"#;

        let item = parse_poe2_item(raw).expect("Must parse dangling word item");
        assert_eq!(item.mods.len(), 2);
        assert_eq!(
            item.mods[0].text,
            "When a Party Member in your Presence Casts a Spell, you\nSacrifice 10% of Mana and they Leech that Mana"
        );
        assert_eq!(item.mods[0].values, vec![10.0]);
        assert_eq!(item.mods[1].text, "+25% to Lightning Resistance");
    }

    #[test]
    fn test_parse_hybrid_modifier_stays_separate() {
        let raw = r#"Item Class: Body Armours
Rarity: Rare
Honour Mail
Plate
--------
Item Level: 80
--------
{ Prefix Modifier "Robust" (Tier: 5) — Life, Defences, Armour }
+40(33-41) to maximum Life
+144(128-159) to Armour
{ Suffix Modifier "of the Ice" (Tier: 2) — Elemental, Cold, Resistance }
+36(36-40)% to Cold Resistance"#;

        let item = parse_poe2_item(raw).expect("Must parse hybrid item");
        assert_eq!(item.mods.len(), 3);
        assert_eq!(item.mods[0].text, "+40(33-41) to maximum Life");
        assert_eq!(item.mods[1].text, "+144(128-159) to Armour");
        assert_eq!(item.mods[2].text, "+36(36-40)% to Cold Resistance");
    }
}
