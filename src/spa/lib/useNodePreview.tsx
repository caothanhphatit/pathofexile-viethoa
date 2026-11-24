// React glue for the passive node preview (see ./nodePreview.ts): give the hook the
// build's calculation body and allocated nodes, pass what it returns to
// PassiveTreeWorkspace, and the tree tooltip shows "+4,2% DPS, +35 máu, ..." for
// the hovered node.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PassiveNode, PassiveTreeModel } from "../passive/tree";
import { calcBackend, serverCalculateNodeDeltas } from "./calcBackend";
import {
  NodePreviewStore,
  formatNodeDelta,
  nodePreviewCandidates,
  previewableNode,
  type NodeDeltaBatch
} from "./nodePreview";

/** POST /api/builds/node-deltas, waiting and retrying while the calculator is busy. */
export async function fetchNodeDeltas(body: Record<string, unknown>, nodeIds: string[]): Promise<NodeDeltaBatch> {
  return serverCalculateNodeDeltas(body, nodeIds);
}

interface Options {
  /** The build's calculation body (null: nothing to preview). */
  body: Record<string, unknown> | null;
  allocatedIds: string[];
  /** True while the build's own numbers are being calculated: previews wait. */
  paused: boolean;
  locale: "vi" | "en";
}

export function useNodePreview({ body, allocatedIds, paused, locale }: Options) {
  const store = useMemo(
    () => new NodePreviewStore((reqBody, ids) => calcBackend.calculateNodeDeltas(reqBody, ids), { batchSize: 40 }),
    []
  );
  useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    () => store.snapshot
  );
  const [tree, setTree] = useState<PassiveTreeModel | null>(null);
  const allocatedRef = useRef(allocatedIds);
  allocatedRef.current = allocatedIds;

  useEffect(() => {
    store.setBuild(body);
  }, [store, body]);
  useEffect(() => {
    store.setPaused(paused);
  }, [store, paused]);
  // What the player can take next: priced as soon as the tree is shown.
  const allocatedKey = allocatedIds.join(",");
  useEffect(() => {
    if (!tree || !body) return;
    store.want(nodePreviewCandidates(tree, allocatedRef.current, { includeAllocated: false }));
  }, [store, tree, body, allocatedKey]);

  const onNodeHover = useCallback((node: PassiveNode | null, allocated: boolean) => {
    if (!node || !tree || !previewableNode(node.type)) return;
    store.want([node.id], { urgent: true });
    // Removing nodes is asked for on demand: the rest of the tree fills the same batch.
    // (No edges: just the allocated nodes, keystones and notables first.)
    if (allocated) store.want(nodePreviewCandidates({ edges: [], nodeById: tree.nodeById }, allocatedRef.current));
  }, [store, tree]);

  const renderNodeExtra = useCallback((node: PassiveNode, allocated: boolean, blocked = false): ReactNode => {
    if (!body || !previewableNode(node.type)) return null;
    const vi = locale === "vi";
    const entry = store.get(node.id);
    // blocked: the click is refused (no points left), so this is what the node would give.
    const title = allocated
      ? (vi ? "Bỏ node này" : "Removing this node")
      : blocked
        ? (vi ? "Nếu còn điểm để lấy node này" : "If you had the points for this node")
        : (vi ? "Lấy node này" : "Allocating this node");
    let content: ReactNode;
    if (!entry || entry.status === "pending") {
      content = <p className="passive-node-delta__note">{vi ? "Đang tính…" : "Calculating…"}</p>;
    } else if (entry.status === "error") {
      content = <p className="passive-node-delta__note">{vi ? "Không tính được." : "Could not calculate."}</p>;
    } else {
      const { delta, base } = entry;
      // Lead with what a click really does: the whole path to the node, or (removing)
      // everything PoB drops with it; this node alone comes second.
      const many = Boolean(delta.path) && (delta.pathLength ?? 0) > 1;
      const lines = formatNodeDelta(many ? delta.path! : delta.node, base, locale);
      const aloneLines = many ? formatNodeDelta(delta.node, base, locale) : [];
      const others = (delta.pathLength ?? 1) - 1;
      const scope = many
        ? (allocated
          ? (vi ? `Mất luôn ${others} node khác không còn nối vào cây` : `Also drops ${others} nodes left unconnected`)
          : (vi ? `Cả đường ${delta.pathLength} node` : `Whole ${delta.pathLength}-node path`))
        : "";
      content = (
        <>
          {lines.length ? (
            <>
              {many ? <p className="passive-node-delta__note">{scope}:</p> : null}
              {lines.map((line) => <p key={line.stat} className={line.positive ? "is-up" : "is-down"}>{line.text}</p>)}
            </>
          ) : (
            <p className="passive-node-delta__note">
              {many ? `${scope}: ` : ""}{vi ? (many ? "không đổi chỉ số chính." : "Không đổi chỉ số chính.") : (many ? "no change to the main stats." : "No change to the main stats.")}
            </p>
          )}
          {many && (lines.length || aloneLines.length) ? (
            <p className="passive-node-delta__note">
              {vi ? "Riêng node này: " : "This node alone: "}
              {aloneLines.length ? aloneLines.map((line) => line.text).join(", ") : (vi ? "không đổi" : "no change")}
            </p>
          ) : null}
          {delta.weaponSet ? (
            <p className="passive-node-delta__note">{vi
              ? `Node của bộ vũ khí ${delta.weaponSet}: chỉ có tác dụng khi dùng bộ này.`
              : `Weapon set ${delta.weaponSet} node: only counts while that set is in use.`}</p>
          ) : null}
        </>
      );
    }
    return (
      <div className="passive-node-delta">
        <span className="passive-node-delta__title">{title}</span>
        {content}
      </div>
    );
    // store.snapshot is read through useSyncExternalStore above, which re-renders on every answer.
  }, [body, locale, store, store.snapshot]);

  return { onNodeHover, renderNodeExtra, onTreeReady: setTree };
}
