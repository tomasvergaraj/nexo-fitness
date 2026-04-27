from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints import public
from app.core import dependencies as core_dependencies
from app.models.business import FeedbackCategory, FeedbackSubmission
from app.models.tenant import LicenseType, Tenant, TenantStatus
from app.models.user import User, UserRole


class FakeRow:
    def __init__(self, values: dict):
        self._mapping = values


class FakeResult:
    def __init__(self, *, items=None, scalar_value=None):
        self._items = list(items or [])
        self._scalar_value = scalar_value

    def all(self):
        return list(self._items)

    def scalar(self):
        return self._scalar_value


class FakeAsyncSession:
    def __init__(
        self,
        *,
        tenants: list[Tenant] | None = None,
        users: list[User] | None = None,
        submissions: list[FeedbackSubmission] | None = None,
    ):
        self.tenants = {tenant.id: tenant for tenant in tenants or []}
        self.users = {user.id: user for user in users or []}
        self.submissions = list(submissions or [])

    async def execute(self, statement):
        sql = str(statement)
        params = statement.compile().params

        if "FROM feedback_submissions" not in sql:
            raise AssertionError(f"Unexpected statement: {sql}")

        items = self._filter_feedback(params, sql)
        if "count(" in sql.lower():
            return FakeResult(scalar_value=len(items))

        items.sort(key=lambda item: item.created_at, reverse=True)
        return FakeResult(items=[self._to_row(item) for item in items])

    def _filter_feedback(self, params: dict, sql: str) -> list[FeedbackSubmission]:
        tenant_filter = next((value for key, value in params.items() if "tenant_id" in key and isinstance(value, UUID)), None)
        category_filter = next((value for key, value in params.items() if "category" in key), None)
        date_filters = [value for key, value in params.items() if "created_at" in key and isinstance(value, datetime)]
        search_like = next((value for value in params.values() if isinstance(value, str) and "%" in value), None)
        search_term = search_like.strip("%").lower() if search_like else ""

        filtered: list[FeedbackSubmission] = []
        for submission in self.submissions:
            tenant = self.tenants[submission.tenant_id]
            author = self.users.get(submission.created_by)
            category_value = submission.category.value if hasattr(submission.category, "value") else str(submission.category)

            if tenant_filter and submission.tenant_id != tenant_filter:
                continue
            if category_filter and category_value != str(category_filter.value if hasattr(category_filter, "value") else category_filter):
                continue
            if date_filters:
                start = date_filters[0]
                if submission.created_at < start:
                    continue
                if len(date_filters) > 1 and submission.created_at >= date_filters[1]:
                    continue
            if "feedback_submissions.image_path IS NOT NULL" in sql and not submission.image_path:
                continue
            if "feedback_submissions.image_path IS NULL" in sql and submission.image_path:
                continue
            if search_term:
                search_blob = " ".join(
                    part
                    for part in [
                        submission.message,
                        tenant.name,
                        tenant.slug,
                        author.first_name if author else "",
                        author.last_name if author else "",
                        author.full_name if author else "",
                        author.email if author else "",
                    ]
                    if part
                ).lower()
                if search_term not in search_blob:
                    continue

            filtered.append(submission)

        return filtered

    def _to_row(self, submission: FeedbackSubmission) -> FakeRow:
        tenant = self.tenants[submission.tenant_id]
        author = self.users.get(submission.created_by)
        return FakeRow(
            {
                "id": submission.id,
                "tenant_id": submission.tenant_id,
                "tenant_name": tenant.name,
                "tenant_slug": tenant.slug,
                "category": submission.category,
                "message": submission.message,
                "image_path": submission.image_path,
                "created_at": submission.created_at,
                "created_by": submission.created_by,
                "created_by_first_name": author.first_name if author else None,
                "created_by_last_name": author.last_name if author else None,
                "created_by_email": author.email if author else None,
            }
        )


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


