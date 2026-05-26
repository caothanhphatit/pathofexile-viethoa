import fs from "node:fs";

const treeUrl = "https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/TreeData/0_4/tree.json";

console.log("Fetching raw tree.json...");
const response = await fetch(treeUrl);
const raw = await response.json();

console.log("Analyzing start nodes...");

const startNodes = [];
for (const [id, rawNode] of Object.entries(raw.nodes || {})) {
  if (rawNode.isClassStart || rawNode.classesStart || rawNode.isAscendancyStart || rawNode.ascendancyName) {
    startNodes.push({
      id: String(rawNode.skill ?? rawNode.id ?? id).trim(),
      name: rawNode.name,
      isClassStart: rawNode.isClassStart,
      classesStart: rawNode.classesStart,
      isAscendancyStart: rawNode.isAscendancyStart,
      ascendancyName: rawNode.ascendancyName
    });
  }
}

console.log(`Found ${startNodes.length} start nodes in raw tree.json:`);
console.log(JSON.stringify(startNodes, null, 2));
