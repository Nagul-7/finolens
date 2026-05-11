import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import BottomNav from './BottomNav.jsx'

export default function Layout() {
  const [quipOpen, setQuipOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#081425] text-[#d8e3fb]">
      <TopBar onQuipClick={() => setQuipOpen(true)} />
      <div className="pt-14 pb-16">
        <Outlet />
      </div>
      <BottomNav />

      {/* Quip modal */}
      {quipOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
          onClick={() => setQuipOpen(false)}
        >
          <div
            className="bg-[#111c2d] border border-[#2a3548] rounded-2xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <span className="material-symbols-outlined text-[56px] text-[#00d4aa]">
              psychology
            </span>
            <h2 className="text-[#d8e3fb] text-lg font-bold mt-3">
              Quip AI Integration
            </h2>
            <p className="text-[#bacac2] text-sm mt-2 leading-relaxed">
              Fundamental analysis AI will appear here alongside FinoLens technical
              signals, giving you a combined call.
            </p>
            <p className="text-[#4a5568] text-xs mt-3">Coming soon</p>
            <button
              onClick={() => setQuipOpen(false)}
              className="mt-5 px-6 py-2 rounded-lg bg-[#1e293b] text-[#bacac2] text-sm hover:bg-[#2a3548] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
