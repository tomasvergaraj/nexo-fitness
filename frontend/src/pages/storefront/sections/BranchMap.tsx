import { motion } from 'framer-motion';
import { MapPin, Phone } from 'lucide-react';
import type { TenantPublicProfile } from '@/types';

type Branch = TenantPublicProfile['branches'][number];

interface Props {
  branches: Branch[];
}

export default function BranchMap({ branches }: Props) {
  return (
    <section className="sf-section sf-section-alt">
      <div className="sf-container">
        <motion.h2
          className="sf-heading text-2xl font-black tracking-tight mb-6 flex items-center gap-3"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <MapPin className="sf-brand-icon w-5 h-5" />
          Nuestras sedes
        </motion.h2>

        <div className={`grid gap-4 ${branches.length === 2 ? 'sm:grid-cols-2' : branches.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
          {branches.map((branch, i) => (
            <motion.div
              key={branch.id}
              className="sf-card rounded-2xl p-5 flex flex-col gap-2"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-20px' }}
              transition={{ duration: 0.45, delay: i * 0.07 }}
            >
              <span className="sf-text-strong font-bold">{branch.name}</span>
              {(branch.address || branch.city) && (
                <span className="sf-text-muted text-sm flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  {branch.address ?? branch.city}
                </span>
              )}
              {branch.phone && (
                <a
                  href={`tel:${branch.phone}`}
                  className="sf-text-muted text-sm flex items-center gap-1.5 hover:sf-brand-text transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                  {branch.phone}
                </a>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
