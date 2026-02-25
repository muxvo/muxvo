import { HeroSplit } from '../components/home/HeroSplit';
import { CompareTerminals } from '../components/home/CompareTerminals';
import { CompareConversations } from '../components/home/CompareConversations';
import { CompareSkills } from '../components/home/CompareSkills';
import { Panorama } from '../components/home/Panorama';
import { CtaSection } from '../components/home/CtaSection';
import { useScrollAnimations } from '../components/home/useScrollAnimations';
import '../components/home/home.css';

export function Home() {
  useScrollAnimations();

  return (
    <div className="home-page">
      <HeroSplit />
      <CompareTerminals />
      <CompareConversations />
      <CompareSkills />
      <Panorama />
      <CtaSection />
    </div>
  );
}
