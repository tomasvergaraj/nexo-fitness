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
