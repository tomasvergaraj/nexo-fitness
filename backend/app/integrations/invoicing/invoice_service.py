"""Orchestrates SII invoice generation: load certs → build DTE → upload → save PDF."""

import base64
import logging
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

import structlog
from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates
from lxml import etree

from app.core.config import get_settings

from .dte_builder import (
    DteData,
    DetalleItem,
    Emisor,
    Receptor,
    build_dte_xml,
    build_envio_dte,
    calc_monto_neto,
    calc_monto_total,
)
from .sii_auth import get_token
from .sii_sender import upload_dte

logger = structlog.get_logger(__name__)


class SiiCertificates:
    """Loaded cryptographic material (cached at module level)."""
    _instance: Optional["SiiCertificates"] = None

    def __init__(self, private_key, certificate, caf_xml_bytes: bytes, caf_private_key):
        self.private_key = private_key
        self.certificate = certificate
        self.cert_der = certificate.public_bytes(__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.DER)
        self.caf_xml_bytes = caf_xml_bytes
        self.caf_private_key = caf_private_key

    @classmethod
    def load(cls) -> "SiiCertificates":
        if cls._instance is not None:
            return cls._instance

        settings = get_settings()

        # Load PFX
        pfx_path = Path(settings.SII_PFX_PATH)
        if not pfx_path.exists():
            raise FileNotFoundError(f"SII PFX not found: {pfx_path}")
        pfx_data = pfx_path.read_bytes()
        password = settings.SII_PFX_PASSWORD.encode() if settings.SII_PFX_PASSWORD else None
        private_key, certificate, _ = load_key_and_certificates(pfx_data, password)

        # Load CAF
        caf_path = Path(settings.SII_CAF_PATH)
        if not caf_path.exists():
            raise FileNotFoundError(f"SII CAF not found: {caf_path}")
        caf_xml_bytes = caf_path.read_bytes()

        # Extract CAF private key (RSA key in <RSASK> PEM block)
        caf_root = etree.fromstring(caf_xml_bytes)
        rsask_el = caf_root.find(".//RSASK")
        if rsask_el is None:
            raise ValueError("CAF XML missing <RSASK> element")
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        caf_private_key = load_pem_private_key(rsask_el.text.strip().encode(), password=None)

        cls._instance = cls(private_key, certificate, caf_xml_bytes, caf_private_key)
        return cls._instance

    @classmethod
    def invalidate(cls) -> None:
        cls._instance = None


def _next_folio(current_max: Optional[int], caf_xml_bytes: bytes) -> int:
    """Return next folio, validating against CAF range."""
    caf_root = etree.fromstring(caf_xml_bytes)
    d_el = caf_root.find(".//D")
    h_el = caf_root.find(".//H")
    if d_el is None or h_el is None:
        raise ValueError("CAF XML missing <D> or <H> range elements")
    folio_min = int(d_el.text)
    folio_max = int(h_el.text)

    next_folio = (current_max or folio_min - 1) + 1
    if next_folio > folio_max:
        raise ValueError(
            f"CAF folios exhausted (max {folio_max}). Request new CAF from SII."
        )
    return next_folio


def _generate_pdf(data: DteData, folio: int, output_path: Path) -> None:
    """Generate a simple PDF representation of the factura."""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import cm
    from reportlab.pdfgen import canvas

    output_path.parent.mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    monto_neto = calc_monto_neto(data.items)
    iva = round(monto_neto * 0.19)
    monto_total = calc_monto_total(data.items)

    c = canvas.Canvas(str(output_path), pagesize=letter)
    width, height = letter

    # Header
    c.setFont("Helvetica-Bold", 14)
    c.drawString(2 * cm, height - 2 * cm, data.emisor.razon_social)
    c.setFont("Helvetica", 10)
    c.drawString(2 * cm, height - 2.8 * cm, f"RUT: {data.emisor.rut}")
    c.drawString(2 * cm, height - 3.4 * cm, data.emisor.giro[:80])
    c.drawString(2 * cm, height - 4.0 * cm, f"{data.emisor.direccion}, {data.emisor.comuna}")

    # Document title (right side)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(width - 2 * cm, height - 2 * cm, "FACTURA ELECTRÓNICA")
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(width - 2 * cm, height - 2.8 * cm, f"N° {folio}")
    c.setFont("Helvetica", 10)
    c.drawRightString(width - 2 * cm, height - 3.4 * cm, f"Fecha: {data.fecha_emision.strftime('%d/%m/%Y')}")
    c.setFont("Helvetica", 9)
    c.drawRightString(width - 2 * cm, height - 4.0 * cm, f"Ambiente: {settings.SII_ENV.upper()}")

    # Separator
    c.line(2 * cm, height - 4.5 * cm, width - 2 * cm, height - 4.5 * cm)

    # Receptor
    c.setFont("Helvetica-Bold", 10)
    c.drawString(2 * cm, height - 5.2 * cm, "RECEPTOR")
    c.setFont("Helvetica", 10)
    c.drawString(2 * cm, height - 5.9 * cm, f"RUT: {data.receptor.rut}")
    c.drawString(2 * cm, height - 6.5 * cm, f"Razón Social: {data.receptor.razon_social}")
    c.drawString(2 * cm, height - 7.1 * cm, f"Giro: {data.receptor.giro[:60]}")
    c.drawString(2 * cm, height - 7.7 * cm, f"Dirección: {data.receptor.direccion}, {data.receptor.comuna}")

    # Separator
    c.line(2 * cm, height - 8.2 * cm, width - 2 * cm, height - 8.2 * cm)

    # Items header
    y = height - 8.9 * cm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(2 * cm, y, "DESCRIPCIÓN")
    c.drawRightString(9 * cm, y, "CANT.")
    c.drawRightString(13 * cm, y, "P. UNITARIO")
    c.drawRightString(width - 2 * cm, y, "TOTAL")
    y -= 0.5 * cm
    c.line(2 * cm, y, width - 2 * cm, y)
    y -= 0.6 * cm

    c.setFont("Helvetica", 9)
    for item in data.items:
        subtotal = item.cantidad * item.precio_unitario
        if item.descuento_pct:
            subtotal = int(subtotal * (1 - item.descuento_pct / 100))
        c.drawString(2 * cm, y, item.nombre[:60])
        c.drawRightString(9 * cm, y, str(item.cantidad))
        c.drawRightString(13 * cm, y, f"${item.precio_unitario:,}".replace(",", "."))
        c.drawRightString(width - 2 * cm, y, f"${subtotal:,}".replace(",", "."))
        y -= 0.6 * cm

    # Totals
    y -= 0.3 * cm
    c.line(width - 8 * cm, y, width - 2 * cm, y)
    y -= 0.6 * cm
    c.setFont("Helvetica", 10)
    c.drawString(width - 8 * cm, y, "Neto:")
    c.drawRightString(width - 2 * cm, y, f"${monto_neto:,}".replace(",", "."))
    y -= 0.6 * cm
    c.drawString(width - 8 * cm, y, "IVA (19%):")
    c.drawRightString(width - 2 * cm, y, f"${iva:,}".replace(",", "."))
    y -= 0.6 * cm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(width - 8 * cm, y, "TOTAL:")
    c.drawRightString(width - 2 * cm, y, f"${monto_total:,}".replace(",", "."))

    c.save()


