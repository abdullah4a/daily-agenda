<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: () => {
    if (useUserSession().loggedIn.value) return navigateTo('/')
  },
})
useHead({ title: 'Create account · Daily Agenda' })

const auth = useAuthStore()
const email = ref('')
const password = ref('')
const formError = ref('')
const errors = reactive({ email: '', password: '' })

async function submit() {
  errors.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? '' : 'Enter a valid email address.'
  errors.password = password.value.length >= 8 ? '' : 'Use at least 8 characters.'
  formError.value = ''
  if (errors.email || errors.password) return
  try {
    await auth.signup(email.value.trim(), password.value)
    await navigateTo('/')
  }
  catch (e) {
    formError.value = apiErrorMessage(e)
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl">Create your account</h1>
    <p class="mt-1 text-muted">Start shaping calmer, clearer days.</p>
    <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">{{ formError }}</p>
      <AppInput v-model="email" label="Email" type="email" autocomplete="email" required :error="errors.email" />
      <AppInput v-model="password" label="Password" type="password" autocomplete="new-password" required hint="At least 8 characters." :error="errors.password" />
      <AppButton type="submit" block :loading="auth.loading">Create account</AppButton>
    </form>
    <p class="mt-6 text-center text-sm text-muted">
      Already have an account?
      <NuxtLink to="/login" class="font-semibold text-accent underline underline-offset-4">Sign in</NuxtLink>
    </p>
  </div>
</template>
