declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    /** Absent on sessions created before revocation existed. */
    sessionVersion?: number
  }
}

export {}
