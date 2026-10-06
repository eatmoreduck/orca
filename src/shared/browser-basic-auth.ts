export type BrowserBasicAuthRequest = {
  requestId: string
  browserPageId: string
  host: string
  port: number
  scheme?: string
  realm?: string
}

export type BrowserBasicAuthResponse = {
  requestId: string
  cancelled: boolean
  username?: string
  password?: string
}
