import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Discover = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Discover })));

export function App() {
  return (
    <Suspense fallback={<div />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/discover" element={<Discover />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
