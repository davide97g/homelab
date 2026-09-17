import { Outlet } from 'react-router-dom'
import { AccountMenu } from './AccountMenu'
import { MobileNav } from './MobileNav'
import { Sidebar } from './Sidebar'

/**
 * Rail on the left, one scrolling content column on the right. No top bar:
 * search lives in the rail and the account menu floats over the content, so
 * the artwork starts as high on the page as it can.
 */
export function AppShell() {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-4 pt-4 md:px-8 md:pt-6">
          <MobileNav />
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
        <main className="min-w-0 px-4 pt-4 pb-12 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
