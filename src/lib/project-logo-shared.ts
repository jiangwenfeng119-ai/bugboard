export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const LOGO_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function projectLogoSrc(projectId: number, updatedAt: string) {
  return `/api/projects/${projectId}/logo?v=${encodeURIComponent(updatedAt)}`;
}

export function logoExtension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function logoExtensionError(filename: string, size: number) {
  const ext = logoExtension(filename);
  if (!LOGO_EXT.has(ext)) {
    return `不支持的文件类型：${ext || "(无扩展名)"}`;
  }
  if (size <= 0) return "请选择文件";
  if (size > LOGO_MAX_BYTES) return "Logo 不能超过 2MB";
  return null;
}

function sniffLogo(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export function logoFileError(filename: string, bytes: Uint8Array) {
  const message = logoExtensionError(filename, bytes.byteLength);
  if (message) return message;
  const ext = logoExtension(filename);
  const kind = ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg";
  if (sniffLogo(bytes) !== kind) return "文件内容和扩展名不一致";
  return null;
}
