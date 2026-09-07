import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { PageResponse, ServerResponse } from './types'

const backend = import.meta.env.DEV ? '/backend' : ''

async function request(
  path: string,
  options: RequestInit = {},
): Promise<ServerResponse> {
  const response = await fetch(backend + path, {
    ...options,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...options.headers },
  })
  if (!response.ok)
    throw new Error(
      (await response.text()).trim() || `请求失败 (${response.status})`,
    )
  return response.json()
}

interface PageContextValue {
  current: PageResponse | null
  loading: boolean
  busy: boolean
  error: string
  clearError: () => void
  refresh: () => void
  submit: (path: string, fields?: URLSearchParams) => Promise<boolean>
}
const PageContext = createContext<PageContextValue | null>(null)

export function PageProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [current, setCurrent] = useState<PageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    request(location.pathname + location.search, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        if ('redirect' in result) {
          navigate(result.redirect, { replace: true })
        } else {
          setCurrent(result)
          setLoading(false)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setCurrent(null)
          setError(cause instanceof Error ? cause.message : '请求失败')
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [location.pathname, location.search, revision, navigate])

  const submit = async (path: string, fields = new URLSearchParams()) => {
    if (busy) return false
    setBusy(true)
    setError('')
    if (current?.data.CSRF) fields.set('csrf', current.data.CSRF)
    try {
      const result = await request(path, { method: 'POST', body: fields })
      if ('redirect' in result) {
        if (result.redirect === location.pathname + location.search) refresh()
        else navigate(result.redirect)
        return true
      }
      setCurrent(result)
      return !result.data.Error
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请求失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageContext.Provider
      value={{
        current,
        loading,
        busy,
        error,
        clearError: () => setError(''),
        refresh,
        submit,
      }}
    >
      {children}
    </PageContext.Provider>
  )
}

export function usePage() {
  const context = useContext(PageContext)
  if (!context) throw new Error('PageProvider is missing')
  return context
}
