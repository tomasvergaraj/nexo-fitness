"""Upload EnvioDTE to SII and query status."""

import httpx
from .sii_auth import SII_URLS


async def upload_dte(
    env: str,
    token: str,
    rut_emisor: str,
    rut_envia: str,
    xml_bytes: bytes,
) -> str:
    """Upload signed EnvioDTE XML. Returns SII trackId."""
    rut_num, dv = rut_emisor.split("-")
    envia_num, envia_dv = rut_envia.split("-")

    url = SII_URLS[env]["upload"]

    files = {
        "archivo": ("enviodte.xml", xml_bytes, "text/xml"),
    }
    data = {
        "rutSender": envia_num,
        "dvSender": envia_dv,
        "rutCompany": rut_num,
        "dvCompany": dv,
    }
    headers = {"Cookie": f"TOKEN={token}"}

    async with httpx.AsyncClient(verify=True) as client:
        resp = await client.post(url, data=data, files=files, headers=headers, timeout=60)
        resp.raise_for_status()

    # SII returns XML with <TRACKID> or <STATUS>
    resp_text = resp.text
    if "<TRACKID>" in resp_text:
        start = resp_text.index("<TRACKID>") + len("<TRACKID>")
        end = resp_text.index("</TRACKID>")
        return resp_text[start:end].strip()

    # STATUS=0 also means OK in some responses
    if "<STATUS>0</STATUS>" in resp_text:
        return "0"

    raise ValueError(f"SII upload error. Response: {resp_text[:500]}")


async def query_dte_status(
    env: str,
    token: str,
    rut_emisor: str,
    tipo_dte: int,
    folio: int,
    fecha_emision: str,
    monto: int,
    rut_receptor: str,
) -> dict:
    """Query DTE acceptance status from SII (after upload)."""
    from lxml import etree
    from .sii_auth import _soap_envelope, _SOAP_HEADERS

    rut_num, dv = rut_emisor.split("-")
    rec_num, rec_dv = rut_receptor.split("-")

    soap = _soap_envelope(
        "<getEstDte>"
        f"<RutConsultante>{rut_num}</RutConsultante>"
        f"<DvConsultante>{dv}</DvConsultante>"
        f"<RutCompania>{rut_num}</RutCompania>"
        f"<DvCompania>{dv}</DvCompania>"
        f"<RutReceptor>{rec_num}</RutReceptor>"
        f"<DvReceptor>{rec_dv}</DvReceptor>"
        f"<TipoDte>{tipo_dte}</TipoDte>"
        f"<FolioDte>{folio}</FolioDte>"
        f"<FechaEmisionDte>{fecha_emision}</FechaEmisionDte>"
        f"<MontoDte>{monto}</MontoDte>"
        f"<Token>{token}</Token>"
        "</getEstDte>"
    )

    url = SII_URLS[env]["status"]
    async with httpx.AsyncClient(verify=True) as client:
        resp = await client.post(url, content=soap.encode("utf-8"), headers=_SOAP_HEADERS, timeout=30)
        resp.raise_for_status()

    root = etree.fromstring(resp.content)
    estado_els = root.xpath("//*[local-name()='ESTADO']")
    glosa_els = root.xpath("//*[local-name()='GLOSA']")

    return {
        "estado": (estado_els[0].text or "").strip() if estado_els else "",
        "glosa": (glosa_els[0].text or "").strip() if glosa_els else "",
    }
