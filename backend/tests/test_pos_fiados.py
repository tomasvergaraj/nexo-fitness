"""Tests de fiados (cuenta corriente de socios): saldos, límite de crédito,
fiado parcial e impacto en el arqueo de caja.

Funciones puras de pos.py → sin DB. El flujo end-to-end con DB real vive en
scripts/verify_pos_flow.py (apertura → fiado total/parcial → abonos → cierre →
saldar deuda).
"""

from decimal import Decimal

from app.api.v1.endpoints.pos import (
    cash_difference,
    compute_expected_cash,
    credit_limit_exceeded,
    is_valid_credit_payment_method,
    _signed,
)

D = Decimal


# ─── Saldo de la cuenta corriente (cargos − abonos) ─────────────────────────────

def _balance(movimientos):
    """Saldo = Σ cargos − Σ abonos, replicando _signed del estado de cuenta."""
    return sum((_signed(kind, amount) for kind, amount in movimientos), D("0"))


def test_saldo_sube_con_cargo_y_baja_con_abono():
    # Fiado de 40.000, abona 15.000 → debe 25.000.
    mov = [("charge", D("40000")), ("payment", D("15000"))]
    assert _balance(mov) == D("25000")


def test_saldo_cero_cuando_se_salda_la_deuda():
    # Fiado 30.000 + fiado 20.000 = 50.000 de deuda; dos abonos la saldan.
    mov = [("charge", D("30000")), ("charge", D("20000")),
           ("payment", D("20000")), ("payment", D("30000"))]
    assert _balance(mov) == D("0")


def test_fiado_parcial_deja_como_deuda_total_menos_abono():
    # Venta 19.990 con abono al momento de 9.990 → deuda 10.000.
    # Se modela como cargo total + abono inmediato.
    mov = [("charge", D("19990")), ("payment", D("9990"))]
    assert _balance(mov) == D("10000")


# ─── Límite de crédito ──────────────────────────────────────────────────────────

def test_sin_limite_nunca_se_excede():
    assert credit_limit_exceeded(D("999999"), D("50000"), None) is False


def test_cargo_bajo_el_limite_no_excede():
    # Debe 10.000, límite 50.000, nuevo cargo 20.000 → 30.000 ≤ 50.000.
    assert credit_limit_exceeded(D("10000"), D("20000"), D("50000")) is False


def test_cargo_justo_en_el_limite_no_excede():
    # 30.000 + 20.000 = 50.000 == límite → permitido (solo bloquea si supera).
    assert credit_limit_exceeded(D("30000"), D("20000"), D("50000")) is False


def test_cargo_sobre_el_limite_excede():
    # 40.000 + 20.000 = 60.000 > 50.000 → excede.
    assert credit_limit_exceeded(D("40000"), D("20000"), D("50000")) is True


# ─── Métodos de pago válidos para abono / pie de fiado ──────────────────────────

def test_metodos_de_abono_validos():
    assert is_valid_credit_payment_method("cash")
    assert is_valid_credit_payment_method("transfer")
    assert is_valid_credit_payment_method("debit_card")


def test_metodos_de_abono_invalidos():
    # No se puede "abonar" con fiado, mixto ni devolución.
    assert not is_valid_credit_payment_method("credit")
    assert not is_valid_credit_payment_method("mixed")
    assert not is_valid_credit_payment_method("refund")


# ─── Impacto en el arqueo de caja ───────────────────────────────────────────────

def test_fiado_otorgado_no_entra_al_efectivo_esperado():
    # El fiado se vende SIN cobrar efectivo: no aparece como cash_sales ni como
    # abono. Fondo 50.000, sin ventas efectivo ni abonos → caja sigue en 50.000.
    assert compute_expected_cash(D("50000"), D("0"), D("0"), D("0"), D("0"), D("0")) == D("50000")


def test_abono_de_fiado_en_efectivo_suma_al_arqueo():
    # Fondo 50.000 + ventas efectivo 54.970 + abonos de fiado en efectivo 29.990
    # (pie 9.990 + abono 20.000) = 134.960. Coincide con verify_pos_flow.
    got = compute_expected_cash(D("50000"), D("54970"), D("0"), D("29990"), D("0"), D("0"))
    assert got == D("134960")
    # Caja cuadrada cuando se cuenta exactamente lo esperado.
    assert cash_difference(D("134960"), got) == D("0")
