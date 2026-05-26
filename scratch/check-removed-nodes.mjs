import fs from "node:fs";
import path from "node:path";
import { normalizePassiveTree } from "../scripts/passive-tree/passive-tree-lib.mjs";

const rootDir = "d:/code1/poe2";

// Let's fetch the raw tree.json content from cache or download it
const treeUrl = "https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/TreeData/0_4/tree.json";

console.log("Fetching raw tree.json...");
const response = await fetch(treeUrl);
const raw = await response.json();

console.log("Analyzing nodes...");

// We'll see what shouldExportPassiveTreeNode does.
// Let's copy the logic and test which nodes are filtered out.
const nodeGroupLookup = new Map();
for (const [groupId, group] of Object.entries(raw.groups || {})) {
  if (!group || typeof group !== "object") continue;
  for (const nodeId of group.nodes || []) {
    nodeGroupLookup.set(String(nodeId).trim(), String(groupId).trim());
  }
}

const filteredOut = [];
for (const rawNode of Object.values(raw.nodes || {})) {
  const id = String(rawNode.skill ?? rawNode.id).trim();
  const groupId = nodeGroupLookup.get(id) || String(rawNode.group).trim();
  const group = raw.groups?.[groupId] || raw.groups?.[rawNode.group] || null;
  
  let reason = "";
  if (!groupId || !group || typeof group !== "object") {
    reason = "no_group";
  } else if (rawNode.isProxy || group.isProxy) {
    reason = "isProxy";
  } else if (rawNode.expansionJewel?.parent) {
    reason = "expansionJewel";
  } else if (rawNode.isOnlyImage) {
    reason = "isOnlyImage";
  }
  
  if (reason) {
    filteredOut.push({
      id,
      name: rawNode.name,
      type: rawNode.isNotable ? "notable" : rawNode.isKeystone ? "keystone" : "small",
      isProxy: rawNode.isProxy,
      groupIsProxy: group?.isProxy,
      reason,
      rawNode
    });
  }
}

console.log(`Filtered out ${filteredOut.length} nodes.`);

// Let's print unique names of filtered out nodes
const nameCounts = {};
for (const node of filteredOut) {
  nameCounts[node.name] = (nameCounts[node.name] || 0) + 1;
}
console.log("Filtered out node names:", nameCounts);

// Let's find nodes that have "gate" or "portal" in their name or have start classes
const gateCandidates = filteredOut.filter(n => 
  /gate|portal|start/i.test(n.name) || 
  n.rawNode.isClassStart || 
  n.rawNode.classesStart
);
console.log("Gate candidates filtered out:", gateCandidates.map(c => ({ id: c.id, name: c.name, reason: c.reason })));
