const PUBLIC_PATHS = new Set(['/login', '/signup', '/forgot-password', '/reset-password'])

export default defineNuxtRouteMiddleware((to) => {
  const path = to.path.length > 1 ? to.path.replace(/\/+$/, '') : to.path
  if (PUBLIC_PATHS.has(path)) return
  if (!useUserSession().loggedIn.value) return navigateTo('/login')
})
