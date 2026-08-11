import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import '@fontsource-variable/fraunces';
import '@fontsource/ibm-plex-mono';
import './index.css';
import { AuthProvider } from './auth';
import { isStatic } from './local/mode';
import AppShell from './AppShell';
import Login from './pages/Login';
import Home from './pages/Home';
import Settings from './pages/Settings';
import GradingStyle from './pages/GradingStyle';
import SessionDetail from './pages/SessionDetail';
import Review from './pages/Review';
import Write from './pages/Write';
import Library from './pages/Library';
import Admin from './pages/Admin';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Hash router so the SPA works from any subpath / static file server without
// server-side rewrite rules (same reason TGFWA built with base:'./').
const router = createHashRouter([
  { path: '/login', element: <Login /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/settings', element: <Settings /> },
      { path: '/grading-style', element: <GradingStyle /> },
      { path: '/sessions/:id', element: <SessionDetail /> },
      { path: '/review', element: <Review /> },
      { path: '/write', element: <Write /> },
      { path: '/library', element: <Library /> },
      { path: '/admin', element: <Admin /> },
    ],
  },
]);

async function boot() {
  // Static build has no server: swap in the job-manager-backed EventSource
  // before anything can open a grading stream. The api client routes /api calls
  // to the in-browser backend on its own.
  if (isStatic()) {
    const { installStaticBackend } = await import('./local/install');
    installStaticBackend();
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void boot();
