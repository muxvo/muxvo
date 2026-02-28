import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { track } from './lib/analytics';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Discover = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Discover })));
const Terms = lazy(() => import('./pages/Terms').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));

export function App() {
  const location = useLocation();

  useEffect(() => {
    track('web:page_view', { path: location.pathname, referrer: document.referrer });
  }, [location.pathname]);

  return (
    <Suspense fallback={<div />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
