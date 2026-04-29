"""Build and sign DTE documents (tipo 33/61/56) for SII Chile."""

import base64
import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from lxml import etree

SII_DTE_NS = "http://www.sii.cl/SiiDte"
DSIG_NS = "http://www.w3.org/2000/09/xmldsig#"

# CodRef values for Referencia
COD_REF_ANULA = 1
COD_REF_CORRIGE_TEXTO = 2
COD_REF_CORRIGE_MONTOS = 3


@dataclass
class Emisor:
    rut: str
    razon_social: str
    giro: str
    acteco: str
    direccion: str
    comuna: str
    ciudad: str


@dataclass
class Receptor:
    rut: str
    razon_social: str
    giro: str
    direccion: str
    comuna: str
    ciudad: str


@dataclass
class DetalleItem:
    nombre: str
    cantidad: int
    precio_unitario: int    # precio neto unitario CLP
    descuento_pct: int = 0  # descuento por línea %
    exento: bool = False    # True = sin IVA


@dataclass
class Referencia:
    tipo_doc_ref: int       # 33=factura, 61=NC, 56=ND
    folio_ref: int
    fch_ref: date
    cod_ref: int            # 1=anula, 2=corrige texto, 3=corrige montos
    razon_ref: str


@dataclass
class DteData:
    folio: int
    fecha_emision: date
    emisor: Emisor
    receptor: Receptor
    items: list
    tipo_dte: int = 33              # 33=factura, 61=NC, 56=ND
    forma_pago: int = 1             # 1=Contado
    descuento_global_pct: int = 0   # % descuento global sobre ítems afectos
    referencias: list = field(default_factory=list)


# ─── Math helpers ────────────────────────────────────────────────────────────

def _item_monto(item: DetalleItem) -> int:
    base = item.cantidad * item.precio_unitario
    if item.descuento_pct:
        return round(base * (1 - item.descuento_pct / 100))
    return base


def calc_monto_neto(items: list, descuento_global_pct: int = 0) -> int:
    total = sum(_item_monto(i) for i in items if not i.exento)
    if descuento_global_pct:
        total -= round(total * descuento_global_pct / 100)
    return total


def calc_monto_exento(items: list) -> int:
    return sum(_item_monto(i) for i in items if i.exento)


def calc_iva(monto_neto: int) -> int:
    return round(monto_neto * 0.19)


def calc_monto_total(items: list, descuento_global_pct: int = 0) -> int:
    neto = calc_monto_neto(items, descuento_global_pct)
    exento = calc_monto_exento(items)
    return neto + calc_iva(neto) + exento


# ─── Signing helpers ─────────────────────────────────────────────────────────

def _c14n(el: etree._Element) -> bytes:
    return etree.tostring(el, method="c14n", exclusive=False, with_tail=False)


def _sha1_b64(data: bytes) -> str:
    return base64.b64encode(hashlib.sha1(data).digest()).decode()


def _sign_bytes(data: bytes, private_key) -> str:
    sig = private_key.sign(data, asym_padding.PKCS1v15(), hashes.SHA1())
    return base64.b64encode(sig).decode()


def _trunc(s: str, n: int) -> str:
    return (s or "")[:n]


# ─── TED (Timbre Electrónico DTE) ────────────────────────────────────────────

def _build_ted(data: DteData, caf_xml_bytes: bytes, caf_private_key) -> etree._Element:
    caf_root = etree.fromstring(caf_xml_bytes)
    caf_el = caf_root.find("CAF")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    monto_total = calc_monto_total(data.items, data.descuento_global_pct)
    primer_item = _trunc(data.items[0].nombre, 40) if data.items else ""

    ted = etree.Element("TED")
    ted.set("version", "1.0")

    dd = etree.SubElement(ted, "DD")
    etree.SubElement(dd, "RE").text = data.emisor.rut
    etree.SubElement(dd, "TD").text = str(data.tipo_dte)
    etree.SubElement(dd, "F").text = str(data.folio)
    etree.SubElement(dd, "FE").text = data.fecha_emision.strftime("%Y-%m-%d")
    etree.SubElement(dd, "RR").text = data.receptor.rut
    etree.SubElement(dd, "RSR").text = _trunc(data.receptor.razon_social, 40)
    etree.SubElement(dd, "MNT").text = str(monto_total)
    etree.SubElement(dd, "IT1").text = primer_item
    dd.append(caf_el)
    etree.SubElement(dd, "TSTED").text = now_str

    frmt_val = _sign_bytes(_c14n(dd), caf_private_key)
    frmt = etree.SubElement(ted, "FRMT")
    frmt.set("algoritmo", "SHA1withRSA")
    frmt.text = frmt_val

    return ted


# ─── Documento ───────────────────────────────────────────────────────────────

