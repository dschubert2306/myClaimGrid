import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

function awsError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/**
 * Minimal in-memory S3 for the commands the handlers send. Presigned URLs and POSTs are signed
 * locally by the SDK and never reach this mock, so a test "uploads" with `put`.
 */
export function fakeS3() {
  const objects = new Map<string, StoredObject>();
  const mock = mockClient(S3Client);

  mock.on(HeadObjectCommand).callsFake((input) => {
    const object = objects.get(input.Key as string);
    if (!object) throw awsError('NotFound');
    return { ContentType: object.contentType, ContentLength: object.bytes.length };
  });

  mock.on(GetObjectCommand).callsFake((input) => {
    const object = objects.get(input.Key as string);
    if (!object) throw awsError('NoSuchKey');
    const range = /^bytes=(\d+)-(\d+)$/.exec(input.Range ?? '');
    const bytes = range ? object.bytes.slice(Number(range[1]), Number(range[2]) + 1) : object.bytes;
    return {
      ContentType: object.contentType,
      ContentLength: bytes.length,
      Body: { transformToByteArray: async () => bytes },
    };
  });

  mock.on(CopyObjectCommand).callsFake((input) => {
    const source = String(input.CopySource).split('/').slice(1).join('/');
    const object = objects.get(source);
    if (!object) throw awsError('NoSuchKey');
    objects.set(input.Key as string, { ...object });
    return {};
  });

  mock.on(DeleteObjectCommand).callsFake((input) => {
    objects.delete(input.Key as string);
    return {};
  });

  return {
    mock,
    put: (key: string, bytes: Uint8Array | string, contentType: string) =>
      void objects.set(key, {
        bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
        contentType,
      }),
    has: (key: string) => objects.has(key),
    keys: () => [...objects.keys()],
  };
}

export const PDF_BYTES = '%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF';
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
