<script setup lang="ts">
/** 我的酒单：列表 + 新建。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Plus } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { components } from "@shaker/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type MyMenu = components["schemas"]["MyMenuBody"];

definePageMeta({ middleware: "auth" });
useHead({ title: "我的酒单 · Shaker" });

const api = useApi();
const qc = useQueryClient();

const { data: menus, isLoading } = useQuery({
  queryKey: ["my-menus", "list"],
  queryFn: async (): Promise<MyMenu[]> => {
    const { data, error } = await api.GET("/api/v1/me/menus");
    if (error) throw error;
    return data.items ?? [];
  },
});

const open = ref(false);
const title = ref("");
const visibility = ref<"private" | "unlisted" | "public">("private");

const create = useMutation({
  mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/menus", {
      body: { title: title.value.trim(), visibility: visibility.value },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    toast.success("酒单已创建");
    title.value = "";
    open.value = false;
    void qc.invalidateQueries({ queryKey: ["my-menus"] });
  },
  onError: (e) => toast.error(apiErrorMessage(e)),
});

const VIS_ZH: Record<string, string> = {
  public: "公开",
  unlisted: "不列出",
  private: "私密",
};
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">我的酒单</h1>
      <Dialog v-model:open="open">
        <DialogTrigger as-child>
          <Button><Plus class="size-4" /> 新建酒单</Button>
        </DialogTrigger>
        <DialogContent class="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新建酒单</DialogTitle>
            <DialogDescription>把喜欢的配方收进一份酒单</DialogDescription>
          </DialogHeader>
          <form
            class="flex flex-col gap-3"
            @submit.prevent="title.trim() && create.mutate()"
          >
            <div class="flex flex-col gap-1.5">
              <Label for="menu-title">名称</Label>
              <Input id="menu-title" v-model="title" maxlength="60" placeholder="家里能做的十杯" />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label>可见性</Label>
              <Select v-model="visibility">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私密（仅自己）</SelectItem>
                  <SelectItem value="unlisted">不列出（链接可访问）</SelectItem>
                  <SelectItem value="public">公开</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" :disabled="create.isPending.value || !title.trim()">
              {{ create.isPending.value ? "创建中…" : "创建" }}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>

    <div v-if="isLoading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="h-24 rounded-xl" />
    </div>

    <p v-else-if="(menus ?? []).length === 0" class="py-16 text-center text-sm text-muted-foreground">
      还没有酒单。也可以在配方页点「收藏」直接加入。
    </p>

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="m in menus ?? []"
        :key="m.id"
        :to="`/menus/${m.id}`"
        class="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-medium">{{ m.title }}</span>
          <Badge variant="secondary">{{ VIS_ZH[m.visibility] ?? m.visibility }}</Badge>
        </div>
        <span class="text-xs text-muted-foreground">{{ m.itemCount }} 杯</span>
      </NuxtLink>
    </div>
  </div>
</template>
