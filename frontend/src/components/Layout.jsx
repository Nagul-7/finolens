import { Outlet } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import BottomNav from './BottomNav.jsx'

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#081425] text-[#d8e3fb]">
      <TopBar />
      <div className="pt-14 pb-16">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  )
}
