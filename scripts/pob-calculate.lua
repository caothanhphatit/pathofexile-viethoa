local firstArg = (arg and arg[1]) or ...
local isWorker = firstArg == "--worker"

package.path = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua;/root/pob-core/runtime/lua/?.lua;/root/pob-core/runtime/lua/?/init.lua;/root/pob-core/src/?.lua;" .. package.path
package.cpath = "../runtime/?.dll;../runtime/?.so;" .. package.cpath

dofile("HeadlessWrapper.lua")

local dkjson = require("dkjson")

-- ── Process memory helper (used in worker mode for RSS monitoring) ─────────
local getProcessRssBytes
do
    local okFfi, ffi = pcall(require, "ffi")
    if okFfi and ffi.os == "Windows" then
        local okDef = pcall(function()
            ffi.cdef[[
                typedef struct {
                    unsigned long cb;
                    unsigned long PageFaultCount;
                    size_t PeakWorkingSetSize;
                    size_t WorkingSetSize;
                    size_t QuotaPeakPagedPoolUsage;
                    size_t QuotaPagedPoolUsage;
                    size_t QuotaPeakNonPagedPoolUsage;
                    size_t QuotaNonPagedPoolUsage;
                    size_t PagefileUsage;
                    size_t PeakPagefileUsage;
                } POB_PROCESS_MEMORY_COUNTERS;
                void* GetCurrentProcess(void);
                int K32GetProcessMemoryInfo(void* Process, POB_PROCESS_MEMORY_COUNTERS* ppsmemCounters, unsigned long cb);
            ]]
        end)
        if okDef then
            local pmc = ffi.new("POB_PROCESS_MEMORY_COUNTERS")
            pmc.cb = ffi.sizeof(pmc)
            local proc = ffi.C.GetCurrentProcess()
            getProcessRssBytes = function()
                if ffi.C.K32GetProcessMemoryInfo(proc, pmc, pmc.cb) ~= 0 then
                    return tonumber(pmc.WorkingSetSize)
                end
                return nil
            end
        end
    end
    if not getProcessRssBytes then
        getProcessRssBytes = function()
            local f = io.open("/proc/self/status", "r")
            if not f then return nil end
            local content = f:read("*a")
            f:close()
            local kb = content and content:match("VmRSS:%s+(%d+)%s+kB")
            return kb and (tonumber(kb) * 1024) or nil
        end
    end
end

