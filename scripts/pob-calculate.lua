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
end

local jsonStr = dkjson.encode(cleanOutput)
print(jsonStr)
os.exit(0)
