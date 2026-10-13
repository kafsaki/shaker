<script setup lang="ts">
/**
 * 系统设置（游戏 OPTIONS 菜单）：角色资料 / 头像 / 游戏偏好 / 账号安全。
 * 左侧竖排指令菜单切换右侧面板（↑↓ 键可移动光标）；窄屏改成顶部页签。当前分区记在 ?s= 上，刷新不丢。
 * 仅本人可见可访问：他人（handle 不匹配）一律重定向回该用户主页。
 * 「游戏偏好」是纯前端设置（主题 / 音效 / CRT / 减少动效），只存本机。
 */
import { useMutation } from "@tanstack/vue-query";
import type { Prefs } from "@/composables/usePrefs";
import type { PixelIconName } from "@/lib/pixel-icons";
import { toast } from "@/lib/toast";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const router = useRouter();
const api = useApi();
const auth = useAuthStore();
const { play } = useSfx();
const handle = computed(() => String(route.params.handle ?? ""));

// 权限：设置仅本人。middleware 已保证登录，这里仅拦「登录了但不是本人」。
watch(
  () => auth.user?.handle,
  (h) => {
    if (h && h !== handle.value) void navigateTo(`/u/${handle.value}`);
  },
  { immediate: true },
);

/* ── 分区菜单 ── */
const SECTIONS: { value: string; label: string; short: string; icon: PixelIconName }[] = [
  { value: "profile", label: "角色资料", short: "资料", icon: "user" },
  { value: "avatar", label: "头像", short: "头像", icon: "sparkle" },
  { value: "prefs", label: "游戏偏好", short: "偏好", icon: "gear" },
  { value: "security", label: "账号安全", short: "安全", icon: "lock" },
];
const initial = String(route.query.s ?? "");
const section = ref(SECTIONS.some((s) => s.value === initial) ? initial : "profile");
watch(section, (s) => {
  void router.replace({ query: s === "profile" ? {} : { s } });
});
// 窄屏页签用短名，四个一行放得下
const tabItems = SECTIONS.map((s) => ({ value: s.value, label: s.short }));

function pick(v: string): void {
  if (section.value === v) return;
  play("step");
  section.value = v;
}

/** 竖排菜单的 ↑↓ / Home / End：像游戏菜单那样移动光标。 */
function onMenuKey(e: KeyboardEvent): void {
  const i = SECTIONS.findIndex((s) => s.value === section.value);
  let next = i;
  if (e.key === "ArrowDown") next = (i + 1) % SECTIONS.length;
  else if (e.key === "ArrowUp") next = (i - 1 + SECTIONS.length) % SECTIONS.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = SECTIONS.length - 1;
  else return;
  e.preventDefault();
  const v = SECTIONS[next]!.value;
  pick(v);
  void nextTick(() => document.getElementById(`opt-tab-${v}`)?.focus());
}

/* ── 资料 ── */
const displayName = ref("");
const bio = ref("");
const location = ref("");
const website = ref("");
// PxSegmented 的 v-model 是 string；提交时再收窄成 ml / oz
const unitPref = ref<string>("ml");
const UNIT_ITEMS = [
  { value: "ml", label: "毫升 ml" },
  { value: "oz", label: "盎司 oz" },
];

watch(
  () => auth.user,
  (u) => {
    if (!u) return;
    displayName.value = u.displayName;
    bio.value = u.bio ?? "";
    location.value = u.location ?? "";
    website.value = u.website ?? "";
    unitPref.value = u.unitPreference === "oz" ? "oz" : "ml";
  },
  { immediate: true },
);

