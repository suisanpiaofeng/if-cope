// 知识地图图数据层验证（计划 T1：QaMapEdge 迁移/去重/祖先并集/防环/edgeId）
// 运行：node scripts/verify-qa-map-graph.mjs
import assert from "node:assert/strict";
import {
  edgeId,
  normalizeQaMap,
  ancestorChain,
  hasCycle,
  nextNodePosition,
  autoLayout,
} from "../src/lib/qaMapTypes.ts";

const node = (id, extra = {}) => ({
  id,
  round: 1,
  title: `卡${id}`,
  question: `问${id}？`,
  answer: `答${id}`,
  x: 100,
  y: 100,
  ...extra,
});

// 1. 旧格式迁移：parentId → 边；标注从 relParentEnd/relChildEnd 搬到 relFrom/relTo；节点无 parentId；往返幂等
{
  const old = {
    title: "旧图",
    nodes: [
      node("a", { parentId: null }),
      node("b", { parentId: "a", relParentEnd: "深入", relChildEnd: "依据", relation: "追问" }),
    ],
  };
  const out = normalizeQaMap(old);
  assert.ok(out, "旧图应能导入");
  assert.equal(out.nodes.length, 2);
  assert.ok(!("parentId" in out.nodes[0]) || out.nodes[0].parentId === undefined, "迁移后节点不应再有 parentId");
  assert.equal(out.edges.length, 1, "应生成 1 条边");
  const e = out.edges[0];
  assert.equal(e.from, "a");
  assert.equal(e.to, "b");
  assert.equal(e.relFrom, "深入", "relParentEnd → relFrom");
  assert.equal(e.relTo, "依据", "relChildEnd → relTo");
  assert.equal(e.id, edgeId("a", "b"));
  // 幂等：导出再导入边数不变
  const round = normalizeQaMap(JSON.parse(JSON.stringify(out)));
  assert.equal(round.edges.length, 1, "往返导入应幂等");
  assert.deepEqual(round.edges, out.edges);
}

// 2. 新格式校验：同向去重、反向保留、悬空边丢弃
{
  const ok = normalizeQaMap({
    title: "新图",
    nodes: [node("a"), node("b")],
    edges: [
      { id: "a->b", from: "a", to: "b" },
      { id: "a->b", from: "a", to: "b" },
      { id: "b->a", from: "b", to: "a" },
      { id: "a->missing", from: "a", to: "missing" },
    ],
  });
  assert.equal(ok.edges.length, 2, "同向去重 + 悬空丢弃，应剩 2 条");
  const keys = ok.edges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(keys, ["a->b", "b->a"]);
}

// 3. ancestorChain 菱形：a→b,a→c,b→d,c→d，d 的祖先 = [a,b,c]（去重含共同祖先一次）
{
  const nodes = [node("a"), node("b"), node("c"), node("d")];
  const edges = [
    { id: "a->b", from: "a", to: "b" },
    { id: "a->c", from: "a", to: "c" },
    { id: "b->d", from: "b", to: "d" },
    { id: "c->d", from: "c", to: "d" },
  ];
  const chain = ancestorChain(nodes, edges, "d");
  assert.deepEqual(chain.map((n) => n.id).sort(), ["a", "b", "c"], "菱形祖先应为 {a,b,c} 无重复");
}

// 4. ancestorChain 上限 8：12 条链式节点 → 取最近 8 个祖先（不含自身）
{
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 13; i++) {
    nodes.push(node(`n${i}`, { round: i + 1 }));
    if (i > 0) edges.push({ id: `n${i - 1}->n${i}`, from: `n${i - 1}`, to: `n${i}` });
  }
  const chain = ancestorChain(nodes, edges, "n12");
  assert.equal(chain.length, 8, "上限 8 条");
  assert.equal(chain[chain.length - 1].id, "n11", "最近祖先在尾部");
  assert.ok(!chain.some((n) => n.id === "n12"), "不应含自身");
}

// 5. hasCycle：a→b,b→c 时 c→a 成环 true；a→c 不成环 false
{
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    { id: "a->b", from: "a", to: "b" },
    { id: "b->c", from: "b", to: "c" },
  ];
  assert.equal(hasCycle(nodes, edges, "c", "a"), true, "c→a 应成环");
  assert.equal(hasCycle(nodes, edges, "a", "c"), false, "a→c 不应成环");
}

// 6. edgeId 格式；nextNodePosition 有源时 x > 源卡右缘
{
  assert.equal(edgeId("x", "y"), "x->y");
  const nodes = [node("p", { x: 100, w: 340 })];
  const pos = nextNodePosition(nodes, [], "p");
  assert.ok(pos.x > 100 + 340, "新卡应在源卡右侧（x > 右缘）");
}

console.log("verify-qa-map-graph: all pass");

// 7. autoLayout：菱形分层 [a][b,c][d]；同层按原 y 保序；入参不改
{
  const nodes = [
    { id: "d", round: 3, title: "d", question: "q", answer: "a", x: 999, y: 500, w: 340, h: 280 },
    { id: "c", round: 2, title: "c", question: "q", answer: "a", x: 500, y: 100, w: 340, h: 280 },
    { id: "b", round: 2, title: "b", question: "q", answer: "a", x: 500, y: 50, w: 340, h: 280 },
    { id: "a", round: 1, title: "a", question: "q", answer: "a", x: 0, y: 0, w: 340, h: 280 },
  ];
  const edges = [
    { id: "a->b", from: "a", to: "b" },
    { id: "a->c", from: "a", to: "c" },
    { id: "b->d", from: "b", to: "d" },
    { id: "c->d", from: "c", to: "d" },
  ];
  const snapshot = JSON.stringify(nodes);
  const out = autoLayout(nodes, edges);
  assert.equal(JSON.stringify(nodes), snapshot, "autoLayout 不应改入参");
  const x = (id) => out.find((n) => n.id === id).x;
  assert.ok(x("a") < x("b") && x("a") < x("c") && x("b") < x("d"), "菱形应分层：a 最左 d 最右");
  assert.equal(x("b"), x("c"), "b/c 同层 x 相同");
  const y = (id) => out.find((n) => n.id === id).y;
  assert.ok(y("b") < y("c"), "同层按原 y 保序（b 原 y=50 在 c 前）");
}
console.log("verify-qa-map-graph: layout done");
