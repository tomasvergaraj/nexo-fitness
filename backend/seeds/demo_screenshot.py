"""Seed one-off: tenant `demo-screenshots` con datos ricos de HOY para capturas
de marketing (dashboard con ingresos, clases, check-ins y reservas del día).

Idempotente por slug. NO crea superadmin (ya existe en prod).
Uso:  docker compose -f docker-compose.prod.yml exec -T backend \
          python -m seeds.demo_screenshot
"""

import asyncio
import random
import secrets
from datetime import datetime, date, timedelta, timezone, time
from decimal import Decimal

from sqlalchemy import select

from app.core.database import async_session_factory
from app.core.security import hash_password
from app.models.tenant import Tenant, TenantStatus, LicenseType
from app.models.user import User, UserRole
from app.models.business import (
    Branch, Plan, PlanDuration, Membership, MembershipStatus,
    GymClass, ClassModality, CheckIn, Reservation, ReservationStatus,
    Payment, PaymentStatus, PaymentMethod,
)

SLUG = "demo-screenshots"
random.seed(20260610)

FIRST = ["Josefa", "Martín", "Florencia", "Joaquín", "Emilia", "Agustín", "Trinidad",
         "Vicente", "Maite", "Cristóbal", "Amanda", "Renato", "Constanza", "Bruno",
         "Rafaela", "Gaspar", "Ignacia", "Dante", "Colomba", "Félix", "Magdalena",
         "Simón", "Laura", "Eloísa", "Marcos", "Paula", "Damián", "Olivia", "Bautista",
         "Julieta", "Emilio", "Rosario", "Teo", "Mía", "León", "Clara", "Gael", "Ema"]
LAST = ["Fuentes", "Salazar", "Riquelme", "Carrasco", "Navarrete", "Aguirre", "Bustos",
        "Sandoval", "Garrido", "Espinoza", "Saavedra", "Cifuentes", "Yáñez", "Tapia",
        "Cornejo", "Paredes", "Maldonado", "Olivares", "Zúñiga", "Leiva", "Beltrán",
        "Pizarro", "Quiroz", "Faúndez", "Toledo", "Ávila", "Galaz", "Mardones"]


