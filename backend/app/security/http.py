from fastapi import Request, HTTPException, status


def get_token(request: Request) -> str:
    """
    Extracts the Bearer token from the Authorization header.

    :param request: FastAPI Request object.
    :return: Extracted token string.
    :raises HTTPException: If Authorization header is missing or invalid.
    """
    authorization: str = request.headers.get("Authorization")

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "missing_authorization_header", "message": "Authorization header is missing"},
        )

    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_authorization_header",
                "message": "Invalid Authorization header format. Expected 'Bearer <token>'",
            },
        )

    return token
