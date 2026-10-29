import { parentPort } from 'node:worker_threads';
import { decodeTexture, encodeTexture, readNinePatch, writeNinePatch, packTextures } from './texture-codec';
parentPort?.once('message', request => {
  try {
    if (request.mode === 'pack') { parentPort!.postMessage({ result: packTextures(request.inputs, request.width, request.padding) }); return; }
    let image = decodeTexture(request.bytes), spec;
    if (request.nine) ({ image, spec } = readNinePatch(image));
    if (request.mode === 'nine') parentPort!.postMessage({ result: { png: writeNinePatch(image, request.spec), width: image.width, height: image.height } });
    else parentPort!.postMessage({ result: { png: encodeTexture(image), width: image.width, height: image.height, spec } });
  } catch (e) { parentPort!.postMessage({ error: e instanceof Error ? e.message : '纹理处理失败' }); }
});
