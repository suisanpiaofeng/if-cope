import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * 存储约定：
 * - 原始文件落 data/uploads/{uuid}.{ext}，数据库只存元数据
 * - 上线时把这里的 save/read/remove 换成对象存储实现即可，业务层无感
 */
export function saveFile(buffer: Buffer, ext: string): string {
  const name = `${crypto.randomUUID()}.${ext.replace(/^\./, "") || "bin"}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return name;
}

export function readFile(storageName: string): Buffer {
  return fs.readFileSync(path.join(UPLOAD_DIR, storageName));
}

export function removeFile(storageName: string) {
  const p = path.join(UPLOAD_DIR, storageName);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** 覆盖写回（编辑保存用）；storageName 必须是库内已有记录，basename 防路径穿越 */
export function writeFile(storageName: string, buffer: Buffer) {
  const name = path.basename(storageName);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
