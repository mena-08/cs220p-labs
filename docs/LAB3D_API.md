# Lab3D API (`cs220p_site/lab3d.js`)

A dependency-free 3D renderer built on canvas 2D (perspective projection, painter's algorithm). It needs no WebGL and makes no network requests. Loading the file only defines `window.Lab3D` and does not touch the DOM. Load it before `lab.js`:

```html
<script src="lab3d.js"></script>
<script src="lab.js"></script>
```

## Common to every view

Each view object has:

- `view.el`: the element to insert. It holds the canvas (full width, CSS height `height`, device-pixel-ratio aware) and an overlaid toolbar: **3D** / **Top view** (**Flat view** on trees), **Reset view**, **Auto-rotate**. A hint in the corner reads "drag to orbit · scroll to zoom" ("pinch to zoom" on touch devices). The tree view also includes an HTML legend below the canvas.
- `view.update(state)`: sets the full state. Fields left out are cleared, except `pulse`, which only triggers one-shot flashes.
- `view.setView({ yaw, pitch, zoom, view })`: sets the camera immediately. Every field is optional. `view` is `"3d"` or `"top"`. Angles are in radians. Yaw `0` puts the camera on the bottom-row side looking north. Pitch `π/2` looks straight down. The grid's pitch is clamped to [0.22, π/2] and the tree's to [−0.35, 1.45]. Zoom is clamped to [0.55, 8].
- `view.onHover(fn)` / `view.onClick(fn)`: `fn(r, c)` gets the tile under the pointer, including wall tiles, or `fn(null)` when the pointer is not over a tile. Hover fires only when the tile changes, and fires `null` when the pointer leaves. A click or tap counts only when the pointer moved less than 5 px. On trees the callback always gets `null`.
- `view.destroy()`: stops animation frames and disconnects the resize, visibility and theme observers. It does not remove `view.el`.
- `view.stats()`: returns `{ ms, lastMs, frames }`, the scene render time in ms (moving average and last frame) and the number of renders. For debugging.

**Input**
- Drag: orbit. Dragging in top or flat view tilts the camera back into 3D.
- Right, middle, shift or ctrl drag, or two fingers: pan.
- Wheel or pinch: zoom toward the pointer.
- Double-click or double-tap: reset.
- Keyboard on the focused canvas: arrows orbit, `+`/`-` zoom, `0` resets.

**Rendering**
- The view redraws only when something changed, or while you drag or animations run (camera transitions, lifts, the robot glide, pulses, tree growth, auto-rotate).
- Idle frames that only animate the goal ring reuse a cached image and run at 30 fps.
- Rendering pauses while the canvas is offscreen (IntersectionObserver).
- With `prefers-reduced-motion`: there is no Auto-rotate button, no pulses and no growth, the goal ring is static, and camera changes are instant.

**Colors**
- Any CSS color string works, including `"var(--name)"` and `color-mix(...)`.
- `var()` colors are re-resolved when `data-theme` on `<html>` or the system color scheme changes.
- Invalid colors render gray.

## `Lab3D.grid({ rows, cols, wall(r, c) → bool, height = 440, view = "3d" })`

Walls are extruded blocks, 1 unit high. The floor is a slab with a grid. Colored tiles are raised by 0.07, and `lift` adds height on top of that. Heights animate smoothly.

`view.update(s)` takes these fields, all optional:

| field | meaning |
|---|---|
| `color(r, c)` | Tile color, or `null` for plain floor. On a wall cell it recolors the block. |
| `lift(r, c)` | Extra height from 0 to 1 (2 at most), for example frontier 0.3 and current cell 0.7. Ignored on walls. |
| `path` | `[[r, c], ...]`: a glowing raised tube through the cell centers. Cells off the grid are skipped. |
| `pathColor` | Tube color. Default: `palette().path`. |
| `robot` | `[r, c]` or `null`. Fractional values are allowed. The robot glides to each new position (a jump of more than 2.5 cells snaps). |
| `start`, `goal` | `{ r, c, label }`. START is a green pin with a tag reading "START · label". GOAL is a red flag with a pulsing ground ring and a tag reading "GOAL · label". The tags float above everything and hide when the marker is off screen. |
| `landmarks` | `[{ r, c, label }]`: small muted dots with a label. Landmarks on the START or GOAL cell are skipped. |
| `pulse` | `[[r, c], ...]`: each cell flashes once for 0.7 s (fill plus a rising outline), for example the cell just expanded. |
| `labels` | `[{ r, c, text }]`: small floating text above a tile. |
| `wall(r, c)` | Optional: replaces the wall layout. |

The hovered tile gets an outline.

## `Lab3D.tree({ height = 380, view = "3d" })`

- **3D layout:** each level is a ring of a cone (radius grows with level size). A node's children share its angular span in proportion to their leaf counts. Several roots (bidirectional search) become cones side by side.
- **Flat view:** a classic 2D tree with leaves in order and parents centered above their children, seen from the front.
- **Fitting:** level spacing adapts to the spread, and the camera re-fits as the tree grows.

`view.update({ nodes: [{ id, parent, label, kind }], focus })`:
- `parent`: `null`, or an id not in the list, makes a root. Nodes caught in a parent cycle become roots. A duplicate id keeps its first entry.
- `kind`: `"start" | "frontier" | "expanded" | "current" | "path" | "goal" | "cutoff"`. Unknown kinds are drawn as `"expanded"`.
  - `cutoff` draws as a hollow ring with ×.
  - `start`, `current` and `goal` get an extra ring.
  - Edges into `path`/`goal` nodes from `path`/`start`/`goal` parents are drawn thick in the path color.
- `label`: shown below the node. Defaults to the id. `\n` makes multi-line labels. Labels that would overlap are skipped, in priority order: focus, current, goal, start, path, frontier, expanded, cutoff; nearer nodes win.
- `focus`: id of a node to highlight with an ink ring. Its label is always drawn, and the camera pans to it if it is off screen.

New nodes grow out of their parent. Moved nodes glide. Far nodes fade slightly so you can read depth. Up to about 250 nodes.

## `Lab3D.palette()`

Returns the resolved colors (hex) for the current theme, so 2D legends can match:

```
bg, panel, ink, muted, line, floor, grid, wall, start, goal, path, robot, pulse,
frontier, expanded, current, cutoff, edge, dark (boolean)
```

## Example

```js
const g = Lab3D.grid({ rows: H, cols: W, wall: (r, c) => grid.wall[r][c] });
stage.append(g.el);
g.onClick((r, c) => { if (r !== null) console.log("clicked", r, c); });
g.update({
  color: (r, c) => (frontier.has(key(r, c)) ? "var(--focus)" : expanded.has(key(r, c)) ? "var(--mint)" : null),
  lift: (r, c) => (key(r, c) === current ? 0.7 : frontier.has(key(r, c)) ? 0.3 : 0),
  start: { r: s[0], c: s[1], label: "Library" }, goal: { r: e[0], c: e[1], label: "Cafeteria" },
  pulse: [cellOf(current)], path: done ? pathCells : null, robot: done ? robotPos : null,
});
// later: g.destroy();
```
