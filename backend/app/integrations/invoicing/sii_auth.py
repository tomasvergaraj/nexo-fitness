"""SII authentication: seed (CrSeed.jws) → signed XML → token (GetTokenFromSeed.jws)."""

import base64
import hashlib
from html import unescape

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from lxml import etree

SII_URLS = {
    "certificacion": {
        "seed":   "https://maullin.sii.cl/DTEWS/CrSeed.jws",
        "token":  "https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws",
        "upload": "https://maullin.sii.cl/cgi_dte/UPL/DTEUpload",
        "status": "https://maullin.sii.cl/DTEWS/QueryEstDte.jws",
    },
    "produccion": {
        "seed":   "https://palena.sii.cl/DTEWS/CrSeed.jws",
        "token":  "https://palena.sii.cl/DTEWS/GetTokenFromSeed.jws",
        "upload": "https://palena.sii.cl/cgi_dte/UPL/DTEUpload",
        "status": "https://palena.sii.cl/DTEWS/QueryEstDte.jws",
    },
}

_SOAP_HEADERS = {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""'}


def _soap(body: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
        ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<soapenv:Body>{body}</soapenv:Body>"
        "</soapenv:Envelope>"
    ).encode("utf-8")


def _extract_first(xml_bytes: bytes, local_tag: str) -> str:
    root = etree.fromstring(xml_bytes)
    els = root.xpath(f"//*[local-name()='{local_tag}']")
    if not els:
        raise ValueError(f"Tag <{local_tag}> not found in: {xml_bytes[:400]}")
    return (els[0].text or "").strip()


async def _get_seed(env: str, client: httpx.AsyncClient) -> str:
    """Call CrSeed.jws → getSeed → returns the seed string."""
    resp = await client.post(
        SII_URLS[env]["seed"],
        content=_soap("<getSeed/>"),
        headers=_SOAP_HEADERS,
        timeout=30,
    )
    resp.raise_for_status()

    # getSeedReturn contains HTML-encoded XML:
    # <getSeedReturn>...&lt;SEMILLA&gt;123&lt;/SEMILLA&gt;...</getSeedReturn>
    raw_return = _extract_first(resp.content, "getSeedReturn")
    inner_xml = unescape(raw_return).encode("utf-8")
    return _extract_first(inner_xml, "SEMILLA")


def _c14n(el: etree._Element) -> bytes:
    return etree.tostring(el, method="c14n", exclusive=False, with_tail=False)


def _build_gettoken_xml(seed: str, private_key, cert_der: bytes) -> str:
    """Build the signed XML that goes inside the getToken pszXml parameter."""
    # Document to sign (enveloped signature)
    doc_xml = f"<getToken><item><Semilla>{seed}</Semilla></item></getToken>"
    doc_el = etree.fromstring(doc_xml.encode("utf-8"))
    doc_c14n = _c14n(doc_el)

    digest_b64 = base64.b64encode(hashlib.sha1(doc_c14n).digest()).decode()

    si_xml = (
        '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">'
        '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>'
        '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>'
        '<Reference URI="">'
        '<Transforms>'
        '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>'
        '</Transforms>'
        '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>'
        f'<DigestValue>{digest_b64}</DigestValue>'
        '</Reference>'
        '</SignedInfo>'
    )
    si_el = etree.fromstring(si_xml.encode("utf-8"))
    si_c14n = _c14n(si_el)

    sig_bytes = private_key.sign(si_c14n, asym_padding.PKCS1v15(), hashes.SHA1())
    sig_b64 = base64.b64encode(sig_bytes).decode()
    cert_b64 = base64.b64encode(cert_der).decode()

    # Extract RSA public key components for KeyValue
    pub_numbers = private_key.public_key().public_numbers()
    modulus = base64.b64encode(
        pub_numbers.n.to_bytes((pub_numbers.n.bit_length() + 7) // 8, "big")
    ).decode()
    exponent = base64.b64encode(
        pub_numbers.e.to_bytes((pub_numbers.e.bit_length() + 7) // 8, "big")
    ).decode()

    signed_xml = (
        '<?xml version="1.0"?>'
        f'<getToken><item><Semilla>{seed}</Semilla></item>'
        '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">'
        f'{si_xml}'
        f'<SignatureValue>{sig_b64}</SignatureValue>'
        '<KeyInfo>'
        '<KeyValue><RSAKeyValue>'
        f'<Modulus>{modulus}</Modulus>'
        f'<Exponent>{exponent}</Exponent>'
        '</RSAKeyValue></KeyValue>'
        '<X509Data>'
        f'<X509Certificate>{cert_b64}</X509Certificate>'
        '</X509Data>'
        '</KeyInfo>'
        '</Signature>'
        '</getToken>'
    )
    return signed_xml


async def get_token(env: str, private_key, cert_der: bytes, rut_envia: str) -> str:
    """Obtain a SII session token. Valid ~60 seconds."""
    async with httpx.AsyncClient(verify=True) as client:
        seed = await _get_seed(env, client)

        signed_xml = _build_gettoken_xml(seed, private_key, cert_der)

        soap_body = f"<getToken><pszXml><![CDATA[{signed_xml}]]></pszXml></getToken>"
        resp = await client.post(
            SII_URLS[env]["token"],
            content=_soap(soap_body),
            headers=_SOAP_HEADERS,
            timeout=30,
        )
        resp.raise_for_status()

        # getTokenReturn contains HTML-encoded XML with <TOKEN>
        raw_return = _extract_first(resp.content, "getTokenReturn")
        inner_xml = unescape(raw_return).encode("utf-8")
        token = _extract_first(inner_xml, "TOKEN")
        if not token:
            raise ValueError(f"SII devolvió token vacío. Respuesta: {raw_return[:400]}")
        return token
