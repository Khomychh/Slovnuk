from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.dependencies import get_settings
from app.routes.accounts import router as accounts_router
from app.routes.grammar import router as grammar_router
from app.routes.profiles import router as profiles_router
from app.routes.study import router as study_router
from app.routes.vocabulary import router as vocabulary_router

app = FastAPI(
    title="Slovnuk API",
    description="The app for learning English",
    version="0.1.0",
)

api_version_prefix = "/api/v1"

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts_router, prefix=f"{api_version_prefix}/accounts", tags=["accounts"])
app.include_router(profiles_router, prefix=f"{api_version_prefix}/profiles", tags=["profiles"])
app.include_router(study_router, prefix=f"{api_version_prefix}/study", tags=["study"])
app.include_router(
    vocabulary_router, prefix=f"{api_version_prefix}/vocabulary", tags=["vocabulary"]
)
app.include_router(grammar_router, prefix=f"{api_version_prefix}/grammar", tags=["grammar"])

@app.get("/")
async def root():
    return {"message": "Slovnuk"}
