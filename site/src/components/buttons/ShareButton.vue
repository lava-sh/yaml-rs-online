<script setup lang="ts">
defineProps<{
  shared: boolean;
  label: string;
  title: string;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="share-btn"
    :class="{ shared }"
    type="button"
    :aria-label="label"
    :title="title"
    @click="emit('click')"
  >
    <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V4" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M7 13.5v5A1.5 1.5 0 0 0 8.5 20h7a1.5 1.5 0 0 0 1.5-1.5v-5" />
    </svg>
  </button>
</template>
