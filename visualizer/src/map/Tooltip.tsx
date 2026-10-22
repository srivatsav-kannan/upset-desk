import { useLayoutEffect, useRef, useState } from "react";
import type { Chamber } from "../data/models";
import type { Region } from "./regions";
import { BUCKET_LABEL, PARTY_NAME, bucketOf, fillOf, formatMargin, formatProbability } from "./scale";

export interface TooltipAnchor {
  region: Region;
  /** Viewport coordinates the tooltip sits next to. */
  x: number;
  y: number;
}

const OFFSET = 14;

/** Values lead, labels follow: the margin is the strong element, the race name sits above it. */
export function Tooltip({ anchor, chamber, modelName }: { anchor: TooltipAnchor; chamber: Chamber; modelName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x + OFFSET, top: anchor.y + OFFSET });

  // Keep the box inside the viewport: flip to the other side of the pointer near an edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = anchor.x + OFFSET + width > window.innerWidth - 8 ? anchor.x - OFFSET - width : anchor.x + OFFSET;
    const top = anchor.y + OFFSET + height > window.innerHeight - 8 ? anchor.y - OFFSET - height : anchor.y + OFFSET;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [anchor]);

  const { region } = anchor;
  const race = region.race;
  return (
    <div ref={ref} className="tooltip" role="status" style={pos}>
      <div className="tooltip-title">{region.title}</div>
      {race ? (
        <>
          <div className="tooltip-value">{formatMargin(race)}</div>
          <div className="tooltip-row">
            <span className="line-key" style={{ background: fillOf(race) }} aria-hidden="true" />
            <span>{PARTY_NAME[race.winner]}</span>
            <span className="tooltip-num">{formatProbability(race.winProbability)} to win</span>
          </div>
          <div className="tooltip-meta">
            {BUCKET_LABEL[bucketOf(race)]} {race.winner} · {modelName}
          </div>
        </>
      ) : (
        <div className="tooltip-meta">{chamber === "Senate" ? "No Senate race in 2026" : "No prediction"}</div>
      )}
    </div>
  );
}
