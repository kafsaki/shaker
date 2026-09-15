<script setup lang="ts">
/** 原料选择 combobox：Command 搜索 169 个词表条目。 */
import { computed, ref } from "vue";
import { Check, ChevronsUpDown, Search } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Command,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CATEGORY_ZH } from "@/lib/labels";

const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const vocab = useVocabStore();
const open = ref(false);
const q = ref("");

const selected = computed(() =>
  props.modelValue ? vocab.ingMap.get(props.modelValue) : undefined,
);

const groups = computed(() => {
  const items = vocab.ingredients;
  const kw = q.value.trim().toLowerCase();
  const filtered = kw
    ? items.filter(
        (i) =>
          i.id.includes(kw) ||
          i.nameZh.includes(kw) ||
          (i.nameEn ?? "").toLowerCase().includes(kw) ||
          (i.aliases ?? []).some((a) => a.toLowerCase().includes(kw)),
      )
    : items;
  const byCat = new Map<string, typeof filtered>();
  for (const i of filtered) {
    const list = byCat.get(i.category) ?? [];
    list.push(i);
    byCat.set(i.category, list);
  }
  return [...byCat.entries()]
    .filter(([c]) => c !== "ice")
    .map(([c, list]) => ({
      label: CATEGORY_ZH[c] ?? c,
      items: list.slice(0, 40),
    }));
});
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        role="combobox"
        :aria-expanded="open"
        class="h-9 w-full justify-between font-normal"
      >
        <span v-if="selected" class="truncate">
          {{ selected.nameZh }}
          <span class="text-xs text-muted-foreground">{{ selected.nameEn }}</span>
        </span>
        <span v-else class="text-muted-foreground">选择原料…</span>
        <ChevronsUpDown class="ml-1 size-3.5 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 p-0" align="start">
      <Command>
        <CommandInput v-model="q" placeholder="搜原料名 / 别名 / ID…" />
        <CommandList>
          <CommandEmpty>没找到原料</CommandEmpty>
          <CommandGroup
            v-for="g in groups"
            :key="g.label"
            :heading="g.label"
          >
            <CommandItem
              v-for="i in g.items"
              :key="i.id"
              :value="`${i.nameZh} ${i.nameEn} ${i.id} ${(i.aliases ?? []).join(' ')}`"
              @select="
                emit('update:modelValue', i.id);
                open = false;
              "
            >
              <Check
                class="mr-1 size-3.5"
                :class="modelValue === i.id ? 'opacity-100' : 'opacity-0'"
              />
              {{ i.nameZh }}
              <span class="ml-1 text-xs text-muted-foreground">{{ i.nameEn }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
  <p v-if="selected" class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
    <Search class="size-3" /> {{ selected.id }}
  </p>
</template>
