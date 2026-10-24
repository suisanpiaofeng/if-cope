"use client";

/** SQL 格式化：关键字大写 + 换行缩进（轻量实现，覆盖常见子句） */
import { useState } from "react";
import { Actions, Area, Btn, CopyBtn, Out } from "./_ui";

const KEYWORDS = [
  "select", "from", "where", "and", "or", "not", "insert into", "values", "update", "set",
  "delete", "create table", "drop table", "alter table", "add column", "primary key", "foreign key",
  "join", "left join", "right join", "inner join", "outer join", "on", "group by", "order by",
  "having", "limit", "offset", "as", "distinct", "count", "sum", "avg", "min", "max",
  "between", "in", "like", "is null", "is not null", "union", "all", "exists", "case", "when",
  "then", "else", "end", "asc", "desc", "with", "into",
];

const BREAK_BEFORE = [
  "select", "from", "where", "and", "or", "insert into", "values", "update", "set", "delete",
  "join", "left join", "right join", "inner join", "outer join", "group by", "order by",
  "having", "limit", "offset", "union", "on",
];

function formatSql(sql: string, upper: boolean): string {
  let s = sql.replace(/\s+/g, " ").trim();
  if (!s) return "";
  // 保护字符串字面量，避免被改写
  const literals: string[] = [];
  s = s.replace(/'([^']*)'/g, (_, p1) => { literals.push(p1); return `__STR${literals.length - 1}__`; });

  // 关键词前后加换行
  const sorted = [...KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    const re = new RegExp(`\\b${kw.replace(/ /g, "\\s+")}\\b`, "gi");
    s = s.replace(re, (m) => {
      const token = upper ? m.toUpperCase() : m.toLowerCase();
      return BREAK_BEFORE.includes(kw.toLowerCase()) ? `\n${token} ` : ` ${token} `;
    });
  }
  // 逗号后换行
  s = s.replace(/,\s*/g, ",\n  ");
  // 压缩多余空白并按行缩进
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  let indent = 0;
  const out: string[] = [];
  for (let line of lines) {
    if (/^(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|VALUES|SET|UNION)/i.test(line) && out.length) indent = 0;
    out.push("  ".repeat(indent) + line);
    if (/^(SELECT|INSERT INTO|UPDATE|DELETE|CREATE TABLE|WITH)/i.test(line)) indent = 1;
  }
  s = out.join("\n");
  // 还原字符串
  s = s.replace(/__STR(\d+)__/g, (_, i) => `'${literals[Number(i)]}'`);
  return s;
}

export default function SqlFormatter() {
  const [input, setInput] = useState("select u.id,u.name,count(o.id) as total from users u left join orders o on o.user_id=u.id where u.status='active' and o.created_at>='2026-01-01' group by u.id,u.name order by total desc limit 10");
  const [upper, setUpper] = useState(true);
  const [output, setOutput] = useState("");

  return (
    <div className="max-w-[720px]">
      <Actions>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          <input type="checkbox" checked={upper} onChange={() => setUpper((v) => !v)} /> 关键字大写
        </label>
        <Btn onClick={() => setOutput(formatSql(input, upper))}>格式化</Btn>
        <Btn onClick={() => { setInput(""); setOutput(""); }}>清空</Btn>
        <CopyBtn text={output} />
      </Actions>
      <Area value={input} onChange={setInput} rows={6} mono placeholder="粘贴一段 SQL" />
      <div className="mt-3"><Out label="格式化结果" value={output} /></div>
    </div>
  );
}