def _build_documento(data: DteData, caf_xml_bytes: bytes, caf_private_key) -> etree._Element:
    doc_id = f"F{data.tipo_dte}N{data.folio}"
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    monto_neto = calc_monto_neto(data.items, data.descuento_global_pct)
    monto_exento = calc_monto_exento(data.items)
    iva = calc_iva(monto_neto)
    monto_total = monto_neto + iva + monto_exento

    doc = etree.Element("Documento")
    doc.set("ID", doc_id)

    # ── Encabezado ──
    enc = etree.SubElement(doc, "Encabezado")

    id_doc = etree.SubElement(enc, "IdDoc")
    etree.SubElement(id_doc, "TipoDTE").text = str(data.tipo_dte)
    etree.SubElement(id_doc, "Folio").text = str(data.folio)
    etree.SubElement(id_doc, "FchEmis").text = data.fecha_emision.strftime("%Y-%m-%d")
    etree.SubElement(id_doc, "FmaPago").text = str(data.forma_pago)

    emisor_el = etree.SubElement(enc, "Emisor")
    etree.SubElement(emisor_el, "RUTEmisor").text = data.emisor.rut
    etree.SubElement(emisor_el, "RznSoc").text = data.emisor.razon_social
    etree.SubElement(emisor_el, "GiroEmis").text = _trunc(data.emisor.giro, 80)
    etree.SubElement(emisor_el, "Acteco").text = data.emisor.acteco
    etree.SubElement(emisor_el, "DirOrigen").text = data.emisor.direccion
    etree.SubElement(emisor_el, "CmnaOrigen").text = data.emisor.comuna
    etree.SubElement(emisor_el, "CiudadOrigen").text = data.emisor.ciudad

    recep_el = etree.SubElement(enc, "Receptor")
    etree.SubElement(recep_el, "RUTRecep").text = data.receptor.rut
    etree.SubElement(recep_el, "RznSocRecep").text = data.receptor.razon_social
    etree.SubElement(recep_el, "GiroRecep").text = _trunc(data.receptor.giro or "Sin giro", 80)
    etree.SubElement(recep_el, "DirRecep").text = data.receptor.direccion or "Sin direccion"
    etree.SubElement(recep_el, "CmnaRecep").text = data.receptor.comuna or "Sin comuna"
    etree.SubElement(recep_el, "CiudadRecep").text = data.receptor.ciudad or "Sin ciudad"

    totales = etree.SubElement(enc, "Totales")
    if monto_neto:
        etree.SubElement(totales, "MntNeto").text = str(monto_neto)
    if monto_exento:
        etree.SubElement(totales, "MntExe").text = str(monto_exento)
    if monto_neto:
        etree.SubElement(totales, "TasaIVA").text = "19.00"
        etree.SubElement(totales, "IVA").text = str(iva)
    etree.SubElement(totales, "MntTotal").text = str(monto_total)

    # ── Detalle ──
    for i, item in enumerate(data.items, start=1):
        det = etree.SubElement(doc, "Detalle")
        etree.SubElement(det, "NroLinDet").text = str(i)
        if item.exento:
            etree.SubElement(det, "IndExe").text = "1"
        etree.SubElement(det, "NmbItem").text = _trunc(item.nombre, 80)
        etree.SubElement(det, "QtyItem").text = str(item.cantidad)
        etree.SubElement(det, "UnmdItem").text = "servicio"
        etree.SubElement(det, "PrcItem").text = str(item.precio_unitario)
        if item.descuento_pct:
            etree.SubElement(det, "DescuentoPct").text = str(item.descuento_pct)
        etree.SubElement(det, "MontoItem").text = str(_item_monto(item))

    # ── Descuento Global ──
    if data.descuento_global_pct:
        dsg = etree.SubElement(doc, "DscRcgGlobal")
        etree.SubElement(dsg, "NroLinDR").text = "1"
        etree.SubElement(dsg, "TpoMov").text = "D"
        etree.SubElement(dsg, "GlosaDR").text = "Descuento Global"
        etree.SubElement(dsg, "TpoValor").text = "%"
        etree.SubElement(dsg, "ValorDR").text = str(data.descuento_global_pct)

    # ── Referencias ──
    for j, ref in enumerate(data.referencias or [], start=1):
        ref_el = etree.SubElement(doc, "Referencia")
        etree.SubElement(ref_el, "NroLinRef").text = str(j)
        etree.SubElement(ref_el, "TpoDocRef").text = str(ref.tipo_doc_ref)
        etree.SubElement(ref_el, "FolioRef").text = str(ref.folio_ref)
        etree.SubElement(ref_el, "FchRef").text = ref.fch_ref.strftime("%Y-%m-%d")
        etree.SubElement(ref_el, "CodRef").text = str(ref.cod_ref)
        etree.SubElement(ref_el, "RazonRef").text = _trunc(ref.razon_ref, 90)

    # ── TED y TmstFirma ──
    doc.append(_build_ted(data, caf_xml_bytes, caf_private_key))
    etree.SubElement(doc, "TmstFirma").text = now_str

    return doc


