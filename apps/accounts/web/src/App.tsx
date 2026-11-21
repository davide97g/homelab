import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from './lib/session.tsx'
import { Admin } from './routes/Admin.tsx'
import { DevicePage } from './routes/Device.tsx'
import { Home } from './routes/Home.tsx'
import { InvitePage } from './routes/Invite.tsx'
import { Login } from './routes/Login.tsx'
import { Pair } from './routes/Pair.tsx'

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          {/* One page, three paths: each app claims its own for universal links. */}
          <Route path="/device" element={<DevicePage />} />
          <Route path="/cinema/device" element={<DevicePage />} />
          <Route path="/memories/device" element={<DevicePage />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/pair" element={<Pair />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
