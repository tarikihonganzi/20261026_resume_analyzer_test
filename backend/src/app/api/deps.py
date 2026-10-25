from typing import Annotated, cast

from fastapi import Depends, Request

from app.services import Services


def get_services(request: Request) -> Services:
    """`create_app` が `app.state` に置いた部品（ストア・LLM クライアントの作り方）を取り出す。"""
    return cast(Services, request.app.state.services)


ServicesDep = Annotated[Services, Depends(get_services)]
