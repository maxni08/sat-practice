import { useRef } from "react";
import type { QuestionProgress } from "../types";
type Highlight = QuestionProgress["highlights"][number];
export function HighlightText({
  text,
  field,
  highlights,
  onHighlight,
  enabled,
  underlines = [],
}: {
  text: string;
  field: "passage" | "stem";
  highlights: Highlight[];
  onHighlight: (h: Highlight) => void;
  enabled: boolean;
  underlines?: { start: number; end: number }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const relevant = highlights.filter(
    (h) => h.field === field && h.start >= 0 && h.end <= text.length,
  );
  const points = [
    ...new Set([
      0,
      text.length,
      ...relevant.flatMap((h) => [h.start, h.end]),
      ...underlines.flatMap((h) => [h.start, h.end]),
    ]),
  ].sort((a, b) => a - b);
  function mark() {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !ref.current ||
      !selection.rangeCount
    )
      return;
    const r = selection.getRangeAt(0);
    if (
      !ref.current.contains(r.startContainer) ||
      !ref.current.contains(r.endContainer)
    )
      return;
    const before = r.cloneRange();
    before.selectNodeContents(ref.current);
    before.setEnd(r.startContainer, r.startOffset);
    const start = before.toString().length;
    onHighlight({
      field,
      start,
      end: start + r.toString().length,
      color: "yellow",
    });
    selection.removeAllRanges();
  }
  return (
    <div className="selectable-wrap">
      <div
        ref={ref}
        className="question-text"
        onMouseUp={() => {
          if (enabled) mark();
        }}
      >
        {points.slice(0, -1).map((start, i) => {
          const end = points[i + 1];
          const highlighted = relevant.some(
            (h) => h.start <= start && h.end >= end,
          );
          const content = underlines.some(
            (h) => h.start <= start && h.end >= end,
          ) ? (
            <u>{text.slice(start, end)}</u>
          ) : (
            text.slice(start, end)
          );
          return highlighted ? (
            <mark key={start}>{content}</mark>
          ) : (
            <span key={start}>{content}</span>
          );
        })}
      </div>
    </div>
  );
}
