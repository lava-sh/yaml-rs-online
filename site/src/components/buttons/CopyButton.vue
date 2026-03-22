<script setup lang="ts">
defineProps<{
  copied: boolean;
  label: string;
  title: string;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="copy-btn"
    :class="{ copied }"
    type="button"
    :aria-label="label"
    :title="title"
    @click="emit('click')"
  >
    <svg class="copy-icon copy-idle" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v4" />
      <path d="M21 14H11" />
      <path d="m15 10-4 4 4 4" />
    </svg>
    <svg class="copy-icon copy-done" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v4" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  </button>
</template>
