import { Outlet } from 'react-router-dom'
import { MobileNav } from './MobileNav'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Nebula's frame: nothing is edge-to-edge. The app floats on the nebula
 * background as a set of glass panels, and every route renders inside the
 * right-hand column.
 */
export function AppShell() {
  return (
    <div className="min-h-dvh p-3 md:p-5">
      <div className="mx-auto flex w-full max-w-[1800px] gap-5">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col gap-4 md:gap-5">
          <TopBar />
          <MobileNav />
          <main className="min-w-0 pb-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
