<script setup lang="ts">
useTheme()
</script>

<template>
  <VitePwaManifest />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ToastHost />
  <BottomDock />
</template>
