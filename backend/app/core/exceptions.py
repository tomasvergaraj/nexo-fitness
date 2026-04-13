from __future__ import annotations

from typing import Optional


class ActionRequiredError(Exception):
    def __init__(
        self,
        detail: str,
        *,
        status_code: int = 403,
        next_action: Optional[str] = None,
        checkout_url: Optional[str] = None,
        billing_status: Optional[str] = None,
        tenant_slug: Optional[str] = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.next_action = next_action
        self.checkout_url = checkout_url
        self.billing_status = billing_status
        self.tenant_slug = tenant_slug

    def to_response(self) -> dict[str, str]:
        response = {"detail": self.detail}
        if self.next_action:
            response["next_action"] = self.next_action
        if self.checkout_url:
            response["checkout_url"] = self.checkout_url
        if self.billing_status:
            response["billing_status"] = self.billing_status
        if self.tenant_slug:
            response["tenant_slug"] = self.tenant_slug
        return response


class PlanLimitReachedError(Exception):
    def __init__(
        self,
        detail: str,
        *,
        resource: str,
        current_usage: int,
        limit: int,
        plan_key: str,
        upgrade_required: bool = True,
        status_code: int = 409,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.resource = resource
        self.current_usage = current_usage
        self.limit = limit
        self.plan_key = plan_key
        self.upgrade_required = upgrade_required
        self.status_code = status_code

    def to_response(self) -> dict[str, object]:
        return {
            "detail": self.detail,
            "code": "plan_limit_reached",
            "resource": self.resource,
            "current_usage": self.current_usage,
            "limit": self.limit,
            "plan_key": self.plan_key,
            "upgrade_required": self.upgrade_required,
        }
