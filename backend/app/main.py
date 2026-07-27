from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.dependencies import get_settings
from app.routes.accounts import router as accounts_router
from app.routes.profiles import router as profiles_router

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

@app.get("/")
async def root():
    return {"message": "Slovnuk"}
