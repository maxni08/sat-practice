import katex from "katex";
import "katex/dist/katex.min.css";
import { Modal } from "./Modal";
const formulas = [
  ["Circle", "A=\\pi r^2\\quad C=2\\pi r"],
  ["Rectangle", "A=lw"],
  ["Triangle", "A=\\tfrac12 bh"],
  ["Right triangle", "c^2=a^2+b^2"],
  [
    "Special right triangles",
    "45^\\circ:45^\\circ:90^\\circ\\;\\to\\;x,x,x\\sqrt2",
  ],
  [
    "Special right triangles",
    "30^\\circ:60^\\circ:90^\\circ\\;\\to\\;x,x\\sqrt3,2x",
  ],
  ["Rectangular prism", "V=lwh"],
  ["Cylinder", "V=\\pi r^2h"],
  ["Sphere", "V=\\tfrac43\\pi r^3"],
  ["Cone", "V=\\tfrac13\\pi r^2h"],
  ["Pyramid", "V=\\tfrac13 lwh"],
];
export function ReferenceSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Math reference" onClose={onClose} wide>
      <p>
        The standard SAT reference formulas. In right triangles, c is the
        hypotenuse. In 30°–60°–90° triangles, x is opposite 30°.
      </p>
      <div className="formula-grid">
        {formulas.map(([name, formula], i) => (
          <section key={i}>
            <h3>{name}</h3>
            <div
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(formula, { throwOnError: false }),
              }}
            />
          </section>
        ))}
      </div>
      <p>
        A circle contains 360 degrees or 2π radians. The sum of the angles in a
        triangle is 180 degrees.
      </p>
      <p className="muted">
        r = radius · h = height · b = base · l = length · w = width
      </p>
    </Modal>
  );
}
