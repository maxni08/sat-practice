import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Preserve a consistent, readable source-text size instead of stretching short
 * equation crops across the entire answer row. 144 CSS px/in gives the PDF's
 * typical 9 pt type an 18 px display size. Max-width allows smaller windows. */
export function SourceImage({
  src,
  alt,
  className,
  dpi = 180,
}: {
  src: string;
  alt: string;
  className?: string;
  dpi?: number;
}) {
  const [width, setWidth] = useState<number>();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const enlarge = () => { setZoom(1); setOpen(true); };
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <img
        src={src}
        alt={alt}
        title="Click to enlarge; double-click inside an answer choice"
        className={`${className ?? ""} zoom-source`}
        style={{ width: width ?? "auto", maxWidth: "100%", height: "auto" }}
        onClick={(event) => { if (event.currentTarget.closest("button.choice")) return; event.preventDefault(); event.stopPropagation(); enlarge(); }}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); enlarge(); }}
        onLoad={(event) => setWidth((event.currentTarget.naturalWidth * 144) / dpi)}
      />
      {open && createPortal(<div className="image-zoom" role="dialog" aria-modal="true" aria-label={`Enlarged: ${alt}`} onClick={()=>setOpen(false)}>
        <div className="image-zoom-tools" onClick={event=>event.stopPropagation()}><button aria-label="Zoom out" onClick={()=>setZoom(value=>Math.max(.5,value-.25))}>−</button><button onClick={()=>setZoom(1)}>Reset</button><button aria-label="Zoom in" onClick={()=>setZoom(value=>Math.min(4,value+.25))}>+</button><button onClick={()=>setOpen(false)}>Close</button></div>
        <div className="image-zoom-stage" onClick={event=>event.stopPropagation()}><img src={src} alt={alt} style={{transform:`scale(${zoom})`}} /></div>
      </div>, document.body)}
    </>
  );
}
