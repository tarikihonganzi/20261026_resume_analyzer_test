from typing import Annotated, cast

from fastapi import Depends, Request

from app.services import Services


def get_services(request: Request) -> Services:
    return cast(Services, request.app.state.services)


ServicesDep = Annotated[Services, Depends(get_services)]
