import { Hero } from '../components/home/Hero';
import { Features } from '../components/home/Features';
import { Cta } from '../components/home/Cta';
import { useScrollAnimations } from '../components/home/useScrollAnimations';
import '../components/home/home.css';

export function Home() {
  useScrollAnimations();

  return (
    <div className="home-page">
      <Hero />
      <Features />
      <Cta />
    </div>
  );
}
