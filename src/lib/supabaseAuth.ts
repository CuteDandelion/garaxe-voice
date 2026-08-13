import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type BrowserSupabaseConfiguration = { url: string; publishableKey: string }

function configuration(): BrowserSupabaseConfiguration | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !publishableKey) return null
  if (!url || !publishableKey) throw new Error('Voice Lab authentication is not configured.')
  const parsed = new URL(url)
  const localHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  if (parsed.protocol !== 'https:' && !localHttp) throw new Error('Voice Lab authentication is not configured.')
  return { url: url.replace(/\/$/, ''), publishableKey }
}

let cachedClient: { key: string; client: SupabaseClient } | null = null

function client() {
  const current = configuration()
  if (!current) return null
  const key = `${current.url}\n${current.publishableKey}`
  if (cachedClient?.key === key) return cachedClient.client
  const created = createClient(current.url, current.publishableKey, {
    auth: { storage: window.localStorage },
  })
  cachedClient = { key, client: created }
  return created
}

export function isSupabaseAuthConfigured() {
  return configuration() !== null
}

export function isLocalQaAuthEnabled() {
  return import.meta.env.VITE_LOCAL_QA_AUTH_ENABLED === 'true'
}

export async function signInWithPassword(email: string, password: string) {
  const configured = client()
  if (!configured) throw new Error('Voice Lab authentication is not configured.')
  const { error } = await configured.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Email or password is incorrect.')
}

export async function getSupabaseAccessToken() {
  const configured = client()
  if (!configured) return null
  const { data, error } = await configured.auth.getSession()
  if (error) return null
  return data.session?.access_token || null
}

export async function signOutSupabase() {
  const configured = client()
  if (!configured) return false
  const { error } = await configured.auth.signOut()
  if (error) throw new Error('Sign out could not be completed.')
  return true
}
