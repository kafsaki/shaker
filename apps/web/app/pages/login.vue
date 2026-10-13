<script setup lang="ts">
/**
 * 登录 = 游戏标题画面「读取存档」：招牌 + 闪烁的 PRESS START + 读档窗口。
 * 读档失败时红框报错、窗口抖一下（每次失败都重播），并播放错误音。
 */
import { LOGO_PALETTE, LOGO_SHAKER } from "@/lib/pixel-sprites";

definePageMeta({ middleware: "guest" });
useHead({ title: "读取存档 · Shaker" });

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { theme } = useTheme();
const { play } = useSfx();

const identifier = ref("");
const password = ref("");
const submitting = ref(false);
const errorMsg = ref("");
/** 失败计数：只用来触发抖动（每变一次抖一次）。 */
const fails = ref(0);

const idInput = ref<{ focus: () => void } | null>(null);

// PRESS START 不是装饰：按下就把光标送进读档窗口
function pressStart(): void {
  play("start");
  idInput.value?.focus();
}

async function onSubmit(): Promise<void> {
  if (!identifier.value.trim() || !password.value) return;
  submitting.value = true;
  errorMsg.value = "";
  try {
    await auth.login(identifier.value.trim(), password.value);
    const redirect =
      typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.replace(redirect);
  } catch (err) {
    errorMsg.value = apiErrorMessage(err);
    fails.value++;
    play("error");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-md flex-col items-center gap-8 py-6 md:py-12">
    <!-- 标题屏招牌 -->
    <header class="flex flex-col items-center gap-3 text-center">
      <div class="flex items-center gap-4">
        <PxSprite :rows="LOGO_SHAKER" :palette="LOGO_PALETTE[theme]" :scale="4" class="animate-bob" />
        <h1 class="logo font-logo text-amber">SHAKER</h1>
      </div>
      <p class="font-logo text-[8px] tracking-[0.4em] text-dim">— ★ PIXEL BAR ★ —</p>
      <button
        type="button"
        class="mt-2 animate-blink font-logo text-[16px] text-pink text-shadow-px"
        @click="pressStart()"
      >
        PRESS START
      </button>
    </header>

    <!-- 读档窗口 -->
    <TitleShake :trigger="fails" class="w-full">
      <PxPanel title="读取存档" icon="save">
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit()">
          <p class="text-faint">输入 handle 或邮箱，继续上次的营业。</p>
          <div class="flex flex-col gap-1">
            <label for="identifier" class="text-dim">handle 或邮箱</label>
            <PxInput
              id="identifier"
              ref="idInput"
              v-model="identifier"
              icon="user"
              size="lg"
              autocomplete="username"
              placeholder="kafsaki"
              required
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="password" class="text-dim">密码</label>
            <PxInput
              id="password"
              v-model="password"
              icon="lock"
              size="lg"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <TitleAlert v-if="errorMsg" title="LOAD FAILED" :message="errorMsg" />
          <PxButton type="submit" variant="primary" size="lg" block sfx="start" :loading="submitting">
            {{ submitting ? "读取中…" : "▶ 继续游戏" }}
          </PxButton>
        </form>
      </PxPanel>
    </TitleShake>

    <p class="text-dim">
      没有存档？
      <NuxtLink to="/register" class="text-amber hover:text-amber-hi hover:underline">→ 新游戏</NuxtLink>
    </p>
  </div>
</template>

<style scoped>
/* 招牌字：琥珀暗边 + 墨色硬投影两层叠出街机立体感；移动端 32px 才放得下一行 */
.logo {
  font-size: 32px;
  line-height: 1;
  text-shadow:
    var(--p) var(--p) 0 var(--amber-lo),
    calc(var(--p) * 2) calc(var(--p) * 2) 0 var(--ink);
}
@media (min-width: 640px) {
  .logo { font-size: 48px; }
}
</style>
