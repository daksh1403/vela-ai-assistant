from fastapi import HTTPException


class AppError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.message = message


class ProviderError(AppError):
    pass


def map_upstream_status(status: int) -> ProviderError:
    if status == 429:
        return ProviderError(
            429, "UPSTREAM_RATE_LIMIT", "The AI service is busy. Try again shortly."
        )
    if status in (401, 403):
        return ProviderError(503, "PROVIDER_CONFIGURATION", "AI service is unavailable right now.")
    if status == 402:
        return ProviderError(503, "PROVIDER_QUOTA", "AI service is unavailable right now.")
    if 400 <= status < 500:
        return ProviderError(
            502, "UPSTREAM_REJECTED", "The AI service could not process this request."
        )
    return ProviderError(503, "UPSTREAM_UNAVAILABLE", "AI service is temporarily unavailable.")
