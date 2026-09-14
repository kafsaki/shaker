/**
 * 动画原型播放器。
 *
 * 这不是产品代码，是一个**验证装置**。它要回答三个问题：
 *   1. 自动生成的动画能看吗？（表现力）
 *   2. 拖时间轴、单步回看能工作吗？（seek 正确性 —— 规范 §9.1 的两条纪律）
 *   3. 在中端安卓的 WebView 里能稳住 60fps 吗？（决定移动端框架，ADR-005）
 *
 * 所以帧率读数是一等公民，不是调试彩蛋。
 */
import { compile, sample, type Timeline } from "@shaker/animator-core";
import { estimateAbv, totalLiquidMl, displayAmount, toParts, validateRecipeIR } from "@shaker/recipe-ir";
import { DARK_THEME, LIGHT_THEME, renderScene } from "@shaker/animator-web";
import { FIXTURES, ASSET_TEST_FIXTURES, VOCAB, vesselLookup, type Fixture } from "@shaker/seed";

/** 真实配方在前，资源覆盖测试夹具（asset_testN）排在最后。 */
const ALL_FIXTURES: Fixture[] = [...FIXTURES, ...ASSET_TEST_FIXTURES];

/* ────────────────────────── DOM ────────────────────────── */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("stage");
// 在模块顶层断言一次，后续函数体内就不用反复收窄
const ctx = (() => {
  const c = canvas.getContext("2d", { alpha: false });
  if (!c) throw new Error("拿不到 2D 上下文");
  return c;
})();

const recipeTabs = $<HTMLDivElement>("recipes");
const stepList = $<HTMLOListElement>("steps");
const scrub = $<HTMLInputElement>("scrub");
const playBtn = $<HTMLButtonElement>("play");
const speedSel = $<HTMLSelectElement>("speed");
const themeBtn = $<HTMLButtonElement>("theme");
const debugChk = $<HTMLInputElement>("debug");
const shotBtn = $<HTMLButtonElement>("shot");
const fpsEl = $<HTMLSpanElement>("fps");
const frameEl = $<HTMLSpanElement>("frametime");
const compileEl = $<HTMLSpanElement>("compiletime");
const metaEl = $<HTMLDivElement>("meta");
const ingList = $<HTMLTableSectionElement>("ingredients");
const testNote = $<HTMLParagraphElement>("testnote");
const diagEl = $<HTMLDivElement>("diagnostics");
const bannerEl = $<HTMLDivElement>("banner");
const unitBtn = $<HTMLButtonElement>("units");
const partsChk = $<HTMLInputElement>("parts");

/* ────────────────────────── 状态 ────────────────────────── */

let fixture: Fixture = FIXTURES[0]!;
let timeline: Timeline = compileFixture(fixture);
let playing = true;
let tMs = 0;
let dark = true; // 像素风默认暗调吧台
let unitPref: "ml" | "oz" = "ml";
let lastFrame = performance.now();
const frameTimes: number[] = [];

const STAGE = { width: 400, height: 520 };

/* ────────────────────────── 编译 ────────────────────────── */

function compileFixture(f: Fixture): Timeline {
  const t0 = performance.now();
  const tl = compile(f.ir, VOCAB, { stage: STAGE });
  const ms = performance.now() - t0;
  compileEl.textContent = `${ms.toFixed(2)} ms`;
  return tl;
}

/* ────────────────────────── 画布尺寸 ────────────────────────── */

