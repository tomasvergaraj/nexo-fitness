import { useState, useEffect } from 'react';
import Nav from './components/Nav';
import Hero from './components/Hero';
import TrustBar from './components/TrustBar';
import SignalStrip from './components/SignalStrip';
import ProblemSolution from './components/ProblemSolution';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Pricing from './components/Pricing';
import Testimonials from './components/Testimonials';
import FAQ from './components/FAQ';
import CTAFinal from './components/CTAFinal';
import Footer from './components/Footer';
import MobileStickyBar from './components/MobileStickyBar';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('nf-theme') as Theme | null;
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.getElementById('meta-theme-color');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f0fafe' : '#071923');
    localStorage.setItem('nf-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <div className="page-shell">
      <Nav theme={theme} onToggleTheme={toggleTheme} />
      <main>
        <Hero />
        <TrustBar />
        <SignalStrip />
        <ProblemSolution />
        <Features />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <FAQ />
        <CTAFinal />
      </main>
      <Footer />
      <MobileStickyBar />
    </div>
  );
}
