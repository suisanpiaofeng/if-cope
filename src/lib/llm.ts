import { getSettings, isModelConfigured, recordUsage } from "./db";
import { estimateTokens } from "./embed";
import { modelEndpoint, modelHeaders } from "./modelGateway";
import { buildSystemPrompt } from "./agent/system";
import { TOOLS, type ToolCall } from "./agent/tools";
import { runTool } from "./agent/executor";
import { getTodos, type TodoItem } from "./agent/todo";
import { LoopGuard } from "./agent/loopGuards";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** 工具活动事件（推给前端展示"AI 正在操作应用"） */
export type ToolEvent = {
  callId?: string; // 调用唯一 ID（route.ts 手工事件可缺省）
  name: string;
  phase: "start" | "done" | "error";
  detail?: string;
  round: number; // 所属轮次（手工事件为 0）
  intent?: string; // 该轮意图（一句话）
};

export type ChatEvent = {
  delta?: string;
  reasoning?: string;
  tool?: ToolEvent;
  plan?: { todos: TodoItem[] }; // todo_write 成功后推送清单快照（任务面板用）
  run?: { round: number; maxRounds: number; intent?: string }; // 轮次心跳
};

/** 发给模型的消息（含 tool_calls / tool 角色） */
type ApiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type RawToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** 聊天统一出口：环境自知 System Prompt + Function Calling 工具循环。
 *  未配置 → mock 回复。模型可调用工具操作资料库（移动/建类目/生成笔记…），
 *  每次工具调用以 tool 事件推给前端，最终答案流式返回。 */
export async function* streamChat(
  question: string,
  contextBlocks: string[],
  history: ChatMessage[],
  sourceIds: number[] = [],
  threadId: number
): AsyncGenerator<ChatEvent> {
  const s = getSettings();
  if (!isModelConfigured(s)) {
    yield* mockAnswer(question, contextBlocks);
    return;
  }

  const context = contextBlocks.join("\n\n");
  const messages: ApiMessage[] = [
    { role: "system", content: buildSystemPrompt(sourceIds) },
    ...history.slice(-8).map<ApiMessage>((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: context
        ? `参考资料片段：\n${context}\n\n---\n我的问题：${question}\n\n请回答并标注来源编号；若需要操作资料库（移动/归类/生成笔记等），直接调用工具执行。`
        : question,
    },
  ];

  const total = { prompt: 0, completion: 0 };
  let answerText = "";

  // Agent Loop（规格 §3.2）：maxRounds 轮带工具 + 1 轮强制文字收尾。
  // 每轮从表读最新任务清单注入（用户面板手改后模型能感知）；工具事件带 callId/round/intent；
  // 护栏提示随工具结果回喂；todo_write 成功后推送清单快照。
  const maxRounds = Number(process.env.IFCOPE_AGENT_MAX_ROUNDS ?? 8);
  const guard = new LoopGuard(16);
  let resumesLeft = 2; // 断流续跑预算（Task 5）：最多续跑 2 次，计入轮次预算
  for (let round = 0; round <= maxRounds + 2; round++) {
    const useTools = round < maxRounds;
    messages[0] = { role: "system", content: buildSystemPrompt(sourceIds, getTodos(threadId)) };
    // 手动迭代：转发增量给消费者的同时，截获工具调用与累计答案文本
    let roundText = "";
    let toolCalls: RawToolCall[] = [];
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    try {
      const it = streamOnce(s, messages, useTools)[Symbol.asyncIterator]();
      let step = await it.next();
      while (!step.done) {
        if (step.value.delta) {
          roundText += step.value.delta;
          answerText += step.value.delta;
        }
        yield step.value; // 含 delta / reasoning，原样转发
        step = await it.next();
      }
      toolCalls = step.value.toolCalls;
      usage = step.value.usage;
    } catch {
      // 断流续跑（Task 5）：已产出内容不报废；续跑一轮计入轮次预算，最多 2 次
      if (resumesLeft > 0) {
        resumesLeft -= 1;
        if (roundText) messages.push({ role: "assistant", content: roundText });
        messages.push({ role: "user", content: "（此前输出被网络中断，请从断点继续剩余部分，不要重复已完成的动作）" });
        continue;
      }
      // 续跑耗尽：保留已产出内容 + 明确中断提示，不再 throw（不整条报废）
      const notice = "\n\n（连接中断，回复不完整，可让我继续）";
      answerText += notice;
      yield { delta: notice };
      break;
    }
    const intent = extractIntent(roundText);
    yield { run: { round, maxRounds, intent } };
    if (usage) {
      total.prompt += usage.prompt_tokens ?? 0;
      total.completion += usage.completion_tokens ?? 0;
    }
    if (!toolCalls.length) break;
    if (!useTools) break;

    messages.push({ role: "assistant", content: null, tool_calls: toolCalls });

    let todoUpdated = false;
    for (let i = 0; i < toolCalls.length; i++) {
      const raw = toolCalls[i];
      const name = raw.function.name;
      const callId = `call_${round}_${i}`;
      yield { tool: { callId, name, phase: "start", round, intent } };
      let result: string;
      try {
        const args = (raw.function.arguments ? JSON.parse(raw.function.arguments) : {}) as Record<string, unknown>;
        const call: ToolCall = { id: raw.id, name, args };
        result = await runTool(call, { threadId });
        if (name === "todo_write") todoUpdated = true;
        yield { tool: { callId, name, phase: "done", round, intent, detail: result.replace(/\s+/g, " ").slice(0, 160) } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield { tool: { callId, name, phase: "error", round, intent, detail: msg.slice(0, 200) } };
        result = `工具执行失败：${msg}。请向学生说明原因，或换一种方式处理。`;
      }
      // 护栏提示（重复调用/预算用尽）随工具结果回喂，模型自行收敛
      const warn = guard.record(name, raw.function.arguments ?? "");
      if (warn) result = `${result}\n\n【护栏】${warn}`;
      messages.push({ role: "tool", tool_call_id: raw.id, content: result });
    }
    if (todoUpdated) yield { plan: { todos: getTodos(threadId) } };
    // 末个工具轮后提示收敛（下一轮强制纯文字）
    if (round === maxRounds - 1) {
      messages.push({ role: "user", content: "轮次预算即将用尽，请收敛任务并给出总结" });
    }
  }

  recordUsage("chat", s.chatModel, total.prompt, total.completion);
  if (!answerText.trim()) {
    yield { delta: "（模型未返回内容，请换个说法重试）" };
  }
}

/** 模型接口 POST（Task 5）：429/5xx/网络错误退避重试 2 次（间隔 1s、3s）；
 *  重试耗尽返回最后响应（交调用方报错）或抛网络错误；其余状态码原样返回。 */
async function fetchModel(url: string, headers: HeadersInit, payload: string): Promise<Response> {
  const delays = [1000, 3000];
  let netErr: unknown = null;
  let res: Response | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delays[attempt - 1]));
    try {
      res = await fetch(url, { method: "POST", headers, body: payload });
      netErr = null;
      if (res.status !== 429 && res.status < 500) return res; // 成功或 4xx（非 429）：不重试
    } catch (e) {
      netErr = e;
      res = null;
    }
  }
  if (res) return res; // 429/5xx 重试耗尽
  throw netErr instanceof Error ? netErr : new Error(String(netErr));
}

