/**
 * 截帧对照页：把每个夹具的每一步按若干进度点渲染成一张接触表（contact sheet）。
 *
 * 用途：动画器改版前后的人眼对照（ADR-031）。页面本身就能看；截图脚本只需
 * `?fixture=<title>` 打开后截 `#sheet`。`&step=<n>&n=<帧数>` 只看一步、按更密的进度取样。
 * 不是产品代码。
 */
import { compile, sample } from "@shaker/animator-core";
import { DARK_THEME, LIGHT_THEME, renderScene } from "@shaker/animator-web";
import { ASSET_TEST_FIXTURES, FIXTURES, VOCAB, type Fixture } from "@shaker/fixtures";

const ALL: Fixture[] = [...FIXTURES, ...ASSET_TEST_FIXTURES];
const STAGE = { width: 400, height: 520 };
/** 接触表里每帧的缩放：0.5 → 每个像素格 2×2，仍然锐利。 */
const K = 0.5;

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? LIGHT_THEME : DARK_THEME;
const wanted = params.get("fixture");
const onlyStep = params.has("step") ? Number(params.get("step")) : null;
const nFrames = Number(params.get("n") ?? (onlyStep !== null ? 10 : 5));
const PROGRESS = Array.from({ length: nFrames }, (_, i) => (i + 0.5) / nFrames);

const frame = document.createElement("canvas");
frame.width = STAGE.width;
frame.height = STAGE.height;
const fctx = frame.getContext("2d", { alpha: false })!;

function sheetFor(f: Fixture): HTMLCanvasElement {
  const tl = compile(f.ir, VOCAB, { stage: STAGE });
  const steps = tl.steps.map((s, i) => ({ s, i })).filter(({ i }) => onlyStep === null || i === onlyStep);
  const fw = STAGE.width * K;
  const fh = STAGE.height * K;
  const labelW = 150;
  const perRow = Math.min(PROGRESS.length, 6);
  const rowsPer = Math.ceil(PROGRESS.length / perRow);
  const sheet = document.createElement("canvas");
  sheet.width = labelW + fw * perRow;
  sheet.height = 28 + steps.length * rowsPer * (fh + 4);
  const s = sheet.getContext("2d")!;
  s.fillStyle = "#111";
  s.fillRect(0, 0, sheet.width, sheet.height);
  s.imageSmoothingEnabled = false;
  s.fillStyle = "#eee";
  s.font = "14px monospace";
  s.fillText(`${f.title} · ${f.subtitle}`, 8, 18);

  steps.forEach(({ s: st, i: idx }, r) => {
    const y = 28 + r * rowsPer * (fh + 4);
    s.fillStyle = "#ccc";
    s.font = "12px monospace";
    s.fillText(`${idx + 1}. ${st.action}`, 8, y + 16);
    s.fillStyle = "#888";
    s.fillText(`${st.durationMs}ms`, 8, y + 32);
    wrap(s, st.label.zh, 8, y + 52, labelW - 12);
    PROGRESS.forEach((p, c) => {
      const t = st.startMs + st.durationMs * p;
      const res = sample(tl, t);
      renderScene(fctx, res.scene, { theme });
      const col = c % perRow;
      const row = Math.floor(c / perRow);
      s.drawImage(frame, labelW + col * fw, y + row * (fh + 4), fw, fh);
      s.fillStyle = "#666";
      s.font = "10px monospace";
      s.fillText(`${Math.round(t)}`, labelW + col * fw + 4, y + row * (fh + 4) + 12);
    });
  });
  return sheet;
}

function wrap(s: CanvasRenderingContext2D, text: string, x: number, y: number, w: number): void {
  let line = "";
  let yy = y;
  for (const ch of text) {
    if (s.measureText(line + ch).width > w) {
      s.fillText(line, x, yy);
      line = ch;
      yy += 14;
    } else line += ch;
  }
  if (line) s.fillText(line, x, yy);
}

const root = document.getElementById("sheets")!;
for (const f of ALL) {
  if (wanted && f.title !== wanted) continue;
  const c = sheetFor(f);
  c.id = wanted ? "sheet" : "";
  root.appendChild(c);
}
document.body.dataset.ready = "1";
