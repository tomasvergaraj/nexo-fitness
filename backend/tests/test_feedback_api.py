from __future__ import annotations

import io
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api.v1.endpoints import operations
from app.core.dependencies import TenantContext
from app.models.business import FeedbackCategory, FeedbackSubmission
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole


class FakeScalarSequence:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class FakeResult:
    def __init__(self, *, items=None, scalar_value=None):
        self._items = list(items or [])
        self._scalar_value = scalar_value

    def scalars(self):
        return FakeScalarSequence(self._items)

    def scalar(self):
        return self._scalar_value


class FakeAsyncSession:
    def __init__(self, *, users: list[User] | None = None, submissions: list[FeedbackSubmission] | None = None):
        self.users = {user.id: user for user in users or []}
        self.submissions = list(submissions or [])
        self._pending: list[object] = []

    def add(self, obj):
        self._pending.append(obj)

    async def flush(self) -> None:
        for obj in self._pending:
            if isinstance(obj, FeedbackSubmission):
                if getattr(obj, "id", None) is None:
                    obj.id = uuid4()
                if getattr(obj, "created_at", None) is None:
                    obj.created_at = datetime.now(timezone.utc)
                self.submissions.append(obj)
        self._pending.clear()

    async def refresh(self, _obj) -> None:
        return None

    async def execute(self, statement):
        sql = str(statement)
        params = statement.compile().params

        if "FROM feedback_submissions" in sql:
            tenant_id = params.get("tenant_id_1")
            items = [item for item in self.submissions if item.tenant_id == tenant_id]
            items.sort(key=lambda item: item.created_at, reverse=True)
            limit = next((value for value in params.values() if isinstance(value, int)), None)
            if limit:
                items = items[:limit]
            return FakeResult(items=items)

        if "FROM users" in sql:
            ids: list[UUID] = []
            for value in params.values():
                if isinstance(value, UUID):
                    ids.append(value)
                elif isinstance(value, (list, tuple)):
                    ids.extend(item for item in value if isinstance(item, UUID))
            return FakeResult(items=[self.users[user_id] for user_id in ids if user_id in self.users])

        raise AssertionError(f"Unexpected statement: {sql}")


