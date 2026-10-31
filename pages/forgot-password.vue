<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Reset password · Daily Agenda' })

const auth = useAuthStore()
const email = ref('')
const error = ref('')
const formError = ref('')
const sent = ref(false)

async function submit() {
  error.value = email.value.trim() ? '' : 'Enter your email address.'
  formError.value = ''
  if (error.value) return
  try {
    await auth.forgotPassword(email.value.trim())
    sent.value = true
  }
  catch (e) {
    formError.value = apiErrorMessage(e)
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl">Forgot your password?</h1>
    <div v-if="sent" role="status" class="mt-4 space-y-4">
      <p class="text-muted">If an account exists for that email, a reset link is on its way. Check your inbox.</p>
      <AppButton to="/login" variant="glass" block>Back to sign in</AppButton>
    </div>
    <template v-else>
      <p class="mt-1 text-muted">Enter your email and we will send you a reset link.</p>
      <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
        <p v-if="formError" role="alert" class="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">{{ formError }}</p>
        <AppInput v-model="email" label="Email" type="email" autocomplete="email" required :error="error" />
        <AppButton type="submit" block :loading="auth.loading">Send reset link</AppButton>
      </form>
      <p class="mt-6 text-center text-sm"><NuxtLink to="/login" class="font-semibold text-accent underline underline-offset-4">Back to sign in</NuxtLink></p>
    </template>
  </div>
</template>
