import type * as http from 'node:http';

export function readRequestBody(
  req: http.IncomingMessage,
  maxBytes: number,
  cancelled: () => Error
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let bytes = 0;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('close', onClose);
      req.off('error', onError);
    };
    const resolveOnce = (body: Buffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        chunks.length = 0;
        rejectOnce(
          Object.assign(new Error('Request body exceeds configured limit'), {
            code: 'BODY_TOO_LARGE',
          })
        );
        req.resume();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => resolveOnce(Buffer.concat(chunks));
    const onAborted = () => rejectOnce(cancelled());
    const onClose = () => {
      if (!req.complete) {
        rejectOnce(cancelled());
      }
    };
    const onError = (error: Error) => rejectOnce(error);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('close', onClose);
    req.on('error', onError);
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      rejectOnce(
        Object.assign(new Error('Request body exceeds configured limit'), {
          code: 'BODY_TOO_LARGE',
        })
      );
      req.resume();
    }
  });
}
