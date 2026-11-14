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

-- ── Planner analysis requests ───────────────────────────────────────────────
-- The planner can ask for more than the main output by adding to the build XML
--   <PlannerRequest breakdown="Life,FireResist" nodes="123,456"/>
-- breakdown: for each stat, PoB's own breakdown lines and the modifiers behind it
--            (base / increased / more, with where each one comes from);
-- nodes:     for each passive node, how the main stats change if it is allocated
--            (or removed when already allocated), using PoB's fast misc calculator
--            the way its tree tooltip does, so a whole batch costs one build load.
local request = xmlText:match("<PlannerRequest%s([^>]*)/?>")
local function requestList(name)
    local value = request and request:match(name .. '="([^"]*)"')
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
local function describeSource(source)
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

local function cleanLine(line)
    return (tostring(line):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""))
end

local env = build.calcsTab and build.calcsTab.mainEnv
local breakdownNames = requestList("breakdown")
if env and #breakdownNames > 0 then
    local player = env.player
    local skill = player.mainSkill
    local result = {}
    for _, stat in ipairs(breakdownNames) do
        local mods = BREAKDOWN_MODS[stat]
        local lines = {}
        local raw = player.breakdown and player.breakdown[stat]
        if type(raw) == "table" then
            for _, line in ipairs(raw) do
                if type(line) == "string" then lines[#lines + 1] = cleanLine(line) end
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
                        local kind, label = describeSource(row.mod.source)
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

local DELTA_STATS = { "CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Armour", "Evasion", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP", "Str", "Dex", "Int" }
local nodeIds = requestList("nodes")
if output and #nodeIds > 0 and build.calcsTab.GetMiscCalculator then
    local calcFunc, calcBase = build.calcsTab:GetMiscCalculator(build)
    local function diff(after)
        local changes = {}
        local any = false
        for _, stat in ipairs(DELTA_STATS) do
            local a, b = calcBase[stat], after and after[stat]
            if type(a) == "number" and type(b) == "number" and math.abs(b - a) > 1e-6 then
                changes[stat] = b - a
                any = true
            end
        end
        return any and changes or {}
    end
    local deltas = {}
    for index, idText in ipairs(nodeIds) do
        if index > 120 then break end
        local id = tonumber(idText)
        local node = id and build.spec.nodes[id]
        if node then
            local ok, entry = pcall(function()
                if node.alloc then
                    -- Removing it also removes the nodes that hang on it.
                    local dependants = {}
                    local count = 0
                    for _, other in pairs(node.depends or {}) do dependants[other] = true; count = count + 1 end
                    return { allocated = true, node = diff(calcFunc({ removeNodes = { [node] = true } })), path = count > 1 and diff(calcFunc({ removeNodes = dependants })) or nil, pathLength = count }
                end
                local path = {}
                local count = 0
                for _, other in pairs(node.path or {}) do path[other] = true; count = count + 1 end
                return { allocated = false, node = diff(calcFunc({ addNodes = { [node] = true } })), path = count > 1 and diff(calcFunc({ addNodes = path })) or nil, pathLength = count }
            end)
            if ok and entry then deltas[tostring(id)] = entry end
        end
    end
    cleanOutput.NodeDeltas = deltas
end

local jsonStr = dkjson.encode(cleanOutput)
print(jsonStr)
os.exit(0)
