import fs from "node:fs";

const treeUrl = "https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/TreeData/0_4/tree.json";

console.log("Fetching raw tree.json...");
const response = await fetch(treeUrl);
const raw = await response.json();

const classes = [
  "Ranger", "Huntress", "Warrior", "Mercenary", "Druid", "Witch", "Sorceress", "Monk"
];

console.log("Searching for class names in node names...");
const matches = [];
for (const [id, rawNode] of Object.entries(raw.nodes || {})) {
  const name = rawNode.name || "";
  for (const cls of classes) {
    if (name.toLowerCase().includes(cls.toLowerCase())) {
      matches.push({
        id: String(rawNode.skill ?? rawNode.id ?? id).trim(),
        name,
        classesStart: rawNode.classesStart,
        isClassStart: rawNode.isClassStart
      });
      break;
    }
  }
}

console.log(`Found ${matches.length} matches:`);
console.log(JSON.stringify(matches.slice(0, 30), null, 2));
