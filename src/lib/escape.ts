import { useEffect, useRef } from "react";

type Layer = { id: symbol; close: () => void; priority: number };
const layers: Layer[] = [];
let listening = false;

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const layer = [...layers].sort((a, b) => b.priority - a.priority).at(0);
  if (!layer) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  layer.close();
}

export function registerEscape(close: () => void, priority = 0) {
  const id = Symbol("escape-layer");
  layers.push({ id, close, priority });
  if (!listening) { window.addEventListener("keydown", onKey, true); listening = true; }
  return () => {
    const i = layers.findIndex(layer => layer.id === id);
    if (i >= 0) layers.splice(i, 1);
    if (!layers.length && listening) { window.removeEventListener("keydown", onKey, true); listening = false; }
  };
}

export function useEscape(active: boolean, close: () => void, priority = 0) {
  const current = useRef(close);
  current.current = close;
  useEffect(() => active ? registerEscape(() => current.current(), priority) : undefined, [active, priority]);
}
