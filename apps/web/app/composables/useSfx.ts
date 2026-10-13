/**
 * 8-bit 音效：WebAudio 方波/三角波现场合成，零音频素材。
 * 每个音效是一串 (频率, 时长[, 滑到的频率]) 音符；偏好里关掉 sound 时 play() 直接返回。
 */
export type SfxName =
  | "click"
  | "confirm"
  | "cancel"
  | "error"
  | "coin"
  | "open"
  | "close"
  | "step"
  | "start"
  | "meow"
  | "purr"
  | "crash";

type Note = [freq: number, ms: number, glideTo?: number];

const SFX: Record<SfxName, { wave: OscillatorType; notes: Note[]; gain: number }> = {
  click: { wave: "square", notes: [[880, 28]], gain: 0.05 },
  step: { wave: "square", notes: [[660, 22]], gain: 0.035 },
  confirm: { wave: "square", notes: [[660, 50], [990, 80]], gain: 0.06 },
  cancel: { wave: "square", notes: [[440, 50], [330, 70]], gain: 0.05 },
  error: { wave: "square", notes: [[220, 90], [160, 140]], gain: 0.07 },
  coin: { wave: "square", notes: [[988, 60], [1319, 160]], gain: 0.06 },
  open: { wave: "triangle", notes: [[523, 40], [784, 60]], gain: 0.09 },
  close: { wave: "triangle", notes: [[784, 40], [523, 60]], gain: 0.09 },
  start: { wave: "square", notes: [[523, 70], [659, 70], [784, 70], [1047, 160]], gain: 0.06 },
  meow: { wave: "triangle", notes: [[620, 90, 980], [980, 180, 520]], gain: 0.1 },
  purr: { wave: "square", notes: [[92, 70], [78, 70], [92, 70], [78, 70], [92, 70], [78, 90]], gain: 0.04 },
  crash: { wave: "square", notes: [[1800, 24], [620, 24], [2300, 24], [420, 40], [1500, 30], [240, 140, 90]], gain: 0.05 },
};

let ctx: AudioContext | null = null;

export function useSfx() {
  const { prefs } = usePrefs();

  function play(name: SfxName): void {
    if (!prefs.value.sound || typeof window === "undefined") return;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") void ctx.resume();
      const def = SFX[name];
      let t = ctx.currentTime;
      for (const [freq, ms, glideTo] of def.notes) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = def.wave;
        osc.frequency.setValueAtTime(freq, t);
        if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, t + ms / 1000);
        g.gain.setValueAtTime(def.gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + ms / 1000 + 0.01);
        t += ms / 1000;
      }
    } catch {
      // 浏览器不允许发声就安静地算了
    }
  }

  return { play };
}
