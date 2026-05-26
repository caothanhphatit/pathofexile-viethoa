import fs from "node:fs";

const treeUrl = "https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/TreeData/0_4/tree.json";

console.log("Fetching raw tree.json...");
const response = await fetch(treeUrl);
const raw = await response.json();

console.log("Analyzing proxies...");

const nodeGroupLookup = new Map();
for (const [groupId, group] of Object.entries(raw.groups || {})) {
  if (!group || typeof group !== "object") continue;
  for (const nodeId of group.nodes || []) {
    nodeGroupLookup.set(String(nodeId).trim(), String(groupId).trim());
  }
}

const proxies = [];
for (const rawNode of Object.values(raw.nodes || {})) {
  const id = String(rawNode.skill ?? rawNode.id).trim();
  const groupId = nodeGroupLookup.get(id) || String(rawNode.group).trim();
  const group = raw.groups?.[groupId] || raw.groups?.[rawNode.group] || null;
  
  if (rawNode.isProxy || group?.isProxy) {
    proxies.push({
      id,
      name: rawNode.name,
      rawNode,
      groupIsProxy: group?.isProxy
    });
  }
}

console.log(`Found ${proxies.length} total proxy nodes.`);

const nonMasteryProxies = proxies.filter(p => !p.name.toLowerCase().includes("mastery"));
console.log(`Found ${nonMasteryProxies.length} non-Mastery proxy nodes.`);

for (const p of nonMasteryProxies) {
  console.log(JSON.stringify({
    id: p.id,
    name: p.name,
    isProxy: p.rawNode.isProxy,
    groupIsProxy: p.groupIsProxy,
    type: p.rawNode.isNotable ? "notable" : p.rawNode.isKeystone ? "keystone" : "small",
    stats: p.rawNode.stats
  }, null, 2));
}
