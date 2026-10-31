<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: () => {
    if (useUserSession().loggedIn.value) return navigateTo('/')
  },
})
useHead({ title: 'Sign in · Daily Agenda' })

const auth = useAuthStore()
const email = ref('')
const password = ref('')
const formError = ref('')
const errors = reactive({ email: '', password: '' })

async function submit() {
  errors.email = email.value.trim() ? '' : 'Enter your email address.'
  errors.password = password.value ? '' : 'Enter your password.'
  formError.value = ''
  if (errors.email || errors.password) return
  try {
    await auth.login(email.value.trim(), password.value)
    await navigateTo('/')
  }
  catch (e) {
    formError.value = apiErrorMessage(e)
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl">Welcome back</h1>
    <p class="mt-1 text-muted">Sign in to plan your day.</p>
    <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <p v-if="formError" role="alert" class="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">{{ formError }}</p>
      <AppInput v-model="email" label="Email" type="email" autocomplete="email" required :error="errors.email" />
      <AppInput v-model="password" label="Password" type="password" autocomplete="current-password" required :error="errors.password" />
      <div class="text-right text-sm"><NuxtLink to="/forgot-password" class="font-medium text-accent underline underline-offset-4">Forgot password?</NuxtLink></div>
      <AppButton type="submit" block :loading="auth.loading">Sign in</AppButton>
    </form>
    <p class="mt-6 text-center text-sm text-muted">
      New here?
      <NuxtLink to="/signup" class="font-semibold text-accent underline underline-offset-4">Create an account</NuxtLink>
    </p>
  </div>
</template>
