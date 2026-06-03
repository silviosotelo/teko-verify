import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* basename /admin-ui → todas las rutas client-side cuelgan de ahí */}
    <BrowserRouter basename="/admin-ui">
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
