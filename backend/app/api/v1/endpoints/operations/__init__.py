"""Tenant operations endpoints — split across sub-modules per domain.

All routers are re-exported here so main.py keeps importing them as
`operations.<name>_router`.
"""

from .branches import branches_router  # noqa: F401
from .campaigns import campaigns_router  # noqa: F401
from .feedback import feedback_router  # noqa: F401
from .gift_cards import gift_cards_router  # noqa: F401
from .memberships import memberships_router  # noqa: F401
from .mobile import mobile_router  # noqa: F401
from .notifications import notifications_router  # noqa: F401
from .payment_accounts import payment_accounts_router  # noqa: F401
from .personal_records import personal_records_router  # noqa: F401
from .programs import programs_router  # noqa: F401
from .progress import progress_router  # noqa: F401
from .promo_codes import promo_codes_router  # noqa: F401
from .reports import reports_router  # noqa: F401
from .settings import settings_router  # noqa: F401
from .staff import staff_router  # noqa: F401
from .support import support_router  # noqa: F401
from .upload import upload_router  # noqa: F401
