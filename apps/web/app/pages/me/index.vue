<script setup lang="ts">
/** 设置：资料 / 单位偏好 / 改密 / 我的草稿。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type DraftPage = components["schemas"]["RecipeListOutputBody"];

definePageMeta({ middleware: "auth" });
useHead({ title: "设置 · Shaker" });

const api = useApi();
const auth = useAuthStore();
const qc = useQueryClient();

/* ── 资料 ── */
const displayName = ref("");
const bio = ref("");
const location = ref("");
const website = ref("");
const unitPref = ref<"ml" | "oz">("ml");

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
        unitPreference: unitPref.value,
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

/* ── 草稿 ── */
const { data: drafts } = useQuery({
  queryKey: ["my-drafts"],
  queryFn: async (): Promise<DraftPage> => {
    const { data, error } = await api.GET("/api/v1/me/drafts");
    if (error) throw error;
    return data;
  },
});

async function logoutAll(): Promise<void> {
  await auth.logoutAll();
  toast.success("已在全部设备退出登录");
  await navigateTo("/");
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-5">
    <h1 class="text-xl font-bold">设置</h1>

    <!-- 资料 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">资料</CardTitle>
        <CardDescription>@{{ auth.user?.handle }} · {{ auth.user?.email }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label for="dn">昵称</Label>
          <Input id="dn" v-model="displayName" maxlength="60" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="bio">简介</Label>
          <Textarea id="bio" v-model="bio" maxlength="500" class="min-h-16" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label for="loc">所在地</Label>
            <Input id="loc" v-model="location" maxlength="60" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="web">网站</Label>
            <Input id="web" v-model="website" maxlength="200" placeholder="https://" />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>单位偏好</Label>
          <Select v-model="unitPref">
            <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ml">毫升（ml）</SelectItem>
              <SelectItem value="oz">盎司（oz）</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">影响配方页的原料用量显示（ADR-014 吸附规则）。</p>
        </div>
        <div>
          <Button size="sm" :disabled="saveProfile.isPending.value" @click="saveProfile.mutate()">
            {{ saveProfile.isPending.value ? "保存中…" : "保存" }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 改密 -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">修改密码</CardTitle>
        <CardDescription>成功后其它设备的会话会被撤销</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label for="cp">当前密码</Label>
          <Input id="cp" v-model="currentPassword" type="password" autocomplete="current-password" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label for="np">新密码（至少 8 位）</Label>
            <Input id="np" v-model="newPassword" type="password" autocomplete="new-password" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="npc">确认新密码</Label>
            <Input id="npc" v-model="newPasswordConfirm" type="password" autocomplete="new-password" />
          </div>
        </div>
        <div>
          <Button size="sm" variant="outline" :disabled="changePassword.isPending.value" @click="submitPassword()">
            {{ changePassword.isPending.value ? "修改中…" : "修改密码" }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 草稿 -->
    <Card>
      <CardHeader class="flex-row items-center justify-between">
        <CardTitle class="text-base">我的草稿（{{ (drafts?.items ?? []).length }}）</CardTitle>
        <Button size="sm" variant="outline" as-child>
          <NuxtLink to="/editor/new">写新的</NuxtLink>
        </Button>
      </CardHeader>
      <CardContent class="flex flex-col">
        <template v-if="drafts">
          <NuxtLink
            v-for="d in drafts.items ?? []"
            :key="d.id"
            :to="`/editor/${d.id}`"
            class="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent"
          >
            <span class="min-w-0 truncate text-sm font-medium">{{ d.title }}</span>
            <Badge variant="secondary" class="shrink-0 text-xs">草稿</Badge>
          </NuxtLink>
          <p v-if="(drafts.items ?? []).length === 0" class="py-6 text-center text-sm text-muted-foreground">
            没有草稿
          </p>
        </template>
        <div v-else class="flex flex-col gap-2">
          <Skeleton class="h-9 w-full" />
          <Skeleton class="h-9 w-full" />
        </div>
      </CardContent>
    </Card>

    <Separator />

    <div class="flex justify-between pb-6">
      <span class="text-sm text-muted-foreground">安全</span>
      <Button variant="outline" size="sm" @click="logoutAll()">在全部设备退出登录</Button>
    </div>
  </div>
</template>
