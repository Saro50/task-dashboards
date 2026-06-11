import Router from 'koa-router';
import multer from '@koa/multer';
import type { File as MulterFile } from '@koa/multer';
import * as ChatController from './chat.controller.js';

const router = new Router({ prefix: '/api/chat' });

// multer 内存存储：文件保存在 buffer 中，不落盘原始文件
// 文件大小限制 1MB，仅允许图片格式
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter(
    _req: import('http').IncomingMessage,
    file: MulterFile,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) {
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: ${allowed.join(', ')}`), false);
    }
  },
});

router.get('/sessions', ChatController.listSessions);
router.post('/sessions', ChatController.createSession);
router.patch('/sessions/:id', ChatController.updateSession);
router.delete('/sessions/:id', ChatController.deleteSession);
router.get('/sessions/:id/messages', ChatController.getMessages);
router.post('/sessions/:id/send', ChatController.sendMessage);
router.post('/sessions/:id/abort', ChatController.abortSession);
router.get('/events', ChatController.subscribeEvents);
router.post('/log', ChatController.clientLog);
router.post('/upload-image', upload.single('image'), ChatController.uploadImage);
/**
 * 图片文件服务端点。
 * 上游：前端 PartRenderer 通过此端点加载已上传的图片缩略图和大图。
 * 安全：controller 层做了路径白名单 + 遍历检测 + resolve 后二次校验。
 */
router.get('/serve-image', ChatController.serveImage);

export default router;
