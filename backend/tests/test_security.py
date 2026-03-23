from app.core.security import hash_password, verify_password


def test_hash_password_roundtrip_without_bcrypt_traceback(capsys) -> None:
    capsys.readouterr()

    password = "Admin123!"
    hashed_password = hash_password(password)
    captured = capsys.readouterr()

    assert "error reading bcrypt version" not in captured.err
    assert hashed_password != password
    assert verify_password(password, hashed_password)
    assert not verify_password("Wrong123!", hashed_password)
