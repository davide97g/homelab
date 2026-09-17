import { Outlet } from 'react-router-dom'
import { TopNav } from './TopNav'

export function AppShell() {
  return (
    <div className="min-h-dvh bg-background">
      <TopNav />
      {/* No top padding: routes decide, because the home hero must sit
          underneath the transparent nav. */}
      <main className="pb-24">
        <Outlet />
      </main>
    </div>
  )
}