function resize(): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(STAGE.width * dpr);
  canvas.height = Math.round(STAGE.height * dpr);
  canvas.style.width = `${STAGE.width}px`;
  canvas.style.height = `${STAGE.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ────────────────────────── 渲染循环 ────────────────────────── */

function frame(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;

  if (playing) {
    tMs += dt;
    if (tMs >= timeline.totalMs) {
      tMs = timeline.totalMs;
      playing = false;
      playBtn.textContent = "重播";
    }
  }

  const drawStart = performance.now();
  draw();
  const drawMs = performance.now() - drawStart;

  frameTimes.push(drawMs);
  if (frameTimes.length > 120) frameTimes.shift();

  scrub.value = String(Math.round((tMs / timeline.totalMs) * 1000));
  updateFpsReadout(dt);

  requestAnimationFrame(frame);
}

function draw(): void {
  // 12fps 定格感：场景几何按 80ms 步进量化；液流条纹/水花/闪烁仍用原始时间
  const tQ = Math.floor(tMs / 80) * 80;
  const { scene, stepIndex, step, stepProgress } = sample(timeline, tQ);
  renderScene(ctx, scene, {
    theme: dark ? DARK_THEME : LIGHT_THEME,
    timeMs: tQ,
    fxMs: tMs,
    vessel: vesselLookup,
    stage: STAGE,
    serveProgress: step.stepId === "__final" ? stepProgress : undefined,
    debug: debugChk.checked,
  });
  highlightStep(stepIndex);
}

function updateFpsReadout(dt: number): void {
  // 用实际帧间隔算 fps（含浏览器合成开销），用绘制耗时算余量
  const fps = dt > 0 ? 1000 / dt : 0;
  smoothedFps = smoothedFps * 0.9 + fps * 0.1;
  fpsEl.textContent = smoothedFps.toFixed(0);
  fpsEl.className = smoothedFps >= 55 ? "ok" : smoothedFps >= 40 ? "warn" : "bad";

  if (frameTimes.length > 10) {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    frameEl.textContent = `${p50.toFixed(2)} / ${p95.toFixed(2)} ms`;
    // 16.7ms 是 60fps 的预算
    frameEl.className = p95 <= 8 ? "ok" : p95 <= 16.7 ? "warn" : "bad";
  }
}
let smoothedFps = 60;

/* ────────────────────────── UI 构建 ────────────────────────── */

function buildTabs(): void {
  recipeTabs.innerHTML = "";
  for (const f of ALL_FIXTURES) {
    const b = document.createElement("button");
    b.textContent = f.title;
    b.className = f === fixture ? "tab active" : "tab";
    b.onclick = () => selectFixture(f);
    recipeTabs.appendChild(b);
  }
}

function selectFixture(f: Fixture): void {
  fixture = f;
  timeline = compileFixture(f);
  tMs = 0;
  playing = true;
  playBtn.textContent = "暂停";
  buildTabs();
  buildSteps();
  buildMeta();
  buildIngredients();
  runDiagnostics();
  testNote.textContent = f.tests;
}

function buildSteps(): void {
  stepList.innerHTML = "";
  timeline.steps.forEach((s, i) => {
    const li = document.createElement("li");
    li.dataset.index = String(i);
    const t = document.createElement("span");
    t.className = "steptext";
    t.textContent = s.label.zh;
    const en = document.createElement("span");
    en.className = "stepen";
    en.textContent = s.label.en;
    const d = document.createElement("span");
    d.className = "stepdur";
    d.textContent = `${s.durationMs}ms`;
    li.append(t, en, d);
    // 点步骤 → 跳到该步开头（验证「单步回看」）
    li.onclick = () => {
      tMs = s.startMs;
      playing = false;
      playBtn.textContent = "播放";
      draw();
    };
    stepList.appendChild(li);
  });
}

let lastHighlight = -1;
let bannerTimer: number | undefined;
function highlightStep(i: number): void {
  if (i === lastHighlight) return;
  lastHighlight = i;
  for (const li of stepList.children) {
    li.classList.toggle("current", li.getAttribute("data-index") === String(i));
  }
  // 像素风步骤横幅（游戏过场）；定格段展示 SERVE!
  const s = timeline.steps[i];
  if (s) {
    const isFinal = s.stepId === "__final";
    bannerEl.textContent = isFinal ? "★ SERVE! ★" : `STEP ${i + 1} · ${s.label.zh}`;
    bannerEl.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => bannerEl.classList.remove("show"), isFinal ? 1800 : 1100);
  }
}

function buildMeta(): void {
  const abv = estimateAbv(fixture.ir, VOCAB);
  const vol = totalLiquidMl(fixture.ir.ingredients);
  const kf = timeline.steps.reduce((s, x) => s + x.keyframes.length, 0);
  metaEl.innerHTML = "";
  const rows: [string, string][] = [
    ["家族", fixture.family],
    ["杯型", fixture.ir.glass],
    ["手法", fixture.ir.method],
    ["酒精度", abv === null ? "—" : `约 ${abv.toFixed(1)}%`],
    ["液量", `${vol} ml（不含冰融水与补满）`],
    ["时长", `${(timeline.totalMs / 1000).toFixed(2)} s`],
    ["关键帧", `${kf} 帧 / ${timeline.steps.length} 步`],
  ];
  for (const [k, v] of rows) {
    const d = document.createElement("div");
    d.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
    metaEl.appendChild(d);
  }
}

function buildIngredients(): void {
  ingList.innerHTML = "";
  const mls = fixture.ir.ingredients.map((r) => {
    const d = displayAmount(r, unitPref);
    return { ref: r, disp: d };
  });

  // 按份显示（ADR-014）：只在比例足够干净时才有意义
  const volumeMls = fixture.ir.ingredients.map((r) => {
    const k = r.unit;
    if (k !== "ml" && k !== "cl" && k !== "oz") return 0;
    return "amount" in r ? (k === "ml" ? r.amount : k === "cl" ? r.amount * 10 : r.amount * 29.5735) : 0;
  });
  const parts = toParts(volumeMls);
  partsChk.disabled = !parts.clean;
  partsChk.parentElement!.title = parts.clean
    ? "比例足够干净，可按份显示"
    : "比例不干净（如 3 : 1.33 : 1），不提供按份显示";

  mls.forEach(({ ref, disp }, i) => {
    const meta = VOCAB.ingredient(ref.ingredientId);
    const tr = document.createElement("tr");

    const sw = document.createElement("td");
    const dot = document.createElement("i");
    dot.className = "swatch";
    dot.style.background = meta?.viz.color ?? "#ccc";
    sw.appendChild(dot);

    const name = document.createElement("td");
    name.innerHTML = `${meta?.nameZh ?? ref.ingredientId}<em>${meta?.nameEn ?? ""}</em>`;

    const amt = document.createElement("td");
    amt.className = "amt";
    if (partsChk.checked && parts.clean && volumeMls[i]! > 0) {
      amt.textContent = `${parts.parts[i]} 份`;
    } else {
      amt.textContent = disp.text;
      if (disp.approximate) amt.title = disp.exactHint ?? "";
    }

    const role = document.createElement("td");
    role.className = "role";
    role.textContent = ROLE_ZH[ref.role] ?? ref.role;

    tr.append(sw, name, amt, role);
    ingList.appendChild(tr);
  });
}

const ROLE_ZH: Record<string, string> = {
  base: "基酒",
  modifier: "修饰",
  sweetener: "甜味",
  souring: "酸味",
  bittering: "苦味",
  lengthener: "延长",
  texture: "质地",
  rinse: "涮杯",
  garnish: "装饰",
  ice: "冰",
};

function runDiagnostics(): void {
  const r = validateRecipeIR(fixture.ir, VOCAB);
  diagEl.innerHTML = "";
  if (r.errors.length === 0 && r.warnings.length === 0) {
    diagEl.innerHTML = `<div class="diag ok">校验通过，无错误无警告</div>`;
    return;
  }
  for (const d of [...r.errors, ...r.warnings]) {
    const el = document.createElement("div");
    el.className = `diag ${d.severity}`;
    el.innerHTML = `<code>${d.code}</code> ${d.message}${d.path ? ` <span class="path">${d.path}</span>` : ""}`;
    diagEl.appendChild(el);
  }
}

/* ────────────────────────── 控件 ────────────────────────── */

playBtn.onclick = () => {
  if (tMs >= timeline.totalMs) tMs = 0;
  playing = !playing;
  playBtn.textContent = playing ? "暂停" : "播放";
};

scrub.oninput = () => {
  // 拖时间轴 —— 这是验证 seek 正确性的主要手段
  tMs = (Number(scrub.value) / 1000) * timeline.totalMs;
  playing = false;
  playBtn.textContent = "播放";
  draw();
};

speedSel.onchange = () => {
  const ratio = tMs / timeline.totalMs;
  timeline = compile(fixture.ir, VOCAB, { stage: STAGE, speedScale: Number(speedSel.value) });
  tMs = ratio * timeline.totalMs;
  buildSteps();
  buildMeta();
};

themeBtn.textContent = "浅色"; // 初始即暗调
themeBtn.onclick = () => {
  dark = !dark;
  document.body.classList.toggle("dark", dark);
  themeBtn.textContent = dark ? "浅色" : "深色";
  draw();
};

debugChk.onchange = () => draw();

unitBtn.onclick = () => {
  unitPref = unitPref === "ml" ? "oz" : "ml";
  unitBtn.textContent = unitPref === "ml" ? "ml" : "oz";
  buildIngredients();
};

partsChk.onchange = () => buildIngredients();

/** 验证 ADR-015：封面图由前端截帧，服务端零渲染负担。 */
shotBtn.onclick = () => {
  const prev = tMs;
  const wasPlaying = playing;
  playing = false;
  tMs = timeline.finalSceneMs;
  draw();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fixture.title.toLowerCase().replace(/\s+/g, "-")}-cover.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    tMs = prev;
    playing = wasPlaying;
  }, "image/png");
};

window.addEventListener("keydown", (e) => {
  if (e.key === " ") {
    e.preventDefault();
    playBtn.click();
  }
  if (e.key === "ArrowLeft") {
    tMs = Math.max(0, tMs - 100);
    playing = false;
    draw();
  }
  if (e.key === "ArrowRight") {
    tMs = Math.min(timeline.totalMs, tMs + 100);
    playing = false;
    draw();
  }
});

/* ────────────────────────── 启动 ────────────────────────── */

resize();
window.addEventListener("resize", () => {
  resize();
  draw();
});
selectFixture(FIXTURES[0]!);
requestAnimationFrame((t) => {
  lastFrame = t;
  requestAnimationFrame(frame);
});
