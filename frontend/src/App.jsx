import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Intelligence from './pages/Intelligence.jsx'
import Options from './pages/Options.jsx'
import Backtest from './pages/Backtest.jsx'
import Screener from './pages/Screener.jsx'
import Watchlist from './pages/Watchlist.jsx'
import Algo from './pages/Algo.jsx'
import Alerts from './pages/Alerts.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/intelligence/:symbol?" element={<Intelligence />} />
          <Route path="/options" element={<Options />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/screener" element={<Screener />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/algo" element={<Algo />} />
          <Route path="/alerts" element={<Alerts />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
