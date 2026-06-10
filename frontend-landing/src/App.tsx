import Nav from './components/Nav';
import Hero from './components/Hero';
import ValueShowcase from './components/ValueShowcase';
import TrustStrip from './components/TrustStrip';
import SignalStrip from './components/SignalStrip';
import ProblemSolution from './components/ProblemSolution';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Pricing from './components/Pricing';
import FAQ from './components/FAQ';
import CTAFinal from './components/CTAFinal';
import Footer from './components/Footer';
import MobileStickyBar from './components/MobileStickyBar';

export default function App() {
  return (
    <div className="page-shell">
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <ValueShowcase />
        <SignalStrip />
        <ProblemSolution />
        <Features />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <CTAFinal />
      </main>
      <Footer />
      <MobileStickyBar />
    </div>
  );
}
