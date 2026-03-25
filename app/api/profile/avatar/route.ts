import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const AVATAR_BUCKET = "Pathly_user_avatars";
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type AvatarUploadResponse = {
  success: boolean;
  message?: string;
  avatar_url?: string | null;
  avatar_path?: string | null;
  avatar_updated_at?: string | null;
};

function toErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return {
      message: String(error ?? "unknown_error"),
      code: null as string | null,
      details: null as string | null,
      hint: null as string | null,
    };
  }
  const record = error as Record<string, unknown>;
  return {
    message: typeof record.message === "string" ? record.message : "unknown_error",
    code: typeof record.code === "string" ? record.code : null,
    details: typeof record.details === "string" ? record.details : null,
    hint: typeof record.hint === "string" ? record.hint : null,
  };
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "bin";
}

function sanitizeFileName(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80);
  return base || "avatar";
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<AvatarUploadResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json<AvatarUploadResponse>(
        { success: false, message: "Invalid multipart form payload." },
        { status: 400 },
      );
    }

    const fileValue = formData.get("file");
    if (!(fileValue instanceof File)) {
      return NextResponse.json<AvatarUploadResponse>(
        { success: false, message: "Avatar file is required." },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(fileValue.type)) {
      return NextResponse.json<AvatarUploadResponse>(
        {
          success: false,
          message: "Invalid file type. Allowed: image/jpeg, image/png, image/webp.",
        },
        { status: 400 },
      );
    }

    if (fileValue.size <= 0 || fileValue.size > MAX_AVATAR_SIZE_BYTES) {
      return NextResponse.json<AvatarUploadResponse>(
        {
          success: false,
          message: `Invalid file size. Maximum allowed size is ${Math.floor(MAX_AVATAR_SIZE_BYTES / 1024 / 1024)}MB.`,
        },
        { status: 400 },
      );
    }

    const { data: existingUserRow, error: existingUserError } = await supabaseAdmin
      .from("users")
      .select("avatar_path")
      .eq("id", sessionUser.id)
      .limit(1)
      .maybeSingle<{ avatar_path: string | null }>();

    if (existingUserError) {
      const details = toErrorDetails(existingUserError);
      console.error("[avatar_upload] user_lookup_failed", {
        table: "users",
        query: "select avatar_path",
        user_id: sessionUser.id,
        ...details,
      });
      return NextResponse.json<AvatarUploadResponse>(
        { success: false, message: "Unable to validate current user profile." },
        { status: 500 },
      );
    }

    const oldAvatarPath = (existingUserRow?.avatar_path ?? "").trim();
    const extension = extensionForMimeType(fileValue.type);
    const baseNameWithoutExtension = fileValue.name.replace(/\.[^.]+$/, "");
    const safeName = sanitizeFileName(baseNameWithoutExtension);
    const nowMs = Date.now();
    const filePath = `${sessionUser.id}/${nowMs}-${randomUUID()}-${safeName}.${extension}`;
    const fileBuffer = Buffer.from(await fileValue.arrayBuffer());

    const uploadResult = await supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, fileBuffer, {
        upsert: false,
        contentType: fileValue.type,
        cacheControl: "3600",
      });

    if (uploadResult.error) {
      const details = toErrorDetails(uploadResult.error);
      console.error("[avatar_upload] storage_upload_failed", {
        bucket: AVATAR_BUCKET,
        user_id: sessionUser.id,
        file_path: filePath,
        mime_type: fileValue.type,
        file_size_bytes: fileValue.size,
        ...details,
      });
      return NextResponse.json<AvatarUploadResponse>(
        { success: false, message: "Failed to upload avatar file." },
        { status: 500 },
      );
    }

    const publicUrl = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(filePath).data.publicUrl;
    const avatarUrl = (publicUrl ?? "").trim() || null;
    const avatarUpdatedAt = new Date().toISOString();

    const { error: updateUserError } = await supabaseAdmin
      .from("users")
      .update({
        avatar_url: avatarUrl,
        avatar_path: filePath,
        avatar_updated_at: avatarUpdatedAt,
      })
      .eq("id", sessionUser.id);

    if (updateUserError) {
      const details = toErrorDetails(updateUserError);
      console.error("[avatar_upload] user_update_failed", {
        table: "users",
        query: "update avatar columns",
        user_id: sessionUser.id,
        avatar_path: filePath,
        ...details,
      });
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([filePath]);
      return NextResponse.json<AvatarUploadResponse>(
        { success: false, message: "Failed to save avatar metadata." },
        { status: 500 },
      );
    }

    if (oldAvatarPath && oldAvatarPath !== filePath) {
      const removeResult = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([oldAvatarPath]);
      if (removeResult.error) {
        const details = toErrorDetails(removeResult.error);
        console.warn("[avatar_upload] old_avatar_remove_failed", {
          bucket: AVATAR_BUCKET,
          user_id: sessionUser.id,
          old_avatar_path: oldAvatarPath,
          ...details,
        });
      }
    }

    console.info("[avatar_upload] completed", {
      user_id: sessionUser.id,
      avatar_path: filePath,
      avatar_updated_at: avatarUpdatedAt,
      mime_type: fileValue.type,
      file_size_bytes: fileValue.size,
    });

    return NextResponse.json<AvatarUploadResponse>({
      success: true,
      avatar_url: avatarUrl,
      avatar_path: filePath,
      avatar_updated_at: avatarUpdatedAt,
    });
  } catch (error) {
    const details = toErrorDetails(error);
    console.error("[avatar_upload] unhandled_failure", {
      route: "/api/profile/avatar POST",
      ...details,
    });
    return NextResponse.json<AvatarUploadResponse>(
      { success: false, message: "Unable to upload avatar right now." },
      { status: 500 },
    );
  }
}
