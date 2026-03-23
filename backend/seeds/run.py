"""Seed script — creates demo tenants, users, plans, classes, etc."""

import asyncio
import sys
from datetime import datetime, date, timedelta, timezone, time
from decimal import Decimal
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, engine, Base
from app.core.security import hash_password
from app.models.tenant import Tenant, TenantStatus, LicenseType
from app.models.user import User, UserRole
from app.models.business import (
    Branch, Plan, PlanDuration, Membership, MembershipStatus,
    GymClass, ClassModality, ClassStatus,
    Payment, PaymentStatus, PaymentMethod,
    Campaign, CampaignStatus, CampaignChannel,
)
from app.services.saas_plan_service import ensure_default_saas_plans


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed():
    await create_tables()

    async with async_session_factory() as db:
        await ensure_default_saas_plans(db)
        # ─── Superadmin ──────────────────────────────────
        superadmin = User(
            email="admin@nexofitness.com",
            hashed_password=hash_password("Admin123!"),
            first_name="Super",
            last_name="Admin",
            role=UserRole.SUPERADMIN,
            is_superadmin=True,
            is_verified=True,
        )
        db.add(superadmin)

        # ─── Tenant 1: Nexo Gym ──────────────────────────
        t1 = Tenant(
            name="Nexo Gym Santiago",
            slug="nexo-gym-santiago",
            email="contacto@nexogym.cl",
            phone="+56912345678",
            address="Av. Providencia 1234",
            city="Santiago",
            country="Chile",
            timezone="America/Santiago",
            currency="CLP",
            license_type=LicenseType.MONTHLY,
            status=TenantStatus.ACTIVE,
            primary_color="#06b6d4",
        )
        db.add(t1)
        await db.flush()

        # Branch
        b1 = Branch(tenant_id=t1.id, name="Sede Providencia", address="Av. Providencia 1234", city="Santiago",
                     opening_time=time(6, 0), closing_time=time(22, 0), capacity=200)
        b2 = Branch(tenant_id=t1.id, name="Sede Las Condes", address="Av. Apoquindo 5678", city="Santiago",
                     opening_time=time(6, 0), closing_time=time(22, 0), capacity=150)
        db.add_all([b1, b2])
        await db.flush()

        # Users
        owner = User(tenant_id=t1.id, email="owner@nexogym.cl", hashed_password=hash_password("Owner123!"),
                     first_name="Carlos", last_name="Mendoza", role=UserRole.OWNER, is_verified=True)
        admin_user = User(tenant_id=t1.id, email="admin@nexogym.cl", hashed_password=hash_password("Admin123!"),
                          first_name="María", last_name="González", role=UserRole.ADMIN, is_verified=True)
        recep = User(tenant_id=t1.id, email="recepcion@nexogym.cl", hashed_password=hash_password("Recep123!"),
                     first_name="Ana", last_name="Silva", role=UserRole.RECEPTION, is_verified=True)
        trainer1 = User(tenant_id=t1.id, email="pedro@nexogym.cl", hashed_password=hash_password("Train123!"),
                        first_name="Pedro", last_name="Rojas", role=UserRole.TRAINER, is_verified=True)
        trainer2 = User(tenant_id=t1.id, email="valentina@nexogym.cl", hashed_password=hash_password("Train123!"),
                        first_name="Valentina", last_name="Lagos", role=UserRole.TRAINER, is_verified=True)
        db.add_all([owner, admin_user, recep, trainer1, trainer2])
        await db.flush()

        # Clients
        clients = []
        client_data = [
            ("Juan", "Pérez", "juan@email.com"), ("Sofía", "Martínez", "sofia@email.com"),
            ("Diego", "López", "diego@email.com"), ("Camila", "Torres", "camila@email.com"),
            ("Andrés", "Vargas", "andres@email.com"), ("Isabella", "Muñoz", "isabella@email.com"),
            ("Tomás", "Hernández", "tomas@email.com"), ("Fernanda", "Díaz", "fernanda@email.com"),
            ("Sebastián", "Romero", "sebastian@email.com"), ("Catalina", "Flores", "catalina@email.com"),
            ("Matías", "Soto", "matias@email.com"), ("Javiera", "Araya", "javiera@email.com"),
            ("Nicolás", "Castillo", "nicolas@email.com"), ("Antonia", "Vega", "antonia@email.com"),
            ("Lucas", "Reyes", "lucas@email.com"),
        ]
        for fn, ln, email in client_data:
            c = User(tenant_id=t1.id, email=email, hashed_password=hash_password("Client123!"),
                     first_name=fn, last_name=ln, role=UserRole.CLIENT, is_verified=True,
                     phone=f"+5691{hash(email) % 10000000:07d}")
            clients.append(c)
        db.add_all(clients)
        await db.flush()

        # Plans
        plan_basic = Plan(tenant_id=t1.id, name="Plan Básico", description="Acceso a sala de máquinas",
                          price=Decimal("29990"), currency="CLP", duration_type=PlanDuration.MONTHLY,
                          duration_days=30, max_reservations_per_week=3, is_active=True, sort_order=1)
        plan_full = Plan(tenant_id=t1.id, name="Plan Full", description="Acceso ilimitado a clases y máquinas",
                         price=Decimal("49990"), currency="CLP", duration_type=PlanDuration.MONTHLY,
                         duration_days=30, is_active=True, is_featured=True, sort_order=2)
        plan_premium = Plan(tenant_id=t1.id, name="Plan Premium", description="Acceso VIP, clases ilimitadas, entrenador personal",
                            price=Decimal("79990"), currency="CLP", duration_type=PlanDuration.MONTHLY,
                            duration_days=30, is_active=True, sort_order=3)
        plan_annual = Plan(tenant_id=t1.id, name="Plan Anual", description="12 meses de acceso Full con descuento",
                           price=Decimal("449990"), currency="CLP", duration_type=PlanDuration.ANNUAL,
                           duration_days=365, is_active=True, sort_order=4)
        db.add_all([plan_basic, plan_full, plan_premium, plan_annual])
        await db.flush()

        # Memberships
        today = date.today()
        for i, client in enumerate(clients[:10]):
            plan = [plan_basic, plan_full, plan_premium][i % 3]
            m = Membership(
                tenant_id=t1.id, user_id=client.id, plan_id=plan.id,
                status=MembershipStatus.ACTIVE, starts_at=today - timedelta(days=15),
                expires_at=today + timedelta(days=15),
            )
            db.add(m)

        # Classes
        now = datetime.now(timezone.utc)
        class_templates = [
            ("Yoga Flow", "yoga", ClassModality.IN_PERSON, trainer2.id, "#8b5cf6"),
            ("CrossFit WOD", "crossfit", ClassModality.IN_PERSON, trainer1.id, "#ef4444"),
            ("Spinning", "spinning", ClassModality.IN_PERSON, trainer1.id, "#f59e0b"),
            ("Pilates Online", "pilates", ClassModality.ONLINE, trainer2.id, "#06b6d4"),
            ("HIIT Express", "hiit", ClassModality.HYBRID, trainer1.id, "#10b981"),
            ("Body Pump", "strength", ClassModality.IN_PERSON, trainer1.id, "#3b82f6"),
            ("Meditación", "wellness", ClassModality.ONLINE, trainer2.id, "#a855f7"),
        ]

        for day_offset in range(7):
            for idx, (name, ctype, modality, instr, color) in enumerate(class_templates):
                start = (now + timedelta(days=day_offset)).replace(
                    hour=7 + idx * 2, minute=0, second=0, microsecond=0
                )
                gc = GymClass(
                    tenant_id=t1.id, branch_id=b1.id, name=name, class_type=ctype,
                    modality=modality, instructor_id=instr, start_time=start,
                    end_time=start + timedelta(hours=1), max_capacity=20,
                    current_bookings=min(idx * 2, 18), color=color,
                    online_link="https://meet.nexofitness.com/class" if modality != ClassModality.IN_PERSON else None,
                )
                db.add(gc)

        # Payments
        for i, client in enumerate(clients[:8]):
            p = Payment(
                tenant_id=t1.id, user_id=client.id, amount=Decimal("49990"),
                currency="CLP", status=PaymentStatus.COMPLETED, method=PaymentMethod.STRIPE,
                description="Pago Plan Full", paid_at=now - timedelta(days=i * 3),
            )
            db.add(p)

        # Campaign
        camp = Campaign(
            tenant_id=t1.id, name="Promo Verano 2025", subject="¡50% en tu primer mes!",
            content="<h1>Oferta especial de verano</h1><p>Inscríbete ahora.</p>",
            channel=CampaignChannel.EMAIL, status=CampaignStatus.SENT,
            total_recipients=200, total_sent=195, total_opened=87, total_clicked=34,
            sent_at=now - timedelta(days=5),
        )
        db.add(camp)

        await db.commit()
        print("✅ Seeds created successfully!")
        print(f"   Tenant: {t1.name} ({t1.slug})")
        print(f"   Owner: owner@nexogym.cl / Owner123!")
        print(f"   Admin: admin@nexogym.cl / Admin123!")
        print(f"   Superadmin: admin@nexofitness.com / Admin123!")


def run():
    asyncio.run(seed())


if __name__ == "__main__":
    run()
