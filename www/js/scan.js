// Lecture de code-barres par la caméra : détecteur natif si disponible, sinon ZXing (embarqué).
let stream = null, timer = null, zxingReader = null, stopped = true;

export async function startCamera(video, onCode) {
  stopCamera();
  stopped = false;
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('code_128')) detector = new window.BarcodeDetector({ formats: ['code_128'] });
    } catch (e) { detector = null; }
  }
  if (!detector && window.ZXing) {
    const hints = new Map();
    hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [window.ZXing.BarcodeFormat.CODE_128]);
    hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
    zxingReader = new window.ZXing.BrowserMultiFormatReader(hints, 250);
    await zxingReader.decodeFromConstraints(
      { video: { facingMode: 'environment', width: { ideal: 1280 } } }, video,
      (result) => { if (result && !stopped) onCode(result.getText()); }
    );
    return;
  }
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) onCode(codes[0].rawValue);
    } catch (e) {}
    timer = setTimeout(tick, 200);
  };
  tick();
}

export function stopCamera() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (zxingReader) { try { zxingReader.reset(); } catch (e) {} zxingReader = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

let audioCtx = null;
export function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.35));
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
}
