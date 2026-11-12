/* Lab 2 code exercises (needs labcode.js; uses lab3d.js when loaded). Loading this file only defines window.Lab2Code.
   Lab2Code.mount(kind, ctx) -> HTMLElement. kind: "expand" | "bfs" | "dfs" | "dls" | "parsons" | "puzzle".
   ctx = { maps: { <id>: { rows, cols, wall(r, c) -> bool, start: [r, c], goal: [r, c], startLabel, goalLabel, name? } }, defaultMap,
           smallMaps? (same shape; for "dls", whose tree search needs small maps; default: two built-in mini maps) }.
   The tests run on every map in ctx.maps (the lab passes one with a reachable goal and one without).
   Semantics follow the lab's search(): neighbors Up, Down, Left, Right; BFS tests the goal when a child is generated; DFS is the same loop
   with a stack (the goal tested when generated or when popped: both accepted, same path); depth-limited search is the recursive tree search
   that skips states on its own branch and returns a path, 'cutoff' or None. Expansions = calls to expand(). */
(function () {
  "use strict";
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const K = (p) => p[0] * 1000 + p[1];
  const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  const fc = (p) => (Array.isArray(p) ? `(${p.join(", ")})` : String(p));
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const h = (...a) => window.Lab.h(...a);

  /* ---------- reference searches (the semantics of the solutions in the TA cheat sheet) ---------- */
  function nbrs(m, p) {
    const out = [];
    for (const [dr, dc] of DIRS) { const r = p[0] + dr, c = p[1] + dc; if (r >= 0 && c >= 0 && r < m.rows && c < m.cols && !m.wall(r, c)) out.push([r, c]); }
    return out;
  }
  /* algo: bfs (goal tested when generated) | dfs (goal tested when popped, as the lab's DFS) | dfsgen (goal tested when generated) */
  function refSearch(m, algo, kids = (p) => nbrs(m, p), start = m.start, goal = m.goal, key = K) {
    const trace = [];
    const done = (path) => ({ path, moves: path ? path.length - 1 : null, calls: trace.length, trace });
    if (key(start) === key(goal)) return done([start]);
    const parent = new Map([[key(start), null]]), node = new Map([[key(start), start]]), fr = [start];
    const chain = (p) => { const out = []; for (let k = key(p); k !== null; k = parent.get(k)) out.push(node.get(k)); return out.reverse(); };
    let head = 0;
    while (head < fr.length) {
      const cur = algo === "bfs" ? fr[head++] : fr.pop();
      if (algo === "dfs" && key(cur) === key(goal)) return done(chain(cur));
      const ks = kids(cur); trace.push([cur, ks]);
      for (const ch of ks) {
        const k = key(ch); if (parent.has(k)) continue;
        parent.set(k, key(cur)); node.set(k, ch);
        if (algo !== "dfs" && k === key(goal)) return done(chain(ch));
        fr.push(ch);
      }
    }
    return done(null);
  }
  function refDls(m, path, limit, trace) {
    const cur = path[path.length - 1];
    if (same(cur, m.goal)) return path;
    if (limit === 0) return "cutoff";
    let cut = false;
    const ks = nbrs(m, cur); trace.push([cur, ks]);
    for (const ch of ks) {
      if (path.some((q) => same(q, ch))) continue;
      const r = refDls(m, [...path, ch], limit - 1, trace);
      if (r === "cutoff") cut = true; else if (r) return r;
    }
    return cut ? "cutoff" : null;
  }
  function refIds(m, maxL = 60) {
    const trace = [], iters = [];
    for (let L = 0; L <= maxL; L++) {
      iters.push([L, trace.length]);
      const r = refDls(m, [m.start], L, trace);
      if (r !== "cutoff") return { result: r, trace, iters, calls: trace.length };
    }
    return { result: "cutoff", trace, iters, calls: trace.length };
  }
  /* graph-search statistics of a run from its trace: the frontier = reached but not yet expanded, measured before every expansion */
  function stats(trace, start) {
    const reached = new Set([K(start)]);
    let maxF = 1;
    trace.forEach(([, ks], i) => {
      maxF = Math.max(maxF, reached.size - i);
      for (const c of ks || []) if (Array.isArray(c) && c.length === 2) reached.add(K(c));
    });
    return { maxFrontier: maxF, reached: reached.size };
  }

  /* 8-puzzle: a board is 9 numbers row by row, 0 the blank; successors move the blank Up, Down, Left, Right */
  const P_GOAL = [1, 2, 3, 4, 5, 6, 7, 8, 0];
  function pSucc(b) {
    const i = b.indexOf(0), r = Math.floor(i / 3), c = i % 3, out = [];
    for (const [dr, dc] of DIRS) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr > 2 || cc < 0 || cc > 2) continue; const j = rr * 3 + cc, a = b.slice(); a[i] = a[j]; a[j] = 0; out.push(a); }
    return out;
  }
  const pKey = (b) => b.join("");
  const pBfs = (b) => refSearch(null, "bfs", pSucc, b, P_GOAL, pKey);
  const P_SUCC_CASES = [[1, 2, 3, 4, 5, 6, 7, 8, 0], [1, 0, 3, 4, 2, 6, 7, 5, 8], [1, 2, 3, 4, 0, 5, 7, 8, 6]];
  const P_BOARDS = [{ name: "BOARD (6 moves)", board: [1, 2, 0, 4, 8, 3, 7, 6, 5] }, { name: "a board 12 moves deep", board: [1, 5, 2, 7, 0, 6, 8, 3, 4] }];

  /* ---------- maps ---------- */
  function fromRows(id, name, rows) {
    let start = null, goal = null;
    rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "S") start = [r, c]; if (ch === "G") goal = [r, c]; }));
    return { rows: rows.length, cols: rows[0].length, wall: (r, c) => rows[r][c] === "#", start, goal, startLabel: "S", goalLabel: "G", name };
  }
  const SMALL = () => ({
    corner: fromRows("corner", "Corner of a map", ["S..#..", ".#....", ".#.##.", "...#.G"]),
    walled: fromRows("walled", "Open room, G walled in", ["S...", "..##", "..#G"]),
  });
  function norm(maps, first) {
    const ids = Object.keys(maps || {});
    if (first && ids.includes(first)) ids.sort((a, b) => (a === first ? -1 : b === first ? 1 : 0));
    return ids.map((key) => {
      const m = maps[key], out = { key, name: m.name || key, rows: m.rows, cols: m.cols, wall: m.wall, start: m.start.slice(), goal: m.goal.slice(), startLabel: m.startLabel || "start", goalLabel: m.goalLabel || "goal" };
      out.grid = Array.from({ length: m.rows }, (_, r) => Array.from({ length: m.cols }, (_, c) => (m.wall(r, c) ? "#" : ".")).join(""));
      out.bfs = refSearch(out, "bfs");
      return out;
    });
  }
  const pyMaps = (ms) => JSON.stringify(Object.fromEntries(ms.map((m) => [m.key, { name: m.name, grid: m.grid, start: m.start, goal: m.goal }])));

  /* ---------- Python: the hidden parts that run before and after the student's code ---------- */
  const PY_MAPS = (ms) => `
import time, json
from collections import deque

MAPS = json.loads(${JSON.stringify(pyMaps(ms))})
for _m in MAPS.values():
    _m["start"], _m["goal"] = tuple(_m["start"]), tuple(_m["goal"])
_LIMIT, _SECONDS = 20000, 3.0

class _Expand:
    """expand(state) on one map with a step guard; every call is logged for the tests and the animation"""
    def __init__(self, grid, neighbors=None):
        self.grid, self.fn, self.rows, self.cols = grid, neighbors, len(grid), len(grid[0])
        self.free = sum(row.count(".") for row in grid)
        self.n, self.trace, self.t0 = 0, [], time.time()
    def __call__(self, node):
        self.n += 1
        if self.n > _LIMIT:
            raise TooManySteps(f"expand() was called {_LIMIT:,} times, but this map has only {self.free} free cells. Is a node taken out of the frontier on every pass of the loop, and is every state added only once?")
        if time.time() - self.t0 > _SECONDS:
            raise TooManySteps(f"the search ran for more than {_SECONDS:.0f} seconds.")
        if self.fn is None:
            if not (isinstance(node, tuple) and len(node) == 2 and all(isinstance(x, int) for x in node)):
                raise TypeError(f"expand() takes a state (row, col), but got {node!r}")
            r, c = node
            kids = []
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                rr, cc = r + dr, c + dc
                if 0 <= rr < self.rows and 0 <= cc < self.cols and self.grid[rr][cc] != "#":
                    kids.append((rr, cc))
        else:
            kids = self.fn(self.grid, node)
            if kids is None:
                raise TypeError("neighbors() returned None: is 'return result' missing?")
            kids = list(kids)
        if len(self.trace) < 40000:
            self.trace.append([node, kids])
        return kids

def _enc(x):
    if x is None:
        return {"kind": "none"}
    if isinstance(x, str):
        return {"kind": "str", "value": x[:60]}
    if isinstance(x, (list, tuple)) and all(isinstance(s, tuple) and len(s) == 2 for s in x):
        return {"kind": "path", "path": [list(s) for s in x]}
    return {"kind": "other", "repr": repr(x)[:200], "type": type(x).__name__}

_first = next(iter(MAPS.values()))
grid, START, GOAL = _first["grid"], _first["start"], _first["goal"]
expand = _Expand(grid)
`;
  const PY_RUN_ALL = (fn) => `
RESULT = {"runs": []}
for _key, _m in MAPS.items():
    _ex = _Expand(_m["grid"])
    _rec = {"map": _key}
    try:
        _rec["out"] = _enc(${fn}(_m["start"], _m["goal"], _ex))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    _rec["calls"], _rec["trace"] = _ex.n, _ex.trace
    RESULT["runs"].append(_rec)
`;
  const TINY = ["..#.", "....", "..#."];
  const TINY_CASES = [[1, 1], [0, 0], [1, 2], [2, 3]];
  const PY_EXPAND_TESTS = `
TINY = ${JSON.stringify(TINY)}
def _enc_cells(x):
    if x is None:
        return {"kind": "none"}
    try:
        items = list(x)
    except TypeError:
        return {"kind": "other", "repr": repr(x)[:200]}
    return {"kind": "list", "tuples": all(isinstance(c, tuple) for c in items), "repr": repr(items)[:200],
            "cells": [list(c) if isinstance(c, (tuple, list)) and len(c) == 2 else None for c in items]}

def _ref_bfs(start, goal, expand):
    if start == goal:
        return [start]
    frontier, reached = deque([start]), {start: None}
    while frontier:
        node = frontier.popleft()
        for child in expand(node):
            if child not in reached:
                reached[child] = node
                if child == goal:
                    path = [child]
                    while reached[path[-1]] is not None:
                        path.append(reached[path[-1]])
                    return path[::-1]
                frontier.append(child)
    return None

RESULT = {"unit": [], "runs": []}
for _cell in ${JSON.stringify(TINY_CASES).replace(/\[(\d), (\d)\]/g, "($1, $2)")}:
    _rec = {"cell": list(_cell)}
    try:
        _rec["out"] = _enc_cells(neighbors(TINY, tuple(_cell)))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    RESULT["unit"].append(_rec)
for _key, _m in MAPS.items():
    _rec = {"map": _key}
    try:
        _ex = _Expand(_m["grid"], neighbors)
        _rec["out"] = _enc(_ref_bfs(_m["start"], _m["goal"], _ex))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    _rec["calls"], _rec["trace"] = _ex.n, _ex.trace
    RESULT["runs"].append(_rec)
`;
  const PY_DLS_TESTS = (cases) => `
RESULT = {"dls": [], "ids": []}
_dl = {"depth": 0, "iters": None}
_user_dls = globals().get("depth_limited")
if _user_dls is not None:
    def depth_limited(path, goal, expand, limit):
        if _dl["depth"] == 0 and _dl["iters"] is not None:
            _dl["iters"].append([limit, getattr(expand, "n", 0)])
            if len(_dl["iters"]) > 60:
                raise TooManySteps("iterative deepening tried 60 depth limits and did not stop. It must stop as soon as depth_limited returns something other than 'cutoff'.")
        _dl["depth"] += 1
        try:
            return _user_dls(path, goal, expand, limit)
        finally:
            _dl["depth"] -= 1
for _key, _limit in ${JSON.stringify(cases)}:
    _m, _ex = MAPS[_key], _Expand(MAPS[_key]["grid"])
    _rec = {"map": _key, "limit": _limit}
    try:
        _rec["out"] = _enc(depth_limited([_m["start"]], _m["goal"], _ex, _limit))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    _rec["calls"], _rec["trace"] = _ex.n, _ex.trace
    RESULT["dls"].append(_rec)
for _key, _m in MAPS.items():
    _ex = _Expand(_m["grid"])
    _rec = {"map": _key}
    _dl["iters"], _dl["depth"] = [], 0
    try:
        _rec["out"] = _enc(iterative_deepening(_m["start"], _m["goal"], _ex))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    _rec["calls"], _rec["trace"], _rec["iters"] = _ex.n, _ex.trace, _dl["iters"]
    _dl["iters"] = None
    RESULT["ids"].append(_rec)
`;
  const pyTuple = (b) => "(" + b.join(", ") + ")";
  const PY_PUZZLE_PRE = `
import time
from collections import deque
_LIMIT, _SECONDS = 50000, 4.0
class _Succ:
    def __init__(self, fn):
        self.fn, self.n, self.t0 = fn, 0, time.time()
    def __call__(self, board):
        self.n += 1
        if self.n > _LIMIT:
            raise TooManySteps(f"successors() was called {_LIMIT:,} times without reaching the goal.")
        if time.time() - self.t0 > _SECONDS:
            raise TooManySteps(f"the search ran for more than {_SECONDS:.0f} seconds.")
        kids = self.fn(board)
        if kids is None:
            raise TypeError("successors() returned None: is 'return result' missing?")
        return list(kids)
def _encb(x):
    if x is None:
        return {"kind": "none"}
    try:
        items = list(x)
    except TypeError:
        return {"kind": "other", "repr": repr(x)[:200]}
    ok = all(isinstance(b, (tuple, list)) and len(b) == 9 for b in items)
    return {"kind": "boards" if ok else "other", "tuples": all(isinstance(b, tuple) for b in items), "repr": repr(items)[:240],
            "boards": [list(b) for b in items] if ok else None}
`;
  const PY_PUZZLE_TESTS = `
_PGOAL = ${pyTuple(P_GOAL)}
RESULT = {"succ": [], "solve": []}
for _b in [${P_SUCC_CASES.map(pyTuple).join(", ")}]:
    _rec = {"board": list(_b)}
    try:
        _rec["out"] = _encb(successors(_b))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    RESULT["succ"].append(_rec)
for _b in [${P_BOARDS.map((x) => pyTuple(x.board)).join(", ")}]:
    _ex = _Succ(successors)
    _rec = {"board": list(_b)}
    try:
        _rec["out"] = _encb(bfs(_b, _PGOAL, _ex))
    except BaseException as _e:
        _rec["error"] = _lab_error(_e)
    _rec["calls"] = _ex.n
    RESULT["solve"].append(_rec)
`;

  /* ---------- starters (the solutions live only in the TA cheat sheet) ---------- */
  const PATH_TO = `def path_to(state, reached):
    """Follow the parents back from state to the start."""
    path = []
    while state is not None:
        path.append(state)
        state = reached[state]
    return path[::-1]`;
  const EX = {
    expand: {
      title: "Write the neighbors function", minutes: 5, lines: 14,
      intro: `<p>A state is a cell <code>(row, col)</code>. <code>grid</code> is a list of strings, one per row; <code>"#"</code> is a wall. Complete <code>neighbors(grid, cell)</code>: return the free cells next to <code>cell</code> as tuples, in the order <b>Up, Down, Left, Right</b>. Skip walls and cells off the map.</p>
        <p>The tests call it on a small grid with no outer wall, then run a BFS with it on the maps below. Press <b>Run</b> (or Ctrl+Enter).</p>`,
      starter: `def neighbors(grid, cell):
    """The free cells next to cell, in the order Up, Down, Left, Right."""
    rows, cols = len(grid), len(grid[0])
    r, c = cell
    result = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:   # Up, Down, Left, Right
        nr, nc = r + dr, c + dc
        # TODO: skip (nr, nc) if it is off the map (rows 0 .. rows-1, columns 0 .. cols-1)
        # TODO: skip it if it is a wall: grid[nr][nc] == "#"
        # TODO: otherwise add the tuple (nr, nc) to result
    return result

print("Start:", START, " neighbors:", neighbors(grid, START))
`,
      hints: [
        "Off the map means the row is not in <code>range(rows)</code> or the column not in <code>range(cols)</code>: <code>if not (0 &lt;= nr &lt; rows and 0 &lt;= nc &lt; cols): continue</code>.",
        "Check the border <b>before</b> you read <code>grid[nr][nc]</code>. Python reads <code>grid[-1]</code> as the last row, so a missing check at row 0 does not crash: it silently wraps around to the other side of the map.",
        "Add a cell with <code>result.append((nr, nc))</code>: a tuple, so it can be a key of the <code>reached</code> dictionary.",
      ],
    },
    bfs: {
      title: "Complete breadth-first search", minutes: 6, lines: 24,
      intro: `<p>Complete the BFS from the lab. <code>expand(node)</code> is given: it returns the free neighbors of a cell, Up, Down, Left, Right. <code>reached</code> maps every reached state to its parent, and <code>path_to</code> follows the parents back to the start. Test the goal as soon as a child is <b>generated</b> (early goal test).</p>
        <p>The tests run your <code>bfs</code> on two maps and count your <b>expansions</b> (calls to <code>expand</code>): they must match the reference exactly.</p>`,
      starter: `from collections import deque

${PATH_TO}

def bfs(start, goal, expand):
    if start == goal:
        return [start]
    frontier = deque([start])
    reached = {start: None}          # state -> parent
    while frontier:
        node = None                  # TODO: take the OLDEST node out of the frontier
        for child in expand(node):   # Up, Down, Left, Right; walls skipped
            # TODO: if child is new (not in reached): record its parent,
            #       return its path if it is the goal, else add it to the frontier
            pass
    return None

# Your own experiments, for example:
# print(bfs(START, GOAL, expand))
`,
      hints: [
        "The oldest node is at the left end of the deque: <code>node = frontier.popleft()</code>.",
        "For each child: <code>if child not in reached:</code>, then <code>reached[child] = node</code>, then <code>if child == goal: return path_to(child, reached)</code>, then <code>frontier.append(child)</code>.",
        "More expansions than the reference? Test the goal right after recording the parent, not when the node comes out of the queue: that saves expanding the whole last layer.",
      ],
    },
    dfs: {
      title: "From BFS to DFS", minutes: 4, lines: 20,
      intro: `<p>Start from <b>your own BFS</b> of exercise 2: paste it below, rename it <code>dfs</code>, then turn it into depth-first search by changing what the frontier hands out: the <b>newest</b> node instead of the oldest. One line changes.</p>
        <p>The tests compare your DFS with BFS on the same maps: path length and expansions.</p>`,
      starter: `from collections import deque

${PATH_TO}

# Paste your bfs from exercise 2 below, rename it dfs,
# then change ONE line: the frontier hands out the NEWEST node.
def dfs(start, goal, expand):
    return None                      # TODO: replace with your code
`,
      hints: [
        "A deque is also a stack: <code>append</code> puts a node on the right end, and <code>pop()</code> takes it back from the right end.",
        "Optional: the lab's DFS tests the goal when a node is taken from the stack (<code>if node == goal: return path_to(node, reached)</code> right after the pop). The path is the same, the count of expansions differs a little; both versions pass.",
      ],
    },
    dls: {
      title: "Depth-limited search and iterative deepening", minutes: 8, lines: 28,
      intro: `<p>Depth-limited search is DFS that stops at depth <code>limit</code>. It keeps only the current branch (<code>path</code>, from the start to the node <code>path[-1]</code>) and skips children already on it. It returns a <b>path</b>, <code>'cutoff'</code> (the limit stopped some branch: a longer path may exist) or <code>None</code> (every branch ended before the limit: there is no path at all).</p>
        <p>Iterative deepening calls it with limit 0, 1, 2, … until the answer is not <code>'cutoff'</code>. This is tree search, exponential in the depth, so the tests use two small maps.</p>`,
      starter: `def depth_limited(path, goal, expand, limit):
    """A path to goal using at most limit more moves, 'cutoff', or None."""
    node = path[-1]
    if node == goal:
        return path
    # TODO: no moves left (limit == 0): return 'cutoff'
    cut = False
    for child in expand(node):
        if child not in path:            # no loops on this branch
            result = depth_limited(path + [child], goal, expand, limit - 1)
            # TODO: 'cutoff' -> set cut = True; a path -> return it
    # TODO: 'cutoff' if some branch was cut off, else None
    return None

def iterative_deepening(start, goal, expand):
    limit = 0
    while True:
        result = depth_limited([start], goal, expand, limit)
        # TODO: return result unless it is 'cutoff'
        limit += 1
`,
      hints: [
        "Base cases first: right after the goal test, <code>if limit == 0: return 'cutoff'</code>.",
        "In the loop: <code>if result == 'cutoff': cut = True</code>, <code>elif result is not None: return result</code>. After the loop: <code>return 'cutoff' if cut else None</code>.",
        "In <code>iterative_deepening</code>: <code>if result != 'cutoff': return result</code>. A path or None both end the search: None means no limit will ever help.",
      ],
    },
    puzzle: {
      title: "The 8-puzzle with your BFS", minutes: 7, lines: 30,
      intro: `<p>Nothing in BFS knows about maps. A board of the 8-puzzle is a <b>9-tuple</b> read row by row; <code>0</code> is the blank. Write <code>successors(board)</code>: the boards one move away, moving the blank <b>Up, Down, Left, Right</b>. Then solve <code>BOARD</code> with the same <code>bfs</code> as before, <code>successors</code> playing the role of <code>expand</code>.</p>`,
      starter: `from collections import deque

GOAL = (1, 2, 3,
        4, 5, 6,
        7, 8, 0)                 # 0 is the blank
BOARD = (1, 2, 0,
         4, 8, 3,
         7, 6, 5)                # 6 moves from GOAL

def successors(board):
    """The boards one move away: the blank moves Up, Down, Left, Right."""
    i = board.index(0)                    # where the blank is
    r, c = divmod(i, 3)
    result = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        # TODO: skip moves that leave the 3x3 board
        # TODO: j = nr * 3 + nc; copy the board into a list, swap positions i and j,
        #       and add the new board to result as a tuple
    return result

# Paste your bfs from exercise 2 here: it works for any problem (path_to is given).
${PATH_TO}

def bfs(start, goal, expand):
    return None                      # TODO: replace with your BFS

# TODO: solve BOARD with bfs (expand = successors) and print the number of moves
`,
      hints: [
        "<code>i = board.index(0)</code> finds the blank, <code>divmod(i, 3)</code> its row and column. A move is legal if <code>0 &lt;= nr &lt; 3 and 0 &lt;= nc &lt; 3</code>.",
        "Tuples cannot change: <code>b = list(board)</code>, swap with <code>b[i], b[j] = b[j], b[i]</code>, then <code>result.append(tuple(b))</code>. A list cannot be a key of <code>reached</code>; a tuple can.",
        "<code>path = bfs(BOARD, GOAL, successors)</code>; the number of moves is <code>len(path) - 1</code>.",
      ],
    },
  };
  const PARSONS_LINES = [
    "def bfs(start, goal, expand):",
    "    frontier = deque([start])",
    "    reached = {start: None}",
    "    while frontier:",
    "        node = frontier.popleft()",
    "        for child in expand(node):",
    "            if child not in reached:",
    "                reached[child] = node",
    "                if child == goal:",
    "                    return path_to(child, reached)",
    "                frontier.append(child)",
    "    return None",
  ];
  const PARSONS_DISTRACTORS = ["        node = frontier.pop()", "            if node not in reached:", "                reached[node] = child"];
  function parsonsAlternatives() {
    const L = PARSONS_LINES, out = [];
    const swapInit = [L[0], L[2], L[1], ...L.slice(3)];
    const appendFirst = (ls) => [...ls.slice(0, 8), "                frontier.append(child)", ls[8], ls[9], ls[11]];
    out.push(swapInit, appendFirst(L), appendFirst(swapInit));
    return out;
  }

  /* ---------- the map view: Lab3D when loaded, else a flat canvas ---------- */
  function flatGrid({ rows, cols, wall, height = 360 }) {
    const CS = Math.max(8, Math.floor(Math.min(900 / cols, height / rows)));
    const cv = h("canvas", { width: cols * CS, height: rows * CS, style: `width:100%;max-width:${cols * CS}px;display:block;margin:0 auto;border-radius:8px` });
    let st = {};
    const css = (c) => { if (!c) return c; const m = /^var\((--[\w-]+)\)$/.exec(c); return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : c; };
    function draw() {
      const g = cv.getContext("2d"), dark = getComputedStyle(document.documentElement).colorScheme === "dark";
      g.clearRect(0, 0, cv.width, cv.height);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const col = !wall(r, c) && st.color ? st.color(r, c) : null;
        g.fillStyle = wall(r, c) ? (dark ? "#55607a" : "#8a94a6") : col ? css(col) : dark ? "#1b2433" : "#fbfbf9";
        g.fillRect(c * CS + 0.5, r * CS + 0.5, CS - 1, CS - 1);
      }
      const mid = ([r, c]) => [c * CS + CS / 2, r * CS + CS / 2];
      if (st.path && st.path.length > 1) { g.strokeStyle = css("var(--mint-2)"); g.lineWidth = Math.max(3, CS / 3); g.lineJoin = g.lineCap = "round"; g.beginPath(); st.path.forEach((p, i) => (i ? g.lineTo(...mid(p)) : g.moveTo(...mid(p)))); g.stroke(); }
      g.textAlign = "center"; g.textBaseline = "middle"; g.font = "bold 12px system-ui, sans-serif";
      for (const [m, col, tag] of [[st.start, "#2f9e5b", "START"], [st.goal, "#d9534f", "GOAL"]]) {
        if (!m) continue;
        const [x, y] = mid([m.r, m.c]); g.fillStyle = col; g.beginPath(); g.arc(x, y, CS * 0.42, 0, 7); g.fill();
        const t = `${tag} · ${m.label}`, w = g.measureText(t).width + 10, ty = Math.max(9, y - CS - 4);
        g.fillRect(Math.min(cv.width - w, Math.max(0, x - w / 2)), ty - 9, w, 18); g.fillStyle = "#fff"; g.fillText(t, Math.min(cv.width - w / 2, Math.max(w / 2, x)), ty);
      }
    }
    const mo = new MutationObserver(draw); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return { el: h("div", {}, cv), update(s) { st = s || {}; draw(); }, destroy() { mo.disconnect(); } };
  }
  const gridView = (o) => (window.Lab3D && window.Lab3D.grid ? window.Lab3D.grid(o) : flatGrid(o));
  const C_EXP = "color-mix(in srgb, var(--lagoon) 32%, var(--panel))", C_FR = "var(--focus)", C_CUR = "var(--lagoon)";

  /* the student's run on the map, animated: expansion order, frontier, the current node, the final path.
     run: {label, m, trace, path, mode: "graph" | "tree", end (html), marks?: [[limit, index]]} */
  function mapPlayer() {
    const tabs = h("div", { class: "tabs", role: "tablist" }), stage = h("div"), info = h("div", { class: "note", style: "min-height:1.5em;margin:.3rem 0", "aria-live": "polite" });
    const scrub = h("input", { type: "range", min: 0, max: 0, value: 0, step: 1, "aria-label": "Expansions shown", style: "flex:1 1 200px" });
    const replay = h("button", { class: "ghost" }, "Replay");
    const sw = (c, t) => h("span", {}, h("i", { style: `background:${c}` }), t);
    const legend = h("div", { class: "legend" }, sw(C_CUR, "being expanded"), sw(C_FR, "frontier"), sw(C_EXP, "expanded"), sw("var(--mint-2)", "path found"));
    const el = h("div", { class: "stage hidden", style: "margin-top:.4rem" }, h("div", { class: "lc-out-title", style: "margin:0 0 .3rem" }, "Your code on the map"), tabs, stage, h("div", { class: "lc-bar", style: "margin-top:.4rem" }, replay, scrub), info, legend);
    let runs = [], cur = null, view = null, viewKey = null, F = null, raf = 0, shown = -1;
    function prep(run) {
      const tr = (run.trace || []).filter((x) => Array.isArray(x[0]) && x[0].length === 2), E = tr.length;
      const node = tr.map((x) => x[0]), reachedAt = new Map([[K(run.m.start), 0]]);
      tr.forEach(([, ks], i) => { for (const c of ks || []) if (Array.isArray(c) && c.length === 2 && !reachedAt.has(K(c))) reachedAt.set(K(c), i + 1); });
      return { E, node, reachedAt };
    }
    function iterAt(i) { let L = null; for (const [lim, at] of cur.marks || []) if (at <= Math.max(0, i - 1)) L = lim; return L; }
    function draw(i) {
      shown = i; scrub.value = String(i);
      const { E, node, reachedAt } = F, m = cur.m, tree = cur.mode === "tree";
      const count = new Map();
      for (let j = 0; j < i; j++) { const k = K(node[j]); count.set(k, (count.get(k) || 0) + 1); }
      const now = i > 0 ? K(node[i - 1]) : null;
      const color = (r, c) => { const k = r * 1000 + c; if (k === now) return C_CUR; if (count.has(k)) return C_EXP; if (!tree && reachedAt.has(k) && reachedAt.get(k) <= i) return C_FR; return null; };
      const lift = (r, c) => { const k = r * 1000 + c; if (k === now) return 0.7; if (tree) return Math.min(1.6, 0.12 * (count.get(k) || 0)); return !count.has(k) && reachedAt.has(k) && reachedAt.get(k) <= i ? 0.3 : 0; };
      view.update({ color, lift, path: i === E && cur.path ? cur.path : null, start: { r: m.start[0], c: m.start[1], label: m.startLabel }, goal: { r: m.goal[0], c: m.goal[1], label: m.goalLabel } });
      let fr = 0; if (!tree) for (const [k, at] of reachedAt) if (at <= i && !count.has(k)) fr++;
      const L = tree ? iterAt(i) : null;
      info.innerHTML = i < E || !cur.end
        ? `Expansion <b>${fmt(i)}</b> of ${fmt(E)}` + (tree ? (L !== null ? ` · limit ℓ = ${L}` : "") + " · higher tiles were expanded more often" : ` · frontier ${fmt(fr)} · reached ${fmt([...reachedAt.values()].filter((a) => a <= i).length)}`)
        : cur.end;
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    function play() {
      stop();
      const E = F.E, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || E === 0) { draw(E); return; }
      const dur = Math.max(1500, Math.min(7000, E * 25)), t0 = performance.now();
      const tick = (t) => { const i = Math.min(E, Math.floor((E * (t - t0)) / dur)); if (i !== shown) draw(i); if (i < E) raf = requestAnimationFrame(tick); else raf = 0; };
      draw(0); raf = requestAnimationFrame(tick);
    }
    function select(i) {
      cur = runs[i];
      [...tabs.children].forEach((b, j) => { b.classList.toggle("on", j === i); b.setAttribute("aria-selected", String(j === i)); });
      if (viewKey !== cur.m.key) {
        if (view && view.destroy) view.destroy();
        const m = cur.m;
        view = gridView({ rows: m.rows, cols: m.cols, wall: m.wall, height: Math.max(260, Math.min(420, m.rows * 22)) });
        stage.replaceChildren(view.el); viewKey = m.key;
      }
      F = prep(cur); scrub.max = String(F.E); shown = -1;
      play();
    }
    scrub.addEventListener("input", () => { stop(); draw(+scrub.value); });
    replay.addEventListener("click", play);
    return {
      el,
      show(list, sel = 0) {
        runs = list.filter((r) => r && r.m);
        if (!runs.length) { el.classList.add("hidden"); return; }
        el.classList.remove("hidden");
        tabs.replaceChildren(...runs.map((r, i) => h("button", { role: "tab", onclick: () => select(i) }, r.label)));
        select(Math.min(sel, runs.length - 1));
      },
    };
  }

  /* ---------- checking helpers ---------- */
  function errText(e) { const d = window.LabCode.describe(e); return esc(d.head) + (d.help ? `<br>${esc(d.help)}` : ""); }
  function said(o) {
    if (!o) return "nothing";
    if (o.kind === "none") return "<code>None</code>";
    if (o.kind === "str") return `<code>'${esc(o.value)}'</code>`;
    if (o.kind === "path") return `a path of ${plural(o.path.length - 1, "move")}`;
    return `<code>${esc(o.repr)}</code>` + (o.type ? ` (a ${esc(o.type)})` : "");
  }
  function pathIssue(m, p) {
    if (!p.length) return "the path is empty";
    if (!same(p[0], m.start)) return same(p[0], m.goal) && same(p[p.length - 1], m.start) ? "the path runs from the goal back to the start: reverse it" : `it should start at the start ${fc(m.start)}, not at ${fc(p[0])}`;
    if (!same(p[p.length - 1], m.goal)) return `it should end at the goal ${fc(m.goal)}, not at ${fc(p[p.length - 1])}`;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return `step ${i}, ${fc(a)} → ${fc(b)}, is not one move`;
      if (b[0] < 0 || b[1] < 0 || b[0] >= m.rows || b[1] >= m.cols || m.wall(b[0], b[1])) return `step ${i} enters ${fc(b)}, which is a wall or off the map`;
    }
    return null;
  }
  const cmp = (yours, ref) => `Yours: <b>${yours}</b>. Reference: ${ref}.`;
  const runText = (moves, calls) => (moves === null ? "no path" : plural(moves, "move")) + `, ${plural(calls, "expansion")}`;
  /* one search run against the reference. accept: expansion counts that pass; why(calls): the explanation when the count does not match */
  function judge(m, rec, ref, { fn, accept, why }) {
    const reach = !!ref.path;
    const name = reach ? `${m.name}: ${m.startLabel} to ${m.goalLabel}, a shortest path` : `${m.name}: ${m.goalLabel} cannot be reached, so ${fn} returns None`;
    const refTxt = runText(ref.moves, ref.calls);
    if (!rec) return { name, ok: false, detail: "Not run." };
    if (rec.error) return { name, ok: false, detail: errText(rec.error) + `<br>Reference: ${refTxt}.` };
    const o = rec.out;
    let path = null, problem = null;
    if (reach) {
      if (!o || o.kind !== "path") problem = `<code>${fn}</code> returned ${said(o)}; it should return the list of states from start to goal, (row, col) tuples.`;
      else {
        const issue = pathIssue(m, o.path);
        if (issue) problem = `The path is not valid: ${esc(issue)}.`;
        else { path = o.path; if (path.length - 1 !== ref.moves) problem = `Your path has ${plural(path.length - 1, "move")}, but ${fn === "dfs" ? "DFS (newest node first) finds one of" : "the shortest has"} ${ref.moves}.`; }
      }
    } else if (!o || o.kind !== "none") problem = `<code>${fn}</code> returned ${said(o)}. When the goal cannot be reached, the frontier runs empty and the search returns <code>None</code>.`;
    const moves = o && o.kind === "path" ? o.path.length - 1 : null;
    const counts = cmp(runText(moves, rec.calls), refTxt);
    if (problem) return { name, ok: false, detail: `${problem} ${counts}`, path };
    if (!accept.includes(rec.calls)) return { name, ok: false, detail: `${counts} ${why(rec.calls, reach)}`, path };
    return { name, ok: true, detail: counts, path };
  }
  const bfsWhy = (calls, reach, ref) => (reach && calls > ref
    ? "Same path, but more expansions: test the goal as soon as a child is generated (early goal test), not when it comes out of the queue."
    : "The count of expansions differs: is every state added to the frontier only once (<code>if child not in reached</code>), and are the nodes taken oldest first?");
  function explainCommon(e) {
    if (/unhashable type: 'list'/.test(e.message)) return "States must be tuples such as (3, 4): a list cannot be a key of the reached dictionary (or of a set).";
    if (e.type === "NameError") { const n = /name '(\w+)'/.exec(e.message); if (n && ["bfs", "dfs", "neighbors", "depth_limited", "iterative_deepening", "successors", "path_to", "deque"].includes(n[1])) return n[1] === "deque" ? "Add 'from collections import deque' at the top." : `Your code must define ${n[1]}(…) with this exact name.`; }
    if (/expand\(\) takes a state/.test(e.message)) return "expand(node) needs a cell (row, col) taken out of the frontier.";
    return "";
  }

  /* ---------- the exercises ---------- */
  function mapExercise(kind, maps) {
    const spec = EX[kind], player = mapPlayer(), table = h("div", { class: "wide" });
    const after = h("div", {}, table, player.el);
    const fn = kind === "expand" ? "bfs" : kind;
    const parts = (src) => [{ name: "<lab>", code: PY_MAPS(maps) }, { name: window.LabCode.USER_FILE, code: src, user: true }, { name: "<tests>", code: kind === "expand" ? PY_EXPAND_TESTS : PY_RUN_ALL(fn) }];
    const refs = maps.map((m) => (kind === "dfs" ? { pop: refSearch(m, "dfs"), gen: refSearch(m, "dfsgen"), bfs: m.bfs } : { bfs: m.bfs }));
    function check(R) {
      const tests = [], runs = [];
      if (kind === "expand") {
        const tm = { rows: TINY.length, cols: TINY[0].length, wall: (r, c) => TINY[r][c] === "#" };
        let first = null;
        for (const u of R.unit || []) {
          const want = nbrs(tm, u.cell), call = `neighbors(TINY, ${fc(u.cell)})`;
          if (u.error) { first = `${call}: ${errText(u.error)}` + (u.error.type === "IndexError" ? "<br>Check that the cell is on the map <b>before</b> reading grid[nr][nc]." : ""); break; }
          const o = u.out;
          if (!o || o.kind !== "list") { first = `${call} returned ${o && o.kind === "none" ? "<code>None</code>: is <code>return result</code> missing?" : `<code>${esc(o ? o.repr : "?")}</code>, not a list`}.`; break; }
          const got = o.cells, ok = got.length === want.length && got.every((c, i) => same(c, want[i]));
          if (!ok) {
            const wrap = got.some((c) => c && (c[0] < 0 || c[1] < 0 || c[0] >= TINY.length || c[1] >= TINY[0].length || Math.abs(c[0] - u.cell[0]) + Math.abs(c[1] - u.cell[1]) > 1));
            const sameSet = got.length === want.length && want.every((w) => got.some((c) => same(c, w)));
            first = `<code>${call}</code> returned <code>${esc(o.repr)}</code>; expected <code>[${want.map(fc).join(", ")}]</code>. `
              + (wrap ? "Some of these cells are off the map. Python accepts <code>grid[-1]</code> (it is the last row), so a missing border check does not crash: check <code>0 &lt;= nr &lt; rows and 0 &lt;= nc &lt; cols</code> before reading <code>grid[nr][nc]</code>."
                : sameSet ? "The right cells in the wrong order: Up, Down, Left, Right." : got.length > want.length ? "It includes a wall or a cell off the map." : "A free neighbor is missing.");
            break;
          }
          if (!o.tuples) { first = `<code>${call}</code> returned <code>${esc(o.repr)}</code>: the cells must be tuples <code>(r, c)</code>, not lists.`; break; }
        }
        const gridHtml = `<pre class="lc-code" style="display:inline-block;margin:.3rem 0;padding:.3rem .6rem">TINY = ${esc(JSON.stringify(TINY))}\n${TINY.map((r, i) => `  row ${i}: ${r}`).join("\n")}</pre>`;
        tests.push({ name: "neighbors on a small grid: order, border, walls", ok: !first, detail: first ? first + "<br>" + gridHtml : `All ${TINY_CASES.length} cells right, including (0, 0) in a corner and (2, 3) on the edge.` });
      }
      maps.forEach((m, i) => {
        const rec = (R.runs || []).find((x) => x.map === m.key), ref = refs[i];
        let t;
        if (kind === "dfs") {
          t = judge(m, rec, rec && rec.calls === ref.gen.calls ? ref.gen : ref.pop, { fn, accept: [ref.pop.calls, ref.gen.calls], why: () => `The count of expansions differs from DFS (${ref.gen.calls} if the goal is tested when generated, ${ref.pop.calls} if tested when popped): take the newest node (<code>frontier.pop()</code>) and add every state only once.` });
          if (!t.ok && rec && rec.out && rec.out.kind === "path" && ref.bfs.path && rec.out.path.length - 1 === ref.bfs.moves && ref.bfs.moves !== ref.pop.moves) t.detail = `That is the BFS path (${ref.bfs.moves} moves). DFS takes the newest node: <code>frontier.pop()</code>. ` + t.detail;
          if (ref.pop.path) t.name = `${m.name}: ${m.startLabel} to ${m.goalLabel}, the DFS path`;
          else t.name = `${m.name}: ${m.goalLabel} cannot be reached, so dfs returns None`;
          if (t.ok && ref.pop.path && t.path && t.path.length - 1 !== ref.pop.moves) t.ok = false;
          if (ref.pop.path && rec && rec.out && rec.out.kind === "path" && !pathIssue(m, rec.out.path) && rec.out.path.length - 1 === ref.pop.moves && accepted(rec.calls, ref)) { t.ok = true; t.path = rec.out.path; }
        } else t = judge(m, rec, ref.bfs, { fn, accept: [ref.bfs.calls], why: (c, reach) => bfsWhy(c, reach, ref.bfs.calls) });
        tests.push(t);
        if (rec && rec.trace) {
          const moves = t.path ? t.path.length - 1 : null;
          runs.push({ label: (kind === "dfs" ? "Your DFS · " : kind === "expand" ? "BFS with your neighbors · " : "Your BFS · ") + m.name, m, trace: rec.trace, path: t.path || null, mode: "graph",
            end: rec.error ? "Stopped by an error." : moves !== null ? `Path found: <b>${moves} moves</b> after ${plural(rec.calls, "expansion")}.` : rec.out && rec.out.kind === "none" ? `No path: the frontier ran empty after ${plural(rec.calls, "expansion")}.` : `Returned ${said(rec.out)}.` });
          if (kind === "dfs") runs.push({ label: "BFS (reference) · " + m.name, m, trace: ref.bfs.trace, path: ref.bfs.path, mode: "graph", end: ref.bfs.path ? `BFS: <b>${ref.bfs.moves} moves</b> after ${plural(ref.bfs.calls, "expansion")}.` : `BFS: no path after ${plural(ref.bfs.calls, "expansion")}.` });
        }
      });
      if (kind === "dfs") table.replaceChildren(dfsTable(R));
      player.show(runs);
      const passed = tests.every((t) => t.ok);
      let summary = null;
      if (passed && kind === "dfs") {
        const m = maps.find((x) => x.bfs.path), i = maps.indexOf(m);
        if (m) summary = `On ${esc(m.name)} DFS finds a path of <b>${refs[i].pop.moves}</b> moves, BFS one of <b>${m.bfs.moves}</b>: DFS keeps the first branch that happens to reach the goal. The lab's DFS tests the goal when a node is popped (${plural(refs[i].pop.calls, "expansion")}); testing it when generated gives the same path after ${plural(refs[i].gen.calls, "expansion")}.`;
      } else if (passed) summary = kind === "expand" ? "Your neighbors function defines the graph: BFS on top of it finds exactly the lab's numbers." : "Your BFS matches the reference move for move: same path length, same number of expansions.";
      return { tests, passed, summary };
    }
    const accepted = (calls, ref) => calls === ref.pop.calls || calls === ref.gen.calls;
    function dfsTable(R) {
      const row = (label, m, moves, calls, trace, start, strong) => h("tr", {}, h("td", {}, strong ? h("b", {}, label) : label), h("td", {}, m.name), h("td", {}, moves === null ? "no" : "yes"), h("td", {}, moves === null ? "–" : fmt(moves)), h("td", {}, fmt(calls)), h("td", {}, trace ? fmt(stats(trace, start).maxFrontier) : "–"));
      const rows = [];
      maps.forEach((m, i) => {
        const rec = (R.runs || []).find((x) => x.map === m.key), ref = refs[i];
        rows.push(row("BFS (reference)", m, ref.bfs.moves, ref.bfs.calls, ref.bfs.trace, m.start));
        if (rec && !rec.error) rows.push(row("Your DFS", m, rec.out && rec.out.kind === "path" ? rec.out.path.length - 1 : null, rec.calls, rec.trace, m.start, true));
        else rows.push(h("tr", {}, h("td", {}, h("b", {}, "Your DFS")), h("td", {}, m.name), h("td", { colspan: "4" }, "stopped by an error")));
      });
      return h("table", { class: "compare" }, h("tr", {}, ...["Search", "Map", "Path?", "Moves", "Expansions", "Max frontier"].map((x) => h("th", {}, x))), ...rows);
    }
    return window.LabCode.exercise({ id: "L2:" + kind, title: spec.title, minutes: spec.minutes, intro: spec.intro, starter: spec.starter, hints: spec.hints, lines: spec.lines, parts, check, explain: explainCommon, after });
  }

  function dlsExercise(small) {
    const spec = EX.dls, player = mapPlayer(), table = h("div", { class: "wide" });
    const [A, B] = small.length > 1 ? [small.find((m) => m.bfs.path) || small[0], small.find((m) => !m.bfs.path) || small[1]] : [small[0], small[0]];
    const refIdsOf = new Map(small.map((m) => [m.key, refIds(m)]));
    const cases = [];
    if (A.bfs.path) cases.push([A.key, Math.max(0, A.bfs.moves - 1)], [A.key, A.bfs.moves]);
    if (B !== A) { const stopL = refIdsOf.get(B.key).iters.slice(-1)[0][0]; cases.push([B.key, Math.min(2, Math.max(0, stopL - 1))], [B.key, stopL]); }
    const refCase = ([key, L]) => { const m = small.find((x) => x.key === key), tr = []; const r = refDls(m, [m.start], L, tr); return { result: r, calls: tr.length }; };
    const parts = (src) => [{ name: "<lab>", code: PY_MAPS(small) }, { name: window.LabCode.USER_FILE, code: src, user: true }, { name: "<tests>", code: PY_DLS_TESTS(cases) }];
    const want = (r) => (r === "cutoff" ? "<code>'cutoff'</code>" : r === null ? "<code>None</code>" : `a path of ${plural(r.length - 1, "move")}`);
    function matches(o, r, m) {
      if (!o) return false;
      if (r === "cutoff") return o.kind === "str" && o.value === "cutoff";
      if (r === null) return o.kind === "none";
      return o.kind === "path" && !pathIssue(m, o.path) && o.path.length === r.length;
    }
    function check(R) {
      const tests = [], runs = [];
      for (const m of small.filter((x, i, a) => a.indexOf(x) === i && cases.some((c) => c[0] === x.key))) {
        let ok = true; const lines = [];
        cases.forEach((c, i) => {
          if (c[0] !== m.key) return;
          const rec = (R.dls || [])[i], ref = refCase(c);
          if (!rec) { ok = false; return; }
          if (rec.error) { ok = false; lines.push(`limit ${c[1]}: ${errText(rec.error)}`); return; }
          const good = matches(rec.out, ref.result, m);
          ok = ok && good;
          lines.push(`limit ${c[1]}: returned ${said(rec.out)}${good ? " ✔" : `, expected ${want(ref.result)}`} · ${plural(rec.calls, "expansion")} (reference ${fmt(ref.calls)})`);
          if (rec.trace && rec.trace.length) runs.push({ label: `depth_limited, ℓ = ${c[1]} · ${m.name}`, m, trace: rec.trace, mode: "tree", path: rec.out && rec.out.kind === "path" && !pathIssue(m, rec.out.path) ? rec.out.path : null, end: `ℓ = ${c[1]}: returned ${said(rec.out)} after ${plural(rec.calls, "expansion")}.` });
        });
        const cut = ok ? "" : m.bfs.path ? "<br>Below the true distance the answer is 'cutoff' (a longer path may exist); at the distance, the path." : "<br>With a small limit some branch is cut off: 'cutoff'. With a limit no branch reaches, every branch ends at a dead end: None, a proof that there is no path.";
        tests.push({ name: `depth_limited on ${m.name}: ${m.bfs.path ? "'cutoff', then the path" : "'cutoff', then None"}`, ok, detail: lines.join("<br>") + cut });
      }
      let ok = true; const lines = [], iterRows = [];
      small.forEach((m, i) => {
        const rec = (R.ids || [])[i], ref = refIdsOf.get(m.key);
        if (!rec) { ok = false; return; }
        if (rec.error) { ok = false; lines.push(`${esc(m.name)}: ${errText(rec.error)}`); }
        else {
          const good = matches(rec.out, ref.result, m);
          ok = ok && good;
          const lims = (rec.iters || []).map((x) => x[0]);
          lines.push(`${esc(m.name)}: returned ${said(rec.out)}${good ? " ✔" : `, expected ${want(ref.result)}`} after limits ${lims.length ? `${lims[0]} to ${lims[lims.length - 1]}` : "?"} · ${plural(rec.calls, "expansion")} in total (reference ${fmt(ref.calls)})`);
        }
        const its = rec.iters || [];
        its.forEach(([L, at], j) => { const end = j + 1 < its.length ? its[j + 1][1] : rec.calls; const rj = ref.iters.findIndex((x) => x[0] === L); const rEnd = rj < 0 ? null : rj + 1 < ref.iters.length ? ref.iters[rj + 1][1] : ref.calls; iterRows.push(h("tr", {}, h("td", {}, m.name), h("td", {}, String(L)), h("td", {}, fmt(end - at)), h("td", {}, rEnd === null ? "–" : fmt(rEnd - ref.iters[rj][1])))); });
        if (rec.trace && rec.trace.length) runs.unshift({ label: `Iterative deepening · ${m.name}`, m, trace: rec.trace, mode: "tree", marks: (rec.iters || []).map(([L, at]) => [L, at]), path: rec.out && rec.out.kind === "path" && !pathIssue(m, rec.out.path) ? rec.out.path : null, end: `Iterative deepening returned ${said(rec.out)} after ${plural(rec.calls, "expansion")} (all limits together).` });
      });
      tests.push({ name: "iterative_deepening: the shortest path, or None when there is none", ok, detail: lines.join("<br>") });
      table.replaceChildren(iterRows.length ? h("table", { class: "compare" }, h("tr", {}, ...["Map", "Limit ℓ", "Your expansions", "Reference"].map((x) => h("th", {}, x))), ...iterRows) : "");
      player.show(runs);
      const passed = tests.every((t) => t.ok);
      const ra = refIdsOf.get(A.key);
      return { tests, passed, summary: passed ? `Iterative deepening finds the ${A.bfs.moves}-move path with ${plural(ra.calls, "expansion")} over ${ra.iters.length} limits; BFS needs ${A.bfs.calls}. It repeats the shallow levels, but keeps only one branch in memory.` : null };
    }
    const explain = (e) => (e.type === "RecursionError" ? "depth_limited never stops calling itself: return 'cutoff' when limit == 0." : explainCommon(e));
    return window.LabCode.exercise({ id: "L2:dls", title: spec.title, minutes: spec.minutes, intro: spec.intro, starter: spec.starter, hints: spec.hints, lines: spec.lines, parts, check, explain, after: h("div", {}, table, player.el) });
  }

  function boardEl(b, moved = -1) {
    const g = h("div", { style: "display:grid;grid-template-columns:repeat(3,1.6em);gap:2px;font-weight:700;font-variant-numeric:tabular-nums" });
    b.forEach((x, i) => g.append(h("div", { style: `height:1.6em;display:flex;align-items:center;justify-content:center;border-radius:4px;${x ? `background:${i === moved ? "var(--mint-2)" : "var(--sand)"};color:${i === moved ? "#fff" : "var(--ink)"}` : "background:var(--paper);border:1px dashed var(--line)"}` }, x ? String(x) : "")));
    return g;
  }
  const bStr = (b) => `(${b.join(", ")})`;
  function puzzleExercise() {
    const spec = EX.puzzle, strip = h("div", { style: "display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:.4rem 0" }), vizBox = h("div", { class: "stage hidden" }, h("div", { class: "lc-out-title", style: "margin:0 0 .3rem" }, "Your solution of BOARD, move by move"), strip);
    const refs = P_BOARDS.map((x) => pBfs(x.board));
    const parts = (src) => [{ name: "<lab>", code: PY_PUZZLE_PRE }, { name: window.LabCode.USER_FILE, code: src, user: true }, { name: "<tests>", code: PY_PUZZLE_TESTS }];
    function check(R) {
      const tests = [];
      let first = null;
      (R.succ || []).forEach((u, i) => {
        if (first) return;
        const b = P_SUCC_CASES[i], want = pSucc(b), call = `successors(${bStr(b)})`;
        if (u.error) { first = `<code>${call}</code>: ${errText(u.error)}`; return; }
        const o = u.out;
        if (!o || o.kind !== "boards") { first = `<code>${call}</code> returned ${o && o.kind === "none" ? "<code>None</code>: is <code>return result</code> missing?" : `<code>${esc(o ? o.repr : "?")}</code>: expected a list of 9-tuples`}.`; return; }
        const ok = o.boards.length === want.length && o.boards.every((x, k) => pKey(x) === pKey(want[k]));
        if (!ok) { first = `<code>${call}</code> returned <code>${esc(o.repr)}</code>; expected <code>[${want.map(bStr).join(", ")}]</code> (blank Up, Down, Left, Right${want.length < 4 ? `; only ${want.length} moves stay on the board` : ""}).`; return; }
        if (!o.tuples) first = `<code>${call}</code>: the boards must be tuples (<code>tuple(b)</code>), not lists.`;
      });
      tests.push({ name: "successors: blank in a corner, on an edge, in the center", ok: !first, detail: first || "2, 3 and 4 successors, in the order Up, Down, Left, Right." });
      let shownPath = null;
      (R.solve || []).forEach((rec, i) => {
        const ref = refs[i], name = `bfs solves ${P_BOARDS[i].name}`;
        if (!rec) return;
        if (rec.error) { tests.push({ name, ok: false, detail: errText(rec.error) }); return; }
        const o = rec.out;
        let problem = null;
        if (!o || o.kind !== "boards" || !o.boards.length) problem = `bfs returned ${o && o.kind === "none" ? "<code>None</code>" : `<code>${esc(o ? o.repr : "?")}</code>`}; expected the list of boards from BOARD to GOAL.`;
        else {
          const p = o.boards;
          if (pKey(p[0]) !== pKey(P_BOARDS[i].board) || pKey(p[p.length - 1]) !== pKey(P_GOAL)) problem = "The path should run from the board to GOAL.";
          else for (let k = 1; k < p.length && !problem; k++) if (!pSucc(p[k - 1]).some((x) => pKey(x) === pKey(p[k]))) problem = `Move ${k} is not one slide of a tile.`;
          if (!problem && p.length - 1 !== ref.moves) problem = `${p.length - 1} moves, but the shortest solution has ${ref.moves}.`;
          if (!problem && i === 0) shownPath = p;
        }
        const counts = cmp(`${o && o.boards ? plural(o.boards.length - 1, "move") : "no solution"}, ${plural(rec.calls, "expansion")}`, `${ref.moves} moves, ${plural(ref.calls, "expansion")}`);
        tests.push({ name, ok: !problem, detail: (problem ? problem + " " : "") + counts });
      });
      if (shownPath) {
        vizBox.classList.remove("hidden");
        strip.replaceChildren();
        shownPath.forEach((b, k) => {
          const moved = k ? shownPath[k - 1].indexOf(0) : -1;
          if (k) strip.append(h("span", { "aria-hidden": "true", style: "color:var(--muted)" }, "→"));
          strip.append(h("div", { style: "display:flex;flex-direction:column;align-items:center;gap:.2rem" }, boardEl(b, moved), h("span", { class: "note" }, k ? `move ${k}` : "BOARD")));
        });
      } else vizBox.classList.add("hidden");
      const passed = tests.every((t) => t.ok);
      return { tests, passed, summary: passed ? `The same bfs that searched the campus solves the puzzle. Six moves cost ${fmt(refs[0].calls)} expansions, twelve cost ${fmt(refs[1].calls)}: the work grows like b<sup>d</sup>.` : null };
    }
    const explain = (e) => (/unhashable type: 'list'/.test(e.message) ? "Boards must be tuples: tuple(b). A list cannot be a key of the reached dictionary." : explainCommon(e));
    return window.LabCode.exercise({ id: "L2:puzzle", title: spec.title, minutes: spec.minutes, intro: spec.intro, starter: spec.starter, hints: spec.hints, lines: spec.lines, parts, check, explain, after: vizBox, timeout: 15000 });
  }

  function parsonsExercise(maps) {
    const player = mapPlayer(), tests = h("div", { class: "lc-tests" }), out = window.LabCode.output();
    const refs = maps.map((m) => m.bfs);
    const runBtn = h("button", { disabled: true, title: "Put every line in place first", onclick: () => go() }, "Run it on the maps ▶");
    const status = h("div", { class: "lc-status", role: "status" });
    const pz = window.LabCode.parsons({
      lines: PARSONS_LINES, distractors: PARSONS_DISTRACTORS, alternatives: parsonsAlternatives(), seed: 7,
      hints: ["The loop body starts by taking a node out of the frontier. BFS takes the <b>oldest</b> node.", "A child is recorded in <code>reached</code> before the goal test, so that <code>path_to</code> can follow its parent.", "<code>return None</code> belongs to the function, after the loop: one level of indentation."],
      onSolved: () => { runBtn.disabled = false; runBtn.title = ""; },
    });
    async function go() {
      runBtn.disabled = true; out.clear();
      const src = "from collections import deque\n\n" + PATH_TO + "\n\n" + pz.code() + "\n";
      const res = await window.LabCode.python().run([{ name: "<lab>", code: PY_MAPS(maps) }, { name: window.LabCode.USER_FILE, code: src, user: true }, { name: "<tests>", code: PY_RUN_ALL("bfs") }], { onOut: (t, s) => out.print(t, s), onStatus: (s) => { status.textContent = s; } });
      runBtn.disabled = false;
      if (res.loadError) { status.replaceChildren(h("div", { class: "callout edge" }, res.loadError)); return; }
      if (!res.ok) { tests.replaceChildren(h("div", { class: "callout edge" }, res.timedOut ? "Stopped: the code ran too long." : errText(res.error || { type: "Error", message: res.fatal || "?" }))); return; }
      const ts = [], runs = [];
      maps.forEach((m, i) => {
        const rec = res.result.runs.find((x) => x.map === m.key), t = judge(m, rec, refs[i], { fn: "bfs", accept: [refs[i].calls], why: (c, reach) => bfsWhy(c, reach, refs[i].calls) });
        ts.push(t);
        if (rec) runs.push({ label: "Your BFS · " + m.name, m, trace: rec.trace, path: t.path || null, mode: "graph", end: t.path ? `Path found: <b>${t.path.length - 1} moves</b> after ${plural(rec.calls, "expansion")}.` : `No path: the frontier ran empty after ${plural(rec.calls, "expansion")}.` });
      });
      tests.replaceChildren(...ts.map((t) => h("div", { class: "lc-test" + (t.ok ? " ok" : "") }, h("div", { class: "t" }, h("i", {}, t.ok ? "✔" : "✘"), t.name), h("div", { class: "d", html: t.detail }))));
      player.show(runs);
    }
    return h("div", { class: "lc-ex" },
      h("div", { class: "lc-head" }, h("b", {}, "Put BFS in order"), h("span", { class: "badge" }, "about 4 min")),
      h("div", { class: "lc-intro", html: "<p>Drag the lines of breadth-first search into the right order and indent them (drag sideways, or use ← →). Three lines do not belong. Then run your BFS on the maps.</p>" }),
      pz.el, h("div", { class: "lc-bar" }, runBtn), status, tests, out.el, player.el);
  }

  function mount(kind, ctx = {}) {
    const maps = norm(ctx.maps, ctx.defaultMap);
    if (kind === "expand" || kind === "bfs" || kind === "dfs") return mapExercise(kind, maps).el;
    if (kind === "dls") return dlsExercise(norm(ctx.smallMaps || SMALL())).el;
    if (kind === "parsons") return parsonsExercise(maps);
    if (kind === "puzzle") return puzzleExercise().el;
    throw new Error("Lab2Code.mount: unknown kind " + kind);
  }

  window.Lab2Code = { mount, ref: { nbrs, refSearch, refDls, refIds, stats, pSucc, pBfs, norm, SMALL, P_BOARDS, EX, PARSONS_LINES } };
})();
