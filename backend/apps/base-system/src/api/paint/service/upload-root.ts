import * as fs from 'fs';
import path from 'path';

/**
 * 工程根目录锚点（即包含 `uploads` 目录的 `backend/`）。
 *
 * 通过本模块在磁盘上的位置（`__dirname`）向上查找包含 `uploads` 的目录，
 * 而不依赖 `process.cwd()`。这样无论以 `backend`、`apps/base-system` 还是
 * 仓库根作为启动目录，写盘 / 读盘 / 静态服务都能定位到同一份物理文件，
 * 避免“启动目录不同导致文件读写错位 / 静态资源 404”。
 */
function resolveBackendRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'uploads'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 已到达文件系统根仍找不到，回退到 cwd
    dir = parent;
  }
  return process.cwd();
}

/** 工程根（uploads 的父目录）。存储的相对路径均以 `uploads/...` 开头。 */
export const BACKEND_ROOT = resolveBackendRoot();

/** 实际上传文件目录，供静态资源服务（root 指向该目录）使用。 */
export const UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads');
