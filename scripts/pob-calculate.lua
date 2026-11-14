local xmlPath = (arg and arg[1]) or ...

package.path = "/root/pob-core/runtime/lua/?.lua;/root/pob-core/runtime/lua/?/init.lua;/root/pob-core/src/?.lua;" .. package.path

dofile("HeadlessWrapper.lua")

local dkjson = require("dkjson")

if not xmlPath then
    print('{"error":"No XML path provided"}')
    os.exit(1)
end

local f = io.open(xmlPath, "r")
if not f then
    print('{"error":"Could not open XML file"}')
    os.exit(1)
end
local xmlText = f:read("*a")
f:close()

loadBuildFromXML(xmlText)

local output = build.calcsTab and build.calcsTab.mainOutput
local cleanOutput = {}

if output then
    for k, v in pairs(output) do
        local t = type(v)
        if t == "number" or t == "string" or t == "boolean" then
            cleanOutput[k] = v
        end
    end
    -- One row per skill of the groups marked "include in Full DPS" (the planner marks
    -- every enabled group), so the planner can show each skill's own damage.
    if type(output.SkillDPS) == "table" then
        local skills = {}
        for _, skill in ipairs(output.SkillDPS) do
            skills[#skills + 1] = {
                name = skill.name,
                dps = skill.dps,
                count = skill.count,
                trigger = skill.trigger,
                skillPart = skill.skillPart
            }
        end
        cleanOutput.SkillDPS = skills
    end
end

-- ===== STAT BREAKDOWN (planner) — begin ===================================
-- The planner asks for explanations by adding to the build XML
--   <PlannerRequest breakdown="Life,FireResist,CritChance"/>
-- (src/server/pob-breakdown.mjs). For each stat this returns PoB's own breakdown
-- lines and the modifiers behind it: BASE / INC / MORE, the value, the mod name,
-- and where it comes from (item name, passive node name, gem, quest, base).
local breakdownRequest = xmlText:match("<PlannerRequest%s([^>]*)/?>")
local function breakdownRequestList(name)
    local value = breakdownRequest and breakdownRequest:match(name .. '="([^"]*)"')
    local list = {}
    for item in (value or ""):gmatch("[^,]+") do list[#list + 1] = item end
    return list
end

-- Mod names behind each stat the planner can explain. "skill" stats use the main
-- skill's modifiers and config (crit, speed, damage); the rest are the player's.
local BREAKDOWN_MODS = {
    Life = { "Life" }, Mana = { "Mana" }, Spirit = { "Spirit" },
    EnergyShield = { "EnergyShield", "Defences" },
    Armour = { "Armour", "ArmourAndEvasion", "Defences" },
    Evasion = { "Evasion", "ArmourAndEvasion", "Defences" },
    FireResist = { "FireResist", "ElementalResist" },
    ColdResist = { "ColdResist", "ElementalResist" },
    LightningResist = { "LightningResist", "ElementalResist" },
    ChaosResist = { "ChaosResist" },
    LifeRegenRecovery = { "LifeRegen", "LifeRegenPercent" },
    ManaRegenRecovery = { "ManaRegen", "ManaRegenPercent" },
    EffectiveMovementSpeedMod = { "MovementSpeed" },
    BlockChance = { "BlockChance" }, EvadeChance = { "Evasion", "EvadeChance" },
    CritChance = { "CritChance", skill = true },
    CritMultiplier = { "CritMultiplier", skill = true },
    Speed = { "Speed", skill = true },
    HitChance = { "Accuracy", skill = true },
    CombinedDPS = { "Damage", "PhysicalDamage", "FireDamage", "ColdDamage", "LightningDamage", "ChaosDamage", "ElementalDamage", skill = true },
    TotalDPS = { "Damage", "PhysicalDamage", "FireDamage", "ColdDamage", "LightningDamage", "ChaosDamage", "ElementalDamage", skill = true },
    AverageDamage = { "Damage", "PhysicalDamage", "FireDamage", "ColdDamage", "LightningDamage", "ChaosDamage", "ElementalDamage", skill = true }
}

-- "Item:3:Gale Coil" -> item / Gale Coil; "Tree:12345" -> tree / node name; ...
local function breakdownSource(source)
    source = tostring(source or "")
    local kind, rest = source:match("^([^:]+):?(.*)$")
    kind = kind or source
    if kind == "Item" then
        return "item", rest:match("^%d+:(.*)$") or rest
    elseif kind == "Tree" then
        local id = tonumber(rest:match("^(%d+)"))
        local node = id and build.spec and build.spec.nodes[id]
        return "tree", node and (node.dn or node.name) or rest
    elseif kind == "Skill" then
        local skill = data and data.skills and data.skills[rest]
        return "gem", skill and skill.name or rest
    elseif kind == "Base" then
        return "base", rest
    end
    return kind:lower(), rest ~= "" and rest or kind
end

local function breakdownLine(line)
    return (tostring(line):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""))
end

local breakdownEnv = build.calcsTab and build.calcsTab.mainEnv
local breakdownNames = breakdownRequestList("breakdown")
if breakdownEnv and #breakdownNames > 0 then
    local player = breakdownEnv.player
    local skill = player.mainSkill
    local result = {}
    for _, stat in ipairs(breakdownNames) do
        local mods = BREAKDOWN_MODS[stat]
        local lines = {}
        local raw = player.breakdown and player.breakdown[stat]
        if type(raw) == "table" then
            for _, line in ipairs(raw) do
                if type(line) == "string" then lines[#lines + 1] = breakdownLine(line) end
            end
        end
        local sources = {}
        if mods then
            local store = mods.skill and skill and skill.skillModList or player.modDB
            local cfg = mods.skill and skill and skill.skillCfg or nil
            local ok, rows = pcall(function() return store:Tabulate(nil, cfg, unpack(mods)) end)
            if ok and rows then
                for _, row in ipairs(rows) do
                    local value = row.value
                    if type(value) == "number" and value ~= 0 and #sources < 60 then
                        local kind, label = breakdownSource(row.mod.source)
                        sources[#sources + 1] = { type = row.mod.type, value = value, name = row.mod.name, kind = kind, label = label }
                    end
                end
            end
        end
        local value = output and output[stat]
        result[stat] = { value = type(value) == "number" and value or nil, lines = lines, sources = sources }
    end
    cleanOutput.Breakdown = result
end
-- ===== STAT BREAKDOWN (planner) — end =====================================

local jsonStr = dkjson.encode(cleanOutput)
print(jsonStr)
os.exit(0)
