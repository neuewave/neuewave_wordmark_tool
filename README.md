# neuewave_wordmark_tool

Browser tool that builds the neuewave logo from text set in Monument Extended and four elemental forms.

## The shape system
Earth, fire, water and wind all use the same controls:

1. **Primitive**: sphere, cube, tetra, octa, dodeca, icosa, cone, cylinder or torus.
2. **Supershape**: the superformula reshapes the primitive on two angles. "Around" (lobes, n1, n2, n3) is the outline seen face-on; "Profile" is the section through it. Amount blends from the plain primitive to the full supershape.
3. **Deform**: width, height, depth, taper, twist, bend, noise.
4. **Array**: copies laid out as scatter, line, stack, ring, spiral or grid, with size falloff, a turn or tumble per copy, and irregularity.
5. **Motion**: flow (copies travel along the array) and spin.

Fire, water and wind can instead use an **Organic** build: a flame, a liquid surface, or gust lines.

## Style (all elements)
One section sets the look of every element at once: **3D or 2D**, **Solid, Line art or Wire**, **Smooth or Faceted**, the finish (matte, satin, gloss, chrome), mesh resolution, glow and line weight.
In 2D everything is flat colour in the picture plane.

## Run
Open `dist/index.html` in a browser. No server is needed.
A plain-language guide for students is in `STUDENT-README.txt`.

## Text
The Wordmark and Copy sections each set a block of text in Monument Extended (Regular or Ultrabold): type anything from `nw` to paragraphs.
Controls: case, outline or solid, ink, size, tracking, leading, wrap width, alignment, stretch, slant and position. Drag a block on the canvas to move it. **Shuffle** tries a random treatment.
The glyph outlines are generated from the font files by `node tools/extract-font.mjs` and stored in `src/font-data.js`; that file and `dist/index.html` contain the font's outlines and are covered by its licence.

## Collection
**Save** stores the current design with a thumbnail. Saved variations stay in this browser (IndexedDB) and reload with a click; **Compare all** shows them side by side.
**Export file** writes the whole collection to a JSON file and **Import file** reads one back, for backups or another computer.
A saved variation holds the settings, not a frozen physics pose.

## Physics (form finding)
Open **Physics** and set Simulate to **Run**.

- Every copy of a primitive is a rigid body: they roll, bounce and collide with each other across elements. Copies can be linked into a chain and pinned.
- Weight sets how much gravity an element feels (0 floats).
- Flame tongues are chains held at the root; embers are free particles that rise and respawn.
- Water is a particle fluid: it pours, pools, splits into drops and merges again.
- Wind streams are weightless chains that ride the air.
- Forces: gravity, wind with gusts, turbulence, drag. Contacts: floor, walls (the frame edges), bounce, stones.
- Press on empty canvas to push the forms around (Pointer push; negative pulls).
- Per form: **Response**, **Lift**, **Memory** (spring back to the designed shape: 0 is free, 1 barely moves), **Pin**; water also has **Cohesion** and **Viscosity**.
- **Hold** freezes the pose for a PNG export. **Kick** pushes everything. **Reset** returns to the designed shapes.

The solver uses a fixed time step, so the same settings and seed give the same result.

## Export
**Export PNG** saves a still. **Export SVG** saves vector artwork: the forms are traced as flat colour shapes (in Line art, as the drawn lines) and the text is written as outlines.

## Record
**Record** renders frame by frame to GIF, MP4 (H.264), WebM (VP9) or a ZIP of PNG frames.

## Edit and rebuild
    npm install
    npm run build

To regenerate the glyph outlines from the font files installed in `~/Library/Fonts`: `npm run font`.

## Files
- `src/shapes.js`  the shape system: primitives, supershape, deformers, arrays
- `src/elements.js`  the organic builds (flame, liquid, gusts)
- `src/outline.js`  the line-art renderer
- `src/svg.js`  vector tracing and SVG output
- `src/iso.js`  the liquid surface (metaballs, marching cubes)
- `src/physics.js`  the solver (chains, fluid, rigid stones, contacts)
- `src/wordmark.js`, `src/font-data.js`  text layout and the Monument Extended outlines
- `src/store.js`  the collection
- `src/recorder.js`  GIF, MP4, WebM and PNG-sequence export
- `src/presets.js`  colours, the base state, presets
- `src/ui.js`  control panel
- `src/main.js`  scene, interaction, export
- `src/noise.js`  seeded random, noise, superformula

Units: "neuewave" on one line at size 1 is 10 units wide. One grid module is its x-height (0.829 units).
