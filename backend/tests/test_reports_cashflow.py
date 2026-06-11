"""Tests del flujo de caja con arrastre (saldo acumulado mes a mes y día de corte)."""

from datetime import date
from decimal import Decimal

from app.api.v1.endpoints.operations.reports import _last_periods, _period_key, build_cashflow


def test_last_periods_cruza_anio():
    assert _last_periods((2026, 2), 4) == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


def test_last_periods_un_mes():
    assert _last_periods((2026, 6), 1) == [(2026, 6)]


def test_period_key_sin_corte_es_mes_calendario():
    assert _period_key(date(2026, 6, 1), None) == (2026, 6)
    assert _period_key(date(2026, 6, 30), None) == (2026, 6)


def test_period_key_con_corte_25():
    # Hasta el 25 inclusive cuenta para el mes en curso.
    assert _period_key(date(2026, 6, 25), 25) == (2026, 6)
    # Desde el 26 ya cuenta para el mes siguiente.
    assert _period_key(date(2026, 6, 26), 25) == (2026, 7)
    assert _period_key(date(2026, 5, 26), 25) == (2026, 6)


def test_period_key_corte_cruza_anio():
    assert _period_key(date(2025, 12, 26), 25) == (2026, 1)
    assert _period_key(date(2025, 12, 25), 25) == (2025, 12)


def test_excedente_pasa_como_pie_del_mes_siguiente():
    # Ejemplo del cliente: gana 1M, gasta 800k → el mes siguiente parte con 200k.
    months = [(2026, 5), (2026, 6)]
    income = {(2026, 5): Decimal("1000000"), (2026, 6): Decimal("500000")}
    costs = {(2026, 5): Decimal("800000"), (2026, 6): Decimal("300000")}

    opening, closing, series = build_cashflow(months, income, costs)

    assert opening == Decimal("0")
    assert series[0].net == 200000.0
    assert series[0].balance == 200000.0
    # Junio arranca desde los 200k y suma su propio resultado (200k).
    assert series[1].net == 200000.0
    assert series[1].balance == 400000.0
    assert closing == Decimal("400000")


def test_deficit_arrastra_saldo_negativo():
    months = [(2026, 5), (2026, 6)]
    income = {(2026, 5): Decimal("100000"), (2026, 6): Decimal("500000")}
    costs = {(2026, 5): Decimal("400000")}

    opening, closing, series = build_cashflow(months, income, costs)

    assert opening == Decimal("0")
    assert series[0].balance == -300000.0
    assert series[1].balance == 200000.0
    assert closing == Decimal("200000")


def test_historia_anterior_entra_al_saldo_inicial():
    # Meses fuera de la ventana mostrada acumulan en el saldo inicial.
    months = [(2026, 6)]
    income = {(2026, 3): Decimal("900000"), (2026, 4): Decimal("100000"), (2026, 6): Decimal("50000")}
    costs = {(2026, 3): Decimal("700000"), (2026, 6): Decimal("20000")}

    opening, closing, series = build_cashflow(months, income, costs)

    assert opening == Decimal("300000")
    assert series[0].balance == 330000.0
    assert closing == Decimal("330000")


def test_meses_sin_datos_mantienen_saldo():
    months = [(2026, 4), (2026, 5), (2026, 6)]
    income = {(2026, 4): Decimal("100000")}
    costs: dict[tuple[int, int], Decimal] = {}

    _, closing, series = build_cashflow(months, income, costs)

    assert [p.balance for p in series] == [100000.0, 100000.0, 100000.0]
    assert [p.net for p in series] == [100000.0, 0.0, 0.0]
    assert closing == Decimal("100000")


def test_labels_en_espanol_con_anio():
    months = [(2025, 12), (2026, 1)]
    _, _, series = build_cashflow(months, {}, {})
    assert [p.label for p in series] == ["Dic 2025", "Ene 2026"]


def test_corte_25_mueve_movimientos_al_periodo_siguiente():
    # Venta del 28 de mayo con corte 25 cae en el período de junio.
    cutoff = 25
    movimientos = [
        (date(2026, 5, 20), Decimal("1000000")),   # período mayo
        (date(2026, 5, 28), Decimal("300000")),    # período junio (post-corte)
        (date(2026, 6, 10), Decimal("200000")),    # período junio
    ]
    income: dict[tuple[int, int], Decimal] = {}
    for day, amount in movimientos:
        key = _period_key(day, cutoff)
        income[key] = income.get(key, Decimal("0")) + amount
    costs = {(2026, 5): Decimal("800000")}

    _, closing, series = build_cashflow([(2026, 5), (2026, 6)], income, costs)

    # Mayo (26 abr → 25 may): 1M − 800k = 200k de pie.
    assert series[0].balance == 200000.0
    # Junio (26 may → 25 jun): 300k + 200k sobre el pie de 200k.
    assert series[1].net == 500000.0
    assert closing == Decimal("700000")
