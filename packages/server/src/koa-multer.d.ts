/**
 * 本地类型声明：@koa/multer
 *
 * 不使用 @types/koa__multer 是因为该包会通过 declare module "koa" 扩展
 * DefaultContext（添加 file / files 属性），导致 koa-router 的
 * ParameterizedContext 与 Koa Context 产生类型不兼容，所有路由
 * handler 都会报 TS2769 错误。
 *
 * 此声明仅导出 multer 函数和所需的类型，不侵入 Koa 命名空间。
 * 在 controller 中通过类型断言 (ctx as any).file 访问 multer 注入的文件。
 */
declare module '@koa/multer' {
  import { IncomingMessage } from 'http';
  import { Middleware } from 'koa';

  export interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  interface StorageEngine {
    _handleFile(
      req: IncomingMessage,
      file: File,
      callback: (error?: any, info?: File) => void,
    ): void;
    _removeFile(
      req: IncomingMessage,
      file: File,
      callback: (error: Error) => void,
    ): void;
  }

  interface Options {
    dest?: string;
    storage?: StorageEngine;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
    fileFilter?: (
      req: IncomingMessage,
      file: File,
      callback: (error: Error | null, acceptFile: boolean) => void,
    ) => void;
  }

  interface Instance {
    single(fieldName?: string): Middleware;
    array(fieldName: string, maxCount?: number): Middleware;
    fields(fields: Array<{ name: string; maxCount?: number }>): Middleware;
    any(): Middleware;
  }

  function multer(options?: Options): Instance;
  function memoryStorage(): StorageEngine;

  export { multer as default, File, memoryStorage };
}
