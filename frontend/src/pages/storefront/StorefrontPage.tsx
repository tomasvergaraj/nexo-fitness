import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StorefrontLayout from './StorefrontLayout';
import GymHero from './sections/GymHero';
import PlanGrid from './sections/PlanGrid';
import ClassSchedule from './sections/ClassSchedule';
import BranchMap from './sections/BranchMap';
import CheckoutDrawer from './checkout/CheckoutDrawer';
import { useStorefront } from './hooks/useStorefront';
import { useCheckout } from './hooks/useCheckout';
import { Loader2, AlertCircle, ChevronDown } from 'lucide-react';

export default function StorefrontPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { data: profile, isLoading, isError } = useStorefront(slug);
  const checkout = useCheckout(slug);
  const [ctaVisible, setCtaVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => {
      const plans = document.getElementById('sf-plans');
      if (plans) {
        setCtaVisible(window.scrollY < plans.offsetTop - 80);
      } else {
        setCtaVisible(window.scrollY < window.innerHeight * 0.7);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (isLoading) {
    return (
      <div className="sf-root min-h-screen flex items-center justify-center bg-[#070f14]">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="sf-root min-h-screen flex flex-col items-center justify-center gap-3 bg-[#070f14] text-white px-6 text-center">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-lg font-semibold">Gimnasio no encontrado</p>
        <p className="text-sm text-white/50">Verifica el enlace o contacta al gimnasio.</p>
      </div>
    );
  }

  const brand = profile.branding.primary_color ?? '#06b6d4';
  const brand2 = profile.branding.secondary_color ?? '#0f766e';

  return (
    <StorefrontLayout primaryColor={brand} secondaryColor={brand2}>
      {/* Sticky mobile CTA */}
      <AnimatePresence>
        {profile.checkout_enabled && ctaVisible && (
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-40 md:hidden sf-mobile-cta"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 32 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="px-5 pt-4" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
              <motion.button
                onClick={() => {
                  const el = document.getElementById('sf-plans');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="sf-btn-brand w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2"
                whileTap={{ scale: 0.97 }}
              >
                Ver planes y precios
                <ChevronDown className="w-5 h-5" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <GymHero profile={profile} onCtaClick={() => {
        const el = document.getElementById('sf-plans');
        el?.scrollIntoView({ behavior: 'smooth' });
      }} />

      <PlanGrid
        plans={profile.featured_plans}
        currency={profile.featured_plans[0]?.currency ?? 'CLP'}
        checkoutEnabled={profile.checkout_enabled}
        onSelectPlan={checkout.openFor}
      />

      {profile.upcoming_classes.length > 0 && (
        <ClassSchedule classes={profile.upcoming_classes} />
      )}

      {profile.branches.length > 1 && (
        <BranchMap branches={profile.branches} />
      )}

      {/* Footer */}
      <footer className="sf-footer py-10 text-center text-sm sf-text-muted border-t sf-border">
        <p>
          {profile.tenant_name}
          {profile.city ? ` · ${profile.city}` : ''}
          {profile.phone ? ` · ${profile.phone}` : ''}
        </p>
        <p className="mt-1 text-xs sf-text-subtle">
          Powered by{' '}
          <a href="https://nexofitness.cl" target="_blank" rel="noopener noreferrer" className="hover:underline">
            Nexo Fitness
          </a>
        </p>
      </footer>

      <AnimatePresence>
        {checkout.state.open && (
          <CheckoutDrawer
            profile={profile}
            checkout={checkout}
          />
        )}
      </AnimatePresence>
    </StorefrontLayout>
  );
}
