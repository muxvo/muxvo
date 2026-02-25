import { Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Discover } from './pages/Discover';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/discover" element={<Discover />} />
    </Routes>
  );
}
