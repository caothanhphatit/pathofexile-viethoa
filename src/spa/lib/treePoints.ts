// One way to count a tree's points, used by every place the planner prints the number
// (header, tree card, saved-tree list): the header used to say 132 while the list of
// saved trees said 134 for the same tree, because an imported tree does not know its
// class's start nodes yet and they were counted as points.
import { isChoiceOptionNode } from "../../shared/equipment-rules.mjs";
import { weaponSetPointCounts, type BuildTreeSnapshot } from "./buildPlanner";

/**
 * Points a tree spends, as the tree itself and Path of Building count them: allocated
 * nodes without the class / ascendancy start nodes, and a node taken in both weapon
 * sets paid once (PoB: PointsUsed - min(set 1, set 2); ascendancy points included, the
 * option picked under a multiple-choice ascendancy node not counted, as in PoB).
 * isStartNode: tells a start node by id (from the passive tree data); the snapshot's
 * own startIds are honoured as well.
 */
export function treePointsSpent(
  snapshot: Pick<BuildTreeSnapshot, "allocatedIds" | "startIds" | "weaponSets"> | null | undefined,
  isStartNode: (id: string) => boolean = () => false
): number {
  if (!snapshot) return 0;
  const starts = new Set((snapshot.startIds ?? []).map(String));
  const points = [...new Set(snapshot.allocatedIds.map(String))].filter((id) => !starts.has(id) && !isStartNode(id) && !isChoiceOptionNode(id));
  return points.length - weaponSetPointCounts(snapshot.weaponSets, points).shared;
}
