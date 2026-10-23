import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3", "pdfjs-dist",
    "fastembed", "onnxruntime-node", // 本地嵌入模型（原生模块）
    "@huggingface/transformers",     // 本地语音转写 whisper（动态加载 onnx）
    "@audio/decode",                 // 音频解码（内部动态 import 可选子包，不可被 webpack 打包）
  ],
};

export default nextConfig;
