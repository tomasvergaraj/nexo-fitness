import { motion } from 'framer-motion';
import { MapPin, Phone, Mail, ChevronDown } from 'lucide-react';
import type { TenantPublicProfile } from '@/types';

interface Props {
  profile: TenantPublicProfile;
  onCtaClick: () => void;
}

export default function GymHero({ profile, onCtaClick }: Props) {
  const { branding, tenant_name, city, address, phone, email } = profile;
  const headline = branding.marketplace_headline ?? tenant_name;
  const description = branding.marketplace_description;

  return (
    <section className="sf-hero relative overflow-hidden">
      {/* Aurora blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="sf-aurora-blob sf-aurora-1" />
        <div className="sf-aurora-blob sf-aurora-2" />
      </div>

      <div className="sf-container relative z-10 py-20 md:py-28 flex flex-col items-center text-center gap-6">
        {/* Logo */}
        {branding.logo_url ? (
          <motion.img
            src={branding.logo_url}
            alt={tenant_name}
            className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-contain shadow-xl"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          />
        ) : (
          <motion.div
            className="sf-logo-placeholder w-20 h-20 md:w-24 md:h-24 rounded-2xl flex items-center justify-center text-3xl font-black"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {tenant_name.charAt(0).toUpperCase()}
          </motion.div>
        )}

        {/* Headline */}
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <h1 className="sf-heading text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-none">
            {headline}
          </h1>
          {description && (
            <p className="sf-text-muted text-base md:text-lg max-w-lg mx-auto leading-relaxed">
              {description}
            </p>
          )}
        </motion.div>

        {/* Contact chips */}
        {(city || address || phone || email) && (
          <motion.div
            className="flex flex-wrap items-center justify-center gap-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22, ease: 'easeOut' }}
          >
            {(city || address) && (
              <span className="sf-chip flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {address ?? city}
              </span>
            )}
            {phone && (
              <a href={`tel:${phone}`} className="sf-chip flex items-center gap-1.5 hover:sf-chip-hover transition-colors">
                <Phone className="w-3.5 h-3.5" />
                {phone}
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} className="sf-chip flex items-center gap-1.5 hover:sf-chip-hover transition-colors">
                <Mail className="w-3.5 h-3.5" />
                {email}
              </a>
            )}
          </motion.div>
        )}

        {/* CTA */}
        {profile.checkout_enabled && (
          <motion.button
            onClick={onCtaClick}
            className="sf-btn-brand hidden md:flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-base mt-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            Ver planes y precios
            <ChevronDown className="w-5 h-5" />
          </motion.button>
        )}

        {/* Scroll indicator */}
        <motion.div
          className="absolute bottom-6 left-1/2 -translate-x-1/2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{ delay: 1, duration: 0.6 }}
        >
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronDown className="w-5 h-5 sf-text-subtle" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