def make_tenant(**overrides) -> Tenant:
    tenant = Tenant(
        id=uuid4(),
        name="Gym Norte",
        slug=f"gym-{uuid4().hex[:8]}",
        email="owner@gym.test",
        phone="+56911111111",
        country="CL",
        timezone="America/Santiago",
        currency="CLP",
        license_type=LicenseType.MONTHLY,
        status=TenantStatus.ACTIVE,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(tenant, key, value)
    return tenant


def make_user(*, tenant_id: UUID, role: UserRole = UserRole.OWNER, **overrides) -> User:
    user = User(
        id=uuid4(),
        tenant_id=tenant_id,
        email=f"{role.value}@gym.test",
        hashed_password="hashed",
        first_name="Nora",
        last_name="Coach",
        role=role,
        is_superadmin=False,
        is_active=True,
        is_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


def make_submission(*, tenant_id: UUID, created_by: UUID | None, category: FeedbackCategory = FeedbackCategory.SUGGESTION, **overrides) -> FeedbackSubmission:
    submission = FeedbackSubmission(
        id=uuid4(),
        tenant_id=tenant_id,
        created_by=created_by,
        category=category,
        message="Sería útil tener filtros guardados en reportes.",
        image_path=None,
        created_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(submission, key, value)
    return submission


def make_png_bytes() -> bytes:
    image = Image.new("RGB", (10, 10), color=(255, 120, 80))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def build_client(
    *,
    session: FakeAsyncSession,
    tenant: Tenant | None = None,
    current_user: User | None = None,
) -> TestClient:
    tenant = tenant or make_tenant()
    current_user = current_user or make_user(tenant_id=tenant.id)

    app = FastAPI()
    app.include_router(operations.feedback_router, prefix="/api/v1")

    async def override_db():
        yield session

    async def override_current_user():
        return current_user

    async def override_tenant_context():
        return TenantContext(tenant=tenant, user=current_user)

    app.dependency_overrides[operations.get_db] = override_db
    app.dependency_overrides[operations.get_current_user] = override_current_user
    app.dependency_overrides[operations.get_tenant_context] = override_tenant_context

    return TestClient(app)


async def _send_feedback_ok(**_kwargs) -> bool:
    return True


def test_create_feedback_submission_without_image(monkeypatch) -> None:
    tenant = make_tenant()
    current_user = make_user(tenant_id=tenant.id)
    session = FakeAsyncSession(users=[current_user])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    monkeypatch.setattr(operations.email_service, "send_feedback_submission", _send_feedback_ok)

    response = client.post(
        "/api/v1/feedback/submissions",
        data={"category": "suggestion", "message": "Nos serviría exportar reportes con filtros guardados."},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["category"] == "suggestion"
    assert payload["image_url"] is None
    assert payload["created_by"] == str(current_user.id)
    assert payload["created_by_name"] == current_user.full_name
    assert len(session.submissions) == 1


def test_create_feedback_submission_with_image(monkeypatch, tmp_path) -> None:
    tenant = make_tenant()
    current_user = make_user(tenant_id=tenant.id)
    session = FakeAsyncSession(users=[current_user])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    monkeypatch.setattr(operations.email_service, "send_feedback_submission", _send_feedback_ok)
    monkeypatch.setattr(operations, "_UPLOADS_ROOT", tmp_path)

    response = client.post(
        "/api/v1/feedback/submissions",
        data={"category": "problem", "message": "El calendario se queda cargando en ciertas cuentas."},
        files={"image": ("evidencia.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["category"] == "problem"
    assert payload["image_url"].startswith("http://testserver/uploads/feedback/")
    assert session.submissions[0].image_path is not None
    assert session.submissions[0].image_path.endswith(".jpg")


def test_create_feedback_submission_rejects_invalid_image_type(monkeypatch) -> None:
    tenant = make_tenant()
    current_user = make_user(tenant_id=tenant.id)
    session = FakeAsyncSession(users=[current_user])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    monkeypatch.setattr(operations.email_service, "send_feedback_submission", _send_feedback_ok)

    response = client.post(
        "/api/v1/feedback/submissions",
        data={"category": "other", "message": "Quiero adjuntar un archivo inválido."},
        files={"image": ("nota.txt", b"hola", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Solo se aceptan imágenes JPEG, PNG o WebP."


def test_create_feedback_submission_rejects_oversized_image(monkeypatch) -> None:
    tenant = make_tenant()
    current_user = make_user(tenant_id=tenant.id)
    session = FakeAsyncSession(users=[current_user])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    monkeypatch.setattr(operations.email_service, "send_feedback_submission", _send_feedback_ok)
    monkeypatch.setattr(operations, "_MAX_PHOTO_BYTES", 10)

    response = client.post(
        "/api/v1/feedback/submissions",
        data={"category": "problem", "message": "Adjunto grande."},
        files={"image": ("huge.jpg", b"\xff\xd8\xff" + b"12345678901", "image/jpeg")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "La imagen supera el tamaño máximo de 15 MB."


def test_create_feedback_submission_rejects_long_message(monkeypatch) -> None:
    tenant = make_tenant()
    current_user = make_user(tenant_id=tenant.id)
    session = FakeAsyncSession(users=[current_user])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    monkeypatch.setattr(operations.email_service, "send_feedback_submission", _send_feedback_ok)

    response = client.post(
        "/api/v1/feedback/submissions",
        data={"category": "improvement", "message": "x" * 5001},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "El mensaje supera el límite de 5000 caracteres."


def test_feedback_endpoints_restrict_unauthorized_roles() -> None:
    tenant = make_tenant()
    trainer_user = make_user(tenant_id=tenant.id, role=UserRole.TRAINER, email="trainer@gym.test")
    session = FakeAsyncSession(users=[trainer_user])
    client = build_client(session=session, tenant=tenant, current_user=trainer_user)

    response = client.get("/api/v1/feedback/submissions")

    assert response.status_code == 403
    assert "no está autorizado" in response.json()["detail"]


def test_list_feedback_submissions_is_tenant_scoped() -> None:
    tenant = make_tenant(name="Gym Uno")
    other_tenant = make_tenant(name="Gym Dos")
    current_user = make_user(tenant_id=tenant.id)
    other_user = make_user(tenant_id=other_tenant.id, email="other@gym.test")
    visible = make_submission(tenant_id=tenant.id, created_by=current_user.id, message="Visible para este tenant.")
    hidden = make_submission(tenant_id=other_tenant.id, created_by=other_user.id, message="No debería aparecer.")
    session = FakeAsyncSession(users=[current_user, other_user], submissions=[visible, hidden])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    response = client.get("/api/v1/feedback/submissions")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["message"] == "Visible para este tenant."
    assert payload[0]["created_by_name"] == current_user.full_name


def test_create_feedback_submission_succeeds_even_if_email_fails(monkeypatch) -> None:
    tenant = make_tenant()
    current_user = make_user(tenant_id=tenant.id)
    session = FakeAsyncSession(users=[current_user])
    client = build_client(session=session, tenant=tenant, current_user=current_user)

    async def failing_email(**_kwargs) -> bool:
        raise RuntimeError("smtp down")

    monkeypatch.setattr(operations.email_service, "send_feedback_submission", failing_email)

    response = client.post(
        "/api/v1/feedback/submissions",
        data={"category": "other", "message": "Aunque falle el correo, esto debe guardarse."},
    )

    assert response.status_code == 201
    assert len(session.submissions) == 1
