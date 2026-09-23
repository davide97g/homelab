import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, getSession, onSessionLost, setSession } from './client'
import type { User } from './types'

interface Auth {
  user: User | null
  isAdmin: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getSession)
  const qc = useQueryClient()

  useEffect(() => {
    onSessionLost(() => {
      setUser(null)
      qc.clear()
    })
  }, [qc])

  const signIn = async (username: string, password: string) => {
    const u = await api<User>('/account/login', { body: { username, password } })
    setSession(u)
    setUser(u)
  }

  const signOut = () => {
    setSession(null)
    setUser(null)
    qc.clear()
  }

  return (
    <AuthContext value={{ user, isAdmin: !!user?.roles.includes('Admin'), signIn, signOut }}>
      {children}
    </AuthContext>
  )
}

export function useAuth() {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
