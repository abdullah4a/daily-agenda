/** Any page read answered 401 means the session ended, so go to sign-in. Sync keeps its own handling. */
export default defineNuxtPlugin(() => {
  const session = useUserSession()
  const expire = useSessionExpiry()

  globalThis.$fetch = $fetch.create({
    onResponseError({ request, options, response }) {
      const url = typeof request === 'string' ? request : (request as Request).url
      if (session.loggedIn.value && isSessionExpiry(url, response.status, new Headers(options.headers))) void expire()
    },
  }) as typeof globalThis.$fetch
})
