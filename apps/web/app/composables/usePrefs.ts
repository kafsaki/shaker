/**
 * 「系统设置」里的前端偏好（只存本机 localStorage，不进账号）：
 * - sound：8-bit 音效，默认关（网页突然出声太冒犯，首次需要玩家自己打开）
 * - crt：扫描线 + 暗角氛围层，默认开
 * - calm：减少动效（停掉循环动画与过渡）
 * 主题仍走 useTheme（封面取图、动画主题都依赖它）。
 */
export interface Prefs {
  sound: boolean;
  crt: boolean;
  calm: boolean;
}

const KEY = "shaker_prefs";

function load(): Prefs {
  const d: Prefs = { sound: false, crt: true, calm: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // 坏数据就用默认值
  }
  return d;
}

export function usePrefs() {
  const prefs = useState<Prefs>("shaker-prefs", () => ({ sound: false, crt: true, calm: false }));

  function apply(): void {
    const el = document.documentElement;
    el.classList.toggle("crt", prefs.value.crt);
    el.classList.toggle("calm", prefs.value.calm);
    localStorage.setItem(KEY, JSON.stringify(prefs.value));
  }

  function initPrefs(): void {
    prefs.value = load();
    apply();
  }

  function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    prefs.value = { ...prefs.value, [key]: value };
    apply();
  }

  return { prefs, initPrefs, setPref };
}