async def seed():
    async with async_session_factory() as db:
        existing = (
            await db.execute(select(Tenant).where(Tenant.slug == SLUG))
        ).scalar_one_or_none()
        if existing:
            print(f"✓ Tenant {SLUG} ya existe. Skip.")
            return

        now = datetime.now(timezone.utc)
        today = date.today()
        owner_password = "Demo-" + secrets.token_urlsafe(9)

        t = Tenant(
            name="Studio Alto Norte",
            slug=SLUG,
            email="demo@nexofitness.cl",
            phone="+56922223333",
            address="Av. Apoquindo 4500",
            city="Santiago",
            country="Chile",
            timezone="America/Santiago",
            currency="CLP",
            license_type=LicenseType.ANNUAL,
            status=TenantStatus.ACTIVE,
            primary_color="#1F86A6",
        )
        db.add(t)
        await db.flush()

        b1 = Branch(tenant_id=t.id, name="Sede Apoquindo", address="Av. Apoquindo 4500",
                    city="Santiago", opening_time=time(6, 0), closing_time=time(22, 30), capacity=180)
        b2 = Branch(tenant_id=t.id, name="Sede Ñuñoa", address="Av. Irarrázaval 2900",
                    city="Santiago", opening_time=time(7, 0), closing_time=time(22, 0), capacity=120)
        db.add_all([b1, b2])
        await db.flush()

        owner = User(tenant_id=t.id, email="owner@demo.nexofitness.cl",
                     hashed_password=hash_password(owner_password),
                     first_name="Daniela", last_name="Reyes", role=UserRole.OWNER, is_verified=True)
        trainer1 = User(tenant_id=t.id, email="coach1@demo.nexofitness.cl",
                        hashed_password=hash_password(secrets.token_urlsafe(12)),
                        first_name="Marco", last_name="Ulloa", role=UserRole.TRAINER, is_verified=True)
        trainer2 = User(tenant_id=t.id, email="coach2@demo.nexofitness.cl",
                        hashed_password=hash_password(secrets.token_urlsafe(12)),
                        first_name="Karin", last_name="Soler", role=UserRole.TRAINER, is_verified=True)
        db.add_all([owner, trainer1, trainer2])
        await db.flush()

        # 124 clientes ficticios — un solo hash bcrypt reutilizado (rapidez)
        client_hash = hash_password("Demo-" + secrets.token_urlsafe(9))
        names = set()
        clients = []
        i = 0
        while len(clients) < 124:
            fn, ln = random.choice(FIRST), random.choice(LAST)
            if (fn, ln) in names:
                i += 1
                continue
            names.add((fn, ln))
            c = User(tenant_id=t.id, email=f"cliente{len(clients)+1}@demo.nexofitness.cl",
                     hashed_password=client_hash, first_name=fn, last_name=ln,
                     role=UserRole.CLIENT, is_verified=True,
                     phone=f"+5692{random.randint(1000000, 9999999)}")
            clients.append(c)
        db.add_all(clients)
        await db.flush()

        plans = [
            Plan(tenant_id=t.id, name="Plan Sala", description="Acceso libre a sala",
                 price=Decimal("32990"), currency="CLP", duration_type=PlanDuration.MONTHLY,
                 duration_days=30, is_active=True, sort_order=1),
            Plan(tenant_id=t.id, name="Plan Full", description="Sala + clases ilimitadas",
                 price=Decimal("46990"), currency="CLP", duration_type=PlanDuration.MONTHLY,
                 duration_days=30, is_active=True, is_featured=True, sort_order=2),
            Plan(tenant_id=t.id, name="Plan Estudio", description="Clases dirigidas",
                 price=Decimal("39990"), currency="CLP", duration_type=PlanDuration.MONTHLY,
                 duration_days=30, is_active=True, sort_order=3),
        ]
        db.add_all(plans)
        await db.flush()

        # Membresías: 118 activas (6 de ellas vencen dentro de 7 días)
        for i, c in enumerate(clients[:118]):
            expires = today + timedelta(days=random.randint(8, 27))
            if i < 6:
                expires = today + timedelta(days=random.randint(2, 6))
            db.add(Membership(
                tenant_id=t.id, user_id=c.id, plan_id=plans[i % 3].id,
                status=MembershipStatus.ACTIVE,
                starts_at=today - timedelta(days=random.randint(3, 22)),
                expires_at=expires,
            ))

        # Clases de HOY (8) con alta ocupación + clases de la semana
        templates = [
            ("Funcional 07:00", "functional", 7, trainer1, 24, 22),
            ("Spinning 08:00", "spinning", 8, trainer2, 20, 19),
            ("Yoga Flow 09:30", "yoga", 9, trainer2, 18, 14),
            ("HIIT 12:30", "hiit", 12, trainer1, 20, 17),
            ("Pilates Reformer 17:00", "pilates", 17, trainer2, 12, 12),
            ("Funcional 18:30", "functional", 18, trainer1, 24, 23),
            ("Spinning 19:30", "spinning", 19, trainer1, 20, 18),
            ("Yoga Restaurativo 20:30", "yoga", 20, trainer2, 18, 11),
        ]
        today_classes = []
        for day_offset in range(0, 6):
            for name, ctype, hour, instr, cap, booked in templates:
                start = (now + timedelta(days=day_offset)).replace(
                    hour=hour, minute=0 if ":00" in name else 30, second=0, microsecond=0)
                gc = GymClass(
                    tenant_id=t.id, branch_id=b1.id if hour < 17 else b2.id,
                    name=name.rsplit(" ", 1)[0], class_type=ctype,
                    modality=ClassModality.IN_PERSON, instructor_id=instr.id,
                    start_time=start, end_time=start + timedelta(hours=1),
                    max_capacity=cap,
                    current_bookings=booked if day_offset == 0 else random.randint(4, cap - 2),
                )
                db.add(gc)
                if day_offset == 0:
                    today_classes.append(gc)
        await db.flush()

        # Reservas de HOY (39) + check-ins de HOY (47, escalonados hasta hace 4 min)
        pool = clients[:90]
        random.shuffle(pool)
        reservations = []
        for i, c in enumerate(pool[:39]):
            gc = today_classes[i % len(today_classes)]
            r = Reservation(
                tenant_id=t.id, user_id=c.id, gym_class_id=gc.id,
                status=ReservationStatus.CONFIRMED,
                created_at=now - timedelta(hours=random.uniform(0.2, 9.0)),
            )
            reservations.append(r)
            db.add(r)
        await db.flush()

        minutes_ago = 4
        for i, c in enumerate(pool[:47]):
            db.add(CheckIn(
                tenant_id=t.id, user_id=c.id,
                gym_class_id=today_classes[i % len(today_classes)].id if i % 3 else None,
                branch_id=b1.id if i % 2 else b2.id,
                check_type="qr" if i % 3 else "manual",
                checked_in_at=now - timedelta(minutes=minutes_ago + i * 11),
                checked_in_by=owner.id if i % 3 == 0 else None,
            ))

        # Pagos: HOY $511.960 · semana ~$1.9M · mes ~$6.8M · 5 pendientes
        def pay(client, amount, when, status=PaymentStatus.COMPLETED, method=PaymentMethod.WEBPAY):
            db.add(Payment(tenant_id=t.id, user_id=client.id, amount=Decimal(amount),
                           currency="CLP", status=status, method=method,
                           description="Pago de membresía", paid_at=when))

        today_amounts = ["46990", "46990", "39990", "32990", "46990", "39990", "46990",
                         "46990", "32990", "46990", "46990", "43320"]  # = $511.960
        for i, amt in enumerate(today_amounts):
            pay(clients[i], amt, now - timedelta(hours=random.uniform(0.5, 10.0)),
                method=PaymentMethod.WEBPAY if i % 2 else PaymentMethod.CASH)
        for i in range(30):  # resto de la semana
            pay(clients[12 + i], random.choice(["46990", "39990", "32990"]),
                now - timedelta(days=random.randint(1, max(1, now.weekday())), hours=random.uniform(1, 12)))
        for i in range(105):  # resto del mes
            pay(clients[(42 + i) % 124], random.choice(["46990", "39990", "32990"]),
                now - timedelta(days=random.randint(now.weekday() + 1, max(now.weekday() + 2, today.day - 1)),
                                hours=random.uniform(1, 12)))
        for i in range(5):  # pendientes
            pay(clients[100 + i], "46990", None, status=PaymentStatus.PENDING)

        await db.commit()
        print("✅ Tenant demo creado")
        print(f"   slug: {SLUG}")
        print(f"   owner: owner@demo.nexofitness.cl / {owner_password}")


def run():
    asyncio.run(seed())


if __name__ == "__main__":
    run()