-- ── Planner: remember which XML <Skill> each socket group came from ─────────
-- Used by the GemOptions block further down. When PoB calculates it folds the player's
-- own group for an item- or tree-granted skill into that skill's group and builds new
-- groups for granted skills (CalcSetup), so its group numbers stop matching the XML
-- rows. Each group loaded from the XML is tagged with its row number here.
-- Also snapshots any shared data.skills[id].levels[lvl].cost mutated by ProcessSocketGroup
-- for triggered skills so it can be restored between worker requests.
local plannerXmlRows = {}
local plannerCostRestores = {}
pcall(function()
    if not common.classes.SkillsTab then LoadModule("Classes/SkillsTab") end
    local class = common.classes.SkillsTab
    local loadSkill = class.LoadSkill
    class.LoadSkill = function(self, node, skillSetId)
        loadSkill(self, node, skillSetId)
        if node.elem ~= "Skill" then return end
        plannerXmlRows[skillSetId] = (plannerXmlRows[skillSetId] or 0) + 1
        local list = self.skillSets[skillSetId] and self.skillSets[skillSetId].socketGroupList
        local group = list and list[#list]
        if group and not group.plannerXmlRow then group.plannerXmlRow = plannerXmlRows[skillSetId] end
    end
    local processSocketGroup = class.ProcessSocketGroup
    if type(processSocketGroup) == "function" then
        class.ProcessSocketGroup = function(self, socketGroup)
            if socketGroup and socketGroup.gemList then
                for _, gem in ipairs(socketGroup.gemList) do
                    if gem.triggered and not gem.gemId and gem.skillId then
                        local ge = self.build and self.build.data and self.build.data.skills and self.build.data.skills[gem.skillId]
                        local lvl = ge and ge.levels and ge.levels[gem.level]
                        if lvl and lvl.cost and not plannerCostRestores[lvl] then
                            plannerCostRestores[lvl] = lvl.cost
                        end
                    end
                end
            end
            return processSocketGroup(self, socketGroup)
        end
    end
end)

-- ── Planner: each group's own damage (GroupDPS) ────────────────────────────
-- PoB's Full DPS pass calculates every skill of the groups marked "include in Full DPS"
-- one by one (calcs.calcFullDPS -> calcs.perform(env, true)). Each pass is recorded here
-- under the XML row of its group (plannerXmlRow, tagged above), with the same number the
-- main card shows (CombinedDPS, or the minion's), so every card can show its group's damage:
-- skills a gem grants besides its first one, DoT-only skills, average-hit skills.
-- calcs is PoB's shared Modules/CalcBase table; perform, calcFullDPS and buildOutput are wrapped where
-- they are now and again whenever they are (re)defined.
--
-- calcs.buildOutput runs the Full DPS pass in every mode. Only the MAIN output is read here,
-- so the pass is skipped for the CALCS output (an empty result, which buildOutput only copies
-- into that output's SkillDPS / FullDPS / FullDotDPS). The MAIN passes stay as PoB runs them:
-- they also settle the socket groups' skill lists that GemOptions reads.
local plannerGroupDps
local resetGroupDpsHooks = function() plannerGroupDps = nil end
pcall(function()
    local calcsBase = require("Modules.CalcBase")
    local recording, inFullDps, skipFull
    local shadow = {}
    resetGroupDpsHooks = function()
        plannerGroupDps = nil
        recording = nil
        inFullDps = false
        skipFull = false
    end
    -- Each skill names itself the way PoB lists it; "Companion: {0}" / "Spectre: {0}" get
    -- the chosen monster (as CalcActiveSkill does for their buff names).
    local function skillName(skill)
        local granted = skill.activeEffect and skill.activeEffect.grantedEffect
        local name = calcsBase.getActiveSkillDisplayName and calcsBase.getActiveSkillDisplayName(skill) or (granted and granted.name) or ""
        if name:find("{0}", 1, true) then
            local monster = skill.minion and skill.minion.minionData and skill.minion.minionData.name
            if monster then name = name:gsub("{0}", function() return monster end) else name = name:gsub(":?%s*{0}%s*", "") end
        end
        return name
    end
    local wrap = {
        perform = function(perform)
            return function(env, skipEHP, ...)
                local result = perform(env, skipEHP, ...)
                if recording and inFullDps and skipEHP == true then
                    pcall(function()
                        local skill = env.player.mainSkill
                        local group = skill and skill.socketGroup
                        local row = group and group.plannerXmlRow
                        if not row then return end
                        local out = env.player.output or {}
                        local value = tonumber(out.CombinedDPS) or 0
                        local average = false
                        -- PoB shows some skills per hit (CombinedDPS = average damage); when it
                        -- also has a rate for them (triggered, per second) that rate is used.
                        if skill.skillData and skill.skillData.showAverage then
                            local perSecond = tonumber(out.TotalDPS) or 0
                            if perSecond > 0 then
                                value = perSecond + (tonumber(out.TotalDot) or 0)
                            else
                                average = value > 0
                            end
                        end
                        local minion = false
                        if value <= 0 and env.minion and env.minion.output then
                            value = tonumber(env.minion.output.CombinedDPS) or 0
                            minion = value > 0
                        end
                        local okCount, count = pcall(calcsBase.getActiveSkillCount, skill)
                        local entry = recording[row] or { skills = {} }
                        recording[row] = entry
                        -- gem: which gem of the group the skill belongs to (1 = the group's first),
                        -- so a card can tell its own skill from one a socketed gem or a support
                        -- grants. trigger: the gem that triggers it (Cast on Critical...).
                        local src = skill.activeEffect and skill.activeEffect.srcInstance
                        local gemIndex
                        for index, gem in ipairs(group.gemList or {}) do
                            if gem == src then gemIndex = index end
                        end
                        local trigger = skill.triggeredBy and skill.triggeredBy.grantedEffect and skill.triggeredBy.grantedEffect.name
                        entry.skills[#entry.skills + 1] = {
                            name = skillName(skill),
                            skillId = skill.activeEffect and skill.activeEffect.grantedEffect.id,
                            gem = gemIndex,
                            trigger = trigger,
                            value = value,
                            average = average or nil,
                            minion = minion or nil,
                            count = (okCount and type(count) == "number" and count > 1) and count or nil
                        }
                    end)
                end
                return result
            end
        end,
        calcFullDPS = function(calcFullDPS)
            return function(...)
                if skipFull then return { combinedDPS = 0, TotalDotDPS = 0, skills = {} } end
                if not recording or inFullDps then return calcFullDPS(...) end
                inFullDps = true
                local results = { pcall(calcFullDPS, ...) }
                inFullDps = false
                if not results[1] then error(results[2], 0) end
                return select(2, unpack(results))
            end
        end,
        buildOutput = function(buildOutput)
            return function(build, mode, ...)
                if mode ~= "MAIN" then
                    local outerSkip = skipFull
                    skipFull = true
                    local results = { pcall(buildOutput, build, mode, ...) }
                    skipFull = outerSkip
                    if not results[1] then error(results[2], 0) end
                    return select(2, unpack(results))
                end
                local outer = recording
                recording = {}
                local results = { pcall(buildOutput, build, mode, ...) }
                plannerGroupDps = recording
                recording = outer
                if not results[1] then error(results[2], 0) end
                return select(2, unpack(results))
            end
        end
    }
    -- Already defined (the module may load before this script runs): wrap those now.
    for key, make in pairs(wrap) do
        local current = rawget(calcsBase, key)
        if type(current) == "function" then
            shadow[key] = make(current)
            rawset(calcsBase, key, nil)
        end
    end
    setmetatable(calcsBase, {
        __index = shadow,
        __newindex = function(t, key, value)
            if wrap[key] and type(value) == "function" then
                shadow[key] = wrap[key](value)
            else
                rawset(t, key, value)
            end
        end
    })
end)

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

local MINION_STATS = {
    "CombinedDPS", "TotalDPS", "TotalDot", "AverageDamage", "Speed", "HitChance", "CritChance",
    "Life", "EnergyShield", "Armour", "Evasion", "TotalEHP",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist"
}

local DELTA_STATS = { "CombinedDPS", "MinionDPS", "Life", "EnergyShield", "Mana", "Spirit", "Armour", "Evasion", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP", "Str", "Dex", "Int" }

local function stripColorCodes(text)
    return (tostring(text or ""):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""))
end

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
    return stripColorCodes(line)
end

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

-- Restores any shared tables mutated by a calculation and wipes per-build global state.
local function restoreSharedSkillCosts()
    for lvl, cost in pairs(plannerCostRestores) do
        lvl.cost = cost
        plannerCostRestores[lvl] = nil
    end
end

local function resetBetweenBuilds()
    restoreSharedSkillCosts()
    plannerXmlRows = {}
    resetGroupDpsHooks()

    -- Wipe PoB's calculation caches (loadBuildFromXML does not call wipeGlobalCache,
    -- and wipeGlobalCache itself skips GlobalCache.cachedData.CACHE).
    if GlobalCache and GlobalCache.cachedData then
        for _, bucket in pairs(GlobalCache.cachedData) do
            if type(bucket) == "table" then wipeTable(bucket) end
        end
    end
    -- Wipe GlobalGemAssignments: an empty build skips UpdateGemSlots() and would
    -- otherwise keep the previous build's gem counts.
    if type(GlobalGemAssignments) == "table" then
        wipeTable(GlobalGemAssignments)
    end

    if launch then
        launch.promptMsg = nil
        launch.promptFunc = nil
        launch.promptCol = nil
    end
    if main then
        main.disableDevAutoSave = true
        main.newMode = nil
        main.newModeArgs = nil
        if main.popups then wipeTable(main.popups) end
        if main.toastMessages then wipeTable(main.toastMessages) end
        main.toastMode = nil
    end
    if build then
        -- Prevent buildMode:Shutdown() from writing ~~temp~~.xml in dev checkouts,
        -- and clear stale tabs so a failed load can never return the prior build's output.
        build.abortSave = true
        build.modFlag = false
        build.unsaved = false
        build.buildFlag = false
        build.calcsTab = nil
        build.skillsTab = nil
        build.itemsTab = nil
        build.treeTab = nil
        build.configTab = nil
        build.spec = nil
        build.savers = nil
        build.xmlSectionList = nil
        build.spectreList = {}
        build.beastList = {}
        build.breakdownIndex = nil
        build.sidebarBreakdownData = nil
        build.breakdownInputs = nil
        build.lastSelectedMinion = nil
        build.mainSocketGroup = nil
    end
end

local function calculateBuild(xmlText)
    loadBuildFromXML(xmlText)

    -- Detect load/parse errors surfaced through launch:ShowErrMsg during OnFrame.
    if launch and launch.promptMsg then
        local msg = stripColorCodes(launch.promptMsg)
        local isFatal = msg:find("In 'OnFrame':", 1, true) ~= nil or msg:find("In 'Init':", 1, true) ~= nil
        launch.promptMsg = nil
        launch.promptFunc = nil
        launch.promptCol = nil
        if main then
            main.newMode = nil
            if main.popups then wipeTable(main.popups) end
        end
        return nil, msg, isFatal
    end
    if main and (main.newMode == "LIST" or main.mode ~= "BUILD") then
        main.newMode = nil
        return nil, "PoB rejected the build XML", false
    end

    local output = build.calcsTab and build.calcsTab.mainOutput
    local cleanOutput = {}

    if output then
        for k, v in pairs(output) do
            local t = type(v)
            if t == "number" or t == "string" or t == "boolean" then
                cleanOutput[k] = v
            end
        end
        -- MainSkillDPS: the main skill's damage as its card shows it (the GroupDPS rule above).
        -- PoB shows some skills per hit (CombinedDPS is then the average hit); when it has a rate
        -- for them this is damage per second. The node preview prices the same number.
        pcall(function()
            local mainSkill = build.calcsTab.mainEnv.player.mainSkill
            local value = tonumber(output.CombinedDPS) or 0
            if mainSkill.skillData and mainSkill.skillData.showAverage and (tonumber(output.TotalDPS) or 0) > 0 then
                value = output.TotalDPS + (tonumber(output.TotalDot) or 0)
            end
            cleanOutput.MainSkillDPS = value
        end)
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
    if plannerGroupDps and next(plannerGroupDps) then
        -- Per XML row: total damage of the group's skills (each times its count), and whether
        -- the number is an average hit (skills PoB shows per hit, not per second).
        local groupDps = {}
        for row, entry in pairs(plannerGroupDps) do
            local dps, average = 0, 0
            for _, skill in ipairs(entry.skills) do
                local value = (skill.value or 0) * (skill.count or 1)
                if skill.average then average = math.max(average, value) else dps = dps + value end
            end
            groupDps[tostring(row)] = { dps = dps, average = average > 0 and average or nil, skills = entry.skills }
        end
        cleanOutput.GroupDPS = groupDps
    end

    local okOptions, gemOptions = pcall(plannerGemOptions)
    if okOptions and next(gemOptions) then cleanOutput.GemOptions = gemOptions end

    if output and type(output.Minion) == "table" then
        -- This block's own handle on PoB's main calculation (other blocks name theirs).
        local plannerEnv = build.calcsTab and build.calcsTab.mainEnv
        local minionEnv = plannerEnv and plannerEnv.minion
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
    local nodeDeltaRequest = xmlText:match("<PlannerNodeDeltas%s([^>]*)/?>")
    local nodeIds = {}
    for item in ((nodeDeltaRequest and nodeDeltaRequest:match('nodes="([^"]*)"')) or ""):gmatch("[^,]+") do nodeIds[#nodeIds + 1] = item end
    if output and #nodeIds > 0 and build.calcsTab.GetMiscCalculator then
        local calcFunc, calcBase = build.calcsTab:GetMiscCalculator(build)
        local deltaSkill = build.calcsTab.mainEnv and build.calcsTab.mainEnv.player and build.calcsTab.mainEnv.player.mainSkill
        local perSecondMain = deltaSkill and deltaSkill.skillData and deltaSkill.skillData.showAverage
            and (tonumber(calcBase and calcBase.TotalDPS) or 0) > 0
        local function statOf(out, stat)
            if not out then return nil end
            if stat == "MinionDPS" then return type(out.Minion) == "table" and out.Minion.CombinedDPS or nil end
            if stat == "CombinedDPS" and perSecondMain then
                return (tonumber(out.TotalDPS) or 0) + (tonumber(out.TotalDot) or 0)
            end
            return out[stat]
        end
        local function diff(after)
            local changes = {}
            local any = false
            for _, stat in ipairs(DELTA_STATS) do
                local a, b = statOf(calcBase, stat), statOf(after, stat)
                if type(a) == "number" and type(b) == "number" and math.abs(b - a) > 1e-6 then
                    changes[stat] = b - a
                    any = true
                end
            end
            return any and changes or {}
        end
        -- The numbers the deltas are relative to (the client shows DPS / EHP as a share of them).
        local deltaBase = {}
        for _, stat in ipairs(DELTA_STATS) do
            local value = statOf(calcBase, stat)
            if type(value) == "number" then deltaBase[stat] = value end
        end
        cleanOutput.NodeDeltaBase = deltaBase
        -- Ids of a node set, sorted (the client and the parity tests read which nodes a path holds).
        local function idList(nodes, count)
            if count <= 1 then return nil end
            local ids = {}
            for other in pairs(nodes) do ids[#ids + 1] = other.id end
            table.sort(ids)
            return ids
        end
        -- What removing an allocated node really takes with it: what a full load of the
        -- build without it would drop. node.depends misses nodes kept only by an
        -- "allocate without being connected" effect (Entwined Realities, Intuitive
        -- Leap-likes), so let PoB prune the tree itself, then put everything back.
        local spec = build.spec
        local function allocCount()
            local count = 0
            for _ in pairs(spec.allocNodes) do count = count + 1 end
            return count
        end
        local function removedWith(node)
            local saved = {}
            for nodeId, other in pairs(spec.allocNodes) do
                saved[nodeId] = { node = other, allocMode = other.allocMode, mastery = spec.masterySelections[nodeId] }
            end
            local ok, err = pcall(function()
                for _, dep in ipairs(node.depends or { node }) do spec:DeallocSingleNode(dep) end
                -- Pruning can uncover more orphans; a load converges the same way.
                for _ = 1, 6 do
                    local before = allocCount()
                    spec:BuildAllDependsAndPaths()
                    if allocCount() == before then break end
                end
            end)
            local removed, count = {}, 0
            for nodeId, row in pairs(saved) do
                if not spec.allocNodes[nodeId] then removed[row.node] = true; count = count + 1 end
            end
            for nodeId, row in pairs(saved) do
                row.node.alloc = true
                row.node.allocMode = row.allocMode
                spec.allocNodes[nodeId] = row.node
                spec.masterySelections[nodeId] = row.mastery
            end
            spec:BuildAllDependsAndPaths()
            if not ok then error(err) end
            return removed, count
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
                        local dependants, count = removedWith(node)
                        return { allocated = true, node = diff(calcFunc({ removeNodes = { [node] = true } })), path = count > 1 and diff(calcFunc({ removeNodes = dependants })) or nil, pathLength = count, pathIds = idList(dependants, count), weaponSet = (node.allocMode or 0) > 0 and node.allocMode or nil }
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
                    return { allocated = false, node = priced({ [node] = true }), path = count > 1 and priced(path) or nil, pathLength = count, pathIds = idList(path, count), weaponSet = weaponSet > 0 and weaponSet or nil }
                end)
                if ok and entry then deltas[tostring(id)] = entry end
            end
        end
        cleanOutput.NodeDeltas = deltas
    end
    -- ===== PASSIVE NODE DELTAS (planner) — end ==============================

    return cleanOutput, nil, false
end

-- ── One-shot mode (unchanged CLI interface) ────────────────────────────────
if not isWorker then
    if not firstArg then
        print('{"error":"No XML path provided"}')
        os.exit(1)
    end
    local f = io.open(firstArg, "r")
    if not f then
        print('{"error":"Could not open XML file"}')
        os.exit(1)
    end
    local xmlText = f:read("*a")
    f:close()

    local cleanOutput, errMsg = calculateBuild(xmlText)
    if not cleanOutput then
        print(dkjson.encode({ error = errMsg or "Calculation failed" }))
        os.exit(1)
    end
    print(dkjson.encode(cleanOutput))
    os.exit(0)
end

-- ── Persistent worker mode (--worker) ──────────────────────────────────────
-- Disable background unique/rare DB loading (never used in headless calculations)
-- and dev autosave (which would write ~~temp~~.xml on every build switch).
if main then
    main.disableDevAutoSave = true
    if main.onFrameFuncs then main.onFrameFuncs["LoadItems"] = nil end
end
-- Keep PoB's generous GC pause (400%) during calculations so LuaJIT does not
-- repeatedly trace PoB's ~210 MB static data tables mid-request; instead release
-- per-build tables right after flushing the response and collect when above threshold.
local GC_AFTER_RES_KB = (tonumber(os.getenv("POB_WORKER_GC_THRESHOLD_MB")) or 360) * 1024
collectgarbage("setpause", 400)

local READY_PREFIX = "__POB_WORKER_READY__"
local RES_PREFIX = "__POB_WORKER_RES__"

local function sendFrame(prefix, payload)
    io.stdout:write("\n" .. prefix .. " " .. dkjson.encode(payload) .. "\n")
    io.stdout:flush()
end

sendFrame(READY_PREFIX, {
    ok = true,
    rssBytes = getProcessRssBytes(),
    luaMemKb = math.floor(collectgarbage("count"))
})

while true do
    local line = io.stdin:read("*l")
    if not line then break end
    line = line:gsub("\r$", "")
    if line ~= "" then
        local req = dkjson.decode(line)
        if type(req) ~= "table" then
            sendFrame(RES_PREFIX, { id = nil, ok = false, error = "Invalid worker request", fatal = false })
        elseif req.cmd == "quit" then
            break
        elseif req.cmd == "ping" then
            sendFrame(RES_PREFIX, {
                id = req.id,
                ok = true,
                pong = true,
                rssBytes = getProcessRssBytes(),
                luaMemKb = math.floor(collectgarbage("count"))
            })
        elseif req.cmd == "crash" then
            -- Test hook: simulate an unrecoverable Lua error so pool recovery can be tested.
            sendFrame(RES_PREFIX, { id = req.id, ok = false, error = "Simulated worker crash", fatal = true })
            os.exit(1)
        else
            local xmlText = req.xml
            local openErr
            if type(xmlText) ~= "string" then
                if type(req.xmlPath) ~= "string" or req.xmlPath == "" then
                    openErr = "No XML path provided"
                else
                    local f = io.open(req.xmlPath, "r")
                    if not f then
                        openErr = "Could not open XML file"
                    else
                        xmlText = f:read("*a")
                        f:close()
                    end
                end
            end

            if openErr then
                sendFrame(RES_PREFIX, {
                    id = req.id,
                    ok = false,
                    error = openErr,
                    fatal = false,
                    rssBytes = getProcessRssBytes(),
                    luaMemKb = math.floor(collectgarbage("count"))
                })
            else
                resetBetweenBuilds()
                local okCall, cleanOutput, errMsg, isFatal = xpcall(function()
                    return calculateBuild(xmlText)
                end, debug.traceback)

                restoreSharedSkillCosts()
                resetGroupDpsHooks()

                if not okCall then
                    sendFrame(RES_PREFIX, {
                        id = req.id,
                        ok = false,
                        error = stripColorCodes(cleanOutput),
                        fatal = true,
                        rssBytes = getProcessRssBytes(),
                        luaMemKb = math.floor(collectgarbage("count"))
                    })
                    os.exit(1)
                elseif not cleanOutput then
                    sendFrame(RES_PREFIX, {
                        id = req.id,
                        ok = false,
                        error = errMsg or "Calculation failed",
                        fatal = isFatal == true,
                        rssBytes = getProcessRssBytes(),
                        luaMemKb = math.floor(collectgarbage("count"))
                    })
                    if isFatal then os.exit(1) end
                else
                    sendFrame(RES_PREFIX, {
                        id = req.id,
                        ok = true,
                        data = cleanOutput,
                        rssBytes = getProcessRssBytes(),
                        luaMemKb = math.floor(collectgarbage("count"))
                    })
                    cleanOutput = nil
                    -- Drop per-build references before collecting so the completed build's
                    -- calcsTab/GlobalCache can be reclaimed immediately.
                    if collectgarbage("count") > GC_AFTER_RES_KB then
                        resetBetweenBuilds()
                        collectgarbage("collect")
                    end
                end
            end
        end
    end
end

os.exit(0)
