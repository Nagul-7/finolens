import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import BottomNav from './BottomNav.jsx'

export default function Layout() {
  const [quipOpen, setQuipOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#081425] text-[#d8e3fb]">
      <TopBar />
      <div className="pt-14 pb-16">
        <Outlet />
      </div>
      <BottomNav />

      {/* Quip floating button — visible on every tab */}
      <button
        onClick={() => setQuipOpen(true)}
        className="fixed bottom-20 right-4 w-12 h-12 rounded-full bg-[#00d4aa] flex items-center justify-center shadow-lg hover:bg-[#46f1c5] transition-colors z-40"
        title="Quip AI"
      >
        <span className="material-symbols-outlined text-[#005643] text-[22px]">chat</span>
      </button>

      {/* Quip modal */}
      {quipOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => setQuipOpen(false)}
        >
          <div
            className="bg-[#111c2d] border border-[#2a3548] rounded-xl p-6 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-bold text-[#d8e3fb]">Quip Integration</span>
              <button onClick={() => setQuipOpen(false)} className="text-[#bacac2] hover:text-[#d8e3fb] transition-colors">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="text-center p-2">
              <span className="material-symbols-outlined text-[48px] text-[#00d4aa]">chat</span>
              <p className="text-[#d8e3fb] mt-3 font-bold">Quip Integration</p>
              <p className="text-[#bacac2] text-sm mt-1">
                Coming soon — AI fundamental analysis will appear here alongside FinoLens signals
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
