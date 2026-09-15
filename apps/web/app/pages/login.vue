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
useHead({ title: "登录 · Shaker" });

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const identifier = ref("");
const password = ref("");
const submitting = ref(false);
const errorMsg = ref("");

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
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-sm flex-col gap-6 py-12">
    <Card>
      <CardHeader>
        <CardTitle>登录</CardTitle>
        <CardDescription>用 handle 或邮箱登录 Shaker</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit()">
          <div class="flex flex-col gap-2">
            <Label for="identifier">handle 或邮箱</Label>
            <Input
              id="identifier"
              v-model="identifier"
              autocomplete="username"
              placeholder="kafsaki"
              required
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">密码</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <Alert v-if="errorMsg" variant="destructive">
            <AlertDescription>{{ errorMsg }}</AlertDescription>
          </Alert>
          <Button type="submit" :disabled="submitting">
            {{ submitting ? "登录中…" : "登录" }}
          </Button>
        </form>
      </CardContent>
    </Card>
    <p class="text-center text-sm text-muted-foreground">
      还没有账号？
      <NuxtLink to="/register" class="text-primary underline-offset-4 hover:underline">
        注册
      </NuxtLink>
    </p>
  </div>
</template>
