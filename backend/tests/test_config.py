import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_log_level_is_normalized() -> None:
    assert Settings(log_level="debug").log_level == "DEBUG"


def test_invalid_log_level_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(log_level="verbose")


def test_invalid_port_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(app_port=70000)