def make_user(
    *,
    role: UserRole = UserRole.SUPERADMIN,
    is_superadmin: bool = True,
    tenant_id: UUID | None = None,
    **overrides,
) -> User:
    user = User(
        id=uuid4(),
        tenant_id=tenant_id,
        email="superadmin@nexofitness.cl" if is_superadmin else f"{role.value}@gym.test",
        hashed_password="hashed",
        first_name="Nora",
        last_name="Ops",
        role=role,
        is_superadmin=is_superadmin,
        is_active=True,
        is_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


def make_submission(
    *,
    tenant_id: UUID,
    created_by: UUID | None,
    category: FeedbackCategory = FeedbackCategory.SUGGESTION,
    created_at: datetime | None = None,
    **overrides,
) -> FeedbackSubmission:
    submission = FeedbackSubmission(
        id=uuid4(),
        tenant_id=tenant_id,
        created_by=created_by,
        category=category,
        message="Queremos más filtros en reportes.",
        image_path=None,
        created_at=created_at or datetime.now(timezone.utc),
    )
    for key, value in overrides.items():
        setattr(submission, key, value)
    return submission


def build_client(*, session: FakeAsyncSession, current_user: User) -> TestClient:
    app = FastAPI()
    app.include_router(public.platform_router, prefix="/api/v1")

    async def override_db():
        yield session

    async def override_current_user():
        return current_user

    app.dependency_overrides[public.get_db] = override_db
    app.dependency_overrides[core_dependencies.get_current_user] = override_current_user

    return TestClient(app)


def test_platform_feedback_requires_superadmin() -> None:
    tenant = make_tenant()
    owner = make_user(role=UserRole.OWNER, is_superadmin=False, tenant_id=tenant.id, email="owner@gym.test")
    session = FakeAsyncSession(tenants=[tenant], users=[owner])
    client = build_client(session=session, current_user=owner)

    response = client.get("/api/v1/platform/feedback")

    assert response.status_code == 403
    assert "superadministrador" in response.json()["detail"]


def test_platform_feedback_filters_by_search_category_tenant_date_and_has_image() -> None:
    tenant = make_tenant(name="Gym Norte", slug="gym-norte")
    other_tenant = make_tenant(name="Gym Sur", slug="gym-sur")
    author = make_user(role=UserRole.ADMIN, is_superadmin=False, tenant_id=tenant.id, email="admin@gymnorte.test")
    other_author = make_user(role=UserRole.OWNER, is_superadmin=False, tenant_id=other_tenant.id, email="owner@gymsur.test")
    superadmin = make_user()
    session = FakeAsyncSession(
        tenants=[tenant, other_tenant],
        users=[author, other_author, superadmin],
        submissions=[
            make_submission(
                tenant_id=tenant.id,
                created_by=author.id,
                category=FeedbackCategory.PROBLEM,
                message="El módulo de reportes no guarda los filtros aplicados.",
                created_at=datetime.now(timezone.utc) - timedelta(days=1),
            ),
            make_submission(
                tenant_id=tenant.id,
                created_by=author.id,
                category=FeedbackCategory.PROBLEM,
                message="Error visual con el panel.",
                image_path="/uploads/feedback/with-image.jpg",
            ),
            make_submission(
                tenant_id=other_tenant.id,
                created_by=other_author.id,
                category=FeedbackCategory.PROBLEM,
                message="El módulo de reportes no guarda nada.",
            ),
        ],
    )
    client = build_client(session=session, current_user=superadmin)

    response = client.get(
        "/api/v1/platform/feedback",
        params={
            "search": "filtros",
            "category": "problem",
            "tenant_id": str(tenant.id),
            "date_from": str(date.today() - timedelta(days=2)),
            "date_to": str(date.today()),
            "has_image": "false",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["tenant_name"] == "Gym Norte"
    assert payload["items"][0]["tenant_slug"] == "gym-norte"
    assert payload["items"][0]["category"] == "problem"
    assert payload["items"][0]["created_by_name"] == author.full_name
    assert payload["items"][0]["created_by_email"] == author.email
    assert "filtros" in payload["items"][0]["message"].lower()


def test_platform_feedback_sorts_desc_and_tolerates_deleted_author() -> None:
    tenant = make_tenant()
    author = make_user(role=UserRole.ADMIN, is_superadmin=False, tenant_id=tenant.id, email="admin@gym.test")
    superadmin = make_user()
    older = make_submission(
        tenant_id=tenant.id,
        created_by=author.id,
        message="Feedback antiguo.",
        created_at=datetime.now(timezone.utc) - timedelta(days=2),
    )
    newer = make_submission(
        tenant_id=tenant.id,
        created_by=uuid4(),
        message="Feedback reciente con adjunto.",
        image_path="/uploads/feedback/sample.jpg",
        created_at=datetime.now(timezone.utc),
    )
    session = FakeAsyncSession(tenants=[tenant], users=[author, superadmin], submissions=[older, newer])
    client = build_client(session=session, current_user=superadmin)

    response = client.get("/api/v1/platform/feedback")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["message"] == "Feedback reciente con adjunto."
    assert payload["items"][0]["created_by_name"] is None
    assert payload["items"][0]["created_by_email"] is None
    assert payload["items"][0]["image_url"] == "http://testserver/uploads/feedback/sample.jpg"
    assert payload["items"][1]["message"] == "Feedback antiguo."


def test_platform_feedback_rejects_invalid_date_range() -> None:
    tenant = make_tenant()
    superadmin = make_user()
    session = FakeAsyncSession(tenants=[tenant], users=[superadmin], submissions=[])
    client = build_client(session=session, current_user=superadmin)

    response = client.get(
        "/api/v1/platform/feedback",
        params={"date_from": "2026-04-23", "date_to": "2026-04-22"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "El rango de fechas es inválido"