# ─── XML DSIG Signature ───────────────────────────────────────────────────────

def _xml_signature(ref_id: str, el: etree._Element, private_key, cert_der: bytes) -> etree._Element:
    digest_b64 = _sha1_b64(_c14n(el))

    si_xml = (
        '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">'
        '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>'
        '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>'
        f'<Reference URI="#{ref_id}">'
        '<Transforms>'
        '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>'
        '</Transforms>'
        '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>'
        f'<DigestValue>{digest_b64}</DigestValue>'
        '</Reference>'
        '</SignedInfo>'
    )
    si_el = etree.fromstring(si_xml.encode("utf-8"))
    sig_val = _sign_bytes(_c14n(si_el), private_key)
    cert_b64 = base64.b64encode(cert_der).decode()

    sig_el = etree.Element(f"{{{DSIG_NS}}}Signature", nsmap={None: DSIG_NS})
    sig_el.append(si_el)
    sv = etree.SubElement(sig_el, f"{{{DSIG_NS}}}SignatureValue")
    sv.text = sig_val
    ki = etree.SubElement(sig_el, f"{{{DSIG_NS}}}KeyInfo")
    x509d = etree.SubElement(ki, f"{{{DSIG_NS}}}X509Data")
    x509c = etree.SubElement(x509d, f"{{{DSIG_NS}}}X509Certificate")
    x509c.text = cert_b64

    return sig_el


# ─── Public API ───────────────────────────────────────────────────────────────

def build_dte_xml(
    data: DteData,
    caf_xml_bytes: bytes,
    caf_private_key,
    doc_private_key,
    doc_cert_der: bytes,
) -> etree._Element:
    """Return a signed <DTE> element ready to embed in EnvioDTE."""
    dte = etree.Element("DTE")
    dte.set("version", "1.0")

    doc_el = _build_documento(data, caf_xml_bytes, caf_private_key)
    dte.append(doc_el)
    dte.append(_xml_signature(doc_el.get("ID"), doc_el, doc_private_key, doc_cert_der))

    return dte


def build_envio_dte(
    dte_elements: list,
    rut_emisor: str,
    rut_envia: str,
    tipo_dte: int,
    nro_resol: int,
    fch_resol: str,
    doc_private_key,
    doc_cert_der: bytes,
) -> bytes:
    """Wrap one or more DTE elements in EnvioDTE, sign, return ISO-8859-1 bytes."""
    rut_receptor_sii = "60803000-K"
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    # Use lxml nsmap so all child elements inherit the SiiDte namespace in C14N,
    # matching what SII computes when verifying the enveloped signature.
    nsmap = {None: SII_DTE_NS}
    envio = etree.Element(f"{{{SII_DTE_NS}}}EnvioDTE", nsmap=nsmap)
    envio.set("version", "1.0")

    set_dte = etree.SubElement(envio, f"{{{SII_DTE_NS}}}SetDTE")
    set_dte.set("ID", "SetDTE")

    caratula = etree.SubElement(set_dte, f"{{{SII_DTE_NS}}}Caratula")
    caratula.set("version", "1.0")
    etree.SubElement(caratula, f"{{{SII_DTE_NS}}}RutEmisor").text = rut_emisor
    etree.SubElement(caratula, f"{{{SII_DTE_NS}}}RutEnvia").text = rut_envia
    etree.SubElement(caratula, f"{{{SII_DTE_NS}}}RutReceptor").text = rut_receptor_sii
    etree.SubElement(caratula, f"{{{SII_DTE_NS}}}FchResol").text = fch_resol
    etree.SubElement(caratula, f"{{{SII_DTE_NS}}}NroResol").text = str(nro_resol)
    etree.SubElement(caratula, f"{{{SII_DTE_NS}}}TmstFirmaEnv").text = now_str

    sub_tot = etree.SubElement(caratula, f"{{{SII_DTE_NS}}}SubTotDTE")
    etree.SubElement(sub_tot, f"{{{SII_DTE_NS}}}TpoDTE").text = str(tipo_dte)
    etree.SubElement(sub_tot, f"{{{SII_DTE_NS}}}NroDTE").text = str(len(dte_elements))

    for dte_el in dte_elements:
        set_dte.append(dte_el)

    envio.append(_xml_signature("SetDTE", set_dte, doc_private_key, doc_cert_der))

    xml_bytes = etree.tostring(
        envio,
        xml_declaration=True,
        encoding="ISO-8859-1",
        pretty_print=False,
    )
    # Normalize XML declaration: replace all single quotes in the declaration with double quotes.
    decl_end = xml_bytes.index(b"?>") + 2
    decl = xml_bytes[:decl_end].replace(b"'", b'"')
    return decl + xml_bytes[decl_end:]