/** 意图提取：该轮 content 首个非空行、单行化、截 80 字符（供时间线显示“为什么调这个工具”） */
function extractIntent(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return line ? line.replace(/\s+/g, " ").slice(0, 80) : undefined;
}

/** 单次模型调用：流式转发 content/reasoning 增量；结束后返回累积的工具调用。 */
async function* streamOnce(
  s: ReturnType<typeof getSettings>,
  messages: ApiMessage[],
  useTools: boolean
): AsyncGenerator<{ delta?: string; reasoning?: string }, { toolCalls: RawToolCall[]; usage: { prompt_tokens?: number; completion_tokens?: number } | null }> {
  const body: Record<string, unknown> = {
    model: s.chatModel,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (useTools && TOOLS.length) body.tools = TOOLS;

  let res = await fetchModel(modelEndpoint(s.baseUrl, "chat/completions"), modelHeaders(s.apiKey), JSON.stringify(body));
  // 上游不支持 tools 参数时降级：去掉 tools 重试一次（不计入退避次数）
  if (!res.ok && useTools && (res.status === 400 || res.status === 422)) {
    delete body.tools;
    res = await fetch(modelEndpoint(s.baseUrl, "chat/completions"), {
      method: "POST",
      headers: modelHeaders(s.apiKey),
      body: JSON.stringify(body),
    });
  }
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    throw new Error(`模型接口错误 HTTP ${res.status}：${msg.slice(0, 300)}`);
  }

  const toolAcc = new Map<number, { id?: string; name?: string; args: string }>();
  const usage = { prompt_tokens: 0, completion_tokens: 0 };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        if (json.usage) {
          usage.prompt_tokens += json.usage.prompt_tokens ?? 0;
          usage.completion_tokens += json.usage.completion_tokens ?? 0;
        }
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) yield { delta: delta.content as string };
        // 思考过程（深度思考模型）：deepseek-r1/glm/qwen 等的 OpenAI 兼容字段 reasoning_content（部分供应商用 reasoning）
        const r = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof r === "string" && r) yield { reasoning: r };
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls as Array<{
            index: number; id?: string; function?: { name?: string; arguments?: string };
          }>) {
            const cur = toolAcc.get(tc.index) ?? { args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(tc.index, cur);
          }
        }
      } catch {
        /* 忽略不完整行 */
      }
    }
  }

  const toolCalls: RawToolCall[] = [];
  for (const [index, v] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
    if (!v.name) continue;
    toolCalls.push({
      id: v.id ?? `call_${index}_${Date.now()}`,
      type: "function",
      function: { name: v.name, arguments: v.args },
    });
  }
  return { toolCalls, usage };
}

/** mock：从检索片段里拼一个演示回复（引用编号是真实的，可点击跳转） */
function* mockAnswer(
  question: string,
  contextBlocks: string[]
): Generator<{ delta?: string }> {
  const picks = [1, 2].filter((n) => n <= contextBlocks.length);
  const refText = picks.length
    ? picks.map((n) => `[${n}]`).join(" ")
    : "（当前没有检索到相关片段）";
  const lines = [
    `> 当前未配置模型，以下为演示回复。到「设置」页填入词来 Key 或任意 OpenAI 兼容端点后，这里会变成真实回答。\n`,
    `关于「${question}」，从你选中的资料里检索到 ${contextBlocks.length} 个相关片段 ${refText}：\n`,
  ];
  for (const block of contextBlocks.slice(0, 2)) {
    const body = block.split("\n").slice(1).join(" ").slice(0, 160);
    lines.push(`- ${body}${body.length >= 160 ? "……" : ""}\n`);
  }
  if (!contextBlocks.length) {
    lines.push("- 请先在「资源库」上传资料，或确认已勾选相关资源后再提问。\n");
  }
  const text = lines.join("");
  for (const seg of text.match(/[\s\S]{1,12}/g) ?? []) {
    yield { delta: seg };
  }
  recordUsage("chat", "mock", estimateTokens(question + contextBlocks.join(" ")), estimateTokens(text));
}
