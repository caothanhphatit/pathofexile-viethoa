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

-- ── Planner: remember which XML <Skill> each socket group came from ─────────
-- Used by the GemOptions block further down. When PoB calculates it folds the player's
-- own group for an item- or tree-granted skill into that skill's group and builds new
-- groups for granted skills (CalcSetup), so its group numbers stop matching the XML
-- rows. Each group loaded from the XML is tagged with its row number here.
pcall(function()
    if not common.classes.SkillsTab then LoadModule("Classes/SkillsTab") end
    local class = common.classes.SkillsTab
    local loadSkill = class.LoadSkill
    local rows = {}
    class.LoadSkill = function(self, node, skillSetId)
        loadSkill(self, node, skillSetId)
        if node.elem ~= "Skill" then return end
        rows[skillSetId] = (rows[skillSetId] or 0) + 1
        local list = self.skillSets[skillSetId] and self.skillSets[skillSetId].socketGroupList
        local group = list and list[#list]
        if group and not group.plannerXmlRow then group.plannerXmlRow = rows[skillSetId] end
    end
end)

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

-- ── Planner: gem options, minion and totem stats ───────────────────────────
-- A separate block: it only adds the keys GemOptions, Minion and Totem and leaves
-- everything above as it is.
-- GemOptions: per socket group (key = PoB's group number), the choices PoB offers for
--             each active skill of that group: skill parts, stat sets, stages, minion
--             type and minion skill, with the current pick. The planner shows them on
--             the skill cards and writes the pick back as <Gem> attributes (skillPart,
--             skillMinion...). PoB's group numbers are not the XML <Skill> order, so each
--             entry says which XML row its group came from (xmlRow, from the hook at the
--             top; none for a group PoB built itself) and which gem it is (skill ids),
--             and the planner matches on that (src/spa/lib/gemOptions.ts). grantedSkill:
--             PoB grants it (item / tree / weapon), so it is never corrupted.
--             Granted skills are listed even without choices, for that flag.
-- Minion:     a compact subset of PoB's output.Minion for the main skill's minion.
-- Totem:      count, life and damage of the main skill's totems.
local function plannerGemOptions()
    local groups = {}
    local list = build.skillsTab and build.skillsTab.socketGroupList or {}
    for groupIndex, group in ipairs(list) do
        local skills = {}
        for skillIndex, activeSkill in ipairs(group.displaySkillList or {}) do
            local effect = activeSkill.activeEffect
            local src = effect and effect.srcInstance
            local granted = effect and effect.grantedEffect
            local gemIndex
            for index, gem in ipairs(group.gemList or {}) do
                if gem == src then gemIndex = index end
            end
            if granted and gemIndex then
                -- skill: its position in the group's skill list (PoB's mainActiveSkill when it is the one calculated).
                local first = group.gemList[1]
                local entry = {
                    gem = gemIndex, skill = skillIndex, name = granted.name, grantedEffect = granted.id,
                    skillId = src.skillId, gemId = src.gemId,
                    xmlRow = group.plannerXmlRow,
                    groupSource = group.source, groupSlot = group.slot,
                    groupSkillId = first and first.skillId, groupGemId = first and first.gemId,
                    grantedSkill = (src.fromItem or src.fromTree) and true or nil
                }
                if granted.parts and #granted.parts > 1 then
                    entry.parts = {}
                    for _, part in ipairs(granted.parts) do entry.parts[#entry.parts + 1] = part.name or "" end
                    entry.part = src.skillPart or 1
                end
                if granted.statSets and #granted.statSets > 1 then
                    entry.statSets = {}
                    for _, set in ipairs(granted.statSets) do entry.statSets[#entry.statSets + 1] = set.label or "" end
                    entry.statSet = (type(src.statSet) == "table" and src.statSet[granted.id]) or 1
                end
                local flags = effect.statSet and effect.statSet.skillFlags or {}
                if flags.multiStage then
                    local key = "Multiplier:" .. granted.name:gsub("%s+", "") .. "MaxStages"
                    local ok, max = pcall(function() return activeSkill.skillModList:Sum("BASE", activeSkill.skillCfg, key) end)
                    if ok and type(max) == "number" and max > 1 then
                        entry.maxStages = max
                        entry.stages = src.skillStageCount or (activeSkill.skillData and activeSkill.skillData.stagesMin) or 1
                    end
                end
                local minionList = activeSkill.minionList
                if minionList and #minionList > 1 and not granted.minionHasItemSet then
                    entry.minions = {}
                    for _, id in ipairs(minionList) do
                        local minion = data.minions[id]
                        if minion then entry.minions[#entry.minions + 1] = { id = id, name = minion.name } end
                    end
                    entry.minion = src.skillMinion or minionList[1]
                end
                local minionSkills = activeSkill.minion and activeSkill.minion.activeSkillList
                if minionSkills and #minionSkills > 1 then
                    entry.minionSkills = {}
                    for _, minionSkill in ipairs(minionSkills) do
                        entry.minionSkills[#entry.minionSkills + 1] = minionSkill.activeEffect.grantedEffect.name
                    end
                    entry.minionSkill = src.skillMinionSkill or 1
                end
                if entry.parts or entry.statSets or entry.maxStages or entry.minions or entry.minionSkills or entry.grantedSkill then
                    skills[#skills + 1] = entry
                end
            end
        end
        if #skills > 0 then groups[tostring(groupIndex)] = skills end
    end
    return groups
end

local okOptions, gemOptions = pcall(plannerGemOptions)
if okOptions and next(gemOptions) then cleanOutput.GemOptions = gemOptions end

local MINION_STATS = {
    "CombinedDPS", "TotalDPS", "TotalDot", "AverageDamage", "Speed", "HitChance", "CritChance",
    "Life", "EnergyShield", "Armour", "Evasion", "TotalEHP",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist"
}
if output and type(output.Minion) == "table" then
    local minionEnv = env and env.minion
    local minion = {}
    for _, stat in ipairs(MINION_STATS) do
        if type(output.Minion[stat]) == "number" then minion[stat] = output.Minion[stat] end
    end
    -- How many: output[<limit stat>] (e.g. ActiveSkeletonLimit, shared by every skeleton
    -- skill) or ActiveMinionLimit. Many PoE2 summons have no limit stat (one minion per
    -- gem); then PoB has no count and none is sent.
    local limitStat = minionEnv and minionEnv.minionData and minionEnv.minionData.limit
    local count = limitStat and output[limitStat]
    if type(count) ~= "number" or count <= 0 then count = output.ActiveMinionLimit end
    if type(count) == "number" and count > 0 then minion.Count = count end
    minion.Name = minionEnv and minionEnv.minionData and minionEnv.minionData.name or nil
    local minionSkill = minionEnv and minionEnv.mainSkill
    minion.Skill = minionSkill and minionSkill.activeEffect and minionSkill.activeEffect.grantedEffect.name or nil
    cleanOutput.Minion = minion
end
-- PoB only sets TotemLife when the main skill is a totem skill (CalcOffence, skillFlags.totem;
-- PoE2 keeps those flags per stat set, so the output is the reliable sign).
if output and type(output.TotemLife) == "number" then
    cleanOutput.Totem = {
        Count = output.ActiveTotemLimit,
        Life = output.TotemLife,
        EnergyShield = output.TotemEnergyShield,
        Armour = output.TotemArmour,
        DPS = output.TotalDPS
    }
end

-- ===== PASSIVE NODE DELTAS (planner) — begin ============================
-- The passive node preview adds to the build XML
--   <PlannerNodeDeltas nodes="123,456"/>
-- (src/server/pob-node-deltas.mjs, POST /api/builds/node-deltas). For each node this
-- returns how the main stats change if it is allocated (or removed when already
-- allocated), using PoB's fast misc calculator the way its own tree tooltip does,
-- so a whole batch costs one build load.
local DELTA_STATS = { "CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Armour", "Evasion", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP", "Str", "Dex", "Int" }
local nodeDeltaRequest = xmlText:match("<PlannerNodeDeltas%s([^>]*)/?>")
local nodeIds = {}
for item in ((nodeDeltaRequest and nodeDeltaRequest:match('nodes="([^"]*)"')) or ""):gmatch("[^,]+") do nodeIds[#nodeIds + 1] = item end
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
                    return { allocated = true, node = diff(calcFunc({ removeNodes = { [node] = true } })), path = count > 1 and diff(calcFunc({ removeNodes = dependants })) or nil, pathLength = count, weaponSet = (node.allocMode or 0) > 0 and node.allocMode or nil }
                end
                local path = {}
                local count = 0
                for _, other in pairs(node.path or {}) do path[other] = true; count = count + 1 end
                -- A node reached only through weapon-set nodes is allocated in that set
                -- (a full calculation drops it from the main tree), so price it as a
                -- node of that set: its mods then only count while that set is active.
                -- PoB's own tooltip prices it as a main-tree node, which overstates it.
                local weaponSet = 0
                if not (node.ascendancyName or node.type == "Keystone" or node.type == "Socket" or node.containJewelSocket) then
                    for pathNode in pairs(count > 0 and path or { [node] = true }) do
                        for _, other in ipairs(pathNode.linked or {}) do
                            if other.alloc then
                                if (other.allocMode or 0) == 0 then weaponSet = -1; break end
                                if weaponSet == 0 then weaponSet = other.allocMode end
                            end
                        end
                        if weaponSet < 0 then break end
                    end
                end
                if weaponSet < 0 then weaponSet = 0 end
                local function priced(nodes)
                    if weaponSet == 0 then return diff(calcFunc({ addNodes = nodes })) end
                    local saved = {}
                    for other in pairs(nodes) do
                        saved[#saved + 1] = { other, other.allocMode }
                        other.allocMode = weaponSet
                    end
                    local okCalc, result = pcall(calcFunc, { addNodes = nodes })
                    for _, row in ipairs(saved) do row[1].allocMode = row[2] end
                    if not okCalc then error(result) end
                    return diff(result)
                end
                return { allocated = false, node = priced({ [node] = true }), path = count > 1 and priced(path) or nil, pathLength = count, weaponSet = weaponSet > 0 and weaponSet or nil }
            end)
            if ok and entry then deltas[tostring(id)] = entry end
        end
    end
    cleanOutput.NodeDeltas = deltas
end
-- ===== PASSIVE NODE DELTAS (planner) — end ==============================

local jsonStr = dkjson.encode(cleanOutput)
print(jsonStr)
os.exit(0)
