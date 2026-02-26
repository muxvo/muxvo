import { Hero } from '../components/home/Hero';
import { FeatureTerminals } from '../components/home/FeatureTerminals';
import { FeatureConfig } from '../components/home/FeatureConfig';
import { FeatureHistory } from '../components/home/FeatureHistory';
import { ProductOverview } from '../components/home/ProductOverview';
import { Cta } from '../components/home/Cta';
import { useScrollAnimations } from '../components/home/useScrollAnimations';
import '../components/home/home.css';

export function Home() {
  useScrollAnimations();

  return (
    <div className="home-page">
      <Hero />
      <FeatureTerminals />
      <FeatureConfig />
      <FeatureHistory />
      <ProductOverview />
      <Cta />
    </div>
  );
}
