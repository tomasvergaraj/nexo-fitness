"""Stripe payment integration for Nexo Fitness."""

from typing import Optional
from decimal import Decimal

from app.core.config import get_settings

settings = get_settings()


class StripeService:
    """Handles Stripe payment operations for tenant billing and member payments."""

    def __init__(self):
        self._initialized = False
        self._stripe = None

    def _ensure_init(self):
        if not self._initialized:
            try:
                import stripe
                stripe.api_key = settings.STRIPE_SECRET_KEY
                self._stripe = stripe
                self._initialized = True
            except ImportError:
                raise RuntimeError("stripe package not installed")

    async def create_customer(self, email: str, name: str, metadata: Optional[dict] = None) -> str:
        self._ensure_init()
        customer = self._stripe.Customer.create(email=email, name=name, metadata=metadata or {})
        return customer.id

    async def create_checkout_session(
        self,
        price_id: str,
        customer_id: str,
        success_url: str,
        cancel_url: str,
        mode: str = "subscription",
        metadata: Optional[dict] = None,
    ) -> dict:
        self._ensure_init()
        session = self._stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode=mode,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=metadata or {},
        )
        return {"session_id": session.id, "url": session.url}

    async def create_payment_intent(
        self,
        amount: int,  # in cents
        currency: str = "clp",
        customer_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        self._ensure_init()
        intent = self._stripe.PaymentIntent.create(
            amount=amount,
            currency=currency.lower(),
            customer=customer_id,
            metadata=metadata or {},
        )
        return {"client_secret": intent.client_secret, "payment_intent_id": intent.id}

    async def handle_webhook(self, payload: bytes, sig_header: str) -> dict:
        self._ensure_init()
        event = self._stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        return {"type": event.type, "data": event.data.object}

    async def cancel_subscription(self, subscription_id: str) -> dict:
        self._ensure_init()
        sub = self._stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)
        return {"id": sub.id, "status": sub.status, "cancel_at_period_end": sub.cancel_at_period_end}


stripe_service = StripeService()
