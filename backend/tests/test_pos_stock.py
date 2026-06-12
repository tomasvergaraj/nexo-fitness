"""Tests del descuento de stock en una venta POS.

Cubren la validación de stock (bloquear si no alcanza) y el signo del movimiento
de inventario que genera la venta (salida = negativo). Funciones puras → sin DB.
"""

from app.api.v1.endpoints.pos import is_stock_sufficient, sale_movement_quantity


def test_stock_suficiente_cuando_sobra():
    assert is_stock_sufficient(available=10, requested=3) is True


def test_stock_suficiente_en_el_limite_exacto():
    # Vender exactamente lo que hay debe permitirse (deja stock en 0).
    assert is_stock_sufficient(available=5, requested=5) is True


def test_stock_insuficiente_bloquea():
    assert is_stock_sufficient(available=2, requested=3) is False


def test_sin_stock_no_se_puede_vender():
    assert is_stock_sufficient(available=0, requested=1) is False


def test_movimiento_de_venta_es_salida_negativa():
    # La venta genera un InventoryMovement SALE con cantidad negativa.
    assert sale_movement_quantity(3) == -3


def test_descuento_aplicado_al_stock_disponible():
    # Patrón del endpoint: nuevo_stock = disponible + cantidad_del_movimiento.
    available = 10
    requested = 4
    assert is_stock_sufficient(available, requested)
    new_stock = available + sale_movement_quantity(requested)
    assert new_stock == 6
