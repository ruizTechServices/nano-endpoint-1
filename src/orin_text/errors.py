"""Stable error types shared across application layers."""


class OrinTextError(Exception):
    """Base error for expected application failures."""


class EndpointError(OrinTextError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class ResponseContractError(OrinTextError):
    """The endpoint returned data outside the documented contract."""


class RetryExhaustedError(EndpointError):
    """All endpoint attempts failed with transient errors."""


class EmptyAnswerError(OrinTextError):
    """Generation completed without a usable final answer."""

