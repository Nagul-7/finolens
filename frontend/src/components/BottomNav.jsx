import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/',            label: 'Home',        icon: 'home' },
  { to: '/intelligence/RELIANCE', label: 'Intelligence', icon: 'insights' },
  { to: '/options',     label: 'Options',     icon: 'legend_toggle' },
  { to: '/screener',    label: 'Screener',    icon: 'filter_alt' },
  { to: '/backtest',    label: 'Backtest',    icon: 'history_edu' },
  { to: '/algo',        label: 'Algo',        icon: 'precision_manufacturing' },
  { to: '/watchlist',   label: 'Watchlist',   icon: 'list_alt' },
  { to: '/alerts',      label: 'Alerts',      icon: 'notifications' },
]

export default function BottomNav() {
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
              <span
                className="material-symbols-outlined text-[20px] mb-0.5"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {icon}
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
