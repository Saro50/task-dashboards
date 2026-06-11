declare module 'sharp' {
  interface SharpOptions {
    compressionLevel?: number;
  }
  interface JpegOptions {
    quality?: number;
  }
  interface WebpOptions {
    lossless?: boolean;
  }
  interface SharpInstance {
    png(options?: SharpOptions): SharpInstance;
    jpeg(options?: JpegOptions): SharpInstance;
    webp(options?: WebpOptions): SharpInstance;
    toBuffer(): Promise<Buffer>;
  }
  function sharp(input?: Buffer): SharpInstance;
  export = sharp;
}
