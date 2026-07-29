from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config.dependencies import get_jwt_auth_manager, get_s3_storage_client
from app.database.database import get_db
from app.database.models.accounts import UserModel, UserGroupEnum, UserProfileModel
from app.exceptions import BaseSecurityError, BaseS3Error, S3FileNotFoundError
from app.schemas.profiles import (
    ProfileCreateSchema,
    ProfileResponseSchema,
    ProfileUpdateSchema,
    AvatarUpdateSchema,
)
from app.security.http import get_token
from app.security.interfaces import JWTAuthManagerInterface
from app.storages import S3StorageInterface

router = APIRouter()


async def _authorize_profile_access(
    user_id: int,
    token: str,
    db: AsyncSession,
    jwt_manager: JWTAuthManagerInterface,
) -> None:
    """
    Verify the bearer token belongs to the target user or to an admin.

    Raises HTTPException (401 for a bad token, 403 for a mismatched user)
    otherwise returns nothing.
    """
    try:
        payload = jwt_manager.decode_access_token(token)
    except BaseSecurityError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_access_token", "message": str(error)},
        )

    request_user_id = payload.get("user_id")

    if request_user_id != user_id:
        stmt = (
            select(UserModel)
            .options(joinedload(UserModel.group))
            .filter_by(id=request_user_id)
        )
        result = await db.execute(stmt)
        request_user = result.scalars().first()
        if not request_user or not request_user.has_group(UserGroupEnum.ADMIN):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "forbidden_profile_access",
                    "message": "You don't have permission to edit this profile.",
                },
            )


@router.post(
    "/{user_id}/",
    response_model=ProfileResponseSchema,
    summary="Create User Profile",
    description="Create a profile for the specified user, uploading the avatar to S3-compatible storage.",
    status_code=status.HTTP_201_CREATED,
)
async def create_profile(
    user_id: int,
    token: str = Depends(get_token),
    profile_data: ProfileCreateSchema = Depends(ProfileCreateSchema.as_form),
    db: AsyncSession = Depends(get_db),
    jwt_manager: JWTAuthManagerInterface = Depends(get_jwt_auth_manager),
    s3_client: S3StorageInterface = Depends(get_s3_storage_client),
) -> ProfileResponseSchema:
    """
    Endpoint for creating a user profile.

    Validates the access token, checks that the requester is allowed to edit the target profile,
    verifies that the target user exists and is active, ensures no profile already exists, uploads
    the avatar to S3-compatible storage, and persists the new profile.
    """
    # Перевірка доступу до профілю
    await _authorize_profile_access(user_id, token, db, jwt_manager)

    # Перевірка наявності користувача
    stmt = select(UserModel).filter_by(id=user_id)
    result = await db.execute(stmt)
    target_user = result.scalars().first()
    if not target_user or not target_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "user_not_found", "message": "User not found or not active."},
        )

    # Перевірка наявності профілю
    stmt = select(UserProfileModel).filter_by(user_id=user_id)
    result = await db.execute(stmt)
    existing_profile = result.scalars().first()
    if existing_profile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "profile_already_exists", "message": "User already has a profile."},
        )

    # Збереження аватара
    avatar_key = f"avatars/{user_id}_avatar.jpg"
    avatar_bytes = await profile_data.avatar.read()
    try:
        await s3_client.upload_file(
            file_name=avatar_key, file_data=avatar_bytes, private=False
        )
    except BaseS3Error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "avatar_upload_failed",
                "message": "Failed to upload avatar. Please try again later.",
            },
        )

    # Створення нового профілю
    new_profile = UserProfileModel(
        user_id=user_id,
        first_name=profile_data.first_name,
        last_name=profile_data.last_name,
        patronymic=profile_data.patronymic,
        phone=profile_data.phone,
        gender=profile_data.gender,
        date_of_birth=profile_data.date_of_birth,
        info=profile_data.info,
        avatar=avatar_key,
    )
    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)

    # Отримання URL аватара
    avatar_url = await s3_client.get_file_url(avatar_key, private=False)

    return ProfileResponseSchema(
        id=new_profile.id,
        user_id=user_id,
        first_name=new_profile.first_name,
        last_name=new_profile.last_name,
        patronymic=new_profile.patronymic,
        phone=new_profile.phone,
        gender=new_profile.gender,
        date_of_birth=new_profile.date_of_birth,
        info=new_profile.info,
        avatar=avatar_url,
    )


@router.patch(
    "/{user_id}/",
    response_model=ProfileResponseSchema,
    summary="Update User Profile",
    description="Create or update the name, patronymic, and phone number on the specified user's profile.",
    status_code=status.HTTP_200_OK,
)
async def update_profile(
    user_id: int,
    profile_data: ProfileUpdateSchema,
    token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
    jwt_manager: JWTAuthManagerInterface = Depends(get_jwt_auth_manager),
    s3_client: S3StorageInterface = Depends(get_s3_storage_client),
) -> ProfileResponseSchema:
    """
    Endpoint for updating a user's profile.

    Unlike `create_profile`, this accepts a plain JSON body of whichever
    fields the caller wants to change (name, patronymic, phone, gender,
    date of birth, bio) and upserts them: it creates the profile row if one
    doesn't exist yet, or patches only the provided fields on an existing
    one. Avatar uploads are handled separately by the avatar endpoint below,
    since they require a multipart request rather than JSON.
    """
    # Перевірка доступу до профілю
    await _authorize_profile_access(user_id, token, db, jwt_manager)

    # Перевірка наявності користувача
    stmt = select(UserModel).filter_by(id=user_id)
    result = await db.execute(stmt)
    target_user = result.scalars().first()
    if not target_user or not target_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "user_not_found", "message": "User not found or not active."},
        )

    # Оновлення або створення профілю
    stmt = select(UserProfileModel).filter_by(user_id=user_id)
    result = await db.execute(stmt)
    profile = result.scalars().first()

    updates = profile_data.model_dump(exclude_unset=True)

    if not profile:
        profile = UserProfileModel(user_id=user_id, **updates)
        db.add(profile)
    else:
        for field, value in updates.items():
            setattr(profile, field, value)

    await db.commit()
    await db.refresh(profile)

    avatar_url = (
        await s3_client.get_file_url(profile.avatar, private=False)
        if profile.avatar
        else None
    )

    return ProfileResponseSchema(
        id=profile.id,
        user_id=user_id,
        first_name=profile.first_name,
        last_name=profile.last_name,
        patronymic=profile.patronymic,
        phone=profile.phone,
        gender=profile.gender,
        date_of_birth=profile.date_of_birth,
        info=profile.info,
        avatar=avatar_url,
    )


