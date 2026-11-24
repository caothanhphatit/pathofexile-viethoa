-- Dump Path of Building PoE2 gem, skill and unique data to JSON.
--
-- Runs inside PoB's own Lua (patched LuaJIT) with cwd = <pob-core>/src, so the data files
-- are loaded by PoB's loader and gem stat lines are rendered by PoB's own StatDescriber
-- instead of being re-parsed with regexes:
--
--   cd <pob-core>/src && <pob-luajit> <repo>/scripts/pob-data/dump.lua <outDir>
--
-- Use scripts/pob-data/dump.mjs, which sets all of that up. Nothing in the PoB checkout is
-- written. Output: <outDir>/raw-gems.json, raw-skills.json, raw-uniques.json.
local outDir = (arg and arg[1]) or ...
if not outDir then
	io.stderr:write("usage: dump.lua <outDir>\n")
	os.exit(2)
end

package.path = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua;" .. package.path
package.cpath = "../runtime/?.dll;" .. package.cpath

dofile("HeadlessWrapper.lua")
local dkjson = require("dkjson")

local function writeJson(name, value)
	local f = assert(io.open(outDir .. "/" .. name, "wb"))
	f:write(dkjson.encode(value))
	f:close()
end

local function sortedKeys(t)
	local keys = { }
	for k in pairs(t) do keys[#keys + 1] = k end
	table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
	return keys
end

-- ── Stat description scopes ─────────────────────────────────────────────────
-- Same lookup as Modules/StatDescriber.lua (its scope cache is private), used only to tell
-- "this stat has a description in the scope chain" apart from "this stat has none".
local scopes = { }
local function getScope(scopeName)
	if scopes[scopeName] then return scopes[scopeName] end
	local normalized = scopeName:gsub("^specific_skill_stat_descriptions/", "")
	local scope
	local file = io.open("Data/StatDescriptions/Specific_Skill_Stat_Descriptions/" .. normalized .. ".lua", "rb")
	if file then
		file:close()
		scope = LoadModule("Data/StatDescriptions/Specific_Skill_Stat_Descriptions/" .. normalized)
	else
		scope = LoadModule("Data/StatDescriptions/" .. normalized)
	end
	local list = { scope }
	if scope.parent then
		for _, parent in ipairs(getScope(scope.parent)) do list[#list + 1] = parent end
	end
	scopes[scopeName] = list
	return list
end

-- "described": the scope chain has a descriptor with text for the stat.
-- "silent": the scope chain knows the stat but gives it no text. nil: unknown to the scope.
local function statScopeState(scopeName, stat)
	local ok, list = pcall(getScope, scopeName)
	if not ok then return nil end
	for _, scope in ipairs(list) do
		if scope[stat] then
			return scope[scope[stat]][1] and "described" or "silent"
		end
	end
	return nil
end

local function describe(stats, scopeName, quality)
	local ok, lines, lineMap = pcall(data.describeStats, stats, scopeName, quality)
	if not ok then return nil, tostring(lines) end
	local out = { }
	for _, line in ipairs(lines) do
		out[#out + 1] = { text = line, stat = lineMap[line] }
	end
	return out
end

-- ── Skills ──────────────────────────────────────────────────────────────────
local LEVEL_FIELDS = {
	"levelRequirement", "critChance", "cooldown", "storedUses", "attackSpeedMultiplier", "attackTime",
	"baseMultiplier", "manaMultiplier", "reservationMultiplier", "spiritReservationFlat",
	"spiritReservationPercent", "PvPDamageMultiplier", "vaalStoredUses", "soulPreventionDuration", "duration",
}

local function dumpLevel(level)
	if not level then return nil end
	local out = { }
	local any = false
	for _, field in ipairs(LEVEL_FIELDS) do
		if level[field] ~= nil then out[field] = level[field]; any = true end
	end
	if level.cost then
		out.cost = { }
		for resource, value in pairs(level.cost) do out.cost[resource] = value; any = true end
		if not next(out.cost) then out.cost = nil end
	end
	return any and out or nil
end

local function dumpSkill(id, skill, maxLevel)
	local out = {
		id = id,
		maxLevel = maxLevel,
		name = skill.name,
		baseTypeName = skill.baseTypeName,
		description = skill.description,
		color = skill.color,
		icon = skill.icon,
		support = skill.support or false,
		hidden = skill.hidden or false,
		isLineage = skill.isLineage or false,
		legacy = skill.legacy or false,
		castTime = skill.castTime,
		flavourText = skill.flavourText,
		levelCount = 0,
		level1 = dumpLevel(skill.levels and skill.levels[1]),
		levelMax = dumpLevel(skill.levels and skill.levels[maxLevel]),
		qualityStats = { },
		statSets = { },
	}
	for _ in pairs(skill.levels or { }) do out.levelCount = out.levelCount + 1 end
	for setIndex, statSet in ipairs(skill.statSets or { }) do
		local set = {
			label = statSet.label,
			scope = statSet.statDescriptionScope,
			baseFlags = sortedKeys(statSet.baseFlags or { }),
			level1 = dumpLevel(statSet.levels and statSet.levels[1]),
			levelMax = dumpLevel(statSet.levels and statSet.levels[maxLevel]),
			stats = { },
		}
		local okLow, low = pcall(calcLib.buildSkillInstanceStats, { level = 1, quality = 0 }, skill, statSet, false)
		local okHigh, high = pcall(calcLib.buildSkillInstanceStats, { level = maxLevel, quality = 0 }, skill, statSet, false)
		if okLow and okHigh then
			local range = { }
			for _, stat in ipairs(sortedKeys(low)) do
				local min, max = low[stat], high[stat] or low[stat]
				range[stat] = { min = min, max = max }
				set.stats[#set.stats + 1] = {
					id = stat, min = min, max = max,
					scope = set.scope and statScopeState(set.scope, stat) or nil,
					mapped = ((statSet.statMap and statSet.statMap[stat]) or data.skillStatMap[stat]) and true or false,
				}
			end
			if set.scope then
				local err
				set.lines, err = describe(range, set.scope)
				set.linesLevel1 = describe(low, set.scope)
				set.linesLevelMax = describe(high, set.scope)
				set.describeError = err
			end
		else
			set.describeError = tostring(okLow and high or low)
		end
		out.statSets[setIndex] = set
	end
	for _, list in ipairs({ { "quality", skill.qualityStats }, { "altQuality", skill.altQualityStats } }) do
		for _, stat in ipairs(list[2] or { }) do
			local statSet = skill.statSets and (skill.statSets[(stat[3] and stat[3][1] or 0) + 1] or skill.statSets[1])
			local entry = { kind = list[1], id = stat[1], perQuality = stat[2], statSetIndexes = stat[3] }
			if statSet and statSet.statDescriptionScope then
				-- Same call as Classes/GemTooltip.lua addQualityRangeInfo: the value at 20% quality.
				entry.lines = describe({ [stat[1]] = 20 * stat[2] }, statSet.statDescriptionScope, true)
			end
			out.qualityStats[#out.qualityStats + 1] = entry
		end
	end
	return out
end

local gemsOut, skillsOut, skillCount = { }, { }, 0
for _, gemId in ipairs(sortedKeys(data.gems)) do
	local gem = data.gems[gemId]
	local maxLevel = gem.naturalMaxLevel or 1
	local out = {
		id = gemId,
		name = gem.name,
		baseTypeName = gem.baseTypeName,
		gameId = gem.gameId,
		variantId = gem.variantId,
		grantedEffectId = gem.grantedEffectId,
		gemType = gem.gemType,
		gemFamily = gem.gemFamily,
		tagString = gem.tagString,
		tags = sortedKeys(gem.tags or { }),
		weaponRequirements = gem.weaponRequirements,
		reqStr = gem.reqStr, reqDex = gem.reqDex, reqInt = gem.reqInt,
		tier = gem.Tier,
		naturalMaxLevel = maxLevel,
		skillKeys = { },
		statRequirements = { },
	}
	for _, effect in ipairs(gem.grantedEffectList or { }) do
		local key = effect.id .. "@" .. maxLevel
		out.skillKeys[#out.skillKeys + 1] = key
		if not skillsOut[key] then
			skillsOut[key] = dumpSkill(effect.id, effect, maxLevel)
			skillCount = skillCount + 1
		end
	end
	-- Attribute requirements at level 1 and at the natural max level, with PoB's in-game formula.
	local effect = gem.grantedEffect
	for _, level in ipairs({ 1, maxLevel }) do
		local req = effect.levels[level] and effect.levels[level].levelRequirement or 1
		out.statRequirements[#out.statRequirements + 1] = {
			gemLevel = level,
			level = req,
			str = calcLib.getGemStatRequirement(req, gem.reqStr or 0, effect.support),
			dex = calcLib.getGemStatRequirement(req, gem.reqDex or 0, effect.support),
			int = calcLib.getGemStatRequirement(req, gem.reqInt or 0, effect.support),
		}
	end
	gemsOut[#gemsOut + 1] = out
end

local costs = { }
for index, cost in ipairs(data.costs) do
	costs[index] = { resource = cost.Resource, stat = cost.Stat, format = cost.ResourceString, divisor = cost.Divisor }
end

writeJson("raw-gems.json", { gems = gemsOut, costs = costs })
writeJson("raw-skills.json", skillsOut)

-- ── Uniques ─────────────────────────────────────────────────────────────────
-- The item text is exported as PoB stores it; scripts/pob-data/unique-text.mjs parses it.
local uniquesOut = { }
for _, group in ipairs(sortedKeys(data.uniques)) do
	local list = data.uniques[group]
	if type(list) == "table" then
		for index, raw in ipairs(list) do
			if type(raw) == "string" then
				uniquesOut[#uniquesOut + 1] = { group = group, index = index, raw = raw }
			end
		end
	end
end

local basesOut = { }
for name, base in pairs(data.itemBases) do
	local out = {
		type = base.type, subType = base.subType, quality = base.quality,
		implicit = base.implicit, hidden = base.hidden,
	}
	for _, field in ipairs({ "req", "armour", "weapon", "flask", "charm" }) do
		if type(base[field]) == "table" then
			local copy, any = { }, false
			for k, v in pairs(base[field]) do
				if type(v) ~= "table" and type(v) ~= "function" then copy[k] = v; any = true end
			end
			if any then out[field] = copy end
		end
	end
	basesOut[name] = out
end

writeJson("raw-uniques.json", { uniques = uniquesOut, bases = basesOut, flavourText = data.flavourText })
io.stderr:write(string.format("pob-data: %d gems, %d skills, %d uniques\n", #gemsOut, skillCount, #uniquesOut))
