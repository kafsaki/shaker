<script setup lang="ts">
import { Alert, AlertDescription } from "@/components/ui/alert";
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

definePageMeta({ middleware: "guest" });
useHead({ title: "注册 · Shaker" });

const auth = useAuthStore();
const router = useRouter();

const handle = ref("");
const displayName = ref("");
const email = ref("");
const password = ref("");
const passwordConfirm = ref("");
const submitting = ref(false);
const errorMsg = ref("");

async function onSubmit(): Promise<void> {
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(handle.value)) {
    errorMsg.value = "handle 只能包含字母、数字、下划线（2~32 位）";
    return;
  }
  if (password.value.length < 8) {
    errorMsg.value = "密码至少 8 位";
    return;
  }
  if (password.value !== passwordConfirm.value) {
    errorMsg.value = "两次输入的密码不一致";
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
    errorMsg.value = apiErrorMessage(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-sm flex-col gap-6 py-12">
    <Card>
      <CardHeader>
        <CardTitle>注册</CardTitle>
        <CardDescription>加入 Shaker，写下你的第一杯酒</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit()">
          <div class="flex flex-col gap-2">
            <Label for="handle">handle</Label>
            <Input
              id="handle"
              v-model="handle"
              autocomplete="username"
              placeholder="kafsaki"
              pattern="[a-zA-Z0-9_]{2,32}"
              required
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="displayName">昵称</Label>
            <Input
              id="displayName"
              v-model="displayName"
              autocomplete="nickname"
              placeholder="留空则同 handle"
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="email">邮箱</Label>
            <Input
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">密码（至少 8 位）</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password-confirm">确认密码</Label>
            <Input
              id="password-confirm"
              v-model="passwordConfirm"
              type="password"
              autocomplete="new-password"
              required
            />
          </div>
          <Alert v-if="errorMsg" variant="destructive">
            <AlertDescription>{{ errorMsg }}</AlertDescription>
          </Alert>
          <Button type="submit" :disabled="submitting">
            {{ submitting ? "注册中…" : "注册" }}
          </Button>
        </form>
      </CardContent>
    </Card>
    <p class="text-center text-sm text-muted-foreground">
      已有账号？
      <NuxtLink to="/login" class="text-primary underline-offset-4 hover:underline">
        登录
      </NuxtLink>
    </p>
  </div>
</template>
