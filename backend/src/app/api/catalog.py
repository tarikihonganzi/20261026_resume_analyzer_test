from fastapi import APIRouter

from app.api.schemas import CatalogResponse
from app.catalog import load_catalog

router = APIRouter()


@router.get("/api/catalog")
def get_catalog() -> CatalogResponse:
    """プリセット条件の一覧（仕様 11 章）。"""
    return CatalogResponse(items=load_catalog())
