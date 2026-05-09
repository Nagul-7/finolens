import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'

const UNREAD_KEY = 'finolens_alerts_unread'

const navItems = [
  { to: '/',             label: 'Home',        icon: 'home' },
  { to: '/intelligence', label: 'Intelligence', icon: 'insights' },
  { to: '/options',      label: 'Options',     icon: 'legend_toggle' },
  { to: '/charts',       label: 'Charts',      icon: 'candlestick_chart' },
  { to: '/backtest',     label: 'Backtest',    icon: 'history_edu' },
  { to: '/algo',         label: 'Algo',        icon: 'precision_manufacturing' },
  { to: '/watchlist',    label: 'Watchlist',   icon: 'list_alt' },
  { to: '/alerts',       label: 'Alerts',      icon: 'notifications' },
]

function getUnread() {
  try { return parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10) } catch { return 0 }
}

export default function BottomNav() {
  const [unread, setUnread] = useState(getUnread)

  useEffect(() => {
    const handler = () => setUnread(getUnread())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 bg-[#0d1117] border-t border-[#1e293b]">
      {navItems.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-full h-full pt-1 font-bold uppercase text-[10px] transition-all active:scale-95 ${
              isActive
                ? 'text-[#00d4aa] border-t-2 border-[#00d4aa]'
                : 'text-slate-500 hover:text-slate-300'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <div className="relative inline-flex">
                <span
                  className="material-symbols-outlined text-[20px] mb-0.5"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {icon}
                </span>
                {to === '/alerts' && unread > 0 && (
                  <span className="absolute -top-1 -right-2 bg-[#00d4aa] text-[#005643] text-[8px] font-black rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 leading-none">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </div>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
