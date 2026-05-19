"""Upload endpoints (tenant logo)."""

from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.dependencies import get_current_tenant, require_roles
from app.models.tenant import Tenant

from ._common import _PNG_MAGIC, _UPLOADS_ROOT

upload_router = APIRouter(prefix="/upload", tags=["Upload"])

_MAX_LOGO_BYTES = 4 * 1024 * 1024  # 4 MB raw limit (client resizes before upload)


@upload_router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    tenant: Tenant = Depends(get_current_tenant),
    _user=Depends(require_roles("owner", "admin")),
):
    """Upload a PNG logo for the tenant. Returns the public URL."""
    content = await file.read()

    if len(content) > _MAX_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="La imagen supera el tamaño maximo de 4 MB.")

    if not content.startswith(_PNG_MAGIC):
        raise HTTPException(status_code=400, detail="Solo se aceptan imagenes en formato PNG.")

    tenant_dir = _UPLOADS_ROOT / "logos" / str(tenant.id)
    tenant_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid4().hex}.png"
    dest = tenant_dir / filename
    dest.write_bytes(content)

    url = f"/uploads/logos/{tenant.id}/{filename}"
    return {"url": url}
