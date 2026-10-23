import path from "path";

// 必须在 import @huggingface/transformers 之前设置（其在模块加载时读取）
if (!process.env.HF_ENDPOINT) process.env.HF_ENDPOINT = "https://hf-mirror.com";

import decodeAudio from "@audio/decode";

/** 本地语音转写（STT）：whisper-tiny ONNX，CPU 推理，缓存于 data/models/。
 *  与本地嵌入同策略：免配置、走 hf-mirror、失败允许重试。
 *  STT_MODEL 环境变量可换更大模型（whisper-base/small）。 */
export const STT_MODEL = process.env.STT_MODEL || "Xenova/whisper-tiny";
/** 转写语言：v4 实现不传 language 时强制英文（文档与实现不符），中文场景默认 zh，STT_LANG 可覆盖 */
const STT_LANG = process.env.STT_LANG || "zh";

/** 单文件最长转写时长（CPU 推理耗时 ≈ 音频时长×0.3~0.6，受路由 maxDuration 限制） */
const MAX_SEC = 300;

type AsrPipe = (
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<{ text?: string }>;

let asrPromise: Promise<AsrPipe> | null = null;

async function getAsr(): Promise<AsrPipe> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path.join(process.cwd(), "data", "models");
      // 模型已预下载到本地（curl 绕过 Node 到 hf-mirror 的网络问题）；
      // 本地优先加载，缺失时直接报错而非联网超时（报错含缺失文件路径）
      env.localModelPath = path.join(process.cwd(), "data", "models");
      env.allowRemoteModels = false;
      const pipe = await pipeline("automatic-speech-recognition", STT_MODEL);
      return pipe as unknown as AsrPipe;
    })();
    // 失败后清空缓存 promise，允许下次重试（如首次下载断网）
    asrPromise.catch(() => { asrPromise = null; });
  }
  return asrPromise;
}

/** 线性插值重采样到 16kHz（whisper 输入要求） */
function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000 || fromRate <= 0) return input;
  const ratio = fromRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export type TranscribeResult = {
  text: string;
  durationSec: number;
  truncated: boolean;
  model: string;
};

/** 音频字节 → 转写文本。格式自动探测（mp3/m4a/wav/aac/flac/opus/webm…） */
export async function transcribeAudio(buffer: Buffer): Promise<TranscribeResult> {
  const audio = await decodeAudio(new Uint8Array(buffer));
  const channel = audio.channelData?.[0];
  if (!channel?.length) throw new Error("音频解码后为空（不支持的格式或损坏文件）");

  const full = resampleTo16k(channel, audio.sampleRate);
  const totalSec = full.length / 16000;
  const truncated = totalSec > MAX_SEC;
  const pcm = truncated ? full.subarray(0, MAX_SEC * 16000) : full;

  const asr = await getAsr();
  const out = await asr(pcm, {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: STT_LANG,
    task: "transcribe",
  });
  const text = (out?.text ?? "").trim();

  return {
    text,
    durationSec: Math.round(truncated ? MAX_SEC : totalSec),
    truncated,
    model: STT_MODEL,
  };
}