async def generate_invoice(
    payment_id: str,
    tenant_tax_id: str,
    tenant_legal_name: str,
    tenant_giro: str,
    tenant_address: str,
    tenant_commune: str,
    tenant_city: str,
    plan_name: str,
    base_amount: Decimal,
    current_max_folio: Optional[int],
) -> dict:
    """
    Generate, sign, and upload a Factura Electrónica tipo 33.

    Returns dict with folio, sii_track_id, invoice_status, invoice_xml, invoice_pdf_path.
    """
    settings = get_settings()

    certs = SiiCertificates.load()
    folio = _next_folio(current_max_folio, certs.caf_xml_bytes)

    emisor = Emisor(
        rut=settings.SII_RUT_EMISOR,
        razon_social="NEXO SOFTWARE SPA",
        giro=(
            "Desarrollo, comercialización, implementación y mantención de software, "
            "plataformas web, sistemas informáticos y servicios tecnológicos"
        ),
        acteco=settings.SII_ACTECO,
        direccion="El Chamanto 1754",
        comuna="Quillota",
        ciudad="Quillota",
    )

    receptor = Receptor(
        rut=tenant_tax_id,
        razon_social=tenant_legal_name,
        giro=tenant_giro or "Sin giro",
        direccion=tenant_address or "Sin dirección",
        comuna=tenant_commune or "Sin comuna",
        ciudad=tenant_city or "Sin ciudad",
    )

    # base_amount is already the neto amount stored in PlatformBillingPayment
    neto = int(base_amount)
    items = [
        DetalleItem(
            nombre=f"Suscripción NexoFitness - {plan_name}",
            cantidad=1,
            precio_unitario=neto,
        )
    ]

    data = DteData(
        folio=folio,
        fecha_emision=date.today(),
        emisor=emisor,
        receptor=receptor,
        items=items,
    )

    # Build and sign DTE
    dte_el = build_dte_xml(
        data=data,
        caf_xml_bytes=certs.caf_xml_bytes,
        caf_private_key=certs.caf_private_key,
        doc_private_key=certs.private_key,
        doc_cert_der=certs.cert_der,
    )

    xml_bytes = build_envio_dte(
        dte_elements=[dte_el],
        rut_emisor=settings.SII_RUT_EMISOR,
        rut_envia=settings.SII_RUT_ENVIA,
        tipo_dte=33,
        nro_resol=settings.SII_NRO_RESOL,
        fch_resol=settings.SII_FCH_RESOL,
        doc_private_key=certs.private_key,
        doc_cert_der=certs.cert_der,
    )

    invoice_xml_str = xml_bytes.decode("iso-8859-1")

    # Upload to SII
    track_id = "pending"
    invoice_status = "pending"
    try:
        token = await get_token(
            env=settings.SII_ENV,
            private_key=certs.private_key,
            cert_der=certs.cert_der,
            rut_envia=settings.SII_RUT_ENVIA,
        )
        track_id = await upload_dte(
            env=settings.SII_ENV,
            token=token,
            rut_emisor=settings.SII_RUT_EMISOR,
            rut_envia=settings.SII_RUT_ENVIA,
            xml_bytes=xml_bytes,
        )
        invoice_status = "sent"
        logger.info("sii_dte_uploaded", folio=folio, track_id=track_id, payment_id=payment_id)
    except Exception as exc:
        logger.error("sii_dte_upload_failed", folio=folio, error=str(exc), payment_id=payment_id)
        invoice_status = "upload_error"

    # Generate PDF
    pdf_path = ""
    try:
        pdf_file = Path(settings.SII_INVOICE_PDF_DIR) / f"factura_{folio}_{payment_id[:8]}.pdf"
        _generate_pdf(data, folio, pdf_file)
        pdf_path = str(pdf_file)
    except Exception as exc:
        logger.error("sii_pdf_generation_failed", folio=folio, error=str(exc))

    return {
        "folio_number": folio,
        "sii_track_id": track_id,
        "invoice_status": invoice_status,
        "invoice_xml": invoice_xml_str,
        "invoice_pdf_path": pdf_path,
    }
