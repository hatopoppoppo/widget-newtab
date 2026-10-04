// 時間になったときの音。目覚まし時計のような「ピピピピ」を 3 回。
// 鳴らすのは offscreen.html(js/offscreen.js)。ほかのタブを見ているときも鳴らすため
const BEEP = { freq: 2000, length: 0.06, every: 0.12, count: 4, sets: 3, setEvery: 1 }; // 秒

export function chime() {
  const ctx = new AudioContext();
  ctx.resume();
  for (let set = 0; set < BEEP.sets; set++) {
    for (let i = 0; i < BEEP.count; i++) {
      const t = ctx.currentTime + 0.05 + set * BEEP.setEvery + i * BEEP.every;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = BEEP.freq;
      // 角が立つとプツッと鳴るので、ごく短く立ち上げて切る
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.005);
      gain.gain.setValueAtTime(0.08, t + BEEP.length - 0.005);
      gain.gain.linearRampToValueAtTime(0, t + BEEP.length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + BEEP.length);
    }
  }
  setTimeout(() => ctx.close(), (BEEP.sets * BEEP.setEvery + 0.5) * 1000);
}