const saveProfile = useMutation({
  mutationFn: async () => {
    const { error } = await api.PATCH("/api/v1/me", {
      body: {
        displayName: displayName.value.trim(),
        bio: bio.value.trim() || undefined,
        location: location.value.trim() || undefined,
        website: website.value.trim() || undefined,
        unitPreference: unitPref.value === "oz" ? "oz" : "ml",
      },
    });
    if (error) throw error;
  },
  onSuccess: async () => {
    toast.success("已保存");
    await auth.fetchMe();
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

/* ── 头像 ── */
const fileInput = ref<HTMLInputElement | null>(null);

/** 中心方形裁切 + 缩到 512px，重编码 PNG（canvas 技术同封面截帧，ADR-015）。 */
async function squareize(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const size = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.drawImage(
    img,
    (img.width - side) / 2,
    (img.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  img.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("头像编码失败");
  return blob;
}

const uploadAvatar = useMutation({
  mutationFn: async (file: File) => {
    // 直传链路同编辑器封面：presign → PUT → commit → 写回指针（ADR-015）
    const blob = await squareize(file);
    const up = await api.POST("/api/v1/media/upload-url", {
      body: {
        purpose: "user_avatar" as const,
        entityId: auth.user!.id,
        mimeType: "image/png" as const,
        byteSize: blob.size,
      },
    });
    if (up.error) throw up.error;
    const put = await fetch(up.data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: blob,
    });
    if (!put.ok) throw new Error(`头像上传失败（${put.status}）`);
    const commit = await api.POST("/api/v1/media/{assetId}/commit", {
      params: { path: { assetId: up.data.assetId } },
    });
    if (commit.error) throw commit.error;
    const { error } = await api.PATCH("/api/v1/me", {
      body: { avatarUrl: commit.data.url },
    });
    if (error) throw error;
  },
  onSuccess: async () => {
    toast.success("头像已更新");
    await auth.fetchMe();
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

function onAvatarChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重选同一文件
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    toast.error("仅支持 PNG / JPEG / WebP");
    return;
  }
  if (file.size > 10 << 20) {
    toast.error("图片不能超过 10MB");
    return;
  }
  uploadAvatar.mutate(file);
}

/* ── 游戏偏好（纯前端，只存本机） ── */
const { theme, toggleTheme } = useTheme();
const { prefs, setPref } = usePrefs();

const THEME_ITEMS = [
  { value: "dark", label: "夜班", icon: "moon" as const },
  { value: "light", label: "日班", icon: "sun" as const },
];
const ON_OFF = [
  { value: "on", label: "开" },
  { value: "off", label: "关" },
];

const themeModel = computed({
  get: () => theme.value,
  set: (v: string) => {
    if (v !== theme.value) toggleTheme();
  },
});

/** 布尔偏好 ↔ [开][关] 分段键。 */
function onOffModel(key: keyof Prefs) {
  return computed({
    get: () => (prefs.value[key] ? "on" : "off"),
    set: (v: string) => {
      setPref(key, v === "on");
      // 刚打开音效时响一声，让玩家立刻知道「有声音了」（setPref 之后 play 才放行）
      if (key === "sound" && v === "on") play("coin");
    },
  });
}
const soundModel = onOffModel("sound");
const crtModel = onOffModel("crt");
const calmModel = onOffModel("calm");

/* ── 改密 ── */
const currentPassword = ref("");
const newPassword = ref("");
const newPasswordConfirm = ref("");

const changePassword = useMutation({
  mutationFn: async () => {
    const { error } = await api.POST("/api/v1/me/password", {
      body: {
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      },
    });
    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("密码已修改，其它会话已撤销");
    currentPassword.value = "";
    newPassword.value = "";
    newPasswordConfirm.value = "";
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

function submitPassword(): void {
  if (newPassword.value.length < 8) {
    toast.error("新密码至少 8 位");
    return;
  }
  if (newPassword.value !== newPasswordConfirm.value) {
    toast.error("两次输入的新密码不一致");
    return;
  }
  changePassword.mutate();
}

/* ── 全设备退出（二次确认） ── */
const confirmLogoutAll = ref(false);
const loggingOut = ref(false);

async function logoutAll(): Promise<void> {
  loggingOut.value = true;
  try {
    await auth.logoutAll();
    toast.success("已在全部设备退出登录");
    await navigateTo("/");
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
    <!-- 页头：bare 分支没有资料头，自己交代「这是哪」 -->
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="flex flex-wrap items-baseline gap-x-3 text-xl text-fg">
          系统设置
          <span class="font-logo text-[16px] text-amber text-shadow-px">· OPTIONS</span>
        </h1>
        <p class="text-faint">@{{ auth.user?.handle }} · {{ auth.user?.email }}</p>
      </div>
      <PxButton variant="ghost" size="sm" icon="chevron-left" :to="`/u/${handle}`">返回角色面板</PxButton>
    </header>

    <!-- 窄屏：顶部页签 -->
    <PxSegmented v-model="section" variant="tabs" :items="tabItems" class="md:!hidden" />

    <div class="grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <!-- 宽屏：竖排指令菜单 -->
      <div class="hidden md:sticky md:top-20 md:block">
        <PxPanel title="MENU" icon="list" tone="plain" :padded="false">
          <nav
            role="tablist"
            aria-orientation="vertical"
            aria-label="设置分区"
            class="flex flex-col py-2"
            @keydown="onMenuKey"
          >
            <button
              v-for="s in SECTIONS"
              :id="`opt-tab-${s.value}`"
              :key="s.value"
              type="button"
              role="tab"
              :aria-selected="section === s.value"
              :tabindex="section === s.value ? 0 : -1"
              class="cmd"
              :class="{ on: section === s.value }"
              @click="pick(s.value)"
            >
              <span class="cur" aria-hidden="true">▶</span>
              <PxIcon :name="s.icon" :scale="2" />
              <span>{{ s.label }}</span>
            </button>
          </nav>
          <p class="flex items-center gap-1 border-t-2 border-dashed border-line px-3 py-2 text-faint">
            <PxKbd>↑</PxKbd><PxKbd>↓</PxKbd> 移动光标
          </p>
        </PxPanel>
      </div>

      <div class="min-w-0">
        <!-- 角色资料 -->
        <PxPanel v-if="section === 'profile'" title="角色资料" icon="user">
          <form class="flex flex-col gap-4" @submit.prevent="saveProfile.mutate()">
            <div class="flex flex-col gap-1">
              <label for="dn" class="text-dim">昵称</label>
              <PxInput id="dn" v-model="displayName" maxlength="60" />
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <label for="bio" class="text-dim">简介</label>
                <span class="font-logo text-[8px] text-faint">{{ bio.length }}/500</span>
              </div>
              <PxTextarea id="bio" v-model="bio" maxlength="500" placeholder="介绍一下你的吧台风格…" />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-1">
                <label for="loc" class="text-dim">所在地</label>
                <PxInput id="loc" v-model="location" icon="globe" maxlength="60" />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <label for="web" class="text-dim">网站</label>
                <PxInput id="web" v-model="website" icon="share" maxlength="200" placeholder="https://" />
              </div>
            </div>
            <SettingsOptionRow label="单位偏好" desc="影响配方页的原料用量显示（ADR-014 吸附规则）。" icon="dropper">
              <PxSegmented v-model="unitPref" :items="UNIT_ITEMS" />
            </SettingsOptionRow>
            <div class="flex justify-end border-t-2 border-dashed border-line pt-4">
              <PxButton type="submit" variant="primary" icon="save" sfx="confirm" :loading="saveProfile.isPending.value">
                {{ saveProfile.isPending.value ? "保存中…" : "保存" }}
              </PxButton>
            </div>
          </form>
        </PxPanel>

        <!-- 头像 -->
        <PxPanel v-else-if="section === 'avatar'" title="头像" icon="sparkle" tone="pink">
          <div class="flex flex-wrap items-center gap-6">
            <div class="flex items-end gap-4">
              <PxAvatar :src="auth.user?.avatarUrl" :seed="auth.user?.handle" :size="96" />
              <div class="flex items-end gap-3 text-faint">
                <div class="flex flex-col items-center gap-1">
                  <PxAvatar :src="auth.user?.avatarUrl" :seed="auth.user?.handle" :size="48" />
                  <span class="font-logo text-[8px]">M</span>
                </div>
                <div class="flex flex-col items-center gap-1">
                  <PxAvatar :src="auth.user?.avatarUrl" :seed="auth.user?.handle" :size="32" />
                  <span class="font-logo text-[8px]">S</span>
                </div>
              </div>
            </div>
            <div class="flex min-w-0 flex-1 flex-col items-start gap-2">
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                class="hidden"
                @change="onAvatarChange"
              />
              <PxButton icon="folder" :loading="uploadAvatar.isPending.value" @click="fileInput?.click()">
                {{ uploadAvatar.isPending.value ? "上传中…" : "更换头像" }}
              </PxButton>
              <p class="text-dim">PNG / JPEG / WebP，自动裁为 512px 方形。</p>
              <p class="flex items-start gap-1 text-faint">
                <PxIcon name="info" :scale="1" class="mt-1 shrink-0" />
                头像会被像素化显示：任何照片都会变成像素立绘；没有头像时按 handle 生成专属图腾。
              </p>
            </div>
          </div>
        </PxPanel>

        <!-- 游戏偏好 -->
        <PxPanel v-else-if="section === 'prefs'" title="游戏偏好" icon="gear" tone="cyan">
          <div class="flex flex-col">
            <SettingsOptionRow label="主题" desc="夜班是暗调吧台，日班是羊皮纸酒馆。" :icon="theme === 'dark' ? 'moon' : 'sun'">
              <PxSegmented v-model="themeModel" :items="THEME_ITEMS" />
            </SettingsOptionRow>
            <SettingsOptionRow label="音效" desc="按键、翻页与提示的 8-bit 音效。" icon="coin">
              <PxSegmented v-model="soundModel" :items="ON_OFF" />
            </SettingsOptionRow>
            <SettingsOptionRow label="CRT 扫描线" desc="给画面叠一层老显像管的扫描线与暗角。" icon="eye">
              <PxSegmented v-model="crtModel" :items="ON_OFF" />
            </SettingsOptionRow>
            <SettingsOptionRow
              label="减少动效"
              desc="停掉闪烁、跳动与过渡动画（系统开了「减少动态效果」时始终生效）。"
              icon="pause"
            >
              <PxSegmented v-model="calmModel" :items="ON_OFF" />
            </SettingsOptionRow>
          </div>
          <p class="mt-2 border-t-2 border-dashed border-line pt-3 text-faint">
            这些偏好只保存在本机浏览器，不随账号同步。
          </p>
        </PxPanel>

        <!-- 账号安全 -->
        <div v-else class="flex flex-col gap-6">
          <PxPanel title="修改密码" icon="lock" tone="green">
            <form class="flex flex-col gap-4" @submit.prevent="submitPassword()">
              <p class="text-faint">成功后其它设备的会话会被撤销。</p>
              <div class="flex flex-col gap-1">
                <label for="cp" class="text-dim">当前密码</label>
                <PxInput id="cp" v-model="currentPassword" icon="lock" type="password" autocomplete="current-password" />
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="flex min-w-0 flex-col gap-1">
                  <label for="np" class="text-dim">新密码（至少 8 位）</label>
                  <PxInput id="np" v-model="newPassword" icon="lock" type="password" autocomplete="new-password" />
                </div>
                <div class="flex min-w-0 flex-col gap-1">
                  <label for="npc" class="text-dim">确认新密码</label>
                  <PxInput id="npc" v-model="newPasswordConfirm" icon="lock" type="password" autocomplete="new-password" />
                </div>
              </div>
              <div class="flex justify-end">
                <PxButton type="submit" icon="check" :loading="changePassword.isPending.value">
                  {{ changePassword.isPending.value ? "修改中…" : "修改密码" }}
                </PxButton>
              </div>
            </form>
          </PxPanel>

          <PxPanel title="危险区" icon="warn" tone="pink" variant="inset">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-fg">在全部设备退出登录</p>
                <p class="text-faint">撤销所有设备上的登录会话，包括当前这台。</p>
              </div>
              <PxButton variant="danger" icon="logout" @click="confirmLogoutAll = true">
                在全部设备退出登录
              </PxButton>
            </div>
          </PxPanel>
        </div>
      </div>
    </div>

    <PxDialog
      v-model:open="confirmLogoutAll"
      title="在全部设备退出登录"
      icon="warn"
      tone="red"
      size="sm"
      description="所有设备（包括这台）都会立即退出，之后需要重新读取存档。确定吗？"
    >
      <template #footer>
        <PxButton sfx="cancel" @click="confirmLogoutAll = false">取消</PxButton>
        <PxButton variant="danger" icon="logout" :loading="loggingOut" @click="logoutAll()">
          确认退出
        </PxButton>
      </template>
    </PxDialog>
  </div>
</template>

<style scoped>
/* 竖排指令：选中项 ▶ 光标闪烁 + 琥珀高亮条，像 RPG 的指令窗 */
.cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px 0 8px;
  color: var(--dim);
  text-align: left;
}
.cmd:hover { color: var(--fg); background: var(--panel-hi); }
.cmd .cur { visibility: hidden; width: 10px; font-size: 10px; color: var(--amber); }
.cmd.on {
  color: var(--amber);
  background: var(--panel-lo);
  box-shadow: inset calc(var(--p) * 2) 0 0 0 var(--amber);
}
.cmd.on .cur { visibility: visible; animation: px-blink 0.8s steps(1) infinite; }
</style>
