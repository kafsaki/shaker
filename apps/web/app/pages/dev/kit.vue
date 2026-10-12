<script setup lang="ts">
/** 像素组件样式页（活的设计规范）：所有 Px 组件与图标一屏可审。不在导航里，直接访问 /dev/kit。 */
import { PIXEL_ICONS, type PixelIconName } from "@/lib/pixel-icons";
import { BARTENDER, BARTENDER_PALETTE, LOGO_PALETTE, LOGO_SHAKER } from "@/lib/pixel-sprites";
import { toast } from "@/lib/toast";

useHead({ title: "组件样式 · Shaker" });
const { theme } = useTheme();
const icons = Object.keys(PIXEL_ICONS) as PixelIconName[];
const text = ref("");
const sel = ref("sour");
const seg = ref("1");
const tab = ref("hot");
const range = ref([10, 40]);
const star = ref(3);
const check = ref(true);
const open = ref(false);
</script>

<template>
  <div class="flex flex-col gap-8">
    <PxPanel title="ICONS" icon="sparkle">
      <div class="flex flex-wrap gap-3">
        <div v-for="n in icons" :key="n" class="flex w-20 flex-col items-center gap-1 text-dim">
          <PxIcon :name="n" :scale="3" class="text-fg" />
          <span>{{ n }}</span>
        </div>
      </div>
    </PxPanel>

    <PxPanel title="BUTTONS" icon="play" tone="pink">
      <div class="flex flex-wrap items-center gap-3">
        <PxButton variant="primary" icon="play">开始调酒</PxButton>
        <PxButton icon="save">保存草稿</PxButton>
        <PxButton variant="accent" icon="heart">点赞</PxButton>
        <PxButton variant="success" icon="check">确认</PxButton>
        <PxButton variant="danger" icon="trash">删除</PxButton>
        <PxButton variant="ghost" icon="gear">设置</PxButton>
        <PxButton square icon="x" />
        <PxButton size="sm" icon="plus">小按钮</PxButton>
        <PxButton size="lg" variant="primary" icon-right="chevron-right">大按钮</PxButton>
        <PxButton loading>加载</PxButton>
        <PxButton disabled>禁用</PxButton>
        <PxButton active>按下态</PxButton>
      </div>
    </PxPanel>

    <div class="grid gap-8 md:grid-cols-2">
      <PxPanel title="FIELDS" icon="pencil" tone="cyan">
        <div class="flex flex-col gap-3">
          <PxInput v-model="text" icon="search" placeholder="搜配方 / 酒单 / 用户 / 原料…" />
          <PxTextarea placeholder="聊聊这杯酒…" />
          <PxSelect
            v-model="sel"
            :options="[
              { value: 'sour', label: '酸酒' },
              { value: 'highball', label: '高球' },
              { value: 'hot', label: '热饮', group: '其他' },
            ]"
          />
          <PxSlider v-model="range" :max="50" />
          <PxCheckbox v-model="check">记住我</PxCheckbox>
          <PxStars v-model="star" />
        </div>
      </PxPanel>

      <PxPanel title="STATUS" icon="trophy" tone="green">
        <div class="flex flex-col gap-3">
          <PxSegmented v-model="seg" :items="[{ value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]" />
          <PxSegmented
            v-model="tab"
            variant="tabs"
            :items="[{ value: 'hot', label: '热门', icon: 'fire' }, { value: 'new', label: '最新', icon: 'sparkle', count: 12 }]"
          />
          <div class="flex flex-wrap gap-1">
            <PxBadge tone="gold" variant="solid" icon="crown">权威</PxBadge>
            <PxBadge tone="cyan" icon="sparkle">原创</PxBadge>
            <PxBadge tone="green" icon="branch">变体</PxBadge>
            <PxBadge>#柑橘</PxBadge>
            <PxBadge tone="pink" variant="solid">NEW</PxBadge>
          </div>
          <div class="flex items-center gap-2">甜 <PxBar :value="3" /> 烈 <PxBar :value="5" tone="pink" /></div>
          <div class="flex items-center gap-3">
            <PxAvatar seed="kafsaki" :size="48" />
            <PxAvatar seed="user1" :size="32" />
            <PxAvatar seed="bob" :size="64" />
            <PxKbd>SPACE</PxKbd><PxKbd>←</PxKbd>
          </div>
          <div class="flex gap-2">
            <PxButton size="sm" @click="toast.success('已加入「周末酒单」')">toast ok</PxButton>
            <PxButton size="sm" @click="toast.error('请求失败', { description: '网络开小差了' })">toast err</PxButton>
            <PxButton size="sm" @click="toast.info('登录后即可点赞')">toast info</PxButton>
            <PxButton size="sm" @click="open = true">dialog</PxButton>
          </div>
        </div>
      </PxPanel>
    </div>

    <PxDialogue speaker="酒保 · ADA" text="欢迎光临 Shaker。今晚想喝点什么？经典的、热门的，还是你自己调一杯？">
      <template #portrait>
        <PxSprite :rows="BARTENDER" :palette="BARTENDER_PALETTE[theme]" :scale="5" />
      </template>
      <template #choices>
        <PxButton variant="primary" icon="dice">随便来一杯</PxButton>
        <PxButton icon="book">翻翻经典图鉴</PxButton>
      </template>
    </PxDialogue>

    <div class="grid gap-8 md:grid-cols-3">
      <PxPanel title="LOADER" variant="inset" tone="plain"><PxLoader /></PxPanel>
      <PxPanel title="SKELETON" variant="glow"><PxSkeleton class="h-32" /></PxPanel>
      <PxPanel title="SPRITE">
        <div class="flex items-end gap-4">
          <PxSprite :rows="LOGO_SHAKER" :palette="LOGO_PALETTE[theme]" :scale="4" />
          <PxEmpty icon="mail" title="没有新信件" />
        </div>
      </PxPanel>
    </div>

    <PxDialog v-model:open="open" title="加入酒单" icon="bookmark">
      <p>勾选要加入或移出的酒单</p>
      <template #footer>
        <PxButton @click="open = false">取消</PxButton>
        <PxButton variant="primary" @click="open = false">确定</PxButton>
      </template>
    </PxDialog>
  </div>
</template>