@router.patch(
    "/{user_id}/avatar/",
    response_model=ProfileResponseSchema,
    summary="Update Profile Avatar",
    description="Upload or replace the avatar on the specified user's profile.",
    status_code=status.HTTP_200_OK,
)
async def update_profile_avatar(
    user_id: int,
    token: str = Depends(get_token),
    avatar_data: AvatarUpdateSchema = Depends(AvatarUpdateSchema.as_form),
    db: AsyncSession = Depends(get_db),
    jwt_manager: JWTAuthManagerInterface = Depends(get_jwt_auth_manager),
    s3_client: S3StorageInterface = Depends(get_s3_storage_client),
) -> ProfileResponseSchema:
    """
    Endpoint for uploading or replacing a user's avatar.

    Accepts a multipart request with a single `avatar` file, uploads it to
    S3-compatible storage under a deterministic key (overwriting any
    previous avatar), and upserts the profile row's avatar field. Other
    profile fields are left untouched.
    """
    await _authorize_profile_access(user_id, token, db, jwt_manager)

    stmt = select(UserModel).filter_by(id=user_id)
    result = await db.execute(stmt)
    target_user = result.scalars().first()
    if not target_user or not target_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "user_not_found", "message": "User not found or not active."},
        )

    stmt = select(UserProfileModel).filter_by(user_id=user_id)
    result = await db.execute(stmt)
    profile = result.scalars().first()

    # Публічний бакет, а не приватний (за замовчуванням `upload_file` пише в
    # приватний). Раніше аватар лягав у приватний, а `/accounts/me/` будував
    # посилання на публічний — тобто картинка завантажувалась успішно й одразу
    # віддавала 404. Приватний бакет тут і не потрібен: посилання на нього
    # підписане й живе годину, тож аватар у шапці ламався б щодня.
    avatar_key = f"avatars/{user_id}_avatar.jpg"
    avatar_bytes = await avatar_data.avatar.read()
    try:
        await s3_client.upload_file(
            file_name=avatar_key, file_data=avatar_bytes, private=False
        )
    except BaseS3Error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "avatar_upload_failed",
                "message": "Failed to upload avatar. Please try again later.",
            },
        )

    if not profile:
        profile = UserProfileModel(user_id=user_id, avatar=avatar_key)
        db.add(profile)
    else:
        profile.avatar = avatar_key

    await db.commit()
    await db.refresh(profile)

    avatar_url = await s3_client.get_file_url(avatar_key, private=False)

    return ProfileResponseSchema(
        id=profile.id,
        user_id=user_id,
        first_name=profile.first_name,
        last_name=profile.last_name,
        patronymic=profile.patronymic,
        phone=profile.phone,
        gender=profile.gender,
        date_of_birth=profile.date_of_birth,
        info=profile.info,
        avatar=avatar_url,
    )


@router.delete(
    "/{user_id}/avatar/",
    response_model=ProfileResponseSchema,
    summary="Delete Profile Avatar",
    description="Remove the avatar from the specified user's profile.",
    status_code=status.HTTP_200_OK,
)
async def delete_profile_avatar(
    user_id: int,
    token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
    jwt_manager: JWTAuthManagerInterface = Depends(get_jwt_auth_manager),
    s3_client: S3StorageInterface = Depends(get_s3_storage_client),
) -> ProfileResponseSchema:
    """
    Endpoint for removing a user's avatar.

    Deletes the file from S3-compatible storage and clears the profile
    row's avatar field. Other profile fields are left untouched.
    """
    await _authorize_profile_access(user_id, token, db, jwt_manager)

    stmt = select(UserModel).filter_by(id=user_id)
    result = await db.execute(stmt)
    target_user = result.scalars().first()
    if not target_user or not target_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "user_not_found", "message": "User not found or not active."},
        )

    stmt = select(UserProfileModel).filter_by(user_id=user_id)
    result = await db.execute(stmt)
    profile = result.scalars().first()
    if not profile or not profile.avatar:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "avatar_not_found", "message": "This profile has no avatar to delete."},
        )

    try:
        await s3_client.delete_file(profile.avatar, private=False)
    except S3FileNotFoundError:
        pass
    except BaseS3Error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "avatar_delete_failed",
                "message": "Failed to delete avatar. Please try again later.",
            },
        )

    profile.avatar = None
    await db.commit()
    await db.refresh(profile)

    return ProfileResponseSchema(
        id=profile.id,
        user_id=user_id,
        first_name=profile.first_name,
        last_name=profile.last_name,
        patronymic=profile.patronymic,
        phone=profile.phone,
        gender=profile.gender,
        date_of_birth=profile.date_of_birth,
        info=profile.info,
        avatar=None,
    )
