<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({
  title: 'Choose a new password · Daily Agenda',
  meta: [{ name: 'referrer', content: 'no-referrer' }],
})

const auth = useAuthStore()
const toast = useToast()
const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const formError = ref('')
const errors = reactive({ password: '', confirm: '' })

async function submit() {
  errors.password = password.value.length >= 8 ? '' : 'Use at least 8 characters.'
  errors.confirm = confirm.value === password.value ? '' : 'Passwords do not match.'
  formError.value = ''
  if (errors.password || errors.confirm) return
  try {
    await auth.resetPassword(token.value, password.value)
    toast.success('Password updated. Please sign in.')
    await navigateTo('/login')
  }
  catch (e) {
    formError.value = apiErrorMessage(e)
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl">Choose a new password</h1>
    <div v-if="!token" role="alert" class="mt-4 space-y-4">
      <p class="text-danger font-medium">This reset link is missing its token or is invalid.</p>
      <AppButton to="/forgot-password" variant="glass" block>Request a new link</AppButton>
    </div>
    <form v-else class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">{{ formError }}</p>
      <AppInput v-model="password" label="New password" type="password" autocomplete="new-password" required hint="At least 8 characters." :error="errors.password" />
      <AppInput v-model="confirm" label="Confirm password" type="password" autocomplete="new-password" required :error="errors.confirm" />
      <AppButton type="submit" block :loading="auth.loading">Update password</AppButton>
    </form>
  </div>
</template>
