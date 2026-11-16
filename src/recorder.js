// Frame-exact recording. The caller renders each frame on demand, so the
// result does not depend on how fast the computer is.
// Formats: animated GIF, MP4 (H.264), WebM (VP9), or a ZIP of PNG frames.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { zipSync } from 'fflate';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

async function pickConfig(candidates, w, h, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of candidates) {
    const config = { codec: c.codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.2), framerate: fps, latencyMode: 'quality' };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return { config, muxCodec: c.mux };
    } catch (e) { /* try the next one */ }
  }
  return null;
}

const MP4_CODECS = [
  { codec: 'avc1.640034', mux: 'avc' }, { codec: 'avc1.640028', mux: 'avc' },
  { codec: 'avc1.4d0028', mux: 'avc' }, { codec: 'avc1.42001f', mux: 'avc' },
];
const WEBM_CODECS = [{ codec: 'vp09.00.40.08', mux: 'V_VP9' }, { codec: 'vp09.00.10.08', mux: 'V_VP9' }, { codec: 'vp8', mux: 'V_VP8' }];

// Draws the WebGL canvas onto a 2D canvas over a solid ground (video and GIF
// have no transparency here).
function compositor(w, h, ground) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return {
    canvas: c,
    draw(src, keepAlpha) {
      ctx.clearRect(0, 0, w, h);
      if (!keepAlpha) { ctx.fillStyle = ground; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(src, 0, 0, w, h);
      return ctx;
    },
  };
}

function gifSink(w, h, fps, ground) {
  const gif = GIFEncoder();
  const comp = compositor(w, h, ground);
  const delay = Math.max(20, Math.round(100 / fps) * 10);
  return {
    async add(src) {
      const data = comp.draw(src).getImageData(0, 0, w, h).data;
      const palette = quantize(data, 256, { format: 'rgb565' });
      const index = applyPalette(data, palette, 'rgb565');
      gif.writeFrame(index, w, h, { palette, delay, repeat: 0 });
    },
    async finish() { gif.finish(); return new Blob([gif.bytes()], { type: 'image/gif' }); },
  };
}

function pngSink(w, h, ground, keepAlpha, base) {
  const files = {};
  const comp = compositor(w, h, ground);
  let i = 0;
  return {
    async add(src) {
      comp.draw(src, keepAlpha);
      const blob = await new Promise((r) => comp.canvas.toBlob(r, 'image/png'));
      files[`${base}/${base}_${String(i++).padStart(4, '0')}.png`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    },
    async finish() { return new Blob([zipSync(files)], { type: 'application/zip' }); },
  };
}

async function codecSink(kind, w, h, fps, ground) {
  const picked = await pickConfig(kind === 'mp4' ? MP4_CODECS : WEBM_CODECS, w, h, fps);
  if (!picked) return null;
  const target = kind === 'mp4' ? new Mp4Target() : new WebmTarget();
  const muxer = kind === 'mp4'
    ? new Mp4Muxer({ target, video: { codec: picked.muxCodec, width: w, height: h, frameRate: fps }, fastStart: 'in-memory' })
    : new WebmMuxer({ target, video: { codec: picked.muxCodec, width: w, height: h, frameRate: fps } });
  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  enc.configure(picked.config);
  const comp = compositor(w, h, ground);
  let i = 0;
  return {
    async add(src) {
      if (failure) throw failure;
      comp.draw(src);
      const frame = new VideoFrame(comp.canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      i++;
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
    },
    async finish() {
      await enc.flush();
      if (failure) throw failure;
      enc.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: kind === 'mp4' ? 'video/mp4' : 'video/webm' });
    },
  };
}

// Fallback for browsers without WebCodecs: records in real time.
function mediaRecorderSink(w, h, fps, ground) {
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'];
  const type = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!type) return null;
  const comp = compositor(w, h, ground);
  const stream = comp.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(w * h * fps * 0.2) });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    ext: type.includes('mp4') ? 'mp4' : 'webm',
    async add(src) {
      comp.draw(src);
      track.requestFrame();
      await new Promise((r) => setTimeout(r, 1000 / fps));
    },
    async finish() {
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      return new Blob(chunks, { type: type.split(';')[0] });
    },
  };
}

// opts: { format, frames, fps, w, h, ground, keepAlpha, base, renderFrame(i) -> canvas, onProgress(i, n), isCancelled() }
export async function record(opts) {
  const { format, frames, fps, w, h, ground } = opts;
  let sink, ext = format;
  if (format === 'gif') sink = gifSink(w, h, fps, ground);
  else if (format === 'png') { sink = pngSink(w, h, ground, opts.keepAlpha, opts.base); ext = 'zip'; }
  else {
    sink = await codecSink(format, w, h, fps, ground);
    if (!sink) { sink = mediaRecorderSink(w, h, fps, ground); if (sink) ext = sink.ext; }
    if (!sink) throw new Error('This browser cannot encode video. Try GIF or PNG frames.');
  }
  for (let i = 0; i < frames; i++) {
    if (opts.isCancelled()) return null;
    const src = opts.renderFrame(i);
    await sink.add(src);
    opts.onProgress(i + 1, frames);
    if (i % 2 === 0) await nextFrame();
  }
  opts.onProgress(frames, frames, 'encoding');
  const blob = await sink.finish();
  return { blob, ext };
}
