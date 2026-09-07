import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PageProvider } from '@/lib/page-context'
import App from './App'
import './index.css'

const theme =
  document.cookie.match(/(?:^|;\s*)caddyui_theme=(light|dark)/)?.[1] || 'dark'
document.documentElement.classList.toggle('dark', theme === 'dark')

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TooltipProvider>
      <PageProvider>
        <App />
      </PageProvider>
    </TooltipProvider>
  </BrowserRouter>,
)
