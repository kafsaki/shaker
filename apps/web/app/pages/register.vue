<script setup lang="ts">
/**
 * 注册 =「新游戏 · 创建角色」：左边角色卡随表单实时变化（图腾跟着 handle 生成），
 * 右边是建档表单。校验规则与文案照旧；任何报错都红框显示 + 窗口抖动 + 错误音。
 */
definePageMeta({ middleware: "guest" });
useHead({ title: "新游戏 · Shaker" });

const auth = useAuthStore();
const router = useRouter();
const { play } = useSfx();

const handle = ref("");
const displayName = ref("");
const email = ref("");
const password = ref("");
const passwordConfirm = ref("");
const submitting = ref(false);
const errorMsg = ref("");
/** 失败计数：只用来触发抖动（每变一次抖一次）。 */
const fails = ref(0);

/* ── 角色卡预览 ── */
const previewHandle = computed(() => handle.value.trim());
const previewName = computed(() => displayName.value.trim() || previewHandle.value);

function fail(msg: string): void {
  errorMsg.value = msg;
  fails.value++;
  play("error");
}

async function onSubmit(): Promise<void> {
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(handle.value)) {
    fail("handle 只能包含字母、数字、下划线（2~32 位）");
    return;
  }
  if (password.value.length < 8) {
    fail("密码至少 8 位");
    return;
  }
  if (password.value !== passwordConfirm.value) {
    fail("两次输入的密码不一致");
    return;
  }
  submitting.value = true;
  errorMsg.value = "";
  try {
    await auth.register({
      handle: handle.value.trim(),
      email: email.value.trim(),
      password: password.value,
      displayName: displayName.value.trim() || handle.value.trim(),
    });
    await router.replace("/");
  } catch (err) {
    fail(apiErrorMessage(err));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 py-2 md:py-8">
    <header class="flex flex-col items-center gap-1 text-center">
      <p class="font-logo text-[16px] text-amber text-shadow-px">NEW GAME</p>
      <h1 class="text-xl text-fg">新游戏 · 创建角色</h1>
      <p class="text-dim">登记你的调酒师档案，写下你的第一杯酒。</p>
    </header>

    <div class="grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
      <!-- 角色卡：实时预览 -->
      <PxPanel title="角色卡" icon="user" tone="pink" variant="glow">
        <!-- 窄屏横排（头像在左）省出纵向空间给表单；宽屏竖排成一张立绘卡 -->
        <div class="flex items-center gap-5 md:flex-col md:gap-3 md:text-center">
          <div class="relative shrink-0">
            <PxAvatar :seed="previewHandle" :size="96" class="animate-bob" />
            <span class="absolute -right-3 -top-2 bg-pink px-1 font-logo text-[8px] text-on-accent px-ring">1P</span>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-2 md:w-full md:items-center">
            <div class="flex w-full min-w-0 flex-col">
              <p class="w-full truncate text-xl" :class="previewName ? 'text-fg' : 'text-faint'">
                {{ previewName || "？？？" }}
              </p>
              <p class="w-full truncate" :class="previewHandle ? 'text-dim' : 'text-faint'">
                @{{ previewHandle || "handle" }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <PxBadge tone="gold" variant="solid" icon="crown">见习酒保</PxBadge>
              <span class="font-logo text-[8px] text-amber">LV.1</span>
            </div>
            <div class="flex w-full items-center gap-2 text-faint md:justify-center md:border-t-2 md:border-dashed md:border-line md:pt-3">
              <span class="font-logo text-[8px]">EXP</span>
              <PxBar :value="0" :max="10" :cells="10" :cell-width="8" />
            </div>
          </div>
        </div>
      </PxPanel>

      <!-- 建档表单 -->
      <TitleShake :trigger="fails" class="min-w-0">
        <PxPanel title="角色档案" icon="pencil">
          <form class="flex flex-col gap-4" @submit.prevent="onSubmit()">
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-1">
                <label for="handle" class="text-dim">handle</label>
                <PxInput
                  id="handle"
                  v-model="handle"
                  icon="user"
                  autocomplete="username"
                  placeholder="kafsaki"
                  pattern="[a-zA-Z0-9_]{2,32}"
                  required
                />
                <p class="text-faint">字母 / 数字 / 下划线，2~32 位</p>
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <label for="displayName" class="text-dim">昵称</label>
                <PxInput
                  id="displayName"
                  v-model="displayName"
                  icon="pencil"
                  autocomplete="nickname"
                  placeholder="留空则同 handle"
                />
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label for="email" class="text-dim">邮箱</label>
              <PxInput
                id="email"
                v-model="email"
                icon="mail"
                type="email"
                autocomplete="email"
                required
              />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-1">
                <label for="password" class="text-dim">密码（至少 8 位）</label>
                <PxInput
                  id="password"
                  v-model="password"
                  icon="lock"
                  type="password"
                  autocomplete="new-password"
                  minlength="8"
                  required
                />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <label for="password-confirm" class="text-dim">确认密码</label>
                <PxInput
                  id="password-confirm"
                  v-model="passwordConfirm"
                  icon="lock"
                  type="password"
                  autocomplete="new-password"
                  required
                />
              </div>
            </div>
            <TitleAlert v-if="errorMsg" :message="errorMsg" />
            <PxButton type="submit" variant="primary" size="lg" block sfx="start" :loading="submitting">
              {{ submitting ? "建档中…" : "▶ 开始游戏" }}
            </PxButton>
          </form>
        </PxPanel>
      </TitleShake>
    </div>

    <p class="text-center text-dim">
      已有存档？
      <NuxtLink to="/login" class="text-amber hover:text-amber-hi hover:underline">→ 读取存档</NuxtLink>
    </p>
  </div>
</template>
