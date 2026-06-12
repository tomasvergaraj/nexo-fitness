"""Tests del cálculo del cierre de caja (arqueo de efectivo).

Cubren la fórmula de efectivo esperado y el descuadre, las dos cuentas que el
turno congela en su snapshot al cerrar. Funciones puras → sin DB.
"""

from decimal import Decimal

from app.api.v1.endpoints.pos import cash_difference, compute_expected_cash

D = Decimal


def test_solo_fondo_de_apertura_sin_movimientos():
    # Caja abierta con 50.000 y nada vendido → se espera el mismo fondo.
    assert compute_expected_cash(D("50000"), D("0"), D("0"), D("0"), D("0"), D("0")) == D("50000")


def test_ventas_en_efectivo_suman_al_fondo():
    # Fondo 50.000 + 120.000 en ventas efectivo → 170.000.
    assert compute_expected_cash(D("50000"), D("120000"), D("0"), D("0"), D("0"), D("0")) == D("170000")


def test_membresias_y_abonos_de_fiado_en_efectivo_suman():
    # Fondo 10.000 + ventas 30.000 + membresía 25.000 + abono fiado 5.000 = 70.000.
    assert compute_expected_cash(D("10000"), D("30000"), D("25000"), D("5000"), D("0"), D("0")) == D("70000")


def test_devoluciones_y_gastos_de_caja_restan():
    # Fondo 0 + ventas 100.000 − devolución 15.000 − gasto de caja 20.000 = 65.000.
    assert compute_expected_cash(D("0"), D("100000"), D("0"), D("0"), D("15000"), D("20000")) == D("65000")


def test_formula_completa_con_los_seis_terminos():
    # opening + cash_sales + membership + credit − refunds − expenses
    # 50.000 + 200.000 + 80.000 + 12.000 − 9.000 − 33.000 = 300.000
    got = compute_expected_cash(D("50000"), D("200000"), D("80000"), D("12000"), D("9000"), D("33000"))
    assert got == D("300000")


def test_venta_devuelta_mismo_turno_neta_a_cero():
    # Venta en efectivo 1.000 (entra como cash_sales) y devuelta el mismo turno
    # (refunded_amount 1.000) → no debe afectar el efectivo esperado.
    assert compute_expected_cash(D("0"), D("1000"), D("0"), D("0"), D("1000"), D("0")) == D("0")


def test_respeta_decimales():
    got = compute_expected_cash(D("0.00"), D("1990.50"), D("0"), D("0"), D("0.50"), D("0"))
    assert got == D("1990.00")


def test_diferencia_cero_es_cuadrado():
    assert cash_difference(counted=D("170000"), expected=D("170000")) == D("0")


def test_diferencia_positiva_sobra_efectivo():
    assert cash_difference(counted=D("175000"), expected=D("170000")) == D("5000")


def test_diferencia_negativa_falta_efectivo():
    assert cash_difference(counted=D("168000"), expected=D("170000")) == D("-2000")
