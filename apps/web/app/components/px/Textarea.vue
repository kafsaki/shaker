<script setup lang="ts">
/** 凹槽多行输入框（与 PxInput 同一套凹槽样式）。 */
defineOptions({ inheritAttrs: false });
const model = defineModel<string | null>();
</script>

<template>
  <div class="px-area">
    <textarea v-model="model" v-bind="$attrs" class="ta" />
  </div>
</template>

<style scoped>
.px-area {
  display: flex;
  background: var(--deep);
  margin: var(--p);
  box-shadow:
    0 calc(var(--p) * -1) 0 0 var(--ring, var(--ink)),
    0 var(--p) 0 0 var(--ring, var(--ink)),
    calc(var(--p) * -1) 0 0 0 var(--ring, var(--ink)),
    var(--p) 0 0 0 var(--ring, var(--ink)),
    inset var(--p) var(--p) 0 0 var(--lo);
}
.px-area:focus-within { --ring: var(--amber); }
.ta {
  flex: 1;
  min-height: 72px;
  padding: 8px 10px;
  background: transparent;
  color: var(--fg);
  outline: none;
  resize: vertical;
  caret-color: var(--amber);
  font: inherit;
  line-height: 1.75;
}
.ta::placeholder { color: var(--faint); }
</style>
